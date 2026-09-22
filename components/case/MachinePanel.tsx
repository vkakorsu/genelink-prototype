import type { CountryConfig } from "@/core/config/schema";
import type { Case } from "@/core/domain/types";
import { eventsFor, runsIn } from "@/core/engine/stateMachine";
import { promptFor } from "@/core/engine/scope";
import { extendClock, fireEvent, tickClocks } from "@/app/actions";
import { EvidenceChip } from "@/components/Evidence";
import { fmtTime, stateHeadline } from "@/components/ui";

export function MachinePanel({ cfg, c, canAct, canPrepare, isAdmin }: { cfg: CountryConfig; c: Case; canAct: boolean; canPrepare: boolean; isAdmin: boolean }) {
  const sm = cfg.stateMachine;
  const current = sm.states[c.machine.state];
  const options = eventsFor(cfg, c.machine.state, c.facts).filter((o) => o.transition.event !== "lapse");
  const events = options.filter((o) => o.status === "available").map((o) => o.transition);
  const guarded = options.filter((o) => o.status === "unresolved");
  const clocks = sm.clocks;
  const extendable = clocks.filter((k) => {
    const st = c.machine.clocks[k.id];
    return k.extendableDays && st?.startedAt && !st.lapsed && (runsIn(k).includes(c.machine.state) || k.suspendsIn.includes(c.machine.state)) && (st.extendedDays ?? 0) < k.extendableDays;
  });
  const extendHere = extendClock.bind(null, c.id);
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Regulator processing</h3>
        <span className="small mute">A state machine declared in configuration, not one arrow</span>
      </div>
      <p className="small soft" style={{ marginTop: 12 }}>Current state: <span className={`state current ${current.kind === "halted" ? "halted" : ""}`}>{current.label}</span></p>
      {current.reg && <p className="small"><EvidenceChip reg={current.reg} short /> {current.reg.value} <span className="mono mute">{current.reg.citation}</span></p>}
      {current.outcome === "lapsed" && (
        <div className="halt-box"><strong>Lapsed clock, nothing granted.</strong> A missed statutory deadline gives the applicant a remedy against the administrator. It never grants (R8). The authority may resume.</div>
      )}

      <h4 style={{ marginTop: 12 }}>All declared states</h4>
      <div className="machine">
        {Object.entries(sm.states).map(([id, s]) => (
          <span key={id} className={`state ${id === c.machine.state ? "current" : ""} ${s.kind === "terminal" ? "terminal" : ""} ${s.kind === "halted" ? "halted" : ""}`} title={s.kind}>{stateHeadline(s.label)}</span>
        ))}
      </div>

      {clocks.length > 0 && (
        <div style={{ marginTop: 12 }} className="stack">
          <h4>Clocks</h4>
          {clocks.map((k) => {
            const st = c.machine.clocks[k.id];
            const running = runsIn(k).includes(c.machine.state);
            return (
              <div key={k.id} className={`clock ${st?.lapsed ? "lapsed" : st?.suspended ? "suspended" : ""}`}>
                <span>
                  {k.label} · {k.days} {k.dayKind} days{k.extendableDays ? `, extendable by up to ${k.extendableDays}` : ""}
                  {(st?.extendedDays ?? 0) > 0 && <> · <strong>extended by {st!.extendedDays}</strong></>}
                </span>
                <span>
                  {!st?.startedAt && "not started"}
                  {st?.startedAt && !st.lapsed && (st.suspended
                    ? `suspended since ${fmtTime(st.suspendedAt ?? null, false)}: this time does not count`
                    : running
                      ? `deadline ${fmtTime(st.deadline, false)}${st.daysRemaining !== null ? ` · ${st.daysRemaining} ${k.dayKind} day${st.daysRemaining === 1 ? "" : "s"} left at last check` : ""}`
                      : `no longer running (state moved on before ${fmtTime(st.deadline, false)})`)}
                  {st?.lapsed && "lapsed · remedy against administrator"}
                  {st?.beyondCalendar && <span className="mute"> · beyond the holiday calendar ({cfg.calendar?.coversThrough}), weekends only</span>}
                </span>
              </div>
            );
          })}
          <p className="small mute">On lapse: <EvidenceChip reg={clocks[0].onLapse.reg} short /> {clocks[0].onLapse.reg.value}</p>
          {cfg.calendar && clocks.some((k) => k.dayKind === "working") && (
            <p className="small mute">Working days skip {cfg.name}&apos;s weekend and the {cfg.calendar.holidays.length} gazetted public holidays in its file, maintained through {cfg.calendar.coversThrough}. <EvidenceChip reg={cfg.calendar.reg} short /></p>
          )}
          {clocks.filter((k) => k.extension).map((k) => (
            <p key={k.id} className="small mute">Extension power: <EvidenceChip reg={k.extension!} short /> {k.extension!.value} <span className="mono">{k.extension!.citation}</span> An extension is the authority&apos;s act. It is recorded, never inferred: a clock nobody extended lapses on its own deadline.</p>
          ))}
          {isAdmin && extendable.map((k) => {
            const left = k.extendableDays! - (c.machine.clocks[k.id].extendedDays ?? 0);
            return (
              <form key={k.id} action={extendHere} className="row">
                <input type="hidden" name="clockId" value={k.id} />
                <span className="small mute">Record the authority&apos;s extension of the {k.label.split(" (")[0].toLowerCase()}:</span>
                <input name="days" type="number" min={1} max={left} step={1} defaultValue={left} aria-label={`Extension in ${k.dayKind} days, at most ${left}`} style={{ width: 90 }} />
                <input name="note" type="text" placeholder="Resolution or notice it rests on" required style={{ flex: 1, minWidth: 200 }} />
                <button className="btn ghost small" type="submit">Record extension</button>
              </form>
            );
          })}
          {isAdmin && (
            <form action={tickClocks.bind(null, c.id)} className="row">
              <span className="small mute">Demo control, administrator only: re-check clocks at a chosen time. Nothing else in the demo moves.</span>
              <button className="btn ghost small" type="submit" name="days" value="0">Check now</button>
              <button className="btn ghost small" type="submit" name="days" value="45">Check at +45 days</button>
              <button className="btn ghost small" type="submit" name="days" value="90">Check at +90 days</button>
              <button className="btn ghost small" type="submit" name="days" value="lapse" title="Evaluate the running clock one day past its own deadline">Force lapse now</button>
            </form>
          )}
        </div>
      )}

      <div style={{ marginTop: 12 }}>
        <h4>Record what happened</h4>
        {events.length === 0 && guarded.length === 0 && <p className="small mute">Terminal state. No further events are declared.</p>}
        {guarded.map((o) => (
          <div key={`${o.transition.event}-${o.transition.to}`} className="halt-box small" role="status">
            <strong>{o.transition.event.replace(/_/g, " ")}</strong> ({stateHeadline(sm.states[o.transition.to].label)}) depends on a fact not yet answered: {o.missing.map((f) => promptFor(cfg, f)).join("; ")}. The engine does not choose a branch of the law for the parties; answer it on the intake form.
          </div>
        ))}
        {events.length > 0 && !canAct && (
          <p className="small mute">{canPrepare
            ? "Your seat prepares the bundle: facts, documents and work in progress. Filing before the regulator (submit, resubmit, withdraw, appeal) is a commitment the organisation stands behind and takes an authorised signatory or administrator seat."
            : "Your seat can view but not record regulator events."}</p>
        )}
        {events.length > 0 && canAct && (() => {
          const mine = events.filter((t) => isAdmin || t.actor === "applicant");
          const held = events.length - mine.length;
          return (
            <form action={fireEvent.bind(null, c.id)} className="stack">
              <input name="note" type="text" placeholder="Note for the audit record (optional)" />
              <div className="row">
                {mine.map((t) => (
                  <button key={t.event} className={`btn small ${t.actor === "authority" ? "secondary" : t.actor === "system" ? "ghost" : ""}`} type="submit" name="event" value={t.event} title={`Actor: ${t.actor}. Target: ${sm.states[t.to].label}`}>
                    {t.event.replace(/_/g, " ")} <span className="mute">· {t.actor}</span>
                  </button>
                ))}
              </div>
              {mine.length === 0 && <p className="small mute">Your seat has no applicant act at this stage. The next events belong to the authority.</p>}
              {held > 0 && <p className="small mute">{held} authority or system event{held === 1 ? " is" : "s are"} not shown to your seat.</p>}
              <p className="small mute">The platform records the regulator&apos;s acts. It does not perform them. Authority and system events are recorded by an administrator on the authority&apos;s behalf{isAdmin ? "" : ". Your seat can record applicant events only, and a denied attempt is written to the audit chain"}.</p>
            </form>
          );
        })()}
      </div>

      {c.machine.history.length > 0 && (
        <details className="fold" style={{ marginTop: 10 }}>
          <summary>History ({c.machine.history.length})</summary>
          <ol className="timeline">
            {c.machine.history.map((h, i) => (
              <li key={i}><time>{fmtTime(h.at)}</time> <strong>{h.event.replace(/_/g, " ")}</strong> · {stateHeadline(sm.states[h.from]?.label ?? h.from)} → {stateHeadline(sm.states[h.to]?.label ?? h.to)} <span className="mute">({h.actor})</span>{h.note && <div className="mute">{h.note}</div>}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
