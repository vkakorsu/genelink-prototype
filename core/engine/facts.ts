import { TYPED_FACTS, type CaseFacts, type CountryConfig } from "../config/schema";
import { createHash } from "node:crypto";
import { readFact } from "./conditions";

/**
 * A short fingerprint of a case's facts. The intake form carries the one it was built from, so an
 * edit made from a page opened before someone else's save is refused instead of silently undoing it.
 */
export function factsFingerprint(facts: CaseFacts): string {
  const sorted = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)));
  const canonical = JSON.stringify({ ...sorted(facts as unknown as Record<string, unknown>), flags: sorted(facts.flags ?? {}) });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

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

/**
 * The same facts with every country-declared answer still at its "not yet established" default
 * removed. A transition guard reads these: a branch that turns on a fact nobody has established is
 * waiting on that fact, not ruled out because "not yet established" is neither of its answers.
 */
export function establishedOnly(cfg: CountryConfig, facts: CaseFacts): CaseFacts {
  const out: CaseFacts = { ...facts, flags: { ...facts.flags } };
  for (const q of cfg.scope.questions) {
    if (q.fact === "activity" || q.kind !== "choice" || q.default === undefined) continue;
    if (String(readFact(out, q.fact)) !== q.default) continue;
    if ((TYPED_FACTS as readonly string[]).includes(q.fact)) delete (out as unknown as Record<string, unknown>)[q.fact];
    else delete out.flags[q.fact];
  }
  return out;
}

/**
 * Facts from an interface are checked against the country file before anything reads them. An
 * activity or a country-declared answer that is not one of the file's options is refused: an
 * undeclared activity would match no scope rule and fall through to the unconditional one, so a
 * made-up answer would come back "in scope". Returns one sentence per problem; empty means valid.
 */
export function factProblems(cfg: CountryConfig, facts: CaseFacts): string[] {
  const problems: string[] = [];
  for (const q of cfg.scope.questions) {
    const v = readFact(facts, q.fact);
    if (v === undefined) continue;
    if (q.kind === "number") {
      const n = Number(v);
      if (!Number.isInteger(n) || (q.min !== undefined && n < q.min) || (q.max !== undefined && n > q.max)) {
        problems.push(`"${q.prompt}" must be a whole number${q.min !== undefined ? ` from ${q.min}` : ""}${q.max !== undefined ? ` to ${q.max}` : ""}.`);
      }
      continue;
    }
    if (!q.options.some((o) => o.id === String(v))) problems.push(`"${String(v).slice(0, 40)}" is not one of the answers ${cfg.name}'s file declares for "${q.prompt}".`);
  }
  const declared = new Set(cfg.scope.questions.map((q) => q.fact));
  for (const k of Object.keys(facts.flags ?? {})) {
    if (!declared.has(k)) problems.push(`"${k.slice(0, 40)}" is not a question ${cfg.name}'s file declares.`);
  }
  return problems;
}
