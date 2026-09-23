import type { AuditEntry } from "../audit/chain";
import type { Disclosure } from "../audit/disclosure";
import type {
  Agreement,
  Case,
  CaseDocument,
  DemandSignal,
  EscalationRecord,
  Instrument,
  InterestSignal,
  LearningResource,
  Listing,
  ManualReviewRecord,
  Membership,
  Organisation,
  Person,
} from "../domain/types";

/**
 * Repository boundary. The core and the web application depend on this
 * interface only. The prototype ships an in-memory implementation seeded with
 * fictional parties. The MVP implements it over PostgreSQL (see postgres.ts for
 * the documented, unimplemented adapter). Nothing above this line knows which.
 */
export interface Collection<T extends { id: string }> {
  get(id: string): T | undefined;
  list(): T[];
  put(item: T): T;
  remove(id: string): void;
}

export interface Store {
  persons: Collection<Person>;
  organisations: Collection<Organisation>;
  memberships: Collection<Membership>;
  listings: Collection<Listing>;
  interests: Collection<InterestSignal>;
  cases: Collection<Case>;
  documents: Collection<CaseDocument>;
  escalations: Collection<EscalationRecord>;
  manualReviews: Collection<ManualReviewRecord>;
  instruments: Collection<Instrument>;
  agreements: Collection<Agreement>;
  learning: Collection<LearningResource>;
  demandSignals: Collection<DemandSignal>;
  /** Append-only. Implementations must not expose update or delete for these. */
  audit: { list(): AuditEntry[]; append(e: AuditEntry): void; last(): AuditEntry | undefined; count(): number };
  disclosures: { list(): Disclosure[]; append(d: Disclosure): void; nextSeq(): number };
  /** Demo-only: reset to the seed. A production store does not implement this. */
  reset?(): void;
  readonly kind: "memory" | "postgres";
}
