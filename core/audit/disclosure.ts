import type { RegValue } from "../config/schema";

/**
 * Per-user disclosure log: "what the system told each user, and when, is recorded"
 * (Appendix A, human review boundary). Every requirement statement the platform
 * shows to a person is written here with its evidence class. Compliance output is
 * information, never advice or approval. This log is the proof of what information
 * was given.
 */
export type Disclosure = {
  id: string;
  personId: string;
  seatId: string | null;
  caseId: string | null;
  countryCode: string | null;
  at: string;
  statement: string;
  reg: RegValue;
  context: string;
};

export function makeDisclosure(input: Omit<Disclosure, "id" | "at">, at: Date, seq: number): Disclosure {
  return { ...input, id: `disc_${seq}`, at: at.toISOString() };
}

/** Standard footer the interface attaches to every compliance statement. */
export const INFORMATION_NOT_ADVICE =
  "This is information about requirements that appear to apply on the facts entered. It is not legal advice and not an approval. The decision rests with the parties and their advisers.";
