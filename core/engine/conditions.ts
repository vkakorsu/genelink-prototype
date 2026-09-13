import type { CaseFacts, Condition } from "../config/schema";

/** A condition matches when every listed fact equals one of the allowed values. */
export function matches(cond: Condition | undefined, facts: CaseFacts): boolean {
  if (!cond) return true;
  for (const [field, allowed] of Object.entries(cond)) {
    const value = readFact(facts, field);
    const allowedList = Array.isArray(allowed) ? allowed : [allowed];
    if (value === undefined || !allowedList.includes(String(value))) return false;
  }
  return true;
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
