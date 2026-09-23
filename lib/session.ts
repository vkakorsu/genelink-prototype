import { cookies } from "next/headers";
import { getPlatform } from "@/core";
import type { Actor } from "@/core/platform";
import { VISIT_WANTS, type VisitObjective } from "@/core/domain/types";
import { ADMIN } from "@/core/seed/seed";

/**
 * Demo sign-in boundary. In the MVP this module is replaced by the identity
 * adapter (passkeys, email codes, ORCID OpenID Connect, TOTP for administrators)
 * and a server-side session. The rest of the application depends only on
 * getActor(), so nothing above this line changes.
 */
export const SEAT_COOKIE = "gl_seat";
export const OBJECTIVE_COOKIE = "gl_objective";

export type Session =
  | { kind: "anonymous" }
  | { kind: "admin"; actor: Actor }
  | { kind: "seat"; actor: Extract<Actor, { seat: unknown }>; seatId: string };

export async function getSession(): Promise<Session> {
  const jar = await cookies();
  const v = jar.get(SEAT_COOKIE)?.value;
  if (!v) return { kind: "anonymous" };
  if (v === "admin") return { kind: "admin", actor: ADMIN };
  const platform = getPlatform();
  // A revoked seat signs nobody in, even with its cookie still in the browser.
  const m = platform.store.memberships.get(v);
  if (!m || m.revoked) return { kind: "anonymous" };
  const actor = platform.actorFor(v);
  if (!("seat" in actor)) return { kind: "anonymous" };
  return { kind: "seat", actor, seatId: v };
}

export async function getObjective(): Promise<VisitObjective | null> {
  const jar = await cookies();
  const v = jar.get(OBJECTIVE_COOKIE)?.value;
  if (!v) return null;
  // The cookie is the visitor's own and may have been edited or written by an older build. Anything
  // that is not the exact shape this build writes is ignored rather than trusted into the page.
  try {
    const o = JSON.parse(v) as Record<string, unknown> | null;
    if (!o || typeof o !== "object" || Array.isArray(o)) return null;
    if (typeof o.have !== "string" || typeof o.want !== "string" || !(VISIT_WANTS as readonly string[]).includes(o.want)) return null;
    return {
      have: o.have.slice(0, 200),
      want: o.want as VisitObjective["want"],
      declaredAt: typeof o.declaredAt === "string" ? o.declaredAt : "",
      redactions: typeof o.redactions === "number" && Number.isFinite(o.redactions) ? o.redactions : undefined,
    };
  } catch {
    return null;
  }
}
