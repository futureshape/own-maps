import { HttpError } from "./http";
import { PUBLIC_MAP_CACHE_CONTROL } from "./public-map-cache";
import type { Env, RequestContext } from "./types";

const PREVIEW_WIDTH = 1200;
const PREVIEW_HEIGHT = 630;
const STATIC_MAP_SIZE = "600x315";
const PREVIEW_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";

type PublicMapRow = {
  id: string;
  title: string;
  description: string | null;
  updated_at: number;
};

type CoordinateRow = {
  lat: number;
  lng: number;
};

export type PublicMapSocialData = {
  title: string;
  description: string | null;
  updatedAt: number;
  places: CoordinateRow[];
};

export async function readPublicMapSocialData(
  env: Env,
  publicToken: string,
): Promise<PublicMapSocialData | null> {
  const map = await env.DB.prepare(
    "SELECT id, title, description, updated_at FROM maps WHERE public_token = ?",
  )
    .bind(publicToken)
    .first<PublicMapRow>();
  if (!map) return null;

  const places = await env.DB.prepare(
    "SELECT lat, lng FROM map_places WHERE map_id = ? ORDER BY created_at",
  )
    .bind(map.id)
    .all<CoordinateRow>();
  return {
    title: map.title,
    description: map.description,
    updatedAt: map.updated_at,
    places: places.results,
  };
}

function socialDescription(map: PublicMapSocialData): string {
  if (map.description) return map.description;
  const count = map.places.length;
  return count === 1
    ? `Explore 1 saved place on ${map.title}.`
    : `Explore ${count} saved places on ${map.title}.`;
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function meta(property: string, content: string): string {
  return `<meta property="${property}" content="${escapeAttribute(content)}">`;
}

function namedMeta(name: string, content: string): string {
  return `<meta name="${name}" content="${escapeAttribute(content)}">`;
}

export function buildStaticMapUrl(map: PublicMapSocialData, apiKey: string): URL {
  const url = new URL("https://maps.googleapis.com/maps/api/staticmap");
  url.searchParams.set("size", STATIC_MAP_SIZE);
  url.searchParams.set("scale", "2");
  url.searchParams.set("format", "png");
  url.searchParams.set("maptype", "roadmap");
  if (map.places.length) {
    const locations = map.places.map(({ lat, lng }) => `${lat.toFixed(6)},${lng.toFixed(6)}`);
    url.searchParams.set("markers", `size:tiny|color:0xe8663d|${locations.join("|")}`);
  } else {
    url.searchParams.set("center", "51.5074,-0.1278");
    url.searchParams.set("zoom", "10");
  }
  url.searchParams.set("key", apiKey);
  return url;
}

export function rewritePublicMapHtml(
  assetResponse: Response,
  map: PublicMapSocialData,
  pageUrl: URL,
): Response {
  const imageUrl = new URL(`${pageUrl.pathname}/preview.png`, pageUrl.origin);
  imageUrl.searchParams.set("v", String(map.updatedAt));
  const description = socialDescription(map);
  const imageAlt = `Map preview of ${map.title} with ${map.places.length} saved ${map.places.length === 1 ? "place" : "places"}`;

  const socialTags = [
    meta("og:type", "website"),
    meta("og:site_name", "Pinboard Maps"),
    meta("og:title", map.title),
    meta("og:description", description),
    meta("og:url", pageUrl.href),
    meta("og:image", imageUrl.href),
    meta("og:image:secure_url", imageUrl.href),
    meta("og:image:type", "image/png"),
    meta("og:image:width", String(PREVIEW_WIDTH)),
    meta("og:image:height", String(PREVIEW_HEIGHT)),
    meta("og:image:alt", imageAlt),
    namedMeta("twitter:card", "summary_large_image"),
    namedMeta("twitter:title", map.title),
    namedMeta("twitter:description", description),
    namedMeta("twitter:image", imageUrl.href),
    namedMeta("twitter:image:alt", imageAlt),
    `<link rel="canonical" href="${escapeAttribute(pageUrl.href)}">`,
  ].join("");

  const rewritten = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(`${map.title} · Pinboard Maps`);
      },
    })
    .on('meta[name="description"]', {
      element(element) {
        element.setAttribute("content", description);
      },
    })
    .on("head", {
      element(element) {
        element.append(socialTags, { html: true });
      },
    })
    .transform(assetResponse);
  const headers = new Headers(rewritten.headers);
  headers.set("cache-control", PUBLIC_MAP_CACHE_CONTROL);
  return new Response(rewritten.body, {
    headers,
    status: rewritten.status,
    statusText: rewritten.statusText,
  });
}

export async function getPublicMapPage(context: RequestContext): Promise<Response> {
  const map = await readPublicMapSocialData(context.env, context.params.publicToken);
  if (!map) throw new HttpError(404, "Public map not found");
  if (context.request.method === "HEAD") {
    return new Response(null, {
      headers: {
        "cache-control": PUBLIC_MAP_CACHE_CONTROL,
        "content-type": "text/html; charset=utf-8",
      },
    });
  }

  const pageUrl = new URL(
    `/public/${encodeURIComponent(context.params.publicToken)}`,
    context.url.origin,
  );
  const assetResponse = await context.env.ASSETS.fetch(context.request);
  return rewritePublicMapHtml(assetResponse, map, pageUrl);
}

export async function getPublicMapPreview(context: RequestContext): Promise<Response> {
  const map = await readPublicMapSocialData(context.env, context.params.publicToken);
  if (!map) throw new HttpError(404, "Public map not found");
  if (!context.env.GOOGLE_MAPS_STATIC_API_KEY) {
    throw new HttpError(503, "Map previews are not configured");
  }
  if (context.request.method === "HEAD") {
    return new Response(null, {
      headers: {
        "cache-control": PREVIEW_CACHE_CONTROL,
        "content-type": "image/png",
      },
    });
  }

  const staticMapResponse = await fetch(
    buildStaticMapUrl(map, context.env.GOOGLE_MAPS_STATIC_API_KEY),
    { cf: { cacheEverything: true, cacheTtl: 86_400 } },
  );
  const contentType = staticMapResponse.headers.get("content-type") ?? "";
  if (!staticMapResponse.ok || !contentType.startsWith("image/")) {
    console.error(JSON.stringify({
      message: "Google Static Maps preview request failed",
      status: staticMapResponse.status,
      contentType,
    }));
    throw new HttpError(502, "Could not generate map preview");
  }

  const headers = new Headers();
  headers.set("content-type", contentType);
  headers.set("cache-control", PREVIEW_CACHE_CONTROL);
  return new Response(staticMapResponse.body, { headers });
}
