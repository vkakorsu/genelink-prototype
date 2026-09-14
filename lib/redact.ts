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
  { name: "url", re: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi },
  { name: "orcid", re: /\b\d{4}-\d{4}-\d{4}-\d{3}[\dX]\b/g },
  // Phone numbers: an optional +, then at least 7 digits with the usual separators, allowing a bracketed area code.
  { name: "phone", re: /(?:\+|\b00)?\(?\d{1,4}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{2,4}(?:[\s.-]?\d{1,4})?\b/g },
  // Social handles.
  { name: "handle", re: /(?:^|\s)@[A-Za-z0-9_]{3,}\b/g },
];

const MIN_PHONE_DIGITS = 7;

export function redactIdentifiers(input: string): { text: string; redactions: number; kinds: string[] } {
  let text = input;
  let redactions = 0;
  const kinds: string[] = [];
  for (const { name, re } of PATTERNS) {
    text = text.replace(re, (m) => {
      if (name === "phone" && m.replace(/\D/g, "").length < MIN_PHONE_DIGITS) return m;
      redactions++;
      if (!kinds.includes(name)) kinds.push(name);
      return name === "handle" ? " [handle removed]" : `[${name} removed]`;
    });
  }
  return { text: text.replace(/\s{2,}/g, " ").trim(), redactions, kinds };
}
