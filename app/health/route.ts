import { getPlatform } from "@/core";

export const dynamic = "force-dynamic";

/**
 * Liveness and integrity probe for the hosting platform's health check.
 * Reports the audit chain verification result so a broken chain surfaces in
 * monitoring rather than in a later dispute. Returns 503 if the chain fails.
 */
export function GET() {
  const platform = getPlatform();
  const chain = platform.verifyAudit();
  const body = {
    ok: chain.ok,
    store: platform.store.kind,
    countries: Array.from(platform.countries.keys()).sort(),
    auditEntries: platform.store.audit.list().length,
    auditChain: chain.ok ? "verified" : "broken",
    time: platform.now().toISOString(),
  };
  return Response.json(body, { status: chain.ok ? 200 : 503, headers: { "cache-control": "no-store" } });
}
