# GENE-LINK MVP prototype

A working implementation of the GENE-LINK partnership journey, built for the Landscape Alliance (CIFOR and ICRAF) Request for Proposals of 3 September 2026 by Vincent Kofi Akorsu, independent technical consultant, Ho, Ghana.

Live demo: [genelink-prototype.onrender.com](https://genelink-prototype.onrender.com) (Render Starter instance, Frankfurt, always on, fictional parties, state resets on redeploy). The demo is a single shared instance — if another evaluator's session has moved things, the administrator persona's "Reset demo data" restores the seed.

This is not a mock-up. It is the seed of the MVP codebase: the stack the proposal recommends for production, structured as the production system will be structured. On contract award it becomes the MVP.

## What it proves

The RFP's appendices make claims that are easy to write and hard to fake. This prototype exists to show them running.

| Claim | Where to look |
| --- | --- |
| **Country rules are configuration, not code (R2).** Three YAML files, one engine. Brazil was written after the engine was finished and the engine did not change. | `config/countries/*.yaml`, `npm run dry-run -- BR` |
| **Three-state fields, not booleans (R1).** Every regulatory value carries `established`, `inferred` or `unknown`, with its Appendix B evidence marker and citation. A boolean in a regulatory field is a type error and a lint error. | `core/config/schema.ts` (`RegValue`), `core/config/lint.ts` |
| **Unknown halts and escalates, never defaults (R3).** A stage that depends on an unresolved value stops, shows the question, and routes it to a named owner slot. The same rule reaches the intake: a country's deciding fact starts in its explicit "not yet established" option (the linter requires one), and a stage, a requirement inside it, or a state-machine branch that turns on a fact nobody has answered halts on the page instead of dropping off the pathway as if the answer were no. A case opened from a match guesses nothing: purpose, activity, provenance and exchange start unestablished and scope reads "undetermined" until the parties answer. Escalation records follow the pathway, closed with a reason when the facts stop reaching them and reopened if they return. | Kenya case, stages "Consent and terms" and "Traditional knowledge". Colombia case, "Prior consultation". `core/engine/facts.ts`, `core/engine/conditions.ts`, `core/engine/scope.ts` |
| **A prohibition stops; a settled rule waiting on a fact holds.** Kenya reg. 11(4)(e): a listed species stops the eligibility stage and nothing on or after it can be completed; an unchecked one holds it on the species-status check, never on the legal owner. Colombia's application holds until Art. 6 country of origin is established, and Brazil's filing until the Art. 27 area is: neither branch is offered on a guess. | Change the species status on the Kenya case. `effect: stop` and `effect: hold` in the country files |
| **Evidence class reaches the interface (R4).** Every rule shown carries §, ▸, ?, ⊘ or [GL], visibly distinguished. | Every case page, `/admin/config/KE` |
| **Manual-review states for judgments no system can make (R5).** Brazil's "genuine scientific collaboration" is a state only a human with a recorded reason can move. Never a checkbox. The recorded judgment is that case's answer: the registrant stage resumes for that case alone, and the question stays open in the file for every other. | Brazil case, stage "Who holds the registration" |
| **Live data layers (R6).** Modelled in the schema (`liveLayers`); Kenya's species status list carries clearly-marked demonstration entries pending a maintained source. | `/admin/config/KE` |
| **One contract, versioned by addendum (R7).** The Colombian access contract is one record with an otrosí history. A change of intent marks the otrosí as required; the version is appended when the signed text is recorded, never written by the platform. Kenya's change of intent requires a new application instead. | Colombia case, "What the applicant holds" |
| **A lapsed clock never grants (R8), and a lawful one is not mistaken for a lapse.** The second Kenya case sits in `deadline_lapsed` with a remedy against the administrator and no permit. The linter refuses any clock whose lapse target is a granted state, and any clock that could run out in a state with no declared lapse. Recording an external instrument is refused unless the machine is in a granted state or an awaiting-record slot already exists. Clocks are counted as the law counts them, and every clock carries its counting basis with an evidence class: days are dates on the authority's own calendar in the time zone the country file names, the day of the event is not counted, and a deadline runs to the end of its last day there; working days skip each country's gazetted public holidays (a calendar in its file); a clock starts where the law starts it (Kenya's 30 working days from receipt, reg. 14(1)); a suspension stops the count and the answer resumes it (Kenya reg. 14(3)); a clock runs through every state the law runs it through (Colombia's 30 working days from registration, D391 Art. 29); where the start is not visible the clock counts to the latest day the law allows and says so (Brazil's 60 days from SisGen's notification, counted as 65 from the form); and the authority's extension of up to 60 working days on top of the 30 is recorded as its act, capped by the file. | Case `case_3_ke`, the administrator's extension control on a Colombian case in evaluation, `core/engine/stateMachine.ts`, `core/config/lint.ts` |
| **Full state machines with unhappy paths (R9).** Returned incomplete, information requested, resubmitted, refused, appealed, withdrawn, correction required, cancelled, all declared per country and walkable. | "Regulator processing" panel on any case |
| **A compliance module distinct from intake (R10).** The nine obligation classes are recorded on the instrument for phase two. They are not run. The renewal probe reads configuration: never for Brazil. | "What attaches to the instrument" panel |
| **The sequence itself varies (A5.3).** The same pathway page renders Colombia's consultation-before-application and Kenya's documents-with-the-application from configuration alone. | Compare the Kenya and Colombia case pages |
| **Person, organisation and membership are three entities.** Market functions belong to the organisation, permissions to the seat, the visit objective to the session. Amara Okoro holds seats in two organisations. Meridian Bridge is one broker with four functions. | `/persona`, `/organisations/org_meridian`, `/declare` |
| **Path B onboarding runs end to end.** A stranger with no ORCID registers an organisation on `/persona`; it lands in the same verification queue as the seeded requests and an administrator verifies or declines with a recorded reason. A pending Path B organisation may already act: onboarding runs in parallel, it does not gate the spine. | `/persona` registration card, `/admin` verification queue |
| **Confidentiality before a match.** Public and full projections. Identity, species and accession detail, and locality withheld until both sides signal interest. The owner chooses the taxon level search can find (the published taxon field); a withheld field is never a search key. The reveal is a recorded, symmetric event. A case's audit trail carries the same boundary as the case itself. | `/explore`, any listing as an outsider then as a counterparty |
| **Compliance output is information, never advice or approval, and what the system told each user is recorded.** | The wording everywhere, and `/disclosures` |
| **Hash-chained audit and integrity verification.** Every consequential action is an entry whose hash covers the previous entry. Tampering is detected. Each agreement version offers its exact signed text for download, and anyone holding a document can check it on `/verify`: the text is posted, never put in the address, and only its hash comes back. An agreement's text is fixed at the first signature, and it is executed only when every party has signed the same version. | `/verify`, `/cases/<id>/audit`, `/admin/audit` |
| **Open decisions are open.** Every held-open item in Appendix A, and every A7 question that applies to the three configured countries, is rendered as an open state with a decision slot, not resolved by drawing. | `/open-decisions`, inline `?` markers |
| **Production-grade hygiene from the first commit.** Security headers (CSP, HSTS, frame denial), a non-root container, zero known dependency vulnerabilities, zero WCAG 2.2 AA violations under axe-core across every route (`npm run a11y` replays the sweep against any running instance), and a `/health` probe that verifies the audit chain and returns 503 if it is broken. Denied views answer with real statuses (401 anonymous, 403 wrong authority) so a refusal is visible to scanners and WAF rules, not only to a human reading the page. | `next.config.ts`, `Dockerfile`, `scripts/a11y-sweep.mjs`, `/health` |
| **Out of scope is a stated position.** Non-commercial users reach a page that records the basis. No "already proven" exit exists anywhere. | `/out-of-scope`, case `case_5_co` |
| **Each side records its own acts, and the record decides when a step is done.** A party's signatory files, resubmits, appeals or withdraws; the administrator records the authority's acts and never files for a party. Filing is refused while scope is undetermined or escalated, or while a prohibition applies. A regulator stage is complete when the proceeding ends, a stage that ends in an instrument when the instrument is recorded, and new facts that block a completed stage reopen it. Clocks are evaluated whenever a case is read. | Any case's "Regulator processing" panel; `core/platform.ts` |
| **The visit objective shapes the visit and is measured.** "I want to source from the South" opens discovery on offers, "sell to an EU buyer" on needs, and each declaration is kept as an organisation-level demand signal, never a personal one, shown to administrators. | `/declare`, `/explore`, `/admin` |

## What it deliberately does not do

| Left pending | Why | How it is marked |
| --- | --- | --- |
| Real authentication | Needs Landscape Alliance's identity decisions and ORCID credentials. The MVP uses passkeys, email codes, ORCID OpenID Connect, TOTP for administrators | Persona switcher at `/persona`, behind `lib/session.ts`, the only file that changes |
| Persistence | The free demo instance has an ephemeral filesystem. The MVP uses PostgreSQL with row-level security and an append-only audit table | `core/store/memory.ts` behind `core/store/Store.ts`. `core/store/postgres.ts` documents the adapter and is unimplemented |
| Named escalation owners | R3 wants a named human. Only Landscape Alliance can name them | `escalation.defaultOwnerName: null` in every country file, shown as "name pending" |
| Template and clause content | Legal partners supply it | `lib/clauses.ts`, every clause labelled illustrative |
| Learning content, support contacts, the 48-code function taxonomy | Landscape Alliance content and constructs | Marked pending on `/learn` and `/explore` |
| Adviser and broker attachment; publishing new listings | MVP flows behind the same seat model | Marked on the case page and `/open-decisions`; listings are seeded |
| Real verification checks | The flow runs (request, vouching, administrator decision, declined state); the checks behind a decision are seeded. No domain check or ORCID lookup executes | Organisation verification rows carry seeded evidence |
| Document files | Uploads accept pasted text, hashed and versioned as a file would be | `lib/storage.ts` documents the S3 adapter interface, unimplemented; the storage service ships dormant in `docker-compose.yml` |
| Transactional email | Nothing leaves the process; all events are visible in-app | `lib/email.ts` documents the adapter interface, unimplemented |
| Qualified electronic signatures | Click-level execution is what most agreements need; QES is priced as an optional item | `lib/signing.ts` documents the adapter interface; `Platform.executeAgreement` records the click-level signature |
| Assistive AI | Feature-flagged and off by default in the MVP; provider and use decided with Landscape Alliance | `lib/ai.ts` documents the adapter interface, unimplemented; the checks it would assist (`lib/redact.ts`, taxonomy filters) already run as code |
| Countries beyond Kenya, Colombia and the Brazil dry run; the R10 duties module | Further countries need legal research Landscape Alliance supplies; duty tracking is phase two | Madagascar, Malaysia and South Africa analysed in the proposal; nine obligation classes recorded as configuration |
| Live ABS Clearing-House lookup, qualified signatures, payments | Deferred or optional in the proposal | Not present |
| Nonce-based CSP | Next.js emits inline bootstrap scripts for hydration and the components use inline `style` attributes, so `script-src` and `style-src` carry `unsafe-inline`. Production tightening is per-request nonces in middleware | `next.config.ts` headers |
| Any assertion about the law beyond what Appendix B marks | Where Appendix B says ? the prototype says ? | Everywhere |

## Run it

Requires Node 24 (the current LTS line; Node 26 enters LTS on 28 October 2026 and the MVP build targets it).

```bash
npm ci
npm run test:ci        # 150 tests on the core: schema, lint, scope, pathway, state machines, clocks and calendars, instruments, audit, full journeys, dry run for every country, a regime suite pinning each country file to its Appendix B diagram, a hardening suite replaying every defect found in live evaluation and in the final audit against the diagrams and primary texts, and a real-world suite replaying defects found using the site as several people at once, some of them hostile
npm run dry-run -- BR  # walk Brazil end to end in the terminal. Try CO or KE too
npm run lint           # ESLint (Next.js core-web-vitals + TypeScript) across the codebase
npm run a11y           # axe-core WCAG 2.2 AA sweep over every route, anonymous and under each seat kind
npm run lint:config    # validate every country file
npm run deps:update    # updates dependencies to the newest versions published at least seven days ago (the supply-chain rule in the proposal, Part 4.4)
npm run dev            # http://localhost:3000
```

Or with Docker:

```bash
docker build -t genelink-prototype .
docker run -p 3000:3000 genelink-prototype
```

Or the whole stack, which is how the MVP is delivered and how it moves between hosts (proposal Part 10.1):

```bash
docker compose up
```

`docker-compose.yml` starts the application, PostgreSQL 18 and S3-compatible object storage. The prototype runs in memory and ignores the database and storage services. They are there so that the MVP's `PostgresStore` and object-storage adapter have their targets from the first day of the build, and so that the move-hosting runbook is one file on any provider.

## Repository structure

```
config/
  countries/colombia.yaml     built pathway, transcribed from Appendix B with evidence markers
  countries/kenya.yaml        built pathway
  countries/brazil.yaml       dry run, written after the engine
  open-decisions.yaml         Appendix A held-open items with the prototype's working position
core/                         framework independent. No import from Next, React or a database driver.
  config/schema.ts            Zod schema. RegValue, CountryConfig, stages, state machine, outputs, A5 variables, A6 classes
  config/lint.ts              invariants the schema cannot express (R1, R3, R4, R8, R9)
  config/load.ts              YAML loader
  engine/scope.ts             in scope, out of scope with basis, escalate; undetermined until the parties answer. No default branch
  engine/pathway.ts           stages, requirements, documents, consent parties, halts, escalations
  engine/stateMachine.ts      country-agnostic interpreter. Guards on facts, working-day calendars, suspension, extension. Lapse never grants
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
lib/redact.ts                 strips emails, phone numbers, URLs and ORCID iDs from free text before it is shown
proxy.ts                      request guard in front of every route: cross-origin posts get a 403, unsupported methods a 405, and malformed or oversized action posts a 4xx, never the action runtime. A post carrying no Origin at all is refused inside the action layer, where the refusal can be audited
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

A country file carries: metadata and legal instruments, operative instrument status, Nagoya status and EU side, the default escalation owner, the scope premise with questions and rules, eligibility, consent order, stages in the country's own order (TRIG, WHO, NEEDS, GIVES, requirements that may stop or hold the stage, documents, consent parties), the regulator state machine with fact-guarded transitions, clocks (the states they run and suspend in, any extension power, and on-lapse rules), the working-day calendar of gazetted public holidays, output instruments with amendment policy, change-of-intent consequence, the eight A5 variables, the nine A6 obligation classes, manual-review judgments, live data layers, open questions, and whether a renewal probe may ever be scheduled.

Adding a country means adding a file that fills the same schema. `npm run lint:config` and `npm run test:ci` are the acceptance test. If a new country needs a schema change, that is a finding to report, not something to hide.

## Fictional parties

Nordlicht Biotics GmbH (Hamburg, seeking), Lake Basin Natural Products Institute (Kisumu, providing and advising), Instituto de Bioprospección del Pacífico (Cali, providing), Ol Kalou Community Seed Bank (community custodian, Path B, verification pending), Meridian Bridge Advisory BV (broker with four functions), Ashe and Okoro ABS Counsel (adviser), Instituto Amazônico de Metabólitos (Manaus, dry run). None is a real organisation. No person named here exists.

## Licence and ownership

Built pre-contract for the GENE-LINK MVP proposal. Assigned to Landscape Alliance on contract signature at no cost, as stated in the proposal's intellectual property statement. Until then, all rights reserved by the author. Third-party runtime dependencies carry permissive licences (MIT, Apache 2.0, ISC, BSD, 0BSD). The one exception is the platform-specific `sharp` image binary that Next.js pulls in, which bundles LGPL-licensed libvips and is not exercised by the prototype. `npx license-checker-rseidelsohn --production --summary` reproduces the list.
