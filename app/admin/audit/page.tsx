import { forbidden, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

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
      <table className="data compact">
        <thead><tr><th>#</th><th>When</th><th>Actor</th><th>Action</th><th>Subject</th><th>Detail</th><th>Hash</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.seq}>
              <td>{e.seq}</td>
              <td className="mono small">{fmtTime(e.at)}</td>
              <td className="small">{e.actor.role}{e.actor.seatId && <div className="mute">{e.actor.seatId}</div>}</td>
              <td><strong>{e.action}</strong></td>
              <td className="small">{e.subject.type} <span className="mute">{e.subject.id}</span></td>
              <td className="small mono" style={{ maxWidth: 380, wordBreak: "break-word" }}>{JSON.stringify(e.detail)}</td>
              <td className="mono small">{e.hash.slice(0, 12)}…</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
