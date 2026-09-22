import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCountries } from "../config/load";
import { activityQuestion, type CaseFacts, type CountryConfig } from "../config/schema";
import { evaluateScope } from "../engine/scope";
import { buildPathway } from "../engine/pathway";
import { applyLapse, fire, initialSnapshot, isGranted, tick, TransitionError } from "../engine/stateMachine";
import { amendInstrument, instrumentFrom, renewalProbeAllowed } from "../domain/instruments";
import { withDeclaredDefaults } from "../engine/facts";
import { readFact } from "../engine/conditions";

const countries = loadCountries(join(process.cwd(), "config", "countries"));
const KE = countries.get("KE")!;
const CO = countries.get("CO")!;
const BR = countries.get("BR")!;

const base: CaseFacts = {
  purpose: "commercial",
  activity: "",
  provenance: "in_situ",
  applicantType: "foreign_legal",
  exchange: "no_movement",
  communityHeld: "no",
  tkInvolved: "no",
  flags: {},
};
const facts = (cfg: CountryConfig, over: Partial<CaseFacts> = {}): CaseFacts => ({
  ...base,
  activity: activityQuestion(cfg).options[0].id,
  ...over,
});

describe("scope engine (A5.2): three answers, never a default", () => {
  it("routes non-commercial users to a stated out-of-scope position in every country", () => {
    for (const cfg of countries.values()) {
      const a = evaluateScope(cfg, facts(cfg, { purpose: "non_commercial" }));
      expect(a.kind).toBe("out_of_scope");
      if (a.kind === "out_of_scope") {
        expect(a.basis.state).toBe("established");
        expect(a.redirect).toBeTruthy();
      }
    }
  });

  it("Kenya: sequence data only escalates to a named owner rather than exiting", () => {
    const a = evaluateScope(KE, facts(KE, { activity: "dsi_only", flags: { pgrfaMaterial: "no" } }));
    expect(a.kind).toBe("escalate");
    if (a.kind === "escalate") expect(a.owner).toMatch(/NEMA/);
  });

  it("Colombia: sequence data only escalates, it is not an exit", () => {
    expect(evaluateScope(CO, facts(CO, { activity: "dsi_only" })).kind).toBe("escalate");
  });

  it("Brazil: reading a database is not access, a foreign natural person has no route", () => {
    expect(evaluateScope(BR, facts(BR, { activity: "database_reading" })).kind).toBe("out_of_scope");
    const barred = evaluateScope(BR, facts(BR, { applicantType: "foreign_natural" }));
    expect(barred.kind).toBe("out_of_scope");
    if (barred.kind === "out_of_scope") expect(barred.basis.citation).toMatch(/Art\. 11/);
  });

  it("there is no already-proven or purchase exit in any country", () => {
    for (const cfg of countries.values()) {
      const ids = cfg.scope.rules.map((r) => r.id).join(" ");
      expect(ids).not.toMatch(/proven|purchase|bought/i);
    }
  });
});

describe("pathway (A5.3): the sequence itself comes from configuration", () => {
  it("Colombia places prior consultation before the application and the contract after acceptance", () => {
    const p = buildPathway(CO, facts(CO, { directAffectation: "yes" }));
    const ids = p.stages.map((s) => s.stage.id);
    expect(ids.indexOf("prior_consultation")).toBeLessThan(ids.indexOf("application_data"));
    expect(ids.indexOf("contract_negotiation")).toBeGreaterThan(ids.indexOf("access_proceeding"));
  });

  it("Kenya places consent, MAT and BSA as application documents before submission", () => {
    const p = buildPathway(KE, facts(KE, { communityHeld: "yes" }));
    const ids = p.stages.map((s) => s.stage.id);
    expect(ids.indexOf("consent_and_terms")).toBeLessThan(ids.indexOf("submission"));
    const consent = p.stages.find((s) => s.stage.id === "consent_and_terms")!;
    expect(consent.documents.map((d) => d.id)).toEqual(expect.arrayContaining(["pic", "mat", "bsa", "mta_application"]));
  });

  it("Brazil gates the outputs, not the access: registration sits at the downstream trigger", () => {
    const p = buildPathway(BR, facts(BR));
    const ids = p.stages.map((s) => s.stage.id);
    expect(ids.indexOf("downstream_triggers")).toBeLessThan(ids.indexOf("registration"));
  });

  it("consent is not gated on traditional knowledge (A4)", () => {
    const withoutTk = buildPathway(KE, facts(KE, { communityHeld: "yes", tkInvolved: "no" }));
    const consent = withoutTk.stages.find((s) => s.stage.id === "consent_and_terms")!;
    expect(consent.consentParties.map((c) => c.id)).toContain("community");
    expect(withoutTk.stages.map((s) => s.stage.id)).not.toContain("tk_statute");
    const withTk = buildPathway(KE, facts(KE, { communityHeld: "yes", tkInvolved: "yes" }));
    expect(withTk.stages.map((s) => s.stage.id)).toContain("tk_statute");
  });

  it("stages prune by facts: no export stage when nothing leaves the country", () => {
    const p = buildPathway(KE, facts(KE, { exchange: "no_movement" }));
    expect(p.stages.map((s) => s.stage.id)).not.toContain("export");
    const q = buildPathway(KE, facts(KE, { exchange: "title_transfer" }));
    expect(q.stages.map((s) => s.stage.id)).toContain("export");
  });
});

describe("R3: an unknown halts and escalates, it never defaults", () => {
  it("Kenya: the Fifth Schedule rate status halts consent and terms and routes to NEMA", () => {
    const p = buildPathway(KE, facts(KE, { communityHeld: "yes" }));
    expect(p.haltedStageIds).toContain("consent_and_terms");
    const e = p.escalations.find((x) => x.requirementId === "rates_negotiable")!;
    expect(e.owner).toMatch(/NEMA/);
    expect(e.reg.state).toBe("unknown");
  });

  it("Colombia: the currently required consultation document halts prior consultation", () => {
    const p = buildPathway(CO, facts(CO, { directAffectation: "unclear" }));
    expect(p.haltedStageIds).toContain("prior_consultation");
  });

  it("Brazil: genuine scientific collaboration is a manual-review state, never a checkbox (R5)", () => {
    const p = buildPathway(BR, facts(BR, { applicantType: "foreign_legal" }));
    const registrant = p.stages.find((s) => s.stage.id === "registrant")!;
    expect(registrant.status).toBe("halted");
    expect(registrant.manualReviews.map((m) => m.id)).toContain("genuine_scientific_collaboration");
  });

  it("resolving the value in configuration un-halts the stage with no engine change", () => {
    const resolved: CountryConfig = structuredClone(KE);
    const stage = resolved.stages.find((s) => s.id === "consent_and_terms")!;
    const req = stage.requirements.find((r) => r.id === "rates_negotiable")!;
    req.reg = { state: "established", marker: "§", value: "Negotiable (fictional resolution for the test)", citation: "NEMA ruling (fictional)", drives: true, executable: true };
    const p = buildPathway(resolved, facts(resolved, { communityHeld: "yes" }));
    expect(p.haltedStageIds).not.toContain("consent_and_terms");
  });

  it("unknowns that do not drive a stage are shown but do not halt", () => {
    const p = buildPathway(KE, facts(KE, { activity: "collection_research", localities: 3 }));
    const loc = p.stages.find((s) => s.stage.id === "localities")!;
    expect(loc.requirements.some((r) => r.id === "per_locality_multiplier" && r.reg.state === "unknown")).toBe(true);
    expect(loc.status).toBe("active");
  });

  it("an unanswered deciding fact halts the stage that turns on it; it never removes the stage", () => {
    // Nobody has said whether direct affectation arises. Skipping consulta previa here would be the
    // engine answering "no" on the parties' behalf.
    const unanswered = buildPathway(CO, facts(CO, { flags: { colombiaOrigin: "yes" } }));
    expect(unanswered.scope.kind).toBe("in_scope");
    const consultation = unanswered.stages.find((s) => s.stage.id === "prior_consultation");
    expect(consultation, "the stage stays on the pathway").toBeTruthy();
    expect(consultation!.status).toBe("halted");
    const halt = consultation!.escalations.find((e) => e.kind === "unanswered_fact")!;
    expect(halt.requirementId).toBe("fact:directAffectation");
    expect(halt.question).toMatch(/afectación directa/);
    expect(unanswered.haltedStageIds).toContain("prior_consultation");
    // A recorded "no" is an answer, and does remove the stage.
    const answeredNo = buildPathway(CO, facts(CO, { directAffectation: "no", flags: { colombiaOrigin: "yes" } }));
    expect(answeredNo.stages.map((s) => s.stage.id)).not.toContain("prior_consultation");
  });

  it("a fresh case starts every declared deciding fact in its explicit 'not yet established' option", () => {
    for (const cfg of countries.values()) {
      const seeded = withDeclaredDefaults(cfg, facts(cfg));
      for (const q of cfg.scope.questions.filter((x) => x.fact !== "activity" && x.kind === "choice")) {
        expect(readFact(seeded, q.fact), `${cfg.code} ${q.fact}`).toBe(q.default);
      }
      // With the defaults in place no fact is missing: every question the file declares carries its
      // explicit "not yet established" answer. Where a rule waits on that answer it holds its stage and
      // names the question, which is a hold on the parties' question, never a dropped stage.
      const pathway = buildPathway(cfg, seeded);
      expect(pathway.escalations.filter((e) => e.requirementId.startsWith("fact:")), `${cfg.code}: no declared fact is missing`).toEqual([]);
      for (const e of pathway.escalations.filter((x) => x.kind === "unanswered_fact" && x.stageId !== "intake")) {
        expect(e.id, `${cfg.code}: a hold names its rule`).toMatch(/:hold:/);
      }
    }
    // An answer already given is never overwritten by the default.
    expect(withDeclaredDefaults(CO, facts(CO, { directAffectation: "yes" })).directAffectation).toBe("yes");
  });
});

describe("R8 and R9: state machines with unhappy paths, and lapse never grants", () => {
  const at = new Date("2026-11-02T09:00:00Z");

  it("Kenya walks information requested, resubmitted, refused, appealed", () => {
    let s = initialSnapshot(KE, at);
    s = fire(KE, s, "submit", "applicant", at);
    s = fire(KE, s, "acknowledge", "authority", at);
    s = fire(KE, s, "request_information", "authority", at);
    expect(s.state).toBe("information_requested");
    expect(s.clocks.determination.suspended).toBe(true);
    s = fire(KE, s, "resubmit", "applicant", at);
    s = fire(KE, s, "acknowledge", "authority", at);
    s = fire(KE, s, "refuse", "authority", at);
    expect(s.state).toBe("refused");
    s = fire(KE, s, "appeal", "applicant", at);
    expect(s.state).toBe("appealed");
  });

  it("Colombia: returned incomplete is a real state, acceptance is not a contract", () => {
    let s = initialSnapshot(CO, at);
    s = fire(CO, s, "submit", "applicant", at);
    s = fire(CO, s, "return_incomplete", "authority", at);
    expect(s.state).toBe("returned_incomplete");
    s = fire(CO, s, "resubmit", "applicant", at);
    s = fire(CO, s, "refile", "system", at);
    s = fire(CO, s, "admit", "authority", at);
    s = fire(CO, s, "publish", "authority", at);
    s = fire(CO, s, "begin_evaluation", "authority", at);
    s = fire(CO, s, "accept", "authority", at);
    expect(isGranted(CO, s)).toBe(false);
    expect(() => fire(CO, s, "publish_contract", "authority", at)).toThrow(TransitionError);
    s = fire(CO, s, "begin_negotiation", "authority", at);
    s = fire(CO, s, "publish_contract", "authority", at);
    expect(isGranted(CO, s)).toBe(true);
  });

  it("a lapsed statutory clock moves to deadline_lapsed and never to granted", () => {
    let s = initialSnapshot(KE, at);
    s = fire(KE, s, "submit", "applicant", at);
    s = fire(KE, s, "acknowledge", "authority", at);
    const later = new Date(at.getTime() + 80 * 86_400_000);
    const { snap, lapsed } = tick(KE, s, later);
    expect(lapsed).toEqual(["determination"]);
    const after = applyLapse(KE, snap, "determination", later);
    expect(after.state).toBe("deadline_lapsed");
    expect(isGranted(KE, after)).toBe(false);
  });

  it("no configured transition on a lapse event reaches a granted state in any country", () => {
    for (const cfg of countries.values()) {
      for (const t of cfg.stateMachine.transitions.filter((t) => t.event === "lapse")) {
        expect(cfg.stateMachine.states[t.to].outcome).not.toBe("granted");
      }
    }
  });

  it("undeclared transitions do not exist", () => {
    const s = initialSnapshot(KE, at);
    expect(() => fire(KE, s, "grant", "authority", at)).toThrow(TransitionError);
  });
});

describe("A5.4 and R7: what the applicant holds", () => {
  const at = new Date("2027-01-10T09:00:00Z");

  it("Colombia: one contract, amended by addendum as versions of the same record", () => {
    const out = CO.outputs.find((o) => o.id === "access_contract")!;
    const inst = instrumentFrom(out, "case_x", at, "seat", "recorded_external");
    const a1 = amendInstrument(inst, "Otrosí No. 1", at, "seat");
    expect(a1.kind).toBe("versioned");
    if (a1.kind !== "versioned") return;
    const a2 = amendInstrument(a1.instrument, "Otrosí No. 2", at, "seat");
    expect(a2.kind).toBe("versioned");
    if (a2.kind !== "versioned") return;
    expect(a2.instrument.id).toBe(inst.id);
    expect(a2.instrument.versions).toHaveLength(3);
    expect(a2.instrument.versions.map((v) => v.kind)).toEqual(["original", "addendum", "addendum"]);
  });

  it("Kenya: two instruments from two issuers, and a change requires a new application", () => {
    expect(KE.outputs).toHaveLength(2);
    expect(new Set(KE.outputs.map((o) => o.issuer)).size).toBe(2);
    const inst = instrumentFrom(KE.outputs[0], "case_y", at, "seat", "recorded_external");
    const out = amendInstrument(inst, "locality changed", at, "seat");
    expect(out.kind).toBe("new_instrument_required");
  });

  it("Brazil: a declaratory receipt with verification open and no term", () => {
    const out = BR.outputs[0];
    expect(out.kind).toBe("declaratory_receipt");
    expect(out.automatic).toBe(true);
    const inst = instrumentFrom(out, "case_z", at, "seat", "recorded_external");
    expect(inst.status).toBe("verification_open");
    expect(out.term.value).toMatch(/No term/);
  });

  it("the renewal probe reads configuration: never for Brazil, scheduled for Kenya, unknown for Colombia", () => {
    expect(renewalProbeAllowed(BR).allowed).toBe(false);
    expect(renewalProbeAllowed(KE).allowed).toBe(true);
    expect(renewalProbeAllowed(CO).allowed).toBe(false);
  });
});
