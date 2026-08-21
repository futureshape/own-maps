import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import type { CollaborationServerMessage } from "../src/shared/types";
import worker from "../src/worker";
import { hashSessionToken } from "../src/worker/security";

const origin = "https://maps.example.test";

async function resetDb() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM sessions"),
    env.DB.prepare("DELETE FROM map_invites"),
    env.DB.prepare("DELETE FROM map_members"),
    env.DB.prepare("DELETE FROM map_places"),
    env.DB.prepare("DELETE FROM categories"),
    env.DB.prepare("DELETE FROM maps"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

async function seedUser(id: string, email: string, name: string, token: string) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(id, `google-${id}`, email, name, now, now),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(await hashSessionToken(token), id, now + 60_000, now),
  ]);
}

async function connect(mapId: string, token: string): Promise<WebSocket> {
  const response = await worker.fetch(new Request(`${origin}/api/maps/${mapId}/collaboration`, {
    headers: {
      cookie: `own_maps_session=${token}`,
      origin,
      upgrade: "websocket",
    },
  }), env);
  expect(response.status).toBe(101);
  expect(response.webSocket).not.toBeNull();
  const socket = response.webSocket!;
  socket.accept();
  return socket;
}

function nextMessage(socket: WebSocket): Promise<CollaborationServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for collaboration message")), 1_000);
    socket.addEventListener("message", (event) => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)) as CollaborationServerMessage);
    }, { once: true });
  });
}

function nextMessages(socket: WebSocket, count: number): Promise<CollaborationServerMessage[]> {
  return new Promise((resolve, reject) => {
    const messages: CollaborationServerMessage[] = [];
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for collaboration messages")), 1_000);
    const onMessage = (event: MessageEvent) => {
      messages.push(JSON.parse(String(event.data)) as CollaborationServerMessage);
      if (messages.length < count) return;
      clearTimeout(timeout);
      socket.removeEventListener("message", onMessage);
      resolve(messages);
    };
    socket.addEventListener("message", onMessage);
  });
}

describe("map collaboration Durable Object", () => {
  beforeEach(resetDb);

  it("shares presence, cursors, viewports, and authoritative data-change signals", async () => {
    await seedUser("owner", "owner@example.com", "Olivia Owner", "owner-token");
    await seedUser("editor", "editor@example.com", "Eddie Editor", "editor-token");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('live-map', 'owner', 'Live', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO map_members (map_id, user_id, role) VALUES ('live-map', 'editor', 'editor')",
      ),
    ]);

    const owner = await connect("live-map", "owner-token");
    expect(await nextMessage(owner)).toMatchObject({
      type: "ready",
      selfUserId: "owner",
      users: [{ userId: "owner", displayName: "Olivia Owner", role: "owner" }],
    });
    await nextMessage(owner);

    const ownerSeesEditor = nextMessage(owner);
    const editor = await connect("live-map", "editor-token");
    expect(await nextMessage(editor)).toMatchObject({
      type: "ready",
      selfUserId: "editor",
      users: expect.arrayContaining([
        expect.objectContaining({ userId: "owner" }),
        expect.objectContaining({ userId: "editor", role: "editor" }),
      ]),
    });
    await nextMessage(editor);
    expect(await ownerSeesEditor).toMatchObject({
      type: "presence",
      users: expect.arrayContaining([expect.objectContaining({ userId: "editor" })]),
    });

    const cursorForEditor = nextMessage(editor);
    owner.send(JSON.stringify({ type: "cursor", lat: 51.5074, lng: -0.1278 }));
    expect(await cursorForEditor).toEqual({
      type: "cursor",
      cursor: { userId: "owner", lat: 51.5074, lng: -0.1278 },
    });

    const viewportForOwner = nextMessage(owner);
    editor.send(JSON.stringify({
      type: "viewport",
      center: { lat: 48.8566, lng: 2.3522 },
      zoom: 13,
    }));
    expect(await viewportForOwner).toEqual({
      type: "viewport",
      viewport: { userId: "editor", center: { lat: 48.8566, lng: 2.3522 }, zoom: 13 },
    });

    const ownerChanged = nextMessage(owner);
    const editorChanged = nextMessage(editor);
    const created = await worker.fetch(new Request(`${origin}/api/maps/live-map/places`, {
      method: "POST",
      headers: {
        cookie: "own_maps_session=editor-token",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        placeId: "ChIJ-live",
        displayName: "Shared place",
        lat: 51.5,
        lng: -0.12,
      }),
    }), env);
    expect(created.status).toBe(201);
    expect(await ownerChanged).toMatchObject({ type: "data_changed", revision: 1 });
    expect(await editorChanged).toMatchObject({ type: "data_changed", revision: 1 });

    const ownerUpdates = nextMessages(owner, 2);
    const editorUpdates = nextMessages(editor, 2);
    const mutationHeaders = (token: string) => ({
      cookie: `own_maps_session=${token}`,
      origin,
      "content-type": "application/json",
    });
    const [noteUpdate, orderUpdate] = await Promise.all([
      worker.fetch(new Request(`${origin}/api/maps/live-map/places/ChIJ-live`, {
        method: "PATCH",
        headers: mutationHeaders("owner-token"),
        body: JSON.stringify({ note: "Meet by the window" }),
      }), env),
      worker.fetch(new Request(`${origin}/api/maps/live-map/places/ChIJ-live`, {
        method: "PATCH",
        headers: mutationHeaders("editor-token"),
        body: JSON.stringify({ sortOrder: 7 }),
      }), env),
    ]);
    expect([noteUpdate.status, orderUpdate.status]).toEqual([200, 200]);
    const revisions = (await ownerUpdates).map((message) =>
      message.type === "data_changed" ? message.revision : -1
    ).sort();
    expect(revisions).toEqual([2, 3]);
    await editorUpdates;

    const snapshot = await worker.fetch(new Request(`${origin}/api/maps/live-map`, {
      headers: { cookie: "own_maps_session=owner-token", origin },
    }), env);
    expect(await snapshot.json()).toMatchObject({
      places: [{ placeId: "ChIJ-live", note: "Meet by the window", sortOrder: 7 }],
    });

    owner.close(1000, "done");
    editor.close(1000, "done");
  });

  it("rejects collaboration sockets for people without map membership", async () => {
    await seedUser("outsider", "outsider@example.com", "Otto Outsider", "outsider-token");
    await seedUser("owner", "owner@example.com", "Olivia Owner", "owner-token");
    const now = Date.now();
    await env.DB.prepare(
      "INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('private-map', 'owner', 'Private', ?, ?)",
    ).bind(now, now).run();

    const response = await worker.fetch(new Request(`${origin}/api/maps/private-map/collaboration`, {
      headers: { cookie: "own_maps_session=outsider-token", origin, upgrade: "websocket" },
    }), env);
    expect(response.status).toBe(404);
    expect(response.webSocket).toBeNull();
  });
});
