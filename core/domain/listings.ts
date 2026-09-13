import type { Listing, Organisation } from "./types";

/**
 * Two projections of a listing (RFP Section 6, "protect commercially or
 * scientifically sensitive information during early-stage discovery").
 * The public projection is what anyone, including anonymous visitors, may see.
 * The full projection is revealed to a counterparty only after mutual interest,
 * and the reveal is a recorded, symmetric event.
 *
 * Open decision (Appendix A): exactly what is visible before a match. The split
 * below is a working position and is data, not code, in the MVP.
 */
export type PublicListing = {
  id: string;
  glId: string;
  side: Listing["side"];
  functionCodes: string[];
  resourceClass: string;
  provenanceCountry: string;
  publicSummary: string;
  indicativeScale: string;
  organisationKind: Organisation["kind"];
  organisationVerified: boolean;
  dsiExposure: Listing["dsiExposure"];
  projection: "public";
};

export type FullListing = Listing & {
  organisationName: string;
  projection: "full";
};

export function publicProjection(l: Listing, org: Organisation): PublicListing {
  return {
    id: l.id,
    glId: l.glId,
    side: l.side,
    functionCodes: l.functionCodes,
    resourceClass: l.resourceClass,
    provenanceCountry: l.provenanceCountry,
    publicSummary: l.publicSummary,
    indicativeScale: l.indicativeScale,
    organisationKind: org.kind,
    organisationVerified: org.verification.status === "verified",
    dsiExposure: l.dsiExposure,
    projection: "public",
  };
}

export function fullProjection(l: Listing, org: Organisation): FullListing {
  return { ...l, organisationName: org.name, projection: "full" };
}

/** Structured identity fields are hidden by code. Free text is checked for identifying content before publication. */
export function findIdentifyingPhrases(text: string, org: Organisation): string[] {
  const hits: string[] = [];
  const needles = [org.name, ...org.name.split(/\s+/).filter((w) => w.length > 4)];
  for (const n of needles) {
    if (text.toLowerCase().includes(n.toLowerCase())) hits.push(n);
  }
  return Array.from(new Set(hits));
}
