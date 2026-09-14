import Link from "next/link";
import { notFound } from "next/navigation";
import { getPlatform } from "@/core";
import { reciprocate, signalInterest } from "@/app/actions";
import { ErrorNotice, Notice, OpenMarker, PageHead, fmtTime } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function ListingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const platform = getPlatform();
  const raw = platform.store.listings.get(id);
  if (!raw) notFound();
  const session = await getSession();
  const actor = session.kind === "anonymous" ? null : session.actor;
  const projection = actor ? platform.listingFor(actor, id) : platform.publicListings().find((l) => l.id === id)!;
  const owner = platform.store.organisations.get(raw.organisationId)!;
  const isOwner = session.kind === "seat" && session.actor.organisation.id === raw.organisationId;
  const interests = platform.interestsOn(id);
  const myInterest = session.kind === "seat" ? interests.find((i) => i.fromOrganisationId === session.actor.organisation.id) : undefined;
  const cases = platform.store.cases.list().filter((c) => c.listingId === id);
  const myCase = session.kind === "seat" ? cases.find((c) => c.participants.some((p) => p.organisationId === session.actor.organisation.id)) : undefined;
  const myOrg = session.kind === "seat" ? session.actor.organisation : null;
  const myPathway = myOrg && !isOwner ? platform.providerCountryFor(raw, myOrg) : null;
  const myPathwayConfigured = myPathway ? platform.countries.has(myPathway) : true;
  const signalWithListing = signalInterest.bind(null, id);
  const reciprocateOnListing = reciprocate.bind(null, id);

  return (
    <div className="container">
      <PageHead eyebrow={`${raw.side === "offer" ? "Offer" : "Need"} · ${raw.glId}`} title={raw.resourceClass}>
        <div className="row">
          <span className={`tag ${projection.projection === "full" ? "" : ""}`}>Projection: <strong>{projection.projection}</strong></span>
          {projection.projection === "public" && <span className="small mute">Identity, species and locality are withheld until both sides signal interest.</span>}
          {projection.projection === "full" && <span className="small mute">Revealed to you because you own this listing or mutual interest was recorded.</span>}
          <OpenMarker title="What is visible before a match is a held-open decision (Appendix A). Working position rendered here." />
        </div>
      </PageHead>
      <ErrorNotice error={sp.error} />
      <div className="two-col">
        <div className="stack">
          <section className="card">
            <h3>Public projection</h3>
            <p>{raw.publicSummary}</p>
            <dl className="kv">
              <dt>Functions</dt><dd>{raw.functionCodes.join(", ")}</dd>
              <dt>Provenance</dt><dd>{raw.provenanceCountry === "any" ? "Any provenance with a lawful pathway" : platform.countries.get(raw.provenanceCountry)?.name ?? raw.provenanceCountry}</dd>
              <dt>Scale</dt><dd>{raw.indicativeScale}</dd>
              <dt>Organisation</dt><dd>{owner.kind.replace("_", " ")}, {owner.verification.status}</dd>
              <dt>DSI exposure</dt><dd>{raw.dsiExposure}. An exposure analysis flags and informs. It does not assert a resolved DSI or Cali Fund obligation.</dd>
              <dt>Identifiers</dt><dd>GENE-LINK-native ID {raw.glId} minted at listing. GGBN ID {raw.ggbnId ?? "not available, never blocks"}.</dd>
            </dl>
          </section>
          <section className={`card ${projection.projection === "full" ? "tinted" : "flat"}`}>
            <h3>Full projection {projection.projection === "public" && <span className="small mute">(withheld)</span>}</h3>
            {projection.projection === "full" ? (
              <dl className="kv">
                <dt>Organisation</dt><dd><Link href={`/organisations/${owner.id}`}>{owner.name}</Link></dd>
                <dt>Species detail</dt><dd>{raw.speciesDetail}</dd>
                <dt>Locality detail</dt><dd>{raw.localityDetail}</dd>
                <dt>Description</dt><dd>{raw.fullDescription}</dd>
              </dl>
            ) : (
              <dl className="kv">
                <dt>Organisation</dt><dd><span className="redacted">Organisation name withheld</span></dd>
                <dt>Species detail</dt><dd><span className="redacted">Species detail withheld until mutual interest</span></dd>
                <dt>Locality detail</dt><dd><span className="redacted">Locality withheld until mutual interest</span></dd>
              </dl>
            )}
          </section>
        </div>
        <aside className="stack">
          <section className="card">
            <h3>Mutual interest</h3>
            {session.kind === "anonymous" && <p className="small">Sign in with a seat to signal interest. <Link href={`/persona?next=/listings/${id}`}>Choose a persona</Link>.</p>}
            {session.kind === "admin" && <p className="small mute">Administrators watch. They do not signal interest.</p>}
            {session.kind === "seat" && !isOwner && myCase && (
              <Notice kind="ok">Mutual interest recorded and both identities revealed {myCase.revealedAt ? fmtTime(myCase.revealedAt) : ""}. Full projection shown. <Link href={`/cases/${myCase.id}`}>Open the case</Link>.</Notice>
            )}
            {session.kind === "seat" && !isOwner && !myCase && (
              myInterest ? (
                <Notice kind="pending">Interest signalled on {fmtTime(myInterest.at)}. The reveal happens when the listing owner signals back, and both sides see the same thing at the same time.</Notice>
              ) : myOrg?.verification.status === "declined" ? (
                <Notice kind="halt">Your organisation&apos;s verification was declined{myOrg.verification.reason ? ` (${myOrg.verification.reason})` : ""}. Interest cannot be signalled until a new verification request is decided.</Notice>
              ) : !myPathwayConfigured ? (
                <Notice kind="halt">
                  {raw.side === "need" ? "This need accepts any provenance with a lawful pathway, and the pathway would be your organisation's country" : "The pathway for this listing is"} ({myPathway}), which has no configuration on this instance. Configured: {[...platform.countries.keys()].sort().join(", ")}. Adding a country is a configuration file, not a release.
                </Notice>
              ) : (
                <form action={signalWithListing}>
                  <p className="small soft">Signalling interest tells the owner that your organisation (kind and verified status, not name) is interested. Nothing more is revealed until they signal back.{raw.side === "need" && myPathway ? ` A match would run under ${platform.countries.get(myPathway)?.name}'s rules, your organisation's country.` : ""}</p>
                  <button className="btn block" type="submit">Signal interest</button>
                </form>
              )
            )}
            {isOwner && (
              <div className="stack">
                <p className="small soft">{interests.length} organisation{interests.length === 1 ? "" : "s"} signalled interest. Signalling back opens a case and reveals both full projections at once.</p>
                {interests.length === 0 && <p className="small mute">No signals yet.</p>}
                {interests.map((i) => {
                  const org = platform.store.organisations.get(i.fromOrganisationId);
                  if (!org) return null;
                  const existing = cases.find((c) => c.participants.some((p) => p.organisationId === org.id));
                  const pathway = platform.providerCountryFor(raw, org);
                  const configured = platform.countries.has(pathway);
                  const declined = org.verification.status === "declined";
                  return (
                    <div key={i.id} className="row between" style={{ padding: "8px 10px", background: "var(--sand)", borderRadius: 6 }}>
                      <div className="small">
                        <strong>{existing ? org.name : `${org.kind.replace("_", " ")} (${org.country})`}</strong>
                        {" · "}{org.verification.status}
                        <div className="mute">{fmtTime(i.at)}{raw.side === "need" ? ` · pathway ${configured ? platform.countries.get(pathway)?.name : `${pathway}, not configured`}` : ""}</div>
                        {declined && <div className="mute">Verification declined. Signalling back is not available until a new request is decided.</div>}
                      </div>
                      {existing ? (
                        <Link className="btn small secondary" href={`/cases/${existing.id}`}>Open case</Link>
                      ) : declined || !configured ? (
                        <span className="small mute">Not available</span>
                      ) : (
                        <form action={reciprocateOnListing}>
                          <input type="hidden" name="organisationId" value={org.id} />
                          <button className="btn small" type="submit">Signal back and reveal</button>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
          {cases.length > 0 && session.kind !== "anonymous" && (
            <section className="card flat">
              <h3>Cases from this listing</h3>
              <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
                {cases.filter((c) => session.kind === "admin" || c.participants.some((p) => p.organisationId === (session as { actor: { organisation: { id: string } } }).actor.organisation.id)).map((c) => (
                  <li key={c.id}><Link href={`/cases/${c.id}`}>{c.title}</Link></li>
                ))}
              </ul>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
