import { getMapRole, requireUser } from "./db";
import { HttpError } from "./http";
import { PUBLIC_MAP_CACHE_CONTROL } from "./public-map-cache";
import type { Env, RequestContext } from "./types";

type ExportFormat = "geojson" | "kml";

type ExportMapRow = {
  id: string;
  title: string;
  description: string | null;
  updated_at: number;
};

type ExportPlaceRow = {
  id: string;
  place_id: string;
  display_name: string | null;
  lat: number;
  lng: number;
  note: string | null;
  category_id: string | null;
  category_name: string | null;
  marker_style: string | null;
};

export type MapExportData = {
  title: string;
  description: string | null;
  updatedAt: number;
  places: Array<{
    id: string;
    googlePlaceId: string;
    name: string;
    lat: number;
    lng: number;
    note: string | null;
    categoryId: string | null;
    categoryName: string | null;
    markerColor: string | null;
  }>;
};

async function loadMapExportData(env: Env, map: ExportMapRow): Promise<MapExportData> {
  const rows = await env.DB.prepare(
    `SELECT map_places.id, map_places.place_id, map_places.display_name,
            map_places.lat, map_places.lng, map_places.note, map_places.category_id,
            categories.name AS category_name, categories.marker_style
     FROM map_places
     LEFT JOIN categories ON categories.id = map_places.category_id
     WHERE map_places.map_id = ?
     ORDER BY COALESCE(map_places.sort_order, 2147483647), map_places.created_at`,
  )
    .bind(map.id)
    .all<ExportPlaceRow>();

  return {
    title: map.title,
    description: map.description,
    updatedAt: map.updated_at,
    places: rows.results.map((place) => ({
      id: place.id,
      googlePlaceId: place.place_id,
      name: place.display_name ?? "Saved place",
      lat: place.lat,
      lng: place.lng,
      note: place.note,
      categoryId: place.category_id,
      categoryName: place.category_name,
      markerColor: place.marker_style,
    })),
  };
}

export function mapToGeoJson(map: MapExportData): string {
  return JSON.stringify({
    type: "FeatureCollection",
    name: map.title,
    description: map.description,
    features: map.places.map((place) => ({
      type: "Feature",
      id: place.id,
      geometry: {
        type: "Point",
        coordinates: [place.lng, place.lat],
      },
      properties: {
        name: place.name,
        description: place.note,
        category: place.categoryName,
        "marker-color": place.markerColor,
        google_place_id: place.googlePlaceId,
      },
    })),
  });
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function kmlColor(value: string | null): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(value ?? "");
  if (!match) return "ffadadb5";
  return `ff${match[3]}${match[2]}${match[1]}`.toLowerCase();
}

export function mapToKml(map: MapExportData): string {
  const groups = new Map<string, { name: string; color: string | null; places: MapExportData["places"] }>();
  for (const place of map.places) {
    const key = place.categoryId ?? "uncategorised";
    const group = groups.get(key) ?? {
      name: place.categoryName ?? "Uncategorised",
      color: place.markerColor,
      places: [],
    };
    group.places.push(place);
    groups.set(key, group);
  }

  const folders = [...groups.entries()].map(([, group], groupIndex) => {
    const styleId = `pinboard-${groupIndex}`;
    const placemarks = group.places.map((place) => {
      const extendedData = [
        `<Data name="google_place_id"><value>${escapeXml(place.googlePlaceId)}</value></Data>`,
        place.categoryName
          ? `<Data name="category"><value>${escapeXml(place.categoryName)}</value></Data>`
          : "",
      ].join("");
      return `<Placemark><name>${escapeXml(place.name)}</name>${
        place.note ? `<description>${escapeXml(place.note)}</description>` : ""
      }<styleUrl>#${styleId}</styleUrl><ExtendedData>${extendedData}</ExtendedData><Point><coordinates>${
        place.lng
      },${place.lat},0</coordinates></Point></Placemark>`;
    }).join("");
    return `<Style id="${styleId}"><IconStyle><color>${kmlColor(group.color)}</color><scale>1.1</scale><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style><Folder><name>${escapeXml(
      group.name,
    )}</name>${placemarks}</Folder>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${escapeXml(
    map.title,
  )}</name>${map.description ? `<description>${escapeXml(map.description)}</description>` : ""}${folders}</Document></kml>`;
}

function downloadName(title: string, format: ExportFormat): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80) || "map";
  return `${slug}.${format}`;
}

function exportResponse(
  context: RequestContext,
  map: MapExportData,
  format: ExportFormat,
  isPublic: boolean,
): Response {
  const headers = new Headers({
    "cache-control": isPublic ? PUBLIC_MAP_CACHE_CONTROL : "private, no-store",
    "content-disposition": `${isPublic ? "inline" : "attachment"}; filename="${downloadName(map.title, format)}"`,
    "content-type": format === "geojson"
      ? "application/geo+json; charset=utf-8"
      : "application/vnd.google-earth.kml+xml; charset=utf-8",
    etag: `"${map.updatedAt}-${format}"`,
    "last-modified": new Date(map.updatedAt).toUTCString(),
  });
  if (isPublic) {
    headers.set("access-control-allow-origin", "*");
    headers.set("x-robots-tag", "noindex");
  }
  if (context.request.headers.get("if-none-match") === headers.get("etag")) {
    return new Response(null, { status: 304, headers });
  }
  const body = context.request.method === "HEAD"
    ? null
    : format === "geojson"
      ? mapToGeoJson(map)
      : mapToKml(map);
  return new Response(body, { headers });
}

async function getPrivateExport(context: RequestContext, format: ExportFormat): Promise<Response> {
  const user = requireUser(context.user);
  const mapId = context.params.mapId;
  const [map] = await Promise.all([
    context.env.DB.prepare(
      "SELECT id, title, description, updated_at FROM maps WHERE id = ?",
    ).bind(mapId).first<ExportMapRow>(),
    getMapRole(context.env, mapId, user.id),
  ]);
  if (!map) throw new HttpError(404, "Map not found");
  return exportResponse(context, await loadMapExportData(context.env, map), format, false);
}

async function getPublicExport(context: RequestContext, format: ExportFormat): Promise<Response> {
  const map = await context.env.DB.prepare(
    "SELECT id, title, description, updated_at FROM maps WHERE public_token = ?",
  ).bind(context.params.publicToken).first<ExportMapRow>();
  if (!map) throw new HttpError(404, "Public map not found");
  return exportResponse(context, await loadMapExportData(context.env, map), format, true);
}

export function getMapGeoJson(context: RequestContext): Promise<Response> {
  return getPrivateExport(context, "geojson");
}

export function getMapKml(context: RequestContext): Promise<Response> {
  return getPrivateExport(context, "kml");
}

export function getPublicMapGeoJson(context: RequestContext): Promise<Response> {
  return getPublicExport(context, "geojson");
}

export function getPublicMapKml(context: RequestContext): Promise<Response> {
  return getPublicExport(context, "kml");
}
