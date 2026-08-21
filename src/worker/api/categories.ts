import { z } from "zod";
import type { Category } from "../../shared/types";
import { publishMapDataChanged } from "../collaboration";
import { getMapRole, requireUser, touchMap } from "../db";
import { HttpError, json, noContent, parseJson } from "../http";
import { requireEdit } from "../permissions";
import { invalidateMapPublicCache } from "../public-map-cache";
import type { RequestContext } from "../types";

const markerStyle = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Marker colour must be a hex colour").nullable();
const categoryInput = z.object({
  name: z.string().trim().min(1).max(60),
  markerStyle: markerStyle.optional(),
});
const categoryUpdate = categoryInput.partial().refine((value) => Object.keys(value).length > 0, {
  message: "No changes supplied",
});

async function requireCategoryEditor(context: RequestContext): Promise<void> {
  const user = requireUser(context.user);
  requireEdit(await getMapRole(context.env, context.params.mapId, user.id));
}

export async function createCategory(context: RequestContext): Promise<Response> {
  await requireCategoryEditor(context);
  const input = await parseJson(context, categoryInput);
  const id = crypto.randomUUID();
  await context.env.DB.prepare(
    "INSERT INTO categories (id, map_id, name, marker_style) VALUES (?, ?, ?, ?)",
  )
    .bind(id, context.params.mapId, input.name, input.markerStyle ?? "#e8663d")
    .run();
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  const category: Category = { id, name: input.name, markerStyle: input.markerStyle ?? "#e8663d" };
  await publishMapDataChanged(context.env, context.params.mapId);
  return json({ category }, { status: 201 });
}

export async function updateCategory(context: RequestContext): Promise<Response> {
  await requireCategoryEditor(context);
  const input = await parseJson(context, categoryUpdate);
  const current = await context.env.DB.prepare(
    "SELECT name, marker_style FROM categories WHERE id = ? AND map_id = ?",
  )
    .bind(context.params.categoryId, context.params.mapId)
    .first<{ name: string; marker_style: string | null }>();
  if (!current) throw new HttpError(404, "Category not found");
  await context.env.DB.prepare(
    "UPDATE categories SET name = ?, marker_style = ? WHERE id = ? AND map_id = ?",
  )
    .bind(
      input.name ?? current.name,
      input.markerStyle === undefined ? current.marker_style : input.markerStyle,
      context.params.categoryId,
      context.params.mapId,
    )
    .run();
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  await publishMapDataChanged(context.env, context.params.mapId);
  return json({ ok: true });
}

export async function deleteCategory(context: RequestContext): Promise<Response> {
  await requireCategoryEditor(context);
  const result = await context.env.DB.prepare("DELETE FROM categories WHERE id = ? AND map_id = ?")
    .bind(context.params.categoryId, context.params.mapId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, "Category not found");
  await touchMap(context.env, context.params.mapId);
  await invalidateMapPublicCache(context, context.params.mapId);
  await publishMapDataChanged(context.env, context.params.mapId);
  return noContent();
}
