/**
 * Identifying content in free text. Structured identity fields are hidden by code in public
 * projections. Free text has no structure, so it is checked here before it is stored or shown.
 *
 * This is a deterministic scrubber for contact details and persistent identifiers, not a
 * judgment about whether a sentence identifies someone. It removes what a regular expression
 * can find with confidence and says how many things it removed, so the author can see that
 * the platform intervened and why. An assistive model proposing further redactions is one of
 * the three AI uses the proposal describes, behind a flag, off in the prototype.
 */

const PATTERNS: { name: string; re: RegExp }[] = [
  { name: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi },
  // Web addresses, including bare domains with a path (wa.me/..., t.me/..., linkedin.com/in/...).
  { name: "url", re: /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"']+/gi },
  { name: "orcid", re: /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g },
  // Phone numbers: an optional international prefix (+CC or 00CC) that is part of the match, so no
  // country code is left behind, then digit groups with the usual separators, allowing a bracketed
  // area code. Filtered below on digit count and on calendar dates and year ranges.
  { name: "phone", re: /(?:(?:\+|\b00)\d{1,3}[\s.-]?)?\(?\b\d{1,5}\)?(?:[\s.-]?\(?\d{1,5}\)?){1,5}\b/g },
  // Social handles.
  { name: "handle", re: /(?:^|\s)@[A-Za-z0-9_]{3,}\b/g },
];

const MIN_PHONE_DIGITS = 7;
/** A calendar date, a year range or a grouped amount is not a phone number. */
const NOT_A_PHONE = /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}\s*[-–]\s*\d{4}|\d{1,3}(?:[ ,]\d{3})+)$/;

export function redactIdentifiers(input: string): { text: string; redactions: number; kinds: string[] } {
  let text = input;
  let redactions = 0;
  const kinds: string[] = [];
  for (const { name, re } of PATTERNS) {
    text = text.replace(re, (m) => {
      if (name === "phone" && (m.replace(/\D/g, "").length < MIN_PHONE_DIGITS || NOT_A_PHONE.test(m.trim()))) return m;
      redactions++;
      if (!kinds.includes(name)) kinds.push(name);
      return name === "handle" ? " [handle removed]" : `[${name} removed]`;
    });
  }
  return { text: text.replace(/\s{2,}/g, " ").trim(), redactions, kinds };
}
