import type { CaseFacts, Condition } from "../config/schema";

/**
 * Three answers, not two. A condition that names a fact nobody has answered yet is not
 * "false": it is undecided, and a stage that hangs on it must stay on the pathway and halt
 * (R3) rather than vanish as if the answer had been "no".
 */
export type ConditionAnswer = "match" | "no_match" | "unresolved";

export function evaluate(cond: Condition | undefined, facts: CaseFacts): ConditionAnswer {
  if (!cond) return "match";
  let unresolved = false;
  for (const [field, allowed] of Object.entries(cond)) {
    const value = readFact(facts, field);
    if (value === undefined) {
      unresolved = true;
      continue;
    }
    const allowedList = Array.isArray(allowed) ? allowed : [allowed];
    if (!allowedList.includes(String(value))) return "no_match";
  }
  return unresolved ? "unresolved" : "match";
}

/** A condition matches only when every listed fact is answered and equals one of the allowed values. */
export function matches(cond: Condition | undefined, facts: CaseFacts): boolean {
  return evaluate(cond, facts) === "match";
}

/** The facts a condition reads that have no answer yet. */
export function unresolvedFields(cond: Condition | undefined, facts: CaseFacts): string[] {
  if (!cond) return [];
  return Object.keys(cond).filter((field) => readFact(facts, field) === undefined);
}

export function readFact(facts: CaseFacts, field: string): string | number | undefined {
  if (field in facts) {
    const v = (facts as unknown as Record<string, unknown>)[field];
    if (v === undefined || v === null) return undefined;
    if (typeof v === "object") return undefined;
    return v as string | number;
  }
  return facts.flags?.[field];
}
