import Link from "next/link";
import type { ResolvedStage } from "@/core/engine/pathway";
import type { Case, CaseDocument, EscalationRecord, ManualReviewRecord } from "@/core/domain/types";
import { EvidenceChip, RegBlock } from "@/components/Evidence";
import { markStage, uploadDocument, decideManualReview } from "@/app/actions";
import { fmtTime } from "@/components/ui";

export function StageCard({
  stage, c, documents, escalations, manualReviews, canEdit, canComplete, canJudge, learning, upstreamHalted, completionWaitsOn,
}: {
  stage: ResolvedStage;
  c: Case;
  documents: CaseDocument[];
  escalations: EscalationRecord[];
  manualReviews: ManualReviewRecord[];
  canEdit: boolean;
  canComplete: boolean;
  canJudge: boolean;
  learning: { id: string; title: string; status: string }[];
  upstreamHalted: boolean;
  /** Set when the stage is complete only once the record says so (a regulator outcome, a recorded instrument). */
  completionWaitsOn?: string;
}) {
  const progress = c.stageProgress[stage.stage.id] ?? "not_started";
  const cls = stage.status === "halted" || stage.status === "stopped" ? "halted" : stage.status === "informational" ? "informational" : progress === "complete" ? "complete" : "";
  const judgeHere = decideManualReview.bind(null, c.id);
  const uploadHere = uploadDocument.bind(null, c.id);
  const markHere = markStage.bind(null, c.id);
  return (
    <div className={`stage ${cls}`} id={`stage-${stage.stage.id}`}>
      <div className="num" aria-hidden="true">{stage.index + 1}</div>
      <div className={`stage-card ${stage.status === "halted" || stage.status === "stopped" ? "halted" : ""}`}>
        <div className="stage-head">
          <span className={`subject ${stage.stage.subject}`}>{SUBJECT_LABEL[stage.stage.subject]}</span>
          <h3>{stage.stage.title}</h3>
          {stage.status === "stopped" && <span className="status-pill halted">Stopped · a prohibition applies on these facts</span>}
          {stage.status === "halted" && <span className="status-pill halted">{stage.escalations.every((e) => e.kind === "unanswered_fact") && !stage.manualReviews.length ? "Halted · waiting on a fact" : "Halted · routed to a named person"}</span>}
          {stage.status === "informational" && <span className="status-pill informational">Phase two · recorded, not run</span>}
          {stage.status === "active" && <span className={`status-pill ${progress === "complete" ? "complete" : progress === "in_progress" ? "in_progress" : "active"}`}>{progress.replace("_", " ")}</span>}
        </div>
        <div className="stage-body">
          <dl className="trig">
            <dt>Trig</dt><dd>{stage.stage.trig}</dd>
            <dt>Who</dt><dd>{stage.stage.who}</dd>
            {stage.stage.needs.length > 0 && <><dt>Needs</dt><dd>{stage.stage.needs.join(" · ")}</dd></>}
            <dt>Gives</dt><dd>{stage.stage.gives}</dd>
          </dl>

          {stage.stops.map((x) => (
            <div className="halt-box" key={x.requirementId} role="status">
              <strong>Stop.</strong> {x.text} <EvidenceChip reg={x.reg} short /> <span className="mono mute">{x.reg.citation}</span>
              <div className="small" style={{ marginTop: 6 }}>
                {x.reg.value} This is established law on the facts entered, not an open question, so nothing is routed for an answer. If the facts are wrong, correct them on the intake form; if the project changes, record a change of intent.
              </div>
            </div>
          ))}

          {stage.escalations.map((e) => {
            if (e.kind === "unanswered_fact") {
              return (
                <div className="halt-box" key={e.id} role="status">
                  <strong>Halted on an unanswered fact.</strong> {e.question}
                  <div className="small" style={{ marginTop: 6 }}>
                    This is the parties&apos; question, not a legal unknown{e.owner && !/intake form/.test(e.owner) ? ` (established by: ${e.owner})` : ""}: answer it on the intake form and the stage resumes. The engine does not choose an answer for you.
                  </div>
                </div>
              );
            }
            const rec = escalations.find((r) => r.id === `esc_${c.id}_${e.id}`);
            return (
              <div className="halt-box" key={e.id} role="status">
                <strong>Halted on an unresolved requirement.</strong> {e.question}
                <div className="small" style={{ marginTop: 6 }}>
                  Routed to <strong>{e.owner}</strong>{e.ownerName ? ` (${e.ownerName})` : " · name pending Landscape Alliance"}.
                  {rec && <> Raised {fmtTime(rec.raisedAt)}. Status: {rec.status}.</>}
                  {" "}The answer is a configuration change with legal review, never an in-case override. Silently applying either possible answer would be a defect.
                  {" "}Next step: the named owner answers; this stage resumes when the configuration records it. Nothing else unblocks it.
                </div>
              </div>
            );
          })}

          {stage.manualReviews.map((m) => {
            const rec = manualReviews.find((r) => r.reviewId === m.id);
            return (
              <div className="halt-box" key={m.id}>
                <strong>Manual review (R5): a judgment no system can make.</strong> {m.question}
                <div className="small" style={{ marginTop: 4 }}>Decides: {m.decides} <EvidenceChip reg={m.reg} short /></div>
                {rec?.status === "decided" && rec.decision && (
                  <div className="small" style={{ marginTop: 6 }}><strong>Decided</strong> by {rec.decision.by} on {fmtTime(rec.decision.at)}: {rec.decision.outcome}. Reason: {rec.decision.reason}. <span className="mute">Immutable. A party to the case cannot record or overwrite this judgment.</span></div>
                )}
                {rec?.status === "pending_human_judgment" && (
                  canJudge ? (
                    <form action={judgeHere} className="row" style={{ marginTop: 8 }}>
                      <input type="hidden" name="recordId" value={rec.id} />
                      <input name="outcome" type="text" aria-label="Judgment" placeholder="Judgment (free text)" required style={{ flex: 1, minWidth: 180 }} />
                      <input name="reason" type="text" aria-label="Reason for the judgment" placeholder="Reason, recorded in the audit chain" required style={{ flex: 2, minWidth: 220 }} />
                      <button className="btn small" type="submit">Record judgment (once, immutable)</button>
                    </form>
                  ) : (
                    <div className="small mute" style={{ marginTop: 6 }}>Pending a human judgment with a recorded reason. It is recorded by the reviewer seat (the administrator in this prototype; which named seat holds it is an open decision), never by a party to the case. A party recording it would be self-declaration under another name.</div>
                  )
                )}
              </div>
            );
          })}

          {stage.requirements.length > 0 && (
            <details className="fold" open={stage.status === "halted" || stage.requirements.length <= 3}>
              <summary>{stage.requirements.length} requirement statement{stage.requirements.length === 1 ? "" : "s"}, each with its evidence class</summary>
              {stage.requirements.map((r) => <RegBlock key={r.id} reg={r.reg} text={r.text} compact answered={r.answeredByJudgment} />)}
            </details>
          )}

          {stage.consentParties.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <h4>Consent parties</h4>
              {stage.consentParties.map((p) => <RegBlock key={p.id} reg={p.reg} text={p.label} compact />)}
            </div>
          )}

          {stage.documents.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <h4>Documents this stage needs</h4>
              <table className="data compact">
                <thead><tr><th>Document</th><th>Basis</th><th>On file</th><th>Add</th></tr></thead>
                <tbody>
                  {stage.documents.map((d) => {
                    const onFile = documents.filter((x) => x.requirementId === d.id);
                    return (
                      <tr key={d.id}>
                        <td>{d.label}</td>
                        <td><RegBlock reg={d.reg} compact /></td>
                        <td>
                          {onFile.length === 0 && <span className="mute">Missing</span>}
                          {onFile.map((f) => <div key={f.id} className="small"><strong>{f.fileName}</strong> <span className="mono mute">{f.sha256.slice(0, 12)}…</span><div className="mute">present, {fmtTime(f.uploadedAt)}. Presence recorded and hashed; the platform never judges sufficiency. File-type checks arrive with real file storage in the MVP.</div></div>)}
                        </td>
                        <td>
                          {canEdit ? (
                            <details className="fold">
                              <summary className="small">Upload</summary>
                              <form action={uploadHere} className="stack">
                                <input type="hidden" name="requirementId" value={d.id} />
                                <input type="hidden" name="label" value={d.label} />
                                <input name="fileName" type="text" aria-label="File name of the document" placeholder="file name" />
                                <textarea name="content" aria-label="Document text" placeholder="Paste document text. The prototype stores the SHA-256, not the file. 256 KB limit." required />
                                <button className="btn small" type="submit">Record document</button>
                              </form>
                            </details>
                          ) : <span className="small mute">read only</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {learning.length > 0 && (
            <p className="small mute" style={{ marginTop: 10 }}>
              Learning: {learning.map((l) => <span key={l.id}><Link href="/learn">{l.title}</Link> ({l.status === "available" ? "available" : "pending content"}) </span>)}
            </p>
          )}

          {stage.status === "active" && canEdit && (
            <form action={markHere} className="row" style={{ marginTop: 10 }}>
              <input type="hidden" name="stageId" value={stage.stage.id} />
              <span className="small mute">Progress is a human action:</span>
              {(["not_started", "in_progress", "complete"] as const).filter((p) => p !== progress && (p !== "complete" || (canComplete && !upstreamHalted && !completionWaitsOn))).map((p) => (
                <button key={p} className="btn ghost small" type="submit" name="progress" value={p}>Mark {p.replace("_", " ")}</button>
              ))}
            </form>
          )}
          {stage.status === "active" && canEdit && !canComplete && progress !== "complete" && (
            <p className="small mute" style={{ marginTop: 6 }}>Your seat can record work in progress. Marking a stage complete is a claim the organisation stands behind, so it takes an authorised signatory or administrator seat.</p>
          )}
          {stage.status === "active" && canComplete && !upstreamHalted && completionWaitsOn && progress !== "complete" && (
            <p className="small mute" style={{ marginTop: 6 }}>Complete when the record says so: this stage waits on {completionWaitsOn}.</p>
          )}
          {stage.status === "active" && canComplete && upstreamHalted && progress !== "complete" && (
            <p className="small mute" style={{ marginTop: 6 }}>An earlier stage is halted. This one can be prepared, but it cannot be marked complete until the open question is answered through configuration review.</p>
          )}
          {stage.status === "halted" && <p className="small mute" style={{ marginTop: 10 }}>This stage cannot be marked complete while it is halted. The engine refuses.</p>}
          {stage.status === "stopped" && <p className="small mute" style={{ marginTop: 10 }}>This stage cannot be marked complete while the prohibition applies, and no later stage can either. The engine refuses.</p>}
        </div>
      </div>
    </div>
  );
}

const SUBJECT_LABEL: Record<string, string> = {
  government: "Government body decides",
  community: "Community consent and TK",
  money: "Money changes hands",
  prohibition: "Prohibition or offence",
  platform: "GENE-LINK",
  applicant: "Applicant",
};
