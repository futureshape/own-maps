import { z } from "zod";
import { userFromRow } from "../db";
import { HttpError, json, noContent, parseJson } from "../http";
import {
  clearSessionCookie,
  createSessionToken,
  hashSessionToken,
  SESSION_MAX_AGE_SECONDS,
  sessionCookie,
} from "../security";
import type { RequestContext } from "../types";
import { verifyGoogleCredential, type GoogleIdentity } from "../auth/google";

const loginSchema = z.object({
  credential: z.string().min(100).max(10000),
});

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

export async function upsertGoogleUser(
  context: RequestContext,
  identity: GoogleIdentity,
): Promise<UserRow> {
  const now = Date.now();
  const existing = await context.env.DB.prepare(
    "SELECT id, email, display_name, avatar_url FROM users WHERE google_sub = ?",
  )
    .bind(identity.sub)
    .first<UserRow>();

  const userId = existing?.id ?? crypto.randomUUID();
  if (existing) {
    await context.env.DB.prepare(
      `UPDATE users SET email = ?, display_name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?`,
    )
      .bind(identity.email, identity.name, identity.picture, now, userId)
      .run();
  } else {
    await context.env.DB.prepare(
      `INSERT INTO users (id, google_sub, email, display_name, avatar_url, created_at, last_login_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(userId, identity.sub, identity.email, identity.name, identity.picture, now, now)
      .run();
  }

  const invites = await context.env.DB.prepare(
    `SELECT id, map_id, role FROM map_invites
     WHERE email = ? AND accepted_at IS NULL`,
  )
    .bind(identity.email)
    .all<{ id: string; map_id: string; role: string }>();

  if (invites.results.length) {
    const statements: D1PreparedStatement[] = [];
    for (const invite of invites.results) {
      statements.push(
        context.env.DB.prepare(
          `INSERT INTO map_members (map_id, user_id, role) VALUES (?, ?, ?)
           ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
        ).bind(invite.map_id, userId, invite.role),
        context.env.DB.prepare("UPDATE map_invites SET accepted_at = ? WHERE id = ?").bind(now, invite.id),
      );
    }
    await context.env.DB.batch(statements);
  }

  return {
    id: userId,
    email: identity.email,
    display_name: identity.name,
    avatar_url: identity.picture,
  };
}

export async function login(context: RequestContext): Promise<Response> {
  if (!context.env.GOOGLE_CLIENT_ID) throw new HttpError(503, "Google login is not configured");
  const { credential } = await parseJson(context, loginSchema);
  const identity = await verifyGoogleCredential(credential, context.env.GOOGLE_CLIENT_ID);
  const row = await upsertGoogleUser(context, identity);
  const token = createSessionToken();
  const tokenHash = await hashSessionToken(token);
  const now = Date.now();
  await context.env.DB.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  )
    .bind(tokenHash, row.id, now + SESSION_MAX_AGE_SECONDS * 1000, now)
    .run();

  const secure = context.env.APP_ENV !== "development" || context.url.protocol === "https:";
  return json(
    { user: userFromRow(row) },
    { headers: { "set-cookie": sessionCookie(token, secure) } },
  );
}

export async function logout(context: RequestContext): Promise<Response> {
  if (context.sessionHash) {
    await context.env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?")
      .bind(context.sessionHash)
      .run();
  }
  const secure = context.env.APP_ENV !== "development" || context.url.protocol === "https:";
  return noContent({ headers: { "set-cookie": clearSessionCookie(secure) } });
}

export async function me(context: RequestContext): Promise<Response> {
  if (!context.user) throw new HttpError(401, "Authentication required");
  return json({ user: context.user });
}
