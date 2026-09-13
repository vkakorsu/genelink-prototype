import type { CaseFacts, CountryConfig, RegValue } from "../config/schema";
import { matches } from "./conditions";

/**
 * Per-country scope engine (Appendix B, A5.2). Returns exactly one of three
 * answers: in scope, out of scope with a recorded basis, or escalate.
 * The first matching rule wins. There is no default branch: a country file must
 * end with an unconditional rule, otherwise the answer is "escalate" with the
 * configuration itself named as the gap.
 */
export type ScopeAnswer =
  | { kind: "in_scope"; ruleId: string; basis: RegValue }
  | { kind: "out_of_scope"; ruleId: string; basis: RegValue; redirect?: string }
  | { kind: "escalate"; ruleId: string; basis: RegValue; owner: string };

export function evaluateScope(cfg: CountryConfig, facts: CaseFacts): ScopeAnswer {
  for (const rule of cfg.scope.rules) {
    if (!matches(rule.when, facts)) continue;
    if (rule.whenNot && matches(rule.whenNot, facts)) continue;
    if (rule.result === "in_scope") return { kind: "in_scope", ruleId: rule.id, basis: rule.basis };
    if (rule.result === "out_of_scope") return { kind: "out_of_scope", ruleId: rule.id, basis: rule.basis, redirect: rule.redirect };
    return {
      kind: "escalate",
      ruleId: rule.id,
      basis: rule.basis,
      owner: rule.basis.owner ?? cfg.escalation.defaultOwnerRole,
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
