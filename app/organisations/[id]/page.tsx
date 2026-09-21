import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform } from "@/core";
import { requestVerification } from "@/app/actions";
import { ErrorNotice, Notice, PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

const FN_LABEL: Record<string, string> = { seeking: "Seeking (buys from the South)", providing: "Providing (supplies)", advising: "Advising on compliance", brokering: "Brokering", custodian: "Community custodian", learning: "Learning" };

export default async function OrganisationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const platform = getPlatform();
  const org = platform.store.organisations.get(id);
  if (!org) notFound();
  const session = await getSession();
  const seats = platform.store.memberships.list().filter((m) => m.organisationId === id);
  const isMember = session.kind === "seat" && session.actor.organisation.id === id;
  const isAdminSeat = isMember && session.actor.seat.permission === "administrator";
  const listings = platform.store.listings.list().filter((l) => l.organisationId === id);
  const publicView = !isMember && session.kind !== "admin";

  return (
    <div className="container">
      <PageHead eyebrow={`Organisation · ${org.kind.replace("_", " ")} · ${org.country}`} title={publicView && !platform.store.cases.list().some((c) => c.participants.some((p) => p.organisationId === id) && session.kind === "seat" && c.participants.some((p) => p.organisationId === session.actor.organisation.id)) ? "Organisation (identity withheld outside a match)" : org.name}>
        <div className="row">
          <span className={`status-pill ${org.verification.status === "verified" ? "complete" : org.verification.status === "pending" ? "in_progress" : "informational"}`}>Verification: {org.verification.status}</span>
          {org.verification.method && <span className="small mute">via {org.verification.method.replace("_", " ")}</span>}
        </div>
      </PageHead>
      <ErrorNotice error={sp.error} />
      <div className="two-col">
        <div className="stack">
          <section className="card">
            <h3>Market functions</h3>
            <p className="small soft">What an organisation does in the market is a property of the organisation, and one organisation may hold several at once. It is separate from what any person may do on its behalf.</p>
            <div className="tags">{org.functions.map((f) => <span key={f} className="tag fn">{FN_LABEL[f] ?? f}</span>)}</div>
            {org.functions.length >= 3 && <p className="small mute" style={{ marginTop: 8 }}>A broker buying from the South, selling to the North and advising on compliance is one organisation with three market functions, not three accounts.</p>}
            <p style={{ marginTop: 10 }}>{org.description}</p>
          </section>
          <section className="card">
            <h3>Trust signals</h3>
            <p className="small soft">Credentials are shown as facts with their verification status. No score is computed. Section 6 of the RFP asks to avoid opaque or unjustified automated reputation scoring.</p>
            {org.credentials.length === 0 && <p className="small mute">None recorded.</p>}
            <ul className="small" style={{ paddingLeft: 18 }}>{org.credentials.map((c, i) => <li key={i}><strong>{c.title}</strong> · {c.issuer} · <span className="tag">{(c.reg ?? "self declared").replaceAll("_", " ")}</span></li>)}</ul>
            {platform.store.cases.list().filter((c) => c.participants.some((p) => p.organisationId === id) && platform.agreementsFor(c.id).some((a) => a.status === "executed")).length > 0 && (
              <p className="small">Recorded prior activity: {platform.store.cases.list().filter((c) => c.participants.some((p) => p.organisationId === id) && platform.agreementsFor(c.id).some((a) => a.status === "executed")).length} executed agreement(s) on the platform. A fact, not a score.</p>
            )}
          </section>
          {(isMember || session.kind === "admin") && (
            <section className="card">
              <h3>Seats</h3>
              <p className="small soft">What a person may do on this organisation&apos;s behalf is a property of their seat. Four fixed levels in the MVP: administrator, authorised signatory, member, viewer.</p>
              <table className="data compact">
                <thead><tr><th>Person</th><th>Seat permission</th><th>Since</th><th>Invited by</th></tr></thead>
                <tbody>
                  {seats.map((s) => { const p = platform.store.persons.get(s.personId)!; return <tr key={s.id}><td>{p.name}<div className="mute small">{p.email}{p.orcid ? ` · ORCID ${p.orcid}` : ""}</div></td><td><strong>{s.permission.replace("_", " ")}</strong></td><td className="small">{s.since}</td><td className="small mute">{s.invitedBy ?? "founding seat"}</td></tr>; })}
                </tbody>
              </table>
              <p className="small mute">Seat provisioning by email invitation is minimal in the MVP by design. It is an administrator action recorded in the audit chain.</p>
            </section>
          )}
          {listings.length > 0 && (
            <section className="card flat">
              <h3>Listings</h3>
              <ul className="small" style={{ paddingLeft: 18 }}>{listings.map((l) => <li key={l.id}><Link href={`/listings/${l.id}`}>{l.glId}</Link> · {l.resourceClass}</li>)}</ul>
            </section>
          )}
        </div>
        <aside className="stack">
          <section className="card">
            <h3>Verification gate</h3>
            <p className="small soft">Verification is on the organisation, not the person. Path A: ORCID or institutional email. Path B: institutional email plus manual vetting or vouching for community seed banks, IPLC holders and smaller institutions.</p>
            {org.verification.status === "verified" && <Notice kind="ok">Verified by {org.verification.decidedBy} on {fmtTime(org.verification.decidedAt)}. Reason: {org.verification.reason}</Notice>}
            {org.verification.status === "pending" && <Notice kind="pending">Pending an administrator decision with a recorded reason. Method: {org.verification.method?.replace("_", " ")}.</Notice>}
            {org.verification.status === "declined" && <Notice kind="halt">Declined: {org.verification.reason}. A declined organisation cannot signal interest or be signalled back to until a new request is decided.</Notice>}
            {isAdminSeat && org.verification.status !== "verified" && org.verification.status !== "pending" && (
              <form action={requestVerification.bind(null, id)} className="stack" style={{ marginTop: 8 }}>
                <select name="method" aria-label="Verification method"><option value="institutional_email">Institutional email (Path A)</option><option value="orcid">ORCID (Path A)</option><option value="vouching">Vouching by verified org (Path B)</option><option value="manual_vetting">Manual vetting (Path B)</option></select>
                <button className="btn small" type="submit">Request verification</button>
              </form>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
