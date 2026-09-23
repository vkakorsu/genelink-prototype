import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform } from "@/core";
import { createListing, decideVerification, inviteColleague, requestVerification, revokeSeat } from "@/app/actions";
import { FUNCTION_CODES } from "@/core/domain/listings";
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
  const canPublish = isMember && (session.actor.seat.permission === "administrator" || session.actor.seat.permission === "authorised_signatory");
  const activeAdmins = seats.filter((s) => !s.revoked && s.permission === "administrator").length;
  const configured = Array.from(platform.countries.values());
  const listings = platform.store.listings.list().filter((l) => l.organisationId === id);
  // Identity is revealed by a match, not by knowing an organisation's address. The description,
  // credentials, verification reasoning and the link from an organisation to its listings would
  // together re-identify an anonymised listing (a "Kisumu-based" holder of the "Nyando basin"
  // accessions), so outside the organisation, the administrators and matched counterparties the
  // profile shows the public projection only: kind, country, verification status, market functions.
  const matched = session.kind === "seat" && platform.store.cases.list().some((c) => c.participants.some((p) => p.organisationId === id) && c.participants.some((p) => p.organisationId === session.actor.organisation.id));
  const publicView = !isMember && session.kind !== "admin" && !matched;

  return (
    <div className="container">
      <PageHead eyebrow={`Organisation · ${org.kind.replace("_", " ")} · ${org.country}`} title={publicView ? "Organisation (identity withheld outside a match)" : org.name}>
        <div className="row">
          <span className={`status-pill ${org.verification.status === "verified" ? "complete" : org.verification.status === "pending" ? "in_progress" : "informational"}`}>Verification: {org.verification.status}</span>
          {org.verification.method && <span className="small mute">via {org.verification.method.replace("_", " ")}</span>}
        </div>
      </PageHead>
      <ErrorNotice error={sp.error} sig={sp.sig} />
      <div className="two-col">
        <div className="stack">
          <section className="card">
            <h3>Market functions</h3>
            <p className="small soft">What an organisation does in the market is a property of the organisation, and one organisation may hold several at once. It is separate from what any person may do on its behalf.</p>
            <div className="tags">{org.functions.map((f) => <span key={f} className="tag fn">{FN_LABEL[f] ?? f}</span>)}</div>
            {org.functions.length >= 3 && <p className="small mute" style={{ marginTop: 8 }}>A broker buying from the South, selling to the North and advising on compliance is one organisation with three market functions, not three accounts.</p>}
            {publicView
              ? <p className="small mute" style={{ marginTop: 10 }}>The organisation&apos;s description, credentials and listings are withheld until a match. Together they would identify an organisation behind an anonymised listing.</p>
              : <p style={{ marginTop: 10 }}>{org.description}</p>}
          </section>
          {!publicView && <section className="card">
            <h3>Trust signals</h3>
            <p className="small soft">Credentials are shown as facts with their verification status. No score is computed. Section 6 of the RFP asks to avoid opaque or unjustified automated reputation scoring.</p>
            {org.credentials.length === 0 && <p className="small mute">None recorded.</p>}
            <ul className="small" style={{ paddingLeft: 18 }}>{org.credentials.map((c, i) => <li key={i}><strong>{c.title}</strong> · {c.issuer} · <span className="tag">{(c.reg ?? "self declared").replaceAll("_", " ")}</span></li>)}</ul>
            {platform.store.cases.list().filter((c) => c.participants.some((p) => p.organisationId === id) && platform.agreementsFor(c.id).some((a) => a.status === "executed")).length > 0 && (
              <p className="small">Recorded prior activity: {platform.store.cases.list().filter((c) => c.participants.some((p) => p.organisationId === id) && platform.agreementsFor(c.id).some((a) => a.status === "executed")).length} executed agreement(s) on the platform. A fact, not a score.</p>
            )}
          </section>}
          {(isMember || session.kind === "admin") && (
            <section className="card">
              <h3>Seats</h3>
              <p className="small soft">What a person may do on this organisation&apos;s behalf is a property of their seat. Four fixed levels: administrator, authorised signatory, member, viewer.</p>
              <table className="data compact">
                <thead><tr><th>Person</th><th>Seat permission</th><th>Since</th><th>Invited by</th>{isAdminSeat && <th><span className="sr-only">Revoke</span></th>}</tr></thead>
                <tbody>
                  {seats.map((s) => {
                    const p = platform.store.persons.get(s.personId)!;
                    const lastAdmin = s.permission === "administrator" && activeAdmins <= 1;
                    return (
                      <tr key={s.id} className={s.revoked ? "mute" : undefined}>
                        <td>{p.name}<div className="mute small">{p.email}{p.orcid ? ` · ORCID ${p.orcid}` : ""}</div></td>
                        <td><strong>{s.permission.replace("_", " ")}</strong>{s.revoked && <div className="small">revoked {fmtTime(s.revoked.at)}: {s.revoked.reason}</div>}</td>
                        <td className="small">{s.since}</td>
                        <td className="small mute">{s.invitedBy ?? "founding seat"}</td>
                        {isAdminSeat && (
                          <td>
                            {!s.revoked && !lastAdmin && (
                              <details className="fold">
                                <summary>Revoke</summary>
                                <form action={revokeSeat.bind(null, id)} className="stack">
                                  <input type="hidden" name="seatId" value={s.id} />
                                  <input name="reason" type="text" aria-label={`Reason for revoking the seat of ${p.name}`} placeholder="Reason, recorded in the audit chain" required />
                                  <button className="btn small danger" type="submit">Revoke this seat</button>
                                </form>
                              </details>
                            )}
                            {!s.revoked && lastAdmin && <span className="small mute">Only administrator</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {isAdminSeat && (
                <details className="fold" style={{ marginTop: 10 }}>
                  <summary>Give a colleague a seat</summary>
                  <form action={inviteColleague.bind(null, id)} className="stack">
                    <div className="field"><label htmlFor="inviteName">Colleague&apos;s name</label><input id="inviteName" name="name" type="text" minLength={2} maxLength={100} placeholder="Fictional person" required /></div>
                    <div className="field"><label htmlFor="invitePermission">Seat permission</label>
                      <select id="invitePermission" name="permission" defaultValue="member">
                        <option value="viewer">Viewer: reads the organisation&apos;s cases</option>
                        <option value="member">Member: prepares facts, documents and drafts</option>
                        <option value="authorised_signatory">Authorised signatory: files, approves, signs, records instruments</option>
                        <option value="administrator">Administrator: all of that, and manages seats</option>
                      </select>
                    </div>
                    <button className="btn small" type="submit">Create the seat</button>
                    <p className="small mute">In the MVP the invitation goes to the colleague&apos;s email and they accept it with a passkey. The prototype holds no email address, so the seat exists at once and appears on the sign-in page. The invitation and any revocation are recorded in the audit chain.</p>
                  </form>
                </details>
              )}
              {!isAdminSeat && isMember && <p className="small mute">Seats are given and revoked by the organisation&apos;s administrator seat, and each change is recorded in the audit chain.</p>}
            </section>
          )}
          {!publicView && (listings.length > 0 || canPublish) && (
            <section className="card flat">
              <h3>Listings</h3>
              {listings.length === 0 && <p className="small mute">Nothing published yet.</p>}
              <ul className="small" style={{ paddingLeft: 18 }}>{listings.map((l) => <li key={l.id} style={{ padding: "4px 0" }}><Link href={`/listings/${l.id}`}>{l.glId}</Link> · {l.side} · {l.resourceClass}{l.withdrawn && <span className="mute"> · withdrawn {fmtTime(l.withdrawn.at)}</span>}</li>)}</ul>
              {canPublish && org.verification.status !== "declined" && (
                <details className="fold" style={{ marginTop: 8 }}>
                  <summary>Publish an offer or a need</summary>
                  <form action={createListing.bind(null, id)} className="stack">
                    <fieldset>
                      <legend>Side</legend>
                      <div className="radio-list">
                        <label><input type="radio" name="side" value="offer" defaultChecked={org.functions.some((f) => f === "providing" || f === "custodian")} required /> Offer: your organisation supplies material or data</label>
                        <label><input type="radio" name="side" value="need" defaultChecked={!org.functions.some((f) => f === "providing" || f === "custodian")} /> Need: your organisation is looking for a supplier</label>
                      </div>
                    </fieldset>
                    <div className="field"><label htmlFor="provenanceCountry">Provider country</label>
                      <select id="provenanceCountry" name="provenanceCountry" defaultValue={configured.some((c) => c.code === org.country) ? org.country : "any"}>
                        {configured.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
                        <option value="any">Any provenance with a lawful pathway (needs only)</option>
                      </select>
                      <p className="small mute">A match opens a case under the provider country&apos;s rules, so an offer names a country with a configured pathway: {configured.map((c) => c.name).join(", ")}.</p>
                    </div>
                    <fieldset>
                      <legend>Functions (one to three)</legend>
                      <div className="radio-list">{FUNCTION_CODES.map((f) => <label key={f}><input type="checkbox" name="functionCode" value={f} style={{ width: "auto" }} /> {f}</label>)}</div>
                      <p className="small mute">An illustrative subset of GENE-LINK&apos;s 48-code function taxonomy. The MVP loads the full list from configuration.</p>
                    </fieldset>
                    <p className="small halt-box">The next four fields are public: anyone can read and search them before a match. Do not name the organisation, the species or the locality here. Email addresses and phone numbers are removed.</p>
                    <div className="field"><label htmlFor="resourceClass">What is offered or sought</label><input id="resourceClass" name="resourceClass" type="text" maxLength={120} placeholder="e.g. Plant metabolite extracts (ex situ)" required /></div>
                    <div className="field"><label htmlFor="publicSummary">Public summary</label><textarea id="publicSummary" name="publicSummary" maxLength={400} required /></div>
                    <div className="field"><label htmlFor="indicativeScale">Indicative scale</label><input id="indicativeScale" name="indicativeScale" type="text" maxLength={120} placeholder="e.g. Gram quantities for screening" /></div>
                    <div className="field"><label htmlFor="publicTaxon">Taxon as published</label><input id="publicTaxon" name="publicTaxon" type="text" maxLength={160} placeholder="e.g. Lamiaceae (family level); leave blank to withhold" /></div>
                    <p className="small soft">Revealed only to a counterparty when a match opens a case:</p>
                    <div className="field"><label htmlFor="speciesDetail">Species and accession detail</label><textarea id="speciesDetail" name="speciesDetail" maxLength={1000} /></div>
                    <div className="field"><label htmlFor="localityDetail">Locality detail</label><textarea id="localityDetail" name="localityDetail" maxLength={1000} /></div>
                    <div className="field"><label htmlFor="fullDescription">Full description</label><textarea id="fullDescription" name="fullDescription" maxLength={1000} /></div>
                    <div className="field"><label htmlFor="dsiExposure">DSI exposure</label>
                      <select id="dsiExposure" name="dsiExposure" defaultValue="none"><option value="none">None</option><option value="possible">Possible</option><option value="likely">Likely</option></select>
                      <p className="small mute">Flags and informs a counterparty. It never asserts a resolved DSI or Cali Fund obligation.</p>
                    </div>
                    <button className="btn small" type="submit">Publish the listing</button>
                    <p className="small mute">Publishing is a statement on the organisation&apos;s behalf, so it takes an authorised signatory or administrator seat. It is recorded in the audit chain.{org.verification.status !== "verified" ? " Until the organisation is verified, the listing shows as verification pending and any match waits at the gate." : ""}</p>
                  </form>
                </details>
              )}
            </section>
          )}
        </div>
        <aside className="stack">
          <section className="card">
            <h3>Verification gate</h3>
            <p className="small soft">Verification is on the organisation, not the person. Path A: ORCID or institutional email. Path B: institutional email plus manual vetting or vouching for community seed banks, IPLC holders and smaller institutions.</p>
            {org.verification.status === "verified" && <Notice kind="ok">Verified by {org.verification.decidedBy} on {fmtTime(org.verification.decidedAt)}.{publicView ? " The evidence behind the decision is shown to the organisation and its matched counterparties." : ` Reason: ${org.verification.reason}`}</Notice>}
            {org.verification.status === "pending" && <Notice kind="pending">Pending an administrator decision with a recorded reason. Method: {org.verification.method?.replace("_", " ")}.</Notice>}
            {session.kind === "admin" && org.verification.status === "pending" && (
              <form action={decideVerification} className="stack" style={{ marginTop: 8 }}>
                <input type="hidden" name="organisationId" value={org.id} />
                <input type="hidden" name="from" value="organisation" />
                <input name="reason" type="text" aria-label={`Reason for the verification decision on ${org.name}`} placeholder="Reason, recorded in the audit chain" required />
                <div className="row">
                  <button className="btn small" type="submit" name="outcome" value="verified">Verify</button>
                  <button className="btn small danger" type="submit" name="outcome" value="declined">Decline</button>
                </div>
              </form>
            )}
            {org.verification.status === "declined" && <Notice kind="halt">Declined{publicView ? "" : `: ${org.verification.reason}`}. A declined organisation cannot signal interest or be signalled back to until a new request is decided.</Notice>}
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
