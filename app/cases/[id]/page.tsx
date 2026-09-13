import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform } from "@/core";
import { adminIntervene, requestSupport } from "@/app/actions";
import { EvidenceChip, EvidenceLegend, RegBlock } from "@/components/Evidence";
import { ErrorNotice, InformationNotAdvice, Notice, OpenMarker, PageHead, PersonaRequired, fmtTime } from "@/components/ui";
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
  if (session.kind === "anonymous") return <div className="container"><PersonaRequired next={`/cases/${id}`} /></div>;

  const isAdmin = session.kind === "admin";
  const seat = session.kind === "seat" ? session.actor.seat : null;
  const participant = isAdmin || c.participants.some((p) => p.organisationId === seat!.organisationId);
  if (!participant) {
    return (
      <div className="container">
        <Notice kind="halt"><strong>Permission boundary.</strong> Your seat&apos;s organisation is not a participant in this case. Case content is visible to the two organisations, their invited advisers, and administrators acting through recorded interventions.</Notice>
      </div>
    );
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
  const canJudge = isAdmin || canSign;

  // What GENE-LINK told this person, recorded now.
  if (session.kind === "seat") platform.discloseCase(session.actor.person, session.actor.seat, c);

  return (
    <div className="container">
      <PageHead eyebrow={`Case · provider country ${cfg.name}${cfg.code === "BR" ? " · dry run" : ""}`} title={c.title}>
        <div className="row">
          {c.participants.map((p) => <span key={p.organisationId} className="tag"><Link href={`/organisations/${p.organisationId}`}>{orgs.get(p.organisationId)?.name}</Link> · {p.role}</span>)}
          <span className="small mute">Opened {fmtTime(c.createdAt)}{c.revealedAt ? `, identities revealed symmetrically ${fmtTime(c.revealedAt)}` : ""}</span>
        </div>
      </PageHead>
      <ErrorNotice error={sp.error} />

      {cfg.operativeInstrumentStatus.state === "unknown" && (
        <Notice kind="pending">
          <OpenMarker /> <strong>The operative instrument for {cfg.name} is not settled.</strong> {cfg.operativeInstrumentStatus.note} <EvidenceChip reg={cfg.operativeInstrumentStatus} short />
        </Notice>
      )}

      <div className="two-col" style={{ marginTop: 14 }}>
        <div className="stack">
          {/* Scope answer */}
          <section className={`card ${pathway.scope.kind === "out_of_scope" ? "warn" : pathway.scope.kind === "escalate" ? "warn" : "tinted"}`}>
            <div className="row between">
              <h3 style={{ margin: 0 }}>Scope on the facts entered: {pathway.scope.kind.replace("_", " ")}</h3>
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
              {pathway.stages.map((s) => (
                <StageCard
                  key={s.stage.id}
                  stage={s}
                  c={c}
                  documents={documents}
                  escalations={escalations}
                  manualReviews={manualReviews}
                  canEdit={canEdit}
                  canJudge={canJudge}
                  learning={learning.filter((l) => l.stageIds.includes(s.stage.id) && (l.countryCodes.includes("*") || l.countryCodes.includes(cfg.code)))}
                />
              ))}
            </section>
          )}

          {pathway.scope.kind !== "out_of_scope" && <MachinePanel cfg={cfg} c={c} canAct={canEdit || isAdmin} isAdmin={isAdmin} />}
          {pathway.scope.kind !== "out_of_scope" && <InstrumentsPanel cfg={cfg} c={c} instruments={instruments} canSign={canSign} isAdmin={isAdmin} />}
          {pathway.scope.kind !== "out_of_scope" && <AgreementsPanel c={c} agreements={agreements} orgs={orgs} mySeat={seat} canEdit={canEdit} canSign={canSign} />}

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
          <section className="card sticky">
            <h3>Facts on file</h3>
            <dl className="kv">
              <dt>Purpose</dt><dd>{c.facts.purpose.replace("_", " ")}</dd>
              <dt>Activity</dt><dd>{cfg.scope.questions[0].options.find((o) => o.id === c.facts.activity)?.label ?? c.facts.activity}</dd>
              <dt>Provenance</dt><dd>{c.facts.provenance.replace("_", " ")}</dd>
              <dt>Applicant</dt><dd>{c.facts.applicantType.replace("_", " ")}</dd>
              <dt>Exchange</dt><dd>{c.facts.exchange.replace("_", " ")}</dd>
              <dt>Community-held</dt><dd>{c.facts.communityHeld}</dd>
              <dt>TK involved</dt><dd>{c.facts.tkInvolved}</dd>
              {c.facts.localities && <><dt>Localities</dt><dd>{c.facts.localities}</dd></>}
            </dl>
            <details className="fold" style={{ marginTop: 8 }}>
              <summary>Edit intake facts</summary>
              <FactsForm cfg={cfg} caseId={c.id} facts={c.facts} mode="intake" canEdit={canEdit} />
            </details>
            <details className="fold">
              <summary>Record a change of intent</summary>
              <FactsForm cfg={cfg} caseId={c.id} facts={c.facts} mode="change" canEdit={canEdit} />
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
                <span className="ev unknown"><span className="m">?</span>{e.status}</span> {e.question.slice(0, 120)}{e.question.length > 120 ? "…" : ""}
                <div className="mute">→ {e.owner}{e.ownerName ? ` (${e.ownerName})` : ", name pending"}</div>
              </div>
            ))}
            <hr className="rule" />
            <h4>Human assistance</h4>
            <p className="small soft">Escalation is optional and external. Where a step stops, it routes to the parties&apos; own counsel or to a paid or partner-provided adviser. There is no GENE-LINK review queue holding the journey open.</p>
            {canEdit && (
              <form action={requestSupport} className="stack">
                <input type="hidden" name="caseId" value={c.id} />
                <select name="kind"><option value="expert">Expert assistance (routes to an adviser)</option><option value="technical">Technical issue (GENE-LINK support)</option></select>
                <textarea name="note" placeholder="What do you need?" />
                <button className="btn small secondary" type="submit">Request</button>
              </form>
            )}
            {c.supportRequests.length > 0 && <ol className="timeline" style={{ marginTop: 8 }}>{c.supportRequests.map((r) => <li key={r.id}><time>{fmtTime(r.at)}</time> {r.kind}: {r.note}<div className="mute">Routed to: {r.routedTo}</div></li>)}</ol>}
            {isAdmin && (
              <>
                <hr className="rule" />
                <h4>Administrator intervention</h4>
                <form action={adminIntervene} className="stack">
                  <input type="hidden" name="caseId" value={c.id} />
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
