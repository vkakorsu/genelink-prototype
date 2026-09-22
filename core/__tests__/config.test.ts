import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCountries, parseCountry, ConfigError } from "../config/load";
import { lintCountry } from "../config/lint";
import { CountryConfig, RegValue } from "../config/schema";
import { parse } from "yaml";
import { readFileSync } from "node:fs";

const dir = join(process.cwd(), "config", "countries");
const countries = loadCountries(dir);

describe("country configuration files", () => {
  it("loads and validates every country file (Colombia, Kenya, Brazil)", () => {
    expect(Array.from(countries.keys()).sort()).toEqual(["BR", "CO", "KE"]);
  });

  it("every file carries the eight A5 variables and nine A6 classes", () => {
    for (const cfg of countries.values()) {
      expect(Object.keys(cfg.variables)).toHaveLength(8);
      expect(cfg.obligationClasses.map((c) => c.number).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });

  it("roughly a third of regulatory values are unresolved, as Appendix B says, and each names an owner", () => {
    for (const cfg of countries.values()) {
      const values: { state: string; owner?: string }[] = [];
      const walk = (n: unknown) => {
        if (Array.isArray(n)) n.forEach(walk);
        else if (n && typeof n === "object") {
          const o = n as Record<string, unknown>;
          if ("state" in o && "marker" in o) values.push(o as { state: string; owner?: string });
          Object.values(o).forEach(walk);
        }
      };
      walk(cfg);
      const unknown = values.filter((v) => v.state === "unknown");
      expect(unknown.length).toBeGreaterThan(0);
      for (const u of unknown) expect(u.owner, `${cfg.code} unknown without owner`).toBeTruthy();
    }
  });

  it("lint passes with no errors for every country", () => {
    for (const cfg of countries.values()) {
      const errors = lintCountry(cfg).filter((i) => i.severity === "error");
      expect(errors, cfg.code).toEqual([]);
    }
  });
});

describe("R1: three-state fields, not booleans", () => {
  it("a RegValue with a marker that contradicts its state is rejected", () => {
    const r = RegValue.safeParse({ state: "established", marker: "?", value: "x" });
    expect(r.success).toBe(false);
  });

  it("an unknown without an owner is rejected (R3)", () => {
    const r = RegValue.safeParse({ state: "unknown", marker: "?", note: "open" });
    expect(r.success).toBe(false);
    const ok = RegValue.safeParse({ state: "unknown", marker: "?", note: "open", owner: "NEMA" });
    expect(ok.success).toBe(true);
  });

  it("a ⊘ value must be marked not executable", () => {
    expect(RegValue.safeParse({ state: "established", marker: "⊘", value: "s.93A" }).success).toBe(false);
    expect(RegValue.safeParse({ state: "established", marker: "⊘", value: "s.93A", executable: false }).success).toBe(true);
  });

  it("a country file with a boolean regulatory field fails to load, named as an R1 violation", () => {
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8") + "\nextraBlock:\n  renewalsCapped: false\n";
    expect(() => parseCountry(src, "kenya-with-boolean.yaml")).toThrow(/boolean.*\(R1\)/i);
  });

  it("a key the schema does not know fails the load instead of being dropped", () => {
    // A misspelt drives: on an unknown would silently disable a halt. Strict objects make it a load error.
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8") + "\nunfamiliarField: true\n";
    expect(() => parseCountry(src, "kenya-unknown-key.yaml")).toThrow(ConfigError);
  });

  it("a state machine state nothing can reach fails the lint (R9)", () => {
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8").replace(
      "    appealed:",
      "    dormant_for_no_reason: { label: Never reachable, kind: waiting }\n    appealed:",
    );
    const cfg = CountryConfig.parse(parse(src));
    const issues = lintCountry(cfg).filter((i) => i.severity === "error" && /no transition or clock reaches/.test(i.message));
    expect(issues.length).toBe(1);
  });

  it("a deciding-fact question with no 'not yet established' default fails to load (R3)", () => {
    // Without it the fact is simply missing on a fresh case, and a stage that turns on it
    // would drop off the pathway as if the answer had been "no".
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8").replace("      default: unchecked\n", "");
    expect(src).not.toMatch(/default: unchecked/);
    expect(() => parseCountry(src, "kenya-no-default.yaml")).toThrow(/must declare a default.*\(R3\)/);
  });

  it("a clock whose lapse target is a granted state fails to load (R8)", () => {
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8").replace(
      /onLapse:\n\s+to: deadline_lapsed/,
      "onLapse:\n        to: granted",
    );
    expect(() => parseCountry(src, "kenya-lapse-grants.yaml")).toThrow(ConfigError);
  });
});
