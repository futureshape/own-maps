import { z } from "zod";
import type { Invite, MapRole, Member } from "../../shared/types";
import { getMapRole, requireUser, touchMap } from "../db";
import { HttpError, json, noContent, parseJson } from "../http";
import { requireOwner } from "../permissions";
import type { RequestContext } from "../types";

const sharedRole = z.enum(["editor", "viewer"]);
const inviteInput = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  role: sharedRole,
});
const roleInput = z.object({ role: sharedRole });

async function requireMapOwner(context: RequestContext): Promise<void> {
  const user = requireUser(context.user);
  requireOwner(await getMapRole(context.env, context.params.mapId, user.id));
}

export async function listSharing(context: RequestContext): Promise<Response> {
  await requireMapOwner(context);
  const [owner, memberRows, inviteRows] = await Promise.all([
    context.env.DB.prepare(
      `SELECT users.id AS user_id, users.email, users.display_name, users.avatar_url
       FROM maps JOIN users ON users.id = maps.owner_user_id WHERE maps.id = ?`,
    )
      .bind(context.params.mapId)
      .first<{ user_id: string; email: string; display_name: string | null; avatar_url: string | null }>(),
    context.env.DB.prepare(
      `SELECT users.id AS user_id, users.email, users.display_name, users.avatar_url, map_members.role
       FROM map_members JOIN users ON users.id = map_members.user_id
       WHERE map_members.map_id = ? ORDER BY users.email COLLATE NOCASE`,
    )
      .bind(context.params.mapId)
      .all<{
        user_id: string;
        email: string;
        display_name: string | null;
        avatar_url: string | null;
        role: Exclude<MapRole, "owner">;
      }>(),
    context.env.DB.prepare(
      `SELECT id, email, role, created_at FROM map_invites
       WHERE map_id = ? AND accepted_at IS NULL ORDER BY created_at DESC`,
    )
      .bind(context.params.mapId)
      .all<{ id: string; email: string; role: "editor" | "viewer"; created_at: number }>(),
  ]);
  if (!owner) throw new HttpError(404, "Map not found");
  const members: Member[] = [
    {
      userId: owner.user_id,
      email: owner.email,
      displayName: owner.display_name,
      avatarUrl: owner.avatar_url,
      role: "owner",
    },
    ...memberRows.results.map((row) => ({
      userId: row.user_id,
      email: row.email,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      role: row.role,
    })),
  ];
  const invites: Invite[] = inviteRows.results.map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
  }));
  return json({ members, invites });
}

export async function invite(context: RequestContext): Promise<Response> {
  await requireMapOwner(context);
  const inviter = requireUser(context.user);
  const input = await parseJson(context, inviteInput);
  if (input.email === inviter.email.toLowerCase()) {
    throw new HttpError(400, "You already own this map");
  }
  const existingUser = await context.env.DB.prepare("SELECT id FROM users WHERE email = ? ORDER BY created_at LIMIT 1")
    .bind(input.email)
    .first<{ id: string }>();
  if (existingUser) {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO map_members (map_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (map_id, user_id) DO UPDATE SET role = excluded.role`,
      ).bind(context.params.mapId, existingUser.id, input.role),
      context.env.DB.prepare(
        "UPDATE map_invites SET accepted_at = ? WHERE map_id = ? AND email = ? AND accepted_at IS NULL",
      ).bind(Date.now(), context.params.mapId, input.email),
    ]);
    await touchMap(context.env, context.params.mapId);
    return json({ status: "member", userId: existingUser.id }, { status: 201 });
  }

  const id = crypto.randomUUID();
  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO map_invites (id, map_id, email, role, invited_by_user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (map_id, email) WHERE accepted_at IS NULL
     DO UPDATE SET role = excluded.role, invited_by_user_id = excluded.invited_by_user_id, created_at = excluded.created_at`,
  )
    .bind(id, context.params.mapId, input.email, input.role, inviter.id, now)
    .run();
  return json({ status: "invited" }, { status: 201 });
}

export async function deleteInvite(context: RequestContext): Promise<Response> {
  await requireMapOwner(context);
  const result = await context.env.DB.prepare(
    "DELETE FROM map_invites WHERE id = ? AND map_id = ? AND accepted_at IS NULL",
  )
    .bind(context.params.inviteId, context.params.mapId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Invite not found");
  return noContent();
}

export async function updateMember(context: RequestContext): Promise<Response> {
  await requireMapOwner(context);
  const input = await parseJson(context, roleInput);
  const result = await context.env.DB.prepare(
    "UPDATE map_members SET role = ? WHERE map_id = ? AND user_id = ?",
  )
    .bind(input.role, context.params.mapId, context.params.userId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Member not found");
  await touchMap(context.env, context.params.mapId);
  return json({ ok: true });
}

export async function deleteMember(context: RequestContext): Promise<Response> {
  await requireMapOwner(context);
  const result = await context.env.DB.prepare(
    "DELETE FROM map_members WHERE map_id = ? AND user_id = ?",
  )
    .bind(context.params.mapId, context.params.userId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Member not found");
  await touchMap(context.env, context.params.mapId);
  return noContent();
}
