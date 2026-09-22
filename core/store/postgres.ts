import type { Store } from "./Store";

/**
 * PostgreSQL adapter: the MVP's persistence, deliberately not implemented in the
 * prototype. This file documents the boundary so an evaluator can see where the
 * real store plugs in and what it must guarantee.
 *
 * Schema outline (one table per collection, plus):
 *   audit_log          append-only. The application role has INSERT and SELECT only.
 *                      seq is a sequence, prev_hash and hash are stored, verified nightly.
 *   disclosure_log     append-only, same grants.
 *   demand_signal      declared visit objectives, organisation-level and never personal, kept
 *                      24 months and then aggregated (proposal Part 4.11).
 *   Row-level security on organisation-scoped tables (listings, cases, documents,
 *   agreements, instruments) keyed on the acting seat's organisation.
 *   Configuration snapshots (JSONB) recorded on every case so that a later change
 *   to a country file does not rewrite the history of a case evaluated under the old one.
 *
 * Retention: cases, instruments, agreements, audit and disclosure logs are kept for
 * the life of the case plus 20 years after end of utilisation (Regulation (EU) No
 * 511/2014 Art. 4(6)); personal data is pseudonymised in retained records when a
 * seat is closed.
 */
export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  constructor(_connectionString: string) {
    throw new NotConfiguredError();
  }
  // The following members exist to satisfy the interface. They are unreachable because the constructor throws.
  persons!: Store["persons"];
  organisations!: Store["organisations"];
  memberships!: Store["memberships"];
  listings!: Store["listings"];
  interests!: Store["interests"];
  cases!: Store["cases"];
  documents!: Store["documents"];
  escalations!: Store["escalations"];
  manualReviews!: Store["manualReviews"];
  instruments!: Store["instruments"];
  agreements!: Store["agreements"];
  learning!: Store["learning"];
  demandSignals!: Store["demandSignals"];
  audit!: Store["audit"];
  disclosures!: Store["disclosures"];
}

export class NotConfiguredError extends Error {
  constructor() {
    super("PostgresStore is the MVP persistence adapter. It is documented here and implemented in the build phase, not in the prototype.");
  }
}
