import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { getPlatform } from "@/core";
import { EvidenceChip, RegBlock } from "@/components/Evidence";
import { DecisionSlot, OpenMarker, PageHead } from "@/components/ui";

type OpenDecision = { id: string; source: string; question: string; workingPosition: string; decidedBy: string; affects: string };

export default async function OpenDecisionsPage() {
  const decisions = parse(readFileSync(join(process.cwd(), "config", "open-decisions.yaml"), "utf8")) as OpenDecision[];
  const platform = getPlatform();
  const countries = Array.from(platform.countries.values());
  const totalOpen = countries.reduce((n, c) => n + c.openQuestions.length, 0);
  return (
    <div className="container">
      <PageHead
        eyebrow="Open decisions and unresolved requirements"
        title="What is deliberately not decided"
        lede="The appendices hold product decisions open and list legal questions that regulators have not answered. Showing the boundary between decided and undecided is part of what this prototype proves. Nothing below has been resolved by assumption. Where a working position was needed to build anything at all, it is stated as a position."
      />
      <section className="card" style={{ marginBottom: 16 }}>
        <h2><OpenMarker /> Product decisions held open ({decisions.length})</h2>
        <table className="data">
          <thead><tr><th>Question</th><th>Working position in the prototype</th><th>Decided by</th><th>Affects</th></tr></thead>
          <tbody>
            {decisions.map((d) => (
              <tr key={d.id}>
                <td><strong>{d.question}</strong><div className="small mute">{d.source}</div></td>
                <td className="small">{d.workingPosition}</td>
                <td><DecisionSlot>Decision pending · {d.decidedBy}</DecisionSlot></td>
                <td className="small mute">{d.affects}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="card">
        <h2><EvidenceChip reg={{ state: "unknown", marker: "?", owner: "regulators", drives: false, executable: true }} /> Legal questions open with regulators or unresolved in the sources ({totalOpen})</h2>
        <p className="small soft">Published in Appendix B A7 so that bidders price them rather than discover them. Each is an explicit unknown in configuration. Where it drives a step, the step halts. When an answer arrives, the value changes in the country file under legal review, with no code change.</p>
        {countries.map((c) => (
          <div key={c.code} style={{ marginTop: 14 }}>
            <h3>{c.name} · {c.openQuestions.length} question{c.openQuestions.length === 1 ? "" : "s"}{c.code === "BR" ? " · dry run" : ""}</h3>
            {c.openQuestions.map((q) => (
              <div key={q.id} className="grid cols-2" style={{ alignItems: "start", marginBottom: 6 }}>
                <RegBlock reg={q.reg} text={q.question} compact />
                <div className="small soft" style={{ paddingTop: 10 }}><strong>Affects:</strong> {q.affects}{q.reg.drives ? <div className="ev unknown" style={{ marginTop: 6 }}><span className="m">?</span>must not default: a dependent step stops rather than guess. If that step is a future module (for example renewal), the unknown is surfaced now and will halt the module when it runs.</div> : <div className="small mute" style={{ marginTop: 6 }}>shown, does not stop a step</div>}</div>
              </div>
            ))}
          </div>
        ))}
      </section>
    </div>
  );
}
