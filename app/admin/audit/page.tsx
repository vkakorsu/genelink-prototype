import { forbidden, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { PageHead } from "@/components/ui";
import { getSession } from "@/lib/session";
import { AuditTable } from "@/components/AuditTable";

export default async function AdminAuditPage() {
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  if (session.kind !== "admin") forbidden();
  const platform = getPlatform();
  const entries = platform.store.audit.list().slice().reverse();
  const v = platform.verifyAudit();
  return (
    <div className="container">
      <PageHead eyebrow="Audit review" title="Full audit chain" lede="Append-only, hash-chained. Newest first. Entries marked (scenario) are seeded history written in scenario time; unmarked entries are live actions at real UTC.">
        {v.ok ? <span className="status-pill complete">Verified · {v.length} entries</span> : <span className="status-pill halted">Broken at {v.brokenAt}: {v.reason}</span>}
      </PageHead>
      <AuditTable platform={platform} entries={entries} />
    </div>
  );
}
