import Link from "next/link";
import { forbidden, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { decideManualReviewFromConsole, decideVerification } from "@/app/actions";
import { ErrorNotice, PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";
import { describeAudit, functionsLabel, kindLabel, seatLabel, sentence, stageTitle, subjectLabel, verificationLabel } from "@/lib/labels";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  if (session.kind !== "admin") forbidden();
  const platform = getPlatform();
  const orgs = platform.store.organisations.list();
  // A find box narrows the queue and the organisation table, so an administrator asked about one
  // organisation does not page through everyone else's.
  const find = (sp.find ?? "").trim().toLowerCase().slice(0, 100);
  const matches = (o: (typeof orgs)[number]) => !find || `${o.name} ${o.id} ${o.country} ${o.kind}`.toLowerCase().includes(find);
  const pendingAll = orgs.filter((o) => o.verification.status === "pending");
  const pending = pendingAll.filter(matches);
  const escalations = platform.store.escalations.list();
  const reviews = platform.store.manualReviews.list();
  const chain = platform.verifyAudit();
  const interventions = platform.store.audit.list().filter((e) => e.actor.role === "administrator");
  const signals = platform.demandSignalSummary();
  // Technical requests are routed to GENE-LINK support: they queue here. Expert requests stay with the parties.
  const technical = platform.store.cases.list().flatMap((c) => c.supportRequests.filter((r) => r.kind === "technical").map((r) => ({ ...r, caseId: c.id }))).sort((a, b) => b.at.localeCompare(a.at));
  const byWant = signals.byWant;
  // Long lists are paged: a busy instance (or a registration flood) must not turn the console into one
  // half-megabyte page. The queue shows the oldest requests first, so nobody waits behind newcomers.
  const page = (key: string) => Math.max(1, Math.floor(Number(sp[key]) || 1));
  const queuePage = page("queue");
  const orgsPage = page("orgs");
  const escPage = page("esc");
  const QUEUE = 10, ORGS = 25, ESC = 15;
  const queue = pending.slice((queuePage - 1) * QUEUE, queuePage * QUEUE);
  const orgsShown = orgs.filter(matches);
  const orgRows = orgsShown.slice((orgsPage - 1) * ORGS, orgsPage * ORGS);
  const escSorted = [...escalations].sort((a, b) => (a.status === "open" ? 0 : 1) - (b.status === "open" ? 0 : 1));
  const escRows = escSorted.slice((escPage - 1) * ESC, escPage * ESC);
  const reviewsSorted = [...reviews].sort((a, b) => (a.status === "pending_human_judgment" ? 0 : 1) - (b.status === "pending_human_judgment" ? 0 : 1));
  const pager = (key: string, current: number, total: number, per: number) => {
    const pages = Math.ceil(total / per);
    if (pages <= 1) return null;
    const href = (n: number) => {
      const q = new URLSearchParams(Object.entries(sp).filter(([k, v]) => k !== key && k !== "error" && k !== "sig" && typeof v === "string") as [string, string][]);
      q.set(key, String(n));
      return `/admin?${q.toString()}`;
    };
    return (
      <nav className="row small" aria-label="Pages" style={{ marginTop: 8 }}>
        {current > 1 && <Link href={href(current - 1)}>Previous</Link>}
        <span className="mute">Page {Math.min(current, pages)} of {pages} · {total} in all</span>
        {current < pages && <Link href={href(current + 1)}>Next</Link>}
      </nav>
    );
  };

  return (
    <div className="container">
      <PageHead eyebrow="Administration console (privileged, separate origin in the MVP)" title="Administration" lede="Organisation verification, seat and permission oversight, support interventions, audit review, and platform content and configuration. Every action here is recorded with a reason. Administrators watch and intervene. They are not a gate the journey waits on." />
      <ErrorNotice error={sp.error} sig={sp.sig} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card flat"><div className="eyebrow">Verification queue</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{pendingAll.length}</div></div>
        <div className="card flat"><div className="eyebrow">Open escalations</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{escalations.filter((e) => e.status === "open").length}</div><small className="mute">answered through configuration review</small></div>
        <div className="card flat"><div className="eyebrow">Manual reviews pending</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{reviews.filter((r) => r.status === "pending_human_judgment").length}</div></div>
        <div className="card flat"><div className="eyebrow">Audit chain</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{chain.ok ? "OK" : "BROKEN"}</div><small className="mute">{chain.ok ? `${chain.length} entries` : `at ${chain.brokenAt}`} · <Link href="/admin/audit">review</Link></small></div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h3>Organisation verification</h3>
          <form method="get" className="row" role="search" style={{ marginBottom: 8 }}>
            <label htmlFor="find" className="sr-only">Find an organisation</label>
            <input id="find" name="find" type="search" defaultValue={sp.find ?? ""} placeholder="Find by name, id, country or kind" style={{ flex: 1 }} />
            <button className="btn small secondary" type="submit">Find</button>
            {find && <Link className="small" href="/admin">Clear</Link>}
          </form>
          {pending.length === 0 && <p className="small mute">{find ? "No pending request matches." : "Queue empty."}</p>}
          {queue.map((o) => (
            <div key={o.id} className="card flat" style={{ marginTop: 8 }}>
              <strong><Link href={`/organisations/${o.id}`}>{o.name}</Link></strong> <span className="small mute">· {kindLabel(o.kind)} · {o.country} · {sentence(o.verification.method)}</span>
              <p className="small">{o.description}</p>
              {orgs.some((x) => x.id !== o.id && x.name.trim().toLowerCase() === o.name.trim().toLowerCase()) && (
                <p className="small halt-box" role="status">Another organisation on the platform already uses this name. Check that this request is not an impersonation before verifying.</p>
              )}
              <form action={decideVerification} className="stack">
                <input type="hidden" name="organisationId" value={o.id} />
                <input name="reason" type="text" aria-label="Reason for the verification decision" placeholder="Reason, recorded in the audit chain" required />
                <div className="row">
                  <button className="btn small" type="submit" name="outcome" value="verified">Verify</button>
                  <button className="btn small danger" type="submit" name="outcome" value="declined">Decline</button>
                </div>
              </form>
            </div>
          ))}
          {pager("queue", queuePage, pending.length, QUEUE)}
          <h4 style={{ marginTop: 14 }}>All organisations</h4>
          <table className="data compact">
            <thead><tr><th>Organisation</th><th>Kind, country</th><th>Functions</th><th>Verification</th></tr></thead>
            <tbody>{orgRows.map((o) => <tr key={o.id}><td><Link href={`/organisations/${o.id}`}>{o.name}</Link><div className="mono mute" style={{ fontSize: "0.72rem" }}>{o.id}</div></td><td className="small">{kindLabel(o.kind)}, {o.country}</td><td className="small">{functionsLabel(o.functions)}</td><td className="small">{verificationLabel(o.verification.status)}</td></tr>)}</tbody>
          </table>
          {pager("orgs", orgsPage, orgsShown.length, ORGS)}
        </section>

        <section className="card">
          <h3>Escalations (R3)</h3>
          <p className="small soft">Each is an unresolved requirement a case depends on. Answering one is a configuration change with legal review, recorded against the country file, never an in-case override.</p>
          {escalations.length === 0 && <p className="small mute">None.</p>}
          {escRows.map((e) => (
            <div key={e.id} className="small" style={{ padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
              <span className="ev unknown"><span className="m">?</span>{sentence(e.status)}</span> <Link href={`/cases/${e.caseId}`}>{platform.store.cases.get(e.caseId)?.title ?? e.caseId}</Link> · {stageTitle(platform.countries.get(platform.store.cases.get(e.caseId)?.providerCountry ?? ""), e.stageId)}
              <div>{e.question.slice(0, 160)}{e.question.length > 160 ? "…" : ""}</div>
              <div className="mute">→ {e.owner}{e.ownerName ? ` (${e.ownerName})` : " · name pending Landscape Alliance"} · raised {fmtTime(e.raisedAt)}</div>
            </div>
          ))}
          {pager("esc", escPage, escSorted.length, ESC)}
        </section>

        <section className="card">
          <h3>Manual reviews (R5)</h3>
          <p className="small soft">Judgments no system can make and no party may self-declare. Recorded once, by the reviewer seat, with a reason. Immutable once recorded.</p>
          {reviews.length === 0 && <p className="small mute">None.</p>}
          {reviewsSorted.map((r) => {
            // Name the case the judgment is for, not only its id: a judgment recorded on the wrong case is immutable.
            const rc = platform.store.cases.get(r.caseId);
            const parties = rc ? rc.participants.map((p) => platform.store.organisations.get(p.organisationId)?.name ?? p.organisationId).join(" and ") : "";
            return (
            <div key={r.id} className="card flat" style={{ marginTop: 8 }}>
              <div className="small"><strong><Link href={`/cases/${r.caseId}`}>{rc?.title ?? r.caseId}</Link></strong> <span className="mute">· {rc ? platform.countries.get(rc.providerCountry)?.name ?? rc.providerCountry : ""} · {r.caseId}</span></div>
              {parties && <div className="small mute">Parties: {parties}</div>}
              <div className="small">{sentence(r.reviewId)} · <span className={`tag ${r.status === "decided" ? "" : "open"}`}>{r.status === "decided" ? "Decided" : "Waiting for a judgment"}</span></div>
              <p className="small" style={{ margin: "4px 0" }}>{r.question}</p>
              {r.status === "decided" && r.decision ? (
                <p className="small"><strong>Decided</strong> by {r.decision.by} on {fmtTime(r.decision.at)}: {r.decision.outcome}. Reason: {r.decision.reason}</p>
              ) : (
                <form action={decideManualReviewFromConsole} className="row">
                  <input type="hidden" name="recordId" value={r.id} />
                  <input name="outcome" type="text" aria-label={`Judgment for ${rc?.title ?? r.caseId}`} placeholder="Judgment" required style={{ flex: 1, minWidth: 140 }} />
                  <input name="reason" type="text" aria-label={`Reason for the judgment on ${rc?.title ?? r.caseId}`} placeholder="Reason" required style={{ flex: 2, minWidth: 200 }} />
                  <button className="btn small" type="submit" aria-label={`Record judgment on ${rc?.title ?? r.caseId}`}>Record judgment</button>
                </form>
              )}
            </div>
            );
          })}
        </section>

        <section className="card">
          <h3>Technical support requests</h3>
          <p className="small soft">Requests the parties routed to GENE-LINK technical support. Answer on the case with a recorded intervention, so the reply sits on the case and the audit chain. Requests for an expert are the parties&apos; to take to their own adviser and do not queue here.</p>
          {technical.length === 0 && <p className="small mute">None.</p>}
          {technical.map((r) => {
            const answered = (platform.store.cases.get(r.caseId)?.interventions ?? []).some((i) => i.at >= r.at);
            return (
              <div key={r.id} className="small" style={{ padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
                <span className={`tag ${answered ? "" : "open"}`}>{answered ? "intervention since" : "waiting"}</span> <Link href={`/cases/${r.caseId}`}>{platform.store.cases.get(r.caseId)?.title ?? r.caseId}</Link> · {fmtTime(r.at)} · {seatLabel(platform, r.bySeatId)}
                <div className="mute">{r.note}</div>
              </div>
            );
          })}
        </section>

        <section className="card">
          <h3>Country configuration</h3>
          <p className="small soft">Read-only viewer with every value&apos;s evidence class. Changes are pull requests against the country files with legal review for any evidence-class change (R2, R4).</p>
          <ul style={{ paddingLeft: 18 }}>
            {Array.from(platform.countries.values()).map((c) => (
              <li key={c.code}><Link href={`/admin/config/${c.code}`}><strong>{c.name}</strong></Link> <span className="small mute">· {c.stages.length} stages · {Object.keys(c.stateMachine.states).length} states · {c.outputs.length} instrument{c.outputs.length === 1 ? "" : "s"} · {c.openQuestions.length} open questions · {c.liveLayers.length} live layer{c.liveLayers.length === 1 ? "" : "s"}{c.tag ? ` · ${c.tag}` : ""}</span></li>
            ))}
          </ul>
          <h4 style={{ marginTop: 14 }}>Recent administrative actions</h4>
          {interventions.length === 0 && <p className="small mute">None yet.</p>}
          <ol className="timeline">{interventions.slice(-8).reverse().map((e) => <li key={e.seq}><time>{fmtTime(e.at)}</time> {describeAudit(platform, e)}<div className="mute">{subjectLabel(platform, e.subject)}</div></li>)}</ol>
        </section>

        <section className="card">
          <h3>Demand signals</h3>
          <p className="small soft">Each &ldquo;I have, I want&rdquo; declaration is kept as a demand signal: what was sought, and by what kind of organisation. Never who. Free text is stored only after identifying content is stripped. This is how demand for the held-open screening corridor is measured.</p>
          {signals.total === 0 && <p className="small mute">None declared since the last reset.</p>}
          {signals.total > 0 && (
            <>
              <table className="data compact">
                <thead><tr><th>Objective</th><th>Declarations</th></tr></thead>
                <tbody>{Object.entries(byWant).sort((a, b) => b[1] - a[1]).map(([w, n]) => <tr key={w}><td>{w.replaceAll("_", " ")}</td><td>{n}</td></tr>)}</tbody>
              </table>
              <p className="small mute">{signals.total} declaration{signals.total === 1 ? "" : "s"} counted since the instance started{signals.kept < signals.total ? `; the newest ${signals.kept} are kept in full on this demonstration instance` : ""}.</p>
              <ol className="timeline" style={{ marginTop: 8 }}>{signals.recent.map((d) => <li key={d.id}><time>{fmtTime(d.at)}</time> {d.want.replaceAll("_", " ")} · {d.organisationKind ? `${d.organisationKind.replaceAll("_", " ")} (${d.organisationCountry}), functions ${d.organisationFunctions.join(", ") || "none"}` : "anonymous visitor"}{d.have && <div className="mute">&ldquo;{d.have}&rdquo;{d.redactions ? ` · ${d.redactions} identifying item${d.redactions === 1 ? "" : "s"} removed` : ""}</div>}</li>)}</ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
