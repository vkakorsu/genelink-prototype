import type { CaseFacts, CountryConfig, RegValue, Stage } from "../config/schema";
import { matches } from "./conditions";
import { evaluateScope, type ScopeAnswer } from "./scope";

/**
 * Pathway generation. Takes a country configuration and the facts of a case and
 * returns the ordered list of stages that apply, each with its requirements,
 * documents and consent parties resolved, and each HALTED where a requirement
 * that drives it is unknown (R3). Nothing here resolves an unknown to a default.
 */

export type Escalation = {
  id: string;
  stageId: string;
  requirementId: string;
  question: string;
  reg: RegValue;
  owner: string;
  ownerName: string | null;
};

export type ResolvedRequirement = {
  id: string;
  text: string;
  reg: RegValue;
  halts: boolean;
};

export type ResolvedStage = {
  stage: Stage;
  index: number;
  status: "active" | "halted" | "informational";
  requirements: ResolvedRequirement[];
  documents: { id: string; label: string; reg: RegValue }[];
  consentParties: { id: string; label: string; reg: RegValue }[];
  escalations: Escalation[];
  manualReviews: { id: string; question: string; decides: string; reg: RegValue }[];
};

export type Pathway = {
  countryCode: string;
  scope: ScopeAnswer;
  stages: ResolvedStage[];
  eligibility: ResolvedRequirement[];
  escalations: Escalation[];
  haltedStageIds: string[];
};

export function buildPathway(cfg: CountryConfig, facts: CaseFacts): Pathway {
  const scope = evaluateScope(cfg, facts);
  const escalations: Escalation[] = [];
  const ownerName = cfg.escalation.defaultOwnerName;

  if (scope.kind === "escalate") {
    escalations.push({
      id: `scope:${scope.ruleId}`,
      stageId: "intake",
      requirementId: scope.ruleId,
      question: scope.basis.note ?? "Scope cannot be determined on these facts",
      reg: scope.basis,
      owner: scope.owner,
      ownerName,
    });
  }

  const eligibility: ResolvedRequirement[] = cfg.eligibility
    .filter((r) => matches(r.when, facts))
    .map((r) => ({ id: r.id, text: r.text, reg: r.reg, halts: r.reg.state === "unknown" && r.reg.drives }));

  const stages: ResolvedStage[] = [];
  let index = 0;
  for (const stage of cfg.stages) {
    if (!matches(stage.when, facts)) continue;
    const requirements = stage.requirements
      .filter((r) => matches(r.when, facts))
      .map((r) => ({ id: r.id, text: r.text, reg: r.reg, halts: r.reg.state === "unknown" && r.reg.drives }));
    const documents = stage.documents.filter((d) => matches(d.when, facts)).map((d) => ({ id: d.id, label: d.label, reg: d.reg }));
    const consentParties = stage.consentParties
      .filter((c) => matches(c.when, facts))
      .map((c) => ({ id: c.id, label: c.label, reg: c.reg }));
    // A judgment attaches to the stage its declaration names (R5). The engine carries no
    // list of judgment ids: South Africa's and Malaysia's will arrive in their own files.
    const manualReviews = cfg.manualReview
      .filter((m) => matches(m.when, facts) && m.stageId === stage.id)
      .map((m) => ({ id: m.id, question: m.question, decides: m.decides, reg: m.reg }));

    const stageEscalations: Escalation[] = requirements
      .filter((r) => r.halts)
      .map((r) => ({
        id: `${stage.id}:${r.id}`,
        stageId: stage.id,
        requirementId: r.id,
        question: r.reg.note ?? r.text,
        reg: r.reg,
        owner: r.reg.owner ?? cfg.escalation.defaultOwnerRole,
        ownerName,
      }));
    escalations.push(...stageEscalations);

    const halted = stageEscalations.length > 0 || manualReviews.some((m) => m.reg.state === "unknown" && m.reg.drives);
    stages.push({
      stage,
      index: index++,
      status: stage.informational ? "informational" : halted ? "halted" : "active",
      requirements,
      documents,
      consentParties,
      escalations: stageEscalations,
      manualReviews,
    });
  }

  // Out of scope: the pathway is the exit, nothing else applies.
  if (scope.kind === "out_of_scope") {
    return { countryCode: cfg.code, scope, stages: [], eligibility: [], escalations: [], haltedStageIds: [] };
  }

  return {
    countryCode: cfg.code,
    scope,
    stages,
    eligibility,
    escalations,
    haltedStageIds: stages.filter((s) => s.status === "halted").map((s) => s.stage.id),
  };
}

/** Attached duties (Classes 1 to 9) for the continuity panel. Recorded, not run (R10). */
export function attachedDuties(cfg: CountryConfig) {
  return cfg.obligationClasses.map((c) => ({
    number: c.number,
    name: c.name,
    note: c.note,
    fields: Object.entries(c.fields).map(([key, reg]) => ({ key, reg })),
    unknownCount: Object.values(c.fields).filter((f) => f.state === "unknown").length,
  }));
}
