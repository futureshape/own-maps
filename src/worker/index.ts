import { login, logout, me } from "./api/auth";
import { createCategory, deleteCategory, updateCategory } from "./api/categories";
import { createMap, deleteMap, getMap, getPublicMap, listMaps, updateMap } from "./api/maps";
import { createPlace, deletePlace, updatePlace } from "./api/places";
import {
  deleteInvite,
  deleteMember,
  invite,
  listSharing,
  updateMember,
} from "./api/sharing";
import { authenticate } from "./auth/session";
import { handleError, json, requireSameOrigin } from "./http";
import { limitLogin } from "./rate-limit";
import { Router } from "./router";
import type { Env, Handler, RequestContext } from "./types";

const router = new Router();

function withLoginLimit(handler: Handler): Handler {
  return async (context) => {
    limitLogin(context.request);
    return handler(context);
  };
}

router
  .on("POST", "/api/auth/google", withLoginLimit(login))
  .on("POST", "/api/auth/logout", logout)
  .on("GET", "/api/me", me)
  .on("GET", "/api/maps", listMaps)
  .on("POST", "/api/maps", createMap)
  .on("GET", "/api/public/maps/:publicToken", getPublicMap)
  .on("GET", "/api/maps/:mapId", getMap)
  .on("PATCH", "/api/maps/:mapId", updateMap)
  .on("DELETE", "/api/maps/:mapId", deleteMap)
  .on("POST", "/api/maps/:mapId/places", createPlace)
  .on("PATCH", "/api/maps/:mapId/places/:placeId", updatePlace)
  .on("DELETE", "/api/maps/:mapId/places/:placeId", deletePlace)
  .on("POST", "/api/maps/:mapId/categories", createCategory)
  .on("PATCH", "/api/maps/:mapId/categories/:categoryId", updateCategory)
  .on("DELETE", "/api/maps/:mapId/categories/:categoryId", deleteCategory)
  .on("GET", "/api/maps/:mapId/members", listSharing)
  .on("POST", "/api/maps/:mapId/invites", invite)
  .on("DELETE", "/api/maps/:mapId/invites/:inviteId", deleteInvite)
  .on("PATCH", "/api/maps/:mapId/members/:userId", updateMember)
  .on("DELETE", "/api/maps/:mapId/members/:userId", deleteMember);

function withSecurityHeaders(response: Response): Response {
  const result = new Response(response.body, response);
  result.headers.set("x-content-type-options", "nosniff");
  result.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  result.headers.set("permissions-policy", "camera=(), microphone=(), geolocation=(self)");
  result.headers.set("x-frame-options", "DENY");
  return result;
}

export default {
  async fetch(request: Request, env: Env, executionCtx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204 });

    try {
      const publicMapRead = request.method === "GET" && /^\/api\/public\/maps\/[^/]+$/.test(url.pathname);
      const auth = publicMapRead ? {} : await authenticate(request, env);
      const baseContext: Omit<RequestContext, "params"> = { request, env, url, executionCtx, ...auth };
      requireSameOrigin({ ...baseContext, params: {} });
      const response = await router.route(baseContext);
      return withSecurityHeaders(response ?? json({ error: "Not found" }, { status: 404 }));
    } catch (error) {
      return withSecurityHeaders(handleError(error));
    }
  },
} satisfies ExportedHandler<Env>;
