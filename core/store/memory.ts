import type { AuditEntry } from "../audit/chain";
import type { Disclosure } from "../audit/disclosure";
import type { Collection, Store } from "./Store";

class MemoryCollection<T extends { id: string }> implements Collection<T> {
  private items = new Map<string, T>();
  get(id: string) {
    return this.items.get(id);
  }
  list() {
    return Array.from(this.items.values());
  }
  put(item: T) {
    this.items.set(item.id, item);
    return item;
  }
  remove(id: string) {
    this.items.delete(id);
  }
  clear() {
    this.items.clear();
  }
}

/**
 * In-memory store for the prototype. State lives for the life of the process and
 * resets when the demo instance restarts. Behind the same Store interface the
 * MVP's PostgreSQL adapter implements.
 */
export class InMemoryStore implements Store {
  readonly kind = "memory" as const;
  persons = new MemoryCollection<Store["persons"] extends Collection<infer T> ? T : never>();
  organisations = new MemoryCollection<Store["organisations"] extends Collection<infer T> ? T : never>();
  memberships = new MemoryCollection<Store["memberships"] extends Collection<infer T> ? T : never>();
  listings = new MemoryCollection<Store["listings"] extends Collection<infer T> ? T : never>();
  interests = new MemoryCollection<Store["interests"] extends Collection<infer T> ? T : never>();
  cases = new MemoryCollection<Store["cases"] extends Collection<infer T> ? T : never>();
  documents = new MemoryCollection<Store["documents"] extends Collection<infer T> ? T : never>();
  escalations = new MemoryCollection<Store["escalations"] extends Collection<infer T> ? T : never>();
  manualReviews = new MemoryCollection<Store["manualReviews"] extends Collection<infer T> ? T : never>();
  instruments = new MemoryCollection<Store["instruments"] extends Collection<infer T> ? T : never>();
  agreements = new MemoryCollection<Store["agreements"] extends Collection<infer T> ? T : never>();
  learning = new MemoryCollection<Store["learning"] extends Collection<infer T> ? T : never>();
  demandSignals = new MemoryCollection<Store["demandSignals"] extends Collection<infer T> ? T : never>();

  private auditLog: AuditEntry[] = [];
  private disclosureLog: Disclosure[] = [];

  audit = {
    list: () => this.auditLog.slice(),
    append: (e: AuditEntry) => {
      this.auditLog.push(e);
    },
    last: () => this.auditLog.at(-1),
    count: () => this.auditLog.length,
  };
  disclosures = {
    list: () => this.disclosureLog.slice(),
    append: (d: Disclosure) => {
      this.disclosureLog.push(d);
    },
    nextSeq: () => this.disclosureLog.length + 1,
  };

  reset() {
    for (const c of [
      this.persons, this.organisations, this.memberships, this.listings, this.interests, this.cases,
      this.documents, this.escalations, this.manualReviews, this.instruments, this.agreements, this.learning,
      this.demandSignals,
    ]) c.clear();
    this.auditLog = [];
    this.disclosureLog = [];
  }
}
