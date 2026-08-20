import type { RequestContext } from "./types";

export const PUBLIC_MAP_CACHE_CONTROL = "public, max-age=0, s-maxage=30";

type CloudflareCacheStorage = typeof caches & { readonly default: Cache };

// DOM and Workers types both define CacheStorage; only the Workers runtime adds `default`.
const edgeCache = (caches as CloudflareCacheStorage).default;

function cacheKey(url: URL, publicToken: string): Request {
  return new Request(
    new URL(`/api/public/maps/${encodeURIComponent(publicToken)}`, url.origin),
    { method: "GET" },
  );
}

function logCacheError(action: "read" | "write" | "delete", error: unknown): void {
  console.error(JSON.stringify({
    message: "public map cache operation failed",
    action,
    error: error instanceof Error ? error.message : String(error),
  }));
}

export async function readPublicMapCache(
  context: RequestContext,
  publicToken: string,
): Promise<Response | undefined> {
  try {
    return await edgeCache.match(cacheKey(context.url, publicToken));
  } catch (error) {
    logCacheError("read", error);
    return undefined;
  }
}

export async function writePublicMapCache(
  context: RequestContext,
  publicToken: string,
  response: Response,
): Promise<void> {
  const write = edgeCache
    .put(cacheKey(context.url, publicToken), response)
    .catch((error: unknown) => logCacheError("write", error));
  if (context.executionCtx) {
    context.executionCtx.waitUntil(write);
    return;
  }
  await write;
}

export async function invalidatePublicMapCache(
  context: RequestContext,
  publicToken: string | null,
): Promise<void> {
  if (!publicToken) return;
  try {
    await edgeCache.delete(cacheKey(context.url, publicToken));
  } catch (error) {
    logCacheError("delete", error);
  }
}

export async function invalidateMapPublicCache(
  context: RequestContext,
  mapId: string,
): Promise<void> {
  const row = await context.env.DB.prepare("SELECT public_token FROM maps WHERE id = ?")
    .bind(mapId)
    .first<{ public_token: string | null }>();
  await invalidatePublicMapCache(context, row?.public_token ?? null);
}
