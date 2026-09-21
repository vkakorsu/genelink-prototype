"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ZodError } from "zod";
import { getPlatform, resetPlatform } from "@/core";
import { CaseFacts, TYPED_FACTS, type CountryConfig } from "@/core/config/schema";
import type { MarketFunction } from "@/core/domain/types";
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

/** Browsers always send Origin on a POST. A submission without one is refused: it did not come from a page this site rendered. */
async function requireOrigin() {
  const origin = (await headers()).get("origin");
  if (!origin || origin === "null") throw new PermissionDenied("This action only accepts submissions sent from this site. The request carried no Origin header, so it was refused.");
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

/** The acting seat or admin, so the core can deny and audit a party's attempt rather than the interface pre-empting it. */
async function requireActor() {
  const s = await getSession();
  if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
  return s.actor;
}

/**
 * The interface promises that a denied attempt lands on the audit chain. Domain denials
 * audit themselves in the core and arrive marked; every other refusal is recorded here
 * with the operation name. Auditing must never break the refusal itself.
 */
async function auditDenied(operation: string, subject: { type: string; id: string }, reason: string) {
  try {
    const s = await getSession();
    getPlatform().recordDenied(s.kind === "anonymous" ? null : s.actor, operation, subject, reason);
  } catch {
    /* the denial stands whether or not the audit write succeeded */
  }
}

function wrap<T extends unknown[]>(name: string, fn: (...a: T) => Promise<void> | void, path: (...a: T) => string, subject?: (...a: T) => { type: string; id: string }) {
  // A malformed POST can decode the bound route argument as the FormData itself; never let
  // "[object FormData]" leak into a redirect URL or an audit subject.
  const safePath = (...a: T) => {
    const p = path(...a);
    if (typeof p !== "string" || !p.startsWith("/")) return "/";
    try {
      if (decodeURIComponent(p).includes("[object")) return "/";
    } catch {
      return "/";
    }
    return p;
  };
  return async (...a: T) => {
    try {
      // Mismatched origins are refused by the framework before this runs; a
      // missing one is refused here, and the refusal is audited.
      await requireOrigin();
      await fn(...a);
    } catch (e) {
      if (isRedirect(e)) throw e;
      if (e instanceof PermissionDenied && !(e as { audited?: boolean }).audited) {
        const s = subject ? subject(...a) : { type: "request", id: safePath(...a) };
        await auditDenied(name, { type: s.type, id: typeof s.id === "string" ? s.id : "unknown" }, e.message);
      }
      back(safePath(...a), describe(e));
      return;
    }
    back(safePath(...a));
  };
}

/** A form field that echoes a route id is refused outright when it disagrees with the bound argument. */
function rejectStrayId(fd: FormData, name: string, bound: string) {
  if (!(fd instanceof FormData) || typeof bound !== "string") {
    throw new InvalidRequest("Malformed submission. Reload the page and try again.");
  }
  const v = fd.get(name);
  if (typeof v === "string" && v.trim() && v.trim() !== bound) {
    throw new InvalidRequest(`The submitted ${name} does not match this address. Reload the page and try again.`);
  }
}

/** A case-scoped action. The first argument is bound by the page; the form supplies the rest. */
function onCase(name: string, fn: (caseId: string, fd: FormData) => Promise<void> | void) {
  return wrap(name, async (caseId: string, fd: FormData) => {
    rejectStrayId(fd, "caseId", caseId);
    await fn(caseId, fd);
  }, (caseId) => `/cases/${encodeURIComponent(caseId)}`, (caseId) => ({ type: "case", id: caseId }));
}

function text(fd: FormData, name: string, max = 2000): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.slice(0, max).trim() : "";
}

// ------------------------------------------------------------- persona (demo)
export const switchPersona = wrap(
  "switchPersona",
  async (formData: FormData) => {
    if (!(formData instanceof FormData)) throw new InvalidRequest("Malformed submission. Reload the page and try again.");
    const seat = text(formData, "seat", 100);
    const jar = await cookies();
    if (!seat) jar.delete(SEAT_COOKIE);
    else jar.set(SEAT_COOKIE, seat, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    const next = text(formData, "next", 300);
    revalidatePath("/", "layout");
    redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
  },
  () => "/",
);

export const declareObjective = wrap(
  "declareObjective",
  async (formData: FormData) => {
    if (!(formData instanceof FormData)) throw new InvalidRequest("Malformed submission. Reload the page and try again.");
    // Redact before truncating: a cut can split an address mid-string and store a
    // fragment the counter then under-reports. Identify on the full text, store 200 chars.
    const { text: redacted, redactions } = redactIdentifiers(text(formData, "have", 2000));
    const have = redacted.slice(0, 200);
    const want = text(formData, "want", 40) || "learn";
    const jar = await cookies();
    jar.set(OBJECTIVE_COOKIE, JSON.stringify({ have, want, redactions, declaredAt: new Date().toISOString() }), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    revalidatePath("/", "layout");
    const session = await getSession();
    const absNext = session.kind === "anonymous" ? "/persona?next=/cases" : "/cases";
    redirect(want === "learn" ? "/learn" : want === "get_abs_compliant" ? absNext : "/explore");
  },
  () => "/declare",
);

export const resetDemo = wrap(
  "resetDemo",
  async () => {
    await requireAdmin();
    resetPlatform();
    revalidatePath("/", "layout");
    redirect("/?reset=1");
  },
  () => "/",
);

// -------------------------------------------------------------- discovery
export const signalInterest = wrap(
  "signalInterest",
  async (listingId: string, fd: FormData) => {
    rejectStrayId(fd, "listingId", listingId);
    const actor = await requireSeat();
    const r = getPlatform().signalInterest(actor, listingId);
    if (r.mutual && r.caseId) redirect(`/cases/${r.caseId}`);
  },
  (listingId) => `/listings/${encodeURIComponent(listingId)}`,
  (listingId) => ({ type: "listing", id: listingId }),
);

export const reciprocate = wrap(
  "reciprocate",
  async (listingId: string, fd: FormData) => {
    rejectStrayId(fd, "listingId", listingId);
    const actor = await requireSeat();
    const r = getPlatform().reciprocate(actor, listingId, text(fd, "organisationId", 100));
    redirect(`/cases/${r.caseId}`);
  },
  (listingId) => `/listings/${encodeURIComponent(listingId)}`,
  (listingId) => ({ type: "listing", id: listingId }),
);

// -------------------------------------------------------------- verification
export const requestVerification = wrap(
  "requestVerification",
  async (organisationId: string, fd: FormData) => {
    if (typeof organisationId !== "string" || !(fd instanceof FormData)) throw new InvalidRequest("Malformed submission. Reload the page and try again.");
    const actor = await requireSeat();
    getPlatform().requestVerification(actor, organisationId, text(fd, "method", 40) as "institutional_email" | "manual_vetting" | "vouching" | "orcid");
  },
  (organisationId) => `/organisations/${encodeURIComponent(organisationId)}`,
  (organisationId) => ({ type: "organisation", id: organisationId }),
);

export const decideVerification = wrap(
  "decideVerification",
  async (fd: FormData) => {
    if (!(fd instanceof FormData)) throw new InvalidRequest("Malformed submission. Reload the page and try again.");
    const admin = await requireAdmin();
    getPlatform().decideVerification(admin, text(fd, "organisationId", 100), text(fd, "outcome", 20) as "verified" | "declined", text(fd, "reason") || "No reason given");
  },
  () => `/admin`,
  (fd) => ({ type: "organisation", id: text(fd, "organisationId", 100) || "unknown" }),
);

/**
 * Path B self-registration: a stranger with no ORCID or institutional email creates the
 * person, the organisation and the founding seat, and the request lands in the same
 * administrator queue as the seeded ones. No session required; that is the point.
 * The visitor is signed straight into the founding seat so the journey continues unbroken.
 */
export const registerOrganisation = wrap(
  "registerOrganisation",
  async (fd: FormData) => {
    const personName = text(fd, "personName", 100);
    const orgName = text(fd, "orgName", 150);
    if (!personName || !orgName) throw new InvalidRequest("Give your name and the organisation's name.");
    const kind = (["community_custodian", "research_institution", "company", "broker", "adviser"] as const).find((k) => k === text(fd, "kind", 40)) ?? "community_custodian";
    const method = (["vouching", "manual_vetting"] as const).find((m) => m === text(fd, "method", 30)) ?? "vouching";
    const allowed: MarketFunction[] = ["seeking", "providing", "advising", "brokering", "custodian", "learning"];
    const functions = fd.getAll("function").map(String).filter((f): f is MarketFunction => allowed.includes(f as MarketFunction));
    const country = text(fd, "country", 3).toUpperCase();
    if (!country) throw new InvalidRequest("Give the organisation's country.");
    const r = getPlatform().registerOrganisation({ personName, orgName, kind, country, method, functions: functions.length ? functions : ["providing"] });
    const jar = await cookies();
    jar.set(SEAT_COOKIE, r.seatId, { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production" });
    redirect(`/organisations/${r.organisationId}`);
  },
  () => "/persona",
);

// ------------------------------------------------------------------ cases
/**
 * The shared facts are fixed field names. Everything else is read from the country file's
 * declared questions: a typed fact lands on its key, any other fact lands in `flags`. The
 * action therefore needs no knowledge of which country asks what.
 */
function parseFacts(fd: FormData, cfg: CountryConfig): CaseFacts {
  const opt = (name: string) => text(fd, name, 40) || undefined;
  const typed: Record<string, unknown> = {};
  const flags: Record<string, string> = {};
  for (const q of cfg.scope.questions) {
    const raw = opt(q.fact);
    if (raw === undefined) continue;
    if ((TYPED_FACTS as readonly string[]).includes(q.fact)) typed[q.fact] = q.kind === "number" ? Number(raw) : raw;
    else flags[q.fact] = raw;
  }
  return CaseFacts.parse({
    purpose: opt("purpose"),
    provenance: opt("provenance"),
    applicantType: opt("applicantType"),
    exchange: opt("exchange"),
    communityHeld: opt("communityHeld"),
    tkInvolved: opt("tkInvolved"),
    ...typed,
    flags,
  });
}

function countryOfCase(caseId: string): CountryConfig {
  const p = getPlatform();
  const c = p.store.cases.get(caseId);
  if (!c) throw new NotFound(`Case ${caseId} was not found. The demo may have been reset since this page was rendered. Reload the page.`);
  return p.country(c.providerCountry);
}

export const updateFacts = onCase("updateFacts", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().updateFacts(actor, caseId, parseFacts(fd, countryOfCase(caseId)));
});

export const changeOfIntent = onCase("changeOfIntent", async (caseId, fd) => {
  const actor = await requireSeat();
  const description = text(fd, "description", 300);
  if (!description) throw new InvalidRequest("Say what changed. The description is the change-of-intent record.");
  getPlatform().changeOfIntent(actor, caseId, parseFacts(fd, countryOfCase(caseId)), description);
});

export const uploadDocument = onCase("uploadDocument", async (caseId, fd) => {
  const actor = await requireSeat();
  const content = typeof fd.get("content") === "string" ? (fd.get("content") as string) : "";
  getPlatform().uploadDocument(actor, caseId, text(fd, "requirementId", 100), text(fd, "label", 200), text(fd, "fileName", 200) || "document.txt", content);
});

export const markStage = onCase("markStage", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().markStage(actor, caseId, text(fd, "stageId", 100), text(fd, "progress", 20) as "not_started" | "in_progress" | "complete");
});

export const fireEvent = onCase("fireEvent", async (caseId, fd) => {
  const s = await getSession();
  if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
  getPlatform().fireEvent(s.actor, caseId, text(fd, "event", 60), text(fd, "note", 500) || undefined);
});

export const tickClocks = onCase("tickClocks", async (caseId, fd) => {
  await requireAdmin();
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

export const recordInstrument = onCase("recordInstrument", async (caseId, fd) => {
  const actor = await requireSeat();
  const content = typeof fd.get("content") === "string" ? (fd.get("content") as string) : "";
  getPlatform().recordExternalInstrument(actor, caseId, text(fd, "outputId", 100), text(fd, "fileName", 200) || "instrument.pdf", content);
});

export const amendInstrument = onCase("amendInstrument", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().amendInstrument(actor, caseId, text(fd, "instrumentId", 150), text(fd, "summary", 500));
});

export const setInstrumentStatus = onCase("setInstrumentStatus", async (caseId, fd) => {
  const actor = await requireAdmin();
  getPlatform().setInstrumentStatus(actor, caseId, text(fd, "instrumentId", 150), text(fd, "status", 30) as "verified" | "correction_required" | "cancelled" | "issued", text(fd, "note", 300));
});

export const createAgreement = onCase("createAgreement", async (caseId, fd) => {
  const actor = await requireSeat();
  const title = text(fd, "title", 200) || "Draft agreement";
  const selected = fd.getAll("clause").map(String);
  const clauses = MODEL_CLAUSES.filter((c) => selected.includes(c.id));
  getPlatform().createAgreement(actor, caseId, title, clauses);
});

export const reviseAgreement = onCase("reviseAgreement", async (caseId, fd) => {
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

export const approveAgreement = onCase("approveAgreement", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().approveAgreement(actor, caseId, text(fd, "agreementId", 150));
});

export const executeAgreement = onCase("executeAgreement", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().executeAgreement(actor, caseId, text(fd, "agreementId", 150));
});

export const requestSupport = onCase("requestSupport", async (caseId, fd) => {
  const actor = await requireSeat();
  getPlatform().requestSupport(actor, caseId, text(fd, "kind", 20) as "technical" | "expert", text(fd, "note", 1000));
});

/** R5. The reviewer seat is the administrator in the prototype. Bound to the case so the redirect can never point elsewhere. */
export const decideManualReview = onCase("decideManualReview", async (caseId, fd) => {
  const actor = await requireActor();
  const recordId = text(fd, "recordId", 150);
  const rec = getPlatform().store.manualReviews.get(recordId);
  if (rec && rec.caseId !== caseId) throw new PermissionDenied("Manual review does not belong to this case");
  getPlatform().decideManualReview(actor, recordId, text(fd, "outcome", 500), text(fd, "reason", 1000));
});

/** The same judgment recorded from the administrator console. */
export const decideManualReviewFromConsole = wrap(
  "decideManualReviewFromConsole",
  async (fd: FormData) => {
    const actor = await requireActor();
    getPlatform().decideManualReview(actor, text(fd, "recordId", 150), text(fd, "outcome", 500), text(fd, "reason", 1000));
  },
  () => `/admin`,
  (fd) => ({ type: "manual_review", id: text(fd, "recordId", 150) || "unknown" }),
);

export const adminIntervene = onCase("adminIntervene", async (caseId, fd) => {
  const admin = await requireAdmin();
  getPlatform().adminIntervene(admin, caseId, text(fd, "action", 500), text(fd, "reason", 1000));
});
