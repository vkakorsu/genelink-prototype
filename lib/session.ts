import { cookies } from "next/headers";
import { getPlatform } from "@/core";
import type { Actor } from "@/core/platform";
import type { VisitObjective } from "@/core/domain/types";
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
  if (!platform.store.memberships.get(v)) return { kind: "anonymous" };
  const actor = platform.actorFor(v);
  if (!("seat" in actor)) return { kind: "anonymous" };
  return { kind: "seat", actor, seatId: v };
}

export async function getObjective(): Promise<VisitObjective | null> {
  const jar = await cookies();
  const v = jar.get(OBJECTIVE_COOKIE)?.value;
  if (!v) return null;
  try {
    return JSON.parse(v) as VisitObjective;
  } catch {
    return null;
  }
}
