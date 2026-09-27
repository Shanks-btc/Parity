import type { NextRequest } from "next/server";

/**
 * Small in-memory sliding-window limiter, keyed by client IP. Per server instance (fine for the single Railway
 * replica; a multi-replica deploy would need a shared store such as Redis). Stale entries are pruned on use.
 */
const hits = new Map<string, number[]>();

/**
 * Client IP as Railway's edge reports it. VERIFIED LIVE 2026-09-25: the edge sets X-Real-IP to the true client
 * address and rewrites X-Forwarded-For as "client, edge-proxy" — a client-supplied X-Forwarded-For is overwritten,
 * not appended to — while the trailing edge-proxy address rotates between requests (so keying on the last entry
 * would spread one client across several buckets and defeat the limit).
 */
export function clientIp(req: NextRequest): string {
  return req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "local";
}

/** Returns null when allowed, or the seconds the caller must wait when over the limit. */
export function rateLimit(key: string, limit: number, windowMs = 60_000): number | null {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return Math.max(1, Math.ceil((recent[0] + windowMs - now) / 1000));
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  return null;
}

/** Standard 429 reply for a limited route. */
export function rateLimitedResponse(retryAfter: number, what: string): Response {
  return new Response(JSON.stringify({ error: `Too many ${what}, try again in ${retryAfter}s.` }), {
    status: 429,
    headers: { "content-type": "application/json", "retry-after": String(retryAfter), "cache-control": "no-store" },
  });
}
