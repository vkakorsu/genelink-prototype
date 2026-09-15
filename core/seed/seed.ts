import type { CountryConfig } from "../config/schema";
import type { LearningResource, Listing, Membership, Organisation, Person } from "../domain/types";
import { Platform } from "../platform";
import type { Store } from "../store/Store";

/**
 * Fictional parties and cases. Nothing here is a real organisation or person.
 * The seed drives the platform through its own operations so that the audit
 * chain and the disclosure log are real records of real calls, not fixtures.
 */

export const ADMIN = { admin: { personId: "person_admin", name: "GENE-LINK administrator (demo)" } } as const;

const persons: Person[] = [
  { id: "p_ines", name: "Dr Ines Halvorsen", email: "i.halvorsen@nordlicht-biotics.example", orcid: "0000-0002-0000-0001", country: "DE", onboardingPath: "A", badges: [{ id: "b1", title: "ABS due diligence essentials", earnedOn: "2026-06-02", issuer: "GENE-LINK Learning (pending content)" }] },
  { id: "p_tobias", name: "Tobias Renner", email: "t.renner@nordlicht-biotics.example", country: "DE", onboardingPath: "A", badges: [] },
  { id: "p_wanjiru", name: "Dr Wanjiru Kamau", email: "w.kamau@lbnpi.example", orcid: "0000-0002-0000-0002", country: "KE", onboardingPath: "A", badges: [] },
  { id: "p_otieno", name: "Prof. David Otieno", email: "d.otieno@lbnpi.example", country: "KE", onboardingPath: "A", badges: [] },
  { id: "p_camila", name: "Dra Camila Restrepo", email: "c.restrepo@ibp.example", orcid: "0000-0002-0000-0003", country: "CO", onboardingPath: "A", badges: [] },
  { id: "p_nyokabi", name: "Mama Nyokabi Waweru", email: "olkalou.seedbank@example", country: "KE", onboardingPath: "B", badges: [] },
  { id: "p_amara", name: "Amara Okoro", email: "a.okoro@meridianbridge.example", country: "NL", onboardingPath: "A", badges: [{ id: "b2", title: "Broker onboarding", earnedOn: "2026-05-14", issuer: "GENE-LINK Learning (pending content)" }] },
  { id: "p_kwame", name: "Kwame Ashe", email: "k.ashe@ashe-okoro.example", country: "GH", onboardingPath: "A", badges: [] },
  { id: "p_luana", name: "Dra Luana Ferreira", email: "l.ferreira@iam.example", orcid: "0000-0002-0000-0004", country: "BR", onboardingPath: "A", badges: [] },
  { id: "p_sofia", name: "Sofia Marques", email: "sofia.m@student.example", country: "PT", onboardingPath: "A", badges: [{ id: "b3", title: "Introduction to the Nagoya Protocol", earnedOn: "2026-08-20", issuer: "GENE-LINK Learning (pending content)" }] },
  { id: "person_admin", name: "GENE-LINK administrator (demo)", email: "admin@genelink.example", country: "KE", onboardingPath: "A", badges: [] },
];

const organisations: Organisation[] = [
  { id: "org_nordlicht", name: "Nordlicht Biotics GmbH", kind: "company", country: "DE", functions: ["seeking"], verification: { status: "verified", method: "institutional_email", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-07-02T09:00:00Z", reason: "Institutional email domain confirmed, commercial register extract on file" }, credentials: [{ title: "Commercial register HRB (fictional)", issuer: "Amtsgericht Hamburg (fictional)", reg: "verified" }], description: "Hamburg-based cosmetic ingredients developer seeking anti-inflammatory and emulsifier functions from plant metabolites." },
  { id: "org_lbnpi", name: "Lake Basin Natural Products Institute", kind: "research_institution", country: "KE", functions: ["providing", "advising"], verification: { status: "verified", method: "institutional_email", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-07-05T09:00:00Z", reason: "Institutional email domain and NACOSTI institutional registration (fictional) confirmed" }, credentials: [{ title: "NACOSTI institutional affiliation (fictional)", issuer: "NACOSTI", reg: "verified" }, { title: "Ex-situ collection of 4,100 accessions", issuer: "Self-declared", reg: "self_declared" }], description: "Kisumu-based public research institute holding an ex-situ collection of Lake Victoria basin plant and microbial material." },
  { id: "org_ibp", name: "Instituto de Bioprospección del Pacífico", kind: "research_institution", country: "CO", functions: ["providing"], verification: { status: "verified", method: "institutional_email", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-07-05T09:00:00Z", reason: "Institutional email domain confirmed" }, credentials: [{ title: "Recognised research centre (fictional)", issuer: "Minciencias", reg: "verified" }], description: "Cali-based research institute working on Pacific lowland flora, acting as national support institution on access applications." },
  { id: "org_olkalou", name: "Ol Kalou Community Seed Bank", kind: "community_custodian", country: "KE", functions: ["custodian", "providing"], verification: { status: "pending", method: "vouching" }, credentials: [{ title: "Community biocultural protocol (uploaded)", issuer: "Ol Kalou community assembly", reg: "self_declared" }], description: "Community-run seed bank and custodian of traditional crop varieties and associated knowledge. Path B onboarding, vouched for by Lake Basin Natural Products Institute." },
  { id: "org_meridian", name: "Meridian Bridge Advisory BV", kind: "broker", country: "NL", functions: ["brokering", "seeking", "providing", "advising"], verification: { status: "verified", method: "institutional_email", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-07-10T09:00:00Z", reason: "KvK extract (fictional) on file" }, credentials: [], description: "Broker buying from the South, selling to the North and advising on compliance. One organisation, several market functions, not several accounts." },
  { id: "org_asheokoro", name: "Ashe and Okoro ABS Counsel", kind: "adviser", country: "GH", functions: ["advising"], verification: { status: "verified", method: "manual_vetting", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-07-12T09:00:00Z", reason: "Bar registration (fictional) confirmed" }, credentials: [{ title: "Ghana Bar (fictional)", issuer: "General Legal Council", reg: "verified" }], description: "Independent ABS and IP counsel engaged by parties. Paid by the parties, not staffed by GENE-LINK." },
  { id: "org_iam", name: "Instituto Amazônico de Metabólitos", kind: "research_institution", country: "BR", functions: ["providing"], verification: { status: "verified", method: "institutional_email", decidedBy: "GENE-LINK administrator (demo)", decidedAt: "2026-08-01T09:00:00Z", reason: "Institutional email domain confirmed" }, credentials: [], description: "Manaus-based public research institute. Fictional Brazilian co-registrant for the dry run." },
];

const memberships: Membership[] = [
  { id: "seat_ines_nordlicht", personId: "p_ines", organisationId: "org_nordlicht", permission: "authorised_signatory", since: "2026-06-01" },
  { id: "seat_tobias_nordlicht", personId: "p_tobias", organisationId: "org_nordlicht", permission: "member", since: "2026-06-03", invitedBy: "seat_ines_nordlicht" },
  { id: "seat_wanjiru_lbnpi", personId: "p_wanjiru", organisationId: "org_lbnpi", permission: "administrator", since: "2026-06-10" },
  { id: "seat_otieno_lbnpi", personId: "p_otieno", organisationId: "org_lbnpi", permission: "authorised_signatory", since: "2026-06-10", invitedBy: "seat_wanjiru_lbnpi" },
  { id: "seat_camila_ibp", personId: "p_camila", organisationId: "org_ibp", permission: "authorised_signatory", since: "2026-06-12" },
  { id: "seat_nyokabi_olkalou", personId: "p_nyokabi", organisationId: "org_olkalou", permission: "administrator", since: "2026-08-15" },
  { id: "seat_amara_meridian", personId: "p_amara", organisationId: "org_meridian", permission: "administrator", since: "2026-06-20" },
  // One person, seats in two organisations: Amara also advises for Ashe and Okoro as a viewer.
  { id: "seat_amara_asheokoro", personId: "p_amara", organisationId: "org_asheokoro", permission: "viewer", since: "2026-07-01", invitedBy: "seat_kwame_asheokoro" },
  { id: "seat_kwame_asheokoro", personId: "p_kwame", organisationId: "org_asheokoro", permission: "administrator", since: "2026-06-25" },
  { id: "seat_luana_iam", personId: "p_luana", organisationId: "org_iam", permission: "authorised_signatory", since: "2026-08-01" },
];

const listings: Listing[] = [
  { id: "lst_ke_antiinfl", glId: "GL-KE-2026-0041", organisationId: "org_lbnpi", side: "offer", functionCodes: ["F07 anti-inflammatory", "F19 antioxidant"], resourceClass: "Plant metabolite extracts (ex situ)", provenanceCountry: "KE", publicSummary: "Ex-situ collection with characterised anti-inflammatory activity in crude extracts. Provider institution verified.", indicativeScale: "Gram quantities for screening, kilogram scale on agreement", speciesDetail: "Three Lamiaceae accessions and one endophytic Streptomyces isolate (fictional)", localityDetail: "Nyando basin, Kisumu County. Ex-situ holding at LBNPI Kisumu (locality recorded by place of origin, not holder)", fullDescription: "Full characterisation data and voucher references available after mutual interest.", dsiExposure: "possible", createdAt: "2026-07-20T10:00:00Z" },
  { id: "lst_co_emulsifier", glId: "GL-CO-2026-0017", organisationId: "org_ibp", side: "offer", functionCodes: ["F12 emulsifier", "F23 film-forming"], resourceClass: "Polysaccharide-rich plant material (in situ)", provenanceCountry: "CO", publicSummary: "Natural emulsifier candidates with preliminary rheology data. Listed activity (isolation of metabolic molecules) configures access under Res. 1348/2014.", indicativeScale: "Framework contract route possible for multi-project programmes", speciesDetail: "Two Araceae species (fictional identifiers IBP-A-114, IBP-A-119)", localityDetail: "Buenaventura district, Valle del Cauca. Resguardo adjacency to be assessed for direct affectation", fullDescription: "Rheology data, voucher references and the INA designation letter available after mutual interest.", dsiExposure: "none", createdAt: "2026-07-22T10:00:00Z" },
  { id: "lst_need_preservative", glId: "GL-NEED-2026-0088", organisationId: "org_nordlicht", side: "need", functionCodes: ["F31 preservative", "F07 anti-inflammatory"], resourceClass: "Plant-derived actives, any provenance with a lawful pathway", provenanceCountry: "any", publicSummary: "EU cosmetics developer seeking natural preservative and anti-inflammatory actives for a 2028 product line. Commercial endpoint. Will cost-share screening.", indicativeScale: "Two to four partnerships", speciesDetail: "Not applicable", localityDetail: "Not applicable", fullDescription: "Target specifications and budget envelope shared after mutual interest.", dsiExposure: "none", createdAt: "2026-07-25T10:00:00Z" },
  { id: "lst_br_metabolite", glId: "GL-BR-2026-0102", organisationId: "org_iam", side: "offer", functionCodes: ["F07 anti-inflammatory"], resourceClass: "Plant metabolites (in situ and ex situ)", provenanceCountry: "BR", publicSummary: "Dry-run listing with fictional parties. Research on Brazilian genetic heritage, foreign company as registrant in association with a Brazilian institution.", indicativeScale: "Screening quantities", speciesDetail: "Fictional accessions IAM-0007, IAM-0012", localityDetail: "Manaus region, outside Art. 27 areas", fullDescription: "Dry-run fixture.", dsiExposure: "possible", createdAt: "2026-08-05T10:00:00Z" },
];

const learning: LearningResource[] = [
  { id: "lr_1", title: "Introduction to access and benefit-sharing and the Nagoya Protocol", stageIds: ["intake"], countryCodes: ["*"], status: "pending_landscape_alliance_content" },
  { id: "lr_2", title: "EU due diligence under Regulation (EU) No 511/2014: what to keep and for how long", stageIds: ["intake", "continuity"], countryCodes: ["*"], status: "pending_landscape_alliance_content" },
  { id: "lr_3", title: "Prior informed consent under community protocols", stageIds: ["consent_and_terms", "tk_statute", "prior_consultation", "traditional_knowledge"], countryCodes: ["KE", "CO", "BR"], status: "pending_landscape_alliance_content" },
  { id: "lr_4", title: "Reading a country pathway: established, our reading, open question", stageIds: ["intake"], countryCodes: ["*"], status: "pending_landscape_alliance_content" },
];

export function seed(store: Store, countries: Map<string, CountryConfig>, baseDate = new Date("2026-09-01T09:00:00Z")): Platform {
  let t = baseDate.getTime();
  const platform = new Platform(store, countries, () => new Date(t));
  const step = (minutes = 30) => (t += minutes * 60_000);

  for (const p of persons) store.persons.put(p);
  for (const o of organisations) store.organisations.put(o);
  for (const m of memberships) store.memberships.put(m);
  for (const l of listings) store.listings.put(l);
  for (const l of learning) store.learning.put(l);

  const ines = platform.actorFor("seat_ines_nordlicht");
  const tobias = platform.actorFor("seat_tobias_nordlicht");
  const wanjiru = platform.actorFor("seat_wanjiru_lbnpi");
  const otieno = platform.actorFor("seat_otieno_lbnpi");
  const camila = platform.actorFor("seat_camila_ibp");
  const luana = platform.actorFor("seat_luana_iam");
  const nyokabi = platform.actorFor("seat_nyokabi_olkalou");

  // Path B verification request for the community seed bank, vouched for by LBNPI (pending administrator decision).
  platform.requestVerification(nyokabi, "org_olkalou", "vouching");
  step();

  // ----------------------------------------------------------------- Kenya case
  platform.signalInterest(tobias, "lst_ke_antiinfl");
  step();
  const { caseId: keId } = platform.reciprocate(wanjiru, "lst_ke_antiinfl", "org_nordlicht");
  step();
  platform.updateFacts(ines, keId, {
    purpose: "commercial", activity: "ex_situ_held", provenance: "ex_situ", applicantType: "foreign_legal", exchange: "service_shipment",
    communityHeld: "yes", tkInvolved: "yes", speciesListed: "not_listed", localities: 2, flags: {},
  });
  step();
  platform.uploadDocument(otieno, keId, "pic", "Prior informed consent (community procedure record)", "olkalou-pic-record.pdf", "fictional PIC record content v1");
  platform.uploadDocument(otieno, keId, "mta_application", "Material transfer agreement (application document)", "mta-application.pdf", "fictional MTA content v1");
  step();
  platform.markStage(ines, keId, "intake", "complete");
  platform.markStage(ines, keId, "localities", "complete");
  platform.markStage(ines, keId, "eligibility", "complete");
  platform.markStage(otieno, keId, "tk_statute", "in_progress");
  step();
  const keAgreement = platform.createAgreement(otieno, keId, "Mutually agreed terms and benefit-sharing agreement (Fifth Schedule model form)", [
    { id: "c1", title: "Parties and resource", text: "Illustrative clause. Content pending Landscape Alliance model clauses.", source: "illustrative" },
    { id: "c2", title: "Benefit sharing", text: "Fifth Schedule Art. 8.4 and 8.5 terms shown as text. Whether they are negotiable is unresolved (NEMA question). The platform does not present them as editable defaults or as fixed rates.", source: "model_clause" },
    { id: "c3", title: "Attribution", text: "The user acknowledges the owner, indicates the source and origin, and respects cultural values, for as long as the knowledge is used (TK Act s.11).", source: "model_clause" },
  ]);
  step();
  platform.requestSupport(ines, keId, "expert", "We would like an adviser to review the Fifth Schedule rate question before we sign the MAT.");
  step();

  // -------------------------------------------------------------- Colombia case
  platform.signalInterest(ines, "lst_co_emulsifier");
  step();
  const { caseId: coId } = platform.reciprocate(camila, "lst_co_emulsifier", "org_nordlicht");
  step();
  platform.updateFacts(camila, coId, {
    purpose: "commercial", activity: "listed_activity", provenance: "in_situ", applicantType: "foreign_legal", exchange: "title_transfer",
    communityHeld: "no", tkInvolved: "no", directAffectation: "unclear", flags: {},
  });
  step();
  // Walk the Colombian proceeding through an unhappy path to a perfected contract, then amend it twice by addendum.
  for (const [ev, note] of [
    ["submit", "Application filed with ANLA (fictional)"],
    ["return_incomplete", "Returned: INA designation letter missing"],
    ["resubmit", "INA designation letter added"],
    ["refile", undefined],
    ["admit", undefined],
    ["publish", "Published in El Tiempo and a Buenaventura local outlet (fictional), dates recorded per publication"],
    ["begin_evaluation", undefined],
    ["request_information", "Methodology clarification requested"],
    ["resubmit", "Methodology clarified"],
    ["deny", "Denied after evaluation: the benefit-sharing methodology remained insufficient (fictional)"],
    ["appeal", "Appeal lodged within the statutory window (fictional)"],
    ["uphold_appeal", "Appeal upheld. The file returns to evaluation and is accepted. Notification within five days recorded."],
    ["begin_negotiation", "Draft contract meeting with MADS (fictional)"],
    ["publish_contract", "Contract published, perfected on publication"],
  ] as [string, string | undefined][]) {
    platform.fireEvent(ev === "resubmit" || ev === "submit" || ev === "appeal" ? camila : ADMIN, coId, ev, note);
    step(60 * 24 * 3);
  }
  // Publication perfected the contract. The State holds the document; the platform records the copy the signatory supplies.
  const coContract = platform.recordExternalInstrument(camila, coId, "access_contract", "contrato-acceso-ANLA-2026-014.pdf", "Contrato de acceso a recursos genéticos No. 014 de 2026 (fictional). Perfected on publication.");
  step(60 * 24 * 12);
  platform.amendInstrument(camila, coId, coContract.id, "Otrosí No. 1: adds accession IBP-A-121 to the resource scope");
  step(60 * 24 * 8);
  platform.changeOfIntent(camila, coId, { ...store.cases.get(coId)!.facts, exchange: "service_shipment" }, "Samples to be sent abroad for sequencing service and returned, rather than transferred with title");
  step();
  const coAgreement = platform.createAgreement(camila, coId, "Accessory contract: national support institution", [
    { id: "a1", title: "Suspensive condition", text: "This accessory contract takes effect only on the access contract taking effect (D391 Art. 42).", source: "model_clause" },
    { id: "a2", title: "Monitoring duties", text: "The national support institution carries the Art. 43 monitoring duties. Illustrative wording pending Landscape Alliance clauses.", source: "illustrative" },
  ]);
  platform.approveAgreement(camila, coId, coAgreement.id);
  platform.approveAgreement(ines, coId, coAgreement.id);
  step();
  platform.executeAgreement(camila, coId, coAgreement.id);
  platform.executeAgreement(ines, coId, coAgreement.id);
  step();

  // ---------------------------------------------- Kenya lapsed-clock case (second)
  platform.signalInterest(platform.actorFor("seat_amara_meridian"), "lst_ke_antiinfl");
  step();
  const { caseId: keLapsedId } = platform.reciprocate(wanjiru, "lst_ke_antiinfl", "org_meridian");
  platform.updateFacts(wanjiru, keLapsedId, {
    purpose: "commercial", activity: "collection_research", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement",
    communityHeld: "no", tkInvolved: "no", speciesListed: "not_listed", localities: 1, flags: {},
  });
  platform.fireEvent(wanjiru, keLapsedId, "submit", "Bundle submitted to NEMA and NACOSTI (fictional)");
  platform.fireEvent(ADMIN, keLapsedId, "acknowledge", "Acknowledged, 30 working day clock running");
  // Advance 70 days and tick: the clock lapses. The case goes to deadline_lapsed, never to granted.
  step(60 * 24 * 70);
  platform.tickClocks(keLapsedId);
  step();

  // --------------------------------------------------------- Brazil dry run case
  platform.signalInterest(tobias, "lst_br_metabolite");
  step();
  const { caseId: brId } = platform.reciprocate(luana, "lst_br_metabolite", "org_nordlicht");
  platform.updateFacts(luana, brId, {
    purpose: "commercial", activity: "research_development", provenance: "in_situ", applicantType: "foreign_legal", exchange: "service_shipment",
    communityHeld: "no", tkInvolved: "no", scientificCollaboration: "unclear", flags: {},
  });
  step();
  platform.fireEvent({ system: true }, brId, "complete_form", "SisGen form completed. Receipt issued automatically.");
  step();

  // A signal with no reciprocation: the negative control for anonymisation-until-match.
  // Ol Kalou (a pending-verification Path B custodian) answers Nordlicht's need. Until Ines
  // reciprocates, each side sees a placeholder for the other, not an identity.
  platform.signalInterest(nyokabi, "lst_need_preservative");
  step();

  // ----------------------------------------------------- Out-of-scope example
  platform.signalInterest(platform.actorFor("seat_kwame_asheokoro"), "lst_co_emulsifier");
  const { caseId: oosId } = platform.reciprocate(camila, "lst_co_emulsifier", "org_asheokoro");
  platform.changeOfIntent(camila, oosId, {
    purpose: "non_commercial", activity: "listed_activity", provenance: "in_situ", applicantType: "foreign_legal", exchange: "no_movement",
    communityHeld: "no", tkInvolved: "no", flags: {},
  }, "Purpose declared non-commercial: the enquiry leaves the access regime's scope");
  const oos = store.cases.get(oosId)!;
  oos.title = "Non-commercial enquiry (out of scope example)";
  store.cases.put(oos);

  void keAgreement;
  // Seeding used a deterministic clock. From here the platform runs on real time.
  platform.now = () => new Date();
  return platform;
}
