import Link from "next/link";
import { unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { Empty, PageHead, fmt } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function CasesPage() {
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  const platform = getPlatform();
  const cases = session.kind === "admin" ? platform.store.cases.list() : platform.casesFor(session.actor.organisation.id);

  return (
    <div className="container">
      <PageHead
        eyebrow="Deal and partnership pipeline"
        title={session.kind === "admin" ? "All cases" : `Cases for ${session.actor.organisation.name}`}
        lede="A case opens when both organisations signal interest. Each case follows the provider country's own sequence, generated from configuration. Halted means a step depends on an unresolved requirement and has been routed to a named person."
      />
      {cases.length === 0 && <Empty title="No cases yet"><p>Signal interest in a listing and wait for the owner to signal back, or, as a listing owner, signal back on an interested organisation.</p><Link className="btn" href="/explore">Explore opportunities</Link></Empty>}
      <table className="data">
        <thead>
          <tr><th>Case</th><th>Provider country</th><th>Regulator state</th><th>Pathway</th><th>Instruments</th><th>Opened</th></tr>
        </thead>
        <tbody>
          {cases.map((c) => {
            const cfg = platform.country(c.providerCountry);
            const pathway = platform.pathwayFor(c);
            const state = cfg.stateMachine.states[c.machine.state];
            const instruments = platform.instrumentsFor(c.id);
            return (
              <tr key={c.id}>
                <td><Link href={`/cases/${c.id}`}><strong>{c.title}</strong></Link><div className="small mute">{c.participants.map((p) => `${platform.store.organisations.get(p.organisationId)?.name} (${p.role})`).join(" · ")}</div></td>
                <td>{cfg.name}{cfg.tag && <div className="small mute">{cfg.tag}</div>}</td>
                <td><span className={`state ${state.kind === "halted" ? "halted" : ""} ${state.kind === "terminal" ? "terminal" : ""}`}>{state.label}</span></td>
                <td>
                  {pathway.scope.kind === "out_of_scope" && <span className="status-pill informational">Out of scope</span>}
                  {pathway.scope.kind === "escalate" && <span className="status-pill halted">Scope escalated</span>}
                  {pathway.scope.kind === "in_scope" && (pathway.haltedStageIds.length ? <span className="status-pill halted">{pathway.haltedStageIds.length} halted</span> : <span className="status-pill active">{pathway.stages.length} stages</span>)}
                </td>
                <td className="small">{instruments.length ? instruments.map((i) => `${i.label} (v${i.versions.length})`).join(", ") : "none"}</td>
                <td className="small mute">{fmt(c.createdAt)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
