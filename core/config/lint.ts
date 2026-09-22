/**
 * Configuration linter. Runs after schema validation and enforces the invariants
 * the appendices demand that a schema alone cannot express:
 *
 *  R1  no regulatory field may be a bare boolean or a bare scalar
 *  R3  every unknown names an owner, and every unknown that drives a stage is
 *      reachable by the halt logic; every deciding-fact question declares the
 *      option that means "not yet established" as its default
 *  R5  every manual-review judgment names the stage it halts, and that stage exists
 *  R8  every clock has an on-lapse rule, the on-lapse target never carries a
 *      granted outcome, and every state the clock runs in declares the lapse
 *      transition (a clock that can run out where no lapse is declared would
 *      throw at the moment the deadline passes)
 *  R9  the state machine carries the unhappy paths the regime has, and every
 *      declared state is reachable (a state nobody can enter is a typo or a decoration)
 *
 * Used by the loader (errors abort the load) and by CI on every configuration change.
 */
import { SHARED_FACTS, TYPED_FACTS, type CountryConfig } from "./schema";

export type LintIssue = { severity: "error" | "warning"; path: string; message: string };

const REGULATORY_KEY = /(required|applies|allowed|capped|transferable|exists|inForce|negotiable)$/i;

/**
 * R1 on the raw document, before the schema strips or rejects anything: a boolean at a
 * key that reads like a regulatory statement is an error wherever it sits.
 */
export function lintRawForBooleans(raw: unknown): LintIssue[] {
  const issues: LintIssue[] = [];
  walk(raw, "", (path, value) => {
    if (typeof value === "boolean" && REGULATORY_KEY.test(path.split(".").pop() ?? path)) {
      issues.push({ severity: "error", path, message: "regulatory field expressed as a boolean. Use a RegValue with a state (R1)" });
    }
  });
  return issues;
}

export function lintCountry(cfg: CountryConfig): LintIssue[] {
  const issues: LintIssue[] = [];
  const err = (path: string, message: string) => issues.push({ severity: "error", path, message });
  const warn = (path: string, message: string) => issues.push({ severity: "warning", path, message });

  // R1: walk every object; any key that looks regulatory but is a boolean is an error.
  issues.push(...lintRawForBooleans(cfg));

  // Intake questions: exactly one decides scope; the rest write to a typed fact or to flags,
  // never to a fact the shared form already collects.
  const activity = cfg.scope.questions.filter((q) => q.fact === "activity");
  if (activity.length !== 1) err("scope.questions", `exactly one question must declare fact "activity" (found ${activity.length})`);
  const seenFacts = new Set<string>();
  for (const q of cfg.scope.questions) {
    if ((SHARED_FACTS as readonly string[]).includes(q.fact)) err(`scope.questions.${q.id}`, `fact ${q.fact} is collected by the shared intake and cannot be redeclared`);
    if (seenFacts.has(q.fact)) err(`scope.questions.${q.id}`, `fact ${q.fact} is declared twice`);
    seenFacts.add(q.fact);
    if (q.kind === "choice" && q.options.length < 2) err(`scope.questions.${q.id}`, "a choice question needs at least two options");
    if (q.kind === "number" && q.options.length) err(`scope.questions.${q.id}`, "a number question carries no options");
    if (q.fact === "activity" && q.kind !== "choice") err(`scope.questions.${q.id}`, "the activity question must be a choice");
    // R3: a country's own deciding fact must start in an explicit "not yet established" state. Left
    // implicit (simply missing), a stage that turns on it would drop off the pathway as if the answer
    // had been "no". The default must be one of the declared options.
    if (q.fact !== "activity" && q.kind === "choice") {
      if (q.default === undefined) err(`scope.questions.${q.id}`, `a deciding-fact question must declare a default, the option that means "not yet established" (R3)`);
      else if (!q.options.some((o) => o.id === q.default)) err(`scope.questions.${q.id}`, `default ${q.default} is not one of the declared options`);
    }
  }
  // Every condition that names a non-shared, non-typed fact must have a question that collects it.
  // A condition on a number fact is refused: conditions compare declared option ids, and a count has
  // none, so "localities: 2" would silently never match (or match only one spelling of the number).
  const declared = new Set<string>([...SHARED_FACTS, ...TYPED_FACTS, ...cfg.scope.questions.map((q) => q.fact)]);
  const numberFacts = new Set<string>(["localities", ...cfg.scope.questions.filter((q) => q.kind === "number").map((q) => q.fact)]);
  walk(cfg, "", (path, value) => {
    if (/(^|\.)when(Not)?$/.test(path) && value && typeof value === "object" && !Array.isArray(value)) {
      for (const field of Object.keys(value as Record<string, unknown>)) {
        if (!declared.has(field)) err(path, `condition reads fact "${field}" but no question collects it`);
        if (numberFacts.has(field)) err(path, `condition reads number fact "${field}". Conditions compare option ids; a count has none. Carry the number as data, not as a branch`);
      }
    }
  });
  for (const r of cfg.eligibility) {
    if (r.effect) err(`eligibility.${r.id}.effect`, "an eligibility entry has no stage to stop or hold. Put the requirement on the stage it governs");
  }
  for (const stage of cfg.stages) {
    for (const r of stage.requirements) {
      if (r.effect === "stop" && r.reg.state !== "established") err(`stages.${stage.id}.requirements.${r.id}`, "a stop is an established prohibition. A reading or an open question halts and escalates instead (R3, R4)");
      if (r.effect === "stop" && !r.when) err(`stages.${stage.id}.requirements.${r.id}`, "an unconditional stop would close the pathway for every case. Say on which facts it applies");
      if (r.effect === "hold" && !r.when) err(`stages.${stage.id}.requirements.${r.id}`, "a hold waits on a fact. Say which answer leaves it outstanding");
    }
  }

  // R8: clocks
  const states = cfg.stateMachine.states;
  let workingClock = false;
  for (const clock of cfg.stateMachine.clocks) {
    const at = `stateMachine.clocks.${clock.id}`;
    const target = states[clock.onLapse.to];
    if (!target) err(`${at}.onLapse.to`, `unknown state ${clock.onLapse.to}`);
    else if (target.outcome === "granted") err(at, "a lapsed clock may never grant (R8)");
    if (!states[clock.startsIn]) err(`${at}.startsIn`, `unknown state ${clock.startsIn}`);
    for (const s of clock.suspendsIn) if (!states[s]) err(`${at}.suspendsIn`, `unknown state ${s}`);
    const running = clock.runsIn?.length ? clock.runsIn : [clock.startsIn];
    if (clock.runsIn?.length && !clock.runsIn.includes(clock.startsIn)) err(`${at}.runsIn`, "a clock runs in the state that starts it");
    for (const s of running) {
      if (!states[s]) err(`${at}.runsIn`, `unknown state ${s}`);
      if (clock.suspendsIn.includes(s)) err(`${at}.suspendsIn`, `${s} cannot both run and suspend the clock`);
      if (!cfg.stateMachine.transitions.some((t) => t.from === s && t.event === "lapse" && t.to === clock.onLapse.to)) {
        err(`${at}`, `the clock runs in ${s} but no lapse transition from ${s} to ${clock.onLapse.to} is declared. The deadline would pass with nowhere to go`);
      }
    }
    if (clock.extendableDays && !clock.extension) err(`${at}.extension`, "an extension power must carry the rule that grants it (R4)");
    if (clock.extension && !clock.extendableDays) err(`${at}.extendableDays`, "an extension rule without a cap. Say how many days the authority may add");
    if (clock.dayKind === "working") workingClock = true;
  }
  if (workingClock && !cfg.calendar) warn("calendar", "a working-day clock with no holiday calendar counts weekends only. Gazetted public holidays belong in the file");
  if (cfg.calendar) {
    const seen = new Set<string>();
    for (const h of cfg.calendar.holidays) {
      if (seen.has(h.date)) err("calendar.holidays", `holiday ${h.date} is listed twice`);
      seen.add(h.date);
      if (h.date > cfg.calendar.coversThrough) err("calendar.holidays", `holiday ${h.date} falls after coversThrough ${cfg.calendar.coversThrough}`);
    }
  }

  // Transitions reference known states, and no "lapse" event reaches a granted state.
  for (const t of cfg.stateMachine.transitions) {
    if (!states[t.from]) err(`stateMachine.transitions`, `unknown from-state ${t.from}`);
    if (!states[t.to]) err(`stateMachine.transitions`, `unknown to-state ${t.to}`);
    if (t.event === "lapse" && states[t.to]?.outcome === "granted") err(`stateMachine.transitions`, "lapse cannot grant (R8)");
  }
  if (!states[cfg.stateMachine.initial]) err("stateMachine.initial", "unknown initial state");

  // Every declared state is reachable. An unreachable state is a typo or a decoration,
  // and a decoration would let a file claim an unhappy path it cannot walk.
  const reachable = new Set<string>([cfg.stateMachine.initial]);
  for (const t of cfg.stateMachine.transitions) reachable.add(t.to);
  for (const c of cfg.stateMachine.clocks) reachable.add(c.onLapse.to);
  for (const id of Object.keys(states)) {
    if (!reachable.has(id)) err(`stateMachine.states.${id}`, "no transition or clock reaches this state (R9: a declared path must be walkable)");
  }

  // R9: unhappy paths present, judged by what a state is, not by what it is called.
  const values = Object.values(states);
  if (!values.some((s) => s.outcome === "refused")) warn("stateMachine.states", "no state with outcome refused. Appendix B lists refusal as a real state in every regime");
  if (!values.some((s) => s.outcome === "withdrawn")) warn("stateMachine.states", "no state with outcome withdrawn. Appendix B lists withdrawal as a real state in at least one regime");
  const informationRequested = Object.entries(states).some(([id, s]) => id !== cfg.stateMachine.initial && s.kind === "active" && s.outcome === "none");
  if (!informationRequested) warn("stateMachine.states", "no active state after the initial one: nothing models incomplete, information requested or correction required (R9)");

  // Outputs issued in an existing granted state
  for (const o of cfg.outputs) {
    const st = states[o.issuedInState];
    if (!st) err(`outputs.${o.id}.issuedInState`, `unknown state ${o.issuedInState}`);
    else if (st.outcome !== "granted") err(`outputs.${o.id}.issuedInState`, "instruments issue only in a granted-outcome state");
    if (o.verificationOpenAfterIssue && !o.verifier) err(`outputs.${o.id}.verifier`, "an instrument whose verification stays open must name the body that verifies it");
  }
  for (const stage of cfg.stages) {
    for (const p of stage.produces) {
      if (!cfg.outputs.find((o) => o.id === p)) err(`stages.${stage.id}.produces`, `unknown output ${p}`);
    }
  }
  const stageIds = new Set(cfg.stages.map((s) => s.id));
  if (cfg.stages.filter((s) => s.usesStateMachine).length !== 1) err("stages", "exactly one stage must be governed by the regulator state machine");

  // Renewal probe consistency with Class 5
  const class5 = cfg.obligationClasses.find((c) => c.number === 5);
  const termExists = class5?.fields["term_exists"];
  if (termExists?.state === "established" && /^no\b/i.test(termExists.value ?? "") && cfg.renewalProbe !== "never") {
    err("renewalProbe", "Class 5 says no term exists, so a renewal probe must never be scheduled");
  }
  if (termExists?.state === "unknown" && cfg.renewalProbe === "schedule") {
    err("renewalProbe", "Class 5 term_exists is unknown, so renewalProbe cannot be 'schedule'");
  }

  // R5: manual review judgments attach to a real stage and must not be self-declared facts
  for (const m of cfg.manualReview) {
    if (m.reg.state === "established" && m.reg.marker !== "§") err(`manualReview.${m.id}`, "inconsistent marker");
    if (!stageIds.has(m.stageId)) err(`manualReview.${m.id}.stageId`, `unknown stage ${m.stageId}`);
    if (m.reg.state !== "unknown") warn(`manualReview.${m.id}`, "a manual-review judgment is by definition unresolved until a human records it; expected state unknown");
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
