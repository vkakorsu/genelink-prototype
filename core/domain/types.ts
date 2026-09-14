import type { CaseFacts } from "../config/schema";
import type { MachineSnapshot } from "../engine/stateMachine";

// ---------------------------------------------------------------------------
// People, organisations, memberships (three entities, RFP Section 6)
// ---------------------------------------------------------------------------

export type Person = {
  id: string;
  name: string;
  email: string;
  orcid?: string;
  country: string;
  onboardingPath: "A" | "B";
  badges: { id: string; title: string; earnedOn: string; issuer: string }[];
};

/** What an organisation does in the market. One organisation may hold several. */
export type MarketFunction = "seeking" | "providing" | "advising" | "brokering" | "custodian" | "learning";

export type Organisation = {
  id: string;
  name: string;
  kind: "company" | "research_institution" | "community_custodian" | "broker" | "adviser" | "authority";
  country: string;
  functions: MarketFunction[];
  verification: {
    status: "unverified" | "pending" | "verified" | "declined";
    method?: "orcid" | "institutional_email" | "manual_vetting" | "vouching";
    decidedBy?: string;
    decidedAt?: string;
    reason?: string;
  };
  credentials: { title: string; issuer: string; reg?: "verified" | "self_declared" }[];
  description: string;
};

/** What a person may do on an organisation's behalf. A property of the seat, not the person. */
export type Permission = "administrator" | "authorised_signatory" | "member" | "viewer";

export type Membership = {
  id: string;
  personId: string;
  organisationId: string;
  permission: Permission;
  invitedBy?: string;
  since: string;
};

/** The transient objective a user declares for a visit. Never a fixed role. */
export type VisitObjective = {
  have: string;
  want: "sell_to_eu_buyer" | "source_from_south" | "find_broker" | "get_abs_compliant" | "learn" | "screening_agreement";
  declaredAt: string;
  /** How many identifying items (emails, phone numbers, identifiers) were removed from the free text before it was stored. */
  redactions?: number;
};

// ---------------------------------------------------------------------------
// Listings and discovery
// ---------------------------------------------------------------------------

export type Listing = {
  id: string;
  /** GENE-LINK-native identifier minted at listing. GGBN only where available. */
  glId: string;
  ggbnId?: string;
  organisationId: string;
  side: "offer" | "need";
  functionCodes: string[];
  resourceClass: string;
  provenanceCountry: string;
  /** Public projection fields */
  publicSummary: string;
  indicativeScale: string;
  /** Full projection fields, revealed on mutual interest only */
  speciesDetail: string;
  localityDetail: string;
  fullDescription: string;
  /** DSI exposure analysis flags and informs. It never asserts an obligation. */
  dsiExposure: "none" | "possible" | "likely";
  createdAt: string;
};

export type InterestSignal = {
  id: string;
  fromOrganisationId: string;
  toListingId: string;
  at: string;
  bySeatId: string;
};

// ---------------------------------------------------------------------------
// Cases (the partnership pipeline)
// ---------------------------------------------------------------------------

export type CaseParticipant = { organisationId: string; role: "demand" | "supply" | "adviser" | "broker" | "custodian" };

export type CaseDocument = {
  id: string;
  caseId: string;
  requirementId: string;
  label: string;
  fileName: string;
  sha256: string;
  uploadedBySeatId: string;
  uploadedAt: string;
  /** The platform checks presence and type. Never sufficiency. */
  check: "present";
};

export type EscalationRecord = {
  id: string;
  caseId: string;
  stageId: string;
  question: string;
  owner: string;
  ownerName: string | null;
  status: "open" | "answered";
  raisedAt: string;
  /** Answering an escalation is a configuration change with legal review, never an in-case override. */
  answer?: { by: string; at: string; note: string };
};

export type ManualReviewRecord = {
  id: string;
  caseId: string;
  reviewId: string;
  question: string;
  status: "pending_human_judgment" | "decided";
  decision?: { by: string; at: string; outcome: string; reason: string };
};

export type ChangeOfIntentEvent = {
  id: string;
  caseId: string;
  at: string;
  description: string;
  previousFacts: CaseFacts;
  newFacts: CaseFacts;
  consequencePolicy: string;
  consequenceText: string;
};

export type Case = {
  id: string;
  title: string;
  providerCountry: string;
  participants: CaseParticipant[];
  listingId?: string;
  facts: CaseFacts;
  machine: MachineSnapshot;
  revealedAt?: string;
  createdAt: string;
  stageProgress: Record<string, "not_started" | "in_progress" | "complete">;
  changeOfIntent: ChangeOfIntentEvent[];
  supportRequests: { id: string; at: string; bySeatId: string; kind: "technical" | "expert"; routedTo: string; note: string }[];
  /** Administrator interventions, visible to the parties on the case, not only in the audit chain. */
  interventions?: { id: string; at: string; by: string; action: string; reason: string }[];
};

// ---------------------------------------------------------------------------
// Instruments (A5.4, R7) and agreements
// ---------------------------------------------------------------------------

export type InstrumentVersion = {
  version: number;
  kind: "original" | "addendum" | "variation" | "correction";
  at: string;
  summary: string;
  sha256: string;
  recordedBySeatId: string;
};

export type Instrument = {
  id: string;
  caseId: string;
  outputId: string;
  label: string;
  kind: string;
  issuer: string;
  /**
   * awaiting_record: the regime says this instrument now exists (the machine reached its issuing state)
   * but the platform holds no copy. The platform never fabricates an instrument an authority issued.
   * An authorised signatory records it, and only then does it carry a version and a hash.
   */
  status: "awaiting_record" | "issued" | "verification_open" | "verified" | "correction_required" | "cancelled" | "revoked" | "surrendered";
  amendmentPolicy: string;
  versions: InstrumentVersion[];
  issuedAt: string;
  /** External instruments are recorded, not created, by the platform. */
  origin: "recorded_external" | "platform_rendered";
};

export type AgreementVersion = {
  version: number;
  at: string;
  authorSeatId: string;
  summary: string;
  clauses: { id: string; title: string; text: string; source: "model_clause" | "negotiated" | "illustrative" }[];
  sha256: string;
  origin: "platform" | "uploaded_off_platform";
};

export type Approval = { seatId: string; organisationId: string; at: string; versionNumber: number };

export type Execution = {
  seatId: string;
  organisationId: string;
  at: string;
  versionNumber: number;
  sha256: string;
  method: "platform_click_to_sign" | "recorded_external";
  stepUpAuth: "passkey_and_totp" | "demo";
};

export type Agreement = {
  id: string;
  caseId: string;
  title: string;
  status: "drafting" | "under_approval" | "approved" | "executed" | "recorded";
  versions: AgreementVersion[];
  approvals: Approval[];
  executions: Execution[];
};

// ---------------------------------------------------------------------------
// Support and learning
// ---------------------------------------------------------------------------

export type LearningResource = {
  id: string;
  title: string;
  stageIds: string[];
  countryCodes: string[];
  status: "pending_landscape_alliance_content" | "available";
  url?: string;
};
