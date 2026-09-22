import type { CaseFacts, CountryConfig, RegValue, Stage } from "../config/schema";
import { evaluate, matches, unresolvedFields } from "./conditions";
import { evaluateScope, promptFor, type ScopeAnswer } from "./scope";

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

export type ResolvedRequirement = {
  id: string;
  text: string;
  reg: RegValue;
  halts: boolean;
  /** stop: an established prohibition applies on these facts. hold: a settled rule waits on a fact from its named source. */
  effect?: "stop" | "hold";
};

/** A prohibition that applies on the facts entered. Established law, so not an escalation: nobody is asked to resolve it. */
export type Stop = { stageId: string; requirementId: string; text: string; reg: RegValue };

export type ResolvedStage = {
  stage: Stage;
  index: number;
  status: "active" | "halted" | "stopped" | "informational";
  requirements: ResolvedRequirement[];
  stops: Stop[];
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
  /** Stages a prohibition stops on these facts. Nothing on or after them can be completed. */
  stoppedStageIds: string[];
};

export function buildPathway(cfg: CountryConfig, facts: CaseFacts): Pathway {
  const scope = evaluateScope(cfg, facts);
  const escalations: Escalation[] = [];
  const ownerName = cfg.escalation.defaultOwnerName;

  if (scope.kind === "undetermined") {
    escalations.push({
      id: `scope:${scope.ruleId}`,
      stageId: "intake",
      requirementId: scope.ruleId,
      question: scope.basis.note ?? "Scope cannot be determined until the parties answer the intake questions",
      reg: scope.basis,
      owner: "The case participants, on the intake form",
      ownerName: null,
      kind: "unanswered_fact",
    });
  }
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
    .map((r) => ({ id: r.id, text: r.text, reg: r.reg, halts: r.reg.state === "unknown" && r.reg.drives, effect: r.effect }));

  const stages: ResolvedStage[] = [];
  let index = 0;
  for (const stage of cfg.stages) {
    const applies = evaluate(stage.when, facts);
    if (applies === "no_match") continue;
    // The stage may apply, but a fact it turns on has no answer. It is shown and halted, and
    // the halt names the question. Skipping it here would be the engine answering "no" for
    // the parties (R3).
    // The same holds inside the stage: a requirement, document, consent party or judgment whose own
    // condition reads an unanswered fact is not dropped as if the answer were no. The stage halts on it.
    const inner = [...stage.requirements, ...stage.documents, ...stage.consentParties, ...cfg.manualReview.filter((m) => m.stageId === stage.id)]
      .filter((x) => evaluate(x.when, facts) === "unresolved")
      .flatMap((x) => unresolvedFields(x.when, facts));
    const missingFields = [...new Set([...(applies === "unresolved" ? unresolvedFields(stage.when, facts) : []), ...inner])];
    const factEscalations: Escalation[] =
      missingFields.length
        ? missingFields.map((field) => ({
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
    const requirements: ResolvedRequirement[] = stage.requirements
      .filter((r) => matches(r.when, facts))
      .map((r) => ({ id: r.id, text: r.text, reg: r.reg, halts: r.reg.state === "unknown" && r.reg.drives, effect: r.effect }));
    const stops: Stop[] = requirements
      .filter((r) => r.effect === "stop")
      .map((r) => ({ stageId: stage.id, requirementId: r.id, text: r.text, reg: r.reg }));
    // A hold names the fact the rule is waiting on. Its owner is whoever the rule says establishes
    // it (a maintained list, the parties), never the country's legal escalation owner.
    const holds: Escalation[] = requirements
      .filter((r) => r.effect === "hold")
      .map((r) => ({
        id: `${stage.id}:hold:${r.id}`,
        stageId: stage.id,
        requirementId: r.id,
        question: r.reg.note ?? r.text,
        reg: r.reg,
        owner: r.reg.owner ?? "The case participants, on the intake form",
        ownerName: null,
        kind: "unanswered_fact",
      }));
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
      ...holds,
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
      status: stage.informational ? "informational" : stops.length ? "stopped" : halted ? "halted" : "active",
      requirements,
      stops,
      documents,
      consentParties,
      escalations: stageEscalations,
      manualReviews,
    });
  }

  // Out of scope: the pathway is the exit, nothing else applies.
  if (scope.kind === "out_of_scope") {
    return { countryCode: cfg.code, scope, stages: [], eligibility: [], escalations: [], haltedStageIds: [], stoppedStageIds: [] };
  }

  return {
    countryCode: cfg.code,
    scope,
    stages,
    eligibility,
    escalations,
    haltedStageIds: stages.filter((s) => s.status === "halted").map((s) => s.stage.id),
    stoppedStageIds: stages.filter((s) => s.status === "stopped").map((s) => s.stage.id),
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
