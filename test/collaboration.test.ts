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

async function connectPublic(publicToken: string, guestId: string): Promise<WebSocket> {
  const response = await worker.fetch(new Request(
    `${origin}/api/public/maps/${publicToken}/collaboration?guestId=${guestId}`,
    { headers: { origin, upgrade: "websocket" } },
  ), env);
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

function nextClose(socket: WebSocket): Promise<CloseEvent> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for collaboration socket close")), 1_000);
    socket.addEventListener("close", (event) => {
      clearTimeout(timeout);
      resolve(event);
    }, { once: true });
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

  it("includes public-link guests as read-only collaborators and disconnects them when revoked", async () => {
    await seedUser("public-owner", "public-owner@example.com", "Polly Owner", "public-owner-token");
    const now = Date.now();
    await env.DB.prepare(
      `INSERT INTO maps (id, owner_user_id, title, public_token, created_at, updated_at)
       VALUES ('public-live-map', 'public-owner', 'Public live', 'public-live-token', ?, ?)`,
    ).bind(now, now).run();

    const owner = await connect("public-live-map", "public-owner-token");
    await nextMessage(owner);
    await nextMessage(owner);

    const ownerSeesGuest = nextMessage(owner);
    const guestId = "123e4567-e89b-42d3-a456-426614174000";
    const guest = await connectPublic("public-live-token", guestId);
    expect(await nextMessage(guest)).toMatchObject({
      type: "ready",
      selfUserId: `guest:${guestId}`,
      users: expect.arrayContaining([
        expect.objectContaining({ userId: "public-owner", isAnonymous: false }),
        expect.objectContaining({
          userId: `guest:${guestId}`,
          displayName: "Guest 123E",
          role: "viewer",
          isAnonymous: true,
        }),
      ]),
    });
    await nextMessage(guest);
    expect(await ownerSeesGuest).toMatchObject({
      type: "presence",
      users: expect.arrayContaining([expect.objectContaining({ userId: `guest:${guestId}` })]),
    });

    const guestSeesCursor = nextMessage(guest);
    owner.send(JSON.stringify({ type: "cursor", lat: 40.7128, lng: -74.006 }));
    expect(await guestSeesCursor).toEqual({
      type: "cursor",
      cursor: { userId: "public-owner", lat: 40.7128, lng: -74.006 },
    });

    const ownerCanFollowGuest = nextMessage(owner);
    guest.send(JSON.stringify({
      type: "viewport",
      center: { lat: 35.6762, lng: 139.6503 },
      zoom: 11,
    }));
    expect(await ownerCanFollowGuest).toEqual({
      type: "viewport",
      viewport: {
        userId: `guest:${guestId}`,
        center: { lat: 35.6762, lng: 139.6503 },
        zoom: 11,
      },
    });

    const guestGetsUpdate = nextMessage(guest);
    const ownerGetsUpdate = nextMessage(owner);
    const created = await worker.fetch(new Request(`${origin}/api/maps/public-live-map/places`, {
      method: "POST",
      headers: {
        cookie: "own_maps_session=public-owner-token",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        placeId: "ChIJ-public-live",
        displayName: "Live public place",
        lat: 51.5,
        lng: -0.12,
      }),
    }), env);
    expect(created.status).toBe(201);
    expect(await guestGetsUpdate).toMatchObject({ type: "data_changed", revision: 1 });
    await ownerGetsUpdate;

    const anonymousWrite = await worker.fetch(new Request(`${origin}/api/maps/public-live-map/places`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ placeId: "ChIJ-no", displayName: "No", lat: 1, lng: 1 }),
    }), env);
    expect(anonymousWrite.status).toBe(401);

    const guestClosed = nextClose(guest);
    const revoked = await worker.fetch(new Request(`${origin}/api/maps/public-live-map`, {
      method: "PATCH",
      headers: {
        cookie: "own_maps_session=public-owner-token",
        origin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ publicAccess: false }),
    }), env);
    expect(revoked.status).toBe(200);
    expect((await guestClosed).code).toBe(1008);

    const reconnect = await worker.fetch(new Request(
      `${origin}/api/public/maps/public-live-token/collaboration?guestId=${crypto.randomUUID()}`,
      { headers: { origin, upgrade: "websocket" } },
    ), env);
    expect(reconnect.status).toBe(404);
    expect(reconnect.webSocket).toBeNull();
    owner.close(1000, "done");
  });
});
