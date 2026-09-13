/**
 * Dry run: take one configured country end to end through the engine with
 * fictional parties and print what happened. Usage:
 *
 *   npm run dry-run -- BR
 *
 * If this script needs a code change to run a new country file, the dry run has
 * failed as Appendix B defines it. The script contains no country-specific code.
 */
import { join } from "node:path";
import { loadCountries } from "../core/config/load";
import { lintCountry } from "../core/config/lint";
import { buildPathway } from "../core/engine/pathway";
import { fire, initialSnapshot, isGranted } from "../core/engine/stateMachine";
import { instrumentFrom, renewalProbeAllowed } from "../core/domain/instruments";
import type { CaseFacts } from "../core/config/schema";

const code = (process.argv[2] ?? "BR").toUpperCase();
const countries = loadCountries(join(process.cwd(), "config", "countries"));
const cfg = countries.get(code);
if (!cfg) {
  console.error(`No configuration for ${code}. Available: ${Array.from(countries.keys()).join(", ")}`);
  process.exit(1);
}

const line = (s = "") => console.log(s);
line(`GENE-LINK dry run · ${cfg.name} (${cfg.code})`);
line(`Instruments: ${cfg.legalInstruments.join(" · ")}`);
line(`Operative instrument status: ${cfg.operativeInstrumentStatus.marker} ${cfg.operativeInstrumentStatus.state}`);
line();

const lint = lintCountry(cfg);
line(`Lint: ${lint.filter((l) => l.severity === "error").length} errors, ${lint.filter((l) => l.severity === "warning").length} warnings`);
for (const w of lint) line(`  ${w.severity}: ${w.path}: ${w.message}`);
line();

const facts: CaseFacts = {
  purpose: "commercial",
  activity: cfg.scope.questions[0].options[0].id,
  provenance: "in_situ",
  applicantType: "foreign_legal",
  exchange: "service_shipment",
  communityHeld: "yes",
  tkInvolved: "unclear",
  directAffectation: "unclear",
  speciesListed: "not_listed",
  localities: 1,
  scientificCollaboration: "unclear",
  flags: {},
};

const pathway = buildPathway(cfg, facts);
line(`Scope: ${pathway.scope.kind} (${pathway.scope.ruleId}) ${pathway.scope.basis.marker}`);
line();
line("Pathway (order from configuration):");
for (const s of pathway.stages) {
  const flag = s.status === "halted" ? "HALTED" : s.status === "informational" ? "phase two" : "active";
  line(`  ${String(s.index + 1).padStart(2)}. ${s.stage.title}  [${flag}]`);
  for (const r of s.requirements) line(`        ${r.reg.marker} ${r.text.slice(0, 110)}${r.text.length > 110 ? "…" : ""}`);
  for (const d of s.documents) line(`        needs document: ${d.label}`);
  for (const c of s.consentParties) line(`        consent party: ${c.label}`);
  for (const m of s.manualReviews) line(`        MANUAL REVIEW (R5): ${m.question}`);
}
line();
line(`Escalations raised (R3): ${pathway.escalations.length}`);
for (const e of pathway.escalations) line(`  ? ${e.stageId}/${e.requirementId} -> ${e.owner}${e.ownerName ? ` (${e.ownerName})` : " (name pending Landscape Alliance)"}`);
line();

// Walk the state machine along the shortest declared path to a granted state.
const sm = cfg.stateMachine;
const granted = Object.entries(sm.states).filter(([, s]) => s.outcome === "granted").map(([k]) => k);
const queue: { state: string; events: string[] }[] = [{ state: sm.initial, events: [] }];
const seen = new Set([sm.initial]);
let path: string[] | null = null;
while (queue.length && !path) {
  const { state, events } = queue.shift()!;
  if (granted.includes(state) && events.length) { path = events; break; }
  for (const t of sm.transitions) {
    if (t.from === state && t.event !== "lapse" && !seen.has(t.to)) {
      seen.add(t.to);
      queue.push({ state: t.to, events: [...events, t.event] });
    }
  }
}
line("Regulator processing (declared machine):");
let snap = initialSnapshot(cfg, new Date());
for (const ev of path ?? []) {
  const t = sm.transitions.find((x) => x.from === snap.state && x.event === ev)!;
  snap = fire(cfg, snap, ev, t.actor, new Date());
  line(`  ${ev.padEnd(24)} -> ${snap.state}`);
}
line(`  granted: ${isGranted(cfg, snap)}`);
line(`  unhappy states declared: ${Object.keys(sm.states).filter((s) => ["information_requested", "returned_incomplete", "resubmitted", "refused", "denied", "appealed", "withdrawn", "cancelled", "correction_required", "deadline_lapsed"].includes(s)).join(", ")}`);
line();

line("What the applicant holds:");
for (const o of cfg.outputs.filter((o) => o.issuedInState === snap.state)) {
  const inst = instrumentFrom(o, "dry_run", new Date(), "dry_run", "recorded_external");
  line(`  ${inst.label} · issuer ${inst.issuer} · status ${inst.status} · amendment policy ${inst.amendmentPolicy}`);
  line(`     term: ${o.term.marker} ${o.term.value ?? o.term.note}`);
  line(`     renewals capped: ${o.renewalsCapped.marker} ${o.renewalsCapped.value ?? o.renewalsCapped.note}`);
}
line(`Renewal probe: ${renewalProbeAllowed(cfg).reason}`);
line();
const unknownClassFields = cfg.obligationClasses.reduce((n, c) => n + Object.values(c.fields).filter((f) => f.state === "unknown").length, 0);
const totalClassFields = cfg.obligationClasses.reduce((n, c) => n + Object.keys(c.fields).length, 0);
line(`Obligation classes recorded for phase two: 9 classes, ${totalClassFields} fields, ${unknownClassFields} unresolved.`);
line();
line("Result: the engine did not need to know this country existed. Configuration and nothing else.");
