/**
 * Configuration linter for CI. Validates every country file against the schema
 * and the invariants in core/config/lint.ts. Exits non-zero on any error.
 *
 *   npm run lint:config
 */
import { join } from "node:path";
import { readdirSync } from "node:fs";
import { loadCountryFile, ConfigError } from "../core/config/load";
import { lintCountry } from "../core/config/lint";

const dir = join(process.cwd(), "config", "countries");
let failed = false;
for (const f of readdirSync(dir).filter((f) => f.endsWith(".yaml")).sort()) {
  try {
    const cfg = loadCountryFile(join(dir, f));
    const issues = lintCountry(cfg);
    const warnings = issues.filter((i) => i.severity === "warning");
    console.log(`${f}: ok (${cfg.name}, ${cfg.stages.length} stages, ${Object.keys(cfg.stateMachine.states).length} states, ${warnings.length} warning${warnings.length === 1 ? "" : "s"})`);
    for (const w of warnings) console.log(`   warning ${w.path}: ${w.message}`);
  } catch (e) {
    failed = true;
    if (e instanceof ConfigError) {
      console.error(`${f}: FAILED`);
      for (const i of e.issues) console.error(`   ${i}`);
    } else {
      console.error(`${f}: FAILED`, e);
    }
  }
}
process.exit(failed ? 1 : 0);
