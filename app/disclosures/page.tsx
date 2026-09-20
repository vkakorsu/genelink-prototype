import Link from "next/link";
import { getPlatform } from "@/core";
import { INFORMATION_NOT_ADVICE } from "@/core/audit/disclosure";
import { EvidenceChip } from "@/components/Evidence";
import { unauthorized, forbidden } from "next/navigation";
import { Empty, PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function DisclosuresPage() {
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  if (session.kind !== "seat") forbidden();
  const platform = getPlatform();
  const items = platform.disclosuresFor(session.actor.person.id);
  return (
    <div className="container">
      <PageHead
        eyebrow="Disclosure log"
        title={`What GENE-LINK told ${session.actor.person.name}`}
        lede="Every requirement statement the platform has shown you, with its evidence class and the time. This is the record behind the sentence: compliance output is information, never advice or approval, and what the system told each user, and when, is recorded."
      />
      <p className="small soft">{INFORMATION_NOT_ADVICE}</p>
      {items.length === 0 && <Empty title="Nothing recorded yet"><p>Open a case and the statements shown to you will appear here.</p><Link className="btn" href="/cases">Go to cases</Link></Empty>}
      {items.length > 0 && (
        <table className="data compact">
          <thead><tr><th>When</th><th>Case</th><th>Context</th><th>Statement</th><th>Evidence</th></tr></thead>
          <tbody>
            {items.map((d) => (
              <tr key={d.id}>
                <td className="mono small">{fmtTime(d.at)}</td>
                <td className="small">{d.caseId ? <Link href={`/cases/${d.caseId}`}>{platform.store.cases.get(d.caseId)?.title ?? d.caseId}</Link> : "none"} {d.countryCode && <span className="mute">· {d.countryCode}</span>}</td>
                <td className="small mute">{d.context}</td>
                <td className="small">{d.statement}</td>
                <td><EvidenceChip reg={d.reg} short />{d.reg.citation && <div className="mono small mute">{d.reg.citation}</div>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
