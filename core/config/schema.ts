/**
 * GENE-LINK country configuration schema.
 *
 * This is the contract between the legal research (Appendix B) and the engine.
 * Every regulatory statement is a RegValue carrying one of three states and the
 * Appendix B evidence marker. A bare boolean in a regulatory field is a type
 * error and a schema error (Appendix B, R1). An unknown value must name the
 * person or role it escalates to (R3). Adding a provider country means filling
 * this schema again, not extending it (R2).
 *
 * The core has no dependency on any web framework or database.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Evidence classes (Appendix B, A3)
// ---------------------------------------------------------------------------

export const RegState = z.enum(["established", "inferred", "unknown"]);
export type RegState = z.infer<typeof RegState>;

/** § established · ▸ our reading · ? unresolved · ⊘ not executable · [GL] GENE-LINK's own construct */
export const Marker = z.enum(["§", "▸", "?", "⊘", "[GL]"]);
export type Marker = z.infer<typeof Marker>;

const markerToState: Record<Marker, RegState> = {
  "§": "established",
  "▸": "inferred",
  "?": "unknown",
  "⊘": "established", // the non-executability is itself established; executable=false below
  "[GL]": "inferred",
};

export const RegValue = z
  .object({
    state: RegState,
    marker: Marker,
    /** The statement itself. Optional for an unknown: the question is in `note`. */
    value: z.string().optional(),
    citation: z.string().optional(),
    note: z.string().optional(),
    /** Who an unknown is routed to. Required when state is unknown. */
    owner: z.string().optional(),
    /** If true and unknown, any stage that depends on this value halts. */
    drives: z.boolean().default(false),
    /** ⊘ values are enacted but uncommenced, draft, spent or struck down. Never a business rule. */
    executable: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (markerToState[v.marker] !== v.state) {
      ctx.addIssue({
        code: "custom",
        message: `marker ${v.marker} implies state ${markerToState[v.marker]}, got ${v.state}`,
      });
    }
    if (v.state === "unknown" && !v.owner) {
      ctx.addIssue({ code: "custom", message: "an unknown value must name an owner to escalate to (R3)" });
    }
    if (v.marker === "⊘" && v.executable) {
      ctx.addIssue({ code: "custom", message: "⊘ values must be marked executable: false" });
    }
  });
export type RegValue = z.infer<typeof RegValue>;

// ---------------------------------------------------------------------------
// Case facts the intake collects, and conditions over them
// ---------------------------------------------------------------------------

export const Purpose = z.enum(["commercial", "non_commercial"]);
export const Provenance = z.enum(["in_situ", "ex_situ", "dsi_only"]);
export const ApplicantType = z.enum(["foreign_legal", "foreign_natural", "national_legal", "national_natural"]);
export const Exchange = z.enum(["title_transfer", "service_shipment", "dsi_only", "no_movement"]);
export const Tri = z.enum(["yes", "no", "unclear"]);

export const CaseFacts = z.object({
  purpose: Purpose,
  /** Country-specific activity option id (see scope.questions). */
  activity: z.string(),
  provenance: Provenance,
  applicantType: ApplicantType,
  exchange: Exchange,
  communityHeld: Tri,
  tkInvolved: Tri,
  directAffectation: Tri.optional(),
  speciesListed: z.enum(["listed", "not_listed", "unchecked"]).optional(),
  localities: z.number().int().min(1).optional(),
  scientificCollaboration: Tri.optional(),
  /** Free-form flags a country may declare in scope.questions (e.g. Brazil downstream acts). */
  flags: z.record(z.string(), z.string()).default({}),
});
export type CaseFacts = z.infer<typeof CaseFacts>;

/** A condition is an AND of field matches. Each field matches if the fact equals one of the values. */
export const Condition = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export type Condition = z.infer<typeof Condition>;

// ---------------------------------------------------------------------------
// Scope engine (A5.2): in scope, out of scope with recorded basis, or escalate
// ---------------------------------------------------------------------------

export const ScopeQuestion = z.object({
  id: z.string(),
  fact: z.string(),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), hint: z.string().optional() })),
});

export const ScopeRule = z.object({
  id: z.string(),
  when: Condition.optional(),
  whenNot: Condition.optional(),
  result: z.enum(["in_scope", "out_of_scope", "escalate"]),
  basis: RegValue,
  /** Where to send an out-of-scope user. */
  redirect: z.string().optional(),
});

export const ScopeConfig = z.object({
  premise: z.string(),
  questions: z.array(ScopeQuestion),
  rules: z.array(ScopeRule).min(1),
});

// ---------------------------------------------------------------------------
// Stages (the TRIG · WHO · NEEDS · GIVES shape of the Appendix B diagrams)
// ---------------------------------------------------------------------------

export const Subject = z.enum(["platform", "government", "community", "money", "prohibition", "applicant"]);

export const Requirement = z.object({
  id: z.string(),
  text: z.string(),
  reg: RegValue,
  when: Condition.optional(),
});

export const DocumentRequirement = z.object({
  id: z.string(),
  label: z.string(),
  reg: RegValue,
  when: Condition.optional(),
});

export const ConsentParty = z.object({
  id: z.string(),
  label: z.string(),
  when: Condition.optional(),
  reg: RegValue,
});

export const Stage = z.object({
  id: z.string(),
  title: z.string(),
  subject: Subject.default("platform"),
  when: Condition.optional(),
  trig: z.string(),
  who: z.string(),
  needs: z.array(z.string()).default([]),
  gives: z.string(),
  requirements: z.array(Requirement).default([]),
  documents: z.array(DocumentRequirement).default([]),
  consentParties: z.array(ConsentParty).default([]),
  /** Stage whose progress is governed by the regulator state machine. */
  usesStateMachine: z.boolean().default(false),
  /** Stage that produces the listed output instruments on completion. */
  produces: z.array(z.string()).default([]),
});
export type Stage = z.infer<typeof Stage>;

// ---------------------------------------------------------------------------
// Regulator processing as a state machine (A4, A5.5, R8, R9)
// ---------------------------------------------------------------------------

export const StateKind = z.enum(["active", "waiting", "terminal", "halted"]);

export const MachineState = z.object({
  label: z.string(),
  kind: StateKind,
  /** Only states with outcome "granted" produce instruments. */
  outcome: z.enum(["granted", "refused", "withdrawn", "lapsed", "none"]).default("none"),
  reg: RegValue.optional(),
});

export const Transition = z.object({
  from: z.string(),
  to: z.string(),
  event: z.string(),
  actor: z.enum(["applicant", "authority", "system", "community"]),
  reg: RegValue.optional(),
});

export const Clock = z.object({
  id: z.string(),
  label: z.string(),
  startsIn: z.string(),
  days: z.number().int().positive(),
  dayKind: z.enum(["calendar", "working"]),
  extendableDays: z.number().int().optional(),
  suspendsIn: z.array(z.string()).default([]),
  onLapse: z.object({
    to: z.string(),
    effect: z.literal("remedy_against_administrator"),
    reg: RegValue,
  }),
});

export const StateMachine = z.object({
  initial: z.string(),
  states: z.record(z.string(), MachineState),
  transitions: z.array(Transition),
  clocks: z.array(Clock).default([]),
});
export type StateMachine = z.infer<typeof StateMachine>;

// ---------------------------------------------------------------------------
// What the applicant ends up holding (A5.4, R7)
// ---------------------------------------------------------------------------

export const AmendmentPolicy = z.enum([
  "addendum", // Colombia: otrosí against the existing contract, versioned
  "new_application", // Kenya: notify and apply for a new permit
  "new_registration", // Brazil: a new cadastro
  "variation", // authority varies conditions on the live instrument
  "amendment_path", // South Africa reg. 35: amendment as a first-class path
]);

export const OutputInstrument = z.object({
  id: z.string(),
  label: z.string(),
  kind: z.enum(["declaratory_receipt", "permit", "licence", "authorisation", "access_contract", "notification"]),
  issuer: z.string(),
  issuedInState: z.string(),
  automatic: z.boolean().default(false),
  amendmentPolicy: AmendmentPolicy,
  term: RegValue,
  renewalsCapped: RegValue,
  fee: RegValue,
  transferable: RegValue.optional(),
  /** Brazil: verification stays open after the receipt issues. */
  verificationOpenAfterIssue: z.boolean().default(false),
  ircc: RegValue.optional(),
  notes: z.array(z.string()).default([]),
});
export type OutputInstrument = z.infer<typeof OutputInstrument>;

// ---------------------------------------------------------------------------
// A5 variables, A6 classes, R5 judgments, R6 live layers, A7 open questions
// ---------------------------------------------------------------------------

export const A5Variables = z.object({
  whoMayApply: RegValue,
  trigger: RegValue,
  orderOfConsent: RegValue,
  applicantHolds: RegValue,
  clocks: RegValue,
  durationRenewal: RegValue,
  transferExport: RegValue,
  postPermitLifecycle: RegValue,
});

export const ObligationClass = z.object({
  number: z.number().int().min(1).max(9),
  name: z.string(),
  fields: z.record(z.string(), RegValue),
  note: z.string().optional(),
});

export const ManualReview = z.object({
  id: z.string(),
  question: z.string(),
  decides: z.string(),
  reg: RegValue,
  when: Condition.optional(),
});

export const LiveLayer = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  maintainedBy: z.string(),
  reg: RegValue,
  entries: z.array(z.record(z.string(), z.string())).default([]),
});

export const OpenQuestion = z.object({
  id: z.string(),
  question: z.string(),
  affects: z.string(),
  reg: RegValue,
});

export const ChangeOfIntent = z.object({
  whatCounts: RegValue,
  consequence: RegValue,
  policy: AmendmentPolicy,
});

// ---------------------------------------------------------------------------
// The country file
// ---------------------------------------------------------------------------

export const CountryConfig = z.object({
  schemaVersion: z.literal(1),
  code: z.string().length(2),
  name: z.string(),
  legalInstruments: z.array(z.string()).min(1),
  operativeInstrumentStatus: RegValue,
  nagoyaParty: RegValue,
  euSide: RegValue,
  escalation: z.object({
    defaultOwnerRole: z.string(),
    defaultOwnerName: z.string().nullable(),
  }),
  scope: ScopeConfig,
  eligibility: z.array(Requirement).default([]),
  consentOrder: RegValue,
  stages: z.array(Stage).min(3),
  stateMachine: StateMachine,
  outputs: z.array(OutputInstrument).min(1),
  changeOfIntent: ChangeOfIntent,
  variables: A5Variables,
  obligationClasses: z.array(ObligationClass).length(9),
  manualReview: z.array(ManualReview).default([]),
  liveLayers: z.array(LiveLayer).default([]),
  openQuestions: z.array(OpenQuestion).default([]),
  /** Whether a renewal probe may ever be scheduled. Brazil and Malaysia: never. */
  renewalProbe: z.enum(["schedule", "never", "unknown"]),
});
export type CountryConfig = z.infer<typeof CountryConfig>;

export function describeState(state: RegState): string {
  switch (state) {
    case "established":
      return "Established in law";
    case "inferred":
      return "GENE-LINK's own reading";
    case "unknown":
      return "Unresolved";
  }
}
