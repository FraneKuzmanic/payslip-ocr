# Feature: Task 04 — Content Understanding provider, mapper & scoring harness

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 04](../ROADMAP.md) · **PRD:** §6.2, §6.3, §7.3, §7.4,
§7.12, §9.2, §9.4, §11.3 · **ADR:** [`docs/adr/0001`](../../docs/adr/0001-payslip-extraction-architecture.md)
· **Evidence:** [`history/01-extraction-bakeoff.md`](../history/01-extraction-bakeoff.md) ·
**Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md)
(this project has no `CLAUDE.md`)

## Feature Description

Uploading a payslip starts extraction. The upload route hands the file bytes to an in-process
**extraction runner**. The runner allows three analyses at a time and gives each a whole-analysis
timeout. It calls a **Content Understanding provider** ported from `scripts/bakeoff/run-cu.ts`.
A **mapper** turns the provider's printed strings into canonical fields with the Task 02 parsers.
The runner then writes the result back to the payslip row:

- `status = review`
- `canonical_data`
- `extraction_metadata` (per-field confidence, `unreadableFields`, latency)
- `raw_provider_result`, verbatim

A failure writes `status = failed` with a classified `failure_reason`, and never touches a sibling.

An offline **scoring harness**, `npm run score:extraction`, replays recorded provider responses
through the same production mapper and scores them against the golden set. It exits non-zero when
any expectation goes unscored. It scores every recording set present and reports their spread, so
one run is never quoted as a ranking.

The plan also settles the seven concerns raised at priming (see **Design decisions**, D1–D7), each
with a recommendation that this task implements.

## User Story

As a payslip holder who has just uploaded a photo of my payslip
I want its fields read and filled in without typing them
So that I only have to check and correct, not transcribe (PRD US-01, US-11, US-13, US-15)

## Problem Statement

- An upload today creates a row that stays in `processing` forever. The route marks the spot where
  extraction should start (`api/src/routes/sessions.ts:83`).
- The engine exists only as a bake-off script. It is not typed into the application, has no
  failure classification, and no mapper to canonical fields.
- Its scorer (`scripts/bakeoff/score.ts`) prints "NO CACHED RESULT" and still exits 0. It scores
  only `payComponents` among the tables, and compares with a lenient float parser the product no
  longer uses.

## Solution Statement

- **Provider module** `api/src/providers/document-extraction/content-understanding/`:
  - the field schema, moved here as the single source of truth;
  - the analyzer definition;
  - `:analyzeBinary` with the 5 s submit budget and resubmit;
  - polling, failure classification, and a pure mapper.
  It is the only place provider vocabulary may appear in `api/src`, and a new guard test enforces
  that.
- **Extraction runner** `api/src/services/payslip-extraction.ts`: a semaphore capped by
  `EXTRACTION_CONCURRENCY`, `AbortSignal.timeout(EXTRACTION_TIMEOUT_MS)`, conditional repository
  writes, and one structured log line per finish.
- **Repository** gains `completeExtraction`, `failExtraction` and `failStaleExtractions`, and stops
  reading the ~0.2–1 MB `raw_provider_result` column on every list and detail read.
- **Provisioning script** `npm run provision:analyzer`, with a drift check that the deployed
  analyzer matches the code.
- **Scoring**: provider-neutral logic in `api/src/scoring/`, typed and unit-tested, driven by a thin
  CLI `scripts/score-extraction.ts`.
- **Opt-in end-to-end run**, `npm run test:extraction`: all 11 golden-set payslips go through the
  real API, hosted Supabase and Azure. The run records their raw responses as a second recording set.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (external service, background concurrency, failure taxonomy, a
harness with a correctness guarantee, a hosted end-to-end run)
**Primary Systems Affected**: `api/src/{providers,services,scoring,repositories,routes,config.ts,app.ts}`,
`scripts/`, `render.yaml`, `.env.example`, `ROADMAP.md`, ADR-0001, PRD §9.4
**Dependencies**: none new. `fetch` (Node 24), `zod` 4, `@supabase/supabase-js`, `pdf-lib` (tests),
`tsx` (scripts), all installed

---

## DESIGN DECISIONS

D1–D7 resolve the priming concerns. D8–D17 are the remaining calls the implementation needs. Each
states the recommendation this plan implements.

### D1 — Azure configuration reaches Render in this task (priming concern 1)

The ROADMAP contradicts itself. Task 01b says "Task 04 adds it"; Task 13 says the hosted CU config
is its job. **Recommendation: Task 04.**

1. `config.ts` makes four values **required**: `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`,
   `AZURE_CONTENT_UNDERSTANDING_KEY`, `AZURE_CU_ANALYZER_ID` and `AZURE_CU_API_VERSION`. It adds
   `EXTRACTION_TIMEOUT_MS` (default 120000) and `EXTRACTION_CONCURRENCY` (default 3). This follows
   the file's own rule: fail at startup, not at the first request.
2. `render.yaml` gains the four as `sync: false` and the two tunables as values.
3. **Human step H1, before the subtree push:** set the four secrets on `payslip-ocr-api` in the
   Render dashboard. Render only prompts for `sync: false` values when a Blueprint is *created*
   (ROADMAP Task 13 already records this).
4. **Safety net:** a deploy that fails its health check never replaces the live instance on
   Render. A missed H1 therefore shows as a failed deploy, not a dead site. The executing agent
   still confirms H1 with the user before pushing, and checks `/api/health` afterwards.
5. **There is one Foundry resource** (Sweden Central). Local and hosted use the same analyzer
   `hrPayslipV1`, so "analyzer provisioning against the production resource" is already true once
   this task runs. Task 13's scope loses that item and keeps only the end-to-end journeys.

### D2 — Background writes use the uploading user's token (priming concern 2)

**Recommendation: keep the user-scoped client (`auth.client`); add no secret key at runtime.**
**Accepted by the product owner, 2026-09-24**, including leaving the direct-write gap to Task 09.

- The job is enqueued inside the upload request, while the access token is fresh. Supabase tokens
  last an hour. The worst queue wait for one session is about 4 rounds of ≤26 s, which is far
  inside that.
- `SUPABASE_SECRET_KEY` bypasses RLS. Putting it on Render would give a request-free code path
  unrestricted access to every user's payslips, in exchange for closing a gap that it does not
  actually close. Task 09's PATCH and confirm would still write `canonical_data` and `status` with
  the user's token.
- Closing the direct-write gap (Task 03 open item 4) needs **all** API writes to go server-side
  plus `revoke update` from `authenticated`. That is one decision, and it belongs to **Task 09**,
  where confirm lands. This task records it in ROADMAP §5 with that owner.
- Every extraction write is conditional: `status = 'processing'` and `deleted_at is null`, scoped
  to the user. So a payslip deleted or reaped mid-flight is never resurrected. The job logs
  `extraction result discarded` and stops.

### D3 — Stale `processing` rows are failed lazily on read (priming concern 3)

The queue is in memory, and every push to `main` redeploys (`autoDeployTrigger: checksPass`). An
extraction in flight during a deploy leaves its row in `processing`. Retry (PRD §10.8) accepts only
`failed`, so without a fix the payslip is stuck for good.

**Recommendation: a lazy reaper.**

- `PayslipRepository.failStaleExtractions(cutoff)` runs one owner-scoped `UPDATE … SET status =
  'failed', failure_reason = 'provider_unavailable' WHERE status = 'processing' AND updated_at <
  cutoff`.
- It is called at the start of the three read routes a client polls: `GET /api/sessions/:id`,
  `GET /api/payslips/:id` and `GET /api/payslips`.
- The cutoff is `STALE_EXTRACTION_MS = 15 min`, a constant in the service module. It must exceed
  the worst queue wait plus `EXTRACTION_TIMEOUT_MS`, and it is not an environment variable.
- `provider_unavailable` is retryable, so Task 09's retry button recovers the payslip.
- **Why not a startup sweep:** it would need a cross-user client, which is the secret key D2
  rejects. **Why not accept the gap:** a routine push strands real rows.

### D4 — An `api/src` vocabulary guard, with an explicit allow-list (priming concern 4)

The Task 02 guard scans `shared/src` only, so ROADMAP DoD "provider vocabulary appears in one
module only, enforced by the Task 02 guard" is currently false. **Recommendation:** add
`api/src/provider-vocabulary.test.ts`.

- It uses the same regex as `shared/src/payslip.test.ts:157` and scans every `*.ts` under
  `api/src` recursively.
- Allowed:
  - `providers/document-extraction/content-understanding/**`, the one module;
  - `config.ts`, whose env-var names (`AZURE_…`) are deployment configuration, not domain
    vocabulary;
  - the test itself.
- To make this possible, `app.ts` wires the provider through
  `createDocumentExtractionProvider()` exported from `content-understanding/index.ts`. That
  factory reads `config` itself, so `app.ts` never names an `AZURE_…` key. The import path's
  `content-understanding` (with a hyphen) does not match `/contentunderstanding|content
  understanding/i`.
- Run it with a throwaway probe file to prove it bites.
- `scripts/` is not under the guard. The scoring CLI and the provisioning script are tooling around
  the provider, not application layers.

### D5 — Harness semantics (priming concern 5)

**The harness exits 1 on any of:**

- a recording with no expectation file;
- an expectation file with no recording in a set;
- an expectation **key missing** (`undefined`, as distinct from `null`) for a field the harness
  scores;
- an expectation carrying a key the harness does not know how to score and that is not fixture
  metadata;
- an `unscorable` entry naming an unknown field.

"Removing a fixture's ground truth" therefore fails whether a file or a key is removed.
`unscorable` fields are skipped **and listed** in the report.

**Recording sets:** a directory `.bakeoff/<set>/` is a set when its files are CU operation bodies
**from the analyzer the code defines**, that is, `result.analyzerId` equals `AZURE_CU_ANALYZER_ID`
(`hrPayslipV1`). Read the id from `result.analyzerId`, not the top-level `analyzerId`: only the
bake-off cache writer added the top-level copy, and production recordings will not carry it.

- `cu-mini` holds CU bodies from the `gpt-4.1-mini` analyzer `hrPayslipMini`, with only 10 files
  (no B02). Counting it would make the harness exit 1 every run, and would report a known −2.4 pp
  model difference as run-to-run spread. It is **skipped and printed by name**, as are `layout` and
  `llm`, which are not CU bodies.
- `cu` is the bake-off baseline (2026-09-20).
- `production` is written by this task's end-to-end run (D17).
- The harness scores each set, reports each set's figures, and reports the **measured spread**
  between sets beside the documented ~0.5% band. With one set it prints the documented band and
  says the spread is unmeasured.

**Targets are reported, not gated.** PRD §11.3 says "measure, don't guarantee". The exit code means
"could not measure", never "measured low". The ROADMAP DoD (≥95% / ≥85%) is checked by reading the
report.

**What is scored:**

- **Scalars:** the 25 canonical scalars (not 26: `currency` is envelope, Task 02 D3). The
  denominator is 11 × 25 − 2 (G01 declares `ukupnoSati` and `paymentDate` unscorable) = **273**.
  - Decimals compare with `amountsEqual`.
  - `period` and `paymentDate` compare as exact strings.
  - Text compares **strictly on diacritics** (product-owner decision, 2026-09-24). A wrong
    `č/ć/ž/š/đ` in a name is an error the user must correct. `strictTextKey` lower-cases, applies
    NFC, collapses whitespace and strips punctuation, but **keeps diacritics**. The report also
    prints a **bake-off-comparable** scalar line using the bake-off's lenient `textKey`
    (diacritic-insensitive), so past figures remain comparable. The strict line is the headline
    and the one the ≥95% target reads.
- **Line items:** all three tables, every cell, positional by row index, plus row-count exactness
  per table. The report also prints a **bake-off-comparable** figure: `payComponents` `naziv` +
  `iznos` cells, which the bake-off reported as 170/180.
- **Critical fields:** `CRITICAL_FIELDS` from `@payslip/shared`.
- **Latency:** p50, p90 and max per set from each recording's `latencyMs` (PRD §7.12).
- **Most-wrong fields:** the top 12 by miss rate, as the bake-off printed.

**Placement:** scoring logic lives in `api/src/scoring/score.ts`, which is typed, provider-neutral,
and unit-tested (including "a missing key fails"). `scripts/score-extraction.ts` only reads files,
runs the mapper, prints and exits. `scripts/` is outside every tsconfig, so logic there would go
untypechecked.

### D6 — Grounding and low confidence belong to Task 06 (priming concern 6)

- ROADMAP Task 06 already owns "low-confidence projection" and "`ungroundable` as its own signal".
  Task 04 does not compute either.
- Task 04's job is to make both possible. It stores per-field `{confidence, source: "model"}` in
  `extraction_metadata.fields`, keyed by canonical dotted path. It also keeps the raw response
  verbatim, including `pages[].words` (text + `source` + `confidence`) and `markdown`, which
  grounding needs.
- The detail route fills `unreadableFields` from metadata now and leaves `lowConfidenceFields: []`
  with a comment naming Task 06. This amends Task 03 open item 1, which listed both for Task 04.
  The ROADMAP is the plan of record, and the threshold is a Task 06 decision.

### D7 — ADR-0001 region correction (priming concern 7)

The ADR body says "West Europe" twice (lines 27, 39). The resource is **Sweden Central** (PRD §4.5,
history/01). The fix is a factual correction to an accepted ADR, not a decision change: replace
both occurrences and add a one-line dated note under the confirmation block.

### D8 — The field schema moves into the provider module; the analyzer is reused

- `scripts/bakeoff/field-schema.ts` moves verbatim to `content-understanding/field-schema.ts`. The
  bake-off file becomes a one-line re-export, so `run-cu.ts`, `run-llm.ts` and `ground.ts` keep
  working unchanged. There is one schema, not two that drift.
- **Verified 2026-09-24 during planning:** the deployed analyzer `hrPayslipV1` matches the code
  exactly. Every `fieldSchema.fields` entry is deep-equal to `toCuField(PAYSLIP_FIELDS)`, and
  `description` equals `"Hrvatski obračun plaće (Obrazac IP1).\n\n" + SHARED_RULES`. The recordings
  in `.bakeoff/cu/` therefore came from exactly the analyzer production will call, and stay valid
  scoring input.
- The resource's `/contentunderstanding/defaults` is already registered: `gpt-4.1` and
  `text-embedding-3-large`, among others.
- **Do not edit any field description in this task.** A description change invalidates the
  recordings and needs `--replace` plus re-recording. That is a measured-change exercise, not part
  of a port.

### D9 — Failure classification

`ExtractionError(reason, cause?)` with `retryable = isRetryableFailure(reason)`. The flag is no
longer passed separately (Task 02 open item 1).

| Situation | Reason | Why |
| --- | --- | --- |
| Network error, submit stalled on all 4 attempts, whole-analysis timeout, submit/poll HTTP 408, 429, 5xx | `provider_unavailable` | Transient |
| Submit/poll HTTP 401, 403, 404 | `provider_unavailable` + `logger.error` | Our misconfiguration (key, analyzer id), not the document's fault. A retry works once it is fixed |
| Submit HTTP 400, 413, 415, 422 and other 4xx | `provider_rejected` | The service refused this input |
| Operation `Failed` or `Canceled` | `provider_unavailable`, logging `error.code` only | The 2025-11-01 reference documents no error-code taxonomy. The one code seen in the wild is `InternalServerError`. Record observed codes in the history file |
| `Succeeded` but the success body does not match the narrow schema the mapper reads | `provider_unavailable` + `logger.error` | Contract drift, not the document |
| `Succeeded`, but `markdown` is blank **or** no canonical field is non-null | `unreadable_document` | PRD US-11: "too blurred" is a per-payslip failure the user retakes |

Log codes and statuses, never the service's `message`. It may quote document text.

### D10 — Mapper rules

- **Text fields** (`employer*`, `employee*`, `naziv`, `vjerovnik`, `brojRata`): trim, empty → `null`.
  No `HR` stripping, digit filtering or any other Croatian rule. The field description already asks
  for 11 digits (ROADMAP §5, rule creep).
- **Parsers:**
  - money (`brutoPlaca` … `ukupanTrosakRada`, `iznos`, `ostatakSalda`) uses `parseAmount`;
  - `ukupnoSati`, `sati` and `koeficijent` use `parseQuantity`;
  - `period` uses `parsePeriod`;
  - `paymentDate` uses `parseDate` (Task 02 D1).
- **Unreadable:** printed text that is non-empty but that the parser returns `null` for. The value
  becomes `null`, and its dotted path goes into `unreadableFields`.
- **Tables: an absent `valueArray` becomes `[]`, never `null`.** The golden set uses `[]` for every
  empty or absent table. F01 has no obustave section, yet its fixture is `obustave: []` with
  `obustaveUkupno: null`. CU returns no `valueArray` in both the "printed empty" (A03) and "absent"
  (F01) cases. The `null`-versus-`"0.00"` distinction applies to **totals**, and CU already makes
  it.
- **`currency` is read by nothing.** It stays in the analyzer schema (changing it would invalidate
  D8's verified identity), and the envelope is always EUR.
- **Metadata:** every value with a non-empty `valueString`, unreadable ones included, gets
  `fields[path] = { confidence: field.confidence ?? null, source: "model" }`.
- The mapper validates its output with `canonicalPayslipFieldsSchema.parse` before returning.
- **Raw field access** goes through a narrow zod schema (`.loose()`) for exactly what is read:
  `result.contents[0].{markdown, fields}`, and per field `valueString`, `confidence`, `valueArray`
  and `valueObject`.

### D11 — Reads stop pulling `raw_provider_result`

The recordings are 0.2–1.0 MB each, with A01 at 963 KB. `listBySession`, `listPage` and
`findDetailState` select `*` today. Once raw responses land, a session poll of ten payslips would
move up to ~10 MB.

**Recommendation:** a `PAYSLIP_COLUMNS` constant listing every column except
`raw_provider_result`, used by every read. `mapPayslipRow` takes
`Omit<PayslipRow, "raw_provider_result">`. Only the end-to-end test (with the admin client) and a
future Task 08 read the raw column.

### D12 — Timings

- The submit budget stays at 5 s with 4 attempts (locked decision 12).
- The **poll interval is 1 s**, not the bake-off's 2 s. It saves ~0.5 s on average against the
  ≤10 s target, and costs one extra GET per second per job, well under the 3,000 operations/min
  quota.
- `EXTRACTION_TIMEOUT_MS` defaults to 120 s. The bake-off worst case was 26.3 s, so this is 4.5×
  headroom.

### D13 — No `EXTRACTION_PROVIDER` variable

PRD §9.2 lists it, but there is exactly one provider in `api/`. The challenger lives in
`scripts/bakeoff/` (locked decision 10), so a selector with one legal value is speculative
configuration (AGENTS.md §2). Record the deviation in the history file.

### D14 — `processingLocation` stays at its default

The 2025-11-01 reference says `:analyzeBinary` processes in **`global`** unless
`processingLocation=geography|dataZone` is passed. PRD Appendix C 8 accepts any region, and
changing it would move the measured baseline. **Recommendation:** leave it, and add one sentence to
PRD §9.4 so the privacy statement is accurate.

### D15 — Dedicated repository methods rather than a wider `UpdatePayslipInput`

Task 03 open item 1 says "extend `UpdatePayslipInput`". Extraction writes need a
`status = 'processing'` precondition that a generic `update` does not express. Three named methods
make the precondition impossible to forget, and `update`/`softDelete` stay as they are. Record this
as a deviation.

### D16 — The queue holds the upload bytes in memory

Re-downloading from Storage when a slot frees would cost 0.3–1 s per payslip against the latency
target. The worst case is 10 × 10 MB per session on a 512 MB free instance. That is acceptable at
demo scale, and Task 07's client downscale shrinks images to ~1,600 px. Record it in ROADMAP §5.

### D17 — The end-to-end golden run is opt-in, and budgeted

DoD 1 ("all 11 extract end to end through the real API") costs about **$0.27–0.30** per run,
measured from the 11 recordings' own `usage` blocks (planning, 2026-09-24):

- 13 CU pages → about $0.065;
- 13,000 contextualization tokens → about $0.013;
- `gpt-4.1` tokens: 802 uncached input, 121,472 cached input and 16,617 output → about $0.195.

These use list prices ($2 / $0.50 / $8 per M tokens, $5 per 1,000 pages, $1 per M
contextualization tokens), which are not re-verified. Allow ~10% for duplicate analyses after
stalled submits. A run takes 2–4 min.

**Credit budget (product owner, 2026-09-24).** The resource runs on an Azure for Students
subscription with roughly $100 of credit. The exact balance can be read only in the Microsoft
Azure Sponsorships portal (`https://www.microsoftazuresponsorships.com/balance`), not through the
CLI or the key the project holds. The owner accepts a few test runs, but testing must not eat the
credit. Therefore:

- **At most 3 paid `test:extraction` runs in this task without asking.** A 4th needs the owner's
  go-ahead.
- Each run sums the `usage` blocks of its responses and **prints the estimated cost** at the end.
  The history file records every paid run, with its cost and the running total.
- Every other check replays recordings or stubs `fetch`. The provisioning check (step 13) is
  GET-only and free of analysis charges.

The golden run lives in `api/src/routes/extraction.integration.ts`. It lives in `api/src/routes/extraction.integration.ts`, run by `npm run test:extraction`
through the existing runner (so the hosted host is printed first), **not** by `test:integration`.

- `payslips.integration.ts` injects a no-op runner, so routine validation never calls Azure.
- The run also writes each raw response to `.bakeoff/production/<sample>.json` (git-ignored). That
  gives D5's harness its second set.
- It uploads one **blank one-page PDF** (built with `pdf-lib`) beside the 11. This proves
  `unreadable_document` and sibling isolation against the real service.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `scripts/bakeoff/run-cu.ts` (whole file, 203 lines): the reference implementation to port.
  - `toCuField`: lines 24–43.
  - `analyzerDefinition`: 45–61.
  - `poll`: 63–81.
  - `ensureAnalyzer`: 83–110.
  - `submitWithRetry` with the SUBMIT_STALL comment: 112–156. Port the comment.
  - `analyse`: 158–169.
- `scripts/bakeoff/field-schema.ts` (whole file): moves verbatim (D8).
- `scripts/bakeoff/score.ts` (whole file):
  - `textKey`: lines 29–35. Port it.
  - `extractedFields`: 138–166, the CU raw shape.
  - The per-sample loop and report: 168–250.
  - Its `num`, `asPeriod` and `asDate` are **not** ported; the shared parsers replace them.
- `scripts/bakeoff/common.ts`: `loadExpected`, `SAMPLES_DIR`, `CACHE_DIR`, `EXPECTED_DIR`. The CLI
  may import these.
- `api/src/providers/document-extraction/types.ts` (whole file): the interfaces to extend.
- `api/src/routes/sessions.ts` (lines 39–92): the upload route; enqueue at line 83.
- `api/src/routes/payslips.ts`:
  - lines 22–37, the list route;
  - lines 60–86, the detail route with the `lowConfidenceFields`/`unreadableFields` placeholders.
- `api/src/repositories/payslips.ts` (whole file):
  - `update` at lines 173–191 is the pattern for owner-scoped conditional updates;
  - `mapPayslipRow` at 202–224;
  - the `PGRST103` handling at 160–167.
- `api/src/repositories/payslips.test.ts` (lines 1–60): the `payslipRow()` factory and
  `mapPayslipRow` test style.
- `api/src/config.ts` (whole file): `readRequired`, `readCount`, and the frozen `Config`.
- `api/src/app.ts` (whole file): `AppOptions` injection pattern (`authenticator`).
- `api/src/app.test.ts` (lines 60–75): a stub `SupabaseClient` cast as `{}`.
- `api/src/logger.ts`: redaction paths. `*.raw`, `*.bytes` and `*.content` are already removed.
- `api/src/auth/authenticator.ts` (lines 60–71): why the user client is RLS-scoped, and the rule
  "the secret key … is never used on a request path" (D2 keeps it).
- `api/src/routes/payslips.integration.ts`:
  - lines 1–60, users, cleanup and `createApp()`;
  - the `createAndSignIn` and `upload` helpers at the bottom of the file.
- `api/vitest.config.ts`, `api/vitest.integration.config.ts`,
  `scripts/run-supabase-integration-tests.mjs` (lines 1–30): the env placeholders and the runner to
  extend.
- `shared/src/payslip.test.ts` (lines 151–168): the vocabulary guard to mirror.
- `shared/src/payslip.ts`: `canonicalPayslipFieldsSchema`, `CRITICAL_FIELDS`, `FieldMetadata`.
- `shared/src/{money,quantity,datetime}.ts`: `parseAmount`, `parseQuantity`, `parsePeriod`,
  `parseDate`, `amountsEqual`.
- `shared/src/session.ts` (lines 49–64): `ExtractionFailureReason`, `isRetryableFailure`.
- `supabase/migrations/20260924100541_create_sessions_and_payslips.sql`: the columns. No migration is
  needed: `extraction_metadata jsonb`, `raw_provider_result jsonb` and `failure_reason` all exist.
- `.agents/fixtures/expected/README.md`: `unscorable`, and `null` vs `"0.00"`.
- `render.yaml`, `.env.example`, `.github/workflows/ci.yml`: the deploy and CI surface.
- `.claude/commands/validate.md`, Phases 4, 7 and 8: updated at the end. The directory is
  git-ignored, so the edit is local only.

### Recorded response shape (verified from `.bakeoff/cu/*.json`)

```
{ latencyMs, apiVersion, analyzerId,            ← added by the bake-off cache writer
  id, status: "Succeeded",
  result: { analyzerId, apiVersion, createdAt, stringEncoding, warnings: [],
            contents: [ { kind: "document", mimeType, unit: "inch"|"pixel",
                          startPageNumber, endPageNumber, markdown,
                          pages: [ { pageNumber, angle, width, height, spans, words, lines } ],
                          paragraphs, sections, tables, figures,
                          fields: { <name>: { type:"string", valueString?, confidence?, source?, spans? }
                                  | { type:"array", valueArray?: [ { type:"object",
                                        valueObject: { <col>: {type,valueString?,confidence?,source?} } } ] } } } ] },
  usage: { documentPagesStandard, contextualizationTokens, tokens: { "gpt-4.1-input", … } } }
```

- A null scalar is `{ type, confidence }` with **no** `valueString`.
- An empty or absent table is `{ type: "array" }` with **no** `valueArray`.
- An array carries no confidence of its own; its cells do.

### New Files to Create

- `api/src/providers/document-extraction/content-understanding/field-schema.ts`: moved schema (D8)
- `api/src/providers/document-extraction/content-understanding/analyzer.ts`: `toCuField`,
  `buildAnalyzerDefinition(completionModel)`
- `api/src/providers/document-extraction/content-understanding/fields.ts`: the pure mapper
- `api/src/providers/document-extraction/content-understanding/fields.test.ts`
- `api/src/providers/document-extraction/content-understanding/provider.ts`: HTTP, retry, poll,
  classification
- `api/src/providers/document-extraction/content-understanding/provider.test.ts`: `fetch` stubbed
- `api/src/providers/document-extraction/content-understanding/index.ts`:
  `createDocumentExtractionProvider()`
- `api/src/services/payslip-extraction.ts`: the runner, `STALE_EXTRACTION_MS`
- `api/src/services/payslip-extraction.test.ts`
- `api/src/scoring/score.ts` + `score.test.ts`: provider-neutral scoring (D5)
- `api/src/provider-vocabulary.test.ts`: the guard (D4)
- `api/src/routes/extraction.integration.ts`: the opt-in golden run (D17)
- `scripts/score-extraction.ts`: the harness CLI
- `scripts/provision-analyzer.ts`: the provisioning CLI
- `.agents/history/04-content-understanding-provider.md`: at the end

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [CU REST 2025-11-01 — Analyze Binary](https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/analyze-binary?view=rest-contentunderstanding-2025-11-01):
  `202` + `Operation-Location`, other status codes carry `x-ms-error-code`, the `OperationState`
  enum (`NotStarted|Running|Succeeded|Failed|Canceled`), `processingLocation` defaults to `global`
  (D14), and the field and page shapes.
- [CU REST 2025-11-01 — Create Or Replace analyzer](https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/create-or-replace?view=rest-contentunderstanding-2025-11-01):
  used by the provisioning script, `PUT` + operation polling.
- [CU service limits](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits):
  HEIC/HEIF, JPEG, PNG and PDF are all supported (so Task 07's HEIC upload needs no conversion);
  ≤200 MB and ≤300 pages async; 1,000 pages/min; 3,000 operations/min; description properties
  ≤1,024 characters.
- [`AbortSignal.any`](https://nodejs.org/api/globals.html#static-method-abortsignalanyiterable)
  and `AbortSignal.timeout`: combine the per-submit 5 s budget with the whole-analysis signal.

### Patterns to Follow

**Owner-scoped conditional update** (mirror `payslips.ts:173–191`):

```ts
const { data, error } = await this.#client
  .from("payslips")
  .update({ status: "review", /* … */ updated_at: new Date().toISOString() })
  .eq("id", uuidSchema.parse(id))
  .eq("user_id", this.#userId)
  .eq("status", "processing")
  .is("deleted_at", null)
  .select("id")          // never select the raw column back
  .maybeSingle();
if (error) throw new PayslipRepositoryError("query_failed", error);
return data !== null;    // false = deleted or reaped mid-flight
```

**Config reading** (mirror `config.ts:83–97`): add to `Config`, read with
`readRequired` / `readCount`. All problems are reported together.

**Errors:** machine codes only. `HttpError(status, code)` for routes; `ExtractionError(reason)` for
the provider. Never prose, never provider detail in a code (`error-handler.ts:5–8`).

**Logging:** `logger.info({ payslipId, … }, "extraction finished")`. Structured fields, no document
contents, no service `message`, and nothing under keys the redactor would silently drop and leave
you confused about (`raw`, `bytes`, `content`, `file`).

**Imports:** `api/` is `nodenext`, so relative imports end in `.js`. Scripts run under `tsx`, which
resolves `.js` specifiers to the `.ts` sources, so a script may import
`../api/src/…/fields.ts` directly.

**Tests:** Vitest, co-located `*.test.ts`, no network in unit tests. Stub `fetch` with
`vi.stubGlobal("fetch", …)` and restore it in `afterEach`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Move the schema, extend types and config, and add the guard.

### Phase 2: Core

Build the mapper, the provider and the runner, each unit-tested in isolation.

### Phase 3: Integration

Add the repository methods and column list, the route wiring, the reaper, the provisioning script,
`render.yaml` and `.env.example`.

### Phase 4: Measurement and proof

Build scoring and the CLI, run the end-to-end golden run, score both sets, then update the docs and
write the history.

---

## STEP-BY-STEP TASKS

Execute in order. Run each step's validation before moving on.

### 1. MOVE the field schema into the provider module (D8)

- **CREATE** `api/src/providers/document-extraction/content-understanding/field-schema.ts` with
  the exact contents of `scripts/bakeoff/field-schema.ts`. Only the header comment changes: "single
  source of truth for the analyzer; the bake-off re-exports it".
- **UPDATE** `scripts/bakeoff/field-schema.ts` to
  `export * from "../../api/src/providers/document-extraction/content-understanding/field-schema.ts";`
  plus a one-line comment.
- **GOTCHA:** do not change one character of any description or `SHARED_RULES` (D8).
- **VALIDATE:** `npm run score -- cu` still prints `SCALAR FIELDS 281/284 98.9%`. The bake-off
  still imports through the re-export, and the score is untouched.

### 2. UPDATE `api/src/providers/document-extraction/types.ts`

- `ExtractionInput` gains `readonly signal: AbortSignal`.
- `ExtractionMetadata` gains `readonly submitAttempts?: number`.
- `ExtractionError` becomes `constructor(reason: ExtractionFailureReason, cause?: unknown)`, with
  `this.retryable = isRetryableFailure(reason)`. Import it from `@payslip/shared`.
- **VALIDATE:** `npm run typecheck`. No caller exists yet.

### 3. UPDATE `api/src/config.ts`, `api/vitest.config.ts`, `.env.example`, `render.yaml` (D1)

- `Config` gains:
  - `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY`,
    `AZURE_CU_ANALYZER_ID`, `AZURE_CU_API_VERSION`, via `readRequired`. Strip a trailing `/` from
    the endpoint.
  - `EXTRACTION_TIMEOUT_MS` (`readCount`, 120000) and `EXTRACTION_CONCURRENCY` (`readCount`, 3).
- `api/vitest.config.ts` env gains placeholders: `https://cu.invalid`, `test-key`,
  `testAnalyzer`, `2025-11-01`. `api/vitest.integration.config.ts` needs nothing: `config.ts`
  loads `.env`.
- `.env.example`:
  - move the four CU names from the "Bake-off harness" block into a new
    `# --- Extraction (server-only) ---` block, and add `EXTRACTION_TIMEOUT_MS=` and
    `EXTRACTION_CONCURRENCY=` with a defaults comment;
  - leave the DI and OpenAI names under the bake-off block.
  - **Names only**; validate.md 6.1b checks this.
- `render.yaml` API `envVars`:
  - the four CU keys as `sync: false`;
  - `EXTRACTION_TIMEOUT_MS: "120000"` and `EXTRACTION_CONCURRENCY: "3"`;
  - a comment pointing at H1.
- **VALIDATE:** `npm run typecheck && npx vitest run --project api`. Existing tests stay green with
  the placeholders.

### 4. CREATE `api/src/provider-vocabulary.test.ts` (D4)

- Mirror `shared/src/payslip.test.ts:151–168` over `api/src`, with the same regex.
- Allow-list, as path prefixes normalised to `/`:
  - `providers/document-extraction/content-understanding/`
  - `config.ts`
  - `provider-vocabulary.test.ts`
- Assert that the list of offenders is `[]`.
- **GOTCHA:** `readdirSync(..., { recursive: true })` returns `\`-separated paths on Windows.
  Normalise with `.replaceAll("\\", "/")` before prefix checks.
- **VALIDATE:** `npx vitest run --project api src/provider-vocabulary.test.ts` passes. Then create
  `api/src/services/probe.ts` containing `// valueString`, confirm the test fails, and **delete the
  probe**.

### 5. CREATE `content-understanding/analyzer.ts`

- `toCuField(def)` (ported from `run-cu.ts:24–43`).
- `buildAnalyzerDefinition(completionModel: string)` (ported from `run-cu.ts:45–61`), keeping the
  "must name the deployment explicitly" comment.
- Export `ANALYZER_DESCRIPTION` so the drift check compares the same string.
- **VALIDATE:** `npm run typecheck`.

### 6. CREATE `content-understanding/fields.ts` + `fields.test.ts` (D10)

- Export:
  ```ts
  export interface MappedExtraction {
    readonly fields: CanonicalPayslipFields;          // every canonical key present
    readonly fieldMetadata: Record<string, FieldMetadata>;
    readonly unreadableFields: string[];
    readonly hasText: boolean;                        // markdown non-blank
  }
  export function mapAnalyzeResult(operation: unknown): MappedExtraction | null; // null = shape unreadable
  ```
- One table of scalar field names to parser, and one table per line-item column to parser. Paths:
  `brutoPlaca`, `payComponents.2.iznos`.
- `canonicalPayslipFieldsSchema.parse` on the output.
- **Tests**, from small hand-built operation bodies rather than recordings (unit tests must not
  need git-ignored data):
  - `"2.298,97"` → `"2298.97"` with metadata confidence;
  - a missing `valueString` → `null`, with no metadata and not unreadable;
  - `"abc"` in `brutoPlaca` → `null` + `unreadableFields: ["brutoPlaca"]`;
  - `"svibanj 2025."` → `"2025-05"`; `"09.06.2025"` → `"2025-06-09"`;
  - `koeficijent "0,135"` → `"0.135"` via `parseQuantity`;
  - `brojRata "10/120"` stays text;
  - an absent `valueArray` → `[]`;
  - `currency` ignored;
  - a whitespace-only `valueString` → `null`, not unreadable;
  - an unreadable table cell path `obustave.0.iznos`;
  - a malformed body → `null`.
- **Also** a test gated with `it.skipIf(!existsSync(recordingsDir))` that maps every
  `.bakeoff/cu/*.json` and asserts the schema parses. This local-only check proves the mapper
  accepts real bodies.
- **VALIDATE:** `npx vitest run --project api src/providers/document-extraction/content-understanding/fields.test.ts`

### 7. CREATE `content-understanding/provider.ts` + `provider.test.ts` (D9, D12)

- `export class ContentUnderstandingProvider implements DocumentExtractionProvider`, constructed
  with `{ endpoint, key, analyzerId, apiVersion, pollIntervalMs = 1000 }`.
- `extract({ bytes, contentType, signal })`:
  1. `submitWithRetry`: `SUBMIT_TIMEOUT_MS = 5000` and `SUBMIT_TRIES = 4`, keeping the SUBMIT_STALL
     comment verbatim. Each attempt uses `signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])`.
     Distinguish the outer abort (`signal.aborted` → throw `provider_unavailable` immediately, no
     further attempt) from the per-attempt `TimeoutError` (retry). Count attempts.
  2. `poll(opUrl, signal)`: 1 s interval, abortable sleep, and D9 classification for non-2xx and
     `Failed`/`Canceled`. Capture `error.code` for the log, never `message`.
  3. `mapAnalyzeResult(body)`:
     - `null` → `provider_unavailable`;
     - `!hasText` or no non-null canonical field → `unreadable_document`.
  4. Return `{ fields, metadata, raw: body }`. The metadata is:
     ```
     { provider: "content-understanding", modelId: analyzerId, apiVersion,
       analyzedAt, latencyMs, uploadMs (submit), analyzeMs (poll),
       documentConfidence: null, fields: fieldMetadata, unreadableFields, submitAttempts }
     ```
- Wrap every `fetch` rejection (TypeError) as `provider_unavailable` with the `cause` kept.
- **Tests**, using a scripted `vi.stubGlobal("fetch", …)` queue of responses:
  - the happy path returns canonical fields and `submitAttempts: 1`;
  - one stalled submit (a promise that honours the abort signal) → retried, `submitAttempts: 2`;
  - four stalls → `provider_unavailable`, retryable;
  - submit 400 → `provider_rejected`, not retryable;
  - submit 503 and 429 → `provider_unavailable`;
  - submit 401 → `provider_unavailable`;
  - poll `Failed` → `provider_unavailable`;
  - a succeeded body with blank markdown → `unreadable_document`;
  - the outer signal aborted mid-poll → `provider_unavailable` promptly (use a short
    `pollIntervalMs` in tests);
  - the request carries `Ocp-Apim-Subscription-Key` and `Content-Type` = the input content type,
    and the URL ends `:analyzeBinary?api-version=…`.
- **GOTCHA:** use real timers with tiny intervals (`pollIntervalMs: 1`) rather than fake timers.
  `AbortSignal.timeout` does not follow Vitest fake timers.
- **VALIDATE:** `npx vitest run --project api src/providers/document-extraction/content-understanding/provider.test.ts`

### 8. CREATE `content-understanding/index.ts`

- `export function createDocumentExtractionProvider(): DocumentExtractionProvider`, building
  `ContentUnderstandingProvider` from `config`. No network at construction.
- **VALIDATE:** `npm run typecheck && npx vitest run --project api src/provider-vocabulary.test.ts`

### 9. UPDATE `api/src/repositories/payslips.ts` + tests (D2, D3, D11, D15)

- `const PAYSLIP_COLUMNS` lists every `payslips` column except `raw_provider_result`, as one string.
  Use it in `findDetailState`, `listBySession` and `listPage` (both calls), and in `update`'s
  `.select(...)`.
- `type PayslipReadRow = Omit<PayslipRow, "raw_provider_result">`. `mapPayslipRow` and
  `mapPayslipState` take it. Check that supabase-js infers the row type from the literal column
  string; if inference yields `GenericStringError`, the string has a typo.
- `PayslipDetailState` gains `unreadableFields: string[]`, parsed from `extraction_metadata` with
  `z.object({ unreadableFields: z.array(z.string()) }).loose().nullable()`. A null gives `[]`; a
  malformed value gives `invalid_data`.
- New methods, each owner-scoped, `deleted_at is null`, `status = 'processing'`, returning
  `boolean`:
  - `completeExtraction(id, { fields, metadata, raw })` sets `status 'review'`,
    `canonical_data`, `extraction_metadata`, `raw_provider_result`, `failure_reason null` and
    `updated_at`.
  - `failExtraction(id, reason)` sets `status 'failed'`, `failure_reason` and `updated_at`.
- `failStaleExtractions(cutoff: Date): Promise<number>`: an owner-scoped bulk update of
  `processing` rows with `updated_at < cutoff` to `failed` / `provider_unavailable`, returning a
  count via `.select("id")`.
- **Tests** (unit, mirror `payslips.test.ts`):
  - `mapPayslipRow` accepts a row without `raw_provider_result`;
  - `findDetailState`'s `unreadableFields` parsing: `null` → `[]`, a valid value, malformed →
    `invalid_data`.
  Query methods are proven by the integration runs (steps 16–17), as in Task 03.
- **VALIDATE:** `npx vitest run --project api src/repositories/payslips.test.ts && npm run typecheck`

### 10. CREATE `api/src/services/payslip-extraction.ts` + tests

- Export:
  ```ts
  export const STALE_EXTRACTION_MS = 15 * 60 * 1000; // > worst queue wait + EXTRACTION_TIMEOUT_MS (D3)
  export interface ExtractionJob {
    readonly payslipId: string;
    readonly repository: Pick<PayslipRepository, "completeExtraction" | "failExtraction">;
    readonly bytes: Buffer;
    readonly contentType: SourceContentType;
  }
  export interface ExtractionRunner { enqueue(job: ExtractionJob): Promise<void>; } // never rejects
  export function createExtractionRunner(deps: {
    provider: DocumentExtractionProvider; concurrency: number; timeoutMs: number;
  }): ExtractionRunner;
  ```
- A plain FIFO semaphore (~20 lines, no dependency). Per job:
  1. `provider.extract({ …, signal: AbortSignal.timeout(timeoutMs) })`.
  2. `repository.completeExtraction` / `failExtraction`.
  3. `false` → `logger.info(…, "extraction result discarded")`.
- An unexpected (non-`ExtractionError`) throw → `logger.error({ err, payslipId })` and
  `failExtraction(id, "provider_unavailable")`.
- A repository throw while recording → `logger.error`. The row is reaped later (D3).
- One `logger.info` per finish:
  ```
  { payslipId, outcome: "review"|"failed"|"discarded", reason?, retryable?, latencyMs?,
    uploadMs?, analyzeMs?, submitAttempts?, extractedFieldCount?, unreadableCount? }
  ```
  Never fields, bytes, raw or messages.
- **Tests** (stub provider and stub repository):
  - with concurrency 3 and 5 jobs, at most 3 `extract` calls are in flight at once (count with
    deferred promises);
  - FIFO order;
  - one job throwing `ExtractionError("unreadable_document")` → `failExtraction(id,
    "unreadable_document")`, while the other four `completeExtraction` (**sibling isolation**,
    DoD 4);
  - a generic `Error` → `provider_unavailable`;
  - `completeExtraction` returning `false` does not call `failExtraction`;
  - the provider receives an `AbortSignal`;
  - `enqueue` resolves even when the repository throws.
- **VALIDATE:** `npx vitest run --project api src/services/payslip-extraction.test.ts`

### 11. WIRE the runner into the app and the upload route

- `app.ts`: `AppOptions` gains `extraction?: ExtractionRunner`. The default is
  `createExtractionRunner({ provider: createDocumentExtractionProvider(), concurrency:
  config.EXTRACTION_CONCURRENCY, timeoutMs: config.EXTRACTION_TIMEOUT_MS })`.
- Pass it to `createSessionsRouter(extraction)`.
- `sessions.ts` upload: replace the line-83 comment with
  `void extraction.enqueue({ payslipId: payslip.id, repository, bytes: file.bytes, contentType: file.contentType });`
  where `repository` is the `PayslipRepository` already built for `create`. Hoist it into a
  `const`. A comment cites PRD §7.3 ("starts extraction immediately and returns 201 without
  waiting").
- **GOTCHA:** enqueue only after the row insert succeeded, never on the `catch` path.
- `payslips.integration.ts`: `createApp({ extraction: { enqueue: () => Promise.resolve() } })`,
  with a comment explaining why: the suite asserts `processing` and must never call Azure.
- **VALIDATE:** `npm run typecheck && npx vitest run --project api`

### 12. ADD the lazy reaper to the three read routes (D3)

- At the top of `GET /api/sessions/:id` (after the id parse), `GET /api/payslips/:id` and
  `GET /api/payslips`:
  `await repository.failStaleExtractions(new Date(Date.now() - STALE_EXTRACTION_MS));`
- `GET /api/payslips/:id`: `unreadableFields: state.unreadableFields`. Keep
  `lowConfidenceFields: []` with the comment "Task 06 owns the confidence threshold (D6)".
- **VALIDATE:** `npm run typecheck && npx vitest run --project api`

### 13. CREATE `scripts/provision-analyzer.ts` + the package script (D8)

- `"provision:analyzer": "tsx scripts/provision-analyzer.ts"`. Reads `.env` via
  `import "dotenv/config"`, like `common.ts`.
- **Steps:**
  1. `GET /contentunderstanding/defaults`. If `modelDeployments` lacks the completion deployment
     (`AZURE_OPENAI_DEPLOYMENT`, default `gpt-4.1`) or `text-embedding-3-large`, `PATCH` them in,
     merging with what exists and never dropping keys. Print what it did.
  2. `GET` the analyzer:
     - **404** → `PUT buildAnalyzerDefinition(...)` and poll `operation-location`;
     - **200** → compare `description` and `fieldSchema.fields` with the code using a sorted-key
       deep equality. Equal → print `analyzer '<id>' matches the code`, exit 0. Different → print
       the differing field names and exit 1, unless `--replace`, which deletes, recreates and
       prints the reminder that recordings are now stale and must be re-recorded (D8).
- **Never print the key.**
- **VALIDATE:** `npm run provision:analyzer` → prints the defaults present and
  `analyzer 'hrPayslipV1' matches the code`, exit 0. This is read-only against the live resource,
  per D8's verified state. **Do not pass `--replace`.**

### 14. CREATE `api/src/scoring/score.ts` + `score.test.ts` (D5)

- Pure functions over canonical data:
  ```ts
  export interface ScoringInput { sample: string; expected: Record<string, unknown>; actual: CanonicalPayslipFields; latencyMs: number | null }
  export interface SetReport { scalars: {hit,total}; critical: {hit,total}; tables: Record<Table, {rowsExact:{hit,total}; cells:{hit,total}}>;
    bakeoffComparable: {hit,total}; perField: Map<string,{hit,total}>; skipped: {sample, field, reason}[];
    latency: { p50, p90, max } | null; perSample: {...}[] }
  export class UnscoredExpectationError extends Error { readonly problems: string[] }
  export function scoreSet(inputs: ScoringInput[]): SetReport; // throws UnscoredExpectationError
  ```
- `FIXTURE_METADATA_KEYS`: `sample, sourceFile, layoutFamily, layoutName, sourceKind, pageCount,
  currency, unscorable, notes`. Check it against `shared/src/payslip.test.ts:10–20` and use the
  same list.
- A key missing from the expectation (`!(field in expected)`) → a problem. An unknown non-metadata
  key → a problem. An `unscorable` field not in the canonical keys → a problem. Collect **all**
  problems, then throw once.
- **Comparisons:**
  - decimals use `amountsEqual`, with `null`/`null` a hit and `null`/value a miss;
  - `period` and `paymentDate` use `===`;
  - text uses `strictTextKey` for the headline and `textKey` (ported from `score.ts:29–35`) for
    the bake-off-comparable line (D5);
  - table cells are positional; a missing actual row makes every cell of that expected row a miss;
    extra actual rows count only against `rowsExact`.
- **Tests:**
  - a perfect sample scores 25/25;
  - a key deleted from the expectation **throws** `UnscoredExpectationError` naming it;
  - an unknown key throws;
  - `unscorable` skips and lists the field;
  - `"100.50"` vs `"100.5"` is a hit;
  - `null` vs `"0.00"` is a miss (the README's distinction);
  - `"Janžek"` vs `"Janzek"` is a strict miss and a lenient hit; `"ANA  HORVAT"` vs `"Ana Horvat"`
    is a hit on both;
  - cell counting for a short actual table;
  - latency percentiles.
- **VALIDATE:** `npx vitest run --project api src/scoring/score.test.ts && npx vitest run --project api src/provider-vocabulary.test.ts`
  (`score.ts` must not import the provider module).

### 15. CREATE `scripts/score-extraction.ts` + the package script (D5)

- `"score:extraction": "tsx scripts/score-extraction.ts"`.
- **Discovery:** every subdirectory of `.bakeoff/` is a candidate set. It is a set when its files'
  parsed JSON has `result.contents` **and** `result.analyzerId === AZURE_CU_ANALYZER_ID` (D5). This
  skips `layout` and `llm` (not CU bodies) and `cu-mini` (a different analyzer). **Print each
  skipped directory by name with its reason**, so nothing is dropped silently. A directory mixing
  analyzers is a discovery problem, not a partial set.
- **Per set:**
  1. The recording names must equal the expectation names (`loadExpected()`); any difference →
     problem.
  2. `mapAnalyzeResult(recording)` → `actual`. A `null` return → problem.
  3. `scoreSet`.
- **Print**, per set:
  - the per-sample line: scalars, critical, and rows per table;
  - `SCALAR FIELDS h/t p% (target ≥ 95%)`, strict on diacritics;
  - `SCALAR FIELDS, bake-off-comparable (diacritic-insensitive) h/t p%`;
  - `CRITICAL FIELDS`;
  - `LINE ITEMS cells h/t p% (target ≥ 85%)`, with the per-table breakdown;
  - `BAKE-OFF COMPARABLE payComponents naziv+iznos h/t`;
  - skipped-as-unscorable with reasons;
  - latency p50/p90/max;
  - the top 12 wrong fields.
- **Then:** `RUN-TO-RUN spread across N sets: scalars ±x fields (x.x%); documented band ~0.5% —
  differences smaller than 1–2 fields are noise`. With one set, print that the spread is
  unmeasured.
- **Exit 1** on any `UnscoredExpectationError` or discovery problem, printing every problem; also
  when no set exists. Otherwise exit 0.
- **VALIDATE:**
  - `npm run score:extraction` scores set `cu`. Record the figures.
  - **Investigate before moving on** if the **bake-off-comparable** scalar line is more than 2
    instances below the bake-off's implied **271/273**. The strict line may sit lower; each
    strict-only miss is a diacritic misread and gets listed in the history file. The bake-off's 281/284 includes 11 `currency` instances, 10 of them hits
    (verified with `npm run score -- cu --verbose`); its two non-currency misses are
    `iznosZaIsplatu` (A04, occluded) and `employerName` (F01, the signatory). List each changed field
    instance and attribute it to parser strictness (for example the Task 02 D2 `1.200` case) or a
    mapper bug. Fix mapper bugs. Parser-strictness losses are recorded, not papered over (Task 02
    open item 3).
  - Missing-ground-truth probe, which must exit non-zero, then restore:
    `mv .agents/fixtures/expected/A01.json .scratch/A01.json; npm run score:extraction; code=$?; mv .scratch/A01.json .agents/fixtures/expected/A01.json; test $code -ne 0 && echo "PROBE OK"`
    `git status --short .agents/fixtures` must be clean afterwards.

### 16. EXTEND the integration runner and CREATE `api/src/routes/extraction.integration.ts` (D17)

- `scripts/run-supabase-integration-tests.mjs`: with `--extraction`, run
  `["src/routes/extraction.integration.ts"]` instead of the default two files, and refuse
  `--local`, because the golden run is hosted only. Add
  `"test:extraction": "node --env-file-if-exists=.env scripts/run-supabase-integration-tests.mjs --extraction"`.
- **The test**, mirroring `payslips.integration.ts` helpers:
  - a user `task04-<uuid>@example.test` and `createApp()` with the **real** runner;
  - it fails fast if `payslip_examples/` or any fixture's `sourceFile` is missing.
- Session 1 gets the first 10 fixtures by name. Session 2 gets G01 plus `blank.pdf` (one empty
  A4 page from `pdf-lib`).
- Poll `GET /api/sessions/:id` every 2 s until no payslip is `processing`, with a 6 min cap. The
  per-test timeout is 10 min.
- **Assert:**
  - all 11 fixtures reach `review`;
  - `blank.pdf` → `failed` with `failureReason: "unreadable_document"`, and G01 in the same session
    is `review` (sibling isolation against the real service);
  - each detail parses `payslipDetailResponseSchema`, and `pageCount` equals the fixture's;
  - `unreadableFields` is an array.
- **Record:** with the admin client, select `raw_provider_result, extraction_metadata` per payslip
  and write `.bakeoff/production/<sample>.json` = `{ latencyMs: metadata.latencyMs, ...raw }`.
  Log per sample `latencyMs` and `submitAttempts` to the console for the history file.
- **Cost line (D17):** sum every response's `usage` (CU pages, contextualization tokens, `gpt-4.1`
  input, cached input and output) and print `estimated run cost $x.xx` with the price assumptions.
  Count the payslips whose `submitAttempts > 1`, since each may have billed a duplicate analysis.
- **Cleanup** in `afterAll`, unconditional: remove the Storage sources and delete the user (rows
  cascade).
- **VALIDATE:**
  - `npm run test:extraction`: it prints the hosted host, then passes. About $0.30 and a few
    minutes.
  - Then `npm run score:extraction`: two sets, `cu` and `production`, with the spread printed.
  - Orphan check through the Supabase MCP `execute_sql`: no `auth.users` with email `task04-%`, and
    no `storage.objects` under their ids.

### 17. RUN the hosted integration suite

- **VALIDATE:** `npm run test:integration`. It prints the hosted host; 3/3 auth and 16/16 payslips
  pass with the no-op runner. Then run the same orphan check for `task03-%`.

### 18. UPDATE the documents (D1, D2, D3, D6, D7, D13, D14, D16)

- `ROADMAP.md`:
  - §2: Task 04 → ✅ with the history link.
  - §3 Task 04 scope: add "Render receives the CU configuration (D1)" and "stale `processing` rows
    fail lazily on read (D3)".
  - §3 Task 04 DoD: tick the items, and replace "enforced by the Task 02 guard test" with "enforced
    by the Task 02 guard (`shared`) and the Task 04 guard (`api`)".
  - §3 Task 13 scope: remove analyzer provisioning; the resource is shared (D1).
  - §3 Task 06 scope: add "compute grounding over the retained raw response (`pages[].words`)"
    (D6).
  - §3 Task 09 scope: add "decide server-side writes vs the direct-write gap (Task 03 open item 4,
    Task 04 D2)".
  - §5: add the direct-write gap row (owner: Task 09) and the in-memory queue row (D16). Update
    "Residual latency" with the production-path p50 from step 16.
- `docs/adr/0001-payslip-extraction-architecture.md`: "West Europe" → "Sweden Central" twice, plus a
  dated correction note (D7).
- `PRD.md` §9.4: one sentence saying `:analyzeBinary` processes in `global` by default and this
  prototype does not override it (D14).
- `.claude/commands/validate.md` (local, git-ignored):
  - Phase 4: rows for the new test files;
  - Phase 7: `npm run score:extraction` with its expected current figures, and
    `npm run provision:analyzer` as the drift check;
  - Phase 8: `test:extraction` as opt-in with its cost, run when extraction code changes.
- **VALIDATE:** `npm run format:check`. Markdown is ignored, but this catches YAML and TS.

### 19. RUN the full validation sweep

- **VALIDATE:** `npm run validate && npm run build && npm run check:golden && npm run score -- cu`.
  `score -- cu` must still print 281/284 (step 1's invariant).

### 20. WRITE `.agents/history/04-content-understanding-provider.md`

- Mirror `history/03`'s structure: what was built, decisions D1–D17, deviations (at least D13, D15,
  and D6 against Task 03 open item 1), validation tables, and open items.
- **Record:**
  - both sets' scores;
  - the spread;
  - production-path latency p50/p90/max and submit attempts per sample;
  - any observed CU operation error codes;
  - the D2 `1.200` outcome.

### Human step H1 — before the subtree push, not part of unattended execution

Agreed with the product owner on 2026-09-24: push in this task, after they set the secrets.
After `/code-review` and the commit (see the user's commit workflow), **ask the user to set the four
`AZURE_*` values on `payslip-ocr-api` in the Render dashboard.** Only then push:
`git subtree push --prefix=prototypes/payslip-ocr payslip-github main`. Afterwards:

- confirm the CI run is green;
- confirm the Render deploy is live;
- confirm `GET https://payslip-ocr-api.onrender.com/api/health` answers 200.

Record the result in the history file.

---

## TESTING STRATEGY

### Unit Tests (no network, no git-ignored data except the one `skipIf` recording test)

- **Mapper:** every parser assignment, unreadable detection, tables `[]`, metadata, a malformed
  body.
- **Provider:** submit retry and stall, every row of D9, the outer abort, request shape.
- **Runner:** the concurrency cap, FIFO, sibling isolation, the discarded write, never rejecting.
- **Repository:** the column-list mapping, `unreadableFields` parsing.
- **Scoring:** the loud failures (missing key, unknown key, bad `unscorable`), comparisons,
  percentiles.
- **Guard:** the vocabulary allow-list, proven by a probe.

### Integration Tests

- `test:integration` (every task): the existing 19 cases with the no-op runner. This proves the
  column-list change did not break reads and the reaper is harmless on fresh rows.
- `test:extraction` (opt-in, this task): the 11 golden payslips plus a blank PDF, end to end through
  hosted Supabase and Azure. Writes the `production` recording set.

### Edge Cases

- A payslip soft-deleted while its job runs: the conditional write returns `false` → "discarded",
  and the row stays deleted.
- A payslip reaped while its job is still queued: the later write is discarded, and the row stays
  `failed`/retryable.
- Submit stall on every attempt → `provider_unavailable`, never an unhandled rejection.
- A whole-analysis timeout during polling → `provider_unavailable`, with the abort honoured by the
  sleep.
- CU returns a table cell with text the parser rejects → the cell is `null` and the path is listed.
- A two-page PDF (A01, D01): one call covers every page (PRD §14 risk 7), and `pageCount` comes from
  the upload.
- A blank document → `unreadable_document`, siblings unaffected.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

```
npm run lint
npm run typecheck
npm run format:check
```

### Level 2: Unit Tests

```
npx vitest run --project api
npm test
```

### Level 3: Integration Tests

```
npm run test:integration      # hosted, 3 + 16, no Azure calls
npm run test:extraction       # hosted + Azure, opt-in, ~$0.30, max 3 runs without asking (D17)
```

### Level 4: Measurement

```
npm run provision:analyzer    # "matches the code", exit 0; never --replace in this task
npm run score:extraction      # both sets; ≥95% scalars, ≥85% cells; spread printed
npm run check:golden          # ALL IDENTITIES AND CHECKSUMS PASS
npm run score -- cu           # unchanged: SCALAR FIELDS 281/284 98.9%
```

Plus the missing-ground-truth probe from step 15, and the vocabulary probe from step 4.

### Level 5: Additional Validation

- Supabase MCP `execute_sql`: orphan checks (`task03-%`, `task04-%` users; their Storage objects).
- Supabase MCP `get_advisors` (security): only the known project-level
  `auth_leaked_password_protection`. No schema changed, but confirm.
- No browser journey: no UI changed. Task 07 is the first client-to-API call.

---

## ACCEPTANCE CRITERIA

The ROADMAP Task 04 DoD, with its wording made precise by D4 and D5:

- [ ] All 11 golden-set payslips extract end to end through the real API (`test:extraction`).
- [ ] `npm run score:extraction` reports ≥95% scalar fields and ≥85% line-item cells on every
      recording set, with the measured run-to-run spread printed beside it.
- [ ] Removing a fixture's ground truth, whether a file or a key, makes the harness exit non-zero
      (unit test + CLI probe).
- [ ] A payslip that fails extraction leaves its siblings unaffected and records a retryable or
      non-retryable reason (runner unit test + the blank PDF in `test:extraction`).
- [ ] Provider vocabulary appears in one `api/src` module only (plus `config.ts` env names),
      enforced by the new guard, and nowhere in `shared/src` (Task 02 guard).

Plus:

- [ ] Stale `processing` rows become `failed`/`provider_unavailable` on the next read after 15 min.
- [ ] List and detail reads never select `raw_provider_result`.
- [ ] `npm run provision:analyzer` confirms the deployed analyzer matches the code.
- [ ] `npm run validate` and `npm run build` are green; `score -- cu` is unchanged.
- [ ] ROADMAP, ADR-0001 and PRD §9.4 are updated; the history file is written.
- [ ] H1 is done with the user before the push; `/api/health` is 200 after the deploy.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–20 completed in order, each step's validation run once and passed
- [ ] Both probes (vocabulary, missing ground truth) bit, and the repository is clean afterwards
- [ ] Any score drop beyond 2 instances investigated and attributed before commit
- [ ] Orphan checks clean
- [ ] `/code-review` on the uncommitted work, findings fixed, recorded in the history file, then
      commit
- [ ] H1 confirmed with the user, then the subtree push, CI green, deploy live

---

## NOTES

- **Cost of validation.** `test:extraction` costs ~$0.30 per run against a ~$100 student credit; at most 3 paid runs without asking (D17). Run it once after step 16. Re-run
  it only if extraction code changes afterwards, not to re-confirm a pass.
- **Why the scoring denominator changes.** The bake-off scored 26 scalars including `currency`
  (284). The product scores 25 (273), because `currency` is envelope (Task 02 D3). The bake-off
  figure stays reproducible through `npm run score -- cu`.
- **What the recordings can and cannot prove.** Replaying `.bakeoff/cu` proves the *mapper*. Only
  `test:extraction` proves the *provider* and the *runner* against the real service. Its
  `production` set is also the first latency measurement on the product path, with the 1 s poll
  and the Node `fetch`. That makes it Task 05's baseline.
- **Risks carried forward:**
  - The submit stall (mitigated, not fixed).
  - The in-memory queue (D16).
  - The direct-write gap (D2, now owned by Task 09).
  - Operation failure codes undocumented (D9). Treat observed codes as evidence for tightening the
    classification later, not as a reason to guess now.
- **Confidence for one-pass success: 7/10.** The mapper, scoring and runner are well specified
  against verified data. The residual uncertainty is the real service:
  - how long the blank PDF takes, and whether CU really returns blank markdown for it;
  - whether PostgREST accepts A01's ~1 MB update body in one write;
  - the first production latency figures.
  All three surface in step 16, which is why it runs before the documentation steps.
