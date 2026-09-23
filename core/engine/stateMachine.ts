import type { CaseFacts, CountryConfig, StateMachine, WorkingCalendar } from "../config/schema";
import type { z } from "zod";
import type { Clock as ClockSchema, Transition as TransitionSchema } from "../config/schema";
import { evaluate, unresolvedFields } from "./conditions";
import { establishedOnly } from "./facts";
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
 *  - days are dates on the authority's calendar, in the country's time zone. The day of the
 *    triggering event is not counted, and a deadline runs to the end of its last day there:
 *    a clock never lapses while its final day is still running where the authority sits
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
  /** Remaining days after today, counted in the clock's own dayKind. Zero on the final day; negative once past it. */
  daysRemaining: number | null;
  /** The deadline's last day has ended. Set by tick; the lapse itself is applied only while the clock runs. */
  pastDeadline?: boolean;
  /** Days the authority has added under the clock's extension power, in the clock's dayKind. */
  extendedDays?: number;
  /** The deadline falls after the date the country's holiday list is maintained through. */
  beyondCalendar?: boolean;
  /** The clock restarted when the authority resumed after a lapse. The law sets no new deadline; this one is a tracking aid. */
  restartedAfterLapse?: { at: string; missedDeadline: string | null };
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
  const seen = new Set<string>();
  for (const t of availableEvents(cfg.stateMachine, state)) {
    const g = guard(cfg, t.when, facts);
    if (g.answer === "no_match") continue;
    // Same-named branches waiting on the same fact are one question for the parties, shown once.
    const key = `${t.event}|${g.answer}|${g.missing.join(",")}`;
    if (g.answer === "unresolved" && seen.has(key)) continue;
    seen.add(key);
    out.push({ transition: t, status: g.answer === "match" ? "available" : "unresolved", missing: g.missing });
  }
  return out;
}

/**
 * A guard read against the case's facts. A fact still at its question's "not yet established"
 * default does not rule a branch out: the branch waits on it, as it would on a missing fact.
 */
function guard(cfg: CountryConfig, when: Transition["when"], facts: CaseFacts): { answer: "match" | "no_match" | "unresolved"; missing: string[] } {
  const g = evaluate(when, facts);
  if (g === "match") return { answer: "match", missing: [] };
  const open = establishedOnly(cfg, facts);
  const h = evaluate(when, open);
  if (h === "unresolved") return { answer: "unresolved", missing: unresolvedFields(when, open) };
  return { answer: "no_match", missing: [] };
}

export function fire(cfg: CountryConfig, snap: MachineSnapshot, event: string, actor: string, at: Date, note?: string, facts?: CaseFacts): MachineSnapshot {
  const sm = cfg.stateMachine;
  const candidates = sm.transitions.filter((x) => x.from === snap.state && x.event === event);
  if (!candidates.length) {
    const here = sm.states[snap.state]?.label ?? snap.state;
    const offered = availableEvents(sm, snap.state).filter((t) => t.event !== "lapse").map((t) => t.event.replace(/_/g, " "));
    throw new TransitionError(`"${event.replace(/_/g, " ")}" cannot be recorded while the case is at "${here}" in ${cfg.name}'s process. ${offered.length ? `What can be recorded from here: ${[...new Set(offered)].join(", ")}.` : "No further event is declared from here."} The page may be out of date; reload it.`);
  }
  // Guards decide between same-named branches. Without facts (engine tests, lapses) an unguarded one is required.
  let t: Transition | undefined;
  const waiting: string[] = [];
  for (const c of candidates) {
    const g = facts ? guard(cfg, c.when, facts) : { answer: c.when ? "unresolved" : "match", missing: Object.keys(c.when ?? {}) };
    if (g.answer === "match") { t = c; break; }
    if (g.answer === "unresolved") waiting.push(...g.missing);
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
  const tz = cfg.timeZone;
  for (const c of sm.clocks) {
    const status = next.clocks[c.id];
    if (!status) continue;
    // A lapsed clock whose running states are re-entered (an administrator resumes) starts afresh
    // from the resumption. The old deadline is history, recorded in the snapshot's history.
    if (status.lapsed && runsIn(c).includes(t.to)) {
      const deadline = addDays(at, c.days, c.dayKind, cal, tz);
      next.clocks[c.id] = { ...freshClock(c.id), startedAt: at.toISOString(), deadline: deadline.toISOString(), daysRemaining: c.days, beyondCalendar: beyond(deadline, c, cal, tz), restartedAfterLapse: { at: at.toISOString(), missedDeadline: status.deadline } };
      continue;
    }
    if (!status.startedAt || status.lapsed) continue;
    const entering = t.to;
    if (c.suspendsIn.includes(entering)) {
      next.clocks[c.id] = { ...status, suspended: true, suspendedAt: status.suspended ? status.suspendedAt : at.toISOString() };
    } else if (status.suspended && runsIn(c).includes(entering)) {
      // Resume: the days spent suspended do not count. Move the deadline forward by exactly those days,
      // counted in the clock's own kind on the authority's calendar.
      const pausedFrom = new Date(status.suspendedAt ?? at.toISOString());
      const deadline = new Date(status.deadline!);
      const moved = c.dayKind === "working"
        ? addDays(deadline, workingDaysBetween(pausedFrom, at, cal, tz), "working", cal, tz)
        : addDays(deadline, calendarDaysBetween(pausedFrom, at, tz), "calendar", cal, tz);
      next.clocks[c.id] = { ...status, suspended: false, suspendedAt: null, deadline: moved.toISOString(), beyondCalendar: beyond(moved, c, cal, tz) };
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
      const deadline = addDays(at, c.days, c.dayKind, cfg.calendar, cfg.timeZone);
      snap.clocks[c.id] = { ...status, startedAt: at.toISOString(), deadline: deadline.toISOString(), daysRemaining: c.days, beyondCalendar: beyond(deadline, c, cfg.calendar, cfg.timeZone) };
    }
  }
  return snap;
}

/** Recompute clock positions for "now". Returns the clock ids that have lapsed while the case sits in a state the clock runs in. */
export function tick(cfg: CountryConfig, snap: MachineSnapshot, now: Date): { snap: MachineSnapshot; lapsed: string[] } {
  const lapsed: string[] = [];
  const clocks = { ...snap.clocks };
  const tz = cfg.timeZone;
  for (const c of cfg.stateMachine.clocks) {
    const s = clocks[c.id];
    if (!s?.deadline || s.suspended || s.lapsed) continue;
    const deadline = new Date(s.deadline);
    // The deadline is the last instant of its final day on the authority's calendar, so "past" means
    // that day has ended there. On the final day itself the count is zero and nothing has lapsed.
    const past = now.getTime() > deadline.getTime();
    const between = (a: Date, b: Date) => (c.dayKind === "working" ? workingDaysBetween(a, b, cfg.calendar, tz) : calendarDaysBetween(a, b, tz));
    const remaining = past ? -between(deadline, now) || 0 : between(now, deadline);
    const isLapsed = past && runsIn(c).includes(snap.state);
    clocks[c.id] = { ...s, daysRemaining: remaining, pastDeadline: past, lapsed: isLapsed };
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
  const deadline = addDays(new Date(s.deadline), days, clock.dayKind, cfg.calendar, cfg.timeZone);
  return {
    ...snap,
    history: [...snap.history, { from: snap.state, to: snap.state, event: "extend_clock", actor: "authority", at: at.toISOString(), note: `${clock.label} extended by ${days} ${clock.dayKind} days (${used + days} of ${clock.extendableDays} used).${note ? ` ${note}` : ""}` }],
    clocks: { ...snap.clocks, [clockId]: { ...s, deadline: deadline.toISOString(), extendedDays: used + days, beyondCalendar: beyond(deadline, clock, cfg.calendar, cfg.timeZone) } },
  };
}

export function isGranted(cfg: CountryConfig, snap: MachineSnapshot): boolean {
  return cfg.stateMachine.states[snap.state]?.outcome === "granted";
}

// ------------------------------------------------------------------ calendar arithmetic
//
// A statutory day is a date on the authority's calendar. Every count below works on
// YYYY-MM-DD dates in the country's time zone, and only the final deadline is turned
// back into an instant: the last millisecond of its last day there. The time zone
// defaults to UTC for callers that pass none (tests of the arithmetic itself).

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(timeZone, f);
  }
  return f;
}

function wallClock(t: number, timeZone: string): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts = Object.fromEntries(formatter(timeZone).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { y: +parts.year, m: +parts.month, d: +parts.day, h: +parts.hour % 24, mi: +parts.minute, s: +parts.second };
}

/** The calendar date (YYYY-MM-DD) an instant falls on in a time zone. */
export function localDate(d: Date, timeZone = "UTC"): string {
  const w = wallClock(d.getTime(), timeZone);
  return `${String(w.y).padStart(4, "0")}-${String(w.m).padStart(2, "0")}-${String(w.d).padStart(2, "0")}`;
}

/** The zone's offset from UTC at an instant, in milliseconds (positive east of Greenwich). */
function offsetMs(t: number, timeZone: string): number {
  const w = wallClock(t, timeZone);
  return Date.UTC(w.y, w.m - 1, w.d, w.h, w.mi, w.s) - (t - (((t % 1000) + 1000) % 1000));
}

function shiftDate(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ISO weekday of a calendar date, 1 = Monday ... 7 = Sunday. A date's weekday does not depend on a time zone. */
function isoWeekdayOf(ymd: string): number {
  const w = new Date(`${ymd}T00:00:00Z`).getUTCDay();
  return w === 0 ? 7 : w;
}

function isWorkingDate(ymd: string, cal?: WorkingCalendar): boolean {
  const weekend = cal?.weekend ?? [6, 7];
  if (weekend.includes(isoWeekdayOf(ymd))) return false;
  if (cal && cal.holidays.some((h) => h.date === ymd)) return false;
  return true;
}

/** The first instant of a calendar date in a time zone. Refined once so an offset change on that date is honoured. */
function startOfLocalDay(ymd: string, timeZone: string): number {
  const utcMidnight = Date.parse(`${ymd}T00:00:00Z`);
  const guess = utcMidnight - offsetMs(utcMidnight, timeZone);
  return utcMidnight - offsetMs(guess, timeZone);
}

/** The last instant of a calendar date in a time zone. A deadline runs to the end of its last day. */
export function endOfLocalDay(ymd: string, timeZone = "UTC"): Date {
  return new Date(startOfLocalDay(shiftDate(ymd, 1), timeZone) - 1);
}

/** Whether the date an instant falls on, in the given time zone, is a working day on the country's calendar. */
export function isWorkingDay(d: Date, cal?: WorkingCalendar, timeZone = "UTC"): boolean {
  return isWorkingDate(localDate(d, timeZone), cal);
}

/**
 * Add days to the date an instant falls on and return the end of the resulting day. The day of
 * the event itself is not counted. Working days skip the country's weekend and gazetted holidays;
 * without a calendar, weekends only.
 */
export function addDays(from: Date, days: number, kind: "calendar" | "working", cal?: WorkingCalendar, timeZone = "UTC"): Date {
  let ymd = localDate(from, timeZone);
  if (kind === "calendar") {
    ymd = shiftDate(ymd, days);
  } else {
    let remaining = days;
    while (remaining > 0) {
      ymd = shiftDate(ymd, 1);
      if (isWorkingDate(ymd, cal)) remaining--;
    }
  }
  return endOfLocalDay(ymd, timeZone);
}

/** Working days after `from`'s date up to and including `to`'s date, on the given zone's calendar. Zero when `to` is not after `from`. */
export function workingDaysBetween(from: Date, to: Date, cal?: WorkingCalendar, timeZone = "UTC"): number {
  if (to <= from) return 0;
  const last = localDate(to, timeZone);
  let ymd = localDate(from, timeZone);
  let n = 0;
  while (ymd < last) {
    ymd = shiftDate(ymd, 1);
    if (isWorkingDate(ymd, cal)) n++;
  }
  return n;
}

/** Calendar days from `from`'s date to `to`'s date, on the given zone's calendar. Zero when `to` is not after `from`. */
export function calendarDaysBetween(from: Date, to: Date, timeZone = "UTC"): number {
  if (to <= from) return 0;
  return Math.round((Date.parse(`${localDate(to, timeZone)}T00:00:00Z`) - Date.parse(`${localDate(from, timeZone)}T00:00:00Z`)) / DAY);
}

function beyond(deadline: Date, c: Clock, cal: WorkingCalendar | undefined, timeZone: string): boolean {
  return c.dayKind === "working" && !!cal && localDate(deadline, timeZone) > cal.coversThrough;
}
