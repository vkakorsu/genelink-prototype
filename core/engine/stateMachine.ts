import type { CountryConfig, StateMachine } from "../config/schema";
import type { z } from "zod";
import type { Transition as TransitionSchema } from "../config/schema";
type Transition = z.infer<typeof TransitionSchema>;

/**
 * Interpreter for the regulator-processing state machine declared in a country
 * file (Appendix B, A4 and R9). The interpreter is country-agnostic. It knows
 * nothing about Kenya or Colombia. It only knows how to read a declared machine.
 *
 * Two invariants are enforced in code regardless of configuration:
 *  - a "lapse" event may never reach a state whose outcome is "granted" (R8)
 *  - no transition is invented. If the file does not declare it, it does not exist.
 */

export type MachineSnapshot = {
  state: string;
  history: { from: string; to: string; event: string; actor: string; at: string; note?: string }[];
  clocks: Record<string, ClockStatus>;
};

export type ClockStatus = {
  clockId: string;
  startedAt: string | null;
  deadline: string | null;
  suspended: boolean;
  lapsed: boolean;
  daysRemaining: number | null;
};

export class TransitionError extends Error {}

export function initialSnapshot(cfg: CountryConfig, at: Date): MachineSnapshot {
  const snap: MachineSnapshot = { state: cfg.stateMachine.initial, history: [], clocks: {} };
  for (const c of cfg.stateMachine.clocks) {
    snap.clocks[c.id] = { clockId: c.id, startedAt: null, deadline: null, suspended: false, lapsed: false, daysRemaining: null };
  }
  return startClocksFor(cfg.stateMachine, snap, at);
}

export function availableEvents(sm: StateMachine, state: string): Transition[] {
  return sm.transitions.filter((t) => t.from === state);
}

export function fire(cfg: CountryConfig, snap: MachineSnapshot, event: string, actor: string, at: Date, note?: string): MachineSnapshot {
  const sm = cfg.stateMachine;
  const t = sm.transitions.find((x) => x.from === snap.state && x.event === event);
  if (!t) throw new TransitionError(`No transition from ${snap.state} on ${event} in ${cfg.name}`);
  const target = sm.states[t.to];
  if (event === "lapse" && target.outcome === "granted") {
    throw new TransitionError("A lapsed clock may never grant (R8)");
  }
  if (t.actor !== actor && actor !== "system") {
    throw new TransitionError(`Event ${event} belongs to ${t.actor}, not ${actor}`);
  }
  const next: MachineSnapshot = {
    state: t.to,
    history: [...snap.history, { from: snap.state, to: t.to, event, actor, at: at.toISOString(), note }],
    clocks: { ...snap.clocks },
  };
  // Suspend or resume clocks by state. A clock that has lapsed and whose state is
  // re-entered (an administrator resumes) starts afresh: the old deadline is history,
  // recorded in the snapshot's history, and a new one runs from the resumption.
  for (const c of sm.clocks) {
    const status = next.clocks[c.id];
    if (!status) continue;
    const restart = status.lapsed && t.to === c.startsIn;
    next.clocks[c.id] = restart
      ? { clockId: c.id, startedAt: null, deadline: null, suspended: false, lapsed: false, daysRemaining: null }
      : { ...status, suspended: c.suspendsIn.includes(t.to) };
  }
  return startClocksFor(sm, next, at);
}

function startClocksFor(sm: StateMachine, snap: MachineSnapshot, at: Date): MachineSnapshot {
  for (const c of sm.clocks) {
    const status = snap.clocks[c.id];
    if (c.startsIn === snap.state && status && !status.startedAt) {
      const deadline = addDays(at, c.days, c.dayKind);
      snap.clocks[c.id] = { ...status, startedAt: at.toISOString(), deadline: deadline.toISOString(), daysRemaining: c.days };
    }
  }
  return snap;
}

/** Recompute clock positions for "now". Returns the clock ids that have lapsed while the case sits in a state the clock governs. */
export function tick(cfg: CountryConfig, snap: MachineSnapshot, now: Date): { snap: MachineSnapshot; lapsed: string[] } {
  const lapsed: string[] = [];
  const clocks = { ...snap.clocks };
  for (const c of cfg.stateMachine.clocks) {
    const s = clocks[c.id];
    if (!s?.deadline || s.suspended) continue;
    const remaining = Math.ceil((new Date(s.deadline).getTime() - now.getTime()) / 86_400_000);
    const isLapsed = remaining < 0 && snap.state === c.startsIn;
    clocks[c.id] = { ...s, daysRemaining: remaining, lapsed: isLapsed };
    if (isLapsed) lapsed.push(c.id);
  }
  return { snap: { ...snap, clocks }, lapsed };
}

/** Apply a lapse. The only reachable target is the clock's onLapse state, which the linter guarantees is never granted. */
export function applyLapse(cfg: CountryConfig, snap: MachineSnapshot, clockId: string, at: Date): MachineSnapshot {
  const clock = cfg.stateMachine.clocks.find((c) => c.id === clockId);
  if (!clock) throw new TransitionError(`Unknown clock ${clockId}`);
  const target = cfg.stateMachine.states[clock.onLapse.to];
  if (target.outcome === "granted") throw new TransitionError("A lapsed clock may never grant (R8)");
  return fire(cfg, snap, "lapse", "system", at, `${clock.label} lapsed. ${clock.onLapse.reg.value ?? ""}`);
}

export function isGranted(cfg: CountryConfig, snap: MachineSnapshot): boolean {
  return cfg.stateMachine.states[snap.state]?.outcome === "granted";
}

function addDays(from: Date, days: number, kind: "calendar" | "working"): Date {
  const d = new Date(from);
  if (kind === "calendar") {
    d.setDate(d.getDate() + days);
    return d;
  }
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d;
}
