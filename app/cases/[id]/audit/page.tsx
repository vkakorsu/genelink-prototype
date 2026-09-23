import Link from "next/link";
import { forbidden, notFound, unauthorized } from "next/navigation";
import { errorKind } from "@/core/errors";
import { getPlatform } from "@/core";
import { PageHead } from "@/components/ui";
import { getSession } from "@/lib/session";
import { AuditTable } from "@/components/AuditTable";

export default async function CaseAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const platform = getPlatform();
  // Sign-in is checked before existence: an anonymous visitor must not learn which case ids exist.
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  const c = platform.store.cases.get(id);
  if (!c) notFound();
  // The trail names the participants' seats and organisations: same boundary as the case.
  let entries;
  try {
    entries = platform.caseAudit(session.actor, id);
  } catch (e) {
    if (errorKind(e) === "permission_denied") forbidden();
    throw e;
  }
  const v = platform.verifyAudit();
  return (
    <div className="container">
      <PageHead eyebrow="Audit" title={`Audit trail · ${c.title}`} lede="Every legally or commercially consequential action, in order, with the acting seat and a hash that covers the entry and the one before it. Shown here filtered to this case. Entries marked (scenario) are seeded history; unmarked entries are live actions at real UTC. Chain integrity is checked across the whole log.">
        <p className="small">{v.ok ? <span className="status-pill complete">Chain verified · {v.length} entries</span> : <span className="status-pill halted">Chain broken at {v.brokenAt}</span>} <Link href={`/cases/${id}`}>Back to case</Link></p>
      </PageHead>
      <AuditTable platform={platform} entries={entries} />
    </div>
  );
}
