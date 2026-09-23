import { activityQuestion, type CaseFacts, type CountryConfig, type ScopeQuestion } from "@/core/config/schema";
import { readFact } from "@/core/engine/conditions";
import { factsFingerprint } from "@/core/engine/facts";
import { changeOfIntent, updateFacts } from "@/app/actions";
import { EvidenceChip } from "@/components/Evidence";

const TRI = [["yes", "Yes"], ["no", "No"], ["unclear", "Unclear"]] as const;

/**
 * The intake form. The first block is the shared set every country collects (the common
 * variables Section 6 of the RFP names). Everything after it is rendered from the country
 * file's `scope.questions`: the activity question that decides scope, then the country's own
 * deciding facts. This component contains no country-specific code, so a new country's
 * questions appear here by adding them to its file.
 */
export function FactsForm({ cfg, caseId, facts, mode, canEdit }: { cfg: CountryConfig; caseId: string; facts: CaseFacts; mode: "intake" | "change"; canEdit: boolean }) {
  const action = (mode === "intake" ? updateFacts : changeOfIntent).bind(null, caseId);
  const activity = activityQuestion(cfg);
  const own = cfg.scope.questions.filter((q) => q.fact !== "activity");
  return (
    <form action={action} className="stack">
      <input type="hidden" name="factsSeen" value={factsFingerprint(facts)} />
      <fieldset disabled={!canEdit} style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}>
      <fieldset>
        <legend>Purpose (decides the route before any {cfg.name} rule applies)</legend>
        {facts.purpose === undefined && <p className="small mute" style={{ marginTop: 0 }}>Not yet established. Scope stays undetermined until it is answered.</p>}
        <div className="radio-list">
          <label><input type="radio" name="purpose" value="commercial" defaultChecked={facts.purpose === "commercial"} /> Commercial. GENE-LINK access is commercial by design.</label>
          <label><input type="radio" name="purpose" value="non_commercial" defaultChecked={facts.purpose === "non_commercial"} /> Non-commercial. Routed to a stated out-of-scope position, not through rules that do not fit.</label>
        </div>
      </fieldset>
      <fieldset>
        <legend>{activity.prompt}</legend>
        {facts.activity === undefined && <p className="small mute" style={{ marginTop: 0 }}>Not yet established. Nothing is pre-selected: the engine does not guess the activity.</p>}
        <div className="radio-list">
          {activity.options.map((o) => (
            <label key={o.id}><input type="radio" name="activity" value={o.id} defaultChecked={facts.activity === o.id} /> <span>{o.label}{o.hint && <span className="small mute"> · {o.hint}</span>}</span></label>
          ))}
        </div>
        <p className="small mute">Deciding fact: the activity the user will perform. Not whether the function is already proven, not whether the material was bought.</p>
      </fieldset>
      <div className="grid cols-fit">
        <div className="field">
          <label htmlFor="provenance">Material provenance</label>
          <select id="provenance" name="provenance" defaultValue={facts.provenance ?? ""}>
            <option value="">Not yet established</option>
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
          <select id="exchange" name="exchange" defaultValue={facts.exchange ?? ""}>
            <option value="">Not yet established</option>
            <option value="no_movement">Nothing leaves the country</option>
            <option value="title_transfer">Physical transfer with title</option>
            <option value="service_shipment">Temporary service shipment</option>
            <option value="dsi_only">Sequence data only</option>
          </select>
          <div className="hint">A service shipment is temporary: the material is returned or destroyed after the work. Until this is answered, the export stage stays on the pathway and halts.</div>
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
        {own.map((q) => <CountryQuestion key={q.id} q={q} facts={facts} />)}
      </div>
      {own.length > 0 && <p className="small mute">The questions after traditional knowledge are {cfg.name}&apos;s own deciding facts, declared in <span className="mono">config/countries/{cfg.name.toLowerCase()}.yaml</span>. The form renders them from the file.</p>}
      {mode === "change" && (
        <div className="field">
          <label htmlFor="description">What changed</label>
          <input id="description" name="description" type="text" required placeholder="e.g. samples now leave the country for a sequencing service" />
          <div className="hint">Change of intent is a first-class event. It re-runs scope and applies this country&apos;s consequence: <strong>{cfg.changeOfIntent.policy.replace("_", " ")}</strong>. <EvidenceChip reg={cfg.changeOfIntent.consequence} short /> {cfg.changeOfIntent.consequence.value}</div>
        </div>
      )}
      </fieldset>
      <div className="row">
        <button className="btn" type="submit" disabled={!canEdit}>{mode === "intake" ? "Save facts and regenerate pathway" : "Record change of intent"}</button>
        {!canEdit && <span className="small mute">{mode === "intake" ? "Your seat cannot edit this case (member or above required)." : "A change of intent is a declaration the organisation stands behind (authorised signatory or above required)."}</span>}
      </div>
    </form>
  );
}

/** One country-declared question, rendered from its declaration. Typed facts and flags use the same control. */
function CountryQuestion({ q, facts }: { q: ScopeQuestion; facts: CaseFacts }) {
  const current = readFact(facts, q.fact);
  if (q.kind === "number") {
    return (
      <div className="field">
        <label htmlFor={`q-${q.id}`}>{q.prompt}</label>
        <input id={`q-${q.id}`} name={q.fact} type="number" min={q.min ?? 1} max={q.max ?? 999} step={1} inputMode="numeric" defaultValue={current ?? ""} placeholder={String(q.min ?? 1)} />
        {q.note && <div className="hint">{q.note}</div>}
      </div>
    );
  }
  return (
    <fieldset style={q.options.length > 3 ? { gridColumn: "1 / -1" } : undefined}>
      <legend>{q.prompt}</legend>
      {(q.note || q.reg) && <p className="small mute" style={{ marginTop: 0 }}>{q.note} {q.reg && <EvidenceChip reg={q.reg} short />}</p>}
      <div className="radio-list">
        {q.options.map((o) => (
          <label key={o.id}><input type="radio" name={q.fact} value={o.id} defaultChecked={current === undefined ? o.id === q.default : String(current) === o.id} /> <span>{o.label}{o.hint && <span className="small mute"> · {o.hint}</span>}</span></label>
        ))}
      </div>
    </fieldset>
  );
}
