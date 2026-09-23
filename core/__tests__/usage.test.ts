import { afterEach, describe, expect, it, vi } from "vitest";
import { join } from "node:path";
import { loadCountries } from "../config/load";
import { InMemoryStore } from "../store/memory";
import { seed, ADMIN } from "../seed/seed";
import { InvalidRequest, MAX_DEMAND_SIGNALS_KEPT, PermissionDenied, Platform } from "../platform";
import { errorKind } from "../errors";
import { verifyChain } from "../audit/chain";
import { describeError, isUnauditedDenial } from "../../lib/describeError";
import { clientKey, resetRateLimits, take } from "../../lib/rateLimit";

/**
 * Regressions for what using the product as real people would surfaced on 23 September 2026: many users
 * at once, adversarially, and on an instance with no seed data at all.
 */

const countries = loadCountries(join(__dirname, "..", "..", "config", "countries"));
const fresh = () => seed(new InMemoryStore(), countries);
const empty = () => new Platform(new InMemoryStore(), countries);

afterEach(() => {
  vi.useRealTimers();
});

describe("a refusal reaches the person as its sentence, whichever module copy threw it", () => {
  it("is recognised by kind across two loaded copies of the error module", async () => {
    vi.resetModules();
    const a = await import("../errors");
    vi.resetModules();
    const b = await import("../errors");
    expect(a.PermissionDenied).not.toBe(b.PermissionDenied);
    const e = new b.PermissionDenied("Not a participant in this case");
    // The failure mode of the production build: instanceof against the other copy is false.
    expect(e instanceof a.PermissionDenied).toBe(false);
    expect(a.errorKind(e)).toBe("permission_denied");
    expect(errorKind(new b.TransitionError("x"))).toBe("transition");
    expect(errorKind(new b.NotFound("x"))).toBe("not_found");
    expect(errorKind(new b.InvalidRequest("x"))).toBe("invalid_request");
    expect(errorKind(new Error("x"))).toBeNull();
    expect(errorKind({ message: "forged" })).toBeNull();
  });

  it("describeError returns the sentence and marks an unaudited denial for the audit chain", async () => {
    vi.resetModules();
    const other = await import("../errors");
    const denied = new other.PermissionDenied("Administrator sign-in required");
    expect(describeError(denied)).toBe("Administrator sign-in required");
    expect(isUnauditedDenial(denied)).toBe(true);
    (denied as unknown as { audited: boolean }).audited = true;
    expect(isUnauditedDenial(denied)).toBe(false);
    expect(describeError(new other.InvalidRequest("Choose one of the listed objectives."))).toBe("Choose one of the listed objectives.");
    // A validation failure from another copy of zod is recognised by its shape.
    const zodLike = Object.assign(new Error("invalid"), { name: "ZodError", issues: [{ code: "invalid_value", path: ["applicantType"] }] });
    expect(describeError(zodLike)).toMatch(/not among the options offered: applicant type/);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(describeError(new Error("boom"))).toMatch(/Something unexpected happened/);
    spy.mockRestore();
  });
});

describe("a lapse follows from the clock and is never recorded by hand", () => {
  it("refuses a hand-posted lapse from the administrator while the clock runs, and records the attempt", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    p.fireEvent(ines, "case_1_ke", "submit");
    const before = p.store.cases.get("case_1_ke")!.machine.state;
    expect(before).toBe("submitted");
    expect(() => p.fireEvent(ADMIN, "case_1_ke", "lapse", "forged")).toThrow(/not recorded by hand/);
    expect(() => p.fireEvent(ADMIN, "case_1_ke", "lapse")).toThrow(PermissionDenied);
    expect(p.store.cases.get("case_1_ke")!.machine.state).toBe(before);
    const denied = p.store.audit.list().filter((e) => e.action === "regulator.event_denied" && e.subject.id === "case_1_ke" && (e.detail as { event?: string }).event === "lapse");
    expect(denied).toHaveLength(2);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("still lapses through the clock once the last day has ended, and marks a simulated check as such", () => {
    const p = fresh();
    p.fireEvent(p.actorFor("seat_ines_nordlicht"), "case_1_ke", "submit");
    const r = p.forceLapse("case_1_ke");
    expect(r?.lapsed.length).toBeGreaterThan(0);
    const c = p.store.cases.get("case_1_ke")!;
    expect(p.country("KE").stateMachine.states[c.machine.state].outcome).toBe("lapsed");
    const entry = p.store.audit.list().filter((e) => e.action === "clock.lapsed" && e.subject.id === "case_1_ke").at(-1)!;
    expect(entry.detail).toMatchObject({ demoTimeControl: true, granted: false });
    expect(typeof (entry.detail as { simulatedCheckAt?: string }).simulatedCheckAt).toBe("string");
  });
});

describe("Brazil: the Brazilian registrant files, never the foreign company in its own name", () => {
  function brazilCaseWithForeignApplicant() {
    const p = fresh();
    // Nordlicht (DE) and IAM (BR) are the parties to the seeded Brazil case; open a second, unfiled one.
    const l = p.createListing(p.actorFor("seat_luana_iam"), { side: "offer", provenanceCountry: "BR", functionCodes: ["F07 anti-inflammatory"], resourceClass: "Plant metabolites (in situ)", publicSummary: "Second Brazilian offer for the filer test.", indicativeScale: "", publicTaxon: "", speciesDetail: "", localityDetail: "", fullDescription: "", dsiExposure: "none" });
    const ines = p.actorFor("seat_ines_nordlicht");
    p.signalInterest(ines, l.id);
    const { caseId } = p.reciprocate(p.actorFor("seat_luana_iam"), l.id, "org_nordlicht");
    p.updateFacts(ines, caseId, { purpose: "commercial", activity: "research_development", provenance: "in_situ", applicantType: "foreign_legal", exchange: "title_transfer", communityHeld: "no", tkInvolved: "no", flags: { scientificCollaboration: "unclear", art27Area: "no" } });
    return { p, caseId, ines };
  }

  it("refuses the foreign company's own filing with the rule and names who files", () => {
    const { p, caseId, ines } = brazilCaseWithForeignApplicant();
    expect(() => p.fireEvent(ines, caseId, "complete_form")).toThrow(/Instituto Amazônico de Metabólitos records "complete form"/);
    expect(p.store.cases.get(caseId)!.machine.state).toBe("preparing");
    const denied = p.store.audit.list().filter((e) => e.action === "regulator.event_denied" && e.subject.id === caseId);
    expect(denied.at(-1)!.detail).toMatchObject({ event: "complete_form", citation: "Lei Art. 12 II; Decreto Art. 22-B" });
  });

  it("accepts the filing from the Brazilian party's signatory", () => {
    const { p, caseId } = brazilCaseWithForeignApplicant();
    p.fireEvent(p.actorFor("seat_luana_iam"), caseId, "complete_form");
    expect(p.store.cases.get(caseId)!.machine.state).toBe("receipt_issued");
  });

  it("leaves Kenya and Colombia, whose files name no filer, as before", () => {
    const p = fresh();
    expect(p.country("KE").stateMachine.applicantFiledBy).toBeUndefined();
    expect(p.country("CO").stateMachine.applicantFiledBy).toBeUndefined();
    expect(p.country("BR").stateMachine.applicantFiledBy?.reg.state).toBe("established");
  });
});

describe("an organisation's administrator gives and revokes seats", () => {
  it("creates a working seat for a colleague and records it", () => {
    const p = fresh();
    const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
    const m = p.inviteColleague(wanjiru, "org_lbnpi", { name: "Grace Achieng", permission: "authorised_signatory" });
    const grace = p.actorFor(m.id);
    expect("seat" in grace && grace.seat.permission).toBe("authorised_signatory");
    expect(p.seatsFor(m.personId).map((s) => s.id)).toEqual([m.id]);
    expect(p.store.audit.list().at(-1)).toMatchObject({ action: "seat.invited", subject: { id: m.id } });
  });

  it("refuses a seat that is not the organisation's administrator, and audits the attempt", () => {
    const p = fresh();
    expect(() => p.inviteColleague(p.actorFor("seat_otieno_lbnpi"), "org_lbnpi", { name: "Someone Else", permission: "administrator" })).toThrow(PermissionDenied);
    expect(() => p.inviteColleague(p.actorFor("seat_amara_meridian"), "org_lbnpi", { name: "Someone Else", permission: "member" })).toThrow(PermissionDenied);
    expect(p.store.audit.list().filter((e) => e.action === "seat.invite_denied")).toHaveLength(2);
    expect(() => p.inviteColleague(p.actorFor("seat_wanjiru_lbnpi"), "org_lbnpi", { name: "X", permission: "member" })).toThrow(InvalidRequest);
    expect(() => p.inviteColleague(p.actorFor("seat_wanjiru_lbnpi"), "org_lbnpi", { name: "Valid Name", permission: "owner" as never })).toThrow(InvalidRequest);
  });

  it("revokes a seat: it stops acting, stays on the record, and the last administrator cannot be revoked", () => {
    const p = fresh();
    const wanjiru = p.actorFor("seat_wanjiru_lbnpi");
    p.revokeSeat(wanjiru, "seat_otieno_lbnpi", "Left the institute");
    expect(() => p.actorFor("seat_otieno_lbnpi")).toThrow(PermissionDenied);
    expect(p.store.memberships.get("seat_otieno_lbnpi")!.revoked).toMatchObject({ bySeatId: "seat_wanjiru_lbnpi", reason: "Left the institute" });
    expect(p.seatsFor("p_otieno")).toHaveLength(0);
    expect(() => p.revokeSeat(wanjiru, "seat_wanjiru_lbnpi", "no")).toThrow(/only administrator seat/);
    expect(() => p.revokeSeat(wanjiru, "seat_otieno_lbnpi", "again")).toThrow(/already revoked/);
    expect(() => p.revokeSeat(p.actorFor("seat_ines_nordlicht"), "seat_tobias_nordlicht", "not admin")).toThrow(PermissionDenied);
    expect(() => p.revokeSeat(wanjiru, "seat_tobias_nordlicht", "other organisation")).toThrow(PermissionDenied);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });
});

describe("resetting the demo restores the seed as written", () => {
  it("does not carry a revoked seat, a withdrawn listing or a verification decision into the next seed", () => {
    const a = fresh();
    a.revokeSeat(a.actorFor("seat_wanjiru_lbnpi"), "seat_otieno_lbnpi", "test");
    a.withdrawListing(a.actorFor("seat_wanjiru_lbnpi"), "lst_ke_antiinfl", "test");
    a.decideVerification(ADMIN, "org_olkalou", "declined", "test");
    const b = fresh();
    expect(b.store.memberships.get("seat_otieno_lbnpi")!.revoked).toBeUndefined();
    expect(b.store.listings.get("lst_ke_antiinfl")!.withdrawn).toBeUndefined();
    expect(b.store.organisations.get("org_olkalou")!.verification.status).toBe("pending");
    expect(b.store.organisations.get("org_olkalou")!.verification.reason).toBeUndefined();
  });
});

describe("organisations publish and withdraw their own listings", () => {
  const offer = { side: "offer", provenanceCountry: "KE", functionCodes: ["F19 antioxidant"], resourceClass: "Leaf extracts (in situ)", publicSummary: "Antioxidant screening material from a community seed bank.", indicativeScale: "Grams", publicTaxon: "", speciesDetail: "Two accessions", localityDetail: "Nyandarua County", fullDescription: "", dsiExposure: "possible" };

  it("publishes an offer a searcher can find, withholding the full fields", () => {
    const p = fresh();
    const l = p.createListing(p.actorFor("seat_otieno_lbnpi"), offer);
    expect(l.glId).toMatch(/^GL-KE-\d{4}-\d{4}$/);
    expect(l.publicTaxon).toMatch(/Withheld/);
    const found = p.searchPublicListings("antioxidant", "KE", "offer").map((x) => x.id);
    expect(found).toContain(l.id);
    expect(p.searchPublicListings("Nyandarua", "", "").map((x) => x.id)).not.toContain(l.id);
    expect(p.store.audit.list().at(-1)).toMatchObject({ action: "listing.published", subject: { id: l.id } });
  });

  it("refuses a member seat, an unconfigured provider country and functions off the taxonomy", () => {
    const p = fresh();
    expect(() => p.createListing(p.actorFor("seat_tobias_nordlicht"), { ...offer, side: "need", provenanceCountry: "any" })).toThrow(PermissionDenied);
    expect(() => p.createListing(p.actorFor("seat_otieno_lbnpi"), { ...offer, provenanceCountry: "GH" })).toThrow(/configured pathway/);
    expect(() => p.createListing(p.actorFor("seat_otieno_lbnpi"), { ...offer, functionCodes: ["F99 made up"] })).toThrow(/taxonomy/);
    expect(() => p.createListing(p.actorFor("seat_otieno_lbnpi"), { ...offer, side: "barter" })).toThrow(InvalidRequest);
    expect(() => p.createListing(ADMIN, offer)).toThrow(PermissionDenied);
    expect(p.createListing(p.actorFor("seat_ines_nordlicht"), { ...offer, side: "need", provenanceCountry: "any" }).provenanceCountry).toBe("any");
  });

  it("withdraws a listing: out of discovery, closed to signals, existing cases untouched", () => {
    const p = fresh();
    const before = p.store.cases.list().length;
    p.withdrawListing(p.actorFor("seat_otieno_lbnpi"), "lst_ke_antiinfl", "Collection under review");
    expect(p.publicListings().map((l) => l.id)).not.toContain("lst_ke_antiinfl");
    expect(p.searchPublicListings("anti-inflammatory", "KE", "").map((l) => l.id)).not.toContain("lst_ke_antiinfl");
    expect(() => p.signalInterest(p.actorFor("seat_amara_meridian"), "lst_ke_antiinfl")).toThrow(/withdrawn/);
    expect(p.store.cases.get("case_1_ke")).toBeDefined();
    expect(p.store.cases.list().length).toBe(before);
    expect(() => p.withdrawListing(p.actorFor("seat_ines_nordlicht"), "lst_ke_antiinfl", "not mine")).toThrow(PermissionDenied);
  });
});

describe("the product runs from an empty database, with no seed data", () => {
  it("takes two new organisations from registration to an open case, with colleagues and a filing", () => {
    const p = empty();
    const coop = p.registerOrganisation({ personName: "Achieng Otieno", orgName: "Lake Victoria Herbal Cooperative", kind: "community_custodian", country: "KE", method: "vouching", functions: ["providing", "custodian"] });
    const buyer = p.registerOrganisation({ personName: "Jonas Weber", orgName: "Weber Naturstoffe GmbH", kind: "company", country: "DE", method: "manual_vetting", functions: ["seeking"] });
    const admin = { admin: { personId: "person_admin", name: "Administrator" } };
    p.decideVerification(admin, coop.organisationId, "verified", "Vouched for by a verified institute");
    p.decideVerification(admin, buyer.organisationId, "verified", "Register extract checked");
    const coopAdmin = p.actorFor(coop.seatId);
    const listing = p.createListing(coopAdmin, offer());
    // The founding administrator gives a colleague a signatory seat; the buyer does the same.
    const grace = p.inviteColleague(coopAdmin, coop.organisationId, { name: "Grace Wanjala", permission: "authorised_signatory" });
    const jonas = p.actorFor(buyer.seatId);
    const lena = p.inviteColleague(jonas, buyer.organisationId, { name: "Lena Voigt", permission: "member" });
    expect(p.searchPublicListings("antioxidant", "", "").map((l) => l.id)).toEqual([listing.id]);
    expect(p.signalInterest(p.actorFor(lena.id), listing.id).mutual).toBe(false);
    const { caseId } = p.reciprocate(p.actorFor(grace.id), listing.id, buyer.organisationId);
    const c = p.store.cases.get(caseId)!;
    expect(c.providerCountry).toBe("KE");
    p.updateFacts(p.actorFor(lena.id), caseId, { purpose: "commercial", activity: "collection_research", provenance: "in_situ", applicantType: "foreign_legal", exchange: "title_transfer", communityHeld: "no", tkInvolved: "no", flags: { speciesListed: "not_listed", pgrfaMaterial: "no", localities: "1" } } as never);
    // A member prepares; the signatory files.
    expect(() => p.fireEvent(p.actorFor(lena.id), caseId, "submit")).toThrow(PermissionDenied);
    p.fireEvent(jonas, caseId, "submit");
    expect(p.store.cases.get(caseId)!.machine.state).toBe("submitted");
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
    function offer() {
      return { side: "offer", provenanceCountry: "KE", functionCodes: ["F19 antioxidant"], resourceClass: "Leaf extracts (in situ)", publicSummary: "Antioxidant screening material from a community seed bank.", indicativeScale: "", publicTaxon: "", speciesDetail: "", localityDetail: "", fullDescription: "", dsiExposure: "none" };
    }
  });
});

describe("what one visitor can write without a seat is bounded", () => {
  it("rate-limits per client and keeps clients apart", () => {
    resetRateLimits();
    const now = 1_000_000;
    for (let i = 0; i < 5; i++) expect(take("register", "203.0.113.7", 5, 600_000, now).ok).toBe(true);
    const r = take("register", "203.0.113.7", 5, 600_000, now + 1000);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.retryAfterSeconds).toBe(599);
    expect(take("register", "198.51.100.2", 5, 600_000, now).ok).toBe(true);
    expect(take("register", "203.0.113.7", 5, 600_000, now + 600_001).ok).toBe(true);
    resetRateLimits();
  });

  it("identifies the client by the edge's header before a header the client can write", () => {
    const h = (o: Record<string, string>) => ({ get: (n: string) => o[n] ?? null });
    expect(clientKey(h({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    expect(clientKey(h({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" }))).toBe("198.51.100.2");
    expect(clientKey(h({}))).toBe("direct");
  });

  it("keeps demand-signal counts whole while memory stays bounded", () => {
    const p = fresh();
    const n = MAX_DEMAND_SIGNALS_KEPT + 50;
    for (let i = 0; i < n; i++) p.recordDemandSignal(null, { want: i % 2 ? "learn" : "source_from_south", have: `flood ${i}`, redactions: 0 });
    const s = p.demandSignalSummary();
    expect(s.total).toBe(n);
    expect(s.kept).toBe(MAX_DEMAND_SIGNALS_KEPT);
    expect(s.byWant.learn + s.byWant.source_from_south).toBe(n);
    expect(s.recent[0].have).toBe(`flood ${n - 1}`);
    expect(new Set(p.store.demandSignals.list().map((d) => d.id)).size).toBe(MAX_DEMAND_SIGNALS_KEPT);
  });
});

describe("the record grows without the pages slowing with it", () => {
  it("dedupes disclosures through the index exactly as the scan did", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    if (!("seat" in ines)) throw new Error("seat expected");
    const c = p.store.cases.get("case_1_ke")!;
    const first = p.discloseCase(ines.person, ines.seat, c);
    expect(first).toBeGreaterThan(0);
    expect(p.discloseCase(ines.person, ines.seat, c)).toBe(0);
    // A second platform over the same store builds its index from what is already recorded.
    const again = new Platform(p.store, countries);
    expect(again.discloseCase(ines.person, ines.seat, c)).toBe(0);
  });

  it("verifies new entries from a checkpoint and still finds an alteration within the minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T10:00:00Z"));
    const p = fresh();
    expect(p.verifyAudit().ok).toBe(true);
    p.recordDenied(null, "probe", { type: "t", id: "1" }, "r");
    expect(p.verifyAudit().ok).toBe(true);
    // Rewrite an early entry in place, as only direct access to the store could.
    (p.store.audit.list()[3].detail as Record<string, unknown>).tampered = true;
    vi.setSystemTime(new Date("2026-09-23T10:01:01Z"));
    const r = p.verifyAudit();
    expect(r.ok).toBe(false);
    expect(!r.ok && r.brokenAt).toBe(4);
  });

  it("returns a fresh pathway when the facts or a judgment change", () => {
    const p = fresh();
    const br = p.store.cases.get("case_4_br")!;
    const before = p.pathwayFor(br);
    expect(p.pathwayFor(br)).toBe(before);
    const [review] = p.manualReviewsFor(br.id);
    if (review && review.status !== "decided") {
      p.decideManualReview(ADMIN, review.id, "Art. 12 II association", "Joint plan reviewed");
      expect(p.pathwayFor(p.store.cases.get("case_4_br")!)).not.toBe(before);
    }
    const ke = p.store.cases.get("case_1_ke")!;
    const kePath = p.pathwayFor(ke);
    p.updateFacts(p.actorFor("seat_ines_nordlicht"), ke.id, { ...ke.facts, tkInvolved: ke.facts.tkInvolved === "yes" ? "no" : "yes" });
    expect(p.pathwayFor(p.store.cases.get("case_1_ke")!)).not.toBe(kePath);
  });
});

describe("the linter guards the filer rule", () => {
  it("refuses a filer rule that rests on an open question", async () => {
    const { lintCountry } = await import("../config/lint");
    const br = countries.get("BR")!;
    const open = { ...br, stateMachine: { ...br.stateMachine, applicantFiledBy: { party: "provider_country" as const, reg: { ...br.stateMachine.applicantFiledBy!.reg, state: "unknown" as const, marker: "?" as const } } } };
    expect(lintCountry(open).some((i) => i.severity === "error" && i.path === "stateMachine.applicantFiledBy")).toBe(true);
    expect(lintCountry(br).some((i) => i.path === "stateMachine.applicantFiledBy")).toBe(false);
  });
});
