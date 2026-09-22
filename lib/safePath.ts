/**
 * A redirect target taken from a request is honoured only if it stays on this site. "Starts with a
 * slash" is not enough: browsers read "/\evil.example" and "/\t/evil.example" as protocol-relative
 * URLs, which makes the sign-in link an open redirect a phisher can hand out. The target is resolved
 * against a placeholder origin and must still be on that origin, with no backslash or control
 * character anywhere in it.
 */
const FORBIDDEN = /[\\\x00-\x1f\x7f]/;

export function safeLocalPath(candidate: unknown, fallback = "/"): string {
  if (typeof candidate !== "string" || candidate.length === 0 || candidate.length > 500) return fallback;
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return fallback;
  if (FORBIDDEN.test(candidate)) return fallback;
  try {
    const u = new URL(candidate, "http://local.invalid");
    if (u.origin !== "http://local.invalid") return fallback;
    // Dot segments collapse during parsing ("/..//evil.example" becomes "//evil.example"), so the
    // normalised path is checked again before it is used.
    const path = `${u.pathname}${u.search}${u.hash}`;
    return path.startsWith("//") ? fallback : path;
  } catch {
    return fallback;
  }
}
