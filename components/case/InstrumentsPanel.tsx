import type { CountryConfig } from "@/core/config/schema";
import type { Case, Instrument } from "@/core/domain/types";
import { FROZEN_STATUSES, renewalProbeAllowed } from "@/core/domain/instruments";
import { isGranted } from "@/core/engine/stateMachine";
import { amendInstrument, recordInstrument, setInstrumentStatus } from "@/app/actions";
import { EvidenceChip, RegBlock } from "@/components/Evidence";
import { fmtTime, stateHeadline } from "@/components/ui";

export function InstrumentsPanel({ cfg, c, instruments, canSign, isAdmin, seatPermission }: {
  cfg: CountryConfig;
  c: Case;
  instruments: Instrument[];
  canSign: boolean;
  isAdmin: boolean;
  seatPermission: string | null;
}) {
  const probe = renewalProbeAllowed(cfg);
  const amendHere = amendInstrument.bind(null, c.id);
  const statusHere = setInstrumentStatus.bind(null, c.id);
  const recordHere = recordInstrument.bind(null, c.id);
  const awaiting = instruments.filter((i) => i.status === "awaiting_record");
  const recorded = instruments.filter((i) => i.versions.length > 0);
  const caseState = cfg.stateMachine.states[c.machine.state];
  const caseEnded = caseState?.kind === "terminal" && caseState.outcome !== "granted";
  const stillNeed = cfg.outputs.some((o) => {
    const have = instruments.find((i) => i.outputId === o.id);
    return !have || have.versions.length === 0;
  });
  const canRecord = stillNeed && (isGranted(cfg, c.machine) || awaiting.length > 0);
  const gate = canSign ? null : isAdmin ? "Administrators watch and intervene. Recording an instrument is the applicant organisation's act." : `Requires an authorised signatory or administrator seat in a participant organisation. Your seat is ${seatPermission ?? "none"}.`;
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>What the applicant holds</h3>
        <span className="small mute">&ldquo;Permit&rdquo; is not one object across regimes (A5.4)</span>
      </div>
      <p className="small soft">This country&apos;s journey ends in: {cfg.outputs.map((o) => `${o.label} (${o.issuer})`).join(" and ")}. Amendment policy: <strong>{cfg.outputs[0].amendmentPolicy.replace("_", " ")}</strong>.{cfg.outputs.length > 1 && <> The applicant holds nothing usable until <strong>all {cfg.outputs.length}</strong> are externally recorded, each from its own issuer. Recording one never satisfies the other.</>}</p>

      {!probe.allowed && <p className="small soft"><strong>Term and renewal:</strong> {probe.reason}</p>}

      {instruments.length === 0 && <p className="small mute">No instrument recorded yet. When the regulator state machine reaches a granted state the instruments this regime issues appear here as awaiting record. The platform holds no copy until an authorised signatory records the document the State issued. It never creates one.</p>}
      {awaiting.length > 0 && (
        <div className="halt-box" role="status">
          <strong>{recorded.length} of {instruments.length} recorded.</strong> Awaiting: {awaiting.map((a) => `${a.label} from ${a.issuer}`).join("; ")}. Recording is an authorised signatory&apos;s act, below.
        </div>
      )}

      {instruments.map((inst) => (
        <div key={inst.id} className={`card flat ${inst.status === "awaiting_record" ? "warn" : ""}`} style={{ marginTop: 10 }}>
          <div className="row between">
            <div>
              <strong>{inst.label}</strong> <span className="small mute">· {inst.issuer}</span>
              <div className="small">Status: <span className={`status-pill ${inst.status === "awaiting_record" ? "active" : inst.status === "verification_open" || inst.status === "correction_required" ? "in_progress" : FROZEN_STATUSES.has(inst.status) ? "halted" : "complete"}`}>{inst.status.replace(/_/g, " ")}</span>{inst.versions.length > 0 && <> · origin {inst.origin.replace(/_/g, " ")} · {inst.versions.length} version{inst.versions.length === 1 ? "" : "s"}</>}</div>
            </div>
            <span className="tag">{inst.kind.replace("_", " ")}</span>
          </div>
          {inst.status === "awaiting_record" && <p className="small soft" style={{ margin: "6px 0 0" }}>The regime says this instrument now exists. The platform has no hash for it because it has no copy. Nothing here is fabricated.</p>}
          {inst.versions.length > 0 && (
            <ol className="timeline" style={{ marginTop: 8 }}>
              {inst.versions.map((v) => (
                <li key={v.version}><time>{fmtTime(v.at)}</time> <strong>v{v.version} · {v.kind}</strong> {v.summary} <span className="mono mute small">{v.sha256.slice(0, 16)}…</span></li>
              ))}
            </ol>
          )}
          {inst.amendmentPolicy === "addendum" && <p className="small soft">One contract, many versions (R7). An otrosí appends a version. It never creates an unrelated second record.</p>}
          {inst.amendmentPolicy === "new_application" && <p className="small soft">A change of purpose, locality or quantity requires notification and a new application. This instrument stays intact.</p>}
          {inst.amendmentPolicy === "new_registration" && <p className="small soft">A change of material or objective requires a new cadastro. One registration otherwise supports multiple downstream acts.</p>}
          {caseEnded && !FROZEN_STATUSES.has(inst.status) && <p className="small soft">The case has reached &ldquo;{caseState.label}&rdquo;. No further version can be recorded against this instrument.</p>}
          {canSign && !FROZEN_STATUSES.has(inst.status) && !caseEnded && (
            <div className="row" style={{ marginTop: 8 }}>
              <form action={amendHere} className="row">
                <input type="hidden" name="instrumentId" value={inst.id} />
                <input name="summary" type="text" placeholder={inst.amendmentPolicy === "addendum" ? "Otrosí summary" : "Describe the modification"} required style={{ minWidth: 240 }} />
                <button className="btn small secondary" type="submit">{inst.amendmentPolicy === "addendum" ? "Record addendum" : "Attempt modification"}</button>
              </form>
            </div>
          )}
          {(() => {
            const out = cfg.outputs.find((o) => o.id === inst.outputId);
            if (!out?.verificationOpenAfterIssue) return null;
            const verifier = out.verifier ?? "The verifying authority";
            if (isAdmin && inst.versions.length > 0) {
              return (
                <form action={statusHere} className="row" style={{ marginTop: 8 }}>
                  <input type="hidden" name="instrumentId" value={inst.id} />
                  <input type="hidden" name="note" value={`${verifier} outcome recorded on the authority's behalf`} />
                  <button className="btn small ghost" type="submit" name="status" value="verified">{verifier}: verified</button>
                  <button className="btn small ghost" type="submit" name="status" value="correction_required">{verifier}: correction required</button>
                  <button className="btn small ghost" type="submit" name="status" value="cancelled">{verifier}: cancelled</button>
                </form>
              );
            }
            if (!isAdmin && canSign) return <p className="small mute" style={{ marginTop: 8 }}>{verifier}&apos;s verification outcome is recorded by the reviewer seat, never by a party to the case.</p>;
            return null;
          })()}
        </div>
      ))}

      <details className="fold" style={{ marginTop: 12 }}>
        <summary>Configured outputs for {cfg.name}: term, renewal, fee</summary>
        {cfg.outputs.map((o) => (
          <div key={o.id} className="card flat" style={{ marginTop: 8 }}>
            <strong>{o.label}</strong> <span className="small mute">· {o.issuer} · issues in state &ldquo;{stateHeadline(cfg.stateMachine.states[o.issuedInState]?.label ?? o.issuedInState)}&rdquo;{o.automatic ? " automatically, recorded on the act itself" : ", recorded by a signatory when received"}</span>
            <RegBlock reg={o.term} text="Term" compact />
            <RegBlock reg={o.renewalsCapped} text="Renewals capped?" compact />
            <RegBlock reg={o.fee} text="Fee" compact />
            {o.ircc && <RegBlock reg={o.ircc} text="Internationally recognised certificate of compliance" compact />}
            {o.notes.map((n, i) => <p key={i} className="small soft">{n}</p>)}
          </div>
        ))}
        <p className="small" style={{ marginTop: 8 }}><strong>Renewal probe:</strong> {probe.reason}</p>
      </details>

      {canSign && !caseEnded && canRecord && (
        <details className="fold" style={{ marginTop: 8 }} open={awaiting.length > 0}>
          <summary>Record an instrument the State issued (upload and hash)</summary>
          <form action={recordHere} className="stack">
            <div className="field">
              <label htmlFor="outputId">Instrument</label>
              <select id="outputId" name="outputId" defaultValue={awaiting[0]?.outputId}>
                {cfg.outputs.map((o) => {
                  const have = instruments.find((i) => i.outputId === o.id);
                  return <option key={o.id} value={o.id} disabled={!!have && have.versions.length > 0}>{o.label}{have?.status === "awaiting_record" ? " · awaiting record" : have && have.versions.length > 0 ? " · already recorded" : ""}</option>;
                })}
              </select>
            </div>
            <input name="fileName" type="text" placeholder="file name (e.g. NEMA-permit-2027-001.pdf)" />
            <textarea name="content" placeholder="Paste the instrument text. The prototype stores the SHA-256 and the record, not the file. 256 KB limit." required />
            <button className="btn small" type="submit">Record instrument</button>
            <p className="small mute">Recorded, not created: the platform preserves an authoritative record of a document it did not issue.</p>
          </form>
        </details>
      )}
      {canSign && !caseEnded && !canRecord && stillNeed && (
        <p className="small mute" style={{ marginTop: 8 }}>Nothing to record. The platform accepts a hash only when the regulator machine is in a granted state, or when it already holds an awaiting-record placeholder. A lapsed clock is not a grant.</p>
      )}
      {gate && <p className="small mute" style={{ marginTop: 8 }}>{gate}</p>}
      <p className="small mute" style={{ marginTop: 8 }}><EvidenceChip reg={cfg.nagoyaParty} short /> {cfg.nagoyaParty.value} <span className="mono mute">{cfg.nagoyaParty.citation}</span></p>
      <p className="small mute">EU side for {cfg.name}: <EvidenceChip reg={cfg.euSide} short /> {cfg.euSide.value ?? cfg.euSide.note}</p>
    </section>
  );
}
