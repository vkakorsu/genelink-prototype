import { TYPED_FACTS, type CaseFacts, type CountryConfig } from "../config/schema";
import { readFact } from "./conditions";

/**
 * A country's own deciding facts start in the state their question declares as `default`,
 * which is always the "not yet established" option (Colombia's direct affectation: unclear;
 * Kenya's species status: unchecked). An implicit unknown (the fact simply missing) is what
 * let a stage disappear as if the answer had been "no". An explicit unknown keeps the stage on
 * the pathway and, where the file says so, halts it (R3). The shared facts are not touched:
 * the intake form always collects them.
 */
export function withDeclaredDefaults(cfg: CountryConfig, facts: CaseFacts): CaseFacts {
  const out: CaseFacts = { ...facts, flags: { ...facts.flags } };
  for (const q of cfg.scope.questions) {
    if (q.fact === "activity" || q.kind !== "choice" || q.default === undefined) continue;
    if (readFact(out, q.fact) !== undefined) continue;
    if ((TYPED_FACTS as readonly string[]).includes(q.fact)) (out as unknown as Record<string, unknown>)[q.fact] = q.default;
    else out.flags[q.fact] = q.default;
  }
  return out;
}
