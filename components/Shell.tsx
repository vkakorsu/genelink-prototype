import Link from "next/link";
import { BUILD_COMMIT } from "@/lib/build";
import { getObjective, getSession } from "@/lib/session";
import { getPlatform } from "@/core";
import { resetDemo } from "@/app/actions";

const WANT_LABEL: Record<string, string> = {
  sell_to_eu_buyer: "Sell to an EU buyer",
  source_from_south: "Source from the South",
  find_broker: "Find a broker",
  get_abs_compliant: "Get ABS-compliant",
  learn: "Learn",
  screening_agreement: "Screening agreement (open decision)",
};

export async function Shell({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  const objective = await getObjective();
  const platform = getPlatform();
  const initials = session.kind === "seat" ? session.actor.person.name.split(" ").map((w) => w[0]).filter((c) => /[A-Z]/.test(c)).slice(-2).join("") : session.kind === "admin" ? "AD" : "?";
  const label = session.kind === "seat"
    ? `${session.actor.person.name} · ${session.actor.organisation.name} · ${session.actor.seat.permission.replace("_", " ")}`
    : session.kind === "admin" ? "GENE-LINK administrator (demo)" : "Not signed in · choose a persona";
  const orgId = session.kind === "seat" ? session.actor.organisation.id : null;
  const storeKind = platform.store.kind;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">GENE-LINK <small>MVP prototype</small></Link>
          <nav className="nav" aria-label="Primary">
            <Link href="/explore">Explore</Link>
            <Link href="/learn">Learn</Link>
            {session.kind !== "anonymous" && <Link href="/cases">Cases</Link>}
            {session.kind === "seat" && <Link href="/disclosures">What GENE-LINK told me</Link>}
            {orgId && <Link href={`/organisations/${orgId}`}>My organisation</Link>}
            <Link href="/open-decisions">Open decisions</Link>
            <Link href="/verify">Verify</Link>
            {session.kind === "admin" && <Link href="/admin">Admin</Link>}
          </nav>
          <Link href="/persona" className="persona-chip" title="Demo sign-in. Replaced by passkeys, email codes and ORCID in the MVP.">
            <span className="dot" aria-hidden="true">{initials}</span>
            <span>{label}</span>
          </Link>
        </div>
      </header>
      <div className="demo-banner">
        <div className="topbar-inner">
          <span>
            <strong>Prototype with fictional parties.</strong> Compliance output here is information, never advice or approval.
            {" "}Store: <code>{storeKind}</code>, state resets when the instance restarts.
          </span>
          {objective && <span className="mute">This visit: I have {objective.have ? `"${objective.have}"` : "…"} and I want to {WANT_LABEL[objective.want]?.toLowerCase() ?? objective.want}.{objective.redactions ? ` ${objective.redactions} identifying item${objective.redactions === 1 ? "" : "s"} removed from the free text.` : ""} <Link href="/declare">Change</Link></span>}
          {!objective && <Link href="/declare">Declare your journey for this visit</Link>}
          {session.kind === "admin" && (
            <form action={resetDemo} style={{ marginLeft: "auto" }}>
              <button className="btn ghost small" type="submit" title="Re-seed the demo data">Reset demo data</button>
            </form>
          )}
        </div>
      </div>
      <main id="main">{children}</main>
      <footer className="site">
        <div className="topbar-inner">
          <span>GENE-LINK MVP prototype, built for the Landscape Alliance RFP of 3 September 2026 by Vincent Kofi Akorsu. Configuration transcribed from Appendix B with its evidence markers.</span>
          <span style={{ marginLeft: "auto" }}>Deployed in an EU region on purpose. No personal data is held. · <a href="https://github.com/vkakorsu/genelink-prototype" target="_blank" rel="noopener">Source, runbooks and the Docker Compose file</a> · build <code>{BUILD_COMMIT}</code></span>
        </div>
      </footer>
    </div>
  );
}
