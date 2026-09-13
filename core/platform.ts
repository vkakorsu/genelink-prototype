import { nextEntry, verifyChain, type AuditEntry } from "./audit/chain";
import { makeDisclosure, type Disclosure } from "./audit/disclosure";
import type { CaseFacts, CountryConfig, RegValue } from "./config/schema";
import { amendInstrument, issueInstruments, sha256 } from "./domain/instruments";
import { fullProjection, publicProjection, type FullListing, type PublicListing } from "./domain/listings";
import type {
  Agreement, AgreementVersion, Case, CaseDocument, EscalationRecord, Instrument, ManualReviewRecord, Membership, Organisation, Permission, Person,
} from "./domain/types";
import { attachedDuties, buildPathway, type Pathway } from "./engine/pathway";
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

const rank: Record<Permission, number> = { viewer: 0, member: 1, authorised_signatory: 2, administrator: 3 };

export class Platform {
  constructor(
    public readonly store: Store,
    public readonly countries: Map<string, CountryConfig>,
    public now: () => Date = () => new Date(),
  ) {}

  // ----------------------------------------------------------------- helpers
  country(code: string): CountryConfig {
    const c = this.countries.get(code);
    if (!c) throw new Error(`No configuration for provider country ${code}`);
    return c;
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
    const org = this.store.organisations.get(organisationId)!;
    org.verification = { status: "pending", method };
    this.store.organisations.put(org);
    this.audit(actor, "organisation.verification_requested", { type: "organisation", id: organisationId }, { method });
  }

  decideVerification(admin: Actor, organisationId: string, outcome: "verified" | "declined", reason: string) {
    if (!("admin" in admin)) throw new PermissionDenied("Verification decisions are administrative actions");
    const org = this.store.organisations.get(organisationId)!;
    org.verification = { ...org.verification, status: outcome, decidedBy: admin.admin.name, decidedAt: this.now().toISOString(), reason };
    this.store.organisations.put(org);
    this.audit(admin, "organisation.verification_decided", { type: "organisation", id: organisationId }, { outcome, reason });
  }

  // ---------------------------------------------------------- discovery
  publicListings(): PublicListing[] {
    return this.store.listings.list().map((l) => publicProjection(l, this.store.organisations.get(l.organisationId)!));
  }

  /** Full projection is available only to the owner or to a counterparty after mutual interest. */
  listingFor(actor: Actor, listingId: string): PublicListing | FullListing {
    const l = this.store.listings.get(listingId)!;
    const org = this.store.organisations.get(l.organisationId)!;
    if ("admin" in actor || "system" in actor) return fullProjection(l, org);
    if (actor.seat.organisationId === l.organisationId) return fullProjection(l, org);
    if (this.mutualInterest(actor.seat.organisationId, l)) return fullProjection(l, org);
    return publicProjection(l, org);
  }

  signalInterest(actor: Actor, listingId: string): { mutual: boolean; caseId?: string } {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can signal interest");
    this.require(actor, "member");
    const listing = this.store.listings.get(listingId)!;
    if (listing.organisationId === actor.seat.organisationId) throw new PermissionDenied("Cannot signal interest in your own listing");
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
    const listing = this.store.listings.get(listingId)!;
    this.require(actor, "member", listing.organisationId);
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

  private openCaseFromMatch(actor: Actor, listing: { id: string; organisationId: string; provenanceCountry: string; publicSummary: string }, counterpartyId?: string): Case {
    const other = counterpartyId ?? ("seat" in actor ? actor.seat.organisationId : listing.organisationId);
    const existing = this.store.cases.list().find((c) => c.listingId === listing.id && c.participants.some((p) => p.organisationId === other));
    if (existing) return existing;
    const cfg = this.country(listing.provenanceCountry);
    const supplier = this.store.organisations.get(listing.organisationId)!;
    const demand = this.store.organisations.get(other)!;
    const at = this.now();
    const c: Case = {
      id: `case_${this.store.cases.list().length + 1}_${cfg.code.toLowerCase()}`,
      title: `${demand.name} and ${supplier.name}`,
      providerCountry: cfg.code,
      participants: [
        { organisationId: other, role: "demand" },
        { organisationId: listing.organisationId, role: "supply" },
      ],
      listingId: listing.id,
      facts: { purpose: "commercial", activity: cfg.scope.questions[0].options[0].id, provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "unclear", tkInvolved: "unclear", flags: {} },
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

  pathwayFor(c: Case): Pathway {
    return buildPathway(this.country(c.providerCountry), c.facts);
  }

  dutiesFor(c: Case) {
    return attachedDuties(this.country(c.providerCountry));
  }

  updateFacts(actor: Actor, caseId: string, facts: CaseFacts): Case {
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    c.facts = facts;
    this.store.cases.put(c);
    this.audit(actor, "case.facts_updated", { type: "case", id: caseId }, { facts });
    this.syncEscalations(actor, c);
    return c;
  }

  /** Change of intent is a first-class event. It re-runs scope and applies the country's Class 4 consequence. */
  changeOfIntent(actor: Actor, caseId: string, newFacts: CaseFacts, description: string): Case {
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
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
    // Apply to instruments already issued
    for (const inst of this.instrumentsFor(caseId)) {
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

  /** Only a human with a recorded reason may move a manual-review state (R5). */
  decideManualReview(actor: Actor, recordId: string, outcome: string, reason: string) {
    if ("system" in actor) throw new PermissionDenied("Manual review judgments cannot be made by the system");
    const rec = this.store.manualReviews.get(recordId)!;
    const by = "admin" in actor ? actor.admin.name : actor.person.name;
    rec.status = "decided";
    rec.decision = { by, at: this.now().toISOString(), outcome, reason };
    this.store.manualReviews.put(rec);
    this.audit(actor, "manual_review.decided", { type: "manual_review", id: recordId }, { outcome, reason });
  }

  uploadDocument(actor: Actor, caseId: string, requirementId: string, label: string, fileName: string, content: string): CaseDocument {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can upload");
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    const doc: CaseDocument = { id: `doc_${caseId}_${requirementId}_${this.store.documents.list().length + 1}`, caseId, requirementId, label, fileName, sha256: sha256(content), uploadedBySeatId: actor.seat.id, uploadedAt: this.now().toISOString(), check: "present" };
    this.store.documents.put(doc);
    this.audit(actor, "document.uploaded", { type: "document", id: doc.id }, { requirementId, sha256: doc.sha256, check: "presence and type only, never sufficiency" });
    return doc;
  }

  documentsFor(caseId: string) {
    return this.store.documents.list().filter((d) => d.caseId === caseId);
  }

  markStage(actor: Actor, caseId: string, stageId: string, progress: Case["stageProgress"][string]) {
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    const pathway = this.pathwayFor(c);
    const stage = pathway.stages.find((s) => s.stage.id === stageId);
    if (!stage) throw new Error("Stage not on this pathway");
    if (stage.status === "halted" && progress === "complete") throw new PermissionDenied("A halted stage cannot be completed. The open question must be answered through configuration review first.");
    c.stageProgress[stageId] = progress;
    this.store.cases.put(c);
    this.audit(actor, "stage.progress", { type: "case", id: caseId }, { stageId, progress });
  }

  // -------------------------------------------------------- state machine
  fireEvent(actor: Actor, caseId: string, event: string, note?: string): Case {
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    const cfg = this.country(c.providerCountry);
    const actorKind = "system" in actor ? "system" : "admin" in actor ? "authority" : "applicant";
    // In the prototype, regulator events are recorded by a participant or an administrator on the authority's behalf.
    const declared = cfg.stateMachine.transitions.find((t) => t.from === c.machine.state && t.event === event);
    const effectiveActor = declared ? declared.actor : actorKind;
    c.machine = fire(cfg, c.machine, event, effectiveActor, this.now(), note);
    this.store.cases.put(c);
    this.audit(actor, "regulator.event_recorded", { type: "case", id: caseId }, { event, to: c.machine.state, recordedOnBehalfOf: effectiveActor, note });
    if (isGranted(cfg, c.machine)) this.issueOutputs(actor, c);
    return c;
  }

  tickClocks(caseId: string, now = this.now()): { lapsed: string[] } {
    const c = this.store.cases.get(caseId)!;
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

  private issueOutputs(actor: Actor, c: Case) {
    const cfg = this.country(c.providerCountry);
    // The configuration says which instruments issue in which state. The engine does not guess.
    const outputs = cfg.outputs.filter((o) => o.issuedInState === c.machine.state).map((o) => o.id);
    const already = this.instrumentsFor(c.id).map((i) => i.outputId);
    const toIssue = outputs.filter((o) => !already.includes(o));
    for (const inst of issueInstruments(cfg, c.id, toIssue, this.now(), "seat" in actor ? actor.seat.id : "system")) {
      this.store.instruments.put(inst);
      this.audit(actor, "instrument.recorded", { type: "instrument", id: inst.id }, { outputId: inst.outputId, issuer: inst.issuer, status: inst.status, sha256: inst.versions[0].sha256 });
    }
  }

  recordExternalInstrument(actor: Actor, caseId: string, outputId: string, fileName: string, content: string): Instrument {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can record an instrument");
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
    const cfg = this.country(c.providerCountry);
    const [inst] = issueInstruments(cfg, caseId, [outputId], this.now(), actor.seat.id, "recorded_external");
    inst.versions[0].sha256 = sha256(content);
    inst.versions[0].summary = `${inst.label} recorded from ${fileName}`;
    this.store.instruments.put(inst);
    this.audit(actor, "instrument.recorded", { type: "instrument", id: inst.id }, { outputId, fileName, sha256: inst.versions[0].sha256, origin: "recorded_external" });
    return inst;
  }

  amendInstrument(actor: Actor, instrumentId: string, summary: string) {
    const inst = this.store.instruments.get(instrumentId)!;
    const c = this.store.cases.get(inst.caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
    const out = amendInstrument(inst, summary, this.now(), "seat" in actor ? actor.seat.id : "system");
    if (out.kind === "versioned") {
      this.store.instruments.put(out.instrument);
      this.audit(actor, "instrument.versioned", { type: "instrument", id: instrumentId }, { version: out.version.version, kind: out.version.kind, summary });
    } else {
      this.audit(actor, "instrument.new_required", { type: "instrument", id: instrumentId }, { policy: out.policy, reason: out.reason });
    }
    return out;
  }

  setInstrumentStatus(actor: Actor, instrumentId: string, status: Instrument["status"], note: string) {
    const inst = this.store.instruments.get(instrumentId)!;
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
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    const version = this.makeVersion(1, actor.seat.id, "Initial draft from model clauses", clauses, "platform");
    const a: Agreement = { id: `agr_${caseId}_${this.store.agreements.list().length + 1}`, caseId, title, status: "drafting", versions: [version], approvals: [], executions: [] };
    this.store.agreements.put(a);
    this.audit(actor, "agreement.drafted", { type: "agreement", id: a.id }, { version: 1, sha256: version.sha256 });
    return a;
  }

  reviseAgreement(actor: Actor, agreementId: string, summary: string, clauses: AgreementVersion["clauses"], origin: AgreementVersion["origin"] = "platform"): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can revise");
    const a = this.store.agreements.get(agreementId)!;
    const c = this.store.cases.get(a.caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    if (a.status === "executed" || a.status === "recorded") throw new PermissionDenied("An executed agreement is immutable. Record an amendment as a new agreement or an instrument version.");
    const version = this.makeVersion(a.versions.length + 1, actor.seat.id, summary, clauses, origin);
    a.versions.push(version);
    a.status = "drafting";
    a.approvals = []; // approvals attach to a version
    this.store.agreements.put(a);
    this.audit(actor, "agreement.revised", { type: "agreement", id: a.id }, { version: version.version, sha256: version.sha256, origin });
    return a;
  }

  approveAgreement(actor: Actor, agreementId: string): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can approve");
    const a = this.store.agreements.get(agreementId)!;
    const c = this.store.cases.get(a.caseId)!;
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
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
  executeAgreement(actor: Actor, agreementId: string): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can execute");
    const a = this.store.agreements.get(agreementId)!;
    const c = this.store.cases.get(a.caseId)!;
    this.requireParticipant(actor, c);
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
    const c = this.store.cases.get(caseId)!;
    this.requireParticipant(actor, c);
    const routedTo = kind === "expert" ? "The parties' own adviser, or a partner-provided adviser. Not a GENE-LINK review queue." : "GENE-LINK technical support";
    c.supportRequests.push({ id: `sup_${caseId}_${c.supportRequests.length + 1}`, at: this.now().toISOString(), bySeatId: actor.seat.id, kind, routedTo, note });
    this.store.cases.put(c);
    this.audit(actor, "support.requested", { type: "case", id: caseId }, { kind, routedTo });
  }

  // ---------------------------------------------------------------- admin
  adminIntervene(admin: Actor, caseId: string, action: string, reason: string) {
    if (!("admin" in admin)) throw new PermissionDenied("Interventions are administrative actions");
    this.audit(admin, "admin.intervention", { type: "case", id: caseId }, { action, reason });
  }
}
