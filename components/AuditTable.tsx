import type { AuditEntry } from "@/core/audit/chain";
import type { Platform } from "@/core/platform";
import { fmtTime } from "@/components/ui";
import { actorLabel, describeAudit, subjectLabel } from "@/lib/labels";

/**
 * The audit chain as a person reads it: who, what, about what, in words. The exact entry, which is what
 * the hash covers, stays one click below each row, so the plain reading never replaces the record.
 */
export function AuditTable({ platform, entries }: { platform: Platform; entries: AuditEntry[] }) {
  return (
    <table className="data compact">
      <thead><tr><th>#</th><th>When</th><th>Who</th><th>What happened</th><th>About</th><th>Fingerprint</th></tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={e.seq}>
            <td>{e.seq}</td>
            <td className="mono small">{fmtTime(e.at)}</td>
            <td className="small">{actorLabel(platform, e)}</td>
            <td className="small" style={{ maxWidth: 460 }}>
              {describeAudit(platform, e)}
              <details className="fold">
                <summary className="mute">Exact record</summary>
                <div className="mono mute" style={{ fontSize: "0.72rem", wordBreak: "break-word" }}>
                  {e.action} · {e.actor.role}{e.actor.seatId ? ` · ${e.actor.seatId}` : ""} · {e.subject.type} {e.subject.id}
                  <br />
                  {JSON.stringify(e.detail)}
                </div>
              </details>
            </td>
            <td className="small">{subjectLabel(platform, e.subject)}</td>
            <td className="mono small" title={`Previous entry's fingerprint: ${e.prevHash}`}>{e.hash.slice(0, 12)}…</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
