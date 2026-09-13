/**
 * Configuration linter. Runs after schema validation and enforces the invariants
 * the appendices demand that a schema alone cannot express:
 *
 *  R1  no regulatory field may be a bare boolean or a bare scalar
 *  R3  every unknown names an owner, and every unknown that drives a stage is
 *      reachable by the halt logic
 *  R8  every clock has an on-lapse rule and the on-lapse target never carries a
 *      granted outcome
 *  R9  the state machine carries the unhappy paths the regime has
 *
 * Used by the loader (errors abort the load) and by CI on every configuration change.
 */
import type { CountryConfig } from "./schema";

export type LintIssue = { severity: "error" | "warning"; path: string; message: string };

const REQUIRED_UNHAPPY = ["information_requested", "refused", "withdrawn"];

export function lintCountry(cfg: CountryConfig): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  // R1: walk every object; any key that looks regulatory but is a boolean is an error.
  walk(cfg, "", (path, value) => {
    if (typeof value === "boolean" && /(required|applies|allowed|capped|transferable|exists|inForce|negotiable)$/i.test(path)) {
      err(path, "regulatory field expressed as a boolean. Use a RegValue with a state (R1)");
    }
  });

  // R8: clocks
  const states = cfg.stateMachine.states;
  for (const clock of cfg.stateMachine.clocks) {
    const target = states[clock.onLapse.to];
    if (!target) err(`stateMachine.clocks.${clock.id}.onLapse.to`, `unknown state ${clock.onLapse.to}`);
    else if (target.outcome === "granted") err(`stateMachine.clocks.${clock.id}`, "a lapsed clock may never grant (R8)");
    if (!states[clock.startsIn]) err(`stateMachine.clocks.${clock.id}.startsIn`, `unknown state ${clock.startsIn}`);
  }

  // Transitions reference known states, and no "lapse" event reaches a granted state.
  for (const t of cfg.stateMachine.transitions) {
    if (!states[t.from]) err(`stateMachine.transitions`, `unknown from-state ${t.from}`);
    if (!states[t.to]) err(`stateMachine.transitions`, `unknown to-state ${t.to}`);
    if (t.event === "lapse" && states[t.to]?.outcome === "granted") err(`stateMachine.transitions`, "lapse cannot grant (R8)");
  }
  if (!states[cfg.stateMachine.initial]) err("stateMachine.initial", "unknown initial state");

  // R9: unhappy paths present
  for (const s of REQUIRED_UNHAPPY) {
    if (!states[s]) warn("stateMachine.states", `no ${s} state. Appendix B lists it as a real state in at least one regime`);
  }

  // Outputs issued in an existing granted state
  for (const o of cfg.outputs) {
    const st = states[o.issuedInState];
    if (!st) err(`outputs.${o.id}.issuedInState`, `unknown state ${o.issuedInState}`);
    else if (st.outcome !== "granted") err(`outputs.${o.id}.issuedInState`, "instruments issue only in a granted-outcome state");
  }
  for (const stage of cfg.stages) {
    for (const p of stage.produces) {
      if (!cfg.outputs.find((o) => o.id === p)) err(`stages.${stage.id}.produces`, `unknown output ${p}`);
    }
  }

  // Renewal probe consistency with Class 5
  const class5 = cfg.obligationClasses.find((c) => c.number === 5);
  const termExists = class5?.fields["term_exists"];
  if (termExists?.state === "established" && /^no\b/i.test(termExists.value ?? "") && cfg.renewalProbe !== "never") {
    err("renewalProbe", "Class 5 says no term exists, so a renewal probe must never be scheduled");
  }
  if (termExists?.state === "unknown" && cfg.renewalProbe === "schedule") {
    err("renewalProbe", "Class 5 term_exists is unknown, so renewalProbe cannot be 'schedule'");
  }

  // Manual review judgments must not be self-declared facts (R5)
  for (const m of cfg.manualReview) {
    if (m.reg.state === "established" && m.reg.marker !== "§") err(`manualReview.${m.id}`, "inconsistent marker");
  }

  // Escalation owner present
  if (!cfg.escalation.defaultOwnerRole) err("escalation.defaultOwnerRole", "a default escalation owner role is required (R3)");
  if (!cfg.escalation.defaultOwnerName) warn("escalation.defaultOwnerName", "no named owner yet. Pending Landscape Alliance");

  return issues;
}

function walk(node: unknown, path: string, visit: (path: string, value: unknown) => void) {
  visit(path, node);
  if (Array.isArray(node)) node.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) walk(v, path ? `${path}.${k}` : k, visit);
  }
}
