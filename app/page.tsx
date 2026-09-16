import Link from "next/link";
import { getPlatform } from "@/core";
import { EvidenceLegend } from "@/components/Evidence";
import { Notice } from "@/components/ui";
import { getSession } from "@/lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const platform = getPlatform();
  const session = await getSession();
  const listings = platform.publicListings();
  const countries = Array.from(platform.countries.values());
  const cases = platform.store.cases.list();
  const halted = cases.filter((c) => platform.pathwayFor(c).haltedStageIds.length > 0).length;
  const audit = platform.store.audit.list().length;

  return (
    <div className="container">
      {sp.reset && <Notice kind="ok"><strong>Demo data re-seeded.</strong> Seeded cases, personas and configuration are restored; anything created in this session has been removed.</Notice>}
      <section className="hero" style={{ marginBottom: 20 }}>
        <div className="eyebrow">Value first. Results and content before commitment.</div>
        <h1>From discovery to an ABS-compliant draft agreement, across countries whose rules do not agree.</h1>
        <p className="lede">
          GENE-LINK carries two organisations from first contact to a recorded agreement while showing, for every requirement,
          whether it is established in law, GENE-LINK&apos;s own reading, or a question nobody has answered yet. Where a step depends
          on an open question, the platform stops and routes it to a named person. It never guesses.
        </p>
        <form action="/explore" method="get" className="search-bar" role="search" style={{ marginTop: 18 }}>
          <label htmlFor="q" className="sr-only">Search by function or species</label>
          <input id="q" name="q" type="search" placeholder="Search by function (anti-inflammatory, emulsifier), species or country — before signing up" />
          <button className="btn" type="submit">Search</button>
        </form>
        <div className="row" style={{ marginTop: 14, gap: 8 }}>
          <Link className="btn secondary" href="/learn">Arrive to learn</Link>
          <Link className="btn secondary" href="/persona?next=/declare">Invited or referred: sign in</Link>
          <Link className="btn ghost" href="/open-decisions">See what is still open</Link>
        </div>
      </section>

      <div className="grid cols-4" style={{ marginBottom: 20 }}>
        <div className="card flat"><div className="eyebrow">Provider countries configured</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{countries.length}</div><small className="mute">{countries.map((c) => c.name).join(", ")}. Brazil is the dry run.</small></div>
        <div className="card flat"><div className="eyebrow">Opportunities and needs</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{listings.length}</div><small className="mute">Anonymised until mutual interest.</small></div>
        <div className="card flat"><div className="eyebrow">Cases halted on an open question</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{halted} of {cases.length}</div><small className="mute">Halted, not defaulted.</small></div>
        <div className="card flat"><div className="eyebrow">Audit chain entries</div><div className="serif" style={{ fontSize: "var(--step-4)" }}>{audit}</div><small className="mute">Hash-chained, verifiable. <Link href="/verify">Verify</Link></small></div>
      </div>

      <section className="card" style={{ marginBottom: 20 }}>
        <h2>A guided tour for evaluators</h2>
        <p className="soft">Each step below is a real screen with real state. Nothing is a mock-up.</p>
        <ol className="stack" style={{ paddingLeft: 20 }}>
          <li><Link href="/persona">Choose a persona.</Link> Notice that a person holds seats, a seat carries a permission, and an organisation holds market functions. Three entities, not one role field. Amara Okoro holds seats in two organisations.</li>
          <li><Link href="/declare">Declare your journey for this visit.</Link> I have, I want. No fixed buyer or seller box.</li>
          <li><Link href="/explore">Explore</Link> the anonymised projections. Open a listing as an outsider and then as a counterparty after mutual interest to see the reveal.</li>
          <li><Link href="/cases">Open the Kenya case</Link> as Dr Ines Halvorsen. Two stages are halted: the Fifth Schedule rate status and the traditional knowledge registration procedure. Both are unresolved in Appendix B. Both route to a named owner slot.</li>
          <li>Open the Colombia case. Prior consultation sits before the application. The access contract is one record with an addendum history. The proceeding went through returned incomplete and information requested on the way.</li>
          <li>Open the second Kenya case. The 30 working day clock lapsed. The case sits in deadline lapsed with a remedy against the administrator. No permit issued.</li>
          <li>Open the Brazil case. The dry run: configuration written after the engine, a declaratory receipt with verification still open, and a manual review state for a judgment no system can make.</li>
          <li><Link href="/disclosures">What GENE-LINK told me.</Link> Every requirement statement, with its evidence class and time.</li>
          <li><Link href="/persona?seat=admin&next=/admin">Sign in as administrator.</Link> Verification queue, escalations, manual reviews, configuration viewer, audit chain.</li>
        </ol>
      </section>

      <div className="grid cols-2">
        <section className="card">
          <h2>Every rule carries its evidence class</h2>
          <p className="soft">Roughly a third of the values in the six-country dataset are unresolved. The interface says so, everywhere a rule drives a decision.</p>
          <EvidenceLegend />
          <p className="small mute" style={{ marginTop: 10 }}>An unknown that drives a step halts that step. An unknown that does not is shown but does not halt. Neither ever resolves to a default.</p>
        </section>
        <section className="card">
          <h2>Explicitly out of scope</h2>
          <ul className="small stack" style={{ paddingLeft: 18 }}>
            <li>Non-commercial use is routed to a <Link href="/out-of-scope">stated out-of-scope position</Link>, not through rules that do not fit.</li>
            <li>No &ldquo;already proven, we just want to buy it&rdquo; exit. Scope is set by the activity in every regime mapped.</li>
            <li>No freedom-to-operate or patent screening. No physical logistics. No GENE-LINK review queue in the critical path.</li>
            <li>Post-permit duties are recorded on the instrument for phase two. They are not run.</li>
          </ul>
        </section>
      </div>
      {session.kind === "anonymous" && (
        <p className="small mute" style={{ marginTop: 20 }}>You are browsing anonymously. Search and learning are available before sign-in. Everything else needs a seat.</p>
      )}
    </div>
  );
}
