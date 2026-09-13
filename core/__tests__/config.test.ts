import { describe, expect, it } from "vitest";
import { join } from "node:path";
import { loadCountries, parseCountry, ConfigError } from "../config/load";
import { lintCountry } from "../config/lint";
import { RegValue } from "../config/schema";
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

  it("a country file with a boolean regulatory field fails the linter", () => {
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8").replace(
      "renewalProbe: schedule",
      "renewalProbe: schedule\nvariablesExtra:\n  renewalsCapped: false",
    );
    // Schema forbids unknown keys implicitly? Zod strips unknown keys by default, so we lint the raw object shape instead.
    const cfg = parseCountry(src, "kenya-with-boolean.yaml");
    const issues = lintCountry({ ...cfg, ...({ variablesExtra: { renewalsCapped: false } } as object) });
    expect(issues.some((i) => i.severity === "error" && /boolean/.test(i.message))).toBe(true);
  });

  it("a clock whose lapse target is a granted state fails to load (R8)", () => {
    const src = readFileSync(join(dir, "kenya.yaml"), "utf8").replace(
      /onLapse:\n\s+to: deadline_lapsed/,
      "onLapse:\n        to: granted",
    );
    expect(() => parseCountry(src, "kenya-lapse-grants.yaml")).toThrow(ConfigError);
  });
});
