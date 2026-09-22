import type { CaseFacts, CountryConfig, RegValue, Stage } from "../config/schema";
import { evaluate, matches, unresolvedFields } from "./conditions";
import { evaluateScope, type ScopeAnswer } from "./scope";

/**
 * Pathway generation. Takes a country configuration and the facts of a case and
 * returns the ordered list of stages that apply, each with its requirements,
 * documents and consent parties resolved, and each HALTED where a requirement
 * that drives it is unknown (R3). Nothing here resolves an unknown to a default:
 * a stage whose own condition reads a fact nobody has answered stays on the
 * pathway and halts, instead of vanishing as if the answer had been "no".
 */

export type Escalation = {
  id: string;
  stageId: string;
  requirementId: string;
  question: string;
  reg: RegValue;
  owner: string;
  ownerName: string | null;
  /**
   * unknown_rule: a regulatory value Appendix B leaves unresolved. Answered by configuration
   * change with legal review, and persisted on the case as an escalation record.
   * unanswered_fact: an intake fact the parties have not supplied. Answered on the facts form,
   * and never a legal question for the country's escalation owner.
   */
  kind: "unknown_rule" | "unanswered_fact";
};

/** The intake prompt for a fact, so the halt names the question the parties must answer. */
function promptFor(cfg: CountryConfig, field: string): string {
  return cfg.scope.questions.find((q) => q.fact === field)?.prompt ?? field;
}

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
      kind: "unknown_rule",
    });
  }

  const eligibility: ResolvedRequirement[] = cfg.eligibility
    .filter((r) => matches(r.when, facts))
    .map((r) => ({ id: r.id, text: r.text, reg: r.reg, halts: r.reg.state === "unknown" && r.reg.drives }));

  const stages: ResolvedStage[] = [];
  let index = 0;
  for (const stage of cfg.stages) {
    const applies = evaluate(stage.when, facts);
    if (applies === "no_match") continue;
    // The stage may apply, but a fact it turns on has no answer. It is shown and halted, and
    // the halt names the question. Skipping it here would be the engine answering "no" for
    // the parties (R3).
    const factEscalations: Escalation[] =
      applies === "unresolved"
        ? unresolvedFields(stage.when, facts).map((field) => ({
            id: `${stage.id}:fact:${field}`,
            stageId: stage.id,
            requirementId: `fact:${field}`,
            question: `"${promptFor(cfg, field)}" has not been answered. This stage turns on that fact and cannot proceed on a guess.`,
            reg: {
              state: "unknown",
              marker: "?",
              note: `Deciding fact ${field} is not on the case. Nothing here selects an answer for the parties.`,
              owner: "The case participants, on the intake form",
              drives: true,
              executable: true,
            },
            owner: "The case participants, on the intake form",
            ownerName: null,
            kind: "unanswered_fact",
          }))
        : [];
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

    const stageEscalations: Escalation[] = [
      ...factEscalations,
      ...requirements
        .filter((r) => r.halts)
        .map(
          (r): Escalation => ({
            id: `${stage.id}:${r.id}`,
            stageId: stage.id,
            requirementId: r.id,
            question: r.reg.note ?? r.text,
            reg: r.reg,
            owner: r.reg.owner ?? cfg.escalation.defaultOwnerRole,
            ownerName,
            kind: "unknown_rule",
          }),
        ),
    ];
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
