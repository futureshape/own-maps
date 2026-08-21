import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import type {
  CollaborationServerMessage,
  CollaborationUser,
  MapRole,
} from "../shared/types";
import type { Env } from "./types";

type ConnectionAttachment = CollaborationUser & {
  sessionId: string;
};

const cursorMessage = z.object({
  type: z.literal("cursor"),
  lat: z.number().finite().min(-90).max(90).nullable(),
  lng: z.number().finite().min(-180).max(180).nullable(),
});

const viewportMessage = z.object({
  type: z.literal("viewport"),
  center: z.object({
    lat: z.number().finite().min(-90).max(90),
    lng: z.number().finite().min(-180).max(180),
  }),
  zoom: z.number().finite().min(0).max(30),
});

const clientMessage = z.discriminatedUnion("type", [cursorMessage, viewportMessage]);

function attachmentFrom(ws: WebSocket): ConnectionAttachment | null {
  const value: unknown = ws.deserializeAttachment();
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ConnectionAttachment>;
  if (
    typeof candidate.sessionId !== "string" ||
    typeof candidate.userId !== "string" ||
    !["owner", "editor", "viewer"].includes(candidate.role ?? "")
  ) return null;
  return candidate as ConnectionAttachment;
}

function decodedHeader(request: Request, name: string): string | null {
  const value = request.headers.get(name);
  if (!value) return null;
  try {
    return decodeURIComponent(value) || null;
  } catch {
    return null;
  }
}

export class MapCollaboration extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS collaboration_state (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          revision INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO collaboration_state (singleton, revision) VALUES (1, 0);
      `);
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required", { status: 426 });
    }

    const userId = request.headers.get("x-pinboard-user-id");
    const role = request.headers.get("x-pinboard-map-role") as MapRole | null;
    if (!userId || !role || !["owner", "editor", "viewer"].includes(role)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: ConnectionAttachment = {
      sessionId: crypto.randomUUID(),
      userId,
      displayName: decodedHeader(request, "x-pinboard-display-name"),
      avatarUrl: decodedHeader(request, "x-pinboard-avatar-url"),
      role,
    };

    this.ctx.acceptWebSocket(server, [`user:${userId}`]);
    server.serializeAttachment(attachment);
    this.send(server, {
      type: "ready",
      selfUserId: userId,
      users: this.activeUsers(),
      revision: this.revision(),
    });
    this.broadcastPresence();
    return new Response(null, { status: 101, webSocket: client });
  }

  async dataChanged(): Promise<number> {
    const revision = this.ctx.storage.transactionSync(() =>
      this.ctx.storage.sql.exec<{ revision: number }>(
        `UPDATE collaboration_state
         SET revision = revision + 1
         WHERE singleton = 1
         RETURNING revision`,
      ).one().revision
    );
    this.broadcast({ type: "data_changed", revision });
    return revision;
  }

  async disconnectUser(userId: string, reconnect = false): Promise<void> {
    for (const ws of this.ctx.getWebSockets(`user:${userId}`)) {
      ws.close(reconnect ? 1012 : 1008, reconnect ? "Map access changed" : "Map access was removed");
    }
    this.broadcastPresence();
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== "string" || message.length > 2_048) {
      ws.close(1009, "Invalid collaboration message");
      return;
    }
    const attachment = attachmentFrom(ws);
    if (!attachment) {
      ws.close(1008, "Missing collaboration identity");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(message);
    } catch {
      ws.close(1003, "Invalid JSON");
      return;
    }
    const result = clientMessage.safeParse(parsed);
    if (!result.success) return;

    if (result.data.type === "cursor") {
      const cursor = result.data.lat === null || result.data.lng === null
        ? { userId: attachment.userId, lat: null, lng: null } as const
        : { userId: attachment.userId, lat: result.data.lat, lng: result.data.lng };
      this.broadcast({ type: "cursor", cursor }, ws);
      return;
    }

    this.broadcast({
      type: "viewport",
      viewport: {
        userId: attachment.userId,
        center: result.data.center,
        zoom: result.data.zoom,
      },
    }, ws);
  }

  webSocketClose(ws: WebSocket, code: number, reason: string): void {
    ws.close(code, reason);
    this.broadcastPresence(ws);
  }

  webSocketError(ws: WebSocket): void {
    this.broadcastPresence(ws);
  }

  private revision(): number {
    return this.ctx.storage.sql.exec<{ revision: number }>(
      "SELECT revision FROM collaboration_state WHERE singleton = 1",
    ).one().revision;
  }

  private activeUsers(exclude?: WebSocket): CollaborationUser[] {
    const users = new Map<string, CollaborationUser>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      const attachment = attachmentFrom(ws);
      if (!attachment) continue;
      users.set(attachment.userId, {
        userId: attachment.userId,
        displayName: attachment.displayName,
        avatarUrl: attachment.avatarUrl,
        role: attachment.role,
      });
    }
    return [...users.values()];
  }

  private broadcastPresence(exclude?: WebSocket): void {
    this.broadcast({ type: "presence", users: this.activeUsers(exclude) });
  }

  private broadcast(message: CollaborationServerMessage, exclude?: WebSocket): void {
    const payload = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      try {
        ws.send(payload);
      } catch (error) {
        console.error(JSON.stringify({
          message: "collaboration websocket send failed",
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    }
  }

  private send(ws: WebSocket, message: CollaborationServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
  }
}

export async function publishMapDataChanged(env: Env, mapId: string): Promise<void> {
  try {
    await env.MAP_COLLABORATION.getByName(mapId).dataChanged();
  } catch (error) {
    console.error(JSON.stringify({
      message: "collaboration data change broadcast failed",
      mapId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}
