import type { CountryConfig } from "@/core/config/schema";
import type { Case } from "@/core/domain/types";
import { eventsFor, runsIn, tick } from "@/core/engine/stateMachine";
import { evaluateScope, promptFor } from "@/core/engine/scope";
import { buildPathway } from "@/core/engine/pathway";
import { extendClock, fireEvent, tickClocks } from "@/app/actions";
import { EvidenceChip } from "@/components/Evidence";
import { fmtDeadline, fmtTime, stateHeadline } from "@/components/ui";
import { actorKindLabel, eventLabel, scopeLabel, sentence } from "@/lib/labels";

export function MachinePanel({ cfg, c, canAct, canPrepare, isAdmin, decided, viewerCountry, localParty }: { cfg: CountryConfig; c: Case; canAct: boolean; canPrepare: boolean; isAdmin: boolean; decided: ReadonlySet<string>; viewerCountry: string | null; localParty: string | null }) {
  const sm = cfg.stateMachine;
  const current = sm.states[c.machine.state];
  const last = c.machine.history.at(-1);
  // Where the law names the filer, a party established elsewhere prepares and the local party files.
  const filedElsewhere = !isAdmin && !!sm.applicantFiledBy && viewerCountry !== cfg.code;
  const options = eventsFor(cfg, c.machine.state, c.facts).filter((o) => o.transition.event !== "lapse");
  const scope = evaluateScope(cfg, c.facts);
  // Applicant filings wait on a settled scope; the core refuses them otherwise, so they are not offered.
  const pathway = buildPathway(cfg, c.facts, decided);
  const stops = pathway.stages.flatMap((s) => s.stops);
  const filingHeld = scope.kind !== "in_scope" || stops.length > 0;
  const events = options.filter((o) => o.status === "available").map((o) => o.transition).filter((t) => !(filingHeld && t.actor === "applicant" && t.event !== "withdraw"));
  const openStages = pathway.stages.filter((s) => s.status === "halted" || s.status === "stopped");
  const guarded = options.filter((o) => o.status === "unresolved");
  const clocks = sm.clocks;
  // Days left are computed for now, on every render, not read from the last administrator check.
  // Nothing is written: a lapse is still applied only when a clock is checked.
  const live = tick(cfg, c.machine, new Date()).snap.clocks;
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
      {last?.note && last.to === c.machine.state && (
        <p className="small last-act"><strong>Recorded with &ldquo;{eventLabel(last.event)}&rdquo;</strong> (by {actorKindLabel(last.actor)}, {fmtTime(last.at)}): <q>{last.note}</q></p>
      )}
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
            const lv = live[k.id];
            const days = (n: number) => `${n} ${k.dayKind} day${n === 1 ? "" : "s"}`;
            // The deadline runs to the end of its last day where the authority sits, so the final day is
            // "today", not "zero left", and "past" means that day has ended there.
            const left = lv?.daysRemaining == null ? "" : lv.pastDeadline
              ? ` · past the deadline${lv.daysRemaining < 0 ? ` by ${days(-lv.daysRemaining)}` : ""}, not yet recorded as lapsed`
              : lv.daysRemaining === 0 ? " · today is the final day" : ` · ${days(lv.daysRemaining)} left after today`;
            return (
              <div key={k.id} className={`clock ${st?.lapsed ? "lapsed" : st?.suspended ? "suspended" : ""}`}>
                <span>
                  {k.label} · {k.days} {k.dayKind} days{k.extendableDays ? `, extendable by up to ${k.extendableDays}` : ""}
                  {(st?.extendedDays ?? 0) > 0 && <> · <strong>extended by {st!.extendedDays}</strong></>}
                </span>
                <span>
                  {!st?.startedAt && "Not started"}
                  {st?.startedAt && !st.lapsed && (st.suspended
                    ? `Suspended since ${fmtTime(st.suspendedAt ?? null, false)}: this time does not count`
                    : running
                      ? `Deadline ${fmtDeadline(st.deadline, cfg.timeZone)}${left}`
                      : `No longer running (the case moved on before ${fmtDeadline(st.deadline, cfg.timeZone)})`)}
                  {st?.lapsed && "Lapsed · remedy against the administrator"}
                  {st?.beyondCalendar && <span className="mute"> · beyond the holiday calendar ({cfg.calendar?.coversThrough}), weekends only</span>}
                  {st?.restartedAfterLapse && !st.lapsed && (
                    <span className="mute" style={{ display: "block" }}>
                      <EvidenceChip reg={{ state: "inferred", marker: "[GL]", value: "GENE-LINK tracking deadline", note: "No source sets a new statutory deadline after a lapse.", drives: false, executable: true }} short /> Restarted when the authority resumed on {fmtTime(st.restartedAfterLapse.at, false)}. The statutory deadline{st.restartedAfterLapse.missedDeadline ? ` (${fmtDeadline(st.restartedAfterLapse.missedDeadline, cfg.timeZone)})` : ""} was recorded as lapsed, and the remedy against the administrator stands. The date above is GENE-LINK&apos;s tracking aid, not a deadline the law sets.
                    </span>
                  )}
                </span>
              </div>
            );
          })}
          {clocks.map((k) => {
            const name = k.label.split(" (")[0];
            // Lower-case an ordinary first word ("Determination clock"), never a citation ("Art. 28 assent clock").
            const inline = /^[A-Z][a-z]/.test(name) && !/^Art\b/.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
            return <p key={`basis-${k.id}`} className="small mute">How the {inline} counts: <EvidenceChip reg={k.basis} short /> {k.basis.value} <span className="mono">{k.basis.citation}</span></p>;
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
                <input name="note" type="text" aria-label="Resolution or notice the extension rests on" placeholder="Resolution or notice it rests on" required style={{ flex: 1, minWidth: 200 }} />
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
        {filingHeld && options.some((o) => o.transition.actor === "applicant" && o.transition.event !== "withdraw") && (
          <p className="small halt-box" role="status">{stops.length && scope.kind === "in_scope"
            ? `Filing is refused while a prohibition applies on these facts: ${stops.map((x) => x.text).join(" ")}`
            : `Filing is held until scope is settled (now: ${scopeLabel(scope.kind).toLowerCase()}). ${scope.kind === "undetermined" ? "Answer the intake questions first." : scope.kind === "escalate" ? "Scope on these facts is an open legal question routed to its owner." : "The case is out of scope on the facts entered."}`}</p>
        )}
        {!isAdmin && !filingHeld && openStages.length > 0 && events.some((t) => t.actor === "applicant" && t.event !== "withdraw") && (
          <p className="small mute">Filing now proceeds with {openStages.length} stage{openStages.length === 1 ? "" : "s"} still open ({openStages.map((s) => s.stage.title).join("; ")}). That is the parties&apos; decision to take; the audit record notes which questions were open when it was filed.</p>
        )}
        {events.length === 0 && guarded.length === 0 && <p className="small mute">Terminal state. No further events are declared.</p>}
        {guarded.map((o) => (
          <div key={`${o.transition.event}-${o.transition.to}`} className="halt-box small" role="status">
            <strong>{eventLabel(o.transition.event)}</strong> ({sm.transitions.filter((t) => t.from === o.transition.from && t.event === o.transition.event).length > 1 ? "where it leads depends on the answer" : stateHeadline(sm.states[o.transition.to].label)}) depends on a fact not yet answered: {o.missing.map((f) => promptFor(cfg, f).replace(/[.?!]\s*$/, "")).join("; ")}. The engine does not choose a branch of the law for the parties; answer it on the intake form.
          </div>
        ))}
        {events.length > 0 && !canAct && (
          <p className="small mute">{canPrepare
            ? "Your seat prepares the bundle: facts, documents and work in progress. Filing before the regulator (submit, resubmit, withdraw, appeal) is a commitment the organisation stands behind and takes an authorised signatory or administrator seat."
            : "Your seat can view but not record regulator events."}</p>
        )}
        {events.length > 0 && canAct && (() => {
          // Each side records its own acts: the administrator the authority's, a party's signatory the applicant's.
          const mine = events.filter((t) => (isAdmin ? t.actor !== "applicant" : t.actor === "applicant" && !filedElsewhere));
          const held = events.length - mine.length;
          if (filedElsewhere && events.some((t) => t.actor === "applicant")) {
            return (
              <p className="small halt-box" role="status">
                In {cfg.name} the applicant&apos;s filings are made by a registrant established there. <EvidenceChip reg={sm.applicantFiledBy!.reg} short /> {sm.applicantFiledBy!.reg.value} <span className="mono">{sm.applicantFiledBy!.reg.citation}</span>{" "}
                {localParty ? `Your organisation prepares the bundle; an authorised signatory of ${localParty} records ${events.filter((t) => t.actor === "applicant").map((t) => `"${eventLabel(t.event)}"`).join(", ")}.` : `No party to this case is established in ${cfg.name}, so nobody on it can make the filing yet.`}
              </p>
            );
          }
          return (
            <form action={fireEvent.bind(null, c.id)} className="stack">
              <input name="note" type="text" aria-label="Note for the audit record (optional)" placeholder="Note for the audit record (optional)" />
              <div className="row">
                {mine.map((t) => (
                  <button key={t.event} className={`btn small ${t.actor === "authority" ? "secondary" : t.actor === "system" ? "ghost" : ""}`} type="submit" name="event" value={t.event} title={`Actor: ${t.actor}. Target: ${sm.states[t.to].label}`}>
                    {eventLabel(t.event)} <span className="mute">· {sentence(t.actor).toLowerCase()}</span>
                  </button>
                ))}
              </div>
              {mine.length === 0 && <p className="small mute">{isAdmin
                ? `No authority act is declared from here. The next step is the parties' (${events.map((t) => eventLabel(t.event)).join(", ")}), recorded by their signatory.`
                : "Your seat has no applicant act at this stage. The next events belong to the authority."}</p>}
              {held > 0 && mine.length > 0 && <p className="small mute">{isAdmin ? `${held} applicant event${held === 1 ? " is" : "s are"} the parties' to record and not offered to the administrator.` : `${held} authority or system event${held === 1 ? " is" : "s are"} not shown to your seat.`}</p>}
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
              <li key={i}><time>{fmtTime(h.at)}</time> <strong>{eventLabel(h.event)}</strong> · {stateHeadline(sm.states[h.from]?.label ?? h.from)} → {stateHeadline(sm.states[h.to]?.label ?? h.to)} <span className="mute">(by {actorKindLabel(h.actor)})</span>{h.note && <div className="mute">{h.note}</div>}</li>
            ))}
          </ol>
        </details>
      )}
    </section>
  );
}
