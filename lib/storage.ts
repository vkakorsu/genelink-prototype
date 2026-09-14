/**
 * Object-storage adapter: deliberately not implemented in the prototype.
 * This file documents the boundary so an evaluator can see where the real
 * bucket plugs in and what it must guarantee.
 *
 * The contract this adapter must keep:
 *   - S3-compatible API in an EU region; the docker-compose service in this
 *     repository is the development target.
 *   - Objects are content-addressed: the SHA-256 of the bytes is the key, so
 *     a stored document can always be re-verified against the hash recorded
 *     on its document or instrument version.
 *   - No public URLs. Reads go through case authorisation, never through a
 *     bearer link that outlives a permission change.
 *   - Lifecycle rules (retention for the life of the case plus twenty years
 *     after end of utilisation, per Regulation (EU) No 511/2014 Art. 4(6))
 *     are set on the bucket, not in application code.
 *
 * In the prototype, document "uploads" are pasted text hashed and versioned
 * exactly as file bytes would be; this adapter is the only file that changes
 * when real files arrive.
 */
export interface ObjectStorage {
  /** Store bytes under their SHA-256. Returns the key. */
  put(bytes: Uint8Array, contentType: string): Promise<{ sha256: string }>;
  /** Read an object back by its content hash. */
  get(sha256: string): Promise<Uint8Array>;
}

export function getStorage(): ObjectStorage {
  throw new NotConfiguredError();
}

export class NotConfiguredError extends Error {
  constructor() {
    super("Object storage is an S3-compatible adapter in the MVP. It is documented here and implemented in the build phase; the prototype stores pasted text in memory.");
  }
}
