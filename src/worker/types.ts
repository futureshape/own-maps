export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  GOOGLE_CLIENT_ID: string;
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
