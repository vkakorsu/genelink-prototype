import type { Agreement, Case, Organisation } from "@/core/domain/types";
import { approveAgreement, createAgreement, executeAgreement, reviseAgreement } from "@/app/actions";
import { MODEL_CLAUSES } from "@/lib/clauses";
import { fmtTime } from "@/components/ui";
import { canonicalAgreementText } from "@/core/domain/agreements";
import { getPlatform } from "@/core";
import { seatLabel, sentence } from "@/lib/labels";

export function AgreementsPanel({ c, agreements, orgs, mySeat, canEdit, canSign, seatPermission }: {
  c: Case;
  agreements: Agreement[];
  orgs: Map<string, Organisation>;
  mySeat: { organisationId: string } | null;
  canEdit: boolean;
  canSign: boolean;
  seatPermission: string | null;
}) {
  const parties = c.participants.filter((p) => p.role === "demand" || p.role === "supply");
  const approveHere = approveAgreement.bind(null, c.id);
  const executeHere = executeAgreement.bind(null, c.id);
  const reviseHere = reviseAgreement.bind(null, c.id);
  const createHere = createAgreement.bind(null, c.id);
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Agreement development and execution</h3>
        <span className="small mute">Templates, versions, approvals, then a hashed record</span>
      </div>
      {agreements.length === 0 && <p className="small mute">No draft yet. {canEdit ? "Assemble one from model clauses below." : `Drafting begins with a member or higher seat in a participant organisation; ${seatPermission ? `your seat is ${seatPermission}` : "you hold no seat in one"}.`} Off-platform negotiation is supported: upload a revised draft as a new version and nothing is lost.</p>}

      {agreements.map((a) => {
        const latest = a.versions[a.versions.length - 1];
        const myApproved = mySeat ? a.approvals.some((ap) => ap.organisationId === mySeat.organisationId && ap.versionNumber === latest.version) : false;
        const myExecuted = mySeat ? a.executions.some((e) => e.organisationId === mySeat.organisationId && e.versionNumber === latest.version) : false;
        return (
          <div key={a.id} className="card flat" style={{ marginTop: 10 }}>
            <div className="row between">
              <div><strong>{a.title}</strong><div className="small mute">v{latest.version} · {latest.summary} · {latest.origin === "uploaded_off_platform" ? "negotiated off the platform" : "drafted on the platform"} · <span className="mono">{latest.sha256.slice(0, 16)}…</span></div></div>
              <span className={`status-pill ${a.status === "executed" || a.status === "recorded" ? "complete" : a.status === "approved" ? "active" : "in_progress"}`}>{sentence(a.status)}</span>
            </div>
            <p className="small" style={{ margin: "4px 0" }}>
              <a download={`${a.id}-v${latest.version}.txt`} href={`data:text/plain;charset=utf-8,${encodeURIComponent(canonicalAgreementText(latest.version, latest.clauses))}`}>Download the exact text of v{latest.version}</a>
              <span className="mute"> · the text this version&apos;s hash covers. Anyone holding it can check it on <a href="/verify">Verify</a>. SHA-256 <span className="mono">{latest.sha256}</span></span>
            </p>
            <details className="fold">
              <summary>Clauses ({latest.clauses.length})</summary>
              {latest.clauses.map((cl) => (
                <div key={cl.id} className="reg" style={{ borderLeftColor: cl.source === "illustrative" ? "var(--ev-inferred)" : cl.source === "negotiated" ? "var(--ev-gl)" : "var(--forest)" }}>
                  <div className="row"><strong className="small">{cl.title}</strong><span className="tag">{sentence(cl.source)}</span></div>
                  <p className="small" style={{ margin: "4px 0 0" }}>{cl.text}</p>
                </div>
              ))}
              {a.versions.length > 1 && (
                <ol className="timeline" style={{ marginTop: 8 }}>
                  {a.versions.map((v) => <li key={v.version}><time>{fmtTime(v.at)}</time> v{v.version} · {v.summary} <span className="mute">({v.origin.replace(/_/g, " ")})</span></li>)}
                </ol>
              )}
            </details>
            <table className="data compact" style={{ marginTop: 8 }}>
              <thead><tr><th>Organisation</th><th>Approval (v{latest.version})</th><th>Execution</th></tr></thead>
              <tbody>
                {parties.map((p) => {
                  const ap = a.approvals.find((x) => x.organisationId === p.organisationId && x.versionNumber === latest.version);
                  const ex = a.executions.find((x) => x.organisationId === p.organisationId);
                  return (
                    <tr key={p.organisationId}>
                      <td>{orgs.get(p.organisationId)?.name} <span className="mute">({p.role === "demand" ? "demand side" : "supply side"})</span></td>
                      <td>{ap ? `Approved ${fmtTime(ap.at)} by ${seatLabel(getPlatform(), ap.seatId)}` : <span className="mute">Not yet</span>}</td>
                      <td>{ex ? <>Signed {fmtTime(ex.at)} by {seatLabel(getPlatform(), ex.seatId)} · {ex.method === "platform_click_to_sign" ? "click to sign on the platform" : "recorded from outside"} · fingerprint <span className="mono">{ex.sha256.slice(0, 12)}…</span></> : <span className="mute">Not yet</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 8 }}>
              {canSign && a.status !== "executed" && !myApproved && (
                <form action={approveHere}><input type="hidden" name="agreementId" value={a.id} /><input type="hidden" name="version" value={latest.version} /><button className="btn small secondary" type="submit">Approve v{latest.version} for my organisation</button></form>
              )}
              {canSign && a.status === "approved" && !myExecuted && (
                <form action={executeHere}><input type="hidden" name="agreementId" value={a.id} /><input type="hidden" name="sha256" value={latest.sha256} /><button className="btn small" type="submit" title="Simple electronic signature: an authenticated signatory-level seat records assent to this document hash">Execute (click to sign v{latest.version})</button></form>
              )}
              {canSign && a.status !== "approved" && a.status !== "executed" && (
                <span className="small mute">Execution unlocks when both organisations have approved v{latest.version}.</span>
              )}
              {canEdit && a.status !== "executed" && a.executions.length > 0 && (
                <span className="small mute">The text is fixed: a party has signed v{a.executions[0].versionNumber}. Changed terms need a new agreement.</span>
              )}
              {canEdit && a.status !== "executed" && a.executions.length === 0 && (
                <details className="fold">
                  <summary className="small">Revise (on or off platform)</summary>
                  <form action={reviseHere} className="stack">
                    <input type="hidden" name="agreementId" value={a.id} />
                    <input name="summary" type="text" aria-label="What changed in this version" placeholder="What changed in this version" required />
                    <textarea name="negotiated" aria-label="Negotiated clause text to add (optional)" placeholder="Negotiated clause text to add (optional)" />
                    <label className="row small" style={{ fontWeight: 400 }}><input type="checkbox" name="offPlatform" value="1" style={{ width: "auto" }} /> This revision was negotiated off platform and is being recorded</label>
                    <button className="btn small ghost" type="submit">Record new version</button>
                    <p className="small mute">A new version resets approvals. Approvals attach to a version, not to the agreement.</p>
                  </form>
                </details>
              )}
              {a.status === "executed" && <span className="small soft">Executed versions are immutable. Amendments are recorded as new instrument versions or a new agreement.</span>}
              {!canSign && a.status !== "executed" && <span className="small mute">Approval and execution require an authorised signatory or administrator seat in a participant organisation. {seatPermission ? `Your seat is ${seatPermission}.` : "You hold no seat in one."}</span>}
            </div>
          </div>
        );
      })}

      {canEdit && (
        <details className="fold" style={{ marginTop: 12 }}>
          <summary>Assemble a new draft from model clauses</summary>
          <form action={createHere} className="stack">
            <div className="field"><label htmlFor="title">Title</label><input id="title" name="title" type="text" defaultValue="Draft benefit-sharing and access terms" /></div>
            <div className="radio-list">
              {MODEL_CLAUSES.map((cl) => (
                <label key={cl.id}><input type="checkbox" name="clause" value={cl.id} defaultChecked style={{ width: "auto" }} /> <span><strong>{cl.title}</strong> <span className="tag">{sentence(cl.source)}</span><div className="small mute">{cl.text}</div></span></label>
              ))}
            </div>
            <button className="btn small" type="submit">Create draft v1</button>
            <p className="small mute">Model clause content is illustrative. Real clauses come from Landscape Alliance&apos;s legal partners and are versioned content, not code.</p>
          </form>
        </details>
      )}
      <p className="small mute" style={{ marginTop: 10 }}>Execution here is a simple electronic signature under eIDAS Article 25: an authenticated authorised signatory records assent to a specific document hash, chained into the audit log. Qualified signatures are an optional item behind the same signing adapter.</p>
    </section>
  );
}
