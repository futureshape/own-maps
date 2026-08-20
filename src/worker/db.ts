import type { MapRole } from "../shared/types";
import { HttpError } from "./http";
import type { AuthUser, Env } from "./types";

type UserRow = {
  id: string;
  email: string;
  display_name: string | null;
  avatar_url: string | null;
};

export function userFromRow(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    avatarUrl: row.avatar_url,
  };
}

export async function getMapRole(env: Env, mapId: string, userId: string): Promise<MapRole> {
  const row = await env.DB.prepare(
    `SELECT CASE
       WHEN maps.owner_user_id = ?2 THEN 'owner'
       ELSE map_members.role
     END AS role
     FROM maps
     LEFT JOIN map_members
       ON map_members.map_id = maps.id AND map_members.user_id = ?2
     WHERE maps.id = ?1`,
  )
    .bind(mapId, userId)
    .first<{ role: MapRole | null }>();

  if (!row?.role) throw new HttpError(404, "Map not found");
  return row.role;
}

export async function touchMap(env: Env, mapId: string): Promise<void> {
  await env.DB.prepare("UPDATE maps SET updated_at = ? WHERE id = ?")
    .bind(Date.now(), mapId)
    .run();
}

export function requireUser(user: AuthUser | undefined): AuthUser {
  if (!user) throw new HttpError(401, "Authentication required");
  return user;
}
