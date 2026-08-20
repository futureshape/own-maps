import { ZodError, type ZodType } from "zod";
import type { RequestContext } from "./types";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export async function parseJson<T>(context: RequestContext, schema: ZodType<T>): Promise<T> {
  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(415, "Requests must use application/json");
  }
  let input: unknown;
  try {
    input = await context.request.json();
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new HttpError(400, error.issues[0]?.message ?? "Invalid request");
    }
    throw error;
  }
}

export function handleError(error: unknown): Response {
  if (error instanceof HttpError) {
    return json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return json({ error: error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  if (error instanceof Error && /UNIQUE constraint failed/.test(error.message)) {
    return json({ error: "That item already exists" }, { status: 409 });
  }
  console.error(error);
  return json({ error: "Internal server error" }, { status: 500 });
}

export function requireSameOrigin(context: RequestContext): void {
  if (["GET", "HEAD", "OPTIONS"].includes(context.request.method)) return;
  const origin = context.request.headers.get("origin");
  if (!origin || origin !== context.url.origin) {
    throw new HttpError(403, "Cross-origin request rejected");
  }
}

export function noContent(init: ResponseInit = {}): Response {
  return new Response(null, { status: 204, ...init });
}
