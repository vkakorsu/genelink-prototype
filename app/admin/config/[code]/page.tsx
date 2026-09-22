import { forbidden, notFound, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { EvidenceChip, EvidenceLegend, RegBlock } from "@/components/Evidence";
import { Notice, PageHead, stateHeadline } from "@/components/ui";
import { getSession } from "@/lib/session";

const A5_LABEL: Record<string, string> = {
  whoMayApply: "A5.1 Who may apply",
  trigger: "A5.2 What triggers the obligation",
  orderOfConsent: "A5.3 Order of consent and application",
  applicantHolds: "A5.4 What the applicant ends up holding",
  clocks: "A5.5 Clocks, and what a lapsed clock means",
  durationRenewal: "A5.6 Duration and renewal",
  transferExport: "A5.7 Transfer, export and control of data",
  postPermitLifecycle: "A5.8 Post-permit lifecycle",
};

export default async function ConfigPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  if (session.kind !== "admin") forbidden();
  const platform = getPlatform();
  const cfg = platform.countries.get(code.toUpperCase());
  if (!cfg) notFound();

  const all: { state: string }[] = [];
  const walk = (n: unknown) => { if (Array.isArray(n)) n.forEach(walk); else if (n && typeof n === "object") { const o = n as Record<string, unknown>; if ("state" in o && "marker" in o) all.push(o as { state: string }); Object.values(o).forEach(walk); } };
  walk(cfg);
  const counts = { established: all.filter((v) => v.state === "established").length, inferred: all.filter((v) => v.state === "inferred").length, unknown: all.filter((v) => v.state === "unknown").length };

  return (
    <div className="container">
      <PageHead eyebrow={`Country configuration · config/countries/${cfg.name.toLowerCase()}.yaml · schema v${cfg.schemaVersion}`} title={`${cfg.name}${cfg.tag ? ` (${cfg.tag})` : ""}`} lede={`${cfg.legalInstruments.join(" · ")}`}>
        <div className="row">
          <EvidenceLegend />
          <span className="small mute">{all.length} regulatory values: {counts.established} established, {counts.inferred} GENE-LINK reading or construct, {counts.unknown} unresolved ({Math.round((counts.unknown / all.length) * 100)}%).</span>
        </div>
      </PageHead>
      <Notice kind="info">Read-only in the interface by design. The file is the source of truth. A change that moves a value&apos;s evidence class requires approval from a named Landscape Alliance reviewer, recorded in the pull request. Adding a country means adding a file that fills this same schema.</Notice>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <section className="card">
          <h3>Status</h3>
          <RegBlock reg={cfg.operativeInstrumentStatus} text="Operative instrument" compact />
          <RegBlock reg={cfg.nagoyaParty} text="Nagoya Protocol" compact />
          <RegBlock reg={cfg.euSide} text="EU side" compact />
          <RegBlock reg={cfg.consentOrder} text="Order of consent and application" compact />
          <p className="small"><strong>Escalation default owner:</strong> {cfg.escalation.defaultOwnerRole} · {cfg.escalation.defaultOwnerName ?? <span className="ev unknown"><span className="m">?</span>name pending Landscape Alliance</span>}</p>
          <p className="small"><strong>Renewal probe:</strong> {cfg.renewalProbe}</p>
        </section>
        <section className="card">
          <h3>Scope premise and rules (A5.2)</h3>
          <p className="small soft">{cfg.scope.premise}</p>
          <table className="data compact">
            <thead><tr><th>Rule</th><th>When</th><th>Result</th><th>Basis</th></tr></thead>
            <tbody>{cfg.scope.rules.map((r) => <tr key={r.id}><td className="mono small">{r.id}</td><td className="mono small">{r.when ? JSON.stringify(r.when) : "otherwise"}</td><td><strong>{r.result.replace("_", " ")}</strong></td><td><RegBlock reg={r.basis} compact /></td></tr>)}</tbody>
          </table>
          <h4 style={{ marginTop: 12 }}>Intake questions this file declares</h4>
          <p className="small soft">The shared intake collects purpose, provenance, applicant, exchange scenario, community holding and traditional knowledge for every country. These are {cfg.name}&apos;s own deciding facts. The form renders them from here; the interface has no country code.</p>
          <table className="data compact">
            <thead><tr><th>Fact</th><th>Prompt</th><th>Answers</th></tr></thead>
            <tbody>{cfg.scope.questions.map((q) => <tr key={q.id}><td className="mono small">{q.fact}{q.fact === "activity" ? " · decides scope" : ""}</td><td className="small">{q.prompt}{q.reg && <> <EvidenceChip reg={q.reg} short /></>}</td><td className="small">{q.kind === "number" ? `a whole number${q.min !== undefined ? ` from ${q.min}` : ""}${q.max !== undefined ? ` to ${q.max}` : ""}` : q.options.map((o) => o.label).join(" · ")}</td></tr>)}</tbody>
          </table>
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>The eight variables (A5)</h3>
        <div className="grid cols-2">{Object.entries(cfg.variables).map(([k, v]) => <RegBlock key={k} reg={v} text={A5_LABEL[k] ?? k} compact />)}</div>
      </section>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Stages, in this country&apos;s order (A5.3)</h3>
        <table className="data compact">
          <thead><tr><th>#</th><th>Stage</th><th>Subject</th><th>Applies when</th><th>Requirements</th><th>Documents</th><th>Consent parties</th></tr></thead>
          <tbody>{cfg.stages.map((s, i) => <tr key={s.id}><td>{i + 1}</td><td><strong>{s.title}</strong><div className="mono small mute">{s.id}{s.usesStateMachine ? " · state machine" : ""}{s.produces.length ? ` · produces ${s.produces.join(", ")}` : ""}</div></td><td><span className={`subject ${s.subject}`}>{s.subject}</span></td><td className="mono small">{s.when ? JSON.stringify(s.when) : "always"}</td><td className="small">{s.requirements.map((r) => <div key={r.id}><EvidenceChip reg={r.reg} short /> {r.id}{r.effect ? <strong> · {r.effect} when {JSON.stringify(r.when)}</strong> : ""}</div>)}</td><td className="small">{s.documents.map((d) => d.label).join(", ")}</td><td className="small">{s.consentParties.map((c) => c.label).join(", ")}</td></tr>)}</tbody>
        </table>
      </section>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <section className="card">
          <h3>State machine (R9)</h3>
          <div className="machine">{Object.entries(cfg.stateMachine.states).map(([id, s]) => <span key={id} className={`state ${s.kind === "terminal" ? "terminal" : ""} ${s.kind === "halted" ? "halted" : ""}`} title={`${s.kind}${s.outcome !== "none" ? ` · ${s.outcome}` : ""}`}>{stateHeadline(s.label)}</span>)}</div>
          <p className="small mute" style={{ marginTop: 8 }}>{cfg.stateMachine.transitions.length} declared transitions. {cfg.stateMachine.clocks.length} clock{cfg.stateMachine.clocks.length === 1 ? "" : "s"}, each with an on-lapse rule that never grants (R8).</p>
          {cfg.stateMachine.clocks.map((k) => (
            <div key={k.id}>
              <RegBlock reg={k.onLapse.reg} text={`${k.label}: ${k.days} ${k.dayKind} days, starts in ${k.startsIn}, runs in ${(k.runsIn?.length ? k.runsIn : [k.startsIn]).join(", ")}${k.suspendsIn.length ? `, suspended in ${k.suspendsIn.join(", ")}` : ""}, lapses to ${k.onLapse.to}`} compact />
              {k.extension && <RegBlock reg={k.extension} text={`Extension power: up to ${k.extendableDays} ${k.dayKind} days in total, recorded as the authority's act`} compact />}
            </div>
          ))}
          {cfg.stateMachine.transitions.some((t) => t.when) && (
            <p className="small mute">Guarded transitions: {cfg.stateMachine.transitions.filter((t) => t.when).map((t) => `${t.event} → ${t.to} when ${JSON.stringify(t.when)}`).join("; ")}. A guard on an unanswered fact is never taken.</p>
          )}
          {cfg.calendar ? (
            <details className="fold">
              <summary>Working-day calendar · {cfg.calendar.holidays.length} holidays through {cfg.calendar.coversThrough}</summary>
              <RegBlock reg={cfg.calendar.reg} text="Working days" compact />
              <p className="small">{cfg.calendar.holidays.map((h) => `${h.date} ${h.name}${h.provisional ? " (provisional)" : ""}`).join(" · ")}</p>
            </details>
          ) : cfg.stateMachine.clocks.some((k) => k.dayKind === "working") ? <p className="small mute">No holiday calendar: working days skip weekends only.</p> : null}
        </section>
        <section className="card">
          <h3>Outputs (A5.4, R7)</h3>
          {cfg.outputs.map((o) => (
            <div key={o.id} className="card flat" style={{ marginBottom: 8 }}>
              <strong>{o.label}</strong> <span className="small mute">· {o.kind.replace("_", " ")} · {o.issuer} · amendment {o.amendmentPolicy.replace("_", " ")}{o.automatic ? " · automatic" : ""}{o.verificationOpenAfterIssue ? " · verification open after issue" : ""}</span>
              <RegBlock reg={o.term} text="Term" compact />
              <RegBlock reg={o.renewalsCapped} text="Renewals capped" compact />
              <RegBlock reg={o.fee} text="Fee" compact />
            </div>
          ))}
          <RegBlock reg={cfg.changeOfIntent.consequence} text={`Change of intent consequence (policy ${cfg.changeOfIntent.policy.replace("_", " ")})`} compact />
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Nine obligation classes (A6) · recorded for phase two (R10)</h3>
        {cfg.obligationClasses.map((c) => (
          <details key={c.number} className="fold">
            <summary>Class {c.number} · {c.name} · {Object.keys(c.fields).length} fields · {Object.values(c.fields).filter((f) => f.state === "unknown").length} unresolved</summary>
            {c.note && <p className="small soft">{c.note}</p>}
            <div className="grid cols-2">{Object.entries(c.fields).map(([k, v]) => <RegBlock key={k} reg={v} text={k.replace(/_/g, " ")} compact />)}</div>
          </details>
        ))}
      </section>

      <div className="grid cols-2" style={{ marginTop: 14 }}>
        <section className="card">
          <h3>Manual-review judgments (R5)</h3>
          {cfg.manualReview.length === 0 && <p className="small mute">None of the three named judgments falls in {cfg.name}.</p>}
          {cfg.manualReview.map((m) => <RegBlock key={m.id} reg={m.reg} text={`${m.question} Decides: ${m.decides} Halts stage: ${cfg.stages.find((s) => s.id === m.stageId)?.title ?? m.stageId}.`} compact />)}
        </section>
        <section className="card">
          <h3>Live data layers (R6)</h3>
          {cfg.liveLayers.length === 0 && <p className="small mute">None configured for {cfg.name}. South Africa&apos;s s.86 exemption notices and provincial table are the cases the schema carries this for.</p>}
          {cfg.liveLayers.map((l) => <div key={l.id}><RegBlock reg={l.reg} text={l.name} compact /><p className="small soft">{l.description} Maintained by: {l.maintainedBy}. Entries: {l.entries.length} <span className="ev unknown"><span className="m">?</span>source pending</span></p></div>)}
        </section>
      </div>

      <section className="card" style={{ marginTop: 14 }}>
        <h3>Open questions (A7)</h3>
        {cfg.openQuestions.map((q) => <RegBlock key={q.id} reg={q.reg} text={`${q.question}. Affects: ${q.affects}`} compact />)}
      </section>
    </div>
  );
}
