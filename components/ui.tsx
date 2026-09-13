import Link from "next/link";

export function PageHead({ eyebrow, title, lede, children }: { eyebrow?: string; title: string; lede?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
      {children}
    </div>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "pending" | "halt" | "ok"; children: React.ReactNode }) {
  return <div className={`notice ${kind}`}>{children}</div>;
}

export function ErrorNotice({ error }: { error?: string | string[] }) {
  if (!error) return null;
  const msg = Array.isArray(error) ? error[0] : error;
  return (
    <div className="notice halt" role="alert" style={{ marginBottom: 14 }}>
      <strong>Not done.</strong> {msg}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function OpenMarker({ title = "Open decision, not yet taken" }: { title?: string }) {
  return <span className="open-marker" title={title} aria-label={title}>?</span>;
}

export function DecisionSlot({ children }: { children: React.ReactNode }) {
  return <div className="decision-slot">{children}</div>;
}

export function InformationNotAdvice() {
  return (
    <p className="info-not-advice">
      This is information about requirements that appear to apply on the facts entered. It is not legal advice and not an approval.
      The decision rests with the parties and their advisers. Everything shown here is recorded in <Link href="/disclosures">what GENE-LINK told you</Link>.
    </p>
  );
}

export function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(iso?: string | null) {
  if (!iso) return "";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function PersonaRequired({ next }: { next: string }) {
  return (
    <Empty title="Choose a persona to continue">
      <p>The prototype uses a persona switcher in place of sign-in. In the MVP this is passkeys, email codes and ORCID.</p>
      <Link className="btn" href={`/persona?next=${encodeURIComponent(next)}`}>Choose a persona</Link>
    </Empty>
  );
}
