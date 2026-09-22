import Link from "next/link";
import { forbidden, notFound, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { activityQuestion } from "@/core/config/schema";
import { readFact } from "@/core/engine/conditions";
import { adminIntervene, requestSupport } from "@/app/actions";
import { EvidenceChip, EvidenceLegend, RegBlock } from "@/components/Evidence";
import { ErrorNotice, InformationNotAdvice, Notice, OpenMarker, PageHead, fmtTime, stateHeadline } from "@/components/ui";
import { FactsForm } from "@/components/case/FactsForm";
import { StageCard } from "@/components/case/StageCard";
import { MachinePanel } from "@/components/case/MachinePanel";
import { InstrumentsPanel } from "@/components/case/InstrumentsPanel";
import { AgreementsPanel } from "@/components/case/AgreementsPanel";
import { getSession } from "@/lib/session";

export default async function CasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const platform = getPlatform();
  const c = platform.store.cases.get(id);
  if (!c) notFound();
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();

  const isAdmin = session.kind === "admin";
  const seat = session.kind === "seat" ? session.actor.seat : null;
  const participant = isAdmin || c.participants.some((p) => p.organisationId === seat!.organisationId);
  if (!participant) {
    // A refused view is a denied attempt too: the interface promises they are written to the chain.
    // Guarded so a repeat render of this page does not write the same entry twice.
    if (session.kind === "seat") {
      const last = platform.store.audit.list().at(-1);
      const alreadyLogged = last?.action === "access.denied" && last.subject.id === id && last.actor.seatId === session.actor.seat.id && (last.detail as { operation?: string }).operation === "case.view";
      if (!alreadyLogged) platform.recordDenied(session.actor, "case.view", { type: "case", id }, "Your seat's organisation is not a participant in this case");
    }
    forbidden();
  }

  const cfg = platform.country(c.providerCountry);
  const pathway = platform.pathwayFor(c);
  const documents = platform.documentsFor(c.id);
  const escalations = platform.escalationsFor(c.id);
  const manualReviews = platform.manualReviewsFor(c.id);
  const instruments = platform.instrumentsFor(c.id);
  const agreements = platform.agreementsFor(c.id);
  const duties = platform.dutiesFor(c);
  const orgs = new Map(platform.store.organisations.list().map((o) => [o.id, o]));
  const learning = platform.store.learning.list();

  const rank = { viewer: 0, member: 1, authorised_signatory: 2, administrator: 3 } as const;
  const canEdit = !!seat && rank[seat.permission] >= 1;
  const canSign = !!seat && rank[seat.permission] >= 2;
  // R5: a manual-review judgment is recorded by the reviewer seat, never by a party to the case.
  const canJudge = isAdmin;
  const holdings = platform.holdings(c);
  const requestSupportHere = requestSupport.bind(null, c.id);
  const adminInterveneHere = adminIntervene.bind(null, c.id);

  // What GENE-LINK told this person, recorded now.
  if (session.kind === "seat") platform.discloseCase(session.actor.person, session.actor.seat, c);

  return (
    <div className="container">
      <PageHead eyebrow={`Case · provider country ${cfg.name}${cfg.tag ? ` · ${cfg.tag}` : ""}`} title={c.title}>
        <div className="row">
          {c.participants.map((p) => <span key={p.organisationId} className="tag"><Link href={`/organisations/${p.organisationId}`}>{orgs.get(p.organisationId)?.name}</Link> · {p.role}</span>)}
          <span className="small mute">Opened {fmtTime(c.createdAt)}{c.revealedAt ? `, identities revealed symmetrically ${fmtTime(c.revealedAt)}` : ""}</span>
        </div>
      </PageHead>
      <ErrorNotice error={sp.error} />

      {(() => {
        const done = pathway.stages.filter((s) => c.stageProgress[s.stage.id] === "complete").length;
        const halted = pathway.haltedStageIds.length;
        const stopped = pathway.stoppedStageIds.length;
        const next = pathway.stages.find((s) => s.status !== "informational" && c.stageProgress[s.stage.id] !== "complete");
        const stateLabel = stateHeadline(cfg.stateMachine.states[c.machine.state]?.label ?? c.machine.state);
        const machineKind = cfg.stateMachine.states[c.machine.state]?.kind;
        const outOfScope = pathway.scope.kind === "out_of_scope";
        return (
          <div className="card flat" style={{ padding: "10px 14px", marginBottom: 14 }}>
            <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
              <span className="small"><strong>Regulator:</strong> {stateLabel}</span>
              {outOfScope ? (
                <span className="small"><strong>Pathway:</strong> none while out of scope</span>
              ) : (
                <span className="small"><strong>Pathway:</strong> {done} of {pathway.stages.length} stages complete{stopped > 0 ? `, ${stopped} stopped by a prohibition` : ""}{halted > 0 ? `, ${halted} halted` : ""}</span>
              )}
              {!outOfScope && next && <span className="small"><strong>Next:</strong> {(machineKind === "terminal" || machineKind === "halted") ? "GENE-LINK-side · " : ""}{next.stage.title}{next.status === "halted" ? " (halted, routed to its owner)" : next.status === "stopped" ? " (stopped: a prohibition applies on these facts)" : ""}</span>}
              {!outOfScope && !next && pathway.stages.length > 0 && <span className="small mute">All stages complete.</span>}
            </div>
            {(machineKind === "terminal" || machineKind === "halted") && done < pathway.stages.length && (
              <p className="small mute" style={{ marginTop: 6, marginBottom: 0 }}>Two tracks, deliberately separate. The regulator line is the authority&apos;s own legal record: it ran its course on the proceeding events. The pathway tracks GENE-LINK-side work and still carries an open question; a proceeding outcome never silently completes platform work.</p>
            )}
          </div>
        );
      })()}

      {cfg.operativeInstrumentStatus.state === "unknown" && (
        <Notice kind="pending">
          <OpenMarker /> <strong>The operative instrument for {cfg.name} is not settled.</strong> {cfg.operativeInstrumentStatus.note} <EvidenceChip reg={cfg.operativeInstrumentStatus} short />
        </Notice>
      )}
      {holdings.missing.length > 0 && (
        <Notice kind="pending">
          <strong>Granted, but the applicant does not yet hold everything this regime issues.</strong> {holdings.recorded} of {holdings.required} instrument{holdings.required === 1 ? "" : "s"} recorded. Awaiting: {holdings.missing.map((m) => `${m.label} (${m.issuer})`).join(" and ")}. The platform records instruments the State issued. It does not create them, and it does not treat one issuer&apos;s grant as the other&apos;s.
        </Notice>
      )}
      {(c.interventions?.length ?? 0) > 0 && (
        <Notice kind="info">
          <strong>Administrator intervention on this case.</strong>{" "}
          {c.interventions!.map((i) => <span key={i.id}>{fmtTime(i.at)}: {i.action} (reason: {i.reason}, by {i.by}). </span>)}
          Every intervention is also in the <Link href={`/cases/${c.id}/audit`}>audit chain</Link>.
        </Notice>
      )}

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="stack">
          {/* Scope answer */}
          <section className={`card ${pathway.scope.kind === "in_scope" ? "tinted" : "warn"}`}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Scope on the facts entered: {pathway.scope.kind.replaceAll("_", " ")}</h3>
              <EvidenceChip reg={pathway.scope.basis} />
            </div>
            <p className="small soft" style={{ margin: "6px 0" }}>{cfg.scope.premise}</p>
            <RegBlock reg={pathway.scope.basis} compact />
            {pathway.scope.kind === "out_of_scope" && (
              <p className="small"><strong>Stated out-of-scope position:</strong> {pathway.scope.redirect}. The basis is recorded on the case. <Link href="/out-of-scope">Why the platform does not run you through rules that do not fit</Link>.</p>
            )}
            {pathway.scope.kind === "escalate" && (
              <p className="small"><strong>Halted at scope.</strong> Routed to {pathway.scope.owner}. The pathway below is provisional until the question is answered through configuration review.</p>
            )}
            {pathway.scope.kind === "undetermined" && (
              <p className="small"><strong>Not yet determined.</strong> The parties have not yet established: {pathway.scope.missing.map((f) => FACT_LABEL[f] ?? cfg.scope.questions.find((q) => q.fact === f)?.prompt ?? f).join("; ")}. Answer on the intake form. The pathway below is provisional, and every stage that turns on an unanswered fact is halted rather than guessed.</p>
            )}
            <InformationNotAdvice />
          </section>

          {/* Eligibility */}
          {pathway.eligibility.length > 0 && (
            <section className="card">
              <h3>Eligibility on the facts entered</h3>
              {pathway.eligibility.map((r) => <RegBlock key={r.id} reg={r.reg} text={r.text} compact />)}
            </section>
          )}

          {/* Pathway */}
          {pathway.stages.length > 0 && (
            <section>
              <div className="row between" style={{ marginBottom: 10 }}>
                <h2 style={{ margin: 0 }}>Pathway · {pathway.stages.length} stages in {cfg.name}&apos;s own order</h2>
                <EvidenceLegend />
              </div>
              <p className="small soft">Order of consent and application here: <EvidenceChip reg={cfg.consentOrder} short /> {cfg.consentOrder.value}</p>
              {pathway.stages.map((s, i) => (
                <StageCard
                  key={s.stage.id}
                  stage={s}
                  c={c}
                  documents={documents}
                  escalations={escalations}
                  manualReviews={manualReviews}
                  canEdit={canEdit}
                  canComplete={canSign || isAdmin}
                  canJudge={canJudge}
                  upstreamHalted={pathway.stages.slice(0, i).some((earlier) => earlier.status === "halted")}
                  learning={learning.filter((l) => l.stageIds.includes(s.stage.id) && (l.countryCodes.includes("*") || l.countryCodes.includes(cfg.code)))}
                />
              ))}
            </section>
          )}

          {pathway.scope.kind !== "out_of_scope" && <MachinePanel cfg={cfg} c={c} canAct={canSign || isAdmin} canPrepare={canEdit} isAdmin={isAdmin} />}
          {pathway.scope.kind !== "out_of_scope" && <InstrumentsPanel cfg={cfg} c={c} instruments={instruments} canSign={canSign} isAdmin={isAdmin} seatPermission={seat?.permission ?? null} />}
          {pathway.scope.kind !== "out_of_scope" && <AgreementsPanel c={c} agreements={agreements} orgs={orgs} mySeat={seat} canEdit={canEdit} canSign={canSign} seatPermission={seat?.permission ?? null} />}

          {/* Duties, phase two */}
          {pathway.scope.kind !== "out_of_scope" && (
            <section className="card flat">
              <div className="row between">
                <h3 style={{ margin: 0 }}>What attaches to the instrument · phase two</h3>
                <span className="status-pill informational">Recorded, not run (R10)</span>
              </div>
              <p className="small soft">Nine obligation classes from configuration. They run on their own clocks and triggers, so they belong to a separate module the MVP reserves. Empty cells are questions, never an absence of duty.</p>
              <table className="data compact">
                <thead><tr><th>#</th><th>Class</th><th>Fields</th><th>Unresolved</th></tr></thead>
                <tbody>
                  {duties.map((d) => (
                    <tr key={d.number}>
                      <td>{d.number}</td>
                      <td><details className="fold"><summary>{d.name}</summary>{d.note && <p className="small soft">{d.note}</p>}{d.fields.map((f) => <RegBlock key={f.key} reg={f.reg} text={f.key.replace(/_/g, " ")} compact />)}</details></td>
                      <td>{d.fields.length}</td>
                      <td>{d.unknownCount ? <span className="ev unknown"><span className="m">?</span>{d.unknownCount}</span> : <span className="mute">0</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>

        <aside className="stack">
          <section className="card sticky" tabIndex={0}>
            <h3>Facts on file</h3>
            <dl className="kv">
              <dt>Purpose</dt><dd>{show(c.facts.purpose)}</dd>
              <dt>Activity</dt><dd>{c.facts.activity === undefined ? <NotYet /> : activityQuestion(cfg).options.find((o) => o.id === c.facts.activity)?.label ?? c.facts.activity}</dd>
              <dt>Provenance</dt><dd>{show(c.facts.provenance)}</dd>
              <dt>Applicant</dt><dd>{show(c.facts.applicantType)}</dd>
              <dt>Exchange</dt><dd>{show(c.facts.exchange)}</dd>
              <dt>Community-held</dt><dd>{c.facts.communityHeld}</dd>
              <dt>TK involved</dt><dd>{c.facts.tkInvolved}</dd>
              {cfg.scope.questions.filter((q) => q.fact !== "activity").map((q) => {
                const v = readFact(c.facts, q.fact);
                if (v === undefined) return null;
                const label = q.options.find((o) => o.id === String(v))?.label ?? String(v);
                return <div key={q.id} style={{ display: "contents" }}><dt>{q.prompt}</dt><dd>{label}</dd></div>;
              })}
            </dl>
            <details className="fold" style={{ marginTop: 8 }}>
              <summary>Edit intake facts</summary>
              <FactsForm cfg={cfg} caseId={c.id} facts={c.facts} mode="intake" canEdit={canEdit} />
            </details>
            <details className="fold">
              <summary>Record a change of intent</summary>
              <FactsForm cfg={cfg} caseId={c.id} facts={c.facts} mode="change" canEdit={canSign} />
            </details>
            {c.changeOfIntent.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <h4>Changes of intent</h4>
                <ol className="timeline">{c.changeOfIntent.map((e) => <li key={e.id}><time>{fmtTime(e.at)}</time> {e.description}<div className="mute">Consequence ({e.consequencePolicy.replace("_", " ")}): {e.consequenceText}</div></li>)}</ol>
              </div>
            )}
            <hr className="rule" />
            <h4>Escalations on this case</h4>
            {escalations.length === 0 && <p className="small mute">None.</p>}
            {escalations.map((e) => (
              <div key={e.id} className="small" style={{ marginBottom: 6 }}>
                {e.status === "open" ? <span className="ev unknown"><span className="m">?</span>open</span> : <span className="tag">{e.status}</span>} {e.question.slice(0, 120)}{e.question.length > 120 ? "…" : ""}
                <div className="mute">→ {e.owner}{e.ownerName ? ` (${e.ownerName})` : ", name pending"}</div>
                {e.status !== "open" && e.answer && <div className="mute">{e.answer.note}</div>}
              </div>
            ))}
            <hr className="rule" />
            <h4>Human assistance</h4>
            <p className="small soft">Escalation is optional and external. Where a step stops, it routes to the parties&apos; own counsel or to a paid or partner-provided adviser. There is no GENE-LINK review queue holding the journey open.</p>
            {canEdit && (
              <form action={requestSupportHere} className="stack">
                <select name="kind" aria-label="Type of assistance requested"><option value="expert">Expert assistance: parties&apos; own adviser</option><option value="technical">Technical issue: GENE-LINK support</option></select>
                <textarea name="note" placeholder="What do you need?" />
                <button className="btn small secondary" type="submit">Request</button>
              </form>
            )}
            {c.supportRequests.length > 0 && <ol className="timeline" style={{ marginTop: 8 }}>{c.supportRequests.map((r) => <li key={r.id}><time>{fmtTime(r.at)}</time> {r.kind}: {r.note}<div className="mute">{r.routedTo}</div></li>)}</ol>}
            <p className="small mute">Attaching an adviser or broker as a participant on a case is MVP work behind the same seat model. The prototype records the request and does not attach anyone.</p>
            {isAdmin && (
              <>
                <hr className="rule" />
                <h4>Administrator intervention</h4>
                <form action={adminInterveneHere} className="stack">
                  <input name="action" type="text" placeholder="What you did (e.g. contacted both parties)" required />
                  <input name="reason" type="text" placeholder="Reason, recorded in the audit chain" required />
                  <button className="btn small ghost" type="submit">Record intervention</button>
                </form>
              </>
            )}
            <hr className="rule" />
            <p className="small mute">Audit: every consequential action on this case is in the <Link href={`/cases/${c.id}/audit`}>hash-chained log</Link>.</p>
          </section>
        </aside>
      </div>
    </div>
  );
}

const FACT_LABEL: Record<string, string> = {
  purpose: "purpose (commercial or non-commercial)",
  activity: "what will be done with the material or the data",
  provenance: "material provenance",
  exchange: "material-exchange scenario",
};

function NotYet() {
  return <span className="mute">not yet established</span>;
}

function show(v: string | undefined) {
  return v === undefined ? <NotYet /> : v.replaceAll("_", " ");
}
