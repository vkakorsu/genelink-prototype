import Link from "next/link";
import { getPlatform } from "@/core";
import { DecisionSlot, PageHead } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function LearnPage() {
  const platform = getPlatform();
  const session = await getSession();
  const resources = platform.store.learning.list();
  const person = session.kind === "seat" ? session.actor.person : null;
  const stageTitles = new Map<string, string>();
  for (const c of platform.countries.values()) {
    for (const s of c.stages) {
      if (!stageTitles.has(s.id)) stageTitles.set(s.id, s.title);
    }
  }
  return (
    <div className="container">
      <PageHead
        eyebrow="Learning and capacity building"
        title="Arrive to learn"
        lede="Curated resources attached to pathway stages, and a badge record that belongs to the person and travels across employers. A learner loops in learning and re-enters the spine later. Content is Landscape Alliance's and is marked pending until supplied."
      />
      <div className="two-col">
        <section className="card">
          <h3>Resources</h3>
          <table className="data compact">
            <thead><tr><th>Resource</th><th>Attached to stages</th><th>Countries</th><th>Status</th></tr></thead>
            <tbody>
              {resources.map((r) => (
                <tr key={r.id}>
                  <td><strong>{r.title}</strong></td>
                  <td className="small">{r.stageIds.map((id) => stageTitles.get(id) ?? id.replaceAll("_", " ")).join(", ")}</td>
                  <td className="small">{r.countryCodes.join(", ").replace("*", "all")}</td>
                  <td>{r.status === "available" && r.url ? <a href={r.url}>Open</a> : <DecisionSlot>Content pending Landscape Alliance</DecisionSlot>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small mute" style={{ marginTop: 10 }}>The MVP links to learning, it does not host a learning management system. That is a deliberate simplification.</p>
        </section>
        <aside className="card">
          <h3>Badges</h3>
          {!person && <p className="small">Sign in with a persona to see the badge record. <Link href="/persona?next=/learn">Choose a persona</Link>.</p>}
          {person && person.badges.length === 0 && <p className="small mute">No badges yet for {person.name}.</p>}
          {person && person.badges.map((b) => (
            <div key={b.id} className="card flat" style={{ marginTop: 8 }}>
              <strong>{b.title}</strong>
              <div className="small mute">{b.issuer} · {b.earnedOn}</div>
            </div>
          ))}
          <p className="small mute" style={{ marginTop: 10 }}>Badges are personal and portable. They are shown as facts on a profile. They are never rolled into a reputation score.</p>
        </aside>
      </div>
    </div>
  );
}
