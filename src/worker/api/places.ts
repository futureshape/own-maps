import { z } from "zod";
import type { SavedPlace } from "../../shared/types";
import { getMapRole, requireUser, touchMap } from "../db";
import { HttpError, json, noContent, parseJson } from "../http";
import { requireEdit } from "../permissions";
import { invalidateMapPublicCache } from "../public-map-cache";
import type { RequestContext } from "../types";

const categoryId = z.string().uuid().nullable();
const createPlaceInput = z.object({
  placeId: z.string().trim().min(1).max(300),
  displayName: z.string().trim().min(1).max(300),
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  categoryId: categoryId.optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});

const updatePlaceInput = z
  .object({
    displayName: z.string().trim().min(1).max(300).optional(),
    categoryId: categoryId.optional(),
    note: z.string().trim().max(2000).nullable().optional(),
    sortOrder: z.number().int().min(0).max(1_000_000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: "No changes supplied" });

async function assertCategory(context: RequestContext, category: string | null | undefined): Promise<void> {
  if (!category) return;
  const row = await context.env.DB.prepare("SELECT 1 FROM categories WHERE id = ? AND map_id = ?")
    .bind(category, context.params.mapId)
    .first();
  if (!row) throw new HttpError(400, "Category does not belong to this map");
}

export async function createPlace(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  requireEdit(await getMapRole(context.env, context.params.mapId, user.id));
  const input = await parseJson(context, createPlaceInput);
  await assertCategory(context, input.categoryId);
  const id = crypto.randomUUID();
  const now = Date.now();
  await context.env.DB.prepare(
    `INSERT INTO map_places
       (id, map_id, place_id, display_name, lat, lng, category_id, note, sort_order, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
  )
    .bind(
      id,
      context.params.mapId,
      input.placeId,
      input.displayName,
      input.lat,
      input.lng,
      input.categoryId ?? null,
      input.note ?? null,
      now,
    )
    .run();
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  const place: SavedPlace = {
    id,
    placeId: input.placeId,
    displayName: input.displayName,
    lat: input.lat,
    lng: input.lng,
    categoryId: input.categoryId ?? null,
    note: input.note ?? null,
    sortOrder: null,
    createdAt: now,
  };
  return json({ place }, { status: 201 });
}

export async function updatePlace(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  requireEdit(await getMapRole(context.env, context.params.mapId, user.id));
  const input = await parseJson(context, updatePlaceInput);
  await assertCategory(context, input.categoryId);
  const current = await context.env.DB.prepare(
    "SELECT display_name, category_id, note, sort_order FROM map_places WHERE map_id = ? AND place_id = ?",
  )
    .bind(context.params.mapId, context.params.placeId)
    .first<{ display_name: string | null; category_id: string | null; note: string | null; sort_order: number | null }>();
  if (!current) throw new HttpError(404, "Saved place not found");
  await context.env.DB.prepare(
    `UPDATE map_places SET display_name = ?, category_id = ?, note = ?, sort_order = ?
     WHERE map_id = ? AND place_id = ?`,
  )
    .bind(
      input.displayName === undefined ? current.display_name : input.displayName,
      input.categoryId === undefined ? current.category_id : input.categoryId,
      input.note === undefined ? current.note : input.note,
      input.sortOrder === undefined ? current.sort_order : input.sortOrder,
      context.params.mapId,
      context.params.placeId,
    )
    .run();
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  return json({ ok: true });
}

export async function deletePlace(context: RequestContext): Promise<Response> {
  const user = requireUser(context.user);
  requireEdit(await getMapRole(context.env, context.params.mapId, user.id));
  const result = await context.env.DB.prepare(
    "DELETE FROM map_places WHERE map_id = ? AND place_id = ?",
  )
    .bind(context.params.mapId, context.params.placeId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Saved place not found");
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  return noContent();
}
