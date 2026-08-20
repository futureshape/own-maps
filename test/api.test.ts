import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import worker from "../src/worker";
import { upsertGoogleUser } from "../src/worker/api/auth";
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

async function seedUser(id: string, email: string, token: string, expiresAt = Date.now() + 60_000) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO users (id, google_sub, email, created_at, last_login_at) VALUES (?, ?, ?, ?, ?)",
    ).bind(id, `google-${id}`, email, now, now),
    env.DB.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).bind(await hashSessionToken(token), id, expiresAt, now),
  ]);
}

async function call(path: string, token: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  headers.set("cookie", `own_maps_session=${token}`);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

async function callAnonymous(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("origin", origin);
  if (init.body) headers.set("content-type", "application/json");
  return worker.fetch(new Request(`${origin}${path}`, { ...init, headers }), env);
}

describe("map API authorization and saved marker data", () => {
  beforeEach(resetDb);

  it("enforces viewer/editor permissions and returns stored marker coordinates", async () => {
    await seedUser("owner", "owner@example.com", "owner-token");
    await seedUser("editor", "editor@example.com", "editor-token");
    await seedUser("viewer", "viewer@example.com", "viewer-token");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('map-1', 'owner', 'London', ?, ?)",
      ).bind(now, now),
      env.DB.prepare("INSERT INTO map_members (map_id, user_id, role) VALUES ('map-1', 'editor', 'editor')"),
      env.DB.prepare("INSERT INTO map_members (map_id, user_id, role) VALUES ('map-1', 'viewer', 'viewer')"),
    ]);

    const denied = await call("/api/maps/map-1/places", "viewer-token", {
      method: "POST",
      body: JSON.stringify({ placeId: "ChIJ-viewer", displayName: "Viewer Place", lat: 51.5, lng: -0.12 }),
    });
    expect(denied.status).toBe(403);

    const created = await call("/api/maps/map-1/places", "editor-token", {
      method: "POST",
      body: JSON.stringify({ placeId: "ChIJ-saved", displayName: "The Saved Place", lat: 51.5204, lng: -0.1042 }),
    });
    expect(created.status).toBe(201);

    const duplicate = await call("/api/maps/map-1/places", "editor-token", {
      method: "POST",
      body: JSON.stringify({ placeId: "ChIJ-saved", displayName: "Duplicate", lat: 50, lng: 0 }),
    });
    expect(duplicate.status).toBe(409);

    const loaded = await call("/api/maps/map-1", "viewer-token");
    expect(loaded.status).toBe(200);
    const body = await loaded.json() as any;
    expect(body.map.role).toBe("viewer");
    expect(body.places).toEqual([
      expect.objectContaining({ placeId: "ChIJ-saved", displayName: "The Saved Place", lat: 51.5204, lng: -0.1042 }),
    ]);
  });

  it("rejects expired sessions and invalid mutation origins", async () => {
    await seedUser("expired", "expired@example.com", "expired-token", Date.now() - 1);
    expect((await call("/api/me", "expired-token")).status).toBe(401);

    await seedUser("active", "active@example.com", "active-token");
    const response = await worker.fetch(
      new Request(`${origin}/api/maps`, {
        method: "POST",
        headers: { origin: "https://evil.example", cookie: "own_maps_session=active-token", "content-type": "application/json" },
        body: JSON.stringify({ title: "Nope" }),
      }),
      env,
    );
    expect(response.status).toBe(403);
  });

  it("creates a revocable anonymous read-only link that only the owner can manage", async () => {
    await seedUser("owner", "owner@example.com", "owner-token");
    await seedUser("editor", "editor@example.com", "editor-token");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('public-map', 'owner', 'Public London', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        "INSERT INTO map_members (map_id, user_id, role) VALUES ('public-map', 'editor', 'editor')",
      ),
      env.DB.prepare(
        `INSERT INTO map_places
           (id, map_id, place_id, display_name, lat, lng, note, created_at)
         VALUES ('public-place', 'public-map', 'ChIJ-public', 'Public Place', 51.5, -0.12, 'Worth a visit', ?)`,
      ).bind(now),
    ]);

    const editorDenied = await call("/api/maps/public-map", "editor-token", {
      method: "PATCH",
      body: JSON.stringify({ publicAccess: true }),
    });
    expect(editorDenied.status).toBe(403);

    const enabled = await call("/api/maps/public-map", "owner-token", {
      method: "PATCH",
      body: JSON.stringify({ publicAccess: true }),
    });
    expect(enabled.status).toBe(200);
    const { publicToken } = await enabled.json<{ publicToken: string }>();
    expect(publicToken).toMatch(/^[0-9a-f-]{36}$/);

    const publicRead = await callAnonymous(`/api/public/maps/${publicToken}`);
    expect(publicRead.status).toBe(200);
    expect(publicRead.headers.get("cache-control")).toBe("public, max-age=0, s-maxage=30");
    expect(await publicRead.json()).toMatchObject({
      map: { id: "public-map", role: "viewer", publicAccess: true },
      places: [{ placeId: "ChIJ-public", displayName: "Public Place", note: "Worth a visit" }],
      publicToken: null,
      publicView: true,
    });
    const publicPageHead = await callAnonymous(`/public/${publicToken}`, { method: "HEAD" });
    expect(publicPageHead.status).toBe(200);
    expect(publicPageHead.headers.get("content-type")).toBe("text/html; charset=utf-8");
    const previewHead = await callAnonymous(`/public/${publicToken}/preview.png`, { method: "HEAD" });
    expect(previewHead.status).toBe(200);
    expect(previewHead.headers.get("content-type")).toBe("image/png");

    const renamed = await call("/api/maps/public-map", "owner-token", {
      method: "PATCH",
      body: JSON.stringify({ title: "Renamed public map" }),
    });
    expect(renamed.status).toBe(200);
    expect(await (await callAnonymous(`/api/public/maps/${publicToken}`)).json()).toMatchObject({
      map: { title: "Renamed public map" },
    });

    const addedAfterCache = await call("/api/maps/public-map/places", "owner-token", {
      method: "POST",
      body: JSON.stringify({
        placeId: "ChIJ-after-cache",
        displayName: "Added after cache",
        lat: 51.51,
        lng: -0.13,
      }),
    });
    expect(addedAfterCache.status).toBe(201);
    expect(await (await callAnonymous(`/api/public/maps/${publicToken}`)).json()).toMatchObject({
      places: expect.arrayContaining([
        expect.objectContaining({ placeId: "ChIJ-after-cache", displayName: "Added after cache" }),
      ]),
    });

    const anonymousWrite = await callAnonymous("/api/maps/public-map/places", {
      method: "POST",
      body: JSON.stringify({ placeId: "ChIJ-nope", displayName: "Nope", lat: 1, lng: 2 }),
    });
    expect(anonymousWrite.status).toBe(401);

    const disabled = await call("/api/maps/public-map", "owner-token", {
      method: "PATCH",
      body: JSON.stringify({ publicAccess: false }),
    });
    expect(await disabled.json()).toMatchObject({ publicToken: null });
    expect((await callAnonymous(`/api/public/maps/${publicToken}`)).status).toBe(404);
    expect((await callAnonymous(`/public/${publicToken}`, { method: "HEAD" })).status).toBe(404);

    const reenabled = await call("/api/maps/public-map", "owner-token", {
      method: "PATCH",
      body: JSON.stringify({ publicAccess: true }),
    });
    const next = await reenabled.json<{ publicToken: string }>();
    expect(next.publicToken).not.toBe(publicToken);
  });

  it("invalidates sessions on logout", async () => {
    await seedUser("person", "person@example.com", "person-token");
    const logout = await call("/api/auth/logout", "person-token", { method: "POST" });
    expect(logout.status).toBe(204);
    expect((await call("/api/me", "person-token")).status).toBe(401);
  });

  it("matches pending invites to the verified Google email", async () => {
    await seedUser("owner", "owner@example.com", "owner-token");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('shared-map', 'owner', 'Shared', ?, ?)",
      ).bind(now, now),
      env.DB.prepare(
        `INSERT INTO map_invites (id, map_id, email, role, invited_by_user_id, created_at)
         VALUES ('invite-1', 'shared-map', 'new@example.com', 'editor', 'owner', ?)`,
      ).bind(now),
    ]);
    const user = await upsertGoogleUser(
      { request: new Request(`${origin}/api/auth/google`), env, url: new URL(origin), params: {} },
      { sub: "new-google-sub", email: "new@example.com", name: "New User", picture: null },
    );
    expect(await env.DB.prepare(
      "SELECT role FROM map_members WHERE map_id = 'shared-map' AND user_id = ?",
    ).bind(user.id).first<{ role: string }>()).toEqual({ role: "editor" });
    expect((await env.DB.prepare("SELECT accepted_at FROM map_invites WHERE id = 'invite-1'").first<{ accepted_at: number }>())?.accepted_at).toBeTypeOf("number");
  });

  it("cascades saved places, categories, members, and invites when an owner deletes a map", async () => {
    await seedUser("owner", "owner@example.com", "owner-token");
    await seedUser("viewer", "viewer@example.com", "viewer-token");
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO maps (id, owner_user_id, title, created_at, updated_at) VALUES ('doomed', 'owner', 'Doomed', ?, ?)").bind(now, now),
      env.DB.prepare("INSERT INTO map_members (map_id, user_id, role) VALUES ('doomed', 'viewer', 'viewer')"),
      env.DB.prepare("INSERT INTO categories (id, map_id, name) VALUES ('category-1', 'doomed', 'Food')"),
      env.DB.prepare("INSERT INTO map_places (id, map_id, place_id, lat, lng, category_id, created_at) VALUES ('place-1', 'doomed', 'ChIJ-x', 1, 2, 'category-1', ?)").bind(now),
      env.DB.prepare("INSERT INTO map_invites (id, map_id, email, role, invited_by_user_id, created_at) VALUES ('invite-1', 'doomed', 'later@example.com', 'viewer', 'owner', ?)").bind(now),
    ]);
    expect((await call("/api/maps/doomed", "owner-token", { method: "DELETE" })).status).toBe(204);
    for (const table of ["map_places", "categories", "map_members", "map_invites"]) {
      const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
      expect(row?.count).toBe(0);
    }
  });
});
