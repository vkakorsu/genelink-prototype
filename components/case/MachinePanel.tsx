import type { CountryConfig } from "@/core/config/schema";
import type { Case } from "@/core/domain/types";
import { availableEvents } from "@/core/engine/stateMachine";
import { fireEvent, tickClocks } from "@/app/actions";
import { EvidenceChip } from "@/components/Evidence";
import { fmtTime } from "@/components/ui";

export function MachinePanel({ cfg, c, canAct, isAdmin }: { cfg: CountryConfig; c: Case; canAct: boolean; isAdmin: boolean }) {
  const sm = cfg.stateMachine;
  const current = sm.states[c.machine.state];
  const events = availableEvents(sm, c.machine.state).filter((t) => t.event !== "lapse");
  const clocks = sm.clocks;
  return (
    <section className="card">
      <div className="row between">
        <h3 style={{ margin: 0 }}>Regulator processing</h3>
        <span className="small mute">A state machine declared in configuration, not one arrow</span>
      </div>
      <p className="small soft" style={{ marginTop: 12 }}>Current state: <span className={`state current ${current.kind === "halted" ? "halted" : ""}`}>{current.label}</span></p>
      {current.reg && <p className="small"><EvidenceChip reg={current.reg} short /> {current.reg.value} <span className="mono mute">{current.reg.citation}</span></p>}
      {current.outcome === "lapsed" && (
        <div className="halt-box"><strong>Lapsed clock, no permit.</strong> A missed statutory deadline gives the applicant a remedy against the administrator. It never grants (R8). The authority may resume.</div>
      )}

      <h4 style={{ marginTop: 12 }}>All declared states</h4>
      <div className="machine">
        {Object.entries(sm.states).map(([id, s]) => (
          <span key={id} className={`state ${id === c.machine.state ? "current" : ""} ${s.kind === "terminal" ? "terminal" : ""} ${s.kind === "halted" ? "halted" : ""}`} title={s.kind}>{s.label.split(".")[0]}</span>
        ))}
      </div>

      {clocks.length > 0 && (
        <div style={{ marginTop: 12 }} className="stack">
          <h4>Clocks</h4>
          {clocks.map((k) => {
            const st = c.machine.clocks[k.id];
            return (
              <div key={k.id} className={`clock ${st?.lapsed ? "lapsed" : st?.suspended ? "suspended" : ""}`}>
                <span>{k.label} · {k.days} {k.dayKind} days{k.extendableDays ? `, extendable by ${k.extendableDays}` : ""}</span>
                <span>
                  {!st?.startedAt && "not started"}
                  {st?.startedAt && !st.lapsed && (st.suspended ? "suspended" : c.machine.state === k.startsIn ? `deadline ${fmtTime(st.deadline, false)}` : `no longer running (state moved on before ${fmtTime(st.deadline, false)})`)}
                  {st?.lapsed && "lapsed · remedy against administrator"}
                </span>
              </div>
            );
          })}
          <p className="small mute">On lapse: <EvidenceChip reg={clocks[0].onLapse.reg} short /> {clocks[0].onLapse.reg.value}</p>
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
        {events.length === 0 && <p className="small mute">Terminal state. No further events are declared.</p>}
        {events.length > 0 && !canAct && <p className="small mute">Your seat can view but not record regulator events.</p>}
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
              <li key={i}><time>{fmtTime(h.at)}</time> <strong>{h.event.replace(/_/g, " ")}</strong> · {sm.states[h.from]?.label.split(".")[0]} → {sm.states[h.to]?.label.split(".")[0]} <span className="mute">({h.actor})</span>{h.note && <div className="mute">{h.note}</div>}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
