import Link from "next/link";
import { getPlatform } from "@/core";
import { Empty, OpenMarker, PageHead } from "@/components/ui";
import { getObjective, getSession } from "@/lib/session";

/** What a declared objective implies for the market side a visitor sees first. */
const SIDE_FOR_OBJECTIVE: Record<string, { side: "offer" | "need"; why: string }> = {
  source_from_south: { side: "offer", why: "you declared that you want to source from the South" },
  sell_to_eu_buyer: { side: "need", why: "you declared that you want to sell to an EU buyer" },
};

export default async function ExplorePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().toLowerCase();
  const country = sp.country ?? "";
  // The visit objective shapes search until the visitor chooses a side themselves: an explicit
  // choice, including "Offers and needs", always wins.
  const objective = await getObjective();
  const implied = sp.side === undefined && objective ? SIDE_FOR_OBJECTIVE[objective.want] : undefined;
  const side = sp.side ?? implied?.side ?? "";
  const platform = getPlatform();
  const session = await getSession();
  const all = platform.publicListings();
  const listings = platform.searchPublicListings(q, country, side);
  const countries = Array.from(new Set(all.map((l) => l.provenanceCountry)));
  const fnCodes = Array.from(new Set(all.flatMap((l) => l.functionCodes))).sort();

  return (
    <div className="container">
      <PageHead
        eyebrow="Discovery"
        title="Opportunities and market needs"
        lede="Search by function, species or country before signing up. A buyer usually knows the property it needs, not the species that carries it. What you see here is the public projection: identity, species and accession detail, and locality are withheld until both sides signal interest."
      >
        <p className="small mute">
          <OpenMarker /> What is visible before a match is a held-open decision (Appendix A). The split shown here is a working position and is configuration, not code. Search runs over the public projection only: a taxon query finds a listing where its owner published that taxon, never through a withheld field.
        </p>
      </PageHead>

      <form method="get" className="card flat" style={{ marginBottom: 16 }}>
        <div className="grid cols-4" style={{ alignItems: "end" }}>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="q">Function or species</label>
            <input id="q" name="q" type="search" defaultValue={sp.q ?? ""} placeholder="anti-inflammatory, emulsifier, Lamiaceae" />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="country">Provider country</label>
            <select id="country" name="country" defaultValue={country}>
              <option value="">Any</option>
              {countries.map((c) => <option key={c} value={c}>{c === "any" ? "Any provenance (need)" : platform.countries.get(c)?.name ?? c}</option>)}
            </select>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label htmlFor="side">Side</label>
            <select id="side" name="side" defaultValue={side}>
              <option value="">Offers and needs</option>
              <option value="offer">Offers (supply)</option>
              <option value="need">Needs (demand)</option>
            </select>
          </div>
          <button className="btn" type="submit">Filter</button>
        </div>
        <div className="tags" style={{ marginTop: 10 }}>
          <span className="small mute">Function taxonomy (GENE-LINK&apos;s own construct, illustrative subset of the 48-code list):</span>
          {fnCodes.map((f) => <Link key={f} className="tag fn" href={`/explore?q=${encodeURIComponent(f.split(" ")[1] ?? f)}`}>{f}</Link>)}
        </div>
      </form>

      {implied && (
        <p className="small soft" style={{ marginTop: -6 }}>Showing {implied.side === "offer" ? "offers" : "needs"} because {implied.why}. <Link href={`/explore?side=${q ? `&q=${encodeURIComponent(q)}` : ""}${country ? `&country=${encodeURIComponent(country)}` : ""}`}>Show offers and needs</Link> · <Link href="/declare">Change the objective</Link></p>
      )}
      {listings.length === 0 && <Empty title="No opportunities match">Try a broader function, or <Link href="/explore">clear the filters</Link>.</Empty>}
      <div className="grid cols-2">
        {listings.map((l) => (
          <article className="card listing" key={l.id}>
            <div className="row between">
              <span className={`side-badge ${l.side}`}>{l.side === "offer" ? "Offer" : "Need"}</span>
              <span className="glid">{l.glId}</span>
            </div>
            <h3 style={{ margin: 0 }}>{l.resourceClass}</h3>
            <div className="tags">{l.functionCodes.map((f) => <span key={f} className="tag fn">{f}</span>)}<span className="tag">{l.provenanceCountry === "any" ? "Any provenance" : platform.countries.get(l.provenanceCountry)?.name ?? l.provenanceCountry}</span></div>
            <p className="small" style={{ margin: 0 }}>{l.publicSummary}</p>
            <dl className="kv" style={{ marginTop: 4 }}>
              <dt>Scale</dt><dd>{l.indicativeScale}</dd>
              <dt>Taxon (as published)</dt><dd>{l.publicTaxon}</dd>
              <dt>Organisation</dt><dd><span className="redacted">Withheld until match</span> · {l.organisationKind.replace("_", " ")}{l.organisationVerified ? ", verified" : ", verification pending"}</dd>
              <dt>Species detail, locality</dt><dd><span className="redacted">Withheld until mutual interest</span></dd>
              <dt>DSI exposure</dt><dd>{l.dsiExposure}{l.dsiExposure !== "none" && <> <span className="small mute">(flags and informs, never asserts an obligation)</span></>}</dd>
            </dl>
            <div className="row" style={{ marginTop: 6 }}>
              <Link className="btn secondary small" href={`/listings/${l.id}`}>Open {l.glId}</Link>
              {session.kind === "anonymous" && <span className="small mute">Sign in with a seat to signal interest.</span>}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
