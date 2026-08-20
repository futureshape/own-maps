import { HttpError } from "./http";

type Entry = { count: number; resetAt: number };
const attempts = new Map<string, Entry>();

// Best-effort per-isolate protection. For globally consistent limits, add a
// dedicated Cloudflare rate-limiting binding when traffic warrants it.
export function limitLogin(request: Request, now = Date.now()): void {
  const ip = request.headers.get("cf-connecting-ip") ?? "local";
  const current = attempts.get(ip);
  if (!current || current.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return;
  }
  if (current.count >= 20) throw new HttpError(429, "Too many login attempts; try again shortly");
  current.count += 1;
  if (attempts.size > 5000) {
    for (const [key, entry] of attempts) if (entry.resetAt <= now) attempts.delete(key);
  }
}
