import { getMapRole, requireUser } from "../db";
import { HttpError } from "../http";
import type { RequestContext } from "../types";

export async function connectToMap(context: RequestContext): Promise<Response> {
  if (context.request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    throw new HttpError(426, "WebSocket upgrade required");
  }
  const origin = context.request.headers.get("origin");
  if (!origin || origin !== context.url.origin) {
    throw new HttpError(403, "Cross-origin WebSocket rejected");
  }

  const user = requireUser(context.user);
  const role = await getMapRole(context.env, context.params.mapId, user.id);
  const headers = new Headers(context.request.headers);
  headers.set("x-pinboard-user-id", user.id);
  headers.set("x-pinboard-map-role", role);
  headers.set("x-pinboard-display-name", encodeURIComponent(user.displayName ?? ""));
  headers.set("x-pinboard-avatar-url", encodeURIComponent(user.avatarUrl ?? ""));

  const room = context.env.MAP_COLLABORATION.getByName(context.params.mapId);
  return room.fetch(new Request(context.request, { headers }));
}
