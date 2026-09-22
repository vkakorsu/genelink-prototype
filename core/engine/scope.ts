import type { CaseFacts, CountryConfig, RegValue } from "../config/schema";
import { evaluate, unresolvedFields } from "./conditions";

/**
 * Per-country scope engine (Appendix B, A5.2). Returns one of three answers: in scope,
 * out of scope with a recorded basis, or escalate. The first matching rule wins. There is
 * no default branch: a country file must end with an unconditional rule, otherwise the
 * answer is "escalate" with the configuration itself named as the gap.
 *
 * A fourth state exists only before the parties have answered: "undetermined". Where a rule
 * that could decide the case reads a fact nobody has established yet (purpose, activity), the
 * engine does not skip that rule as if its answer were no. It says which questions stand
 * between the case and a scope answer. That is the parties' question, not a legal unknown,
 * and it is never persisted as an escalation to the country's owner.
 */
export type ScopeAnswer =
  | { kind: "in_scope"; ruleId: string; basis: RegValue }
  | { kind: "out_of_scope"; ruleId: string; basis: RegValue; redirect?: string }
  | { kind: "escalate"; ruleId: string; basis: RegValue; owner: string }
  | { kind: "undetermined"; ruleId: string; basis: RegValue; missing: string[] };

export function evaluateScope(cfg: CountryConfig, facts: CaseFacts): ScopeAnswer {
  const missing: string[] = [];
  for (const rule of cfg.scope.rules) {
    const when = evaluate(rule.when, facts);
    if (when === "no_match") continue;
    if (when === "unresolved") {
      missing.push(...unresolvedFields(rule.when, facts));
      continue;
    }
    if (rule.whenNot) {
      const not = evaluate(rule.whenNot, facts);
      if (not === "match") continue;
      if (not === "unresolved") {
        missing.push(...unresolvedFields(rule.whenNot, facts));
        continue;
      }
    }
    // An earlier rule could still fire once its fact is answered, so this one does not decide yet.
    if (missing.length) break;
    if (rule.result === "in_scope") return { kind: "in_scope", ruleId: rule.id, basis: rule.basis };
    if (rule.result === "out_of_scope") return { kind: "out_of_scope", ruleId: rule.id, basis: rule.basis, redirect: rule.redirect };
    return {
      kind: "escalate",
      ruleId: rule.id,
      basis: rule.basis,
      owner: rule.basis.owner ?? cfg.escalation.defaultOwnerRole,
    };
  }
  if (missing.length) {
    const unique = [...new Set(missing)];
    return {
      kind: "undetermined",
      ruleId: "facts_not_established",
      missing: unique,
      basis: {
        state: "unknown",
        marker: "?",
        note: `Scope cannot be answered until the parties establish: ${unique.map((f) => promptFor(cfg, f)).join("; ")}. The engine does not assume an answer.`,
        owner: "The case participants, on the intake form",
        drives: true,
        executable: true,
      },
    };
  }
  return {
    kind: "escalate",
    ruleId: "no_rule_matched",
    basis: {
      state: "unknown",
      marker: "?",
      note: "No scope rule matched these facts. The configuration has a gap. Never default.",
      owner: cfg.escalation.defaultOwnerRole,
      drives: true,
      executable: true,
    },
    owner: cfg.escalation.defaultOwnerRole,
  };
}

const SHARED_PROMPTS: Record<string, string> = {
  purpose: "Purpose (commercial or non-commercial)",
  provenance: "Material provenance",
  exchange: "Material-exchange scenario",
  applicantType: "Applicant type",
  communityHeld: "Whether a community or local manager holds the resource",
  tkInvolved: "Whether traditional knowledge is involved",
};

/** The intake prompt for a fact, so a halt names the question the parties must answer. */
export function promptFor(cfg: CountryConfig, field: string): string {
  return cfg.scope.questions.find((q) => q.fact === field)?.prompt ?? SHARED_PROMPTS[field] ?? field;
}
