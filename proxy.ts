import { NextResponse, type NextRequest } from "next/server";

/**
 * Request guard in front of every route. The pages only mutate state through server
 * actions, which arrive as POST requests to the page they were rendered on. A POST that
 * cannot be a server action (wrong content type, no action identifier, an identifier of
 * the wrong shape, or a body over the limit) is answered here with a 4xx and one sentence,
 * instead of reaching the action runtime and surfacing as a 500.
 *
 * Authorisation is not done here. It lives in the core, per action.
 */

/** Slightly above the core's document paste limit so the core produces the sentence when it can. */
const MAX_BODY_BYTES = 1024 * 1024;
const ACTION_ID = /^\$ACTION_ID_[0-9a-f]{40,64}$/;
const ACTION_REF = /^\$ACTION_REF_\d+$/;

function refuse(status: number, message: string) {
  return new NextResponse(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export async function proxy(request: NextRequest) {
  if (request.method !== "POST") return NextResponse.next();

  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return refuse(413, `Request body too large. The prototype accepts up to ${MAX_BODY_BYTES / 1024} KB per submission; the MVP streams files to object storage.`);

  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  // A JavaScript-initiated server action call carries the action id in a header and a text/plain body.
  if (request.headers.get("next-action")) {
    if (!/^[0-9a-f]{40,64}$/.test(request.headers.get("next-action")!)) return refuse(400, "Malformed action identifier.");
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
  const keys = [...form.keys()];
  const hasAction = keys.some((k) => ACTION_ID.test(k) || ACTION_REF.test(k));
  if (!hasAction) return refuse(400, "The submission names no action, or names one of the wrong shape. Reload the page and try again. Nothing was changed.");
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icon.svg|favicon.ico).*)"],
};
