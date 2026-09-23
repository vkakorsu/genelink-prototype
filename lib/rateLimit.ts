/**
 * Per-client limits on the write paths a visitor can use without a seat: registering an organisation,
 * declaring a visit objective, checking a document. Without them one script could fill the instance's
 * registration bound in seconds and lock every later newcomer out, or grow memory without end.
 *
 * Fixed windows, held in process memory like the rest of the prototype. The MVP keeps the counters in
 * Postgres (or the edge) so they hold across instances.
 */

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 20_000;

/**
 * Who is asking. Behind Render the request passes Cloudflare, which sets CF-Connecting-IP to the
 * address it saw and overwrites any value the client sends, so that header is trusted first. The first
 * X-Forwarded-For entry is the fallback for other hosts; a client can write it, which is why the
 * platform-wide registration bound stays behind this limit.
 */
export function clientKey(h: { get(name: string): string | null }): string {
  const edge = h.get("cf-connecting-ip") ?? h.get("true-client-ip");
  if (edge?.trim()) return edge.trim().slice(0, 64);
  const xff = h.get("x-forwarded-for");
  if (xff?.split(",")[0].trim()) return xff.split(",")[0].trim().slice(0, 64);
  return h.get("x-real-ip")?.trim().slice(0, 64) || "direct";
}

export type Allowance = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

/** Count one use of `scope` by `key`. Refuses once `limit` uses fall inside the current window. */
export function take(scope: string, key: string, limit: number, windowMs: number, now = Date.now()): Allowance {
  const id = `${scope}\u0000${key}`;
  let b = buckets.get(id);
  if (!b || b.resetAt <= now) {
    if (buckets.size >= MAX_BUCKETS) prune(now);
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(id, b);
  }
  if (b.count >= limit) return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((b.resetAt - now) / 1000)) };
  b.count++;
  return { ok: true, remaining: limit - b.count };
}

function prune(now: number) {
  for (const [id, b] of buckets) if (b.resetAt <= now) buckets.delete(id);
  // Still full of live windows: drop the oldest half rather than grow. Losing a window only forgives a client early.
  if (buckets.size >= MAX_BUCKETS) {
    let n = 0;
    for (const id of buckets.keys()) {
      if (n++ >= MAX_BUCKETS / 2) break;
      buckets.delete(id);
    }
  }
}

/** Test hook: forget every window. */
export function resetRateLimits() {
  buckets.clear();
}

/** The limits the interface applies, per client, in one place so the documentation can cite them. */
export const LIMITS = {
  register: { limit: 5, windowMs: 10 * 60_000, what: "organisation registrations" },
  declare: { limit: 30, windowMs: 10 * 60_000, what: "journey declarations" },
  verify: { limit: 60, windowMs: 10 * 60_000, what: "document checks" },
} as const;
