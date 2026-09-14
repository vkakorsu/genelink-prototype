/**
 * Signing adapter: the prototype implements the platform-click level only.
 * This file documents where a qualified trust service provider plugs in for
 * parties that need the equivalent of a handwritten signature under eIDAS
 * Article 25(2).
 *
 * The contract this adapter must keep:
 *   - A signature is always a recorded act by an authorised-signatory seat on
 *     a specific agreement version; the provider changes the legal weight of
 *     the act, never who may perform it or what it signs.
 *   - The unsigned artefact and the signed artefact are both hashed; the
 *     provider's evidence (certificate, timestamp, validation data) is stored
 *     against the version, not embedded in application state.
 *   - Per-signature provider fees are a pass-through cost, priced as an
 *     optional item in the financial proposal.
 *
 * Today `Platform.executeAgreement` records the click-level signature: seat,
 * version number, timestamp, hash of the executed text. That is the level the
 * prototype demonstrates and the level most GENE-LINK agreements need.
 */
export interface SigningProvider {
  /** Hand the rendered artefact to a qualified trust service and return the evidence package. */
  sign(seatId: string, artefactSha256: string): Promise<{ evidenceSha256: string; providerRef: string }>;
}

export function getSigningProvider(): SigningProvider {
  throw new NotConfiguredError();
}

export class NotConfiguredError extends Error {
  constructor() {
    super("Qualified electronic signatures are an optional adapter priced separately. The prototype records click-level execution only.");
  }
}
