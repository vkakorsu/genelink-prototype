import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { ConfigError, loadCountries, parseCountry } from "../config/load";
import { lintCountry } from "../config/lint";
import { InMemoryStore } from "../store/memory";
import { seed, ADMIN } from "../seed/seed";
import { InvalidRequest, MAX_DOCUMENT_BYTES, NotFound, PermissionDenied, Platform } from "../platform";
import { verifyChain } from "../audit/chain";
import { redactIdentifiers } from "../../lib/redact";
import type { CaseFacts, CountryConfig } from "../config/schema";
import { evaluateScope } from "../engine/scope";
import { buildPathway } from "../engine/pathway";
import { withDeclaredDefaults } from "../engine/facts";
import { fire, initialSnapshot, isWorkingDay, localDate, tick } from "../engine/stateMachine";

/**
 * Defects found by multi-session, two-sided testing of the live prototype, each pinned here so
 * it cannot come back. Every test drives the platform the way a second user at the other end
 * would, through the same public methods the server actions call.
 */

const countries = loadCountries(join(process.cwd(), "config", "countries"));
const fresh = () => seed(new InMemoryStore(), countries);

const keFacts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  purpose: "commercial", activity: "collection_research", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement",
  communityHeld: "no", tkInvolved: "no", speciesListed: "not_listed", localities: 1, flags: {}, ...over,
});

function grantedKenyaCase(p: Platform) {
  const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
  const tobias = p.actorFor("seat_tobias_nordlicht");
  // A fresh pairing so the seeded Nordlicht case is untouched: Nordlicht signals on the Kenya offer via Tobias, LBNPI reciprocates.
  const c0 = p.store.cases.list().find((c) => c.listingId === "lst_ke_antiinfl" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
  p.updateFacts(wanjiru, c0.id, keFacts());
  p.fireEvent(wanjiru, c0.id, "submit");
  p.fireEvent(ADMIN, c0.id, "acknowledge");
  p.fireEvent(ADMIN, c0.id, "grant");
  void tobias;
  return p.store.cases.get(c0.id)!;
}

describe("R3: a stage never disappears because a deciding fact was left blank", () => {
  it("a case opened from a match carries Colombia's direct-affectation fact as unclear, so consulta previa is on the pathway and halted", () => {
    const p = fresh();
    const camila = p.actorFor("seat_camila_ibp");
    const amara = p.actorFor("seat_amara_meridian");
    p.signalInterest(amara, "lst_co_emulsifier");
    const { caseId } = p.reciprocate(camila, "lst_co_emulsifier", "org_meridian");
    const c = p.store.cases.get(caseId)!;
    expect(c.facts.directAffectation).toBe("unclear");
    const pathway = p.pathwayFor(c);
    const consultation = pathway.stages.find((s) => s.stage.id === "prior_consultation")!;
    expect(consultation).toBeTruthy();
    expect(consultation.status).toBe("halted");
    // The halt is the consultation-document unknown from the file, routed to the escalation owner. The
    // parties' own unanswered fact is not a legal unknown and is never written to the escalation store.
    expect(p.escalationsFor(caseId).some((e) => e.id.includes(":fact:"))).toBe(false);
    expect(p.escalationsFor(caseId).some((e) => e.id.endsWith("prior_consultation:consultation_document"))).toBe(true);
  });

  it("a facts edit that omits a declared fact lands on the declared default, never on nothing", () => {
    const p = fresh();
    const camila = p.actorFor("seat_camila_ibp");
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.facts.purpose === "commercial")!;
    const { directAffectation: _omitted, ...withoutIt } = co.facts;
    void _omitted;
    p.updateFacts(camila, co.id, withoutIt as CaseFacts);
    expect(p.store.cases.get(co.id)!.facts.directAffectation).toBe("unclear");
    expect(p.pathwayFor(p.store.cases.get(co.id)!).stages.map((s) => s.stage.id)).toContain("prior_consultation");
  });
});

describe("CGen verification is not a party's self-declaration", () => {
  it("a case party cannot record CGen's outcome; the reviewer seat can", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const inst = p.instrumentsFor(br.id)[0];
    expect(inst).toBeDefined();
    const luana = p.actorFor("seat_luana_iam");
    expect(() => p.setInstrumentStatus(luana, br.id, inst.id, "verified", "we say so")).toThrow(PermissionDenied);
    expect(p.store.instruments.get(inst.id)!.status).not.toBe("verified");
    p.setInstrumentStatus(ADMIN, br.id, inst.id, "verified", "CGen outcome recorded on the authority's behalf");
    expect(p.store.instruments.get(inst.id)!.status).toBe("verified");
  });
});

describe("R5: a manual-review judgment is never a party's self-declaration", () => {
  it("a case party with a signatory seat cannot record it; the reviewer seat can, once", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [review] = p.manualReviewsFor(br.id);
    const luana = p.actorFor("seat_luana_iam"); // authorised signatory AND a party to the case
    expect(() => p.decideManualReview(luana, review.id, "yes", "we say so")).toThrow(PermissionDenied);
    p.decideManualReview(ADMIN, review.id, "Genuine collaboration exists", "Joint protocol reviewed");
    expect(() => p.decideManualReview(ADMIN, review.id, "no", "changed my mind")).toThrow(/immutable/);
    expect(() => p.decideManualReview(luana, review.id, "no", "overwrite attempt")).toThrow(PermissionDenied);
    const rec = p.store.manualReviews.get(review.id)!;
    expect(rec.decision?.outcome).toBe("Genuine collaboration exists");
    expect(rec.decision?.by).toBe(ADMIN.admin.name);
  });

  it("an empty outcome or reason is refused", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [review] = p.manualReviewsFor(br.id);
    expect(() => p.decideManualReview(ADMIN, review.id, "   ", "reason")).toThrow(InvalidRequest);
  });
});

describe("Kenya: two instruments from two issuers is a real gate, not an auto-issue", () => {
  it("grant produces two awaiting-record instruments with no hash, and the applicant holds nothing until both are recorded", () => {
    const p = fresh();
    const c = grantedKenyaCase(p);
    const instruments = p.instrumentsFor(c.id);
    expect(instruments.map((i) => i.outputId).sort()).toEqual(["nacosti_research_licence", "nema_access_permit"]);
    expect(instruments.every((i) => i.status === "awaiting_record" && i.versions.length === 0)).toBe(true);
    expect(p.holdings(c)).toMatchObject({ required: 2, recorded: 0 });
    expect(p.holdings(c).missing).toHaveLength(2);

    const otieno = p.actorFor("seat_otieno_lbnpi");
    p.recordExternalInstrument(otieno, c.id, "nema_access_permit", "NEMA-2027-001.pdf", "NEMA permit text (fictional)");
    const h1 = p.holdings(c);
    expect(h1.recorded).toBe(1);
    expect(h1.missing.map((m) => m.outputId)).toEqual(["nacosti_research_licence"]);
    // Recording NEMA did not conjure NACOSTI.
    expect(p.store.instruments.get(`inst_${c.id}_nacosti_research_licence`)!.versions).toHaveLength(0);

    p.recordExternalInstrument(otieno, c.id, "nacosti_research_licence", "NACOSTI-2027-77.pdf", "NACOSTI licence text (fictional)");
    expect(p.holdings(c)).toMatchObject({ required: 2, recorded: 2, missing: [] });
    // The audit says the platform waited rather than fabricated.
    expect(p.store.audit.list().filter((e) => e.action === "instrument.awaiting_record" && e.subject.id.startsWith(`inst_${c.id}_`))).toHaveLength(2);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("an instrument cannot be recorded twice as an original, and an awaiting instrument cannot be amended", () => {
    const p = fresh();
    const c = grantedKenyaCase(p);
    const otieno = p.actorFor("seat_otieno_lbnpi");
    expect(() => p.amendInstrument(otieno, c.id, `inst_${c.id}_nema_access_permit`, "change")).toThrow(/not been recorded yet/);
    p.recordExternalInstrument(otieno, c.id, "nema_access_permit", "a.pdf", "text");
    expect(() => p.recordExternalInstrument(otieno, c.id, "nema_access_permit", "b.pdf", "text 2")).toThrow(InvalidRequest);
    expect(() => p.recordExternalInstrument(otieno, c.id, "nema_permit", "b.pdf", "text")).toThrow(/Unknown output nema_permit/);
  });

  it("Brazil's automatic receipt is still recorded on the act itself", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [receipt] = p.instrumentsFor(br.id);
    expect(receipt.status).toBe("verification_open");
    expect(receipt.versions).toHaveLength(1);
  });
});

describe("Colombia: an addendum cannot be recorded after the contract's case has ended", () => {
  it("terminate freezes the contract, and the freeze is recorded on the instrument", () => {
    const p = fresh();
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const camila = p.actorFor("seat_camila_ibp");
    const [contract] = p.instrumentsFor(co.id);
    const before = contract.versions.length;
    p.amendInstrument(camila, co.id, contract.id, "Otrosí before termination");
    expect(p.store.instruments.get(contract.id)!.versions).toHaveLength(before + 1);
    p.fireEvent(ADMIN, co.id, "terminate", "Indispensable accessory contract failed (fictional)");
    expect(p.store.cases.get(co.id)!.machine.state).toBe("terminated");
    expect(p.store.instruments.get(contract.id)!.status).toBe("cancelled");
    expect(() => p.amendInstrument(camila, co.id, contract.id, "Post-terminate addendum")).toThrow(PermissionDenied);
    expect(p.store.instruments.get(contract.id)!.versions).toHaveLength(before + 1);
  });
});

describe("need listings: a match runs under the supplying organisation's country", () => {
  it("community custodian (KE) meets an EU need and a Kenya case opens with the roles the right way round", () => {
    const p = fresh();
    const nyokabi = p.actorFor("seat_nyokabi_olkalou");
    const ines = p.actorFor("seat_ines_nordlicht");
    const r = p.signalInterest(nyokabi, "lst_need_preservative");
    expect(r.mutual).toBe(false);
    // The gate holds while Ol Kalou is pending; the administrator's verify decision clears it.
    p.decideVerification(ADMIN, "org_olkalou", "verified", "Vouching by LBNPI accepted for the test.");
    const { caseId } = p.reciprocate(ines, "lst_need_preservative", "org_olkalou");
    const c = p.store.cases.get(caseId)!;
    expect(c.providerCountry).toBe("KE");
    expect(c.participants).toEqual(expect.arrayContaining([
      { organisationId: "org_nordlicht", role: "demand" },
      { organisationId: "org_olkalou", role: "supply" },
    ]));
    expect(p.pathwayFor(c).stages.length).toBeGreaterThan(2);
  });

  it("a supplier whose country has no configuration is told so before anyone signals, not after", () => {
    const p = fresh();
    const kwame = p.actorFor("seat_kwame_asheokoro"); // Ghana, not configured
    expect(() => p.signalInterest(kwame, "lst_need_preservative")).toThrow(/no configured pathway for GH/);
    expect(p.interestsOn("lst_need_preservative").some((i) => i.fromOrganisationId === "org_asheokoro")).toBe(false);
  });

  it("signalling back to an organisation that never signalled is refused", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    expect(() => p.reciprocate(ines, "lst_need_preservative", "org_asheokoro")).toThrow(InvalidRequest);
  });
});

describe("declined organisations do not match", () => {
  it("a declined organisation cannot signal, and cannot be signalled back to", () => {
    const p = fresh();
    const nyokabi = p.actorFor("seat_nyokabi_olkalou");
    const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
    // Signal while pending is allowed (Path B onboarding continues in parallel).
    p.signalInterest(nyokabi, "lst_co_emulsifier");
    p.decideVerification(ADMIN, "org_olkalou", "declined", "Biocultural protocol could not be confirmed (fictional)");
    const camila = p.actorFor("seat_camila_ibp");
    expect(() => p.reciprocate(camila, "lst_co_emulsifier", "org_olkalou")).toThrow(/declined verification/);
    const nyokabi2 = p.actorFor("seat_nyokabi_olkalou");
    expect(() => p.signalInterest(nyokabi2, "lst_ke_antiinfl")).toThrow(/declined/);
    void wanjiru;
  });
});

describe("confused deputy: an agreement or instrument acts only on its own case", () => {
  it("approving an agreement through a different case id is refused even for a participant of both", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const [keAgreement] = p.agreementsFor(ke.id);
    expect(() => p.approveAgreement(ines, co.id, keAgreement.id)).toThrow(/does not belong to this case/);
    expect(() => p.executeAgreement(ines, co.id, keAgreement.id)).toThrow(/does not belong to this case/);
    expect(() => p.reviseAgreement(ines, co.id, keAgreement.id, "x", keAgreement.versions[0].clauses)).toThrow(/does not belong to this case/);
    const [coContract] = p.instrumentsFor(co.id);
    const camila = p.actorFor("seat_camila_ibp");
    expect(() => p.amendInstrument(camila, ke.id, coContract.id, "x")).toThrow(/does not belong to this case/);
  });

  it("a stale id after a reset is a sentence, not a crash", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    expect(() => p.approveAgreement(ines, ke.id, "agr_does_not_exist")).toThrow(NotFound);
    expect(() => p.updateFacts(ines, "case_null", keFacts())).toThrow(NotFound);
    expect(() => p.fireEvent(ines, "case_null", "submit")).toThrow(NotFound);
  });

  it("a signatory-level seat in either party can approve; a member cannot; both approvals then execution", () => {
    const p = fresh();
    const c = grantedKenyaCase(p);
    const otieno = p.actorFor("seat_otieno_lbnpi");
    const ines = p.actorFor("seat_ines_nordlicht");
    const tobias = p.actorFor("seat_tobias_nordlicht");
    const a = p.createAgreement(otieno, c.id, "MAT", [{ id: "c1", title: "t", text: "x", source: "illustrative" }]);
    expect(() => p.approveAgreement(tobias, c.id, a.id)).toThrow(PermissionDenied);
    p.approveAgreement(otieno, c.id, a.id);
    expect(() => p.executeAgreement(ines, c.id, a.id)).toThrow(/Both organisations must approve/);
    p.approveAgreement(ines, c.id, a.id);
    p.executeAgreement(ines, c.id, a.id);
    p.executeAgreement(otieno, c.id, a.id);
    const done = p.store.agreements.get(a.id)!;
    expect(done.status).toBe("executed");
    expect(new Set(done.executions.map((e) => e.sha256)).size).toBe(1);
  });
});

describe("the regulator's acts belong to the authority, recorded by an administrator", () => {
  it("a party seat can fire applicant events but not authority or system events; the denied attempt is audited", () => {
    const p = fresh();
    const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
    const c0 = p.store.cases.list().find((c) => c.listingId === "lst_ke_antiinfl" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    p.updateFacts(wanjiru, c0.id, keFacts());
    p.fireEvent(wanjiru, c0.id, "submit"); // the applicant's own act
    const underReview = p.store.cases.get(c0.id)!.machine.state;
    expect(() => p.fireEvent(wanjiru, c0.id, "acknowledge")).toThrow(PermissionDenied);
    expect(p.store.cases.get(c0.id)!.machine.state).toBe(underReview);
    const denied = p.store.audit.list().filter((e) => e.action === "regulator.event_denied" && e.subject.id === c0.id);
    expect(denied).toHaveLength(1);
    expect(denied[0].detail).toMatchObject({ event: "acknowledge" });
    p.fireEvent(ADMIN, c0.id, "acknowledge", "Recorded on NEMA's behalf");
    expect(p.store.cases.get(c0.id)!.machine.state).not.toBe(underReview);
    // A system transition is not the party's either: lapse is the clock's act, not a button.
    expect(() => p.fireEvent(wanjiru, c0.id, "lapse")).toThrow(PermissionDenied);
    expect(p.store.audit.list().filter((e) => e.action === "regulator.event_denied" && e.subject.id === c0.id)).toHaveLength(2);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("a party's attempt to record a manual-review judgment is audited as denied", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [review] = p.manualReviewsFor(br.id);
    const luana = p.actorFor("seat_luana_iam");
    expect(() => p.decideManualReview(luana, review.id, "yes", "we say so")).toThrow(PermissionDenied);
    const denied = p.store.audit.list().filter((e) => e.action === "manual_review.decision_denied" && e.subject.id === review.id);
    expect(denied).toHaveLength(1);
    expect(p.store.manualReviews.get(review.id)!.status).toBe("pending_human_judgment");
  });
});

describe("a denied attempt is written to the audit chain", () => {
  it("recordDenied attributes the seat, keeps the chain valid, and marks a call with no session", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE")!;
    p.recordDenied(ines, "tickClocks", { type: "case", id: ke.id }, "Administrator sign-in required");
    p.recordDenied(null, "decideVerification", { type: "request", id: "/admin" }, "Administrator sign-in required");
    const entries = p.store.audit.list().filter((e) => e.action === "access.denied");
    expect(entries).toHaveLength(2);
    expect(entries[0].actor).toMatchObject({ seatId: "seat_ines_nordlicht", organisationId: "org_nordlicht" });
    expect(entries[0].detail).toMatchObject({ operation: "tickClocks", reason: "Administrator sign-in required" });
    expect(entries[1].actor.role).toBe("system");
    expect(entries[1].detail).toMatchObject({ session: "none" });
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("domain denials arrive already audited so the boundary does not double-log; rank failures arrive unmarked so it does", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [review] = p.manualReviewsFor(br.id);
    const luana = p.actorFor("seat_luana_iam");
    try {
      p.decideManualReview(luana, review.id, "yes", "we say so");
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDenied);
      expect((e as { audited?: boolean }).audited).toBe(true);
    }
    const c = grantedKenyaCase(p);
    const tobias = p.actorFor("seat_tobias_nordlicht");
    const a = p.createAgreement(p.actorFor("seat_otieno_lbnpi"), c.id, "MAT", [{ id: "c1", title: "t", text: "x", source: "illustrative" }]);
    try {
      p.approveAgreement(tobias, c.id, a.id);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDenied);
      expect((e as { audited?: boolean }).audited).toBeUndefined();
    }
  });
});

describe("Path B: a stranger registers and lands in the verification queue", () => {
  it("creates person, organisation and founding seat; pending until an administrator decides; onboarded acts run in parallel", () => {
    const p = fresh();
    const r = p.registerOrganisation({ personName: "New Custodian", orgName: "Test Seed Bank", kind: "community_custodian", country: "KE", method: "vouching", functions: ["custodian", "providing"] });
    const org = p.store.organisations.get(r.organisationId)!;
    expect(org.verification).toMatchObject({ status: "pending", method: "vouching" });
    expect(p.store.memberships.get(r.seatId)!.permission).toBe("administrator");
    expect(p.store.persons.get(r.personId)!.onboardingPath).toBe("B");
    // A pending Path B organisation may already act: onboarding runs in parallel, it does not gate the spine.
    expect(() => p.signalInterest(p.actorFor(r.seatId), "lst_ke_antiinfl")).not.toThrow();
    p.decideVerification(ADMIN, r.organisationId, "verified", "Vouched by a known institution (fictional)");
    expect(p.store.organisations.get(r.organisationId)!.verification.status).toBe("verified");
    const actions = p.store.audit.list().map((e) => e.action);
    expect(actions).toContain("organisation.registered");
    expect(actions).toContain("organisation.verification_requested");
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });
});

describe("R8: a lapsed clock never produces an instrument", () => {
  it("recording a permit on the lapsed Kenya case is refused", () => {
    const p = fresh();
    const lapsed = p.store.cases.list().find((c) => c.id === "case_3_ke")!;
    expect(p.country("KE").stateMachine.states[lapsed.machine.state]?.outcome).not.toBe("granted");
    const amara = p.actorFor("seat_amara_meridian");
    expect(() => p.recordExternalInstrument(amara, lapsed.id, "nema_access_permit", "NEMA-permit-lapsed-forgery.pdf", "forged permit text")).toThrow(/No NEMA access permit exists to record|lapsed|not a grant/i);
    expect(p.instrumentsFor(lapsed.id).filter((i) => i.versions.length > 0)).toHaveLength(0);
  });
});

describe("a halted stage gates later completion", () => {
  it("a later stage cannot be marked complete while an earlier stage on the pathway is halted", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const ines = p.actorFor("seat_ines_nordlicht");
    const pathway = p.pathwayFor(ke);
    const haltedIdx = pathway.stages.findIndex((s) => s.status === "halted");
    const later = pathway.stages.find((s, i) => i > haltedIdx && s.status !== "halted");
    expect(haltedIdx).toBeGreaterThan(-1);
    expect(later).toBeDefined();
    expect(() => p.markStage(ines, ke.id, later!.stage.id, "complete")).toThrow(/earlier stage is halted/);
    // Preparation is still allowed: in_progress is not a claim that dependent work finished.
    expect(() => p.markStage(ines, ke.id, later!.stage.id, "in_progress")).not.toThrow();
    // The halted stage itself remains refused.
    expect(() => p.markStage(ines, ke.id, pathway.stages[haltedIdx].stage.id, "complete")).toThrow(/halted/);
  });
});

describe("stage completion is a commitment, not preparation", () => {
  it("a member records work in progress; only a signatory or administrator marks a stage complete", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const tobias = p.actorFor("seat_tobias_nordlicht"); // member
    const ines = p.actorFor("seat_ines_nordlicht"); // authorised_signatory
    const first = p.pathwayFor(ke).stages[0];
    expect(() => p.markStage(tobias, ke.id, first.stage.id, "complete")).toThrow(PermissionDenied);
    expect(() => p.markStage(tobias, ke.id, first.stage.id, "in_progress")).not.toThrow();
    expect(() => p.markStage(ines, ke.id, first.stage.id, "complete")).not.toThrow();
  });
});

describe("a facts edit cannot quietly change the scope answer", () => {
  it("flipping a case across the scope boundary must go through a declared change of intent", () => {
    const p = fresh();
    // Once something is filed, in scope -> out of scope is refused as a plain facts edit.
    const filed = p.store.cases.get("case_3_ke")!;
    const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
    expect(() => p.updateFacts(wanjiru, filed.id, { ...filed.facts, purpose: "non_commercial" })).toThrow(/change of intent|scope answer/);
    // Before anything is filed, correcting the intake across scope is a correction, recorded as one:
    // a change of intent would put the country's consequence on the record for an application that does not exist.
    const ke = p.store.cases.get("case_1_ke")!;
    const ines = p.actorFor("seat_ines_nordlicht");
    expect(() => p.updateFacts(ines, ke.id, { ...ke.facts, purpose: "non_commercial" })).not.toThrow();
    expect(p.store.audit.list().at(-1)!.action).not.toBe("case.change_of_intent");
    expect(p.store.audit.list().some((e) => e.action === "case.facts_corrected_before_filing" && e.subject.id === ke.id)).toBe(true);
    const ooc = p.store.cases.list().find((c) => c.id === "case_5_co")!;
    const kwame = p.actorFor("seat_kwame_asheokoro");
    const flipped: CaseFacts = { ...ooc.facts, purpose: "commercial" };
    // An edit that keeps the scope answer still works.
    expect(() => p.updateFacts(kwame, ooc.id, { ...ooc.facts, localities: 3 })).not.toThrow();
    // The declared route exists and carries the consequence policy onto the record.
    expect(() => p.changeOfIntent(kwame, ooc.id, flipped, "Purpose changed to commercial use")).not.toThrow();
    expect(p.store.cases.get(ooc.id)!.changeOfIntent.at(-1)!.description).toBe("Purpose changed to commercial use");
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });
});

describe("clocks: resume restarts the clock, and a lapse can be forced for the demo", () => {
  it("after administrator_resumes the determination clock runs afresh and lapses again past its new deadline", () => {
    const p = fresh();
    const lapsed = p.store.cases.list().find((c) => c.machine.state === "deadline_lapsed")!;
    const missed = lapsed.machine.clocks.determination.deadline;
    p.fireEvent(ADMIN, lapsed.id, "administrator_resumes", "Resumed after remedy");
    const c = p.store.cases.get(lapsed.id)!;
    expect(c.machine.state).toBe("under_review");
    const clock = c.machine.clocks.determination;
    expect(clock.lapsed).toBe(false);
    expect(new Date(clock.deadline!).getTime()).toBeGreaterThan(Date.now());
    // The restart is marked as a tracking aid, and the missed statutory deadline is kept.
    expect(clock.restartedAfterLapse?.missedDeadline).toBe(missed);
    // Checking now does not lapse it.
    expect(p.tickClocks(c.id).lapsed).toEqual([]);
    expect(p.store.cases.get(c.id)!.machine.state).toBe("under_review");
    // Forcing evaluates one day past the deadline.
    const r = p.forceLapse(c.id);
    expect(r?.lapsed).toEqual(["determination"]);
    expect(p.store.cases.get(c.id)!.machine.state).toBe("deadline_lapsed");
    expect(p.instrumentsFor(c.id)).toHaveLength(0);
  });

  it("forceLapse is null when no clock governs the current state", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    expect(p.forceLapse(br.id)).toBeNull();
  });
});

describe("documents and instruments: limits and duplicates are refused with a sentence", () => {
  it("oversized and duplicate uploads are InvalidRequest, never a crash", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const tobias = p.actorFor("seat_tobias_nordlicht");
    const big = "x".repeat(MAX_DOCUMENT_BYTES + 1);
    expect(() => p.uploadDocument(tobias, ke.id, "mta_application", "MTA", "big.txt", big)).toThrow(/limit/);
    expect(() => p.uploadDocument(tobias, ke.id, "mta_application", "MTA", "e.txt", "   ")).toThrow(InvalidRequest);
    p.uploadDocument(tobias, ke.id, "mta_application", "MTA", "one.txt", "same content");
    expect(() => p.uploadDocument(tobias, ke.id, "mta_application", "MTA", "two.txt", "same content")).toThrow(/identical document/);
    expect(() => p.uploadDocument(tobias, ke.id, "not_a_requirement", "X", "x.txt", "content")).toThrow(InvalidRequest);
  });
});

describe("administrator intervention is visible on the case, not only in the audit chain", () => {
  it("records on the case body", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE")!;
    p.adminIntervene(ADMIN, ke.id, "Contacted both parties", "Escalation owner unnamed for 30 days");
    expect(p.store.cases.get(ke.id)!.interventions).toHaveLength(1);
    expect(() => p.adminIntervene(ADMIN, ke.id, "", "no action")).toThrow(InvalidRequest);
  });
});

describe("free text is checked for identifying content", () => {
  it("removes emails, phone numbers, URLs and ORCID iDs and keeps the rest", () => {
    const r = redactIdentifiers("Lamiaceae extracts, contact i.halvorsen@nordlicht.example or +49-40-1234567, see https://nordlicht.example/x, ORCID 0000-0002-1825-0097");
    expect(r.text).not.toMatch(/halvorsen|\+49|https|0000-0002/);
    expect(r.text).toMatch(/Lamiaceae extracts/);
    expect(r.redactions).toBe(4);
    expect(r.kinds.sort()).toEqual(["email", "orcid", "phone", "url"]);
  });

  it("leaves ordinary text and short numbers alone", () => {
    const r = redactIdentifiers("a 2028 product line needing 3 natural preservatives at 40% concentration");
    expect(r.redactions).toBe(0);
    expect(r.text).toBe("a 2028 product line needing 3 natural preservatives at 40% concentration");
  });
});

describe("the case audit trail carries the case's confidentiality boundary", () => {
  it("participants and administrators read it; a foreign seat is refused and the refusal is audited", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const ines = p.actorFor("seat_ines_nordlicht");
    const camila = p.actorFor("seat_camila_ibp");
    expect(p.caseAudit(ines, ke.id).length).toBeGreaterThan(0);
    expect(p.caseAudit(ADMIN, ke.id).length).toBeGreaterThan(0);
    const before = p.store.audit.list().length;
    expect(() => p.caseAudit(camila, ke.id)).toThrow(PermissionDenied);
    const last = p.store.audit.list().at(-1)!;
    expect(p.store.audit.list().length).toBe(before + 1);
    expect(last.action).toBe("access.denied");
    expect((last.detail as { operation: string }).operation).toBe("case_audit.view");
    expect(last.subject.id).toBe(ke.id);
  });
});

describe("the verification gate holds between mutual interest and the pathway", () => {
  it("a pending-verification organisation can signal but a case never opens for it", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    // Seed: Ol Kalou (pending Path B) has already signalled Nordlicht's need listing.
    expect(() => p.reciprocate(ines, "lst_need_preservative", "org_olkalou")).toThrow(PermissionDenied);
    // The interest still sits recorded at the gate; no case was created for the pair.
    expect(p.interestsOn("lst_need_preservative").some((i) => i.fromOrganisationId === "org_olkalou")).toBe(true);
    expect(p.store.cases.list().every((c) => !c.participants.some((x) => x.organisationId === "org_olkalou"))).toBe(true);
  });
});

describe("discovery search runs on the public projection and nothing else", () => {
  it("a query matches a taxon the owner published; a withheld species or accession never matches", () => {
    const p = fresh();
    // The owner published the family. A family-level query finds the listing.
    const hits = p.searchPublicListings("lamiaceae", "", "");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.projection === "public")).toBe(true);
    expect(hits.some((h) => h.id === "lst_ke_antiinfl")).toBe(true);
    // The result carries only the public shape: no species, accession or locality value leaks.
    expect(JSON.stringify(hits)).not.toMatch(/LBNPI-A-|LBNPI-E-|Nyando|Kisumu|Streptomyces/);
    // Withheld fields are not search keys. If they were, the result set itself would reveal them.
    expect(p.searchPublicListings("streptomyces", "", "")).toHaveLength(0);
    expect(p.searchPublicListings("LBNPI-A-003", "", "")).toHaveLength(0);
    expect(p.searchPublicListings("araceae", "", "")).toEqual(expect.arrayContaining([expect.objectContaining({ id: "lst_co_emulsifier" })]));
    // The dry-run owner withheld the taxon entirely: it is not findable by genus guesses.
    expect(p.searchPublicListings("IAM-0007", "", "")).toHaveLength(0);
    // Locality is not searchable: withheld means withheld, and search is no oracle into it.
    expect(p.searchPublicListings("nyando", "", "")).toHaveLength(0);
    expect(p.searchPublicListings("kisumu", "", "")).toHaveLength(0);
  });
});

describe("a filing before the regulator is a signatory act, not a member's", () => {
  it("a member can prepare the bundle but cannot submit, withdraw or appeal; the denial is audited", () => {
    const p = fresh();
    const tobias = p.actorFor("seat_tobias_nordlicht"); // member seat on the Nordlicht/LBNPI case
    const ines = p.actorFor("seat_ines_nordlicht"); // authorised signatory on the same case
    const c0 = p.store.cases.list().find((c) => c.listingId === "lst_ke_antiinfl" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    // Preparation is open to a member.
    expect(() => p.updateFacts(tobias, c0.id, keFacts())).not.toThrow();
    // Filing is not.
    expect(() => p.fireEvent(tobias, c0.id, "submit")).toThrow(PermissionDenied);
    expect(p.store.cases.get(c0.id)!.machine.state).toBe(p.country("KE").stateMachine.initial);
    const denied = p.store.audit.list().filter((e) => e.action === "regulator.event_denied" && e.subject.id === c0.id);
    expect(denied).toHaveLength(1);
    expect(denied[0].detail).toMatchObject({ event: "submit" });
    // A signatory files.
    expect(() => p.fireEvent(ines, c0.id, "submit")).not.toThrow();
    expect(p.store.cases.get(c0.id)!.machine.state).not.toBe(p.country("KE").stateMachine.initial);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("a change of intent re-runs scope and applies the country's consequence to a live contract: member denied, signatory allowed", () => {
    const p = fresh();
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    // Nordlicht's member seat tries to declare a change of intent on the Colombia case.
    const tobias = p.actorFor("seat_tobias_nordlicht");
    const facts: CaseFacts = { ...co.facts, exchange: "service_shipment" };
    expect(() => p.changeOfIntent(tobias, co.id, facts, "Samples abroad for sequencing")).toThrow(PermissionDenied);
    expect(p.store.cases.get(co.id)!.changeOfIntent).toHaveLength(co.changeOfIntent.length);
    // Camila (IBP signatory) records it.
    const camila = p.actorFor("seat_camila_ibp");
    expect(() => p.changeOfIntent(camila, co.id, facts, "Samples abroad for sequencing service, returned after")).not.toThrow();
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("a viewer cannot write a support request onto a case; a member can", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    // Give Nordlicht a real viewer seat for the test.
    p.store.persons.put({ id: "p_test_viewer", name: "Test Viewer", email: "viewer@nordlicht.example", country: "DE", onboardingPath: "A", badges: [] });
    const seat = p.inviteSeat(ADMIN, "org_nordlicht", p.store.persons.get("p_test_viewer")!, "viewer");
    const viewer = p.actorFor(seat.id);
    expect(() => p.requestSupport(viewer, ke.id, "technical", "can I write?")).toThrow(PermissionDenied);
    const tobias = p.actorFor("seat_tobias_nordlicht");
    expect(() => p.requestSupport(tobias, ke.id, "technical", "Checking rate status wording")).not.toThrow();
  });
});

describe("a manual-review judgment attaches to the stage its declaration names (R5)", () => {
  it("Brazil's collaboration judgment halts the registrant stage, declared in the file, not by an engine list", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const pathway = p.pathwayFor(br);
    const registrant = pathway.stages.find((s) => s.stage.id === "registrant")!;
    expect(registrant.status).toBe("halted");
    expect(registrant.manualReviews.map((m) => m.id)).toContain("genuine_scientific_collaboration");
    // And no other stage carries it.
    for (const s of pathway.stages) {
      if (s.stage.id !== "registrant") expect(s.manualReviews.map((m) => m.id)).not.toContain("genuine_scientific_collaboration");
    }
  });
});

/**
 * Defects found in the final audit of the three country files against their Appendix B flow
 * diagrams and the primary texts (Kenya Law's LN 68, Decisión 391, Planalto's Decreto 8.772),
 * 23 September 2026. Each is pinned here so it cannot come back.
 */
describe("final audit against the diagrams and primary texts", () => {
  const KE = countries.get("KE")!;
  const CO = countries.get("CO")!;
  const BR = countries.get("BR")!;
  const brFacts = (over: Partial<CaseFacts> = {}): CaseFacts =>
    withDeclaredDefaults(BR, { purpose: "commercial", activity: "research_development", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "no", tkInvolved: "no", flags: { art27Area: "no" }, ...over });

  it("Brazil: a foreign natural person is barred from every access activity, database comparison inside R&D included (Lei Art. 11 §1)", () => {
    for (const activity of ["research_development", "database_extraction_in_rd"]) {
      const answer = evaluateScope(BR, brFacts({ applicantType: "foreign_natural", activity }));
      expect(answer.kind, activity).toBe("out_of_scope");
      expect(answer.ruleId, activity).toBe("foreign_natural_person_barred");
      expect(answer.basis.citation).toMatch(/Art\. 11 §1/);
      expect(buildPathway(BR, brFacts({ applicantType: "foreign_natural", activity })).stages, activity).toEqual([]);
    }
    // Reading a database is not access at all, whoever reads it: the answer is "not access", not "prohibited".
    expect(evaluateScope(BR, brFacts({ applicantType: "foreign_natural", activity: "database_reading" })).ruleId).toBe("database_reading_not_access");
    // Exploiting a finished product is not access, and the diagram routes it past the registrant question.
    // Whether a foreign natural person may notify as manufacturer or importer is open: routed, never guessed.
    const exploitation = evaluateScope(BR, brFacts({ applicantType: "foreign_natural", activity: "economic_exploitation" }));
    expect(exploitation.kind).toBe("escalate");
    // A Brazilian natural person doing the same database work is in scope.
    expect(evaluateScope(BR, brFacts({ applicantType: "national_natural", activity: "database_extraction_in_rd" })).kind).toBe("in_scope");
  });

  it("Brazil: completing the SisGen form is the registrant's filing, recorded by its signatory; the administrator cannot file, and an out-of-scope case has nothing to file", () => {
    const p = fresh();
    const luana = p.actorFor("seat_luana_iam");
    p.signalInterest(p.actorFor("seat_amara_meridian"), "lst_br_metabolite");
    const { caseId } = p.reciprocate(luana, "lst_br_metabolite", "org_meridian");
    p.updateFacts(luana, caseId, brFacts());
    // The platform's administrator records the authority's acts; it never files for a party.
    expect(() => p.fireEvent(ADMIN, caseId, "complete_form")).toThrow(/applicant's own act/);
    // A foreign natural person has no route (Lei Art. 11 §1), so there is no filing to record.
    p.updateFacts(luana, caseId, brFacts({ applicantType: "foreign_natural" }));
    expect(() => p.fireEvent(luana, caseId, "complete_form")).toThrow(/out of scope/);
    expect(p.store.cases.get(caseId)!.machine.state).toBe("preparing");
    p.updateFacts(luana, caseId, brFacts());
    p.fireEvent(luana, caseId, "complete_form", "Form completed (fictional)");
    expect(p.store.cases.get(caseId)!.machine.state).toBe("receipt_issued");
    expect(p.instrumentsFor(caseId).map((i) => i.outputId)).toEqual(["sisgen_receipt"]);
    // Filed while the R5 collaboration judgment is still pending: the record says which stage was open.
    const filed = p.store.audit.list().find((e) => e.action === "regulator.event_recorded" && e.subject.id === caseId)!;
    expect(filed.detail.stagesOpenAtFiling).toEqual(["registrant"]);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("a clock never lapses while its final day is still running where the authority sits (Kenya: the end of the thirtieth working day in Nairobi)", () => {
    // Received Thursday 1 October 2026 at 10:00 in Nairobi. Thirty working days, skipping Mashujaa Day
    // (Tuesday 20 October), end on Friday 13 November.
    const at = new Date("2026-10-01T07:00:00Z");
    const s = fire(KE, initialSnapshot(KE, at), "submit", "applicant", at);
    expect(localDate(new Date(s.clocks.determination.deadline!), KE.timeZone)).toBe("2026-11-13");
    // 10:01 and 23:00 in Nairobi on 13 November: the last day is still running, nothing has lapsed.
    for (const t of ["2026-11-13T07:01:00Z", "2026-11-13T20:00:00Z"]) {
      const r = tick(KE, s, new Date(t));
      expect(r.lapsed, t).toEqual([]);
      expect(r.snap.clocks.determination.daysRemaining, t).toBe(0);
      expect(r.snap.clocks.determination.pastDeadline, t).toBe(false);
    }
    // One second after midnight in Nairobi it has.
    const late = tick(KE, s, new Date("2026-11-13T21:00:01Z"));
    expect(late.lapsed).toEqual(["determination"]);
    expect(late.snap.clocks.determination.pastDeadline).toBe(true);
  });

  it("days are dates on the authority's calendar: an evening and a morning admission in Bogotá on the same day share one deadline", () => {
    const admitted = (at: Date) => fire(CO, fire(CO, initialSnapshot(CO, at), "submit", "applicant", at), "admit", "authority", at).clocks.evaluation.deadline!;
    const evening = admitted(new Date("2026-10-03T01:00:00Z")); // Friday 2 October, 20:00 in Bogotá (already Saturday in UTC)
    const morning = admitted(new Date("2026-10-02T15:00:00Z")); // Friday 2 October, 10:00 in Bogotá
    expect(evening).toBe(morning);
    // Thirty días hábiles from Friday 2 October skip 12 October, 2 November and 16 November: Wednesday 18 November.
    expect(localDate(new Date(evening), CO.timeZone)).toBe("2026-11-18");
    // A holiday is matched on the local date: 20:00 in Bogotá on Monday 7 December is a working day,
    // though the UTC date is already the Inmaculada Concepción holiday.
    const eve = new Date("2026-12-08T01:00:00Z");
    expect(isWorkingDay(eve, CO.calendar, CO.timeZone)).toBe(true);
    expect(isWorkingDay(eve, CO.calendar)).toBe(false);
  });

  it("Kenya: the thirty working days run from receipt of the bundle, not from NEMA's acknowledgement (reg. 14(1))", () => {
    const at = new Date("2026-10-01T07:00:00Z");
    const submitted = fire(KE, initialSnapshot(KE, at), "submit", "applicant", at);
    expect(submitted.clocks.determination.startedAt).toBe(at.toISOString());
    // An acknowledgement a week later does not move the deadline.
    const acknowledged = fire(KE, submitted, "acknowledge", "authority", new Date("2026-10-08T07:00:00Z"));
    expect(acknowledged.clocks.determination.deadline).toBe(submitted.clocks.determination.deadline);
    // An acknowledgement that never comes does not stop the count: the clock can lapse while the bundle sits with NEMA.
    expect(tick(KE, submitted, new Date("2026-11-14T09:00:00Z")).lapsed).toEqual(["determination"]);
    expect(KE.stateMachine.clocks[0].basis.citation).toMatch(/14\(1\)/);
  });

  it("Brazil: the Art. 28 assent clock counts to the latest day the sixty days can end, 5 + 60 days from the form, to the end of that day in Brasília", () => {
    const at = new Date("2026-10-01T13:00:00Z"); // 10:00 in Brasília
    const s = fire(BR, initialSnapshot(BR, at), "complete_form", "applicant", at, undefined, brFacts({ flags: { art27Area: "yes" } }));
    expect(s.state).toBe("awaiting_assent");
    expect(localDate(new Date(s.clocks.art28_assent.deadline!), BR.timeZone)).toBe("2026-12-05");
    // Sixty days after the form is not a lapse: the authority may have been notified only on day five.
    expect(tick(BR, s, new Date("2026-11-30T20:00:00Z")).lapsed).toEqual([]);
    expect(tick(BR, s, new Date("2026-12-06T03:00:01Z")).lapsed).toEqual(["art28_assent"]);
    // The outer bound is GENE-LINK's reading, and says so.
    expect(BR.stateMachine.clocks[0].basis.marker).toBe("▸");
  });

  it("a not-executable (⊘) value can never stop or hold a stage", () => {
    const cfg: CountryConfig = structuredClone(KE);
    const req = cfg.stages.find((s) => s.id === "eligibility")!.requirements.find((r) => r.id === "endemic_rare_threatened_stop")!;
    req.reg = { ...req.reg, marker: "⊘", executable: false };
    expect(lintCountry(cfg).some((i) => i.severity === "error" && /not-executable/.test(i.message))).toBe(true);
  });

  it("every clock carries the rule that says when it starts, and every country names the time zone it counts in", () => {
    const raw = parseYaml(readFileSync(join(process.cwd(), "config", "countries", "kenya.yaml"), "utf8"));
    const noBasis = structuredClone(raw);
    delete noBasis.stateMachine.clocks[0].basis;
    expect(() => parseCountry(stringifyYaml(noBasis), "kenya-no-basis.yaml")).toThrow(ConfigError);
    const badZone = { ...structuredClone(raw), timeZone: "Africa/Atlantis" };
    expect(() => parseCountry(stringifyYaml(badZone), "kenya-bad-zone.yaml")).toThrow(/IANA time zone/);
    for (const cfg of countries.values()) {
      for (const c of cfg.stateMachine.clocks) expect(c.basis.citation, `${cfg.code}/${c.id}`).toBeTruthy();
    }
  });
});
