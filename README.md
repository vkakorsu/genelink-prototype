# GENE-LINK MVP prototype

A working implementation of the GENE-LINK partnership journey, built for the Landscape Alliance (CIFOR and ICRAF) Request for Proposals of 3 September 2026 by Vincent Kofi Akorsu, independent technical consultant, Ho, Ghana.

Live demo: [PROTOTYPE_URL] (free EU-region instance, Frankfurt, fictional parties, state resets on redeploy)

This is not a mock-up. It is the seed of the MVP codebase: the stack the proposal recommends for production, structured as the production system will be structured. On contract award it becomes the MVP.

## What it proves

The RFP's appendices make claims that are easy to write and hard to fake. This prototype exists to show them running.

| Claim | Where to look |
| --- | --- |
| **Country rules are configuration, not code (R2).** Three YAML files, one engine. Brazil was written after the engine was finished and the engine did not change. | `config/countries/*.yaml`, `npm run dry-run -- BR` |
| **Three-state fields, not booleans (R1).** Every regulatory value carries `established`, `inferred` or `unknown`, with its Appendix B evidence marker and citation. A boolean in a regulatory field is a type error and a lint error. | `core/config/schema.ts` (`RegValue`), `core/config/lint.ts` |
| **Unknown halts and escalates, never defaults (R3).** A stage that depends on an unresolved value stops, shows the question, and routes it to a named owner slot. | Kenya case, stages "Consent and terms" and "Traditional knowledge". Colombia case, "Prior consultation". |
| **Evidence class reaches the interface (R4).** Every rule shown carries §, ▸, ?, ⊘ or [GL], visibly distinguished. | Every case page, `/admin/config/KE` |
| **Manual-review states for judgments no system can make (R5).** Brazil's "genuine scientific collaboration" is a state only a human with a recorded reason can move. Never a checkbox. | Brazil case, stage "Who holds the registration" |
| **Live data layers (R6).** Modelled in the schema (`liveLayers`), populated for Kenya's species status list with a pending source. | `/admin/config/KE` |
| **One contract, versioned by addendum (R7).** The Colombian access contract is one record with an otrosí history. Kenya's change of intent requires a new application instead. | Colombia case, "What the applicant holds" |
| **A lapsed clock never grants (R8).** The second Kenya case sits in `deadline_lapsed` with a remedy against the administrator and no permit. The linter refuses any clock whose lapse target is a granted state. | Case `case_3_ke`, `core/config/lint.ts` |
| **Full state machines with unhappy paths (R9).** Returned incomplete, information requested, resubmitted, refused, appealed, withdrawn, correction required, cancelled, all declared per country and walkable. | "Regulator processing" panel on any case |
| **A compliance module distinct from intake (R10).** The nine obligation classes are recorded on the instrument for phase two. They are not run. The renewal probe reads configuration: never for Brazil. | "What attaches to the instrument" panel |
| **The sequence itself varies (A5.3).** The same pathway page renders Colombia's consultation-before-application and Kenya's documents-with-the-application from configuration alone. | Compare the Kenya and Colombia case pages |
| **Person, organisation and membership are three entities.** Market functions belong to the organisation, permissions to the seat, the visit objective to the session. Amara Okoro holds seats in two organisations. Meridian Bridge is one broker with four functions. | `/persona`, `/organisations/org_meridian`, `/declare` |
| **Confidentiality before a match.** Public and full projections. Identity, species and locality withheld until both sides signal interest. The reveal is a recorded, symmetric event. | `/explore`, any listing as an outsider then as a counterparty |
| **Compliance output is information, never advice or approval, and what the system told each user is recorded.** | The wording everywhere, and `/disclosures` |
| **Hash-chained audit and integrity verification.** Every consequential action is an entry whose hash covers the previous entry. Tampering is detected. Any party can verify a document against the record. | `/verify`, `/cases/<id>/audit`, `/admin/audit` |
| **Open decisions are open.** Every held-open item in Appendix A and every A7 question is rendered as an open state with a decision slot, not resolved by drawing. | `/open-decisions`, inline `?` markers |
| **Out of scope is a stated position.** Non-commercial users reach a page that records the basis. No "already proven" exit exists anywhere. | `/out-of-scope`, case `case_5_co` |

## What it deliberately does not do

| Left pending | Why | How it is marked |
| --- | --- | --- |
| Real authentication | Needs Landscape Alliance's identity decisions and ORCID credentials. The MVP uses passkeys, email codes, ORCID OpenID Connect, TOTP for administrators | Persona switcher at `/persona`, behind `lib/session.ts`, the only file that changes |
| Persistence | The free demo instance has an ephemeral filesystem. The MVP uses PostgreSQL with row-level security and an append-only audit table | `core/store/memory.ts` behind `core/store/Store.ts`. `core/store/postgres.ts` documents the adapter and is unimplemented |
| Named escalation owners | R3 wants a named human. Only Landscape Alliance can name them | `escalation.defaultOwnerName: null` in every country file, shown as "name pending" |
| Template and clause content | Legal partners supply it | `lib/clauses.ts`, every clause labelled illustrative |
| Learning content, support contacts, the 48-code function taxonomy | Landscape Alliance content and constructs | Marked pending on `/learn` and `/explore` |
| Live ABS Clearing-House lookup, qualified signatures, payments, additional countries | Deferred or optional in the proposal | Not present |
| Any assertion about the law beyond what Appendix B marks | Where Appendix B says ? the prototype says ? | Everywhere |

## Run it

Requires Node 22.

```bash
npm ci
npm run test:ci        # 52 tests on the core: schema, lint, scope, pathway, state machines, instruments, audit, full journeys, dry run for every country
npm run dry-run -- BR  # walk Brazil end to end in the terminal. Try CO or KE too
npm run lint:config    # validate every country file
npm run dev            # http://localhost:3000
```

Or with Docker:

```bash
docker build -t genelink-prototype .
docker run -p 3000:3000 genelink-prototype
```

## Repository structure

```
config/
  countries/colombia.yaml     built pathway, transcribed from Appendix B with evidence markers
  countries/kenya.yaml        built pathway
  countries/brazil.yaml       dry run, written after the engine
  open-decisions.yaml         Appendix A held-open items with the prototype's working position
core/                         framework independent. No import from Next, React or a database driver.
  config/schema.ts            Zod schema. RegValue, CountryConfig, stages, state machine, outputs, A5 variables, A6 classes
  config/lint.ts              invariants the schema cannot express (R1, R3, R8, R9)
  config/load.ts              YAML loader
  engine/scope.ts             in scope, out of scope with basis, escalate. No default branch
  engine/pathway.ts           stages, requirements, documents, consent parties, halts, escalations
  engine/stateMachine.ts      country-agnostic interpreter. Lapse never grants
  domain/types.ts             person, organisation, membership, listing, case, instrument, agreement
  domain/instruments.ts       issue and amend by policy (addendum, new application, new registration)
  domain/listings.ts          public and full projections
  audit/chain.ts              SHA-256 hash chain and verification
  audit/disclosure.ts         per-user "what GENE-LINK told you"
  platform.ts                 every operation, permissions evaluated here, audit written here
  store/Store.ts              repository interface
  store/memory.ts             in-memory implementation (prototype)
  store/postgres.ts           documented boundary (MVP)
  seed/seed.ts                fictional parties and cases, driven through platform operations
  __tests__/                  Vitest
scripts/
  dry-run.ts                  walk any configured country end to end
  lint-config.ts              CI configuration check
app/                          Next.js App Router. Server components and server actions. No client bundle for the journey
components/                   evidence chips, stage cards, machine panel, instruments, agreements
lib/session.ts                demo sign-in boundary
```

## The configuration format

Every regulatory statement is a `RegValue`:

```yaml
renewalsCapped:
  state: unknown              # established | inferred | unknown
  marker: "?"                 # § ▸ ? ⊘ [GL]  (the marker must agree with the state)
  note: >-
    "For a further period of one year only" does not say one renewal, and does not
    say indefinite renewal either. Two opposite inferences have been drawn.
  citation: reg. 17(2)
  owner: NEMA question, routed to the Kenya escalation owner   # required when unknown
  drives: true                # an unknown that drives halts the dependent stage
```

A country file carries: metadata and legal instruments, operative instrument status, Nagoya status and EU side, the default escalation owner, the scope premise with questions and rules, eligibility, consent order, stages in the country's own order (TRIG, WHO, NEEDS, GIVES, requirements, documents, consent parties), the regulator state machine with clocks and on-lapse rules, output instruments with amendment policy, change-of-intent consequence, the eight A5 variables, the nine A6 obligation classes, manual-review judgments, live data layers, open questions, and whether a renewal probe may ever be scheduled.

Adding a country means adding a file that fills the same schema. `npm run lint:config` and `npm run test:ci` are the acceptance test. If a new country needs a schema change, that is a finding to report, not something to hide.

## Fictional parties

Nordlicht Biotics GmbH (Hamburg, seeking), Lake Basin Natural Products Institute (Kisumu, providing and advising), Instituto de Bioprospección del Pacífico (Cali, providing), Ol Kalou Community Seed Bank (community custodian, Path B, verification pending), Meridian Bridge Advisory BV (broker with four functions), Ashe and Okoro ABS Counsel (adviser), Instituto Amazônico de Metabólitos (Manaus, dry run). None is a real organisation. No person named here exists.

## Licence and ownership

Built pre-contract for the GENE-LINK MVP proposal. Assigned to Landscape Alliance on contract signature at no cost, as stated in the proposal's intellectual property statement. Until then, all rights reserved by the author. Third-party dependencies are MIT licensed.
