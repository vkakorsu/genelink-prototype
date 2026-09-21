import { nextEntry, verifyChain, type AuditEntry } from "./audit/chain";
import { makeDisclosure, type Disclosure } from "./audit/disclosure";
import { activityQuestion, type CaseFacts, type CountryConfig, type RegValue } from "./config/schema";
import { FROZEN_STATUSES, amendInstrument, awaitingInstrument, issueInstruments, sha256 } from "./domain/instruments";
import { fullProjection, publicProjection, searchableText, type FullListing, type PublicListing } from "./domain/listings";
import type {
  Agreement, AgreementVersion, Case, CaseDocument, EscalationRecord, Instrument, Listing, ManualReviewRecord, MarketFunction, Membership, Organisation, Permission, Person,
} from "./domain/types";
import { attachedDuties, buildPathway, type Pathway } from "./engine/pathway";
import { evaluateScope } from "./engine/scope";
import { applyLapse, fire, initialSnapshot, isGranted, tick } from "./engine/stateMachine";
import type { Store } from "./store/Store";

/**
 * The platform service: every operation the interfaces can perform. Permissions
 * are evaluated here, in the core, not in the interface. Every consequential
 * action writes to the audit chain. Every requirement statement shown to a person
 * writes to that person's disclosure log.
 */

export type Actor = { seat: Membership; person: Person; organisation: Organisation } | { system: true } | { admin: { personId: string; name: string } };

export class PermissionDenied extends Error {}
export class NotFound extends Error {}
/** A request the platform understood and refused. Interfaces answer 4xx, never 500. */
export class InvalidRequest extends Error {}

const rank: Record<Permission, number> = { viewer: 0, member: 1, authorised_signatory: 2, administrator: 3 };

/** Prototype paste limit. Real files go to object storage in the MVP; the prototype hashes pasted text. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

export class Platform {
  constructor(
    public readonly store: Store,
    public readonly countries: Map<string, CountryConfig>,
    public now: () => Date = () => new Date(),
  ) {}

  // ----------------------------------------------------------------- helpers
  country(code: string): CountryConfig {
    const c = this.countries.get(code);
    if (!c) throw new Error(`No configured pathway for provider country ${code}. Configured: ${[...this.countries.keys()].sort().join(", ")}. Adding a country is a configuration file, not a release.`);
    return c;
  }

  /** Records may vanish between a page render and a form submission (the demo resets). Fail with a sentence, never a stack trace. */
  private must<T>(value: T | undefined, what: string, id: string): T {
    if (value === undefined) throw new NotFound(`${what} ${id} was not found. The demo may have been reset since this page was rendered. Reload the page.`);
    return value;
  }

  private mustBelong(caseId: string, owned: { caseId: string }, what: string) {
    if (owned.caseId !== caseId) throw new PermissionDenied(`${what} does not belong to this case`);
  }

  private audit(actor: Actor, action: string, subject: { type: string; id: string }, detail: Record<string, unknown> = {}): AuditEntry {
    const existing = this.store.audit.list();
    const entry = nextEntry(existing.length ? existing[existing.length - 1] : null, {
      at: this.now().toISOString(),
      actor: "system" in actor
        ? { seatId: null, personId: null, organisationId: null, role: "system" }
        : "admin" in actor
          ? { seatId: null, personId: actor.admin.personId, organisationId: null, role: "administrator" }
          : { seatId: actor.seat.id, personId: actor.person.id, organisationId: actor.organisation.id, role: "user" },
      action,
      subject,
      detail,
    });
    this.store.audit.append(entry);
    return entry;
  }

  verifyAudit() {
    return verifyChain(this.store.audit.list());
  }

  /** A denial that already wrote its own audit record. Marked so the interface layer does not log it twice. */
  private denied(message: string): PermissionDenied {
    const e = new PermissionDenied(message);
    (e as PermissionDenied & { audited?: boolean }).audited = true;
    return e;
  }

  /**
   * A denied attempt belongs on the chain; the interface promises it. Domain denials write
   * their own context at the throw site (regulator.event_denied, manual_review.decision_denied).
   * This records every refusal that reaches the boundary without one, including calls with no session.
   */
  recordDenied(actor: Actor | null, operation: string, subject: { type: string; id: string }, reason: string) {
    const detail: Record<string, unknown> = { operation, reason };
    if (!actor) detail.session = "none";
    this.audit(actor ?? { system: true }, "access.denied", subject, detail);
  }

  private require(actor: Actor, minimum: Permission, organisationId?: string) {
    if ("system" in actor || "admin" in actor) return;
    if (organisationId && actor.seat.organisationId !== organisationId) throw new PermissionDenied("Seat belongs to a different organisation");
    if (rank[actor.seat.permission] < rank[minimum]) throw new PermissionDenied(`Requires ${minimum}, seat is ${actor.seat.permission}`);
  }

  private requireParticipant(actor: Actor, c: Case) {
    if ("system" in actor || "admin" in actor) return;
    if (!c.participants.some((p) => p.organisationId === actor.seat.organisationId)) throw new PermissionDenied("Not a participant in this case");
  }

  /** Record what the platform told a person. Called by interfaces when they render a requirement. */
  disclose(person: Person, seat: Membership | null, caseId: string | null, countryCode: string | null, statement: string, reg: RegValue, context: string): Disclosure {
    const d = makeDisclosure({ personId: person.id, seatId: seat?.id ?? null, caseId, countryCode, statement, reg, context }, this.now(), this.store.disclosures.nextSeq());
    this.store.disclosures.append(d);
    return d;
  }

  disclosuresFor(personId: string) {
    return this.store.disclosures.list().filter((d) => d.personId === personId).reverse();
  }

  /** Record a statement once per person, case and context. Re-rendering a page is not a new disclosure. */
  discloseOnce(person: Person, seat: Membership | null, caseId: string | null, countryCode: string | null, statement: string, reg: RegValue, context: string): Disclosure | null {
    const dup = this.store.disclosures.list().find((d) => d.personId === person.id && d.caseId === caseId && d.context === context && d.statement === statement);
    if (dup) return null;
    return this.disclose(person, seat, caseId, countryCode, statement, reg, context);
  }

  /** Write every requirement on a pathway to the viewer's disclosure log. Called when a seat views a case. */
  discloseCase(person: Person, seat: Membership, c: Case): number {
    const pathway = this.pathwayFor(c);
    let n = 0;
    const scopeText = pathway.scope.basis.value ?? pathway.scope.basis.note ?? "";
    if (this.discloseOnce(person, seat, c.id, c.providerCountry, `Scope: ${pathway.scope.kind.replace("_", " ")}. ${scopeText}`, pathway.scope.basis, "scope")) n++;
    for (const r of pathway.eligibility) if (this.discloseOnce(person, seat, c.id, c.providerCountry, r.text, r.reg, "eligibility")) n++;
    for (const s of pathway.stages) {
      for (const r of s.requirements) if (this.discloseOnce(person, seat, c.id, c.providerCountry, r.text, r.reg, `stage:${s.stage.id}`)) n++;
      for (const d of s.documents) if (this.discloseOnce(person, seat, c.id, c.providerCountry, `Document required: ${d.label}`, d.reg, `stage:${s.stage.id}:documents`)) n++;
    }
    return n;
  }

  // ------------------------------------------------------------ identity
  seatsFor(personId: string) {
    return this.store.memberships.list().filter((m) => m.personId === personId);
  }

  actorFor(seatId: string): Actor {
    const seat = this.store.memberships.get(seatId);
    if (!seat) throw new Error("Unknown seat");
    const person = this.store.persons.get(seat.personId)!;
    const organisation = this.store.organisations.get(seat.organisationId)!;
    return { seat, person, organisation };
  }

  inviteSeat(actor: Actor, organisationId: string, person: Person, permission: Permission): Membership {
    this.require(actor, "administrator", organisationId);
    const m: Membership = { id: `seat_${person.id}_${organisationId}`, personId: person.id, organisationId, permission, since: this.now().toISOString(), invitedBy: "seat" in actor ? actor.seat.id : undefined };
    this.store.memberships.put(m);
    this.audit(actor, "seat.invited", { type: "membership", id: m.id }, { permission });
    return m;
  }

  // ------------------------------------------------------- verification
  requestVerification(actor: Actor, organisationId: string, method: Organisation["verification"]["method"]) {
    this.require(actor, "administrator", organisationId);
    const org = this.must(this.store.organisations.get(organisationId), "Organisation", organisationId);
    const methods: Organisation["verification"]["method"][] = ["orcid", "institutional_email", "manual_vetting", "vouching"];
    if (!methods.includes(method)) throw new InvalidRequest(`Unknown verification method ${method}`);
    org.verification = { status: "pending", method };
    this.store.organisations.put(org);
    this.audit(actor, "organisation.verification_requested", { type: "organisation", id: organisationId }, { method });
  }

  decideVerification(admin: Actor, organisationId: string, outcome: "verified" | "declined", reason: string) {
    if (!("admin" in admin)) throw new PermissionDenied("Verification decisions are administrative actions");
    const org = this.must(this.store.organisations.get(organisationId), "Organisation", organisationId);
    if (outcome !== "verified" && outcome !== "declined") throw new InvalidRequest(`Unknown verification outcome ${outcome}`);
    org.verification = { ...org.verification, status: outcome, decidedBy: admin.admin.name, decidedAt: this.now().toISOString(), reason };
    this.store.organisations.put(org);
    this.audit(admin, "organisation.verification_decided", { type: "organisation", id: organisationId }, { outcome, reason });
  }

  /**
   * A stranger arrives. Path B exists because community custodians, IPLC holders and
   * smaller institutions do not hold ORCID iDs or institutional email domains, and a
   * platform that required one would exclude exactly the providers it exists for.
   * This creates the person, the organisation and the founding administrator seat in
   * one act, then files the verification request like any other: pending, into the
   * queue, nothing pre-decided. The new seat can already explore and signal while the
   * request is pending: onboarding runs in parallel, it does not gate the spine.
   */
  registerOrganisation(input: {
    personName: string;
    orgName: string;
    kind: Organisation["kind"];
    country: string;
    method: "manual_vetting" | "vouching";
    functions: MarketFunction[];
  }): { personId: string; seatId: string; organisationId: string } {
    const n = this.store.persons.list().length + 1;
    const personId = `p_new_${n}`;
    const organisationId = `org_new_${this.store.organisations.list().length + 1}`;
    const person: Person = { id: personId, name: input.personName, email: "not held in this demo", country: input.country, onboardingPath: "B", badges: [] };
    const org: Organisation = { id: organisationId, name: input.orgName, kind: input.kind, country: input.country, functions: input.functions, verification: { status: "unverified" }, credentials: [], description: "Registered in this demo session." };
    this.store.persons.put(person);
    this.store.organisations.put(org);
    const seat = this.inviteSeat({ system: true }, organisationId, person, "administrator");
    const actor = this.actorFor(seat.id);
    this.audit(actor, "organisation.registered", { type: "organisation", id: organisationId }, { kind: org.kind, country: org.country, path: "B" });
    this.requestVerification(actor, organisationId, input.method);
    return { personId, seatId: seat.id, organisationId };
  }

  // ---------------------------------------------------------- discovery
  /**
   * Search runs over the public projection and nothing else. A withheld field is not a
   * search key: if a species query matched a listing on its withheld species detail, the
   * result set itself would reveal what the projection hides. The owner decides how
   * findable a listing is by what it publishes in the public taxon and summary.
   */
  searchPublicListings(query: string, country: string, side: string): PublicListing[] {
    const q = query.trim().toLowerCase();
    return this.store.listings.list()
      .filter((l) => {
        if (country && l.provenanceCountry !== country) return false;
        if (side && l.side !== side) return false;
        if (!q) return true;
        return searchableText(l).includes(q);
      })
      .map((l) => publicProjection(l, this.must(this.store.organisations.get(l.organisationId), "Organisation", l.organisationId)));
  }

  publicListings(): PublicListing[] {
    return this.store.listings.list().map((l) => publicProjection(l, this.store.organisations.get(l.organisationId)!));
  }

  /** Full projection is available only to the owner or to a counterparty after mutual interest. */
  listingFor(actor: Actor, listingId: string): PublicListing | FullListing {
    const l = this.must(this.store.listings.get(listingId), "Listing", listingId);
    const org = this.must(this.store.organisations.get(l.organisationId), "Organisation", l.organisationId);
    if ("admin" in actor || "system" in actor) return fullProjection(l, org);
    if (actor.seat.organisationId === l.organisationId) return fullProjection(l, org);
    if (this.mutualInterest(actor.seat.organisationId, l)) return fullProjection(l, org);
    return publicProjection(l, org);
  }

  signalInterest(actor: Actor, listingId: string): { mutual: boolean; caseId?: string } {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can signal interest");
    this.require(actor, "member");
    const listing = this.must(this.store.listings.get(listingId), "Listing", listingId);
    if (listing.organisationId === actor.seat.organisationId) throw new PermissionDenied("Cannot signal interest in your own listing");
    if (actor.organisation.verification.status === "declined") throw new PermissionDenied("Your organisation's verification was declined. Interest cannot be signalled until a new verification request is decided.");
    this.requireCounterpartyPathway(listing, actor.organisation);
    const id = `int_${actor.seat.organisationId}_${listingId}`;
    this.store.interests.put({ id, fromOrganisationId: actor.seat.organisationId, toListingId: listingId, at: this.now().toISOString(), bySeatId: actor.seat.id });
    this.audit(actor, "interest.signalled", { type: "listing", id: listingId });
    if (this.mutualInterest(actor.seat.organisationId, listing)) {
      const c = this.openCaseFromMatch(actor, listing);
      return { mutual: true, caseId: c.id };
    }
    return { mutual: false };
  }

  /** The listing owner signals back on the interested organisation. Recorded symmetrically. */
  reciprocate(actor: Actor, listingId: string, interestedOrganisationId: string): { caseId: string } {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can reciprocate");
    const listing = this.must(this.store.listings.get(listingId), "Listing", listingId);
    this.require(actor, "member", listing.organisationId);
    const interested = this.must(this.store.organisations.get(interestedOrganisationId), "Organisation", interestedOrganisationId);
    if (!this.store.interests.get(`int_${interestedOrganisationId}_${listingId}`)) throw new InvalidRequest("That organisation has not signalled interest in this listing. A reveal is mutual or it does not happen.");
    if (interested.verification.status === "declined") throw new PermissionDenied(`${interested.kind.replace("_", " ")} (${interested.country}) was declined verification. Signalling back is not available until a new verification request is decided.`);
    this.requireCounterpartyPathway(listing, interested);
    const id = `int_${listing.organisationId}_${listingId}_to_${interestedOrganisationId}`;
    this.store.interests.put({ id, fromOrganisationId: listing.organisationId, toListingId: `${listingId}:${interestedOrganisationId}`, at: this.now().toISOString(), bySeatId: actor.seat.id });
    this.audit(actor, "interest.reciprocated", { type: "listing", id: listingId }, { counterparty: interestedOrganisationId });
    const c = this.openCaseFromMatch(actor, listing, interestedOrganisationId);
    return { caseId: c.id };
  }

  private mutualInterest(orgId: string, listing: { id: string; organisationId: string }): boolean {
    const a = this.store.interests.get(`int_${orgId}_${listing.id}`);
    const b = this.store.interests.get(`int_${listing.organisationId}_${listing.id}_to_${orgId}`);
    return Boolean(a && b);
  }

  interestsOn(listingId: string) {
    return this.store.interests.list().filter((i) => i.toListingId === listingId);
  }

  /**
   * Which country's rules a match would run under. An offer carries its provenance. A need
   * says "any provenance with a lawful pathway", so the pathway is the supplying
   * organisation's country. Where that country has no configuration the platform says so
   * before anyone signals, rather than opening a case it cannot run.
   */
  providerCountryFor(listing: Listing, counterparty: Organisation): string {
    if (listing.side === "offer") return listing.provenanceCountry;
    return listing.provenanceCountry === "any" ? counterparty.country : listing.provenanceCountry;
  }

  private requireCounterpartyPathway(listing: Listing, counterparty: Organisation) {
    const code = this.providerCountryFor(listing, counterparty);
    if (!this.countries.has(code)) {
      throw new InvalidRequest(
        listing.side === "need"
          ? `This need accepts any provenance with a lawful pathway, and the platform has no configured pathway for ${code}, the supplying organisation's country. Configured: ${[...this.countries.keys()].sort().join(", ")}.`
          : `No configured pathway for provider country ${code}.`,
      );
    }
  }

  private openCaseFromMatch(actor: Actor, listing: Listing, counterpartyId?: string): Case {
    const other = counterpartyId ?? ("seat" in actor ? actor.seat.organisationId : listing.organisationId);
    const existing = this.store.cases.list().find((c) => c.listingId === listing.id && c.participants.some((p) => p.organisationId === other));
    if (existing) return existing;
    const owner = this.must(this.store.organisations.get(listing.organisationId), "Organisation", listing.organisationId);
    const counterparty = this.must(this.store.organisations.get(other), "Organisation", other);
    // The verification gate sits between mutual interest and the pathway. Interest is recorded at the
    // gate; a case opens only when both organisations are verified.
    for (const org of [owner, counterparty]) {
      if (org.verification.status !== "verified") {
        throw new PermissionDenied(`${org.name} is ${org.verification.status === "pending" ? "still in verification" : "verification-declined"}. Mutual interest is recorded, but a case opens only once both organisations are verified.`);
      }
    }
    // On an offer the owner supplies. On a need the owner is the demand side and the counterparty supplies.
    const [demand, supplier] = listing.side === "offer" ? [counterparty, owner] : [owner, counterparty];
    const cfg = this.country(this.providerCountryFor(listing, counterparty));
    const at = this.now();
    const c: Case = {
      id: `case_${this.store.cases.list().length + 1}_${cfg.code.toLowerCase()}`,
      title: `${demand.name} and ${supplier.name}`,
      providerCountry: cfg.code,
      participants: [
        { organisationId: demand.id, role: "demand" },
        { organisationId: supplier.id, role: "supply" },
      ],
      listingId: listing.id,
      facts: { purpose: "commercial", activity: activityQuestion(cfg).options[0].id, provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "unclear", tkInvolved: "unclear", flags: {} },
      machine: initialSnapshot(cfg, at),
      revealedAt: at.toISOString(),
      createdAt: at.toISOString(),
      stageProgress: {},
      changeOfIntent: [],
      supportRequests: [],
    };
    this.store.cases.put(c);
    this.audit(actor, "match.revealed", { type: "case", id: c.id }, { listingId: listing.id, participants: c.participants.map((p) => p.organisationId), symmetric: true });
    this.syncEscalations(actor, c);
    return c;
  }

  // ---------------------------------------------------------------- cases
  casesFor(organisationId: string) {
    return this.store.cases.list().filter((c) => c.participants.some((p) => p.organisationId === organisationId));
  }

  /**
   * Case-scoped audit reads carry the same boundary as the case body: the trail names
   * the participants' seats and organisations, and entry details can carry facts.
   * A refused read is itself a consequential event and goes on the chain.
   */
  caseAudit(actor: Actor, caseId: string) {
    const c = this.store.cases.get(caseId);
    if (!c) throw new InvalidRequest("Unknown case");
    try {
      this.requireParticipant(actor, c);
    } catch (e) {
      if (e instanceof PermissionDenied) this.recordDenied(actor, "case_audit.view", { type: "case", id: caseId }, "Not a participant in this case");
      throw e;
    }
    const related = new Set([caseId, ...this.instrumentsFor(caseId).map((i) => i.id), ...this.agreementsFor(caseId).map((a) => a.id), ...this.documentsFor(caseId).map((d) => d.id), ...this.escalationsFor(caseId).map((e) => e.id), ...this.manualReviewsFor(caseId).map((m) => m.id)]);
    return this.store.audit.list().filter((e) => related.has(e.subject.id));
  }

  pathwayFor(c: Case): Pathway {
    return buildPathway(this.country(c.providerCountry), c.facts);
  }

  dutiesFor(c: Case) {
    return attachedDuties(this.country(c.providerCountry));
  }

  private caseFor(caseId: string): Case {
    return this.must(this.store.cases.get(caseId), "Case", caseId);
  }

  updateFacts(actor: Actor, caseId: string, facts: CaseFacts): Case {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    const cfg = this.country(c.providerCountry);
    const before = evaluateScope(cfg, c.facts).kind;
    const after = evaluateScope(cfg, facts).kind;
    if (before !== after) {
      throw new InvalidRequest(`That edit changes the scope answer from ${before.replaceAll("_", " ")} to ${after.replaceAll("_", " ")}. A scope change is a declared change of intent with the country's consequence policy on the record. Use the change-of-intent form, not a facts edit.`);
    }
    c.facts = facts;
    this.store.cases.put(c);
    this.audit(actor, "case.facts_updated", { type: "case", id: caseId }, { facts });
    this.syncEscalations(actor, c);
    return c;
  }

  /**
   * Change of intent is a first-class event. It re-runs scope and applies the country's Class 4
   * consequence, which can version a live contract (Colombia) or require a new application. That
   * is a declaration the organisation stands behind before the regulator, so it takes an
   * authorised signatory: a member prepares facts, a signatory commits to a change in them.
   */
  changeOfIntent(actor: Actor, caseId: string, newFacts: CaseFacts, description: string): Case {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    if ("seat" in actor && rank[actor.seat.permission] < rank.authorised_signatory) {
      throw new PermissionDenied("A change of intent is a declaration the organisation stands behind: it re-runs scope and applies this country's consequence to the instrument. It needs an authorised signatory or administrator seat. Your seat can edit facts that keep the scope answer, and record work in progress.");
    }
    const cfg = this.country(c.providerCountry);
    const at = this.now().toISOString();
    c.changeOfIntent.push({
      id: `coi_${caseId}_${c.changeOfIntent.length + 1}`,
      caseId, at, description,
      previousFacts: c.facts, newFacts,
      consequencePolicy: cfg.changeOfIntent.policy,
      consequenceText: cfg.changeOfIntent.consequence.value ?? "",
    });
    c.facts = newFacts;
    this.store.cases.put(c);
    this.audit(actor, "case.change_of_intent", { type: "case", id: caseId }, { description, policy: cfg.changeOfIntent.policy });
    // Apply to instruments already recorded. An instrument the platform is still awaiting has nothing to version.
    for (const inst of this.instrumentsFor(caseId)) {
      if (FROZEN_STATUSES.has(inst.status)) continue;
      const out = amendInstrument(inst, `Change of intent: ${description}`, this.now(), "seat" in actor ? actor.seat.id : "system");
      if (out.kind === "versioned") {
        this.store.instruments.put(out.instrument);
        this.audit(actor, "instrument.versioned", { type: "instrument", id: inst.id }, { version: out.version.version, kind: out.version.kind });
      } else {
        this.audit(actor, "instrument.new_required", { type: "instrument", id: inst.id }, { policy: out.policy, reason: out.reason });
      }
    }
    this.syncEscalations(actor, c);
    return c;
  }

  private syncEscalations(actor: Actor, c: Case) {
    const pathway = this.pathwayFor(c);
    const cfg = this.country(c.providerCountry);
    for (const e of pathway.escalations) {
      const id = `esc_${c.id}_${e.id}`;
      if (!this.store.escalations.get(id)) {
        const rec: EscalationRecord = { id, caseId: c.id, stageId: e.stageId, question: e.question, owner: e.owner, ownerName: e.ownerName, status: "open", raisedAt: this.now().toISOString() };
        this.store.escalations.put(rec);
        this.audit({ system: true }, "escalation.raised", { type: "escalation", id }, { stageId: e.stageId, owner: e.owner, requirement: e.requirementId });
      }
    }
    for (const s of pathway.stages) {
      for (const m of s.manualReviews) {
        const id = `mr_${c.id}_${m.id}`;
        if (!this.store.manualReviews.get(id)) {
          const rec: ManualReviewRecord = { id, caseId: c.id, reviewId: m.id, question: m.question, status: "pending_human_judgment" };
          this.store.manualReviews.put(rec);
          this.audit({ system: true }, "manual_review.opened", { type: "manual_review", id }, { reviewId: m.id, country: cfg.code });
        }
      }
    }
    void actor;
  }

  escalationsFor(caseId: string) {
    return this.store.escalations.list().filter((e) => e.caseId === caseId);
  }
  manualReviewsFor(caseId: string) {
    return this.store.manualReviews.list().filter((e) => e.caseId === caseId);
  }

  /**
   * R5. A manual-review judgment is one no system and no party can make: a case party recording
   * it would be self-declaration under another name. In the prototype the reviewer seat is the
   * administrator; which named seat holds it in production is an open decision. Once decided,
   * the record is immutable. A second judgment is a new record, never an overwrite.
   */
  decideManualReview(actor: Actor, recordId: string, outcome: string, reason: string) {
    if ("system" in actor) throw new PermissionDenied("Manual review judgments cannot be made by the system");
    if (!("admin" in actor)) {
      this.audit(actor, "manual_review.decision_denied", { type: "manual_review", id: recordId }, { reason: "a party seat attempted to record a manual-review judgment" });
      throw this.denied("A manual-review judgment is recorded by the reviewer seat, not by a party to the case. Recording it yourself would be self-declaration. This attempt has been recorded.");
    }
    if (!outcome.trim() || !reason.trim()) throw new InvalidRequest("A judgment needs both an outcome and a reason. Both go into the audit chain.");
    const rec = this.must(this.store.manualReviews.get(recordId), "Manual review", recordId);
    if (rec.status === "decided") throw new PermissionDenied(`This judgment was recorded by ${rec.decision?.by} and is immutable. It cannot be overwritten.`);
    rec.status = "decided";
    rec.decision = { by: actor.admin.name, at: this.now().toISOString(), outcome: outcome.trim(), reason: reason.trim() };
    this.store.manualReviews.put(rec);
    this.audit(actor, "manual_review.decided", { type: "manual_review", id: recordId }, { outcome: rec.decision.outcome, reason: rec.decision.reason });
  }

  uploadDocument(actor: Actor, caseId: string, requirementId: string, label: string, fileName: string, content: string): CaseDocument {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can upload");
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    if (!content.trim()) throw new InvalidRequest("The document is empty. Paste the text so the platform can hash it.");
    if (Buffer.byteLength(content, "utf8") > MAX_DOCUMENT_BYTES) throw new InvalidRequest(`The document exceeds the prototype's ${MAX_DOCUMENT_BYTES / 1024} KB paste limit. The MVP stores files in EU object storage and hashes the upload stream.`);
    const pathway = this.pathwayFor(c);
    if (!pathway.stages.some((s) => s.documents.some((d) => d.id === requirementId))) throw new InvalidRequest(`No document requirement ${requirementId} on this pathway.`);
    const h = sha256(content);
    const dup = this.documentsFor(caseId).find((d) => d.requirementId === requirementId && d.sha256 === h);
    if (dup) throw new InvalidRequest(`An identical document (${dup.fileName}) is already on file for this requirement. Same content, same hash, nothing to add.`);
    const doc: CaseDocument = { id: `doc_${caseId}_${requirementId}_${this.store.documents.list().length + 1}`, caseId, requirementId, label, fileName, sha256: h, uploadedBySeatId: actor.seat.id, uploadedAt: this.now().toISOString(), check: "present" };
    this.store.documents.put(doc);
    this.audit(actor, "document.uploaded", { type: "document", id: doc.id }, { requirementId, sha256: doc.sha256, check: "presence and type only, never sufficiency" });
    return doc;
  }

  documentsFor(caseId: string) {
    return this.store.documents.list().filter((d) => d.caseId === caseId);
  }

  markStage(actor: Actor, caseId: string, stageId: string, progress: Case["stageProgress"][string]) {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    if (!["not_started", "in_progress", "complete"].includes(progress)) throw new InvalidRequest(`Unknown progress value ${progress}`);
    // A member prepares the work. Marking a stage complete is a claim the organisation
    // stands behind, so it needs the same authority as recording an instrument.
    if (progress === "complete" && "seat" in actor && rank[actor.seat.permission] < rank.authorised_signatory) {
      throw new PermissionDenied("Marking a stage complete is a claim the organisation stands behind: it needs an authorised signatory or administrator seat. Your seat can record work in progress.");
    }
    const pathway = this.pathwayFor(c);
    const stage = pathway.stages.find((s) => s.stage.id === stageId);
    if (!stage) throw new InvalidRequest("Stage not on this pathway");
    if (stage.status === "halted" && progress === "complete") throw new PermissionDenied("A halted stage cannot be completed. The open question must be answered through configuration review first.");
    const haltedBefore = pathway.stages.slice(0, pathway.stages.indexOf(stage)).filter((s) => s.status === "halted");
    if (progress === "complete" && haltedBefore.length) {
      throw new PermissionDenied(`An earlier stage is halted: ${haltedBefore.map((s) => s.stage.title).join("; ")}. A later stage cannot be marked complete while the question it depends on is open.`);
    }
    c.stageProgress[stageId] = progress;
    this.store.cases.put(c);
    this.audit(actor, "stage.progress", { type: "case", id: caseId }, { stageId, progress });
  }

  // -------------------------------------------------------- state machine
  fireEvent(actor: Actor, caseId: string, event: string, note?: string): Case {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    const cfg = this.country(c.providerCountry);
    const actorKind = "system" in actor ? "system" : "admin" in actor ? "authority" : "applicant";
    const declared = cfg.stateMachine.transitions.find((t) => t.from === c.machine.state && t.event === event);
    const effectiveActor = declared ? declared.actor : actorKind;
    // Authority and system events are recorded by an administrator on the authority's
    // behalf. A party seat can record only applicant events; a denied attempt is
    // audited rather than silently ignored.
    if (effectiveActor !== "applicant" && !("admin" in actor) && !("system" in actor)) {
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: "authority events are recorded by an administrator on the authority's behalf" });
      throw this.denied("That event belongs to the authority. An administrator records it on the authority's behalf; your seat can record applicant events only.");
    }
    // An applicant event (submit, resubmit, withdraw, appeal) is a filing before the regulator:
    // a commitment the organisation stands behind, so it takes the same seat as recording an
    // instrument. A member prepares the bundle; a signatory files it. Viewers read.
    if ("seat" in actor && rank[actor.seat.permission] < rank.authorised_signatory) {
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: `filing before the regulator needs an authorised signatory seat; seat is ${actor.seat.permission}` });
      throw this.denied(`Recording "${event.replace(/_/g, " ")}" is a filing before the regulator, a commitment the organisation stands behind. It needs an authorised signatory or administrator seat; your seat is ${actor.seat.permission}. This attempt has been recorded.`);
    }
    const wasGranted = isGranted(cfg, c.machine);
    c.machine = fire(cfg, c.machine, event, effectiveActor, this.now(), note);
    this.store.cases.put(c);
    this.audit(actor, "regulator.event_recorded", { type: "case", id: caseId }, { event, to: c.machine.state, recordedOnBehalfOf: effectiveActor, note });
    if (isGranted(cfg, c.machine)) this.issueOutputs(actor, c);
    else if (wasGranted && cfg.stateMachine.states[c.machine.state]?.kind === "terminal") this.closeInstruments(actor, c, event);
    return c;
  }

  /**
   * A granted case that reaches a terminal state that is not granted (Colombia: terminated) has
   * no live instrument left. The status is recorded on each instrument so that nothing can be
   * amended against a contract that no longer runs. Recorded, not performed: the authority acted.
   */
  private closeInstruments(actor: Actor, c: Case, event: string) {
    const label = this.country(c.providerCountry).stateMachine.states[c.machine.state]?.label ?? c.machine.state;
    for (const inst of this.instrumentsFor(c.id)) {
      if (FROZEN_STATUSES.has(inst.status)) continue;
      inst.status = "cancelled";
      this.store.instruments.put(inst);
      this.audit(actor, "instrument.status", { type: "instrument", id: inst.id }, { status: "cancelled", note: `Case reached "${label}" on ${event}. No further version can be recorded.` });
    }
  }

  tickClocks(caseId: string, now = this.now()): { lapsed: string[] } {
    const c = this.caseFor(caseId);
    const cfg = this.country(c.providerCountry);
    const { snap, lapsed } = tick(cfg, c.machine, now);
    c.machine = snap;
    for (const id of lapsed) {
      c.machine = applyLapse(cfg, c.machine, id, now);
      this.audit({ system: true }, "clock.lapsed", { type: "case", id: caseId }, { clockId: id, to: c.machine.state, effect: "remedy_against_administrator", granted: false });
    }
    this.store.cases.put(c);
    return { lapsed };
  }

  /** Demo control: evaluate the running clock one day past its own deadline. Returns null when no clock governs the current state. */
  forceLapse(caseId: string): { lapsed: string[]; at: Date } | null {
    const c = this.caseFor(caseId);
    const cfg = this.country(c.providerCountry);
    const running = cfg.stateMachine.clocks.find((k) => k.startsIn === c.machine.state && c.machine.clocks[k.id]?.deadline && !c.machine.clocks[k.id].suspended);
    if (!running) return null;
    const at = new Date(new Date(c.machine.clocks[running.id].deadline!).getTime() + 86_400_000);
    return { ...this.tickClocks(caseId, at), at };
  }

  /**
   * The machine reached a state in which the configuration says instruments issue. Two cases:
   *  automatic (Brazil's SisGen receipt): the regime issues it on the act itself, so the record is made now;
   *  everything else (Kenya's two instruments from two issuers, Colombia's contract): an authority holds
   *  the document and the platform holds nothing until a signatory records it. The instrument appears as
   *  awaiting record. It never gets a fabricated hash. Kenya's applicant holds nothing until both are recorded.
   */
  private issueOutputs(actor: Actor, c: Case) {
    const cfg = this.country(c.providerCountry);
    const already = this.instrumentsFor(c.id).map((i) => i.outputId);
    const at = this.now();
    for (const out of cfg.outputs.filter((o) => o.issuedInState === c.machine.state && !already.includes(o.id))) {
      if (out.automatic) {
        const [inst] = issueInstruments(cfg, c.id, [out.id], at, "seat" in actor ? actor.seat.id : "system");
        this.store.instruments.put(inst);
        this.audit(actor, "instrument.recorded", { type: "instrument", id: inst.id }, { outputId: inst.outputId, issuer: inst.issuer, status: inst.status, sha256: inst.versions[0].sha256, automatic: true });
      } else {
        const inst = awaitingInstrument(out, c.id, at);
        this.store.instruments.put(inst);
        this.audit({ system: true }, "instrument.awaiting_record", { type: "instrument", id: inst.id }, { outputId: inst.outputId, issuer: inst.issuer, note: "The regime says this instrument now exists. The platform holds no copy until an authorised signatory records it." });
      }
    }
  }

  /** Every instrument the configuration says this case should hold, and whether the platform actually holds it. */
  holdings(c: Case): { required: number; recorded: number; missing: Instrument[] } {
    const cfg = this.country(c.providerCountry);
    const instruments = this.instrumentsFor(c.id);
    const required = isGranted(cfg, c.machine) ? cfg.outputs.filter((o) => o.issuedInState === c.machine.state).length : 0;
    const missing = instruments.filter((i) => i.status === "awaiting_record");
    return { required, recorded: instruments.filter((i) => i.versions.length > 0).length, missing };
  }

  recordExternalInstrument(actor: Actor, caseId: string, outputId: string, fileName: string, content: string): Instrument {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can record an instrument");
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
    const cfg = this.country(c.providerCountry);
    const out = cfg.outputs.find((o) => o.id === outputId);
    if (!out) throw new InvalidRequest(`Unknown output ${outputId} for ${cfg.name}. This regime's outputs are ${cfg.outputs.map((o) => o.id).join(", ")}.`);
    const st = cfg.stateMachine.states[c.machine.state];
    const existing = this.store.instruments.get(`inst_${caseId}_${outputId}`);
    const awaitingThis = existing?.status === "awaiting_record";
    if (!isGranted(cfg, c.machine) && !awaitingThis) {
      throw new PermissionDenied(`No ${out.label} exists to record. This case is in "${st?.label ?? c.machine.state}". A missed clock is a remedy against the administrator, not a grant, and the platform will not take a paste in place of one.`);
    }
    if (!content.trim()) throw new InvalidRequest("The instrument is empty. Paste the text so the platform can hash it.");
    if (Buffer.byteLength(content, "utf8") > MAX_DOCUMENT_BYTES) throw new InvalidRequest(`The instrument exceeds the prototype's ${MAX_DOCUMENT_BYTES / 1024} KB paste limit.`);
    if (existing && existing.versions.length > 0) throw new InvalidRequest(`${existing.label} is already recorded on this case (v${existing.versions.length}). A change is a new version under its amendment policy, not a second original.`);
    const [inst] = issueInstruments(cfg, caseId, [outputId], this.now(), actor.seat.id, "recorded_external");
    inst.versions[0].sha256 = sha256(content);
    inst.versions[0].summary = `${inst.label} recorded from ${fileName}`;
    this.store.instruments.put(inst);
    this.audit(actor, "instrument.recorded", { type: "instrument", id: inst.id }, { outputId, fileName, sha256: inst.versions[0].sha256, origin: "recorded_external", wasAwaiting: Boolean(existing) });
    return inst;
  }

  amendInstrument(actor: Actor, caseId: string, instrumentId: string, summary: string) {
    const inst = this.must(this.store.instruments.get(instrumentId), "Instrument", instrumentId);
    this.mustBelong(caseId, inst, "Instrument");
    const c = this.caseFor(inst.caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
    if (!summary.trim()) throw new InvalidRequest("Describe the modification. The summary goes into the version record.");
    const cfg = this.country(c.providerCountry);
    const st = cfg.stateMachine.states[c.machine.state];
    if (st?.kind === "terminal" && st.outcome !== "granted") throw new PermissionDenied(`The case has reached "${st.label}". No amendment can be recorded against an instrument of a case that has ended.`);
    const out = amendInstrument(inst, summary.trim(), this.now(), "seat" in actor ? actor.seat.id : "system");
    if (out.kind === "versioned") {
      this.store.instruments.put(out.instrument);
      this.audit(actor, "instrument.versioned", { type: "instrument", id: instrumentId }, { version: out.version.version, kind: out.version.kind, summary });
    } else {
      this.audit(actor, "instrument.new_required", { type: "instrument", id: instrumentId }, { policy: out.policy, reason: out.reason });
    }
    return out;
  }

  setInstrumentStatus(actor: Actor, caseId: string, instrumentId: string, status: Instrument["status"], note: string) {
    const inst = this.must(this.store.instruments.get(instrumentId), "Instrument", instrumentId);
    this.mustBelong(caseId, inst, "Instrument");
    const c = this.caseFor(inst.caseId);
    this.requireParticipant(actor, c);
    const out = this.country(c.providerCountry).outputs.find((o) => o.id === inst.outputId);
    // The verifying body's outcome is an authority act. A party recording it would be self-declaration under another name (R5).
    if (!("admin" in actor) && !("system" in actor)) {
      throw new PermissionDenied(`${out?.verifier ?? "The verifying authority"}'s verification outcome is recorded by the reviewer seat, never by a party to the case.`);
    }
    const allowed: Instrument["status"][] = ["verified", "correction_required", "cancelled", "issued"];
    if (!allowed.includes(status)) throw new InvalidRequest(`Status ${status} cannot be set here`);
    if (inst.status === "awaiting_record") throw new InvalidRequest(`${inst.label} has not been recorded yet. Record it before recording a verification outcome on it.`);
    if (!out?.verificationOpenAfterIssue) throw new InvalidRequest(`${inst.label} has no post-issue verification step in this regime.`);
    inst.status = status;
    this.store.instruments.put(inst);
    this.audit(actor, "instrument.status", { type: "instrument", id: instrumentId }, { status, note });
  }

  instrumentsFor(caseId: string) {
    return this.store.instruments.list().filter((i) => i.caseId === caseId);
  }

  // ------------------------------------------------------------ agreements
  createAgreement(actor: Actor, caseId: string, title: string, clauses: AgreementVersion["clauses"]): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can draft");
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    if (!clauses.length) throw new InvalidRequest("Select at least one model clause");
    const version = this.makeVersion(1, actor.seat.id, "Initial draft from model clauses", clauses, "platform");
    const a: Agreement = { id: `agr_${caseId}_${this.store.agreements.list().length + 1}`, caseId, title, status: "drafting", versions: [version], approvals: [], executions: [] };
    this.store.agreements.put(a);
    this.audit(actor, "agreement.drafted", { type: "agreement", id: a.id }, { version: 1, sha256: version.sha256 });
    return a;
  }

  /** Resolve an agreement, check it belongs to the case the interface is acting on, and check the seat is a participant. */
  private agreementFor(actor: Actor, caseId: string, agreementId: string): { a: Agreement; c: Case } {
    const a = this.must(this.store.agreements.get(agreementId), "Agreement", agreementId);
    this.mustBelong(caseId, a, "Agreement");
    const c = this.caseFor(a.caseId);
    this.requireParticipant(actor, c);
    return { a, c };
  }

  reviseAgreement(actor: Actor, caseId: string, agreementId: string, summary: string, clauses: AgreementVersion["clauses"], origin: AgreementVersion["origin"] = "platform"): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can revise");
    const { a } = this.agreementFor(actor, caseId, agreementId);
    this.require(actor, "member");
    if (a.status === "executed" || a.status === "recorded") throw new PermissionDenied("An executed agreement is immutable. Record an amendment as a new agreement or an instrument version.");
    if (!summary.trim()) throw new InvalidRequest("Say what changed in this version");
    const version = this.makeVersion(a.versions.length + 1, actor.seat.id, summary.trim(), clauses, origin);
    a.versions.push(version);
    a.status = "drafting";
    a.approvals = []; // approvals attach to a version
    this.store.agreements.put(a);
    this.audit(actor, "agreement.revised", { type: "agreement", id: a.id }, { version: version.version, sha256: version.sha256, origin });
    return a;
  }

  approveAgreement(actor: Actor, caseId: string, agreementId: string): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can approve");
    const { a, c } = this.agreementFor(actor, caseId, agreementId);
    this.require(actor, "authorised_signatory");
    if (a.status === "executed" || a.status === "recorded") throw new PermissionDenied("This agreement is already executed");
    const latest = a.versions[a.versions.length - 1];
    if (a.approvals.some((ap) => ap.organisationId === actor.seat.organisationId && ap.versionNumber === latest.version)) return a;
    a.approvals.push({ seatId: actor.seat.id, organisationId: actor.seat.organisationId, at: this.now().toISOString(), versionNumber: latest.version });
    const parties = c.participants.filter((p) => p.role === "demand" || p.role === "supply").map((p) => p.organisationId);
    a.status = parties.every((p) => a.approvals.some((ap) => ap.organisationId === p && ap.versionNumber === latest.version)) ? "approved" : "under_approval";
    this.store.agreements.put(a);
    this.audit(actor, "agreement.approved", { type: "agreement", id: a.id }, { version: latest.version, organisationId: actor.seat.organisationId, status: a.status });
    return a;
  }

  /** Simple electronic signature: an authenticated authorised signatory records assent to a specific document hash. */
  executeAgreement(actor: Actor, caseId: string, agreementId: string): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can execute");
    const { a, c } = this.agreementFor(actor, caseId, agreementId);
    this.require(actor, "authorised_signatory");
    if (a.status !== "approved" && a.status !== "executed") throw new PermissionDenied("Both organisations must approve the current version before execution");
    const latest = a.versions[a.versions.length - 1];
    if (a.executions.some((e) => e.organisationId === actor.seat.organisationId)) return a;
    a.executions.push({ seatId: actor.seat.id, organisationId: actor.seat.organisationId, at: this.now().toISOString(), versionNumber: latest.version, sha256: latest.sha256, method: "platform_click_to_sign", stepUpAuth: "demo" });
    const parties = c.participants.filter((p) => p.role === "demand" || p.role === "supply").map((p) => p.organisationId);
    a.status = parties.every((p) => a.executions.some((e) => e.organisationId === p)) ? "executed" : "approved";
    this.store.agreements.put(a);
    this.audit(actor, "agreement.executed", { type: "agreement", id: a.id }, { version: latest.version, sha256: latest.sha256, signatorySeat: actor.seat.id, organisationId: actor.seat.organisationId, method: "platform_click_to_sign", status: a.status });
    return a;
  }

  agreementsFor(caseId: string) {
    return this.store.agreements.list().filter((a) => a.caseId === caseId);
  }

  private makeVersion(version: number, authorSeatId: string, summary: string, clauses: AgreementVersion["clauses"], origin: AgreementVersion["origin"]): AgreementVersion {
    const body = clauses.map((c) => `${c.id}\n${c.title}\n${c.text}`).join("\n\n");
    return { version, at: this.now().toISOString(), authorSeatId, summary, clauses, sha256: sha256(`v${version}\n${body}`), origin };
  }

  /** Verification page: does this content match any recorded hash? */
  verifyContent(content: string): { sha256: string; matches: { type: string; id: string; where: string }[] } {
    const h = sha256(content);
    const matches: { type: string; id: string; where: string }[] = [];
    for (const a of this.store.agreements.list()) for (const v of a.versions) if (v.sha256 === h) matches.push({ type: "agreement", id: a.id, where: `version ${v.version}` });
    for (const i of this.store.instruments.list()) for (const v of i.versions) if (v.sha256 === h) matches.push({ type: "instrument", id: i.id, where: `version ${v.version}` });
    for (const d of this.store.documents.list()) if (d.sha256 === h) matches.push({ type: "document", id: d.id, where: d.label });
    return { sha256: h, matches };
  }

  // -------------------------------------------------------------- support
  requestSupport(actor: Actor, caseId: string, kind: "technical" | "expert", note: string) {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can request support");
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member"); // a request is written onto the case; a viewer seat reads it
    if (kind !== "technical" && kind !== "expert") throw new InvalidRequest(`Unknown support kind ${kind}`);
    const routedTo = kind === "expert"
      ? "Recorded on the case for the parties to take to their own adviser, or to a partner-provided adviser. Not a GENE-LINK review queue, and no adviser is attached to the case by this request."
      : "GENE-LINK technical support";
    c.supportRequests.push({ id: `sup_${caseId}_${c.supportRequests.length + 1}`, at: this.now().toISOString(), bySeatId: actor.seat.id, kind, routedTo, note });
    this.store.cases.put(c);
    this.audit(actor, "support.requested", { type: "case", id: caseId }, { kind, routedTo });
  }

  // ---------------------------------------------------------------- admin
  /** An intervention is recorded in the audit chain and on the case itself, so the parties see it without opening the log. */
  adminIntervene(admin: Actor, caseId: string, action: string, reason: string) {
    if (!("admin" in admin)) throw new PermissionDenied("Interventions are administrative actions");
    const c = this.caseFor(caseId);
    if (!action.trim() || !reason.trim()) throw new InvalidRequest("An intervention needs both what was done and why");
    c.interventions = [...(c.interventions ?? []), { id: `int_${caseId}_${(c.interventions?.length ?? 0) + 1}`, at: this.now().toISOString(), by: admin.admin.name, action: action.trim(), reason: reason.trim() }];
    this.store.cases.put(c);
    this.audit(admin, "admin.intervention", { type: "case", id: caseId }, { action: action.trim(), reason: reason.trim() });
  }
}
