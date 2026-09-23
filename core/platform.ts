import { nextEntry, verifyChain, type AuditEntry, type VerificationResult } from "./audit/chain";
import { InvalidRequest, NotFound, PermissionDenied, errorKind } from "./errors";
import { makeDisclosure, type Disclosure } from "./audit/disclosure";
import { type CaseFacts, type CountryConfig, type RegValue } from "./config/schema";
import { AMENDABLE_POLICIES, FROZEN_STATUSES, amendInstrument, awaitingInstrument, issueInstruments, sha256 } from "./domain/instruments";
import { canonicalAgreementText, normaliseText } from "./domain/agreements";
import { FUNCTION_CODES, fullProjection, publicProjection, searchableText, type FullListing, type PublicListing } from "./domain/listings";
import type {
  Agreement, AgreementVersion, Case, CaseDocument, DemandSignal, EscalationRecord, Instrument, Listing, ManualReviewRecord, MarketFunction, Membership, Organisation, Permission, Person,
} from "./domain/types";
import { factProblems, factsFingerprint, withDeclaredDefaults } from "./engine/facts";
import { attachedDuties, buildPathway, type Pathway } from "./engine/pathway";
import { evaluateScope } from "./engine/scope";
import { applyLapse, extendClock, fire, initialSnapshot, isGranted, localDate, runsIn, tick } from "./engine/stateMachine";
import type { Store } from "./store/Store";

/**
 * The platform service: every operation the interfaces can perform. Permissions
 * are evaluated here, in the core, not in the interface. Every consequential
 * action writes to the audit chain. Every requirement statement shown to a person
 * writes to that person's disclosure log.
 */

export type Actor = { seat: Membership; person: Person; organisation: Organisation } | { system: true } | { admin: { personId: string; name: string } };

export { PermissionDenied, NotFound, InvalidRequest, errorKind } from "./errors";

const rank: Record<Permission, number> = { viewer: 0, member: 1, authorised_signatory: 2, administrator: 3 };

/** Prototype paste limit. Real files go to object storage in the MVP; the prototype hashes pasted text. */
export const MAX_DOCUMENT_BYTES = 256 * 1024;

/** Self-registered organisations one demonstration instance holds before registration pauses. */
export const MAX_SELF_REGISTRATIONS = 1000;

/**
 * Demand signals kept in memory. The prototype keeps the most recent ones and a running count per
 * objective, so the counts stay whole while memory stays bounded. The MVP keeps every signal in Postgres.
 */
export const MAX_DEMAND_SIGNALS_KEPT = 2000;

/**
 * A file name is the uploader's text. Keep the last path segment, drop control characters and the
 * characters that break a Content-Disposition header or a filesystem path, and bound the length.
 */
function cleanFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? "";
  const cleaned = base.replace(/[\x00-\x1f\x7f<>:"|?*]/g, "").replace(/\s+/g, " ").trim().slice(0, 120);
  return cleaned || "document";
}

function disclosureKey(personId: string, caseId: string | null, context: string, statement: string) {
  return JSON.stringify([personId, caseId, context, statement]);
}

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
    const entry = nextEntry(this.store.audit.last() ?? null, {
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

  /**
   * Verify the audit chain. Every request to /health and the console asks, so the result is kept as a
   * checkpoint: entries appended since the last check are verified from it, and the whole chain is
   * rehashed again at least once a minute, so an alteration anywhere is still found within that minute.
   */
  verifyAudit(): VerificationResult {
    const chain = this.store.audit.list();
    const at = Date.now();
    const cp = this.checkpoint;
    const resumable = cp && at - cp.fullAt < 60_000 && chain.length >= cp.length && (cp.length === 0 || chain[cp.length - 1]?.hash === cp.hash);
    const r = resumable ? verifyChain(chain, cp.length, cp.length ? cp.hash : undefined) : verifyChain(chain);
    this.checkpoint = r.ok ? { length: chain.length, hash: chain.at(-1)?.hash ?? "", fullAt: resumable ? cp.fullAt : at } : undefined;
    return r;
  }
  private checkpoint?: { length: number; hash: string; fullAt: number };

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
    this.disclosed?.add(disclosureKey(person.id, caseId, context, statement));
    return d;
  }

  /** Index of what each person has been told, so a repeat view checks in constant time, not by scanning the log. */
  private disclosed?: Set<string>;

  disclosuresFor(personId: string) {
    return this.store.disclosures.list().filter((d) => d.personId === personId).reverse();
  }

  /** Record a statement once per person, case and context. Re-rendering a page is not a new disclosure. */
  discloseOnce(person: Person, seat: Membership | null, caseId: string | null, countryCode: string | null, statement: string, reg: RegValue, context: string): Disclosure | null {
    this.disclosed ??= new Set(this.store.disclosures.list().map((d) => disclosureKey(d.personId, d.caseId, d.context, d.statement)));
    if (this.disclosed.has(disclosureKey(person.id, caseId, context, statement))) return null;
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
  /** A person's seats that can still act. Revoked seats stay on the record but are not offered. */
  seatsFor(personId: string) {
    return this.store.memberships.list().filter((m) => m.personId === personId && !m.revoked);
  }

  actorFor(seatId: string): Actor {
    const seat = this.store.memberships.get(seatId);
    if (!seat) throw new Error("Unknown seat");
    if (seat.revoked) throw new PermissionDenied("This seat was revoked by the organisation's administrator. It can no longer act for the organisation.");
    const person = this.store.persons.get(seat.personId)!;
    const organisation = this.store.organisations.get(seat.organisationId)!;
    return { seat, person, organisation };
  }

  /** An id not yet used in a collection: `${prefix}${n}` counting up from its size. */
  private nextId(prefix: string, taken: (id: string) => boolean, from: number): string {
    let n = from;
    while (taken(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  inviteSeat(actor: Actor, organisationId: string, person: Person, permission: Permission): Membership {
    this.require(actor, "administrator", organisationId);
    const m: Membership = { id: `seat_${person.id}_${organisationId}`, personId: person.id, organisationId, permission, since: this.now().toISOString(), invitedBy: "seat" in actor ? actor.seat.id : undefined };
    this.store.memberships.put(m);
    this.audit(actor, "seat.invited", { type: "membership", id: m.id }, { permission });
    return m;
  }

  /**
   * An organisation's administrator gives a colleague a seat with one of the four fixed permissions.
   * In the MVP the invitation goes to the colleague's email and is accepted with a passkey; the
   * prototype holds no email address, so the seat exists at once and is offered on the sign-in page.
   */
  inviteColleague(actor: Actor, organisationId: string, input: { name: string; permission: Permission }): Membership {
    if (!("seat" in actor)) throw new PermissionDenied("Seats are provisioned by the organisation's own administrator seat.");
    const org = this.must(this.store.organisations.get(organisationId), "Organisation", organisationId);
    if (actor.seat.organisationId !== organisationId || actor.seat.permission !== "administrator") {
      this.audit(actor, "seat.invite_denied", { type: "organisation", id: organisationId }, { reason: `seat is ${actor.seat.permission} of ${actor.seat.organisationId}` });
      throw this.denied(`Only an administrator seat of ${actor.seat.organisationId === organisationId ? "this organisation" : "the organisation itself"} can give someone a seat. Your seat is ${actor.seat.permission.replace("_", " ")}. This attempt has been recorded.`);
    }
    const name = input.name.replace(/\s+/g, " ").trim();
    if (name.length < 2 || name.length > 100) throw new InvalidRequest("Give the colleague's name, between 2 and 100 characters.");
    const permissions: Permission[] = ["administrator", "authorised_signatory", "member", "viewer"];
    if (!permissions.includes(input.permission)) throw new InvalidRequest("Choose one of the four seat permissions offered: administrator, authorised signatory, member or viewer.");
    const active = this.store.memberships.list().filter((m) => m.organisationId === organisationId && !m.revoked);
    if (active.length >= 50) throw new InvalidRequest(`${org.name} already has 50 active seats, the prototype's limit. Revoke a seat before adding another.`);
    const person: Person = { id: this.nextId("p_new_", (id) => !!this.store.persons.get(id), this.store.persons.list().length + 1), name, email: "not held in this demo", country: org.country, onboardingPath: actor.person.onboardingPath, badges: [] };
    this.store.persons.put(person);
    return this.inviteSeat(actor, organisationId, person, input.permission);
  }

  /**
   * Revocation ends what a seat may do; it does not erase what it did. The record is kept and marked,
   * so earlier approvals and signatures still name who gave them. An organisation always keeps one
   * administrator seat, or nobody could manage its seats again.
   */
  revokeSeat(actor: Actor, seatId: string, reason: string): Membership {
    if (!("seat" in actor)) throw new PermissionDenied("Seats are revoked by the organisation's own administrator seat.");
    const m = this.must(this.store.memberships.get(seatId), "Seat", seatId);
    if (actor.seat.organisationId !== m.organisationId || actor.seat.permission !== "administrator") {
      this.audit(actor, "seat.revoke_denied", { type: "membership", id: seatId }, { reason: `seat is ${actor.seat.permission} of ${actor.seat.organisationId}` });
      throw this.denied(`Only an administrator seat of the organisation can revoke its seats. Your seat is ${actor.seat.permission.replace("_", " ")}. This attempt has been recorded.`);
    }
    if (m.revoked) throw new InvalidRequest("That seat was already revoked.");
    const admins = this.store.memberships.list().filter((x) => x.organisationId === m.organisationId && !x.revoked && x.permission === "administrator");
    if (m.permission === "administrator" && admins.length <= 1) {
      throw new InvalidRequest("That is the organisation's only administrator seat. Give another person an administrator seat first, or nobody could manage the organisation's seats.");
    }
    const why = reason.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!why) throw new InvalidRequest("Say why the seat is revoked. The reason goes into the audit chain.");
    m.revoked = { at: this.now().toISOString(), bySeatId: actor.seat.id, reason: why };
    this.store.memberships.put(m);
    this.audit(actor, "seat.revoked", { type: "membership", id: seatId }, { permission: m.permission, reason: why });
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
    if (!reason.trim()) throw new InvalidRequest("A verification decision needs a reason. It is recorded in the audit chain and shown to the organisation.");
    if (org.verification.status !== "pending") throw new InvalidRequest(`${org.name} has no pending verification request (status: ${org.verification.status}). A decision answers a request.`);
    org.verification = { ...org.verification, status: outcome, decidedBy: admin.admin.name, decidedAt: this.now().toISOString(), reason: reason.trim() };
    this.store.organisations.put(org);
    this.audit(admin, "organisation.verification_decided", { type: "organisation", id: organisationId }, { outcome, reason: reason.trim() });
    if (outcome === "verified") this.openWaitingMatches(org);
  }

  /**
   * Mutual interest recorded while an organisation was in verification is a match waiting at the
   * gate. When the organisation is verified, every such match whose other side is verified opens
   * now, so that nobody has to notice and signal again.
   */
  private openWaitingMatches(org: Organisation) {
    for (const listing of this.store.listings.list()) {
      if (listing.withdrawn) continue;
      const owner = this.store.organisations.get(listing.organisationId);
      if (!owner || owner.verification.status !== "verified") continue;
      const others = listing.organisationId === org.id
        ? this.store.interests.list().filter((i) => i.toListingId === listing.id).map((i) => i.fromOrganisationId)
        : [org.id];
      for (const other of others) {
        const counterparty = this.store.organisations.get(other);
        if (!counterparty || counterparty.verification.status !== "verified") continue;
        if (!this.mutualInterest(other, listing)) continue;
        if (this.store.cases.list().some((c) => c.listingId === listing.id && c.participants.some((p) => p.organisationId === other))) continue;
        if (!this.countries.has(this.providerCountryFor(listing, counterparty))) continue;
        this.openCaseFromMatch({ system: true }, listing, other);
      }
    }
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
    // A bound on self-registration keeps a public instance from being filled until it falls over. The
    // interface rate-limits registration per client first (lib/rateLimit.ts), so one visitor cannot
    // reach this bound alone. The MVP puts sign-up behind identity checks as well.
    if (this.store.organisations.list().filter((o) => o.id.startsWith("org_new_")).length >= MAX_SELF_REGISTRATIONS) {
      throw new InvalidRequest("Registration is paused on this demonstration instance: it has reached its limit of self-registered organisations. An administrator can reset the demo.");
    }
    const personId = this.nextId("p_new_", (id) => !!this.store.persons.get(id), this.store.persons.list().length + 1);
    const organisationId = this.nextId("org_new_", (id) => !!this.store.organisations.get(id), this.store.organisations.list().length + 1);
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

  /**
   * A declared visit objective becomes a demand signal. The objective itself stays with the visitor
   * (it shapes navigation and search for that visit); what the platform keeps is what was sought and
   * by what kind of organisation, without the person.
   */
  recordDemandSignal(actor: Actor | null, input: { want: DemandSignal["want"]; have: string; redactions: number }): DemandSignal {
    const org = actor && "seat" in actor ? actor.organisation : null;
    const tally = this.demandTally();
    tally.total++;
    tally.byWant[input.want] = (tally.byWant[input.want] ?? 0) + 1;
    const signal: DemandSignal = {
      id: `dem_${tally.total}`,
      at: this.now().toISOString(),
      want: input.want,
      have: input.have.slice(0, 200),
      redactions: input.redactions,
      organisationKind: org?.kind ?? null,
      organisationFunctions: org?.functions ?? [],
      organisationCountry: org?.country ?? null,
    };
    this.store.demandSignals.put(signal);
    // Keep the most recent signals; the tally above keeps the counts whole.
    const kept = this.store.demandSignals.list();
    for (const old of kept.slice(0, Math.max(0, kept.length - MAX_DEMAND_SIGNALS_KEPT))) this.store.demandSignals.remove(old.id);
    return signal;
  }

  private tally?: { total: number; byWant: Record<string, number> };
  private demandTally() {
    if (!this.tally) {
      const all = this.store.demandSignals.list();
      this.tally = { total: all.length, byWant: all.reduce<Record<string, number>>((m, s) => ({ ...m, [s.want]: (m[s.want] ?? 0) + 1 }), {}) };
    }
    return this.tally;
  }

  /** Every declaration counted since the instance started, and the most recent ones kept. */
  demandSignalSummary(recent = 6): { total: number; byWant: Record<string, number>; recent: DemandSignal[]; kept: number } {
    const t = this.demandTally();
    const kept = this.store.demandSignals.list();
    return { total: t.total, byWant: { ...t.byWant }, recent: kept.slice(-recent).reverse(), kept: kept.length };
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
        if (l.withdrawn) return false;
        if (country && l.provenanceCountry !== country) return false;
        if (side && l.side !== side) return false;
        if (!q) return true;
        return searchableText(l).includes(q);
      })
      .map((l) => publicProjection(l, this.must(this.store.organisations.get(l.organisationId), "Organisation", l.organisationId)));
  }

  /** What discovery shows: every published listing that its owner has not withdrawn. */
  publicListings(): PublicListing[] {
    return this.store.listings.list().filter((l) => !l.withdrawn).map((l) => publicProjection(l, this.store.organisations.get(l.organisationId)!));
  }

  /**
   * An organisation publishes an offer or a need. It is a public statement on the organisation's
   * behalf, so it takes an authorised signatory or administrator seat. The public fields are what
   * anyone can search; the full fields are revealed only when a match opens a case. An offer names a
   * provider country with a configured pathway, because a match on it opens a case under that
   * country's rules; a need may accept any provenance, in which case the supplier's country decides.
   */
  createListing(actor: Actor, input: {
    side: string; provenanceCountry: string; functionCodes: string[]; resourceClass: string; publicSummary: string;
    indicativeScale: string; publicTaxon: string; speciesDetail: string; localityDetail: string; fullDescription: string; dsiExposure: string;
  }): Listing {
    if (!("seat" in actor)) throw new PermissionDenied("A listing is published by a seat of the organisation that holds the material or the need. Administrators do not publish for organisations.");
    this.require(actor, "authorised_signatory");
    const org = actor.organisation;
    if (org.verification.status === "declined") throw new PermissionDenied("Your organisation's verification was declined. It cannot publish listings until a new verification request is decided.");
    const side = input.side === "offer" || input.side === "need" ? input.side : null;
    if (!side) throw new InvalidRequest("Choose whether this is an offer (you supply) or a need (you are looking for a supplier).");
    const configured = [...this.countries.keys()].sort();
    const country = input.provenanceCountry.trim().toUpperCase() === "ANY" ? "any" : input.provenanceCountry.trim().toUpperCase();
    if (side === "offer" && !this.countries.has(country)) throw new InvalidRequest(`An offer names the provider country whose rules a match would run under. Choose one with a configured pathway: ${configured.join(", ")}.`);
    if (side === "need" && country !== "any" && !this.countries.has(country)) throw new InvalidRequest(`A need accepts any provenance with a lawful pathway, or one configured provider country: ${configured.join(", ")}.`);
    const codes = [...new Set(input.functionCodes)];
    if (!codes.length || codes.length > 3 || codes.some((f) => !(FUNCTION_CODES as readonly string[]).includes(f))) throw new InvalidRequest("Choose one to three functions from the taxonomy offered.");
    const clean = (v: string, max: number) => v.replace(/\s+/g, " ").trim().slice(0, max);
    const resourceClass = clean(input.resourceClass, 120);
    const publicSummary = clean(input.publicSummary, 400);
    if (resourceClass.length < 3) throw new InvalidRequest("Say what is offered or sought, in a few words (for example: plant metabolite extracts, ex situ).");
    if (publicSummary.length < 10) throw new InvalidRequest("Write a short public summary. It is what a searcher reads before any match.");
    const dsi = (["none", "possible", "likely"] as const).find((d) => d === input.dsiExposure);
    if (!dsi) throw new InvalidRequest("Choose the DSI exposure from the options offered.");
    if (this.store.listings.list().filter((l) => l.organisationId === org.id && !l.withdrawn).length >= 50) throw new InvalidRequest(`${org.name} already has 50 published listings, the prototype's limit. Withdraw one first.`);
    const id = this.nextId("lst_new_", (x) => !!this.store.listings.get(x), this.store.listings.list().length + 1);
    const serial = String(1000 + this.store.listings.list().length + 1).padStart(4, "0");
    const listing: Listing = {
      id,
      glId: `GL-${side === "need" ? "NEED" : country}-${this.now().getUTCFullYear()}-${serial}`,
      organisationId: org.id,
      side,
      functionCodes: codes,
      resourceClass,
      provenanceCountry: country,
      publicSummary,
      indicativeScale: clean(input.indicativeScale, 120) || "Not stated",
      publicTaxon: clean(input.publicTaxon, 160) || "Withheld by the listing owner until mutual interest",
      speciesDetail: clean(input.speciesDetail, 1000) || "Not stated",
      localityDetail: clean(input.localityDetail, 1000) || "Not stated",
      fullDescription: clean(input.fullDescription, 1000) || "Not stated",
      dsiExposure: dsi,
      createdAt: this.now().toISOString(),
    };
    this.store.listings.put(listing);
    this.audit(actor, "listing.published", { type: "listing", id }, { glId: listing.glId, side, provenanceCountry: country, functionCodes: codes });
    return listing;
  }

  /** The owner takes a listing out of discovery. Signals already made stay on the record and cases already opened continue. */
  withdrawListing(actor: Actor, listingId: string, reason: string): Listing {
    if (!("seat" in actor)) throw new PermissionDenied("A listing is withdrawn by a seat of the organisation that published it.");
    const l = this.must(this.store.listings.get(listingId), "Listing", listingId);
    this.require(actor, "authorised_signatory", l.organisationId);
    if (l.withdrawn) throw new InvalidRequest("This listing is already withdrawn.");
    const why = reason.replace(/\s+/g, " ").trim().slice(0, 300);
    if (!why) throw new InvalidRequest("Say why the listing is withdrawn. The reason goes into the audit chain.");
    l.withdrawn = { at: this.now().toISOString(), bySeatId: actor.seat.id, reason: why };
    this.store.listings.put(l);
    this.audit(actor, "listing.withdrawn", { type: "listing", id: listingId }, { reason: why });
    return l;
  }

  /**
   * Full projection is available only to the owner or to a counterparty whose match has opened a case.
   * Mutual interest held at the verification gate reveals nothing: the reveal is the case opening.
   */
  listingFor(actor: Actor, listingId: string): PublicListing | FullListing {
    const l = this.must(this.store.listings.get(listingId), "Listing", listingId);
    const org = this.must(this.store.organisations.get(l.organisationId), "Organisation", l.organisationId);
    if ("admin" in actor || "system" in actor) return fullProjection(l, org);
    if (actor.seat.organisationId === l.organisationId) return fullProjection(l, org);
    if (this.matchOpened(actor.seat.organisationId, l)) return fullProjection(l, org);
    return publicProjection(l, org);
  }

  signalInterest(actor: Actor, listingId: string): { mutual: boolean; caseId?: string } {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can signal interest");
    this.require(actor, "member");
    const listing = this.must(this.store.listings.get(listingId), "Listing", listingId);
    if (listing.withdrawn) throw new InvalidRequest("This listing was withdrawn by its owner. It no longer takes signals of interest.");
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
    if (listing.withdrawn) throw new InvalidRequest("This listing is withdrawn. Signalling back would open a case on a listing you have taken out of discovery; publish it again as a new listing if the offer stands.");
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

  /** Both sides have signalled but the case waits on verification. Nothing is revealed yet. */
  matchWaiting(orgId: string, listing: { id: string; organisationId: string }): boolean {
    return this.mutualInterest(orgId, listing) && !this.matchOpened(orgId, listing);
  }

  private matchOpened(orgId: string, listing: { id: string }): boolean {
    return this.store.cases.list().some((c) => c.listingId === listing.id && c.participants.some((p) => p.organisationId === orgId));
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
        // No reveal has happened, so the other side is named by kind and country only.
        const mine = "seat" in actor && actor.seat.organisationId === org.id;
        const who = mine ? "Your organisation" : `The other organisation (${org.kind.replace(/_/g, " ")}, ${org.country})`;
        throw new PermissionDenied(`${who} is ${org.verification.status === "pending" ? "still in verification" : "verification-declined"}. Mutual interest is recorded, and the case opens by itself as soon as both organisations are verified; identities are revealed then, not before.`);
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
      // Nothing is guessed. Purpose, activity, provenance and exchange stay unestablished until the
      // parties answer them, so scope reads "undetermined" and every stage that turns on them halts
      // and names the question. Community holding and traditional knowledge start as "unclear", and
      // each country's own facts as the "not yet established" option its question declares. The one
      // fact the platform already holds is the applicant's: the demand-side organisation, whose
      // registered country says whether it applies as a national or a foreign legal person.
      facts: withDeclaredDefaults(cfg, { applicantType: demand.country === cfg.code ? "national_legal" : "foreign_legal", communityHeld: "unclear", tkInvolved: "unclear", flags: {} }),
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
      if (errorKind(e) === "permission_denied") this.recordDenied(actor, "case_audit.view", { type: "case", id: caseId }, "Not a participant in this case");
      throw e;
    }
    const related = new Set([caseId, ...this.instrumentsFor(caseId).map((i) => i.id), ...this.agreementsFor(caseId).map((a) => a.id), ...this.documentsFor(caseId).map((d) => d.id), ...this.escalationsFor(caseId).map((e) => e.id), ...this.manualReviewsFor(caseId).map((m) => m.id)]);
    return this.store.audit.list().filter((e) => related.has(e.subject.id));
  }

  /**
   * The pathway is a pure function of the country file, the facts and the judgments recorded, so it is
   * kept per combination: a page that reads it several times, or a list of many cases, builds it once.
   */
  pathwayFor(c: Case): Pathway {
    const decided = this.decidedReviews(c.id);
    const key = `${c.providerCountry}|${factsFingerprint(c.facts)}|${[...decided].sort().join(",")}`;
    const hit = this.pathways.get(key);
    if (hit) return hit;
    const built = buildPathway(this.country(c.providerCountry), c.facts, decided);
    if (this.pathways.size >= 500) this.pathways.clear();
    this.pathways.set(key, built);
    return built;
  }
  private pathways = new Map<string, Pathway>();

  /** The manual reviews already judged on a case, by review id. The pathway reads these (R5). */
  decidedReviews(caseId: string): Set<string> {
    return new Set(this.manualReviewsFor(caseId).filter((r) => r.status === "decided").map((r) => r.reviewId));
  }

  dutiesFor(c: Case) {
    return attachedDuties(this.country(c.providerCountry));
  }

  private caseFor(caseId: string): Case {
    return this.must(this.store.cases.get(caseId), "Case", caseId);
  }

  updateFacts(actor: Actor, caseId: string, incoming: CaseFacts, seenFingerprint?: string): Case {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "member");
    if (seenFingerprint !== undefined && seenFingerprint !== factsFingerprint(c.facts)) {
      throw new InvalidRequest("The facts on this case were changed by someone else after you opened the page. Nothing was saved, so their change is not undone. Reload, check what they entered, and make your edit again.");
    }
    const cfg = this.country(c.providerCountry);
    const facts = withDeclaredDefaults(cfg, incoming);
    const problems = factProblems(cfg, facts);
    if (problems.length) throw new InvalidRequest(problems.join(" "));
    const before = evaluateScope(cfg, c.facts).kind;
    const after = evaluateScope(cfg, facts).kind;
    // Answering the intake questions for the first time is not a change of intent: before a scope
    // answer exists there is no intent on the record to change. Nor is correcting the intake before
    // anything has been filed or issued: a change of intent carries the country's consequence (Kenya:
    // notify NEMA and apply for a new permit), which would put a false statement on the record for an
    // application that does not exist yet. Once something is filed, crossing scope takes the form.
    const filed = c.machine.history.some((h) => h.actor === "applicant") || this.instrumentsFor(caseId).length > 0;
    if (before !== after && before !== "undetermined" && filed) {
      throw new InvalidRequest(`That edit changes the scope answer from ${before.replaceAll("_", " ")} to ${after.replaceAll("_", " ")} after a filing. A scope change after filing is a declared change of intent with the country's consequence policy on the record. Use the change-of-intent form, not a facts edit.`);
    }
    c.facts = facts;
    this.store.cases.put(c);
    this.audit(actor, before !== after ? "case.facts_corrected_before_filing" : "case.facts_updated", { type: "case", id: caseId }, { facts, ...(before !== after ? { scopeBefore: before, scopeAfter: after } : {}) });
    this.reopenStagesTheFactsNowBlock(c);
    this.syncEscalations(actor, c);
    return c;
  }

  /**
   * Change of intent is a first-class event. It re-runs scope and applies the country's Class 4
   * consequence, which can version a live contract (Colombia) or require a new application. That
   * is a declaration the organisation stands behind before the regulator, so it takes an
   * authorised signatory: a member prepares facts, a signatory commits to a change in them.
   */
  changeOfIntent(actor: Actor, caseId: string, incoming: CaseFacts, description: string, seenFingerprint?: string): Case {
    const c = this.caseFor(caseId);
    this.requireParticipant(actor, c);
    if (seenFingerprint !== undefined && seenFingerprint !== factsFingerprint(c.facts)) {
      throw new InvalidRequest("The facts on this case were changed by someone else after you opened the page. Nothing was recorded. Reload and declare the change of intent against the facts as they now stand.");
    }
    if ("seat" in actor && rank[actor.seat.permission] < rank.authorised_signatory) {
      throw new PermissionDenied("A change of intent is a declaration the organisation stands behind: it re-runs scope and applies this country's consequence to the instrument. It needs an authorised signatory or administrator seat. Your seat can edit facts that keep the scope answer, and record work in progress.");
    }
    const cfg = this.country(c.providerCountry);
    const newFacts = withDeclaredDefaults(cfg, incoming);
    const problems = factProblems(cfg, newFacts);
    if (problems.length) throw new InvalidRequest(problems.join(" "));
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
    this.reopenStagesTheFactsNowBlock(c);
    // Apply to instruments already recorded. An instrument the platform is still awaiting has nothing to amend.
    // Where the policy is an addendum or variation, the amendment is the parties' and the authority's
    // document: the platform records that one is required and appends a version only when it is recorded.
    const coiId = c.changeOfIntent[c.changeOfIntent.length - 1].id;
    for (const inst of this.instrumentsFor(caseId)) {
      if (FROZEN_STATUSES.has(inst.status)) continue;
      if (AMENDABLE_POLICIES.has(inst.amendmentPolicy)) {
        this.store.instruments.put({ ...inst, pendingAmendment: { changeOfIntentId: coiId, at, description } });
        this.audit(actor, "instrument.amendment_required", { type: "instrument", id: inst.id }, { policy: inst.amendmentPolicy, changeOfIntentId: coiId });
        continue;
      }
      const out = amendInstrument(inst, `Change of intent: ${description}`, this.now(), "seat" in actor ? actor.seat.id : "system");
      if (out.kind === "new_instrument_required") {
        this.audit(actor, "instrument.new_required", { type: "instrument", id: inst.id }, { policy: out.policy, reason: out.reason });
      }
    }
    this.syncEscalations(actor, c);
    return c;
  }

  /**
   * A stage marked complete on earlier facts is not complete once new facts stop or halt it (a species
   * check that comes back "listed", an answer that raises an open question). Its completion is reopened
   * and the reason recorded, so the pathway never counts as done a step the law now blocks.
   */
  private reopenStagesTheFactsNowBlock(c: Case) {
    for (const s of this.pathwayFor(c).stages) {
      if ((s.status === "halted" || s.status === "stopped") && c.stageProgress[s.stage.id] === "complete") {
        c.stageProgress[s.stage.id] = "in_progress";
        this.audit({ system: true }, "stage.reopened", { type: "case", id: c.id }, { stageId: s.stage.id, reason: s.status === "stopped" ? "a prohibition applies on the facts now entered" : "the facts now entered raise a question this stage depends on" });
      }
    }
    this.store.cases.put(c);
  }

  /**
   * Keep the case's escalation records in step with its pathway. A new legal unknown is raised to
   * its owner. One the pathway no longer raises is closed with the reason on the record: either the
   * configuration now carries an answer (legal review changed the file) or the case's facts no longer
   * reach the requirement. It reopens if it comes back. Nothing is deleted.
   */
  syncEscalations(actor: Actor, c: Case) {
    const pathway = this.pathwayFor(c);
    const cfg = this.country(c.providerCountry);
    const live = new Set<string>();
    for (const e of pathway.escalations) {
      // An unanswered intake fact halts the stage on the page, but it is the parties' question,
      // not a legal unknown for the escalation owner: it is not persisted as an escalation record.
      if (e.kind === "unanswered_fact") continue;
      const id = `esc_${c.id}_${e.id}`;
      live.add(id);
      const existing = this.store.escalations.get(id);
      if (!existing) {
        const rec: EscalationRecord = { id, caseId: c.id, stageId: e.stageId, question: e.question, owner: e.owner, ownerName: e.ownerName, status: "open", raisedAt: this.now().toISOString() };
        this.store.escalations.put(rec);
        this.audit({ system: true }, "escalation.raised", { type: "escalation", id }, { stageId: e.stageId, owner: e.owner, requirement: e.requirementId });
      } else if (existing.status !== "open") {
        existing.status = "open";
        existing.answer = undefined;
        this.store.escalations.put(existing);
        this.audit({ system: true }, "escalation.reopened", { type: "escalation", id }, { stageId: e.stageId, owner: e.owner, requirement: e.requirementId });
      }
    }
    for (const rec of this.escalationsFor(c.id)) {
      if (rec.status !== "open" || live.has(rec.id)) continue;
      const requirementId = rec.id.slice(`esc_${c.id}_`.length).split(":").pop() ?? "";
      const stillUnknownInFile = this.unknownInFile(cfg, rec.stageId, requirementId);
      const byJudgment = pathway.stages.some((s) => s.stage.id === rec.stageId && s.requirements.some((r) => r.id === requirementId && r.answeredByJudgment));
      const note = byJudgment
        ? "Answered for this case by the recorded manual-review judgment (R5). No statutory test exists, so the question stays open in the configuration for every other case."
        : stillUnknownInFile
          ? "No longer raised on this case: the facts entered no longer reach this requirement. The question itself remains open in the configuration."
          : "No longer raised: the configuration now carries an answer for this requirement. The file records the evidence class and citation.";
      rec.status = byJudgment || !stillUnknownInFile ? "answered" : "closed";
      rec.answer = { by: byJudgment ? "manual-review judgment" : "system", at: this.now().toISOString(), note };
      this.store.escalations.put(rec);
      this.audit({ system: true }, rec.status === "answered" ? "escalation.answered" : "escalation.closed", { type: "escalation", id: rec.id }, { note });
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

  /** Whether the file still carries this requirement as an unresolved, driving value. */
  private unknownInFile(cfg: CountryConfig, stageId: string, requirementId: string): boolean {
    if (stageId === "intake") {
      const rule = cfg.scope.rules.find((x) => x.id === requirementId);
      if (rule) return rule.result === "escalate";
    }
    const req = cfg.stages.find((s) => s.id === stageId)?.requirements.find((r) => r.id === requirementId);
    return !!req && req.reg.state === "unknown" && req.reg.drives;
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
    // The judgment is this case's answer to the open rules it declares; their escalations on this case close.
    this.syncEscalations(actor, this.caseFor(rec.caseId));
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
    const h = sha256(normaliseText(content));
    const dup = this.documentsFor(caseId).find((d) => d.requirementId === requirementId && d.sha256 === h);
    if (dup) throw new InvalidRequest(`An identical document (${dup.fileName}) is already on file for this requirement. Same content, same hash, nothing to add.`);
    const doc: CaseDocument = { id: `doc_${caseId}_${requirementId}_${this.store.documents.list().length + 1}`, caseId, requirementId, label, fileName: cleanFileName(fileName), sha256: h, uploadedBySeatId: actor.seat.id, uploadedAt: this.now().toISOString(), check: "present" };
    this.store.documents.put(doc);
    this.audit(actor, "document.uploaded", { type: "document", id: doc.id }, { requirementId, sha256: doc.sha256, check: "presence recorded and hashed, never sufficiency" });
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
    if (stage.status === "informational") throw new InvalidRequest("A phase-two stage records duties. It is never marked complete (R10).");
    if (stage.status === "stopped" && progress === "complete") throw new PermissionDenied(`A prohibition applies on these facts: ${stage.stops.map((x) => x.text).join(" ")} The stage cannot be completed, and the platform offers no way round it.`);
    if (stage.status === "halted" && progress === "complete") throw new PermissionDenied("A halted stage cannot be completed. The open question must be answered first: a legal unknown through configuration review, an unanswered fact on the intake form.");
    const blockedBefore = pathway.stages.slice(0, pathway.stages.indexOf(stage)).filter((s) => s.status === "halted" || s.status === "stopped");
    if (progress === "complete" && blockedBefore.length) {
      throw new PermissionDenied(`An earlier stage is ${blockedBefore.some((s) => s.status === "stopped") ? "stopped or halted" : "halted"}: ${blockedBefore.map((s) => s.stage.title).join("; ")}. A later stage cannot be marked complete while the question it depends on is open.`);
    }
    // A stage whose substance is the regulator's act, or an instrument the State issues, is complete
    // when the record says so, not when a party says so.
    if (progress === "complete") {
      const cfg = this.country(c.providerCountry);
      const st = cfg.stateMachine.states[c.machine.state];
      if (stage.stage.usesStateMachine && st?.kind !== "terminal") {
        throw new PermissionDenied(`"${stage.stage.title}" follows the regulator's own process, which is at "${st?.label ?? c.machine.state}". It is complete when the proceeding reaches its outcome, recorded under Regulator processing, not before.`);
      }
      const missing = stage.stage.produces.filter((o) => !this.instrumentsFor(caseId).some((i) => i.outputId === o && i.versions.length > 0));
      if (missing.length) {
        const labels = missing.map((o) => cfg.outputs.find((x) => x.id === o)?.label ?? o);
        throw new PermissionDenied(`"${stage.stage.title}" ends in ${labels.join(" and ")}. It is complete once an authorised signatory has recorded ${missing.length === 1 ? "that instrument" : "those instruments"} on the case.`);
      }
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
    // A lapse is a fact about time, not an act anyone records. It follows from the clock: the clock
    // check applies it once the last day has ended where the authority sits (tickClocks). Recorded by
    // hand it would put a lapse, and a remedy against the administrator, on the record while the law's
    // days are still running: the reverse of R8. Nobody records it by hand, the administrator included.
    if (event === "lapse" || (declared && cfg.stateMachine.states[declared.to]?.outcome === "lapsed")) {
      const live = tick(cfg, c.machine, this.now()).snap.clocks;
      const running = cfg.stateMachine.clocks.find((k) => runsIn(k).includes(c.machine.state) && live[k.id]?.deadline && !live[k.id].lapsed);
      const until = running ? ` The ${running.label} runs to the end of ${localDate(new Date(live[running.id].deadline!), cfg.timeZone)} (${cfg.timeZone})${live[running.id].suspended ? " and is suspended now" : ""}.` : "";
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: "a lapse follows from the clock and is never recorded by hand" });
      throw this.denied(`A lapse is not recorded by hand. It follows from the clock: when a running clock's last day has ended in ${cfg.name}, the clock check records the lapse against the administrator.${until} This attempt has been recorded.`);
    }
    const effectiveActor = declared ? declared.actor : actorKind;
    // Authority and system events are recorded by an administrator on the authority's
    // behalf. A party seat can record only applicant events; a denied attempt is
    // audited rather than silently ignored.
    if (effectiveActor !== "applicant" && !("admin" in actor) && !("system" in actor)) {
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: "authority events are recorded by an administrator on the authority's behalf" });
      throw this.denied("That event belongs to the authority. An administrator records it on the authority's behalf; your seat can record applicant events only.");
    }
    // The reverse boundary: a filing is the parties' own act. The platform's administrator records
    // what the authority did; it never files, resubmits, appeals or withdraws for a party.
    if (effectiveActor === "applicant" && "admin" in actor) {
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: "applicant filings belong to the parties' authorised signatories" });
      throw this.denied(`"${event.replace(/_/g, " ")}" is the applicant's own act. An authorised signatory of a party to the case records it; the platform's administrator does not file for a party.`);
    }
    // An applicant event (submit, resubmit, withdraw, appeal) is a filing before the regulator:
    // a commitment the organisation stands behind, so it takes the same seat as recording an
    // instrument. A member prepares the bundle; a signatory files it. Viewers read.
    if ("seat" in actor && rank[actor.seat.permission] < rank.authorised_signatory) {
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: `filing before the regulator needs an authorised signatory seat; seat is ${actor.seat.permission}` });
      throw this.denied(`Recording "${event.replace(/_/g, " ")}" is a filing before the regulator, a commitment the organisation stands behind. It needs an authorised signatory or administrator seat; your seat is ${actor.seat.permission}. This attempt has been recorded.`);
    }
    // Where the law names the filer (Brazil: the Brazilian registrant, never the foreign company in its own
    // name), a party established elsewhere prepares the bundle and the provider-country party records it.
    const filer = cfg.stateMachine.applicantFiledBy;
    if (filer && effectiveActor === "applicant" && "seat" in actor && actor.organisation.country !== cfg.code) {
      const local = c.participants.map((p) => this.store.organisations.get(p.organisationId)).find((o) => o?.country === cfg.code);
      this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: `the applicant's acts are recorded by a party established in ${cfg.code}`, citation: filer.reg.citation });
      throw this.denied(`In ${cfg.name} the applicant's filings are made by a registrant established there: ${filer.reg.value} (${filer.reg.citation}). ${local ? `Your organisation prepares the bundle; an authorised signatory of ${local.name} records "${event.replace(/_/g, " ")}".` : `No party to this case is established in ${cfg.name}, so nobody on it can make the filing. The foreign party needs a ${cfg.name} institution to associate with first.`} This attempt has been recorded.`);
    }
    // A filing before the regulator rests on a scope answer. While scope is undetermined (the parties
    // have not answered purpose or activity), escalated (the law is unresolved) or out of scope, the
    // platform will not record the applicant filing as if the basis were settled. The authority's own
    // acts are still recorded: they are facts about the world, not the parties' claims.
    if (effectiveActor === "applicant" && event !== "withdraw") {
      // A prohibition that applies on the facts is established law: an application filed over it is one
      // the law says must not be made in that form (Kenya reg. 11(4)(e)). The parties may still withdraw.
      const stops = this.pathwayFor(c).stages.flatMap((s) => s.stops);
      if (stops.length) {
        this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: "a prohibition applies on these facts", stops: stops.map((x) => x.requirementId) });
        throw this.denied(`Recording "${event.replace(/_/g, " ")}" is refused: a prohibition applies on these facts. ${stops.map((x) => `${x.text} (${x.reg.citation ?? "see the stage"})`).join(" ")} Change the project so it no longer applies, or withdraw.`);
      }
      const scope = evaluateScope(cfg, c.facts);
      if (scope.kind !== "in_scope") {
        this.audit(actor, "regulator.event_denied", { type: "case", id: caseId }, { event, reason: `scope is ${scope.kind.replace("_", " ")}` });
        throw this.denied(
          scope.kind === "undetermined"
            ? `Recording "${event.replace(/_/g, " ")}" needs a scope answer first. Answer the intake questions (${scope.missing.join(", ")}) so the platform can say whether and how this regime applies.`
            : scope.kind === "escalate"
              ? `Recording "${event.replace(/_/g, " ")}" is held: scope on these facts is an open legal question routed to ${scope.owner}. The platform will not record a filing on a guessed scope.`
              : `This case is out of scope on the facts entered, so there is no filing under this regime to record.`,
        );
      }
    }
    const wasGranted = isGranted(cfg, c.machine);
    c.machine = fire(cfg, c.machine, event, effectiveActor, this.now(), note, c.facts);
    this.store.cases.put(c);
    // Filing over halted stages is the parties' decision, and the platform records that it was taken
    // with those questions open, so the record shows what was known to be unresolved at the time.
    const openAtFiling = effectiveActor === "applicant" ? this.pathwayFor(c).stages.filter((s) => s.status === "halted" || s.status === "stopped").map((s) => s.stage.id) : [];
    this.audit(actor, "regulator.event_recorded", { type: "case", id: caseId }, { event, to: c.machine.state, recordedOnBehalfOf: effectiveActor, note, ...(openAtFiling.length ? { stagesOpenAtFiling: openAtFiling } : {}) });
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

  /**
   * Check the case's clocks at `now`. The demo's time control passes a later moment and marks the
   * check as simulated, so the audit chain never presents a demonstration of R8 as a lapse that
   * happened on the calendar.
   */
  tickClocks(caseId: string, now = this.now(), simulated = false): { lapsed: string[] } {
    const c = this.caseFor(caseId);
    const cfg = this.country(c.providerCountry);
    const { snap, lapsed } = tick(cfg, c.machine, now);
    c.machine = snap;
    for (const id of lapsed) {
      // A first lapse moves the case; a second clock that no longer runs in the new state is left alone.
      const clock = cfg.stateMachine.clocks.find((k) => k.id === id)!;
      if (!runsIn(clock).includes(c.machine.state)) continue;
      c.machine = applyLapse(cfg, c.machine, id, now);
      this.audit({ system: true }, "clock.lapsed", { type: "case", id: caseId }, { clockId: id, to: c.machine.state, effect: "remedy_against_administrator", granted: false, ...(simulated ? { demoTimeControl: true, simulatedCheckAt: now.toISOString() } : {}) });
    }
    this.store.cases.put(c);
    return { lapsed };
  }

  /**
   * The authority extends a running statutory clock under the power the country file declares. An
   * authority act, so an administrator records it on the authority's behalf, with a reason. Without
   * this, a lawful extension (Colombia D391 Art. 29) would present as a lapse.
   */
  extendClock(admin: Actor, caseId: string, clockId: string, days: number, note: string): Case {
    if (!("admin" in admin)) throw new PermissionDenied("An extension is the authority's act. An administrator records it on the authority's behalf; a party seat cannot.");
    if (!note.trim()) throw new InvalidRequest("Say what the authority's extension rests on (the notice or resolution). It goes into the audit chain.");
    const c = this.caseFor(caseId);
    const cfg = this.country(c.providerCountry);
    c.machine = extendClock(cfg, c.machine, clockId, days, this.now(), note.trim());
    this.store.cases.put(c);
    const st = c.machine.clocks[clockId];
    this.audit(admin, "clock.extended", { type: "case", id: caseId }, { clockId, days, extendedDays: st.extendedDays, deadline: st.deadline, note: note.trim(), recordedOnBehalfOf: "authority" });
    return c;
  }

  /** Demo control: evaluate the running clock one day past its own deadline. Returns null when no clock runs in the current state. */
  forceLapse(caseId: string): { lapsed: string[]; at: Date } | null {
    const c = this.caseFor(caseId);
    const cfg = this.country(c.providerCountry);
    const running = cfg.stateMachine.clocks.find((k) => runsIn(k).includes(c.machine.state) && c.machine.clocks[k.id]?.deadline && !c.machine.clocks[k.id].suspended && !c.machine.clocks[k.id].lapsed);
    if (!running) return null;
    const at = new Date(new Date(c.machine.clocks[running.id].deadline!).getTime() + 86_400_000);
    return { ...this.tickClocks(caseId, at, true), at };
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
    if (!outputId) throw new InvalidRequest(`Choose which instrument to record: ${cfg.outputs.map((o) => o.label).join(" or ")}.`);
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
    inst.versions[0].sha256 = sha256(normaliseText(content));
    inst.versions[0].summary = `${inst.label} recorded from ${fileName}`;
    this.store.instruments.put(inst);
    this.audit(actor, "instrument.recorded", { type: "instrument", id: inst.id }, { outputId, fileName, sha256: inst.versions[0].sha256, origin: "recorded_external", wasAwaiting: Boolean(existing) });
    return inst;
  }

  amendInstrument(actor: Actor, caseId: string, instrumentId: string, summary: string, documentText?: string) {
    const inst = this.must(this.store.instruments.get(instrumentId), "Instrument", instrumentId);
    this.mustBelong(caseId, inst, "Instrument");
    const c = this.caseFor(inst.caseId);
    this.requireParticipant(actor, c);
    this.require(actor, "authorised_signatory");
    if (!summary.trim()) throw new InvalidRequest("Describe the modification. The summary goes into the version record.");
    const doc = documentText?.trim() ? documentText : undefined;
    if (doc && Buffer.byteLength(doc, "utf8") > MAX_DOCUMENT_BYTES) throw new InvalidRequest(`The document exceeds the prototype's ${MAX_DOCUMENT_BYTES / 1024} KB paste limit.`);
    const cfg = this.country(c.providerCountry);
    const st = cfg.stateMachine.states[c.machine.state];
    if (st?.kind === "terminal" && st.outcome !== "granted") throw new PermissionDenied(`The case has reached "${st.label}". No amendment can be recorded against an instrument of a case that has ended.`);
    const out = amendInstrument(inst, summary.trim(), this.now(), "seat" in actor ? actor.seat.id : "system", doc ? normaliseText(doc) : undefined);
    if (out.kind === "versioned") {
      // Recording the signed amendment answers the change of intent that required it.
      const answered = out.instrument.pendingAmendment?.changeOfIntentId;
      this.store.instruments.put({ ...out.instrument, pendingAmendment: undefined });
      this.audit(actor, "instrument.versioned", { type: "instrument", id: instrumentId }, { version: out.version.version, kind: out.version.kind, summary, sha256: out.version.sha256, hashes: out.version.hashes, ...(answered ? { answersChangeOfIntent: answered } : {}) });
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
    // Once a party has signed, the text is fixed: a new version would leave that signature on a text
    // that is no longer current, and the other party could then sign something different.
    if (a.executions.length) {
      const signed = a.executions.map((e) => this.store.organisations.get(e.organisationId)?.name ?? e.organisationId).join(" and ");
      throw new PermissionDenied(`${signed} has already signed v${a.executions[0].versionNumber}. A new version would leave that signature on a text that is no longer current. Complete execution of this version, or start a new agreement for the changed terms.`);
    }
    if (!summary.trim()) throw new InvalidRequest("Say what changed in this version");
    const version = this.makeVersion(a.versions.length + 1, actor.seat.id, summary.trim(), clauses, origin);
    a.versions.push(version);
    a.status = "drafting";
    a.approvals = []; // approvals attach to a version
    this.store.agreements.put(a);
    this.audit(actor, "agreement.revised", { type: "agreement", id: a.id }, { version: version.version, sha256: version.sha256, origin });
    return a;
  }

  approveAgreement(actor: Actor, caseId: string, agreementId: string, seenVersion?: number): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can approve");
    const { a, c } = this.agreementFor(actor, caseId, agreementId);
    this.require(actor, "authorised_signatory");
    if (a.status === "executed" || a.status === "recorded") throw new PermissionDenied("This agreement is already executed");
    const latest = a.versions[a.versions.length - 1];
    // An approval is of the text the signatory read. A version recorded since the page was opened is not it.
    if (seenVersion !== undefined && seenVersion !== latest.version) {
      throw new InvalidRequest(`You were approving v${seenVersion}, but v${latest.version} has been recorded since (${latest.summary}). Nothing was approved. Reload and read v${latest.version} before approving it.`);
    }
    if (a.approvals.some((ap) => ap.organisationId === actor.seat.organisationId && ap.versionNumber === latest.version)) return a;
    a.approvals.push({ seatId: actor.seat.id, organisationId: actor.seat.organisationId, at: this.now().toISOString(), versionNumber: latest.version });
    const parties = c.participants.filter((p) => p.role === "demand" || p.role === "supply").map((p) => p.organisationId);
    a.status = parties.every((p) => a.approvals.some((ap) => ap.organisationId === p && ap.versionNumber === latest.version)) ? "approved" : "under_approval";
    this.store.agreements.put(a);
    this.audit(actor, "agreement.approved", { type: "agreement", id: a.id }, { version: latest.version, organisationId: actor.seat.organisationId, status: a.status });
    return a;
  }

  /** Simple electronic signature: an authenticated authorised signatory records assent to a specific document hash. */
  executeAgreement(actor: Actor, caseId: string, agreementId: string, seenSha256?: string): Agreement {
    if (!("seat" in actor)) throw new PermissionDenied("Only a seat can execute");
    const { a, c } = this.agreementFor(actor, caseId, agreementId);
    this.require(actor, "authorised_signatory");
    const latest = a.versions[a.versions.length - 1];
    // A signature is assent to one hash: the one on the signatory's screen.
    if (seenSha256 !== undefined && seenSha256 !== latest.sha256) {
      throw new InvalidRequest(`The text you were signing is no longer the current version: v${latest.version} has been recorded since (${latest.summary}). Nothing was signed. Reload and read it first.`);
    }
    if (a.status !== "approved" && a.status !== "executed") throw new PermissionDenied("Both organisations must approve the current version before execution");
    if (!a.approvals.some((ap) => ap.organisationId === actor.seat.organisationId && ap.versionNumber === latest.version)) {
      throw new PermissionDenied(`Your organisation has not approved v${latest.version}. Execution follows approval of the same version by both organisations.`);
    }
    if (a.executions.some((e) => e.organisationId === actor.seat.organisationId && e.versionNumber === latest.version)) return a;
    a.executions.push({ seatId: actor.seat.id, organisationId: actor.seat.organisationId, at: this.now().toISOString(), versionNumber: latest.version, sha256: latest.sha256, method: "platform_click_to_sign", stepUpAuth: "demo" });
    const parties = c.participants.filter((p) => p.role === "demand" || p.role === "supply").map((p) => p.organisationId);
    // Executed only when every party has signed the same text.
    a.status = parties.every((p) => a.executions.some((e) => e.organisationId === p && e.versionNumber === latest.version && e.sha256 === latest.sha256)) ? "executed" : "approved";
    this.store.agreements.put(a);
    this.audit(actor, "agreement.executed", { type: "agreement", id: a.id }, { version: latest.version, sha256: latest.sha256, signatorySeat: actor.seat.id, organisationId: actor.seat.organisationId, method: "platform_click_to_sign", status: a.status });
    return a;
  }

  agreementsFor(caseId: string) {
    return this.store.agreements.list().filter((a) => a.caseId === caseId);
  }

  private makeVersion(version: number, authorSeatId: string, summary: string, clauses: AgreementVersion["clauses"], origin: AgreementVersion["origin"]): AgreementVersion {
    // Negotiated text arrives through a form, so it is normalised like every other pasted document.
    const clean = clauses.map((c) => ({ ...c, title: normaliseText(c.title), text: normaliseText(c.text) }));
    return { version, at: this.now().toISOString(), authorSeatId, summary, clauses: clean, sha256: sha256(canonicalAgreementText(version, clean)), origin };
  }

  /** Verification page: does this content match any recorded hash? */
  verifyContent(content: string): { sha256: string; matches: { type: string; id: string; where: string }[] } {
    return this.verifyHash(sha256(normaliseText(content)));
  }

  /** Look a SHA-256 up in the record. The verification page passes only the hash around, never the document. */
  verifyHash(h: string): { sha256: string; matches: { type: string; id: string; where: string }[] } {
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
    if (!note.trim()) throw new InvalidRequest("Say what you need help with. The note is what the person answering reads.");
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
