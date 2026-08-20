import { hashSessionToken, readCookie, SESSION_COOKIE } from "../security";
import type { AuthUser, Env } from "../types";
import { userFromRow } from "../db";

type SessionRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

export async function authenticate(
  request: Request,
  env: Env,
): Promise<{ user?: AuthUser; sessionHash?: string }> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return {};
  const sessionHash = await hashSessionToken(token);
  const now = Date.now();
  const row = await env.DB.prepare(
    `SELECT users.id, users.email, users.display_name, users.avatar_url
     FROM sessions JOIN users ON users.id = sessions.user_id
     WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
  )
    .bind(sessionHash, now)
    .first<SessionRow>();
  if (!row) return { sessionHash };
  return { user: userFromRow(row), sessionHash };
}
