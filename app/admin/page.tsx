import Link from "next/link";
import { forbidden, unauthorized } from "next/navigation";
import { getPlatform } from "@/core";
import { decideManualReviewFromConsole, decideVerification } from "@/app/actions";
import { ErrorNotice, PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function AdminPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const session = await getSession();
  if (session.kind === "anonymous") unauthorized();
  if (session.kind !== "admin") forbidden();
  const platform = getPlatform();
  const orgs = platform.store.organisations.list();
  const pending = orgs.filter((o) => o.verification.status === "pending");
  const escalations = platform.store.escalations.list();
  const reviews = platform.store.manualReviews.list();
  const chain = platform.verifyAudit();
  const interventions = platform.store.audit.list().filter((e) => e.actor.role === "administrator");
  const signals = platform.store.demandSignals.list();
  const byWant = signals.reduce<Record<string, number>>((m, s) => ({ ...m, [s.want]: (m[s.want] ?? 0) + 1 }), {});

  return (
    <div className="container">
      <PageHead eyebrow="Administration console (privileged, separate origin in the MVP)" title="Administration" lede="Organisation verification, seat and permission oversight, support interventions, audit review, and platform content and configuration. Every action here is recorded with a reason. Administrators watch and intervene. They are not a gate the journey waits on." />
      <ErrorNotice error={sp.error} sig={sp.sig} />
      <div className="grid cols-4" style={{ marginBottom: 16 }}>
        <div className="card flat"><div className="eyebrow">Verification queue</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{pending.length}</div></div>
        <div className="card flat"><div className="eyebrow">Open escalations</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{escalations.filter((e) => e.status === "open").length}</div><small className="mute">answered through configuration review</small></div>
        <div className="card flat"><div className="eyebrow">Manual reviews pending</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{reviews.filter((r) => r.status === "pending_human_judgment").length}</div></div>
        <div className="card flat"><div className="eyebrow">Audit chain</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{chain.ok ? "OK" : "BROKEN"}</div><small className="mute">{chain.ok ? `${chain.length} entries` : `at ${chain.brokenAt}`} · <Link href="/admin/audit">review</Link></small></div>
      </div>

      <div className="grid cols-2">
        <section className="card">
          <h3>Organisation verification</h3>
          {pending.length === 0 && <p className="small mute">Queue empty.</p>}
          {pending.map((o) => (
            <div key={o.id} className="card flat" style={{ marginTop: 8 }}>
              <strong><Link href={`/organisations/${o.id}`}>{o.name}</Link></strong> <span className="small mute">· {o.kind.replace("_", " ")} · {o.country} · method {o.verification.method?.replace("_", " ")}</span>
              <p className="small">{o.description}</p>
              {orgs.some((x) => x.id !== o.id && x.name.trim().toLowerCase() === o.name.trim().toLowerCase()) && (
                <p className="small halt-box" role="status">Another organisation on the platform already uses this name. Check that this request is not an impersonation before verifying.</p>
              )}
              <form action={decideVerification} className="stack">
                <input type="hidden" name="organisationId" value={o.id} />
                <input name="reason" type="text" placeholder="Reason, recorded in the audit chain" required />
                <div className="row">
                  <button className="btn small" type="submit" name="outcome" value="verified">Verify</button>
                  <button className="btn small danger" type="submit" name="outcome" value="declined">Decline</button>
                </div>
              </form>
            </div>
          ))}
          <h4 style={{ marginTop: 14 }}>All organisations</h4>
          <table className="data compact">
            <thead><tr><th>Organisation</th><th>Functions</th><th>Verification</th></tr></thead>
            <tbody>{orgs.map((o) => <tr key={o.id}><td><Link href={`/organisations/${o.id}`}>{o.name}</Link></td><td className="small">{o.functions.join(", ")}</td><td className="small">{o.verification.status}</td></tr>)}</tbody>
          </table>
        </section>

        <section className="card">
          <h3>Escalations (R3)</h3>
          <p className="small soft">Each is an unresolved requirement a case depends on. Answering one is a configuration change with legal review, recorded against the country file, never an in-case override.</p>
          {escalations.length === 0 && <p className="small mute">None.</p>}
          {escalations.map((e) => (
            <div key={e.id} className="small" style={{ padding: "8px 0", borderBottom: "1px solid var(--rule-soft)" }}>
              <span className="ev unknown"><span className="m">?</span>{e.status}</span> <Link href={`/cases/${e.caseId}`}>{e.caseId}</Link> · stage {e.stageId}
              <div>{e.question.slice(0, 160)}{e.question.length > 160 ? "…" : ""}</div>
              <div className="mute">→ {e.owner}{e.ownerName ? ` (${e.ownerName})` : " · name pending Landscape Alliance"} · raised {fmtTime(e.raisedAt)}</div>
            </div>
          ))}
        </section>

        <section className="card">
          <h3>Manual reviews (R5)</h3>
          <p className="small soft">Judgments no system can make and no party may self-declare. Recorded once, by the reviewer seat, with a reason. Immutable once recorded.</p>
          {reviews.length === 0 && <p className="small mute">None.</p>}
          {reviews.map((r) => (
            <div key={r.id} className="card flat" style={{ marginTop: 8 }}>
              <div className="small"><Link href={`/cases/${r.caseId}`}>{r.caseId}</Link> · {r.reviewId.replace(/_/g, " ")}</div>
              <p className="small" style={{ margin: "4px 0" }}>{r.question}</p>
              {r.status === "decided" && r.decision ? (
                <p className="small"><strong>Decided</strong> by {r.decision.by} on {fmtTime(r.decision.at)}: {r.decision.outcome}. Reason: {r.decision.reason}</p>
              ) : (
                <form action={decideManualReviewFromConsole} className="row">
                  <input type="hidden" name="recordId" value={r.id} />
                  <input name="outcome" type="text" placeholder="Judgment" required style={{ flex: 1, minWidth: 140 }} />
                  <input name="reason" type="text" placeholder="Reason" required style={{ flex: 2, minWidth: 200 }} />
                  <button className="btn small" type="submit">Record</button>
                </form>
              )}
            </div>
          ))}
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
          <ol className="timeline">{interventions.slice(-8).reverse().map((e) => <li key={e.seq}><time>{fmtTime(e.at)}</time> <strong>{e.action}</strong> {e.subject.type} {e.subject.id}<div className="mute mono" style={{ fontSize: "0.72rem" }}>{JSON.stringify(e.detail)}</div></li>)}</ol>
        </section>

        <section className="card">
          <h3>Demand signals</h3>
          <p className="small soft">Each &ldquo;I have, I want&rdquo; declaration is kept as a demand signal: what was sought, and by what kind of organisation. Never who. Free text is stored only after identifying content is stripped. This is how demand for the held-open screening corridor is measured.</p>
          {signals.length === 0 && <p className="small mute">None declared since the last reset.</p>}
          {signals.length > 0 && (
            <>
              <table className="data compact">
                <thead><tr><th>Objective</th><th>Declarations</th></tr></thead>
                <tbody>{Object.entries(byWant).sort((a, b) => b[1] - a[1]).map(([w, n]) => <tr key={w}><td>{w.replaceAll("_", " ")}</td><td>{n}</td></tr>)}</tbody>
              </table>
              <ol className="timeline" style={{ marginTop: 8 }}>{signals.slice(-6).reverse().map((d) => <li key={d.id}><time>{fmtTime(d.at)}</time> {d.want.replaceAll("_", " ")} · {d.organisationKind ? `${d.organisationKind.replaceAll("_", " ")} (${d.organisationCountry}), functions ${d.organisationFunctions.join(", ") || "none"}` : "anonymous visitor"}{d.have && <div className="mute">&ldquo;{d.have}&rdquo;{d.redactions ? ` · ${d.redactions} identifying item${d.redactions === 1 ? "" : "s"} removed` : ""}</div>}</li>)}</ol>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
