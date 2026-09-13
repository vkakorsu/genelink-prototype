import { createHash } from "node:crypto";
import type { CountryConfig, OutputInstrument } from "../config/schema";
import type { Instrument, InstrumentVersion } from "./types";

export function sha256(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Create the instrument(s) a country's granted state produces. The shape comes
 * from configuration: Brazil one declaratory receipt with verification open,
 * Kenya two instruments from two issuers, Colombia one access contract.
 */
export function issueInstruments(
  cfg: CountryConfig,
  caseId: string,
  outputIds: string[],
  at: Date,
  seatId: string,
  origin: Instrument["origin"] = "recorded_external",
): Instrument[] {
  return outputIds.map((outputId) => {
    const out = cfg.outputs.find((o) => o.id === outputId);
    if (!out) throw new Error(`Unknown output ${outputId} for ${cfg.code}`);
    return instrumentFrom(out, caseId, at, seatId, origin);
  });
}

export function instrumentFrom(out: OutputInstrument, caseId: string, at: Date, seatId: string, origin: Instrument["origin"]): Instrument {
  const summary = `${out.label} issued by ${out.issuer}`;
  return {
    id: `inst_${caseId}_${out.id}`,
    caseId,
    outputId: out.id,
    label: out.label,
    kind: out.kind,
    issuer: out.issuer,
    status: out.verificationOpenAfterIssue ? "verification_open" : "issued",
    amendmentPolicy: out.amendmentPolicy,
    versions: [
      {
        version: 1,
        kind: "original",
        at: at.toISOString(),
        summary,
        sha256: sha256(`${caseId}:${out.id}:1:${summary}`),
        recordedBySeatId: seatId,
      },
    ],
    issuedAt: at.toISOString(),
    origin,
  };
}

/**
 * Apply a modification according to the instrument's amendment policy (R7).
 *  addendum          -> append a version to the SAME instrument. Never a second object.
 *  variation         -> append a variation version to the same instrument.
 *  new_application   -> the instrument is left intact and the caller must open a new application.
 *  new_registration  -> same, a new cadastro is required.
 *  amendment_path    -> append an amendment version (South Africa reg. 35 first-class path).
 */
export type AmendmentOutcome =
  | { kind: "versioned"; instrument: Instrument; version: InstrumentVersion }
  | { kind: "new_instrument_required"; instrument: Instrument; policy: string; reason: string };

export function amendInstrument(instrument: Instrument, summary: string, at: Date, seatId: string): AmendmentOutcome {
  switch (instrument.amendmentPolicy) {
    case "addendum":
    case "variation":
    case "amendment_path": {
      const version: InstrumentVersion = {
        version: instrument.versions.length + 1,
        kind: instrument.amendmentPolicy === "addendum" ? "addendum" : "variation",
        at: at.toISOString(),
        summary,
        sha256: sha256(`${instrument.id}:${instrument.versions.length + 1}:${summary}`),
        recordedBySeatId: seatId,
      };
      return { kind: "versioned", instrument: { ...instrument, versions: [...instrument.versions, version] }, version };
    }
    case "new_application":
      return { kind: "new_instrument_required", instrument, policy: "new_application", reason: "This regime requires notification and a new application. The existing instrument is preserved unchanged." };
    case "new_registration":
      return { kind: "new_instrument_required", instrument, policy: "new_registration", reason: "This regime requires a new registration. The existing registration is preserved unchanged." };
    default:
      throw new Error(`Unknown amendment policy ${instrument.amendmentPolicy}`);
  }
}

/** Whether a renewal probe may ever be scheduled for this country. Reads configuration, never infers. */
export function renewalProbeAllowed(cfg: CountryConfig): { allowed: boolean; reason: string } {
  switch (cfg.renewalProbe) {
    case "never":
      return { allowed: false, reason: `${cfg.name}: no term exists. A renewal probe must never be scheduled.` };
    case "schedule":
      return { allowed: true, reason: `${cfg.name}: a term exists. Whether renewals are capped is carried as its own value and surfaced.` };
    case "unknown":
      return { allowed: false, reason: `${cfg.name}: whether a term exists is unresolved. No probe is scheduled and the question is surfaced.` };
  }
}
