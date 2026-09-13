"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getPlatform, resetPlatform } from "@/core";
import { CaseFacts } from "@/core/config/schema";
import { PermissionDenied } from "@/core/platform";
import { ADMIN } from "@/core/seed/seed";
import { OBJECTIVE_COOKIE, SEAT_COOKIE, getSession } from "@/lib/session";
import { MODEL_CLAUSES } from "@/lib/clauses";

/**
 * Server actions: the only way the interface mutates state. Each one resolves the
 * acting seat from the session and delegates to the core, which evaluates
 * permissions and writes the audit chain. Errors are surfaced as a query string
 * so the page can show them without a client bundle.
 */

function isRedirect(e: unknown): boolean {
  return typeof e === "object" && e !== null && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_REDIRECT");
}

function back(path: string, error?: string) {
  revalidatePath(path);
  redirect(error ? `${path}?error=${encodeURIComponent(error)}` : path);
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

function wrap<T extends unknown[]>(path: (...a: T) => string, fn: (...a: T) => Promise<void> | void) {
  return async (...a: T) => {
    try {
      await fn(...a);
    } catch (e) {
      if (isRedirect(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      back(path(...a), msg);
      return;
    }
    back(path(...a));
  };
}

// ------------------------------------------------------------- persona (demo)
export async function switchPersona(formData: FormData) {
  const seat = String(formData.get("seat") ?? "");
  const jar = await cookies();
  if (!seat) jar.delete(SEAT_COOKIE);
  else jar.set(SEAT_COOKIE, seat, { httpOnly: true, sameSite: "lax", path: "/" });
  const next = String(formData.get("next") ?? "/");
  revalidatePath("/", "layout");
  redirect(next);
}

export async function declareObjective(formData: FormData) {
  const have = String(formData.get("have") ?? "").slice(0, 200);
  const want = String(formData.get("want") ?? "learn");
  const jar = await cookies();
  jar.set(OBJECTIVE_COOKIE, JSON.stringify({ have, want, declaredAt: new Date().toISOString() }), { httpOnly: true, sameSite: "lax", path: "/" });
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
  (fd: FormData) => `/listings/${fd.get("listingId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const r = getPlatform().signalInterest(actor, String(fd.get("listingId")));
    if (r.mutual && r.caseId) redirect(`/cases/${r.caseId}`);
  },
);

export const reciprocate = wrap(
  (fd: FormData) => `/listings/${fd.get("listingId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const r = getPlatform().reciprocate(actor, String(fd.get("listingId")), String(fd.get("organisationId")));
    redirect(`/cases/${r.caseId}`);
  },
);

// -------------------------------------------------------------- verification
export const requestVerification = wrap(
  (fd: FormData) => `/organisations/${fd.get("organisationId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().requestVerification(actor, String(fd.get("organisationId")), String(fd.get("method")) as "institutional_email" | "manual_vetting" | "vouching" | "orcid");
  },
);

export const decideVerification = wrap(
  (_fd: FormData) => `/admin`,
  async (fd) => {
    const admin = await requireAdmin();
    getPlatform().decideVerification(admin, String(fd.get("organisationId")), String(fd.get("outcome")) as "verified" | "declined", String(fd.get("reason") ?? "").trim() || "No reason given");
  },
);

// ------------------------------------------------------------------ cases
function parseFacts(fd: FormData): CaseFacts {
  const localities = fd.get("localities");
  const raw = {
    purpose: fd.get("purpose"),
    activity: fd.get("activity"),
    provenance: fd.get("provenance"),
    applicantType: fd.get("applicantType"),
    exchange: fd.get("exchange"),
    communityHeld: fd.get("communityHeld"),
    tkInvolved: fd.get("tkInvolved"),
    directAffectation: fd.get("directAffectation") || undefined,
    speciesListed: fd.get("speciesListed") || undefined,
    scientificCollaboration: fd.get("scientificCollaboration") || undefined,
    localities: localities ? Number(localities) : undefined,
    flags: {},
  };
  return CaseFacts.parse(raw);
}

export const updateFacts = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().updateFacts(actor, String(fd.get("caseId")), parseFacts(fd));
  },
);

export const changeOfIntent = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().changeOfIntent(actor, String(fd.get("caseId")), parseFacts(fd), String(fd.get("description") ?? "Change of intent").trim());
  },
);

export const uploadDocument = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const content = String(fd.get("content") ?? "");
    if (!content.trim()) throw new Error("Paste the document text so the prototype can hash it");
    getPlatform().uploadDocument(actor, String(fd.get("caseId")), String(fd.get("requirementId")), String(fd.get("label")), String(fd.get("fileName") || "document.txt"), content);
  },
);

export const markStage = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().markStage(actor, String(fd.get("caseId")), String(fd.get("stageId")), String(fd.get("progress")) as "not_started" | "in_progress" | "complete");
  },
);

export const fireEvent = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const s = await getSession();
    if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
    getPlatform().fireEvent(s.actor, String(fd.get("caseId")), String(fd.get("event")), String(fd.get("note") ?? "").trim() || undefined);
  },
);

export const tickClocks = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const days = Number(fd.get("days") ?? 0);
    const p = getPlatform();
    const now = new Date(Date.now() + days * 86_400_000);
    p.tickClocks(String(fd.get("caseId")), now);
  },
);

export const recordInstrument = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const content = String(fd.get("content") ?? "");
    if (!content.trim()) throw new Error("Paste the instrument text so the prototype can hash it");
    getPlatform().recordExternalInstrument(actor, String(fd.get("caseId")), String(fd.get("outputId")), String(fd.get("fileName") || "instrument.pdf"), content);
  },
);

export const amendInstrument = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().amendInstrument(actor, String(fd.get("instrumentId")), String(fd.get("summary") ?? "Amendment").trim());
  },
);

export const setInstrumentStatus = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const s = await getSession();
    if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
    getPlatform().setInstrumentStatus(s.actor, String(fd.get("instrumentId")), String(fd.get("status")) as "verified" | "correction_required" | "cancelled" | "issued", String(fd.get("note") ?? "").trim());
  },
);

export const createAgreement = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const title = String(fd.get("title") ?? "Draft agreement").trim();
    const selected = fd.getAll("clause").map(String);
    const clauses = MODEL_CLAUSES.filter((c) => selected.includes(c.id));
    if (!clauses.length) throw new Error("Select at least one model clause");
    getPlatform().createAgreement(actor, String(fd.get("caseId")), title, clauses);
  },
);

export const reviseAgreement = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    const p = getPlatform();
    const a = p.store.agreements.get(String(fd.get("agreementId")))!;
    const latest = a.versions[a.versions.length - 1];
    const negotiated = String(fd.get("negotiated") ?? "").trim();
    const clauses = negotiated
      ? [...latest.clauses, { id: `n${latest.clauses.length + 1}`, title: "Negotiated clause", text: negotiated, source: "negotiated" as const }]
      : latest.clauses;
    p.reviseAgreement(actor, a.id, String(fd.get("summary") ?? "Revision").trim(), clauses, fd.get("offPlatform") ? "uploaded_off_platform" : "platform");
  },
);

export const approveAgreement = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().approveAgreement(actor, String(fd.get("agreementId")));
  },
);

export const executeAgreement = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().executeAgreement(actor, String(fd.get("agreementId")));
  },
);

export const requestSupport = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const actor = await requireSeat();
    getPlatform().requestSupport(actor, String(fd.get("caseId")), String(fd.get("kind")) as "technical" | "expert", String(fd.get("note") ?? "").trim());
  },
);

export const decideManualReview = wrap(
  (fd: FormData) => (fd.get("back") ? String(fd.get("back")) : `/admin`),
  async (fd) => {
    const s = await getSession();
    if (s.kind === "anonymous") throw new PermissionDenied("Choose a persona first");
    getPlatform().decideManualReview(s.actor, String(fd.get("recordId")), String(fd.get("outcome")).trim(), String(fd.get("reason") ?? "").trim() || "No reason given");
  },
);

export const adminIntervene = wrap(
  (fd: FormData) => `/cases/${fd.get("caseId")}`,
  async (fd) => {
    const admin = await requireAdmin();
    getPlatform().adminIntervene(admin, String(fd.get("caseId")), String(fd.get("action")), String(fd.get("reason") ?? "").trim() || "No reason given");
  },
);
