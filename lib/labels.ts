import type { AuditEntry } from "@/core/audit/chain";
import type { CountryConfig } from "@/core/config/schema";
import type { MarketFunction, Organisation, Permission } from "@/core/domain/types";
import type { Platform } from "@/core/platform";

/**
 * What a person reads, never what the code stores. Stored values stay exact (they are hashed into the
 * audit chain and compared by the engine); every page turns them into words here, in one place, so a
 * code like `foreign_legal` or `seat_ines_nordlicht` never reaches the screen as the main text.
 */

/** `service_shipment` → "Service shipment". The fallback for any code without a written label. */
export function sentence(code: string | null | undefined): string {
  if (!code) return "";
  const s = String(code).replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "";
}

export const KIND_LABEL: Record<Organisation["kind"], string> = {
  company: "Company",
  research_institution: "Research institution",
  community_custodian: "Community custodian",
  broker: "Broker",
  adviser: "Adviser",
  authority: "Authority",
};

export const FUNCTION_LABEL: Record<MarketFunction, string> = {
  seeking: "Seeking",
  providing: "Providing",
  advising: "Advising",
  brokering: "Brokering",
  custodian: "Custodian",
  learning: "Learning",
};

export const PERMISSION_LABEL: Record<Permission, string> = {
  administrator: "Administrator",
  authorised_signatory: "Authorised signatory",
  member: "Member",
  viewer: "Viewer",
};

export const VERIFICATION_LABEL: Record<Organisation["verification"]["status"], string> = {
  unverified: "Not verified",
  pending: "Verification pending",
  verified: "Verified",
  declined: "Verification declined",
};

export const kindLabel = (k: string) => KIND_LABEL[k as Organisation["kind"]] ?? sentence(k);
export const functionsLabel = (fs: readonly string[]) => fs.map((f) => FUNCTION_LABEL[f as MarketFunction] ?? sentence(f)).join(", ");
export const permissionLabel = (p: string) => PERMISSION_LABEL[p as Permission] ?? sentence(p);
export const verificationLabel = (s: string) => VERIFICATION_LABEL[s as Organisation["verification"]["status"]] ?? sentence(s);

/** The shared intake facts, in the intake form's own wording. Country-specific answers come from the country file. */
const FACT_VALUES: Record<string, Record<string, string>> = {
  purpose: { commercial: "Commercial", non_commercial: "Non-commercial" },
  provenance: { in_situ: "In situ (collected from the wild)", ex_situ: "Held ex situ (in a collection)", dsi_only: "Digital sequence information only" },
  exchange: { no_movement: "Nothing leaves the country", title_transfer: "Physical transfer with title", service_shipment: "Temporary service shipment", dsi_only: "Sequence data only" },
  communityHeld: { yes: "Yes", no: "No", unclear: "Unclear" },
  tkInvolved: { yes: "Yes", no: "No", unclear: "Unclear" },
};

export function factValueLabel(field: string, value: unknown, cfg?: CountryConfig): string {
  if (value === undefined || value === null || value === "") return "";
  const v = String(value);
  if (field === "applicantType") {
    const where = cfg?.name ?? "national";
    return ({ foreign_legal: "Foreign legal entity", foreign_natural: "Foreign natural person", national_legal: `${where} legal entity`, national_natural: `${where} natural person` } as Record<string, string>)[v] ?? sentence(v);
  }
  const shared = FACT_VALUES[field]?.[v];
  if (shared) return shared;
  const q = cfg?.scope.questions.find((x) => x.fact === field);
  const opt = q?.options.find((o) => o.id === v);
  return opt?.label ?? sentence(v);
}

export function scopeLabel(kind: string): string {
  return ({ in_scope: "In scope", out_of_scope: "Out of scope", escalate: "Open legal question", undetermined: "Not yet determined" } as Record<string, string>)[kind] ?? sentence(kind);
}

/** A regulator event as a button or history line: `complete_form` → "Complete form". */
export const eventLabel = (event: string) => sentence(event);

/** A state machine state by its label in the country file. */
export function stateLabel(cfg: CountryConfig | undefined, state: string): string {
  const label = cfg?.stateMachine.states[state]?.label;
  return label ? label.split(" (")[0].split(". ")[0] : sentence(state);
}

export function stageTitle(cfg: CountryConfig | undefined, stageId: string): string {
  return cfg?.stages.find((s) => s.id === stageId)?.title ?? sentence(stageId);
}

/** Disclosure contexts (`scope`, `eligibility`, `stage:tk_statute`, `stage:x:documents`) as words. */
export function disclosureContextLabel(cfg: CountryConfig | undefined, context: string): string {
  if (context === "scope") return "Scope";
  if (context === "eligibility") return "Eligibility";
  const m = context.match(/^stage:([^:]+)(:documents)?$/);
  if (m) return `${stageTitle(cfg, m[1])}${m[2] ? ", documents" : ""}`;
  return sentence(context);
}

// ------------------------------------------------------------------ people and records

/** "Dr Ines Halvorsen, Nordlicht Biotics GmbH (Authorised signatory)" for a seat id, whether active or revoked. */
export function seatLabel(platform: Platform, seatId: string | null | undefined): string {
  if (!seatId) return "";
  const m = platform.store.memberships.get(seatId);
  if (!m) return "A seat no longer on record";
  const person = platform.store.persons.get(m.personId)?.name ?? "Unknown person";
  const org = platform.store.organisations.get(m.organisationId)?.name ?? "unknown organisation";
  return `${person}, ${org} (${permissionLabel(m.permission)}${m.revoked ? ", seat since revoked" : ""})`;
}

/** Who acted, in words. */
export function actorLabel(platform: Platform, e: AuditEntry): string {
  if (e.actor.role === "system") return "The platform, automatically";
  if (e.actor.role === "administrator") return "GENE-LINK administrator";
  return seatLabel(platform, e.actor.seatId) || "A seat";
}

/** What the entry is about, by name rather than id. */
export function subjectLabel(platform: Platform, subject: { type: string; id: string }): string {
  const s = platform.store;
  switch (subject.type) {
    case "case": return s.cases.get(subject.id)?.title ?? "A case";
    case "organisation": return s.organisations.get(subject.id)?.name ?? "An organisation";
    case "listing": { const l = s.listings.get(subject.id); return l ? `Listing ${l.glId}, ${l.resourceClass}` : "A listing"; }
    case "agreement": return s.agreements.get(subject.id)?.title ?? "An agreement";
    case "instrument": return s.instruments.get(subject.id)?.label ?? "An instrument";
    case "document": { const d = s.documents.get(subject.id); return d ? `Document ${d.fileName}` : "A document"; }
    case "escalation": { const q = s.escalations.get(subject.id)?.question; return q ? `Open question: ${q.length > 90 ? `${q.slice(0, 90)}…` : q}` : "An open question"; }
    case "manual_review": { const r = s.manualReviews.get(subject.id); return r ? `Human review: ${r.question.length > 90 ? `${r.question.slice(0, 90)}…` : r.question}` : "A human review"; }
    case "membership": return seatLabel(platform, subject.id) || "A seat";
    default: return sentence(subject.type);
  }
}

/** The country whose words an entry should use (its case, or the case its record belongs to). */
function countryOf(platform: Platform, subject: { type: string; id: string }): CountryConfig | undefined {
  const s = platform.store;
  const caseId = subject.type === "case" ? subject.id
    : subject.type === "agreement" ? s.agreements.get(subject.id)?.caseId
    : subject.type === "instrument" ? s.instruments.get(subject.id)?.caseId
    : subject.type === "document" ? s.documents.get(subject.id)?.caseId
    : subject.type === "escalation" ? s.escalations.get(subject.id)?.caseId
    : subject.type === "manual_review" ? s.manualReviews.get(subject.id)?.caseId
    : undefined;
  const c = caseId ? s.cases.get(caseId) : undefined;
  return c ? platform.countries.get(c.providerCountry) : undefined;
}

const str = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v));

/** One plain sentence saying what an audit entry records. The exact entry stays available beneath it. */
export function describeAudit(platform: Platform, e: AuditEntry): string {
  const d = e.detail as Record<string, unknown>;
  const cfg = countryOf(platform, e.subject);
  const withNote = (text: string, note: unknown) => (str(note) ? `${text}. Note: “${str(note)}”` : text);
  switch (e.action) {
    case "access.denied": return `Refused: ${sentence(str(d.operation)).toLowerCase() || "an action"}. ${str(d.reason)}`.trim();
    case "admin.intervention": return `Administrator intervention: ${str(d.action)}. Reason: ${str(d.reason)}`;
    case "agreement.drafted": return `Drafted version ${str(d.version) || "1"} of the agreement from model clauses`;
    case "agreement.revised": return `Recorded version ${str(d.version)} of the agreement${d.origin === "uploaded_off_platform" ? ", negotiated off the platform" : ""}`;
    case "agreement.approved": return `Approved version ${str(d.version)} for their organisation${d.status === "approved" ? ". Both organisations have now approved" : ""}`;
    case "agreement.executed": return `Signed version ${str(d.version)}${d.status === "executed" ? ". Every party has now signed: the agreement is executed" : ""}`;
    case "case.facts_updated": return "Updated the intake facts";
    case "case.facts_corrected_before_filing": return `Corrected the intake facts before anything was filed (scope went from ${scopeLabel(str(d.scopeBefore)).toLowerCase()} to ${scopeLabel(str(d.scopeAfter)).toLowerCase()})`;
    case "case.change_of_intent": return `Declared a change of intent: ${str(d.description)}`;
    case "clock.extended": return `Recorded the authority's extension of the ${cfg?.stateMachine.clocks.find((k) => k.id === d.clockId)?.label.split(" (")[0].toLowerCase() ?? "clock"} by ${str(d.days)} days${str(d.note) ? `, on “${str(d.note)}”` : ""}`;
    case "clock.lapsed": return `The ${cfg?.stateMachine.clocks.find((k) => k.id === d.clockId)?.label.split(" (")[0].toLowerCase() ?? "statutory clock"} ran out. Remedy against the administrator; nothing granted${d.demoTimeControl ? ". Simulated with the demo's time control" : ""}`;
    case "document.uploaded": return "Recorded a document and its fingerprint (presence only, never a judgment of sufficiency)";
    case "escalation.raised": return `Raised an open question. Owner: ${str(d.owner) || "pending"}`;
    case "escalation.reopened": return "Reopened an open question the facts now raise again";
    case "escalation.answered":
    case "escalation.closed": return str(d.note) || (e.action === "escalation.answered" ? "Question answered" : "Question closed on this case");
    case "instrument.awaiting_record": return "The regime says this instrument now exists. Waiting for its document to be recorded";
    case "instrument.recorded": return d.automatic ? "Issued automatically on the filing and recorded with its fingerprint" : "Recorded the instrument the authority issued, with its fingerprint";
    case "instrument.versioned": return `Recorded version ${str(d.version)} (${sentence(str(d.kind)).toLowerCase()}): ${str(d.summary)}`;
    case "instrument.amendment_required": return "A change of intent means this instrument needs an amendment. It is recorded when the signed text arrives";
    case "instrument.new_required": return `A new ${sentence(str(d.policy)).toLowerCase().replace(/^new /, "")} is required${str(d.reason) ? `: ${str(d.reason)}` : ""}`;
    case "instrument.status": return withNote(`Recorded the verification outcome: ${sentence(str(d.status)).toLowerCase()}`, d.note);
    case "interest.signalled": return "Signalled interest";
    case "interest.reciprocated": return "Signalled back";
    case "listing.published": return `Published ${d.side === "need" ? "a need" : "an offer"} (${str(d.glId)})`;
    case "listing.withdrawn": return `Withdrew the listing. Reason: ${str(d.reason)}`;
    case "manual_review.opened": return "Opened a human review the software may not decide";
    case "manual_review.decided": return `Recorded the human judgment: ${str(d.outcome)}. Reason: ${str(d.reason)}`;
    case "manual_review.decision_denied": return "Refused: a party to the case tried to record the human judgment itself";
    case "match.revealed": return "Both sides signalled: the case opened and both identities were revealed at the same moment";
    case "organisation.registered": return "Registered the organisation (Path B)";
    case "organisation.verification_requested": return `Asked to be verified by ${sentence(str(d.method)).toLowerCase()}`;
    case "organisation.verification_decided": return `${d.outcome === "verified" ? "Verified" : "Declined"} the organisation. Reason: ${str(d.reason)}`;
    case "regulator.event_recorded": {
      const who = d.recordedOnBehalfOf === "authority" ? " on the authority's behalf" : d.recordedOnBehalfOf === "system" ? " on the clock's behalf" : "";
      const open = Array.isArray(d.stagesOpenAtFiling) && d.stagesOpenAtFiling.length ? `. Filed with ${d.stagesOpenAtFiling.map((x) => stageTitle(cfg, String(x))).join(", ")} still open` : "";
      return withNote(`Recorded “${eventLabel(str(d.event))}”${who}. The case is now: ${stateLabel(cfg, str(d.to))}${open}`, d.note);
    }
    case "regulator.event_denied": return `Refused: “${eventLabel(str(d.event))}”. ${sentence(str(d.reason))}`;
    case "seat.invited": return `Created a ${permissionLabel(str(d.permission)).toLowerCase()} seat`;
    case "seat.revoked": return `Revoked the seat. Reason: ${str(d.reason)}`;
    case "seat.invite_denied": return "Refused: only the organisation's administrator can give someone a seat";
    case "seat.revoke_denied": return "Refused: only the organisation's administrator can revoke its seats";
    case "stage.progress": return `Marked “${stageTitle(cfg, str(d.stageId))}” as ${sentence(str(d.progress)).toLowerCase()}`;
    case "stage.reopened": return `Reopened “${stageTitle(cfg, str(d.stageId))}”: ${str(d.reason)}`;
    case "support.requested": return `Asked for ${d.kind === "technical" ? "technical help from GENE-LINK support" : "expert help, routed to the parties' own adviser"}`;
    default: return sentence(e.action);
  }
}

const FIELD_NAME: Record<string, string> = {
  purpose: "purpose", activity: "activity", provenance: "provenance", applicantType: "applicant", exchange: "exchange",
  communityHeld: "community-held", tkInvolved: "traditional knowledge involved",
};

/** A configuration guard (`{ purpose: "non_commercial" }`) as words: "purpose is Non-commercial". */
export function conditionLabel(cfg: CountryConfig | undefined, when: Record<string, string | string[]> | undefined): string {
  if (!when) return "otherwise";
  return Object.entries(when).map(([field, v]) => {
    const name = FIELD_NAME[field] ?? cfg?.scope.questions.find((q) => q.fact === field)?.prompt.replace(/[?.]$/, "") ?? sentence(field).toLowerCase();
    const values = (Array.isArray(v) ? v : [v]).map((x) => factValueLabel(field, x, cfg));
    return `${name} is ${values.join(" or ")}`;
  }).join(", and ");
}

/** Who a transition belongs to, as words. */
export function actorKindLabel(actor: string): string {
  return ({ applicant: "the applicant", authority: "the authority", system: "the clock", community: "the community" } as Record<string, string>)[actor] ?? actor;
}

export function progressLabel(p: string): string {
  return ({ not_started: "Not started", in_progress: "In progress", complete: "Complete" } as Record<string, string>)[p] ?? sentence(p);
}
