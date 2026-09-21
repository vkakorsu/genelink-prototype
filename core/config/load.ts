import { readFileSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { parse } from "yaml";
import { CountryConfig } from "./schema";
import { lintCountry, lintRawForBooleans, type LintIssue } from "./lint";

export class ConfigError extends Error {
  constructor(
    public readonly file: string,
    public readonly issues: string[],
  ) {
    super(`Invalid country configuration ${file}:\n  ${issues.join("\n  ")}`);
  }
}

/**
 * Parse, validate and lint one country file. Three gates, in order:
 *  1. R1 on the raw document, so a boolean in a regulatory field is reported as that
 *     and not as a generic type error;
 *  2. the strict schema, so a key the schema does not know (a typo in `drives`, a
 *     field from an older schema version) fails the load instead of vanishing;
 *  3. the linter, for the invariants a schema cannot express.
 */
export function parseCountry(source: string, file = "<inline>"): CountryConfig {
  const raw = parse(source);
  const r1 = lintRawForBooleans(raw);
  if (r1.length) throw new ConfigError(file, r1.map((i) => `${i.path}: ${i.message}`));
  const result = CountryConfig.safeParse(raw);
  if (!result.success) {
    throw new ConfigError(
      file,
      result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  }
  const lint: LintIssue[] = lintCountry(result.data);
  const errors = lint.filter((l) => l.severity === "error");
  if (errors.length) {
    throw new ConfigError(file, errors.map((e) => `${e.path}: ${e.message}`));
  }
  return result.data;
}

export function loadCountryFile(path: string): CountryConfig {
  return parseCountry(readFileSync(path, "utf8"), basename(path));
}

export function loadCountries(dir: string): Map<string, CountryConfig> {
  const out = new Map<string, CountryConfig>();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
    const cfg = loadCountryFile(join(dir, f));
    out.set(cfg.code, cfg);
  }
  return out;
}

export function defaultCountriesDir(root = process.cwd()): string {
  return join(root, "config", "countries");
}
