import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform } from "@/core";
import { PageHead, PersonaRequired, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function CaseAuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const platform = getPlatform();
  const c = platform.store.cases.get(id);
  if (!c) notFound();
  const session = await getSession();
  if (session.kind === "anonymous") return <div className="container"><PersonaRequired next={`/cases/${id}/audit`} /></div>;
  const related = new Set([id, ...platform.instrumentsFor(id).map((i) => i.id), ...platform.agreementsFor(id).map((a) => a.id), ...platform.documentsFor(id).map((d) => d.id), ...platform.escalationsFor(id).map((e) => e.id), ...platform.manualReviewsFor(id).map((m) => m.id)]);
  const entries = platform.store.audit.list().filter((e) => related.has(e.subject.id));
  const v = platform.verifyAudit();
  return (
    <div className="container">
      <PageHead eyebrow="Audit" title={`Audit trail · ${c.title}`} lede="Every legally or commercially consequential action, in order, with the acting seat and a hash that covers the entry and the one before it. Shown here filtered to this case. Entries marked (scenario) are seeded history; unmarked entries are live actions at real UTC. Chain integrity is checked across the whole log.">
        <p className="small">{v.ok ? <span className="status-pill complete">Chain verified · {v.length} entries</span> : <span className="status-pill halted">Chain broken at {v.brokenAt}</span>} <Link href={`/cases/${id}`}>Back to case</Link></p>
      </PageHead>
      <table className="data compact">
        <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th><th>Hash</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.seq}>
              <td>{e.seq}</td>
              <td className="mono small">{fmtTime(e.at)}</td>
              <td className="small">{e.actor.role}{e.actor.seatId ? <div className="mute">{e.actor.seatId}</div> : null}</td>
              <td><strong>{e.action}</strong></td>
              <td className="small">{e.subject.type} <span className="mute">{e.subject.id}</span></td>
              <td className="small mono" style={{ maxWidth: 420, wordBreak: "break-word" }}>{JSON.stringify(e.detail)}</td>
              <td className="mono small" title={`prev ${e.prevHash}`}>{e.hash.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
