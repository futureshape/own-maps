import { z } from "zod";
import { getMapRole, requireUser } from "../db";
import { HttpError } from "../http";
import type { RequestContext } from "../types";

function requireWebSocketRequest(context: RequestContext): void {
  if (context.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "WebSocket upgrade required");
  }
  const origin = context.request.headers.get("origin");
  if (!origin || origin !== context.url.origin) {
    throw new HttpError(403, "Cross-origin WebSocket rejected");
  }
}

async function forwardConnection(
  context: RequestContext,
  mapId: string,
  identity: {
    userId: string;
    role: "owner" | "editor" | "viewer";
    displayName: string | null;
    avatarUrl: string | null;
    isAnonymous: boolean;
  },
): Promise<Response> {
  const headers = new Headers(context.request.headers);
  headers.set("x-pinboard-user-id", identity.userId);
  headers.set("x-pinboard-map-role", identity.role);
  headers.set("x-pinboard-display-name", encodeURIComponent(identity.displayName ?? ""));
  headers.set("x-pinboard-avatar-url", encodeURIComponent(identity.avatarUrl ?? ""));
  headers.set("x-pinboard-anonymous", String(identity.isAnonymous));

  return context.env.MAP_COLLABORATION
    .getByName(mapId)
    .fetch(new Request(context.request, { headers }));
}

export async function connectToMap(context: RequestContext): Promise<Response> {
  requireWebSocketRequest(context);
  const user = requireUser(context.user);
  const role = await getMapRole(context.env, context.params.mapId, user.id);
  return forwardConnection(context, context.params.mapId, {
    userId: user.id,
    role,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    isAnonymous: false,
  });
}

export async function connectToPublicMap(context: RequestContext): Promise<Response> {
  requireWebSocketRequest(context);
  const guestId = z.string().uuid().safeParse(context.url.searchParams.get("guestId"));
  if (!guestId.success) throw new HttpError(400, "A valid guest identity is required");

  const map = await context.env.DB.prepare("SELECT id FROM maps WHERE public_token = ?")
    .bind(context.params.publicToken)
    .first<{ id: string }>();
  if (!map) throw new HttpError(404, "Public map not found");

  return forwardConnection(context, map.id, {
    userId: `guest:${guestId.data}`,
    role: "viewer",
    displayName: `Guest ${guestId.data.slice(0, 4).toUpperCase()}`,
    avatarUrl: null,
    isAnonymous: true,
  });
}
