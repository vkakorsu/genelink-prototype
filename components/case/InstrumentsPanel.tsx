import type { CountryConfig } from "@/core/config/schema";
import type { Case, Instrument } from "@/core/domain/types";
import { renewalProbeAllowed } from "@/core/domain/instruments";
import { amendInstrument, recordInstrument, setInstrumentStatus } from "@/app/actions";
import { EvidenceChip, RegBlock } from "@/components/Evidence";
import { fmtTime } from "@/components/ui";

export function InstrumentsPanel({ cfg, c, instruments, canSign, isAdmin }: { cfg: CountryConfig; c: Case; instruments: Instrument[]; canSign: boolean; isAdmin: boolean }) {
  const probe = renewalProbeAllowed(cfg);
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>What the applicant holds</h3>
        <span className="small mute">&ldquo;Permit&rdquo; is not one object across regimes (A5.4)</span>
      </div>
      <p className="small soft">This country&apos;s journey ends in: {cfg.outputs.map((o) => `${o.label} (${o.issuer})`).join(" and ")}. Amendment policy: <strong>{cfg.outputs[0].amendmentPolicy.replace("_", " ")}</strong>.</p>

      {instruments.length === 0 && <p className="small mute">No instrument recorded yet. Instruments issue when the regulator state machine reaches a granted state, or when an authorised signatory records an instrument the State issued.</p>}

      {instruments.map((inst) => (
        <div key={inst.id} className="card flat" style={{ marginTop: 10 }}>
          <div className="row between">
            <div>
              <strong>{inst.label}</strong> <span className="small mute">· {inst.issuer}</span>
              <div className="small">Status: <span className={`status-pill ${inst.status === "verification_open" || inst.status === "correction_required" ? "in_progress" : inst.status === "cancelled" || inst.status === "revoked" ? "halted" : "complete"}`}>{inst.status.replace("_", " ")}</span> · origin {inst.origin.replace("_", " ")} · {inst.versions.length} version{inst.versions.length === 1 ? "" : "s"}</div>
            </div>
            <span className="tag">{inst.kind.replace("_", " ")}</span>
          </div>
          <ol className="timeline" style={{ marginTop: 8 }}>
            {inst.versions.map((v) => (
              <li key={v.version}><time>{fmtTime(v.at)}</time> <strong>v{v.version} · {v.kind}</strong> {v.summary} <span className="mono mute small">{v.sha256.slice(0, 16)}…</span></li>
            ))}
          </ol>
          {inst.amendmentPolicy === "addendum" && <p className="small soft">One contract, many versions (R7). An otrosí appends a version. It never creates an unrelated second record.</p>}
          {inst.amendmentPolicy === "new_application" && <p className="small soft">A change of purpose, locality or quantity requires notification and a new application. This instrument stays intact.</p>}
          {inst.amendmentPolicy === "new_registration" && <p className="small soft">A change of material or objective requires a new cadastro. One registration otherwise supports multiple downstream acts.</p>}
          {canSign && (
            <div className="row" style={{ marginTop: 8 }}>
              <form action={amendInstrument} className="row">
                <input type="hidden" name="caseId" value={c.id} />
                <input type="hidden" name="instrumentId" value={inst.id} />
                <input name="summary" type="text" placeholder={inst.amendmentPolicy === "addendum" ? "Otrosí summary" : "Describe the modification"} required style={{ minWidth: 240 }} />
                <button className="btn small secondary" type="submit">{inst.amendmentPolicy === "addendum" ? "Record addendum" : "Attempt modification"}</button>
              </form>
              {(cfg.outputs.find((o) => o.id === inst.outputId)?.verificationOpenAfterIssue) && (isAdmin || canSign) && (
                <form action={setInstrumentStatus} className="row">
                  <input type="hidden" name="caseId" value={c.id} />
                  <input type="hidden" name="instrumentId" value={inst.id} />
                  <input type="hidden" name="note" value="Verification outcome recorded on the authority's behalf" />
                  <button className="btn small ghost" type="submit" name="status" value="verified">CGen: verified</button>
                  <button className="btn small ghost" type="submit" name="status" value="correction_required">CGen: correction required</button>
                  <button className="btn small ghost" type="submit" name="status" value="cancelled">CGen: cancelled</button>
                </form>
              )}
            </div>
          )}
        </div>
      ))}

      <details className="fold" style={{ marginTop: 12 }}>
        <summary>Configured outputs for {cfg.name}: term, renewal, fee</summary>
        {cfg.outputs.map((o) => (
          <div key={o.id} className="card flat" style={{ marginTop: 8 }}>
            <strong>{o.label}</strong> <span className="small mute">· {o.issuer} · issues in state &ldquo;{cfg.stateMachine.states[o.issuedInState]?.label.split(".")[0]}&rdquo;{o.automatic ? " automatically" : ""}</span>
            <RegBlock reg={o.term} text="Term" compact />
            <RegBlock reg={o.renewalsCapped} text="Renewals capped?" compact />
            <RegBlock reg={o.fee} text="Fee" compact />
            {o.ircc && <RegBlock reg={o.ircc} text="Internationally recognised certificate of compliance" compact />}
            {o.notes.map((n, i) => <p key={i} className="small soft">{n}</p>)}
          </div>
        ))}
        <p className="small" style={{ marginTop: 8 }}><strong>Renewal probe:</strong> {probe.reason}</p>
      </details>

      {canSign && (
        <details className="fold" style={{ marginTop: 8 }}>
          <summary>Record an instrument the State issued (upload and hash)</summary>
          <form action={recordInstrument} className="stack">
            <input type="hidden" name="caseId" value={c.id} />
            <div className="field">
              <label htmlFor="outputId">Instrument</label>
              <select id="outputId" name="outputId">{cfg.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
            </div>
            <input name="fileName" type="text" placeholder="file name (e.g. NEMA-permit-2027-001.pdf)" />
            <textarea name="content" placeholder="Paste the instrument text. The prototype stores the SHA-256 and the record, not the file." required />
            <button className="btn small" type="submit">Record instrument</button>
            <p className="small mute">Requires an authorised signatory seat. Recorded, not created: the platform preserves an authoritative record of a document it did not issue.</p>
          </form>
        </details>
      )}
      <p className="small mute" style={{ marginTop: 8 }}>EU side for {cfg.name}: <EvidenceChip reg={cfg.euSide} short /> {cfg.euSide.value ?? cfg.euSide.note}</p>
    </section>
  );
}
