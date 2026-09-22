
import Link from "next/link";
import { verifiedNotice } from "@/lib/notice";

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

/** Shows a refusal the server issued. A message without a valid signature is someone else's text and is not shown. */
export function ErrorNotice({ error, sig }: { error?: string | string[]; sig?: string | string[] }) {
  const msg = verifiedNotice(error, sig);
  if (!msg) return null;
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

export function humanize(s: string) {
  return s.replaceAll("_", " ");
}

/** First sentence of a regulator-state label, without splitting on abbreviations such as "Art. 26". */
export function stateHeadline(label: string) {
  const cut = label.search(/\.\s+[A-Z]/);
  return cut === -1 ? label : label.slice(0, cut);
}

export function clip(s: string, n = 80) {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

export function fmt(iso?: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toISOString().slice(0, 10);
}

export function fmtTime(iso?: string | null, labelScenario = true) {
  if (!iso) return "";
  const t = new Date(iso);
  // Seeded history is written in scenario time (dates ahead of the real clock);
  // actions taken in a session carry real UTC timestamps. Label the difference.
  return t.toISOString().replace("T", " ").slice(0, 16) + " UTC" + (labelScenario && t.getTime() > Date.now() ? " (scenario)" : "");
}

