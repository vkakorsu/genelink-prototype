import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * A refusal travels back to the page in the query string, so that the interface needs no client
 * bundle. Unsigned, that is a content-spoofing hole: anyone could craft a link that makes a trusted
 * page say "your verification has expired, email your password to ..." in the platform's own voice.
 * The server therefore signs every message it issues, and a page shows only messages whose
 * signature checks out. The key is NOTICE_SECRET when set, otherwise random per process, which
 * only means an old error link stops showing its message after a restart.
 */
const KEY = process.env.NOTICE_SECRET ? Buffer.from(process.env.NOTICE_SECRET) : randomBytes(32);

export function signNotice(message: string): string {
  return createHmac("sha256", KEY).update(message).digest("base64url").slice(0, 32);
}

export function verifiedNotice(message: unknown, sig: unknown): string | null {
  const m = Array.isArray(message) ? message[0] : message;
  const s = Array.isArray(sig) ? sig[0] : sig;
  if (typeof m !== "string" || typeof s !== "string" || !m || m.length > 1000) return null;
  const expected = Buffer.from(signNotice(m));
  const given = Buffer.from(s);
  return expected.length === given.length && timingSafeEqual(expected, given) ? m : null;
}
