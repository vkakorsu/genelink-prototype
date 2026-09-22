import type { CaseFacts, CountryConfig, StateMachine, WorkingCalendar } from "../config/schema";
import type { z } from "zod";
import type { Clock as ClockSchema, Transition as TransitionSchema } from "../config/schema";
import { evaluate, unresolvedFields } from "./conditions";
type Transition = z.infer<typeof TransitionSchema>;
type Clock = z.infer<typeof ClockSchema>;

/**
 * Interpreter for the regulator-processing state machine declared in a country
 * file (Appendix B, A4 and R9). The interpreter is country-agnostic. It knows
 * nothing about Kenya or Colombia. It only knows how to read a declared machine.
 *
 * Invariants enforced in code regardless of configuration:
 *  - a "lapse" event may never reach a state whose outcome is "granted" (R8)
 *  - no transition is invented. If the file does not declare it, it does not exist
 *  - a transition guarded on a fact nobody has answered is not available: the engine
 *    never picks a branch of the law for the parties (R3)
 *  - a suspended clock does not count: when it resumes, its deadline moves forward by
 *    the time spent suspended
 *  - an extension is an authority act, recorded in the history, capped by the file
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
  /** When the current suspension began. Cleared on resume, when the deadline moves forward. */
  suspendedAt?: string | null;
  lapsed: boolean;
  /** Remaining days, counted in the clock's own dayKind. Negative once past the deadline. */
  daysRemaining: number | null;
  /** Days the authority has added under the clock's extension power, in the clock's dayKind. */
  extendedDays?: number;
  /** The deadline falls after the date the country's holiday list is maintained through. */
  beyondCalendar?: boolean;
};

export class TransitionError extends Error {}

const DAY = 86_400_000;

export function runsIn(c: Clock): string[] {
  return c.runsIn?.length ? c.runsIn : [c.startsIn];
}

export function initialSnapshot(cfg: CountryConfig, at: Date): MachineSnapshot {
  const snap: MachineSnapshot = { state: cfg.stateMachine.initial, history: [], clocks: {} };
  for (const c of cfg.stateMachine.clocks) snap.clocks[c.id] = freshClock(c.id);
  return startClocksFor(cfg, snap, at);
}

function freshClock(clockId: string): ClockStatus {
  return { clockId, startedAt: null, deadline: null, suspended: false, suspendedAt: null, lapsed: false, daysRemaining: null, extendedDays: 0 };
}

export function availableEvents(sm: StateMachine, state: string): Transition[] {
  return sm.transitions.filter((t) => t.from === state);
}

export type EventOption = { transition: Transition; status: "available" | "unresolved"; missing: string[] };

/**
 * The events declared from this state that the facts permit. A guard that reads an unanswered
 * fact is returned as unresolved with the facts it waits on, so the interface can say why the
 * branch is not offered. A guard the facts contradict is not returned at all.
 */
export function eventsFor(cfg: CountryConfig, state: string, facts: CaseFacts): EventOption[] {
  const out: EventOption[] = [];
  for (const t of availableEvents(cfg.stateMachine, state)) {
    const g = evaluate(t.when, facts);
    if (g === "no_match") continue;
    out.push({ transition: t, status: g === "match" ? "available" : "unresolved", missing: g === "unresolved" ? unresolvedFields(t.when, facts) : [] });
  }
  return out;
}

export function fire(cfg: CountryConfig, snap: MachineSnapshot, event: string, actor: string, at: Date, note?: string, facts?: CaseFacts): MachineSnapshot {
  const sm = cfg.stateMachine;
  const candidates = sm.transitions.filter((x) => x.from === snap.state && x.event === event);
  if (!candidates.length) throw new TransitionError(`No transition from ${snap.state} on ${event} in ${cfg.name}`);
  // Guards decide between same-named branches. Without facts (engine tests, lapses) an unguarded one is required.
  let t: Transition | undefined;
  const waiting: string[] = [];
  for (const c of candidates) {
    const g = facts ? evaluate(c.when, facts) : c.when ? "unresolved" : "match";
    if (g === "match") { t = c; break; }
    if (g === "unresolved") waiting.push(...(facts ? unresolvedFields(c.when, facts) : Object.keys(c.when ?? {})));
  }
  if (!t) {
    throw new TransitionError(
      waiting.length
        ? `"${event.replace(/_/g, " ")}" depends on a fact nobody has answered yet (${[...new Set(waiting)].join(", ")}). Answer it on the intake form. The engine does not choose a branch of the law for the parties.`
        : `"${event.replace(/_/g, " ")}" is not available on the facts entered for this case.`,
    );
  }
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
  const cal = cfg.calendar;
  for (const c of sm.clocks) {
    const status = next.clocks[c.id];
    if (!status) continue;
    // A lapsed clock whose running states are re-entered (an administrator resumes) starts afresh
    // from the resumption. The old deadline is history, recorded in the snapshot's history.
    if (status.lapsed && runsIn(c).includes(t.to)) {
      const deadline = addDays(at, c.days, c.dayKind, cal);
      next.clocks[c.id] = { ...freshClock(c.id), startedAt: at.toISOString(), deadline: deadline.toISOString(), daysRemaining: c.days, beyondCalendar: beyond(deadline, c, cal) };
      continue;
    }
    if (!status.startedAt || status.lapsed) continue;
    const entering = t.to;
    if (c.suspendsIn.includes(entering)) {
      next.clocks[c.id] = { ...status, suspended: true, suspendedAt: status.suspended ? status.suspendedAt : at.toISOString() };
    } else if (status.suspended && runsIn(c).includes(entering)) {
      // Resume: the time spent suspended does not count. Move the deadline forward by exactly that time.
      const pausedFrom = new Date(status.suspendedAt ?? at.toISOString());
      const deadline = new Date(status.deadline!);
      const moved = c.dayKind === "working"
        ? addDays(deadline, workingDaysBetween(pausedFrom, at, cal), "working", cal)
        : new Date(deadline.getTime() + (at.getTime() - pausedFrom.getTime()));
      next.clocks[c.id] = { ...status, suspended: false, suspendedAt: null, deadline: moved.toISOString(), beyondCalendar: beyond(moved, c, cal) };
    } else {
      next.clocks[c.id] = { ...status, suspended: false, suspendedAt: null };
    }
  }
  return startClocksFor(cfg, next, at);
}

function startClocksFor(cfg: CountryConfig, snap: MachineSnapshot, at: Date): MachineSnapshot {
  for (const c of cfg.stateMachine.clocks) {
    const status = snap.clocks[c.id];
    if (c.startsIn === snap.state && status && !status.startedAt) {
      const deadline = addDays(at, c.days, c.dayKind, cfg.calendar);
      snap.clocks[c.id] = { ...status, startedAt: at.toISOString(), deadline: deadline.toISOString(), daysRemaining: c.days, beyondCalendar: beyond(deadline, c, cfg.calendar) };
    }
  }
  return snap;
}

/** Recompute clock positions for "now". Returns the clock ids that have lapsed while the case sits in a state the clock runs in. */
export function tick(cfg: CountryConfig, snap: MachineSnapshot, now: Date): { snap: MachineSnapshot; lapsed: string[] } {
  const lapsed: string[] = [];
  const clocks = { ...snap.clocks };
  for (const c of cfg.stateMachine.clocks) {
    const s = clocks[c.id];
    if (!s?.deadline || s.suspended || s.lapsed) continue;
    const deadline = new Date(s.deadline);
    const remaining = c.dayKind === "working"
      ? (now <= deadline ? workingDaysBetween(now, deadline, cfg.calendar) : -workingDaysBetween(deadline, now, cfg.calendar))
      : Math.ceil((deadline.getTime() - now.getTime()) / DAY);
    // Lapsed means strictly past the deadline instant while the clock is running. The deadline day itself still counts.
    const isLapsed = now.getTime() > deadline.getTime() && runsIn(c).includes(snap.state);
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
  const t = cfg.stateMachine.transitions.find((x) => x.from === snap.state && x.event === "lapse" && x.to === clock.onLapse.to);
  if (!t) throw new TransitionError(`${clock.label} lapsed in ${snap.state}, but the file declares no lapse transition from there to ${clock.onLapse.to}. The linter should have refused this file.`);
  return fire(cfg, snap, "lapse", "system", at, `${clock.label} lapsed. ${clock.onLapse.reg.value ?? ""}`);
}

/**
 * The authority extends a running clock under the power the file declares (Colombia D391 Art. 29:
 * "prorrogable hasta por sesenta días hábiles"). Recorded in the history as the authority's act.
 * An extension is never inferred from silence: a clock nobody extended lapses on its own deadline.
 */
export function extendClock(cfg: CountryConfig, snap: MachineSnapshot, clockId: string, days: number, at: Date, note?: string): MachineSnapshot {
  const clock = cfg.stateMachine.clocks.find((c) => c.id === clockId);
  if (!clock) throw new TransitionError(`Unknown clock ${clockId}`);
  if (!clock.extendableDays) throw new TransitionError(`${clock.label} carries no extension power in ${cfg.name}'s file. Nothing can be added to it.`);
  const s = snap.clocks[clockId];
  if (!s?.startedAt || !s.deadline) throw new TransitionError(`${clock.label} has not started.`);
  if (s.lapsed) throw new TransitionError(`${clock.label} has already lapsed. An extension after the deadline is not an extension; the remedy against the administrator stands.`);
  if (!runsIn(clock).includes(snap.state) && !clock.suspendsIn.includes(snap.state)) throw new TransitionError(`${clock.label} is not running in the current state.`);
  if (!Number.isInteger(days) || days < 1) throw new TransitionError("An extension is a whole number of days, at least one.");
  const used = s.extendedDays ?? 0;
  if (used + days > clock.extendableDays) {
    throw new TransitionError(`${clock.label} may be extended by at most ${clock.extendableDays} ${clock.dayKind} days in total; ${used} already used, ${clock.extendableDays - used} remain.`);
  }
  const deadline = addDays(new Date(s.deadline), days, clock.dayKind, cfg.calendar);
  return {
    ...snap,
    history: [...snap.history, { from: snap.state, to: snap.state, event: "extend_clock", actor: "authority", at: at.toISOString(), note: `${clock.label} extended by ${days} ${clock.dayKind} days (${used + days} of ${clock.extendableDays} used).${note ? ` ${note}` : ""}` }],
    clocks: { ...snap.clocks, [clockId]: { ...s, deadline: deadline.toISOString(), extendedDays: used + days, beyondCalendar: beyond(deadline, clock, cfg.calendar) } },
  };
}

export function isGranted(cfg: CountryConfig, snap: MachineSnapshot): boolean {
  return cfg.stateMachine.states[snap.state]?.outcome === "granted";
}

// ------------------------------------------------------------------ calendar arithmetic

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday ... 7 = Sunday, on the UTC calendar date. */
function isoWeekday(d: Date): number {
  const w = d.getUTCDay();
  return w === 0 ? 7 : w;
}

export function isWorkingDay(d: Date, cal?: WorkingCalendar): boolean {
  const weekend = cal?.weekend ?? [6, 7];
  if (weekend.includes(isoWeekday(d))) return false;
  if (cal && cal.holidays.some((h) => h.date === isoDay(d))) return false;
  return true;
}

/** Add days. Working days skip the country's weekend and gazetted holidays; without a calendar, weekends only. */
export function addDays(from: Date, days: number, kind: "calendar" | "working", cal?: WorkingCalendar): Date {
  const d = new Date(from);
  if (kind === "calendar") {
    d.setUTCDate(d.getUTCDate() + days);
    return d;
  }
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d, cal)) remaining--;
  }
  return d;
}

/** Working days after `from` up to and including `to`'s date. Zero when `to` is not after `from`. */
export function workingDaysBetween(from: Date, to: Date, cal?: WorkingCalendar): number {
  if (to <= from) return 0;
  const d = new Date(from);
  let n = 0;
  while (isoDay(d) < isoDay(to)) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWorkingDay(d, cal)) n++;
  }
  return n;
}

function beyond(deadline: Date, c: Clock, cal?: WorkingCalendar): boolean {
  return c.dayKind === "working" && !!cal && isoDay(deadline) > cal.coversThrough;
}
