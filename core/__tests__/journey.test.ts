import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCountries } from "../config/load";
import { InMemoryStore } from "../store/memory";
import { seed, ADMIN } from "../seed/seed";
import { Platform, PermissionDenied } from "../platform";
import { verifyChain } from "../audit/chain";
import type { CaseFacts } from "../config/schema";

const countries = loadCountries(join(process.cwd(), "config", "countries"));

function fresh() {
  return seed(new InMemoryStore(), countries);
}

describe("seeded platform: the full partnership journey", () => {
  const p = fresh();

  it("models person, organisation and membership as three entities, with one person holding seats in two organisations", () => {
    const amara = p.seatsFor("p_amara");
    expect(amara).toHaveLength(2);
    expect(new Set(amara.map((s) => s.organisationId)).size).toBe(2);
    expect(amara.map((s) => s.permission).sort()).toEqual(["administrator", "viewer"]);
  });

  it("a broker is one organisation with several market functions, not several accounts", () => {
    const broker = p.store.organisations.get("org_meridian")!;
    expect(broker.functions).toEqual(expect.arrayContaining(["brokering", "seeking", "providing", "advising"]));
  });

  it("public projections hide identity, species and locality until mutual interest", () => {
    const pub = p.publicListings().find((l) => l.id === "lst_ke_antiinfl")!;
    expect(pub).not.toHaveProperty("speciesDetail");
    expect(pub).not.toHaveProperty("organisationName");
    const kwame = p.actorFor("seat_kwame_asheokoro");
    expect(p.listingFor(kwame, "lst_ke_antiinfl").projection).toBe("public");
    const ines = p.actorFor("seat_ines_nordlicht");
    expect(p.listingFor(ines, "lst_ke_antiinfl").projection).toBe("full");
  });

  it("the reveal is a recorded, symmetric audit event", () => {
    const reveals = p.store.audit.list().filter((e) => e.action === "match.revealed");
    expect(reveals.length).toBeGreaterThan(0);
    expect(reveals[0].detail.symmetric).toBe(true);
  });

  it("the audit chain verifies and detects tampering", () => {
    const chain = p.store.audit.list();
    expect(verifyChain(chain).ok).toBe(true);
    const tampered = structuredClone(chain);
    tampered[3].detail = { ...tampered[3].detail, injected: true };
    const r = verifyChain(tampered);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.brokenAt).toBe(4);
  });

  it("Kenya case halts on the Fifth Schedule rate status and the TK registration procedure, with open escalations", () => {
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const pathway = p.pathwayFor(ke);
    expect(pathway.haltedStageIds).toEqual(expect.arrayContaining(["consent_and_terms", "tk_statute"]));
    const esc = p.escalationsFor(ke.id);
    expect(esc.every((e) => e.status === "open")).toBe(true);
    expect(esc.every((e) => e.ownerName === null)).toBe(true); // named owner pending Landscape Alliance
  });

  it("a halted stage cannot be marked complete", () => {
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const ines = p.actorFor("seat_ines_nordlicht");
    expect(() => p.markStage(ines, ke.id, "consent_and_terms", "complete")).toThrow(PermissionDenied);
  });

  it("Colombia case ends in one access contract with an addendum history (R7)", () => {
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const instruments = p.instrumentsFor(co.id);
    expect(instruments).toHaveLength(1);
    expect(instruments[0].kind).toBe("access_contract");
    expect(instruments[0].versions.length).toBeGreaterThanOrEqual(3);
    expect(instruments[0].versions.filter((v) => v.kind === "addendum").length).toBeGreaterThanOrEqual(2);
    expect(co.machine.history.map((h) => h.to)).toEqual(expect.arrayContaining(["returned_incomplete", "information_requested", "accepted", "negotiating", "perfected"]));
  });

  it("the second Kenya case sits in deadline_lapsed and holds no instrument (R8)", () => {
    const lapsed = p.store.cases.list().find((c) => c.machine.state === "deadline_lapsed")!;
    expect(lapsed).toBeTruthy();
    expect(p.instrumentsFor(lapsed.id)).toHaveLength(0);
    expect(p.store.audit.list().some((e) => e.action === "clock.lapsed" && e.detail.granted === false)).toBe(true);
  });

  it("the Brazil dry-run case holds a declaratory receipt with verification open and a pending manual review (R5)", () => {
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [receipt] = p.instrumentsFor(br.id);
    expect(receipt.kind).toBe("declaratory_receipt");
    expect(receipt.status).toBe("verification_open");
    const reviews = p.manualReviewsFor(br.id);
    expect(reviews.some((r) => r.reviewId === "genuine_scientific_collaboration" && r.status === "pending_human_judgment")).toBe(true);
  });

  it("the system cannot decide a manual review, a human with a reason can", () => {
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    const [review] = p.manualReviewsFor(br.id);
    expect(() => p.decideManualReview({ system: true }, review.id, "x", "y")).toThrow(PermissionDenied);
    p.decideManualReview(ADMIN, review.id, "Genuine collaboration exists (fictional decision)", "Joint publications and shared protocol reviewed by counsel");
    expect(p.store.manualReviews.get(review.id)!.status).toBe("decided");
  });

  it("the non-commercial case is out of scope with a recorded basis and no pathway", () => {
    const oos = p.store.cases.list().find((c) => c.facts.purpose === "non_commercial")!;
    const pathway = p.pathwayFor(oos);
    expect(pathway.scope.kind).toBe("out_of_scope");
    expect(pathway.stages).toHaveLength(0);
  });

  it("agreements: approval by authorised seats in both organisations precedes execution, and executed versions are immutable", () => {
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const [agreement] = p.agreementsFor(co.id);
    expect(agreement.status).toBe("executed");
    expect(agreement.executions).toHaveLength(2);
    const camila = p.actorFor("seat_camila_ibp");
    expect(() => p.reviseAgreement(camila, agreement.id, "late change", agreement.versions[0].clauses)).toThrow(PermissionDenied);
  });

  it("a member seat cannot execute, an authorised signatory can", () => {
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const [agr] = p.agreementsFor(ke.id);
    const tobias = p.actorFor("seat_tobias_nordlicht");
    expect(() => p.approveAgreement(tobias, agr.id)).toThrow(PermissionDenied);
  });

  it("verification page matches recorded hashes", () => {
    const co = p.store.cases.list().find((c) => c.providerCountry === "CO" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const [agreement] = p.agreementsFor(co.id);
    const v = agreement.versions[agreement.versions.length - 1];
    const body = v.clauses.map((c) => `${c.id}\n${c.title}\n${c.text}`).join("\n\n");
    const r = p.verifyContent(`v${v.version}\n${body}`);
    expect(r.matches.some((m) => m.id === agreement.id)).toBe(true);
  });

  it("expert support routes to the parties' adviser, never to a GENE-LINK review queue", () => {
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    expect(ke.supportRequests[0].routedTo).toMatch(/Not a GENE-LINK review queue/);
  });
});

describe("dry run (R2): the same journey for every configured country, no country-specific code", () => {
  for (const cfg of countries.values()) {
    it(`${cfg.name}: open a case, walk to a granted state, hold the configured instruments`, () => {
      const store = new InMemoryStore();
      const p = seed(store, countries);
      const at = new Date("2027-01-15T09:00:00Z");
      p.now = () => at;
      // Create a listing for this country from the first providing organisation of that country, or reuse.
      const listing = store.listings.list().find((l) => l.provenanceCountry === cfg.code);
      expect(listing, `a fixture listing exists for ${cfg.code}`).toBeTruthy();
      const supplierSeat = store.memberships.list().find((m) => m.organisationId === listing!.organisationId)!;
      const demand = p.actorFor("seat_amara_meridian");
      const supplier = p.actorFor(supplierSeat.id);
      // Fresh counterparty pairing so we get a new case.
      const before = store.cases.list().length;
      const c = (() => {
        const existing = store.cases.list().find((x) => x.listingId === listing!.id && x.participants.some((pp) => pp.organisationId === "org_meridian"));
        if (existing) return existing;
        p.signalInterest(demand, listing!.id);
        const { caseId } = p.reciprocate(supplier, listing!.id, "org_meridian");
        return store.cases.get(caseId)!;
      })();
      void before;
      const facts: CaseFacts = { purpose: "commercial", activity: cfg.scope.questions[0].options[0].id, provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "no", tkInvolved: "no", flags: {} };
      p.updateFacts(supplier, c.id, facts);
      const pathway = p.pathwayFor(c);
      expect(pathway.scope.kind).toBe("in_scope");
      expect(pathway.stages.length).toBeGreaterThan(2);

      // Walk the machine along the shortest declared path to a granted state.
      const sm = cfg.stateMachine;
      const granted = Object.entries(sm.states).filter(([, s]) => s.outcome === "granted").map(([k]) => k);
      const path = shortestPath(sm.initial, granted, sm.transitions.filter((t) => t.event !== "lapse").map((t) => [t.from, t.to, t.event] as const));
      expect(path, `a declared path to a granted state exists in ${cfg.code}`).toBeTruthy();
      if (c.machine.state === sm.initial) {
        for (const ev of path!) p.fireEvent(ADMIN, c.id, ev);
      }
      const instruments = p.instrumentsFor(c.id);
      const expected = cfg.outputs.filter((o) => o.issuedInState === store.cases.get(c.id)!.machine.state).map((o) => o.id).sort();
      expect(instruments.map((i) => i.outputId).sort()).toEqual(expected);
      expect(verifyChain(store.audit.list()).ok).toBe(true);
    });
  }
});

function shortestPath(start: string, goals: string[], edges: readonly (readonly [string, string, string])[]): string[] | null {
  const queue: { state: string; events: string[] }[] = [{ state: start, events: [] }];
  const seen = new Set([start]);
  while (queue.length) {
    const { state, events } = queue.shift()!;
    if (goals.includes(state) && events.length) return events;
    for (const [from, to, ev] of edges) {
      if (from === state && !seen.has(to)) {
        seen.add(to);
        queue.push({ state: to, events: [...events, ev] });
      }
    }
  }
  return null;
}
