import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCountries, parseCountry } from "../config/load";
import { lintCountry } from "../config/lint";
import type { CaseFacts, CountryConfig } from "../config/schema";
import { evaluateScope } from "../engine/scope";
import { buildPathway } from "../engine/pathway";
import { withDeclaredDefaults } from "../engine/facts";
import { addDays, applyLapse, eventsFor, extendClock, fire, initialSnapshot, isWorkingDay, tick, TransitionError, workingDaysBetween } from "../engine/stateMachine";
import { InMemoryStore } from "../store/memory";
import { seed, ADMIN } from "../seed/seed";
import { PermissionDenied } from "../platform";
import { verifyChain } from "../audit/chain";

/**
 * Behaviour the Appendix B diagrams and the primary texts require of each configured regime,
 * pinned after a line-by-line check of the three country files against their flow diagrams.
 */

const dir = join(process.cwd(), "config", "countries");
const countries = loadCountries(dir);
const KE = countries.get("KE")!;
const CO = countries.get("CO")!;
const BR = countries.get("BR")!;
const fresh = () => seed(new InMemoryStore(), countries);

const f = (cfg: CountryConfig, over: Partial<CaseFacts>): CaseFacts =>
  withDeclaredDefaults(cfg, { purpose: "commercial", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "no", tkInvolved: "no", flags: {}, ...over });

function walk(cfg: CountryConfig, events: [string, string][], start = new Date("2026-11-02T09:00:00Z"), facts?: CaseFacts) {
  let s = initialSnapshot(cfg, start);
  for (const [ev, actor] of events) s = fire(cfg, s, ev, actor, start, undefined, facts);
  return s;
}

describe("working-day calendars are configuration (R2)", () => {
  it("Kenya's clock skips Kenyan public holidays; Colombia's skips Colombian ones", () => {
    const mashujaa = new Date("2026-10-20T09:00:00Z");
    expect(isWorkingDay(mashujaa, KE.calendar)).toBe(false);
    expect(isWorkingDay(mashujaa, CO.calendar)).toBe(true);
    const cartagena = new Date("2026-11-16T09:00:00Z");
    expect(isWorkingDay(cartagena, CO.calendar)).toBe(false);
    expect(isWorkingDay(cartagena, KE.calendar)).toBe(true);
    // Five working days from Friday 16 Oct 2026 in Kenya: Mon 19, (Tue 20 Mashujaa), Wed 21, Thu 22, Fri 23, Mon 26.
    expect(addDays(new Date("2026-10-16T09:00:00Z"), 5, "working", KE.calendar).toISOString().slice(0, 10)).toBe("2026-10-26");
    expect(addDays(new Date("2026-10-16T09:00:00Z"), 5, "working").toISOString().slice(0, 10)).toBe("2026-10-23");
  });

  it("time left on a working-day clock is counted in working days", () => {
    const s = walk(KE, [["submit", "applicant"], ["acknowledge", "authority"]]);
    const t = tick(KE, s, new Date("2026-11-02T10:00:00Z")).snap.clocks.determination;
    expect(t.daysRemaining).toBe(30);
    expect(workingDaysBetween(new Date("2026-11-02T10:00:00Z"), new Date(t.deadline!), KE.calendar)).toBe(30);
  });
});

describe("Colombia: D391 Arts. 29 and 30 as written", () => {
  it("the 30 working days run from registration, through publication, not from the start of evaluation", () => {
    const s = walk(CO, [["submit", "applicant"], ["admit", "authority"]]);
    expect(s.clocks.evaluation.startedAt).toBeTruthy();
    const published = fire(CO, s, "publish", "authority", new Date("2026-11-05T09:00:00Z"));
    // Past the deadline while still at publication: the clock lapses there, it does not wait for evaluation to begin.
    const late = new Date(new Date(published.clocks.evaluation.deadline!).getTime() + 86_400_000);
    const { snap, lapsed } = tick(CO, published, late);
    expect(lapsed).toEqual(["evaluation"]);
    expect(applyLapse(CO, snap, "evaluation", late).state).toBe("deadline_lapsed");
  });

  it("the authority's extension of up to 60 working days is recorded, capped, and keeps a lawful extension from presenting as a lapse", () => {
    let s = walk(CO, [["submit", "applicant"], ["admit", "authority"], ["publish", "authority"], ["begin_evaluation", "authority"]]);
    const first = s.clocks.evaluation.deadline!;
    s = extendClock(CO, s, "evaluation", 40, new Date("2026-12-01T09:00:00Z"), "Resolución de prórroga (fictional)");
    expect(s.clocks.evaluation.extendedDays).toBe(40);
    expect(workingDaysBetween(new Date(first), new Date(s.clocks.evaluation.deadline!), CO.calendar)).toBe(40);
    expect(s.history.at(-1)!.event).toBe("extend_clock");
    // One day past the original deadline is inside the extension: no lapse.
    expect(tick(CO, s, new Date(new Date(first).getTime() + 86_400_000)).lapsed).toEqual([]);
    // The cap is the file's, in total.
    expect(() => extendClock(CO, s, "evaluation", 21, new Date(), "more")).toThrow(/at most 60/);
    s = extendClock(CO, s, "evaluation", 20, new Date(), "second resolution");
    expect(s.clocks.evaluation.extendedDays).toBe(60);
    // Kenya's file grants no extension power, so none can be recorded.
    const ke = walk(KE, [["submit", "applicant"], ["acknowledge", "authority"]]);
    expect(() => extendClock(KE, ke, "determination", 5, new Date(), "x")).toThrow(/no extension power/);
  });

  it("a late acceptance notice lapses to its own state: the acceptance stands, nothing is granted, and nothing crashes", () => {
    const s = walk(CO, [["submit", "applicant"], ["admit", "authority"], ["publish", "authority"], ["begin_evaluation", "authority"], ["accept", "authority"]]);
    const late = new Date("2026-12-15T09:00:00Z");
    const { snap, lapsed } = tick(CO, s, late);
    expect(lapsed).toEqual(["acceptance_notice"]);
    const after = applyLapse(CO, snap, "acceptance_notice", late);
    expect(after.state).toBe("notification_overdue");
    expect(CO.stateMachine.states.notification_overdue.outcome).toBe("lapsed");
    // The notice, when it comes, opens the negotiation. Acceptance is still not a contract.
    expect(fire(CO, after, "begin_negotiation", "authority", late).state).toBe("negotiating");
  });

  it("the platform records the authority's extension only from the administrator seat, on the audit chain", () => {
    const p = fresh();
    const camila = p.actorFor("seat_camila_ibp");
    // Walk a new Colombian case to evaluation.
    p.signalInterest(p.actorFor("seat_amara_meridian"), "lst_co_emulsifier");
    const { caseId } = p.reciprocate(camila, "lst_co_emulsifier", "org_meridian");
    p.updateFacts(camila, caseId, { purpose: "commercial", activity: "listed_activity", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "no", tkInvolved: "no", directAffectation: "no", flags: { colombiaOrigin: "yes" } });
    p.fireEvent(camila, caseId, "submit");
    for (const ev of ["admit", "publish", "begin_evaluation"]) p.fireEvent(ADMIN, caseId, ev);
    expect(() => p.extendClock(camila, caseId, "evaluation", 10, "we would like more time")).toThrow(PermissionDenied);
    p.extendClock(ADMIN, caseId, "evaluation", 10, "Resolución de prórroga (fictional)");
    expect(p.store.cases.get(caseId)!.machine.clocks.evaluation.extendedDays).toBe(10);
    expect(p.store.audit.list().some((e) => e.action === "clock.extended" && e.subject.id === caseId)).toBe(true);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });

  it("Art. 6: Colombia not being the country of origin is out of scope with its basis; not yet established holds the application", () => {
    const no = buildPathway(CO, f(CO, { activity: "listed_activity", flags: { colombiaOrigin: "no" } }));
    expect(no.scope.kind).toBe("out_of_scope");
    expect(no.scope.basis.citation).toMatch(/Art\. 6/);
    const unclear = buildPathway(CO, f(CO, { activity: "listed_activity" }));
    expect(unclear.scope.kind).toBe("in_scope");
    const app = unclear.stages.find((s) => s.stage.id === "application_data")!;
    expect(app.status).toBe("halted");
    expect(app.escalations[0].kind).toBe("unanswered_fact");
  });
});

describe("suspension stops the clock; resumption moves the deadline (Kenya reg. 14(3), Brazil Art. 28)", () => {
  it("time spent answering a request does not count against the authority's 30 working days", () => {
    const t0 = new Date("2026-11-02T09:00:00Z");
    let s = walk(KE, [["submit", "applicant"], ["acknowledge", "authority"]], t0);
    const original = new Date(s.clocks.determination.deadline!);
    s = fire(KE, s, "request_information", "authority", new Date("2026-11-09T09:00:00Z"));
    expect(s.clocks.determination.suspended).toBe(true);
    // Two weeks later the applicant answers and the authority acknowledges receipt.
    s = fire(KE, s, "resubmit", "applicant", new Date("2026-11-20T09:00:00Z"));
    expect(s.clocks.determination.suspended).toBe(true);
    s = fire(KE, s, "acknowledge", "authority", new Date("2026-11-23T09:00:00Z"));
    expect(s.clocks.determination.suspended).toBe(false);
    const moved = new Date(s.clocks.determination.deadline!);
    expect(workingDaysBetween(original, moved, KE.calendar)).toBe(workingDaysBetween(new Date("2026-11-09T09:00:00Z"), new Date("2026-11-23T09:00:00Z"), KE.calendar));
    // So a check one day past the original deadline is not a lapse.
    expect(tick(KE, s, new Date(original.getTime() + 86_400_000)).lapsed).toEqual([]);
  });

  it("the determination clock keeps running through public notice and can lapse there", () => {
    const s = walk(KE, [["submit", "applicant"], ["acknowledge", "authority"], ["publish", "authority"]]);
    const late = new Date(new Date(s.clocks.determination.deadline!).getTime() + 86_400_000);
    const { snap, lapsed } = tick(KE, s, late);
    expect(lapsed).toEqual(["determination"]);
    expect(applyLapse(KE, snap, "determination", late).state).toBe("deadline_lapsed");
  });
});

describe("Kenya reg. 11(4)(e): a listed species stops the pathway; an unchecked one holds it", () => {
  it("a listed species stops the eligibility stage, and nothing on or after it can be completed", () => {
    const pw = buildPathway(KE, f(KE, { activity: "collection_research", speciesListed: "listed", localities: 1 }));
    const elig = pw.stages.find((s) => s.stage.id === "eligibility")!;
    expect(elig.status).toBe("stopped");
    expect(elig.stops[0].reg.citation).toBe("reg. 11(4)(e)");
    expect(pw.stoppedStageIds).toEqual(["eligibility"]);
    // A stop is established law, not an escalation for anyone to answer.
    expect(pw.escalations.some((e) => e.stageId === "eligibility")).toBe(false);
  });

  it("an unchecked species holds the stage on the species-status check, and is never raised to the legal owner", () => {
    const pw = buildPathway(KE, f(KE, { activity: "collection_research", localities: 1 }));
    const elig = pw.stages.find((s) => s.stage.id === "eligibility")!;
    expect(elig.status).toBe("halted");
    const hold = elig.escalations.find((e) => e.requirementId === "species_status_source")!;
    expect(hold.kind).toBe("unanswered_fact");
    expect(hold.owner).toMatch(/species-status/);
  });

  it("the platform refuses to complete a stopped stage or anything after it", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const ines = p.actorFor("seat_ines_nordlicht");
    p.updateFacts(ines, ke.id, { ...ke.facts, speciesListed: "listed" });
    expect(() => p.markStage(ines, ke.id, "eligibility", "complete")).toThrow(/prohibition applies/);
    expect(() => p.markStage(ines, ke.id, "submission", "complete")).toThrow(/stopped or halted/);
  });

  it("PIC is not only a community question: the resource providers NEMA identifies are a consent party on every case (reg. 11(4)(b), 12(1))", () => {
    const pw = buildPathway(KE, f(KE, { activity: "collection_research", speciesListed: "not_listed", localities: 1, communityHeld: "no" }));
    const consent = pw.stages.find((s) => s.stage.id === "consent_and_terms")!;
    expect(consent.consentParties.map((c) => c.id)).toContain("resource_providers");
    expect(consent.consentParties.map((c) => c.id)).not.toContain("community");
    expect(consent.documents.map((d) => d.id)).toContain("pic_providers");
  });

  it("the export chain carries every box the diagram draws", () => {
    const pw = buildPathway(KE, f(KE, { activity: "collection_research", speciesListed: "not_listed", localities: 1, exchange: "title_transfer" }));
    const ids = pw.stages.find((s) => s.stage.id === "export")!.requirements.map((r) => r.id);
    for (const id of ["sixth_schedule", "holotype", "border_declaration", "kws_export", "phytosanitary"]) expect(ids).toContain(id);
  });
});

describe("Brazil: the Art. 27 branch is the parties' fact, never the engine's pick", () => {
  it("with the site not yet established the filing is held and neither branch is offered", () => {
    const facts = f(BR, { activity: "research_development" });
    expect(eventsFor(BR, "preparing", facts).filter((o) => o.transition.event === "complete_form")).toEqual([]);
    expect(() => fire(BR, initialSnapshot(BR, new Date()), "complete_form", "system", new Date(), undefined, facts)).toThrow(TransitionError);
    const reg = buildPathway(BR, facts).stages.find((s) => s.stage.id === "registration")!;
    expect(reg.status).toBe("halted");
  });

  it("an Art. 27 area moves the cadastro to awaiting assent; anywhere else issues the receipt at once", () => {
    const at = new Date();
    const yes = fire(BR, initialSnapshot(BR, at), "complete_form", "system", at, undefined, f(BR, { activity: "research_development", flags: { art27Area: "yes" } }));
    expect(yes.state).toBe("awaiting_assent");
    expect(yes.clocks.art28_assent.startedAt).toBeTruthy();
    const no = fire(BR, initialSnapshot(BR, at), "complete_form", "system", at, undefined, f(BR, { activity: "research_development", flags: { art27Area: "no" } }));
    expect(no.state).toBe("receipt_issued");
  });

  it("Lei Art. 9 §3 stays on the pathway when no traditional knowledge is claimed", () => {
    const pw = buildPathway(BR, f(BR, { activity: "research_development", tkInvolved: "no", flags: { art27Area: "no" } }));
    expect(pw.stages.map((s) => s.stage.id)).not.toContain("traditional_knowledge");
    expect(pw.stages.flatMap((s) => s.requirements.map((r) => r.id))).toContain("traditional_varieties_own_rule");
  });

  it("database extraction is decided on whether it is part of R&D, as the diagram draws it", () => {
    expect(evaluateScope(BR, f(BR, { activity: "database_extraction_outside_rd" })).kind).toBe("out_of_scope");
    expect(evaluateScope(BR, f(BR, { activity: "database_extraction_in_rd" })).kind).toBe("in_scope");
    expect(evaluateScope(BR, f(BR, { activity: "database_reading" })).kind).toBe("out_of_scope");
  });
});

describe("a case opened from a match carries no guessed facts (R3)", () => {
  it("scope is undetermined until purpose and activity are answered, and the export stage halts rather than vanishing", () => {
    const p = fresh();
    p.signalInterest(p.actorFor("seat_amara_meridian"), "lst_co_emulsifier");
    const camila = p.actorFor("seat_camila_ibp");
    const { caseId } = p.reciprocate(camila, "lst_co_emulsifier", "org_meridian");
    const c = p.store.cases.get(caseId)!;
    expect(c.facts.purpose).toBeUndefined();
    expect(c.facts.activity).toBeUndefined();
    expect(c.facts.exchange).toBeUndefined();
    // Meridian is registered in the Netherlands: a foreign legal person in Colombia. The platform holds that fact.
    expect(c.facts.applicantType).toBe("foreign_legal");
    const pw = p.pathwayFor(c);
    expect(pw.scope.kind).toBe("undetermined");
    if (pw.scope.kind === "undetermined") expect(pw.scope.missing).toEqual(expect.arrayContaining(["purpose", "activity"]));
    const exp = pw.stages.find((s) => s.stage.id === "export")!;
    expect(exp.status).toBe("halted");
    expect(exp.escalations[0].requirementId).toBe("fact:exchange");
    // Nothing is persisted to the country's legal owner for the parties' own questions.
    expect(p.escalationsFor(caseId).filter((e) => e.stageId === "intake")).toEqual([]);
    // Answering for the first time is not a change of intent.
    expect(() => p.updateFacts(camila, caseId, { ...c.facts, purpose: "commercial", activity: "listed_activity", provenance: "in_situ", exchange: "no_movement" })).not.toThrow();
    expect(p.pathwayFor(p.store.cases.get(caseId)!).scope.kind).toBe("in_scope");
  });
});

describe("a condition inside a stage that reads an unanswered fact halts the stage (issues: requirement-level defence)", () => {
  it("a requirement is never dropped as if its fact were answered no", () => {
    const cfg: CountryConfig = structuredClone(KE);
    const stage = cfg.stages.find((s) => s.id === "localities")!;
    stage.requirements.push({ id: "synthetic", text: "Applies only to exports.", when: { exchange: "title_transfer" }, reg: { state: "established", marker: "§", value: "synthetic", drives: false, executable: true } });
    const facts: CaseFacts = { purpose: "commercial", activity: "collection_research", provenance: "in_situ", applicantType: "foreign_legal", communityHeld: "no", tkInvolved: "no", speciesListed: "not_listed", localities: 1, flags: {} };
    const loc = buildPathway(cfg, facts).stages.find((s) => s.stage.id === "localities")!;
    expect(loc.status).toBe("halted");
    expect(loc.escalations.map((e) => e.requirementId)).toContain("fact:exchange");
    const answered = buildPathway(cfg, { ...facts, exchange: "no_movement" }).stages.find((s) => s.stage.id === "localities")!;
    expect(answered.status).toBe("active");
  });
});

describe("escalation records follow the pathway: closed with a reason, reopened if raised again", () => {
  it("a Kenya escalation closes when the facts stop reaching it and reopens when they reach it again", () => {
    const p = fresh();
    const ke = p.store.cases.list().find((c) => c.providerCountry === "KE" && c.participants.some((x) => x.organisationId === "org_nordlicht"))!;
    const ines = p.actorFor("seat_ines_nordlicht");
    const tk = () => p.escalationsFor(ke.id).find((e) => e.stageId === "tk_statute")!;
    expect(tk().status).toBe("open");
    p.updateFacts(ines, ke.id, { ...ke.facts, tkInvolved: "no" });
    expect(tk().status).toBe("closed");
    expect(tk().answer?.note).toMatch(/remains open in the configuration/);
    p.updateFacts(ines, ke.id, { ...p.store.cases.get(ke.id)!.facts, tkInvolved: "yes" });
    expect(tk().status).toBe("open");
    expect(p.store.audit.list().some((e) => e.action === "escalation.reopened")).toBe(true);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });
});

describe("the linter refuses the defects found in review", () => {
  const read = (file: string) => readFileSync(join(dir, file), "utf8");

  it("a clock that runs in a state with no declared lapse transition fails to load (the Colombia acceptance-notice defect)", () => {
    const src = read("colombia.yaml").replace("    - { from: accepted, to: notification_overdue, event: lapse, actor: system }\n", "");
    expect(() => parseCountry(src, "colombia-no-notice-lapse.yaml")).toThrow(/no lapse transition from accepted/);
  });

  it("an extension power without the rule that grants it fails to load (R4)", () => {
    const src = read("colombia.yaml").replace(/\n\s+extension: \{[^\n]*\}/, "");
    expect(() => parseCountry(src, "colombia-no-extension-rule.yaml")).toThrow(/extension power must carry the rule/);
  });

  it("a condition on a number fact fails to load", () => {
    const src = read("kenya.yaml").replace("    when: { activity: [collection_research, ex_situ_held] }\n    trig: The resource has one or more", "    when: { localities: \"2\" }\n    trig: The resource has one or more");
    expect(() => parseCountry(src, "kenya-number-condition.yaml")).toThrow(/number fact "localities"/);
  });

  it("an unconditional stop, or a stop resting on anything but established law, fails the lint", () => {
    const cfg: CountryConfig = structuredClone(KE);
    const req = cfg.stages.find((s) => s.id === "eligibility")!.requirements.find((r) => r.id === "endemic_rare_threatened_stop")!;
    delete req.when;
    expect(lintCountry(cfg).some((i) => i.severity === "error" && /unconditional stop/.test(i.message))).toBe(true);
    const cfg2: CountryConfig = structuredClone(KE);
    const req2 = cfg2.stages.find((s) => s.id === "eligibility")!.requirements.find((r) => r.id === "endemic_rare_threatened_stop")!;
    req2.reg = { state: "inferred", marker: "▸", value: "a reading", drives: false, executable: true };
    expect(lintCountry(cfg2).some((i) => i.severity === "error" && /a stop is an established prohibition/.test(i.message))).toBe(true);
  });
});

describe("the party seat cannot fire a guarded authority branch on a guess", () => {
  it("the Brazil dry-run case records its receipt only because its file says the site is outside Art. 27 areas", () => {
    const p = fresh();
    const br = p.store.cases.list().find((c) => c.providerCountry === "BR")!;
    expect(br.facts.flags.art27Area).toBe("no");
    expect(br.machine.state).toBe("receipt_issued");
  });
});
