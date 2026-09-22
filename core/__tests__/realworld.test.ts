import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCountries } from "../config/load";
import type { CaseFacts } from "../config/schema";
import { InMemoryStore } from "../store/memory";
import { seed, ADMIN } from "../seed/seed";
import { InvalidRequest, PermissionDenied, type Platform } from "../platform";
import { buildPathway } from "../engine/pathway";
import { evaluateScope } from "../engine/scope";
import { withDeclaredDefaults } from "../engine/facts";
import { canonicalAgreementText } from "../domain/agreements";
import { verifyChain } from "../audit/chain";
import { safeLocalPath } from "../../lib/safePath";
import { redactIdentifiers } from "../../lib/redact";
import { signNotice, verifiedNotice } from "../../lib/notice";

/**
 * Defects found by using the prototype as real people would, several at once and some of them
 * hostile, on a production build. Each is pinned so it cannot come back.
 */

const countries = loadCountries(join(process.cwd(), "config", "countries"));
const fresh = () => seed(new InMemoryStore(), countries);

function newColombiaCase(p: Platform) {
  const camila = p.actorFor("seat_camila_ibp");
  p.signalInterest(p.actorFor("seat_amara_meridian"), "lst_co_emulsifier");
  const { caseId } = p.reciprocate(camila, "lst_co_emulsifier", "org_meridian");
  return { camila, amara: p.actorFor("seat_amara_meridian"), caseId };
}
const coFacts = (over: Partial<CaseFacts> = {}): CaseFacts => ({
  purpose: "commercial", activity: "listed_activity", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement",
  communityHeld: "no", tkInvolved: "no", directAffectation: "no", flags: { colombiaOrigin: "yes" }, ...over,
});

describe("requests from outside cannot steer the platform", () => {
  it("a sign-in redirect stays on this site, however the target is written", () => {
    expect(safeLocalPath("/cases/case_1_ke?x=1#a")).toBe("/cases/case_1_ke?x=1#a");
    for (const bad of ["//evil.example", "/\\evil.example", "/\t/evil.example", "https://evil.example", "/..//evil.example", "javascript:alert(1)", "", undefined, 42]) {
      expect(safeLocalPath(bad), String(bad)).toBe("/");
    }
  });

  it("an error message shows only if the server signed it; crafted text in a link is not shown", () => {
    const msg = "That organisation has not signalled interest in this listing.";
    expect(verifiedNotice(msg, signNotice(msg))).toBe(msg);
    expect(verifiedNotice("Your verification expired. Email your password to support@evil.example", "x".repeat(32))).toBeNull();
    expect(verifiedNotice(msg + " Email your password.", signNotice(msg))).toBeNull();
    expect(verifiedNotice(msg, undefined)).toBeNull();
  });

  it("identifying content is removed whole, and dates, amounts and citations are left alone", () => {
    for (const s of ["+31 6 1234 5678", "+57 (602) 555 1234", "0044 20 7946 0958", "wa.me/254712345678", "t.me/amara", "linkedin.com/in/someone"]) {
      expect(redactIdentifiers(`reach me: ${s}`).text, s).toMatch(/^reach me: \[(phone|url) removed\]$/);
    }
    for (const s of ["dated 2026-09-22 and 22/09/2026", "2026-2028 programme", "KSh 1,000,000 per locality", "Budget 1 200 000 KSh", "Reg. 11(4) and Art. 29 within 30 days"]) {
      expect(redactIdentifiers(s).redactions, s).toBe(0);
    }
  });
});

describe("the intake accepts only what the country file declares", () => {
  it("a made-up activity is refused instead of falling through to 'in scope'", () => {
    const p = fresh();
    const { camila, caseId } = newColombiaCase(p);
    expect(() => p.updateFacts(camila, caseId, coFacts({ activity: "anything_i_like" }))).toThrow(InvalidRequest);
    expect(() => p.updateFacts(camila, caseId, coFacts({ flags: { colombiaOrigin: "definitely" } }))).toThrow(/not one of the answers/);
    expect(() => p.updateFacts(camila, caseId, coFacts({ flags: { colombiaOrigin: "yes", injected: "x" } }))).toThrow(/not a question/);
    expect(evaluateScope(p.country("CO"), p.store.cases.get(caseId)!.facts).kind).toBe("undetermined");
  });

  it("a scope nobody has settled holds the intake stage, and no filing is recorded on it", () => {
    const p = fresh();
    const { camila, caseId } = newColombiaCase(p);
    const pw = p.pathwayFor(p.store.cases.get(caseId)!);
    expect(pw.stages.find((s) => s.stage.id === "intake")!.status).toBe("halted");
    expect(() => p.fireEvent(camila, caseId, "submit")).toThrow(/needs a scope answer first/);
    expect(p.store.cases.get(caseId)!.machine.state).toBe("preparing");
    // Withdrawing is always the parties' right.
    expect(() => p.fireEvent(camila, caseId, "withdraw")).not.toThrow();
  });

  it("Kenya: plant genetic resources for food and agriculture are not run through LN 68", () => {
    const KE = countries.get("KE")!;
    const base: CaseFacts = { purpose: "commercial", activity: "ex_situ_held", provenance: "ex_situ", applicantType: "foreign_legal", exchange: "no_movement", communityHeld: "yes", tkInvolved: "yes", speciesListed: "not_listed", localities: 1, flags: {} };
    expect(evaluateScope(KE, { ...base, flags: { pgrfaMaterial: "yes" } }).kind).toBe("escalate");
    const unclear = buildPathway(KE, withDeclaredDefaults(KE, base));
    expect(unclear.stages.find((s) => s.stage.id === "eligibility")!.escalations.some((e) => e.requirementId === "pgrfa_outstanding")).toBe(true);
    expect(evaluateScope(KE, { ...base, flags: { pgrfaMaterial: "no" } }).kind).toBe("in_scope");
  });
});

describe("each side records its own acts, and a stage is complete when the record says so", () => {
  it("the administrator records the authority's acts, never a party's filing", () => {
    const p = fresh();
    const { camila, caseId } = newColombiaCase(p);
    p.updateFacts(camila, caseId, coFacts());
    expect(() => p.fireEvent(ADMIN, caseId, "submit")).toThrow(/applicant's own act/);
    p.fireEvent(camila, caseId, "submit");
    expect(() => p.fireEvent(camila, caseId, "admit")).toThrow(/belongs to the authority/);
    p.fireEvent(ADMIN, caseId, "admit");
    expect(p.store.cases.get(caseId)!.machine.state).toBe("admitted");
  });

  it("the regulator's stage cannot be marked complete before the proceeding ends, nor a stage that ends in an instrument before it is recorded", () => {
    const p = fresh();
    const { camila, caseId } = newColombiaCase(p);
    p.updateFacts(camila, caseId, coFacts());
    for (const s of ["intake", "application_data"]) p.markStage(camila, caseId, s, "complete");
    expect(() => p.markStage(camila, caseId, "access_proceeding", "complete")).toThrow(/regulator's own process/);
    p.fireEvent(camila, caseId, "submit");
    for (const ev of ["admit", "publish", "begin_evaluation", "accept", "begin_negotiation", "publish_contract"]) p.fireEvent(ADMIN, caseId, ev);
    expect(() => p.markStage(camila, caseId, "access_proceeding", "complete")).not.toThrow();
    expect(() => p.markStage(camila, caseId, "contract_negotiation", "complete")).toThrow(/once an authorised signatory has recorded/);
    p.recordExternalInstrument(camila, caseId, "access_contract", "contrato.pdf", "Contrato de acceso (fictional)");
    expect(() => p.markStage(camila, caseId, "contract_negotiation", "complete")).not.toThrow();
  });

  it("an applicant can withdraw while information is requested, in every configured country", () => {
    for (const cfg of countries.values()) {
      const pending = cfg.stateMachine.transitions.filter((t) => t.event === "request_information").map((t) => t.to);
      for (const s of pending) expect(cfg.stateMachine.transitions.some((t) => t.from === s && t.event === "withdraw"), `${cfg.code} ${s}`).toBe(true);
    }
  });
});

describe("an agreement is one text, signed by both", () => {
  it("once a party has signed, the text cannot be revised; execution needs approval of the same version", () => {
    const p = fresh();
    const co = p.store.cases.list().find((c) => c.id === "case_2_co")!;
    const camila = p.actorFor("seat_camila_ibp");
    const ines = p.actorFor("seat_ines_nordlicht");
    const tobias = p.actorFor("seat_tobias_nordlicht");
    const a = p.createAgreement(camila, co.id, "Terms", [{ id: "c1", title: "Parties", text: "Illustrative.", source: "illustrative" }]);
    p.approveAgreement(camila, co.id, a.id);
    p.approveAgreement(ines, co.id, a.id);
    p.executeAgreement(camila, co.id, a.id);
    expect(() => p.reviseAgreement(tobias, co.id, a.id, "change after a signature", [{ id: "c1", title: "Parties", text: "Changed.", source: "negotiated" }])).toThrow(/already signed v1/);
    const done = p.executeAgreement(ines, co.id, a.id);
    expect(done.status).toBe("executed");
    expect(new Set(done.executions.map((e) => e.sha256)).size).toBe(1);
  });

  it("the exact text a party downloads verifies, whatever line endings it comes back with", () => {
    const p = fresh();
    const a = p.agreementsFor("case_2_co").find((x) => x.status === "executed")!;
    const v = a.versions.at(-1)!;
    const text = canonicalAgreementText(v.version, v.clauses);
    expect(p.verifyContent(text).matches.some((m) => m.id === a.id)).toBe(true);
    expect(p.verifyContent(text.replace(/\n/g, "\r\n")).matches.some((m) => m.id === a.id)).toBe(true);
    expect(p.verifyContent(text + " ").matches).toEqual([]);
  });

  it("an addendum carries the hash of its signed document when one is supplied, and says so when not", () => {
    const p = fresh();
    const camila = p.actorFor("seat_camila_ibp");
    const inst = p.instrumentsFor("case_2_co").find((i) => i.outputId === "access_contract")!;
    const doc = "Otrosí No. 2 (fictional).\r\nSe modifica el plazo.";
    const out = p.amendInstrument(camila, "case_2_co", inst.id, "Otrosí No. 2", doc);
    expect(out.kind === "versioned" && out.version.hashes).toBe("document");
    expect(p.verifyContent("Otrosí No. 2 (fictional).\nSe modifica el plazo.").matches.some((m) => m.id === inst.id)).toBe(true);
    const bare = p.amendInstrument(camila, "case_2_co", inst.id, "Otrosí No. 3");
    expect(bare.kind === "versioned" && bare.version.hashes).toBe("summary");
  });
});

describe("the verification gate: anonymous until the match, and the match opens itself", () => {
  it("names nobody before the reveal, requires a reason, and opens the waiting case on verification", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    try {
      p.reciprocate(ines, "lst_need_preservative", "org_olkalou");
      throw new Error("expected the gate to hold");
    } catch (e) {
      expect(e).toBeInstanceOf(PermissionDenied);
      expect((e as Error).message).toMatch(/community custodian, KE/);
      expect((e as Error).message).not.toMatch(/Ol Kalou/);
    }
    expect(() => p.decideVerification(ADMIN, "org_olkalou", "verified", "   ")).toThrow(/needs a reason/);
    const before = p.store.cases.list().length;
    p.decideVerification(ADMIN, "org_olkalou", "verified", "Vouched by LBNPI (fictional)");
    const opened = p.store.cases.list().slice(before);
    expect(opened).toHaveLength(1);
    expect(opened[0].participants).toEqual([{ organisationId: "org_nordlicht", role: "demand" }, { organisationId: "org_olkalou", role: "supply" }]);
    expect(() => p.decideVerification(ADMIN, "org_olkalou", "declined", "second decision")).toThrow(/no pending verification request/);
    expect(verifyChain(p.store.audit.list()).ok).toBe(true);
  });
});

describe("what the platform keeps from a visit", () => {
  it("a declared objective is kept as a demand signal about an organisation, never a person", () => {
    const p = fresh();
    const s = p.recordDemandSignal(p.actorFor("seat_amara_meridian"), { want: "source_from_south", have: "Budget for two partnerships", redactions: 0 });
    expect(s).toMatchObject({ want: "source_from_south", organisationKind: "broker", organisationCountry: "NL" });
    expect(JSON.stringify(s)).not.toMatch(/amara|seat_|p_amara/i);
    expect(p.recordDemandSignal(null, { want: "learn", have: "", redactions: 0 }).organisationKind).toBeNull();
  });

  it("self-registration is bounded on a public instance", () => {
    const p = fresh();
    for (let i = 0; i < 200; i++) p.registerOrganisation({ personName: `P${i}`, orgName: `O${i}`, kind: "company", country: "DE", method: "manual_vetting", functions: ["seeking"] });
    expect(() => p.registerOrganisation({ personName: "x", orgName: "y", kind: "company", country: "DE", method: "manual_vetting", functions: ["seeking"] })).toThrow(/paused/);
  });
});

describe("new facts that block a step undo its completion, and a prohibition stops filing", () => {
  it("a species check that comes back listed reopens eligibility and refuses the filing", () => {
    const p = fresh();
    const ines = p.actorFor("seat_ines_nordlicht");
    const ke = p.store.cases.get("case_1_ke")!;
    expect(ke.stageProgress.eligibility).toBe("complete");
    p.updateFacts(ines, ke.id, { ...ke.facts, speciesListed: "listed" });
    expect(p.store.cases.get(ke.id)!.stageProgress.eligibility).toBe("in_progress");
    expect(p.store.audit.list().some((e) => e.action === "stage.reopened" && (e.detail as { stageId?: string }).stageId === "eligibility")).toBe(true);
    expect(() => p.fireEvent(ines, ke.id, "submit")).toThrow(/prohibition applies/);
    expect(() => p.fireEvent(ines, ke.id, "withdraw")).not.toThrow();
  });
});
