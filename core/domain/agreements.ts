import type { AgreementVersion } from "./types";

/**
 * The exact text an agreement version's hash covers. One function, used both to compute the hash
 * and to hand a party the text, so that the document a signatory downloads is byte for byte the
 * document the platform hashed and anyone holding it can verify it.
 */
export function canonicalAgreementText(version: number, clauses: AgreementVersion["clauses"]): string {
  return `v${version}\n${clauses.map((c) => `${c.id}\n${c.title}\n${c.text}`).join("\n\n")}`;
}

/**
 * Pasted text is normalised before it is hashed, wherever it enters: a browser submits a textarea's
 * line breaks as CRLF, so without this the same document would hash differently depending on the
 * operating system and the form it passed through.
 */
export function normaliseText(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}
