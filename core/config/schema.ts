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
 * Every object is strict: a key the schema does not know is a load error, not a
 * silent drop. A misspelt `drives` on an unknown would otherwise disable a halt
 * without anyone noticing, which is the R3 failure the schema exists to prevent.
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
  .strictObject({
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

/**
 * The facts every case carries. The first seven are the common variables Section 6 of
 * the RFP names (purpose, activity, provenance, applicant, exchange scenario, community
 * holding, traditional knowledge). The optional ones are collected only where a
 * country's file declares a question for them. Anything a country needs beyond this
 * set goes into `flags`, keyed by the question's `fact`, so a new country adds
 * questions in its file and nothing in this type.
 *
 * Purpose, activity, provenance and exchange may be absent: absent means "not yet
 * established", never a default. A case opened from a match starts that way, the scope
 * engine answers "undetermined" and every stage that turns on a missing fact halts and
 * names the question (R3). The platform does not guess what the parties will do.
 */
export const CaseFacts = z.strictObject({
  purpose: Purpose.optional(),
  /** Country-specific activity option id (see scope.questions). */
  activity: z.string().optional(),
  provenance: Provenance.optional(),
  applicantType: ApplicantType,
  exchange: Exchange.optional(),
  communityHeld: Tri,
  tkInvolved: Tri,
  directAffectation: Tri.optional(),
  speciesListed: z.enum(["listed", "not_listed", "unchecked"]).optional(),
  localities: z.number().int().min(1).optional(),
  scientificCollaboration: Tri.optional(),
  /** Free-form facts a country may declare in scope.questions (e.g. Brazil downstream acts). */
  flags: z.record(z.string(), z.string()).default({}),
});
export type CaseFacts = z.infer<typeof CaseFacts>;

/** The typed fact keys a question may write to. Any other `fact` writes to `flags`. */
export const TYPED_FACTS = ["activity", "directAffectation", "speciesListed", "localities", "scientificCollaboration"] as const;
/** Facts the shared intake form always collects; a country file may not redeclare them. */
export const SHARED_FACTS = ["purpose", "provenance", "applicantType", "exchange", "communityHeld", "tkInvolved"] as const;

/** A condition is an AND of field matches. Each field matches if the fact equals one of the values. */
export const Condition = z.record(z.string(), z.union([z.string(), z.array(z.string())]));
export type Condition = z.infer<typeof Condition>;

// ---------------------------------------------------------------------------
// Scope engine (A5.2): in scope, out of scope with recorded basis, or escalate
// ---------------------------------------------------------------------------

/**
 * An intake question the country declares. Exactly one has `fact: activity` (the
 * scope engine's deciding fact). The others collect the country's own deciding facts,
 * rendered by the interface from this declaration: Colombia's direct affectation,
 * Kenya's species status and locality count, Brazil's collaboration fact. A new
 * country adds questions here; the interface has no country-specific code.
 */
export const ScopeQuestion = z.strictObject({
  id: z.string(),
  fact: z.string(),
  prompt: z.string(),
  kind: z.enum(["choice", "number"]).default("choice"),
  options: z.array(z.strictObject({ id: z.string(), label: z.string(), hint: z.string().optional() })).default([]),
  /** Option pre-selected when the fact has not been answered yet. Only for a fact whose unanswered state is itself an option. */
  default: z.string().optional(),
  /** Shown under the prompt. Use it to say what the answer does and does not decide. */
  note: z.string().optional(),
  /** Evidence chip shown with the question, e.g. the R5 judgment a fact does not replace. */
  reg: RegValue.optional(),
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});
export type ScopeQuestion = z.infer<typeof ScopeQuestion>;

export const ScopeRule = z.strictObject({
  id: z.string(),
  when: Condition.optional(),
  whenNot: Condition.optional(),
  result: z.enum(["in_scope", "out_of_scope", "escalate"]),
  basis: RegValue,
  /** Where to send an out-of-scope user. */
  redirect: z.string().optional(),
});

export const ScopeConfig = z.strictObject({
  premise: z.string(),
  questions: z.array(ScopeQuestion).min(1),
  rules: z.array(ScopeRule).min(1),
});

// ---------------------------------------------------------------------------
// Stages (the TRIG · WHO · NEEDS · GIVES shape of the Appendix B diagrams)
// ---------------------------------------------------------------------------

export const Subject = z.enum(["platform", "government", "community", "money", "prohibition", "applicant"]);

/**
 * What a matching requirement does to its stage, beyond informing.
 *  stop  an established prohibition applies on these facts (a red box in the Appendix B
 *        diagrams, e.g. Kenya reg. 11(4)(e)). The stage is stopped: nothing on it or after
 *        it can be completed, and no rule is bent to find a way round.
 *  hold  the rule is settled but a fact it needs has not been established from the source
 *        the rule names (e.g. species status on an authoritative list). The stage halts on
 *        the parties' question, not on a legal unknown.
 */
export const RequirementEffect = z.enum(["stop", "hold"]);

export const Requirement = z.strictObject({
  id: z.string(),
  text: z.string(),
  reg: RegValue,
  when: Condition.optional(),
  effect: RequirementEffect.optional(),
});

export const DocumentRequirement = z.strictObject({
  id: z.string(),
  label: z.string(),
  reg: RegValue,
  when: Condition.optional(),
});

export const ConsentParty = z.strictObject({
  id: z.string(),
  label: z.string(),
  when: Condition.optional(),
  reg: RegValue,
});

export const Stage = z.strictObject({
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
  /** Informational stage: duties recorded for phase two, never marked complete (R10). */
  informational: z.boolean().default(false),
});
export type Stage = z.infer<typeof Stage>;

// ---------------------------------------------------------------------------
// Regulator processing as a state machine (A4, A5.5, R8, R9)
// ---------------------------------------------------------------------------

export const StateKind = z.enum(["active", "waiting", "terminal", "halted"]);

export const MachineState = z.strictObject({
  label: z.string(),
  kind: StateKind,
  /** Only states with outcome "granted" produce instruments. */
  outcome: z.enum(["granted", "refused", "withdrawn", "lapsed", "none"]).default("none"),
  reg: RegValue.optional(),
});

export const Transition = z.strictObject({
  from: z.string(),
  to: z.string(),
  event: z.string(),
  actor: z.enum(["applicant", "authority", "system", "community"]),
  reg: RegValue.optional(),
  /**
   * Guard over case facts. A transition whose guard reads a fact nobody has answered is not
   * available: the engine will not pick a branch of the law for the parties (Brazil Art. 27).
   */
  when: Condition.optional(),
});

export const Clock = z.strictObject({
  id: z.string(),
  label: z.string(),
  /** The state whose entry starts the clock. */
  startsIn: z.string(),
  /**
   * States in which the clock counts down and can lapse. Defaults to [startsIn]. A clock that runs
   * from receipt through publication (Kenya reg. 14(1)) or from registration through evaluation
   * (Colombia D391 Art. 29) lists every state it runs through.
   */
  runsIn: z.array(z.string()).optional(),
  days: z.number().int().positive(),
  dayKind: z.enum(["calendar", "working"]),
  /**
   * The rule that says when the clock starts and what it counts (Kenya reg. 14(1): "from the date of
   * the receipt"). It decides when a lapse is recorded against the administrator, so it carries its
   * evidence class like any rule that drives a decision (R4).
   */
  basis: RegValue,
  /** Total days the authority may add, counted in the clock's own dayKind (Colombia Art. 29: up to 60 working days). */
  extendableDays: z.number().int().positive().optional(),
  /** The rule behind the extension. Required when extendableDays is set. */
  extension: RegValue.optional(),
  /**
   * States in which the clock is suspended: time spent there does not count, and the deadline
   * moves forward by that time when the clock resumes (Kenya reg. 14(3), Brazil Decreto Art. 28).
   */
  suspendsIn: z.array(z.string()).default([]),
  onLapse: z.strictObject({
    to: z.string(),
    effect: z.literal("remedy_against_administrator"),
    reg: RegValue,
  }),
});

/**
 * The days a working-day clock skips. Data, because public holidays are gazetted per country
 * and some move every year (Kenya's Idd-ul-Fitr, Colombia's Ley Emiliani Mondays).
 */
export const WorkingCalendar = z.strictObject({
  /** ISO weekday numbers that are never working days (1 = Monday ... 7 = Sunday). */
  weekend: z.array(z.number().int().min(1).max(7)).default([6, 7]),
  holidays: z.array(z.strictObject({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    name: z.string(),
    /** A date that moves with a moon sighting or a later gazette notice. Counted, and shown as provisional. */
    provisional: z.boolean().default(false),
  })).default([]),
  /** Last date the holiday list is maintained through. A deadline beyond it counts weekends only and says so. */
  coversThrough: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reg: RegValue,
});
export type WorkingCalendar = z.infer<typeof WorkingCalendar>;

export const StateMachine = z.strictObject({
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

export const OutputInstrument = z.strictObject({
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
  /** The body whose post-issue verification the reviewer seat records (e.g. CGen). Required when verification stays open. */
  verifier: z.string().optional(),
  ircc: RegValue.optional(),
  notes: z.array(z.string()).default([]),
});
export type OutputInstrument = z.infer<typeof OutputInstrument>;

// ---------------------------------------------------------------------------
// A5 variables, A6 classes, R5 judgments, R6 live layers, A7 open questions
// ---------------------------------------------------------------------------

export const A5Variables = z.strictObject({
  whoMayApply: RegValue,
  trigger: RegValue,
  orderOfConsent: RegValue,
  applicantHolds: RegValue,
  clocks: RegValue,
  durationRenewal: RegValue,
  transferExport: RegValue,
  postPermitLifecycle: RegValue,
});

export const ObligationClass = z.strictObject({
  number: z.number().int().min(1).max(9),
  name: z.string(),
  fields: z.record(z.string(), RegValue),
  note: z.string().optional(),
});

export const ManualReview = z.strictObject({
  id: z.string(),
  question: z.string(),
  decides: z.string(),
  /** The stage this judgment halts. Declared here so the engine carries no list of review ids. */
  stageId: z.string(),
  reg: RegValue,
  when: Condition.optional(),
  /**
   * Requirements in the same stage whose open question this judgment answers for one case. A rule
   * with no statutory test is never answered by configuration; the reviewer's recorded judgment is
   * the answer for that case, and only once it is recorded does the requirement stop halting it.
   */
  answers: z.array(z.string()).default([]),
});

export const LiveLayer = z.strictObject({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  maintainedBy: z.string(),
  reg: RegValue,
  entries: z.array(z.record(z.string(), z.string())).default([]),
});

export const OpenQuestion = z.strictObject({
  id: z.string(),
  question: z.string(),
  affects: z.string(),
  reg: RegValue,
});

export const ChangeOfIntent = z.strictObject({
  whatCounts: RegValue,
  consequence: RegValue,
  policy: AmendmentPolicy,
});

// ---------------------------------------------------------------------------
// The country file
// ---------------------------------------------------------------------------

export const CountryConfig = z.strictObject({
  schemaVersion: z.literal(1),
  code: z.string().length(2),
  name: z.string(),
  /** A short label the interface shows next to the name, e.g. "dry run". Presentation only. */
  tag: z.string().optional(),
  /**
   * The IANA time zone the authority counts its days in. A statutory day is a date on the authority's
   * calendar, and a deadline runs to the end of its last day there, not to an instant in UTC.
   */
  timeZone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, { message: "not an IANA time zone the runtime recognises (for example Africa/Nairobi)" }),
  legalInstruments: z.array(z.string()).min(1),
  operativeInstrumentStatus: RegValue,
  nagoyaParty: RegValue,
  euSide: RegValue,
  escalation: z.strictObject({
    defaultOwnerRole: z.string(),
    defaultOwnerName: z.string().nullable(),
  }),
  scope: ScopeConfig,
  eligibility: z.array(Requirement).default([]),
  consentOrder: RegValue,
  stages: z.array(Stage).min(3),
  stateMachine: StateMachine,
  /** Required where any clock counts working days (linted). */
  calendar: WorkingCalendar.optional(),
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

/** The question whose answer the scope engine decides on. The linter guarantees exactly one exists. */
export function activityQuestion(cfg: CountryConfig): ScopeQuestion {
  const q = cfg.scope.questions.find((x) => x.fact === "activity");
  if (!q) throw new Error(`${cfg.code}: no intake question declares fact "activity"`);
  return q;
}

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
