import type { MapCollaboration } from "./collaboration";

export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  MAP_COLLABORATION: DurableObjectNamespace<MapCollaboration>;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_MAPS_STATIC_API_KEY?: string;
  APP_ENV?: "development" | "production" | "test";
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

export interface RequestContext {
  request: Request;
  env: Env;
  url: URL;
  params: Record<string, string>;
  executionCtx?: ExecutionContext;
  user?: AuthUser;
  sessionHash?: string;
}

export type Handler = (context: RequestContext) => Promise<Response>;
