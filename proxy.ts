import { NextResponse, type NextRequest } from "next/server";
import { knownActionIds } from "@/lib/actionIds";

/**
 * Request guard in front of every route. The pages only mutate state through server
 * actions, which arrive as POST requests to the page they were rendered on. A POST that
 * cannot be a server action (wrong content type, no action identifier, an identifier of
 * the wrong shape or not emitted by this build, a reference whose companion fields are
 * missing or malformed, a bound argument rewritten to name a resource the address
 * does not, or a body over the limit) is answered here with a 4xx and one
 * sentence, instead of reaching the action runtime and surfacing as a 500.
 *
 * Authorisation is not done here. It lives in the core, per action.
 */

/** Slightly above the core's document paste limit so the core produces the sentence when it can. */
const MAX_BODY_BYTES = 1024 * 1024;
const ACTION_ID = /^\$ACTION_ID_([0-9a-f]{40,64})$/;
const ACTION_REF = /^\$ACTION_REF_(\d+)$/;
const ACTION_META = /^[0-9a-f]{40,64}$/;

function refuse(status: number, message: string) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

/** Is this action id one this build can resolve? Falls back to shape-only when manifests are unreadable. */
function idIsKnown(id: string, known: Set<string>): boolean {
  return known.size === 0 || known.has(id);
}

/** A $ACTION_REF_n submission carries its descriptor in $ACTION_n:0 and any bound args in $ACTION_n:1. */
function refIsComplete(n: string, form: FormData, known: Set<string>): boolean {
  const meta = form.get(`$ACTION_${n}:0`);
  if (typeof meta !== "string" || !meta) return false;
  let parsed: { id?: unknown; bound?: unknown };
  try {
    parsed = JSON.parse(meta);
  } catch {
    return false;
  }
  if (typeof parsed.id !== "string" || !ACTION_META.test(parsed.id) || !idIsKnown(parsed.id, known)) return false;
  // bound args travel in $ACTION_n:1 when the descriptor marks them with a "$@" reference
  if (typeof parsed.bound === "string" && parsed.bound.startsWith("$@")) {
    const args = form.get(`$ACTION_${n}:1`);
    if (typeof args !== "string" || !args) return false;
    try {
      if (!Array.isArray(JSON.parse(args))) return false;
    } catch {
      return false;
    }
  }
  return true;
}

/** Every string anywhere inside a parsed bound-argument payload. */
function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
}

/**
 * A bound argument naming a resource must match the address it is posted to.
 * `["case_2_co"]` sent to `/cases/case_1_ke` retargets silently; the same
 * payload sent to `/admin` runs a case action on a route that never rendered
 * it. Either way the address is authoritative: a bound `case_*` or `lst_*`
 * id must be the one in the path.
 */
function boundArgsMatchAddress(n: string, form: FormData, pathname: string): boolean {
  const raw = form.get(`$ACTION_${n}:1`);
  if (typeof raw !== "string" || !raw) return true;
  let args: unknown;
  try {
    args = JSON.parse(raw);
  } catch {
    return false;
  }
  const strings: string[] = [];
  collectStrings(args, strings);
  for (const s of strings) {
    if (s.startsWith("case_") && !(pathname === `/cases/${s}` || pathname.startsWith(`/cases/${s}/`))) return false;
    if (s.startsWith("lst_") && !(pathname === `/listings/${s}` || pathname.startsWith(`/listings/${s}/`))) return false;
  }
  return true;
}

export async function proxy(request: NextRequest) {
  // Only reads and action posts exist here. Anything else is a 405, not a rendered page.
  if (request.method !== "POST") {
    if (request.method === "GET" || request.method === "HEAD") return NextResponse.next();
    return refuse(405, "This address does not accept that method. Nothing was changed.");
  }

  // Same-origin check. A browser form post sends Origin; a cross-site, null or
  // malformed one is refused here rather than reaching the action runtime.
  const origin = request.headers.get("origin");
  if (origin) {
    let originHost: string | null = null;
    try {
      originHost = new URL(origin).host;
    } catch {
      originHost = null;
    }
    const expected = request.headers.get("x-forwarded-host") ?? request.nextUrl.host;
    if (!originHost || originHost !== expected) {
      return refuse(403, "The submission did not come from this site. Nothing was changed.");
    }
  }

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return refuse(413, `Request body too large. The prototype accepts up to ${MAX_BODY_BYTES / 1024} KB per submission; the MVP streams files to object storage.`);

  const known = knownActionIds();
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  // A JavaScript-initiated server action call carries the action id in a header.
  const headerId = request.headers.get("next-action");
  if (headerId) {
    if (!ACTION_META.test(headerId) || !idIsKnown(headerId, known)) return refuse(400, "Malformed or unknown action identifier. Reload the page and try again. Nothing was changed.");
    return NextResponse.next();
  }
  // A progressively enhanced form post carries the id as a field.
  if (!type.startsWith("multipart/form-data") && !type.startsWith("application/x-www-form-urlencoded")) {
    return refuse(415, "This address accepts form submissions only. Nothing was changed.");
  }
  let form: FormData;
  try {
    form = await request.clone().formData();
  } catch {
    return refuse(400, "The form body could not be read. Nothing was changed.");
  }
  const pathname = request.nextUrl.pathname;
  let sawAction = false;
  for (const key of form.keys()) {
    const idMatch = key.match(ACTION_ID);
    if (idMatch) {
      sawAction = true;
      if (!idIsKnown(idMatch[1], known)) return refuse(400, "The submission names an action this build does not have. Reload the page and try again. Nothing was changed.");
      continue;
    }
    const refMatch = key.match(ACTION_REF);
    if (refMatch) {
      sawAction = true;
      if (!refIsComplete(refMatch[1], form, known)) return refuse(400, "The submission's action fields are incomplete or malformed. Reload the page and try again. Nothing was changed.");
      if (!boundArgsMatchAddress(refMatch[1], form, pathname)) {
        return refuse(400, "The bound arguments do not match this address. Nothing was changed.");
      }
    }
  }
  if (!sawAction) return refuse(400, "The submission names no action, or names one of the wrong shape. Reload the page and try again. Nothing was changed.");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
