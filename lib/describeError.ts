import { ZodError } from "zod";
import { errorKind } from "../core/errors";

/**
 * Turn any failure into one sentence the page can show. Unexpected errors are logged, never leaked.
 *
 * Refusals are recognised by errorKind(), never by `instanceof`: the action that catches an error
 * and the core that threw it can hold different copies of the error classes in a production build
 * (see core/errors.ts). The same holds for zod, so a validation failure is recognised by its shape.
 */
export function describeError(e: unknown): string {
  if (isZodError(e)) {
    const missing = [...new Set(e.issues.filter((i) => i.code === "invalid_type").map((i) => i.path.join(".") || "form"))];
    const invalid = [...new Set(e.issues.filter((i) => i.code !== "invalid_type").map((i) => i.path.join(".") || "form"))];
    return [
      missing.length ? `The form is incomplete: ${missing.map(friendlyField).join(", ")}. Choose an answer for each before saving.` : "",
      invalid.length ? `These answers are not among the options offered: ${invalid.map(friendlyField).join(", ")}. Reload the page and choose again.` : "",
    ].filter(Boolean).join(" ");
  }
  if (errorKind(e)) return (e as Error).message;
  if (e instanceof Error && /Unknown (output|amendment policy)|No configured pathway|Stage not on this pathway/.test(e.message)) return e.message;
  console.error("[action]", e);
  return "Not done. Something unexpected happened on the server and has been logged. Nothing was changed.";
}

/** A permission refusal the core has not already written to the audit chain itself. */
export function isUnauditedDenial(e: unknown): e is Error {
  return errorKind(e) === "permission_denied" && !(e as { audited?: boolean }).audited;
}

function isZodError(e: unknown): e is ZodError {
  if (e instanceof ZodError) return true;
  return typeof e === "object" && e !== null && (e as { name?: unknown }).name === "ZodError" && Array.isArray((e as { issues?: unknown }).issues);
}

const FIELD_NAMES: Record<string, string> = {
  purpose: "purpose", activity: "activity", provenance: "material provenance", applicantType: "applicant type", exchange: "material-exchange scenario",
  communityHeld: "community-held", tkInvolved: "traditional knowledge involved", directAffectation: "direct affectation", speciesListed: "species status",
  scientificCollaboration: "scientific collaboration", localities: "collection localities (a whole number)",
};
function friendlyField(f: string) {
  return FIELD_NAMES[f] ?? f;
}
