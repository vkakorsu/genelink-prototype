import Link from "next/link";
import { getPlatform } from "@/core";
import { Notice, PageHead } from "@/components/ui";

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const platform = getPlatform();
  const content = sp.content ?? "";
  const result = content ? platform.verifyContent(content) : null;
  const chain = platform.verifyAudit();
  return (
    <div className="container narrow">
      <PageHead
        eyebrow="Integrity verification"
        title="Verify a document or the audit chain"
        lede="Paste the exact text of an agreement version, a recorded instrument or an uploaded document. The platform computes its SHA-256 and reports whether that hash appears in the record. No account is needed to verify. Anyone holding the document can check it."
      />
      <section className="card">
        <h3>Audit chain</h3>
        {chain.ok ? <Notice kind="ok">Chain verified. {chain.length} entries, each hash covering its content and the previous hash. Any alteration or removal would break verification from that point.</Notice> : <Notice kind="halt">Chain broken at entry {chain.brokenAt}: {chain.reason}</Notice>}
        <p className="small mute" style={{ marginTop: 8 }}>In the MVP the audit table is append-only at the database level and chain checkpoints may be anchored with an RFC 3161 timestamp from a public timestamping authority.</p>
      </section>
      <section className="card">
        <h3>Document hash</h3>
        <form method="get" className="stack">
          <textarea name="content" defaultValue={content} placeholder="Paste document text" rows={6} />
          <button className="btn" type="submit">Compute and check</button>
        </form>
        {result && (
          <div style={{ marginTop: 12 }}>
            <p className="small">SHA-256: <span className="mono">{result.sha256}</span></p>
            {result.matches.length === 0 && <Notice kind="pending">No recorded hash matches this content. Either the text differs from what was recorded, or it was never recorded.</Notice>}
            {result.matches.length > 0 && <Notice kind="ok">Matches {result.matches.length} recorded item{result.matches.length === 1 ? "" : "s"}: {result.matches.map((m) => `${m.type} ${m.id} (${m.where})`).join(", ")}.</Notice>}
          </div>
        )}
        <p className="small mute" style={{ marginTop: 10 }}>Try it: open an <Link href="/cases">executed agreement</Link>, expand its clauses, and paste <code>v{"{version}"}</code> followed by a newline and the clauses as <code>id</code>, <code>title</code>, <code>text</code> lines separated by blank lines. The prototype hashes that canonical form.</p>
      </section>
    </div>
  );
}
