import { z } from "zod";
import type { Category, MapDetail, MapRole, MapSummary, SavedPlace } from "../../shared/types";
import { getMapRole, requireUser } from "../db";
import { HttpError, json, noContent, parseJson } from "../http";
import { requireOwner } from "../permissions";
import type { RequestContext } from "../types";

const mapInput = z.object({
  title: z.string().trim().min(1, "A title is required").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
});

const mapUpdate = mapInput
  .extend({ publicAccess: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, {
    message: "No changes supplied",
  });

type MapRow = {
  id: string;
  title: string;
  description: string | null;
  role: MapRole;
  public_token: string | null;
  place_count: number;
  updated_at: number;
};

function mapFromRow(row: MapRow): MapSummary {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    role: row.role,
    publicAccess: row.public_token !== null,
    placeCount: row.place_count,
    updatedAt: row.updated_at,
  };
}

export async function listMaps(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  const result = await context.env.DB.prepare(
    `SELECT maps.id, maps.title, maps.description, maps.public_token,
            CASE WHEN maps.owner_user_id = ?1 THEN 'owner' ELSE map_members.role END AS role,
            COUNT(map_places.id) AS place_count, maps.updated_at
     FROM maps
     LEFT JOIN map_members ON map_members.map_id = maps.id AND map_members.user_id = ?1
     LEFT JOIN map_places ON map_places.map_id = maps.id
     WHERE maps.owner_user_id = ?1 OR map_members.user_id = ?1
     GROUP BY maps.id
     ORDER BY maps.updated_at DESC`,
  )
    .bind(user.id)
    .all<MapRow>();
  return json({ maps: result.results.map(mapFromRow) });
}

export async function createMap(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  const input = await parseJson(context, mapInput);
  const id = crypto.randomUUID();
  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO maps (id, owner_user_id, title, description, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, input.title, input.description ?? null, now, now)
    .run();
  return json(
    {
      map: {
        id,
        title: input.title,
        description: input.description ?? null,
        role: "owner",
        publicAccess: false,
        placeCount: 0,
        updatedAt: now,
      } satisfies MapSummary,
    },
    { status: 201 },
  );
}

async function mapDetailResponse(
  context: RequestContext,
  mapId: string,
  role: MapRole,
  publicView: boolean,
): Promise<Response> {
  const mapRow = await context.env.DB.prepare(
    `SELECT id, title, description, public_token, updated_at,
            (SELECT COUNT(*) FROM map_places WHERE map_id = maps.id) AS place_count
     FROM maps WHERE id = ?`,
  )
    .bind(mapId)
    .first<Omit<MapRow, "role">>();
  if (!mapRow) throw new HttpError(404, "Map not found");

  const [categoryRows, placeRows] = await Promise.all([
    context.env.DB.prepare(
      "SELECT id, name, marker_style FROM categories WHERE map_id = ? ORDER BY name COLLATE NOCASE",
    )
      .bind(mapId)
      .all<{ id: string; name: string; marker_style: string | null }>(),
    context.env.DB.prepare(
      `SELECT id, place_id, display_name, lat, lng, category_id, note, sort_order, created_at
       FROM map_places WHERE map_id = ? ORDER BY COALESCE(sort_order, 2147483647), created_at`,
    )
      .bind(mapId)
      .all<{
        id: string;
        place_id: string;
        display_name: string | null;
        lat: number;
        lng: number;
        category_id: string | null;
        note: string | null;
        sort_order: number | null;
        created_at: number;
      }>(),
  ]);

  const detail: MapDetail = {
    map: mapFromRow({ ...mapRow, role }),
    categories: categoryRows.results.map(
      (row): Category => ({ id: row.id, name: row.name, markerStyle: row.marker_style }),
    ),
    places: placeRows.results.map(
      (row): SavedPlace => ({
        id: row.id,
        placeId: row.place_id,
        displayName: row.display_name,
        lat: row.lat,
        lng: row.lng,
        categoryId: row.category_id,
        note: row.note,
        sortOrder: row.sort_order,
        createdAt: row.created_at,
      }),
    ),
    publicToken: role === "owner" && !publicView ? mapRow.public_token : null,
    publicView,
  };
  return json(detail);
}

export async function getMap(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  const mapId = context.params.mapId;
  const role = await getMapRole(context.env, mapId, user.id);
  return mapDetailResponse(context, mapId, role, false);
}

export async function getPublicMap(context: RequestContext): Promise<Response> {
  const row = await context.env.DB.prepare("SELECT id FROM maps WHERE public_token = ?")
    .bind(context.params.publicToken)
    .first<{ id: string }>();
  if (!row) throw new HttpError(404, "Public map not found");
  return mapDetailResponse(context, row.id, "viewer", true);
}

export async function updateMap(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  const role = await getMapRole(context.env, context.params.mapId, user.id);
  requireOwner(role);
  const input = await parseJson(context, mapUpdate);
  const current = await context.env.DB.prepare(
    "SELECT title, description, public_token FROM maps WHERE id = ?",
  )
    .bind(context.params.mapId)
    .first<{ title: string; description: string | null; public_token: string | null }>();
  if (!current) throw new HttpError(404, "Map not found");
  const publicToken = input.publicAccess === undefined
    ? current.public_token
    : input.publicAccess
      ? current.public_token ?? crypto.randomUUID()
      : null;
  await context.env.DB.prepare(
    "UPDATE maps SET title = ?, description = ?, public_token = ?, updated_at = ? WHERE id = ?",
  )
    .bind(
      input.title ?? current.title,
      input.description === undefined ? current.description : input.description,
      publicToken,
      Date.now(),
      context.params.mapId,
    )
    .run();
  return json({ ok: true, publicToken });
}

export async function deleteMap(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  const role = await getMapRole(context.env, context.params.mapId, user.id);
  requireOwner(role);
  await context.env.DB.prepare("DELETE FROM maps WHERE id = ?").bind(context.params.mapId).run();
  return noContent();
}
