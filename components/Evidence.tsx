import type { RegValue } from "@/core/config/schema";

/**
 * R4: the evidence class reaches the interface. Every rule the platform shows
 * carries its Appendix B marker, visibly distinguished wherever it drives a decision.
 */
export function evidenceClass(reg: RegValue): "established" | "inferred" | "unknown" | "notexec" | "gl" {
  if (reg.marker === "⊘" || !reg.executable) return "notexec";
  if (reg.marker === "[GL]") return "gl";
  return reg.state;
}

const LABEL: Record<ReturnType<typeof evidenceClass>, string> = {
  established: "Established in law",
  inferred: "GENE-LINK's own reading",
  unknown: "Unresolved",
  notexec: "Not executable",
  gl: "GENE-LINK's own construct",
};

const TITLE: Record<ReturnType<typeof evidenceClass>, string> = {
  established: "Verbatim statutory text, cited. Built to as a business rule.",
  inferred: "An inference joining true citations. Not a business rule without legal review.",
  unknown: "Pending a regulator, contradicted by sources, or failed re-check. Blocks and escalates. Never resolves to a default.",
  notexec: "Enacted but uncommenced, draft, spent or struck down. Never enforced automatically.",
  gl: "GENE-LINK's own construct or analysis. Not law and not a government classification.",
};

export function EvidenceChip({ reg, short = false }: { reg: RegValue; short?: boolean }) {
  const cls = evidenceClass(reg);
  return (
    <span className={`ev ${cls}`} title={TITLE[cls]}>
      <span className="m" aria-hidden="true">{reg.marker}</span>
      <span>{short ? LABEL[cls].split(" ")[0] : LABEL[cls]}</span>
    </span>
  );
}

export function RegBlock({ reg, text, compact = false, answered = false }: { reg: RegValue; text?: string; compact?: boolean; answered?: boolean }) {
  const cls = evidenceClass(reg);
  return (
    <div className={`reg ${cls}`}>
      <div className="row" style={{ gap: 8 }}>
        <EvidenceChip reg={reg} />
        {reg.citation && <span className="cite">{reg.citation}</span>}
      </div>
      {text && <p className="text"><strong>{text}</strong></p>}
      {reg.value && <p className="text" style={compact ? { margin: "2px 0" } : undefined}>{reg.value}</p>}
      {reg.note && <p className="text small soft" style={{ margin: "2px 0" }}>{reg.note}</p>}
      {reg.state === "unknown" && (
        <p className="owner">
          Routed to: {reg.owner}
          {answered ? " · answered for this case by the recorded manual-review judgment; the rule stays open in the configuration" : reg.drives ? " · halts the dependent step" : " · shown, does not halt"}
        </p>
      )}
    </div>
  );
}

export function EvidenceLegend() {
  const items: RegValue[] = [
    { state: "established", marker: "§", drives: false, executable: true },
    { state: "inferred", marker: "▸", drives: false, executable: true },
    { state: "unknown", marker: "?", owner: "a named person", drives: false, executable: true },
    { state: "established", marker: "⊘", drives: false, executable: false },
    { state: "inferred", marker: "[GL]", drives: false, executable: true },
  ];
  return (
    <div className="row" style={{ gap: 6 }} aria-label="Evidence class legend">
      {items.map((r) => (
        <EvidenceChip key={r.marker} reg={r} />
      ))}
    </div>
  );
}
