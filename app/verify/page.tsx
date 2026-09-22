import Link from "next/link";
import { getPlatform } from "@/core";
import { verifyDocument } from "@/app/actions";
import { ErrorNotice, Notice, PageHead } from "@/components/ui";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const platform = getPlatform();
  // Only a hash travels in the address, never the document it came from.
  const sha = typeof sp.sha === "string" && /^[0-9a-f]{64}$/.test(sp.sha) ? sp.sha : null;
  const result = sha ? platform.verifyHash(sha) : null;
  const chain = platform.verifyAudit();
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Integrity verification"
        title="Verify a document or the audit chain"
        lede="Paste the exact text of an agreement version, a recorded instrument or an uploaded document, or its SHA-256. The platform computes the hash and reports whether it appears in the record. No account is needed to verify. Anyone holding the document can check it."
      />
      <ErrorNotice error={sp.error} sig={sp.sig} />
      <section className="card">
        <h3>Audit chain</h3>
        {chain.ok ? <Notice kind="ok">Chain verified. {chain.length} entries, each hash covering its content and the previous hash. Any alteration or removal would break verification from that point.</Notice> : <Notice kind="halt">Chain broken at entry {chain.brokenAt}: {chain.reason}</Notice>}
        <p className="small mute" style={{ marginTop: 8 }}>In the MVP the audit table is append-only at the database level and chain checkpoints may be anchored with an RFC 3161 timestamp from a public timestamping authority.</p>
      </section>
      <section className="card">
        <h3>Document hash</h3>
        <form action={verifyDocument} className="stack">
          <label htmlFor="content" className="small">Document text or SHA-256</label>
          <textarea id="content" name="content" placeholder="Paste the document text, or a 64-character SHA-256" rows={6} required />
          <button className="btn" type="submit">Compute and check</button>
        </form>
        <p className="small mute" style={{ marginTop: 6 }}>The text is sent in the body of the request and is not stored or placed in the address; only its hash comes back. Line endings are normalised, so the same document checks the same from any system.</p>
        {result && (
          <div style={{ marginTop: 12 }}>
            <p className="small">SHA-256: <span className="mono">{result.sha256}</span></p>
            {result.matches.length === 0 && <Notice kind="pending">No recorded hash matches this content. Either the text differs from what was recorded, or it was never recorded.</Notice>}
            {result.matches.length > 0 && <Notice kind="ok">Matches {result.matches.length} recorded item{result.matches.length === 1 ? "" : "s"}: {result.matches.map((m) => `${m.type} ${m.id} (${m.where})`).join(", ")}.</Notice>}
          </div>
        )}
        <p className="small mute" style={{ marginTop: 10 }}>To check an agreement, a party downloads the exact text of the version from its <Link href="/cases">case</Link> (&ldquo;Download the exact text&rdquo;) and pastes it here, or pastes the hash shown next to the version.</p>
      </section>
    </div>
  );
}
