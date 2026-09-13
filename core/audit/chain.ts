import { createHash } from "node:crypto";

/**
 * Append-only, hash-chained audit log. Every legally or commercially consequential
 * action is an entry. Each entry's hash covers its own content and the previous
 * entry's hash, so any alteration or removal breaks verification from that point.
 *
 * In the MVP this table is append-only at the database level too (no UPDATE or
 * DELETE grants for the application role). Chain checkpoints may be anchored with
 * an RFC 3161 timestamp. This module is the logic. Storage is behind the Store.
 */

export type AuditEntry = {
  seq: number;
  at: string;
  actor: { seatId: string | null; personId: string | null; organisationId: string | null; role: "user" | "administrator" | "system" };
  action: string;
  subject: { type: string; id: string };
  detail: Record<string, unknown>;
  prevHash: string;
  hash: string;
};

export const GENESIS = "0".repeat(64);

export function computeHash(entry: Omit<AuditEntry, "hash">): string {
  const canonical = JSON.stringify({
    seq: entry.seq,
    at: entry.at,
    actor: entry.actor,
    action: entry.action,
    subject: entry.subject,
    detail: entry.detail,
    prevHash: entry.prevHash,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Build the next entry from the previous one. Storage is the caller's concern. */
export function nextEntry(prev: AuditEntry | null, input: Omit<AuditEntry, "seq" | "prevHash" | "hash">): AuditEntry {
  const partial = { ...input, seq: (prev?.seq ?? 0) + 1, prevHash: prev?.hash ?? GENESIS };
  return { ...partial, hash: computeHash(partial) };
}

export function append(chain: AuditEntry[], input: Omit<AuditEntry, "seq" | "prevHash" | "hash">): AuditEntry {
  const entry = nextEntry(chain.length ? chain[chain.length - 1] : null, input);
  chain.push(entry);
  return entry;
}

export type VerificationResult = { ok: true; length: number } | { ok: false; brokenAt: number; reason: string };

export function verifyChain(chain: AuditEntry[]): VerificationResult {
  let prevHash = GENESIS;
  for (let i = 0; i < chain.length; i++) {
    const e = chain[i];
    if (e.seq !== i + 1) return { ok: false, brokenAt: e.seq, reason: "sequence gap" };
    if (e.prevHash !== prevHash) return { ok: false, brokenAt: e.seq, reason: "previous hash mismatch" };
    const { hash, ...rest } = e;
    if (computeHash(rest) !== hash) return { ok: false, brokenAt: e.seq, reason: "content hash mismatch" };
    prevHash = hash;
  }
  return { ok: true, length: chain.length };
}
