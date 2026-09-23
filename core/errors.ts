/**
 * Refusals the interface shows to a person as they are.
 *
 * The kind travels on the error itself, under a symbol from the global registry, not on its class.
 * A production build can load a module once per server layer, so the platform may throw a
 * PermissionDenied from one copy of this file while the action that catches it imported the other.
 * `instanceof` against the other copy's class is then false, and a refusal would reach the person as
 * "something unexpected happened" and skip the audit record of the denied attempt. Symbol.for
 * returns the same symbol in every copy, so errorKind() answers the same way in all of them.
 */
export const ERROR_KIND = Symbol.for("genelink.errorKind");

export type ErrorKind = "permission_denied" | "not_found" | "invalid_request" | "transition";

const KINDS: readonly ErrorKind[] = ["permission_denied", "not_found", "invalid_request", "transition"];

abstract class UserFacingError extends Error {
  protected constructor(kind: ErrorKind, name: string, message?: string) {
    super(message);
    this.name = name;
    Object.defineProperty(this, ERROR_KIND, { value: kind, enumerable: false });
  }
}

/** The acting seat may not do this. */
export class PermissionDenied extends UserFacingError {
  constructor(message?: string) {
    super("permission_denied", "PermissionDenied", message);
  }
}

/** The record is not there (the demo may have been reset since the page was rendered). */
export class NotFound extends UserFacingError {
  constructor(message?: string) {
    super("not_found", "NotFound", message);
  }
}

/** A request the platform understood and refused. Interfaces answer 4xx, never 500. */
export class InvalidRequest extends UserFacingError {
  constructor(message?: string) {
    super("invalid_request", "InvalidRequest", message);
  }
}

/** An event the country's state machine does not allow from where the case stands. */
export class TransitionError extends UserFacingError {
  constructor(message?: string) {
    super("transition", "TransitionError", message);
  }
}

/** The kind of a user-facing refusal, whichever copy of this module threw it; null for anything else. */
export function errorKind(e: unknown): ErrorKind | null {
  if (typeof e !== "object" || e === null) return null;
  const k = (e as { [ERROR_KIND]?: unknown })[ERROR_KIND];
  return typeof k === "string" && (KINDS as readonly string[]).includes(k) ? (k as ErrorKind) : null;
}
