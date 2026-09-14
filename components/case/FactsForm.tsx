import type { CaseFacts, CountryConfig } from "@/core/config/schema";
import { changeOfIntent, updateFacts } from "@/app/actions";
import { EvidenceChip } from "@/components/Evidence";

const TRI = [["yes", "Yes"], ["no", "No"], ["unclear", "Unclear"]] as const;

export function FactsForm({ cfg, caseId, facts, mode, canEdit }: { cfg: CountryConfig; caseId: string; facts: CaseFacts; mode: "intake" | "change"; canEdit: boolean }) {
  const action = (mode === "intake" ? updateFacts : changeOfIntent).bind(null, caseId);
  const q = cfg.scope.questions[0];
  return (
    <form action={action} className="stack">
      <fieldset>
        <legend>Purpose (decides the route before any {cfg.name} rule applies)</legend>
        <div className="radio-list">
          <label><input type="radio" name="purpose" value="commercial" defaultChecked={facts.purpose === "commercial"} /> Commercial. GENE-LINK access is commercial by design.</label>
          <label><input type="radio" name="purpose" value="non_commercial" defaultChecked={facts.purpose === "non_commercial"} /> Non-commercial. Routed to a stated out-of-scope position, not through rules that do not fit.</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>{q.prompt}</legend>
        <div className="radio-list">
          {q.options.map((o) => (
            <label key={o.id}><input type="radio" name="activity" value={o.id} defaultChecked={facts.activity === o.id} /> <span>{o.label}{o.hint && <span className="small mute"> · {o.hint}</span>}</span></label>
          ))}
        </div>
        <p className="small mute">Deciding fact: the activity the user will perform. Not whether the function is already proven, not whether the material was bought.</p>
      </fieldset>
      <div className="grid cols-fit">
        <div className="field">
          <label htmlFor="provenance">Material provenance</label>
          <select id="provenance" name="provenance" defaultValue={facts.provenance}>
            <option value="in_situ">In situ</option>
            <option value="ex_situ">Held ex situ</option>
            <option value="dsi_only">Digital sequence information only</option>
          </select>
          <div className="hint">For ex situ holdings the place of origin is recorded, not the holding institution.</div>
        </div>
        <div className="field">
          <label htmlFor="applicantType">Applicant (legal personality and nationality)</label>
          <select id="applicantType" name="applicantType" defaultValue={facts.applicantType}>
            <option value="foreign_legal">Foreign legal entity</option>
            <option value="foreign_natural">Foreign natural person</option>
            <option value="national_legal">{cfg.name} legal entity</option>
            <option value="national_natural">{cfg.name} natural person</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="exchange">Material-exchange scenario</label>
          <select id="exchange" name="exchange" defaultValue={facts.exchange}>
            <option value="no_movement">Nothing leaves the country</option>
            <option value="title_transfer">Physical transfer with title</option>
            <option value="service_shipment">Temporary service shipment</option>
            <option value="dsi_only">Sequence data only</option>
          </select>
          <div className="hint">A service shipment is temporary: the material is returned or destroyed after the work.</div>
        </div>
        <div className="field">
          <label htmlFor="localities">Collection localities</label>
          <input id="localities" name="localities" type="number" min={1} max={999} step={1} inputMode="numeric" defaultValue={facts.localities ?? ""} placeholder="1" />
        </div>
      </div>
      <div className="grid cols-fit-sm">
        <fieldset>
          <legend>Resource held by a community or local manager?</legend>
          <div className="radio-list">{TRI.map(([v, l]) => <label key={v}><input type="radio" name="communityHeld" value={v} defaultChecked={facts.communityHeld === v} /> {l}</label>)}</div>
        </fieldset>
        <fieldset>
          <legend>Traditional knowledge involved?</legend>
          <p className="small mute" style={{ marginTop: 0 }}>Adds a consent party. Never decides whether consent is needed.</p>
          <div className="radio-list">{TRI.map(([v, l]) => <label key={v}><input type="radio" name="tkInvolved" value={v} defaultChecked={facts.tkInvolved === v} /> {l}</label>)}</div>
        </fieldset>
        {cfg.code === "CO" && (
          <fieldset>
            <legend>Direct affectation (afectación directa)?</legend>
            <div className="radio-list">{TRI.map(([v, l]) => <label key={v}><input type="radio" name="directAffectation" value={v} defaultChecked={facts.directAffectation === v} /> {l}</label>)}</div>
          </fieldset>
        )}
        {cfg.code === "KE" && (
          <fieldset style={{ gridColumn: "1 / -1" }}>
            <legend>Species status on an authoritative list</legend>
            <div className="radio-list">
              <label><input type="radio" name="speciesListed" value="unchecked" defaultChecked={(facts.speciesListed ?? "unchecked") === "unchecked"} /> Not yet checked</label>
              <label><input type="radio" name="speciesListed" value="not_listed" defaultChecked={facts.speciesListed === "not_listed"} /> Not endemic, rare or threatened</label>
              <label><input type="radio" name="speciesListed" value="listed" defaultChecked={facts.speciesListed === "listed"} /> Listed (commercial application must exclude it)</label>
            </div>
          </fieldset>
        )}
        {cfg.code === "BR" && (
          <fieldset>
            <legend>Genuine scientific collaboration with the Brazilian institution?</legend>
            <p className="small mute" style={{ marginTop: 0 }}>Recorded as a fact for the file. It is <strong>not</strong> the decision: the judgment is a manual-review state (R5) because no statutory test exists. <EvidenceChip reg={cfg.manualReview[0].reg} short /></p>
            <div className="radio-list">
              {TRI.map(([v, l]) => <label key={v}><input type="radio" name="scientificCollaboration" value={v} defaultChecked={facts.scientificCollaboration === v} /> {l}</label>)}
            </div>
          </fieldset>
        )}
      </div>
      {mode === "change" && (
        <div className="field">
          <label htmlFor="description">What changed</label>
          <input id="description" name="description" type="text" required placeholder="e.g. samples now leave the country for a sequencing service" />
          <div className="hint">Change of intent is a first-class event. It re-runs scope and applies this country&apos;s consequence: <strong>{cfg.changeOfIntent.policy.replace("_", " ")}</strong>. <EvidenceChip reg={cfg.changeOfIntent.consequence} short /> {cfg.changeOfIntent.consequence.value}</div>
        </div>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={!canEdit}>{mode === "intake" ? "Save facts and regenerate pathway" : "Record change of intent"}</button>
        {!canEdit && <span className="small mute">Your seat cannot edit this case (member or above required).</span>}
      </div>
    </form>
  );
}
