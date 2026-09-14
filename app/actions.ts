"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getPlatform, resetPlatform } from "@/core";
import { CaseFacts } from "@/core/config/schema";
import { InvalidRequest, NotFound, PermissionDenied } from "@/core/platform";
import { TransitionError } from "@/core/engine/stateMachine";
import { ADMIN } from "@/core/seed/seed";
import { OBJECTIVE_COOKIE, SEAT_COOKIE, getSession } from "@/lib/session";
import { MODEL_CLAUSES } from "@/lib/clauses";
import { redactIdentifiers } from "@/lib/redact";

/**
 * Server actions: the only way the interface mutates state. Each one resolves the
 * acting seat from the session and delegates to the core, which evaluates
 * permissions and writes the audit chain. Errors are surfaced as a query string
 * so the page can show them without a client bundle.
 *
 * Case-scoped actions take the case id as a bound argument, not a free-form field, so
 * the page acts on the case it rendered. Bound arguments travel in the form body, so
 * they are not treated as trustworthy: the core checks that every agreement, instrument
 * and review acted on belongs to that case and that the seat is a participant, and the
 * redirect always returns to the case the action actually touched. Authorisation lives
 * in the core, never in the interface.
 */

function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function back(path: string, error?: string) {
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
}

/** Turn any failure into one sentence the page can show. Unexpected errors are logged, never leaked. */
function describe(e: unknown): string {
  if (e instanceof ZodError) {
    const fields = [...new Set(e.issues.map((i) => i.path.join(".") || "form"))];
    return `The form is incomplete: ${fields.map(friendlyField).join(", ")}. Choose an answer for each before saving.`;
  }
  if (e instanceof PermissionDenied || e instanceof InvalidRequest || e instanceof NotFound || e instanceof TransitionError) return e.message;
  if (e instanceof Error && /Unknown (output|amendment policy)|No configured pathway|Stage not on this pathway/.test(e.message)) return e.message;
  console.error("[action]", e);
  return "Not done. Something unexpected happened on the server and has been logged. Nothing was changed.";
}

const FIELD_NAMES: Record<string, string> = {
  purpose: "purpose", activity: "activity", provenance: "material provenance", applicantType: "applicant type", exchange: "material-exchange scenario",
  communityHeld: "community-held", tkInvolved: "traditional knowledge involved", directAffectation: "direct affectation", speciesListed: "species status",
  scientificCollaboration: "scientific collaboration", localities: "collection localities (a whole number)",
};
function friendlyField(f: string) {
  return FIELD_NAMES[f] ?? f;
}

async function requireSeat() {
  const s = await getSession();
  if (s.kind !== "seat") throw new PermissionDenied("Choose a persona with a seat first");
  return s.actor;
}

async function requireAdmin() {
  const s = await getSession();
  if (s.kind !== "admin") throw new PermissionDenied("Administrator sign-in required");
  return ADMIN;
}

function wrap<T extends unknown[]>(fn: (...a: T) => Promise<void> | void, path: (...a: T) => string) {
  return async (...a: T) => {
    try {
      await fn(...a);
    } catch (e) {
      if (isRedirect(e)) throw e;
      back(path(...a), describe(e));
      return;
    }
    back(path(...a));
  };
}

/** A form field that echoes a route id is refused outright when it disagrees with the bound argument. */
function rejectStrayId(fd: FormData, name: string, bound: string) {
  const v = fd.get(name);
  if (typeof v === "string" && v.trim() && v.trim() !== bound) {
    throw new InvalidRequest(`The submitted ${name} does not match this address. Reload the page and try again.`);
  }
}

/** A case-scoped action. The first argument is bound by the page; the form supplies the rest. */
function onCase(fn: (caseId: string, fd: FormData) => Promise<void> | void) {
  return wrap(async (caseId: string, fd: FormData) => {
    rejectStrayId(fd, "caseId", caseId);
    await fn(caseId, fd);
  }, (caseId) => `/cases/${encodeURIComponent(caseId)}`);
}

function text(fd: FormData, name: string, max = 2000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

// ------------------------------------------------------------- persona (demo)
export async function switchPersona(formData: FormData) {
  const seat = text(formData, "seat", 100);
  const jar = await cookies();
  if (!seat) jar.delete(SEAT_COOKIE);
  else jar.set(SEAT_COOKIE, seat, { httpOnly: true, sameSite: "lax", path: "/" });
  const next = text(formData, "next", 300);
  revalidatePath("/", "layout");
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function declareObjective(formData: FormData) {
  // Free text is checked for identifying content before it is stored or shown anywhere, including back to its author.
  const { text: have, redactions } = redactIdentifiers(text(formData, "have", 200));
  const want = text(formData, "want", 40) || "learn";
  const jar = await cookies();
  jar.set(OBJECTIVE_COOKIE, JSON.stringify({ have, want, redactions, declaredAt: new Date().toISOString() }), { httpOnly: true, sameSite: "lax", path: "/" });
  revalidatePath("/", "layout");
  redirect(want === "learn" ? "/learn" : want === "get_abs_compliant" ? "/cases" : "/explore");
}

export async function resetDemo() {
  resetPlatform();
  revalidatePath("/", "layout");
  redirect("/?reset=1");
}

// -------------------------------------------------------------- discovery
export const signalInterest = wrap(
  async (listingId: string, fd: FormData) => {
    rejectStrayId(fd, "listingId", listingId);
    const actor = await requireSeat();
    const r = getPlatform().signalInterest(actor, listingId);
    if (r.mutual && r.caseId) redirect(`/cases/${r.caseId}`);
  },
  (listingId) => `/listings/${encodeURIComponent(listingId)}`,
);

export const reciprocate = wrap(
  async (listingId: string, fd: FormData) => {
    rejectStrayId(fd, "listingId", listingId);
    const actor = await requireSeat();
    const r = getPlatform().reciprocate(actor, listingId, text(fd, "organisationId", 100));
    redirect(`/cases/${r.caseId}`);
  },
  (listingId) => `/listings/${encodeURIComponent(listingId)}`,
);

// -------------------------------------------------------------- verification
export const requestVerification = wrap(
  async (organisationId: string, fd: FormData) => {
    const actor = await requireSeat();
    getPlatform().requestVerification(actor, organisationId, text(fd, "method", 40) as "institutional_email" | "manual_vetting" | "vouching" | "orcid");
  },
  (organisationId) => `/organisations/${encodeURIComponent(organisationId)}`,
);

export const decideVerification = wrap(
  async (fd: FormData) => {
    const admin = await requireAdmin();
    getPlatform().decideVerification(admin, text(fd, "organisationId", 100), text(fd, "outcome", 20) as "verified" | "declined", text(fd, "reason") || "No reason given");
  },
  () => `/admin`,
);

// ------------------------------------------------------------------ cases
function parseFacts(fd: FormData): CaseFacts {
  const localities = text(fd, "localities", 6);
  const opt = (name: string) => text(fd, name, 40) || undefined;
  return CaseFacts.parse({
    purpose: opt("purpose"),
    activity: opt("activity"),
    provenance: opt("provenance"),
    applicantType: opt("applicantType"),
    exchange: opt("exchange"),
    communityHeld: opt("communityHeld"),
    tkInvolved: opt("tkInvolved"),
    directAffectation: opt("directAffectation"),
    speciesListed: opt("speciesListed"),
    scientificCollaboration: opt("scientificCollaboration"),
    localities: localities ? Number(localities) : undefined,
    flags: {},
  });
}

export const updateFacts = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().updateFacts(actor, caseId, parseFacts(fd));
});

export const changeOfIntent = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  const description = text(fd, "description", 300);
  if (!description) throw new InvalidRequest("Say what changed. The description is the change-of-intent record.");
  getPlatform().changeOfIntent(actor, caseId, parseFacts(fd), description);
});

export const uploadDocument = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  const content = typeof fd.get("content") === "string" ? (fd.get("content") as string) : "";
  getPlatform().uploadDocument(actor, caseId, text(fd, "requirementId", 100), text(fd, "label", 200), text(fd, "fileName", 200) || "document.txt", content);
});

export const markStage = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().markStage(actor, caseId, text(fd, "stageId", 100), text(fd, "progress", 20) as "not_started" | "in_progress" | "complete");
});

export const fireEvent = onCase(async (caseId, fd) => {
  const s = await getSession();
  if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
  getPlatform().fireEvent(s.actor, caseId, text(fd, "event", 60), text(fd, "note", 500) || undefined);
});

export const tickClocks = onCase(async (caseId, fd) => {
  const s = await getSession();
  if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
  const p = getPlatform();
  const mode = text(fd, "days", 10);
  if (mode === "lapse") {
    const r = p.forceLapse(caseId);
    if (!r) throw new InvalidRequest("No clock is running in the current state, so there is nothing to lapse.");
    return;
  }
  const days = Number(mode || 0);
  if (!Number.isFinite(days) || days < 0 || days > 3650) throw new InvalidRequest("Days must be a number between 0 and 3650");
  p.tickClocks(caseId, new Date(Date.now() + days * 86_400_000));
});

export const recordInstrument = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  const content = typeof fd.get("content") === "string" ? (fd.get("content") as string) : "";
  getPlatform().recordExternalInstrument(actor, caseId, text(fd, "outputId", 100), text(fd, "fileName", 200) || "instrument.pdf", content);
});

export const amendInstrument = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().amendInstrument(actor, caseId, text(fd, "instrumentId", 150), text(fd, "summary", 500));
});

export const setInstrumentStatus = onCase(async (caseId, fd) => {
  const s = await getSession();
  if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
  getPlatform().setInstrumentStatus(s.actor, caseId, text(fd, "instrumentId", 150), text(fd, "status", 30) as "verified" | "correction_required" | "cancelled" | "issued", text(fd, "note", 300));
});

export const createAgreement = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  const title = text(fd, "title", 200) || "Draft agreement";
  const selected = fd.getAll("clause").map(String);
  const clauses = MODEL_CLAUSES.filter((c) => selected.includes(c.id));
  getPlatform().createAgreement(actor, caseId, title, clauses);
});

export const reviseAgreement = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  const p = getPlatform();
  const agreementId = text(fd, "agreementId", 150);
  const a = p.store.agreements.get(agreementId);
  if (!a) throw new NotFound(`Agreement ${agreementId} was not found. The demo may have been reset since this page was rendered. Reload the page.`);
  const latest = a.versions[a.versions.length - 1];
  const negotiated = text(fd, "negotiated", 4000);
  const clauses = negotiated
    ? [...latest.clauses, { id: `n${latest.clauses.length + 1}`, title: "Negotiated clause", text: negotiated, source: "negotiated" as const }]
    : latest.clauses;
  p.reviseAgreement(actor, caseId, agreementId, text(fd, "summary", 300), clauses, fd.get("offPlatform") ? "uploaded_off_platform" : "platform");
});

export const approveAgreement = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().approveAgreement(actor, caseId, text(fd, "agreementId", 150));
});

export const executeAgreement = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().executeAgreement(actor, caseId, text(fd, "agreementId", 150));
});

export const requestSupport = onCase(async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().requestSupport(actor, caseId, text(fd, "kind", 20) as "technical" | "expert", text(fd, "note", 1000));
});

/** R5. The reviewer seat is the administrator in the prototype. Bound to the case so the redirect can never point elsewhere. */
export const decideManualReview = onCase(async (caseId, fd) => {
  const admin = await requireAdmin();
  const recordId = text(fd, "recordId", 150);
  const rec = getPlatform().store.manualReviews.get(recordId);
  if (rec && rec.caseId !== caseId) throw new PermissionDenied("Manual review does not belong to this case");
  getPlatform().decideManualReview(admin, recordId, text(fd, "outcome", 500), text(fd, "reason", 1000));
});

/** The same judgment recorded from the administrator console. */
export const decideManualReviewFromConsole = wrap(
  async (fd: FormData) => {
    const admin = await requireAdmin();
    getPlatform().decideManualReview(admin, text(fd, "recordId", 150), text(fd, "outcome", 500), text(fd, "reason", 1000));
  },
  () => `/admin`,
);

export const adminIntervene = onCase(async (caseId, fd) => {
  const admin = await requireAdmin();
  getPlatform().adminIntervene(admin, caseId, text(fd, "action", 500), text(fd, "reason", 1000));
});
