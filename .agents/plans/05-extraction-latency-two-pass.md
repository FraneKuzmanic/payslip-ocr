# Feature: Task 05 — Extraction latency: two-pass extraction

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 05](../ROADMAP.md) · **Spec:**
[`specs/two-pass-extraction.md`](../specs/two-pass-extraction.md) · **PRD:** §6.3, §6.6, §7.3,
§7.4, §7.12, §10.4, §10.5, §11.4, Appendix B · **Baseline:**
[`history/04`](../history/04-content-understanding-provider.md) "Latency on the product path" ·
**Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md)
(this project has no `CLAUDE.md`)

## Feature Description

Today one Content Understanding analysis returns all 26 scalars and the three line-item tables
together. The user waits for the whole analysis. That wait is dominated by the tables, because
latency is roughly a ~4 s OCR floor plus output tokens at ~146 tok/s, and the tables carry most of
the output tokens.

This task splits extraction into two **extraction passes** over the same document:

- the **scalars pass** returns the 26 scalar fields;
- the **tables pass** returns `payComponents`, `obustave` and `neoporeziviPrimici`.

Both passes are submitted as soon as the upload is accepted. Each one writes its own fields to the
payslip atomically, in whichever order they finish. The payslip becomes `review` when its
**scalars** land, and it carries a new `tablesStatus` (`pending` → `ready` | `failed`) that tells
the review screen (Task 09) whether the line-item sections are still loading.

The task also measures the result on the product path, one payslip at a time, and re-scores
accuracy against the golden set.

## User Story

As a payslip holder who has just photographed my payslip
I want the form to appear with its headline figures within about ten seconds
So that I can start checking while the detailed tables are still being read (PRD US-01, §11.4)

## Problem Statement

- Single-pass latency on the product path (Task 04 run 3, three analyses in flight) is **p50 20.5 s,
  p90 45.7 s, max 66.3 s**. Sequentially, the bake-off measured **p50 13.4 s**. The target is
  ≤10 s to the first usable form (PRD §11.4).
- The output tokens that dominate latency come mostly from the tables. A01 has 43 rows and 4,518
  output tokens; G01 has 3 rows and 534.
- The API has no way to hand a client part of a result. The payslip state machine has no state
  for "scalars ready, tables still coming" or "tables failed".

## Solution Statement

- **Two analyzers**, partitioned from the existing field schema with the descriptions verbatim:
  `<base>_scalars` and `<base>_tables`, where `<base>` is `AZURE_CU_ANALYZER_ID`.
- **The provider** takes a `pass` and analyses with that pass's analyzer. **The mapper** maps only
  that pass's canonical keys.
- **The runner** queues passes rather than payslips. The cap still counts concurrent analyses.
  A scalars pass is always dequeued before any tables pass. The tables pass is cancelled when its
  scalars pass fails, and each pass records its queue wait.
- **Persistence:** a new `tables_status` column, plus a SQL function
  `complete_extraction_pass` that merges one pass's fields, metadata and raw body atomically
  (`jsonb ||`). The passes can then finish in either order, and neither overwrites the other or a
  user's edit.
- **Contracts:** `tablesStatus` on `payslipSchema`, and so on the session summary, the detail
  response and the export.
- **Harness:** `score:extraction` learns two-pass recording sets. It reports first-form and
  complete-extraction percentiles, and gives the run-to-run spread per kind of set plus a
  two-pass-versus-single-pass delta.
- **Golden run:** gains a sequential mode and a named recording set, so the baseline and the
  two-pass runs are each recorded without overwriting another.

## Feature Metadata

**Feature Type**: Enhancement (changes the API shape and the payslip state model)
**Estimated Complexity**: High. It touches the migration, the provider, the runner, the
repository, shared contracts, the harness and paid measurement.
**Primary Systems Affected**: `api/src/providers/document-extraction/`, `api/src/services/`,
`api/src/repositories/`, `api/src/routes/`, `shared/src/`, `supabase/migrations/`, `scripts/`
**Dependencies**: no new packages. Azure Content Understanding `2025-11-01` (two new analyzers)
and the hosted Supabase project (one migration).

---

## DESIGN DECISIONS

These settle every concern raised at priming. D2, D3 and D6's confirm rule were decided by the
product owner on 2026-09-24. The rest are recommendations this task implements.

### D1 — Content Understanding cannot return partial results, so the extraction is split (spec open question 1)

Checked 2026-09-24 against the `2025-11-01` GA reference for `:analyzeBinary` and the
`2026-06-01-preview` release notes:

- The operation status is `NotStarted | Running | Succeeded | Failed | Canceled`.
- `result` is populated only on success.
- There is no streaming, partial-field or incremental option. The only optional parameters are
  `processingLocation`, `range` (a page range) and `stringEncoding`.
- The preview adds agentic mode and synchronous Read/Layout only.

The spec's fallback, two analyzers run concurrently, is therefore the design. The spec's cheaper
variant, fetching tables on demand, is **not** taken:

- Tables are part of what the user reviews.
- On-demand would make export depend on a UI action.
- ROADMAP Task 05 says "run concurrently".

### D2 — What "p50 ≤10 s to first usable form" means (product owner)

- **Condition:** one payslip at a time, as PRD §11.4 states it ("single payslip … warm"). The
  golden run's sequential mode uploads one sample, waits for it to settle, then the next.
- **Clock:** from the moment the API has accepted the upload and enqueued the extraction, until
  the scalars pass is recorded. Per sample that is `firstFormMs = scalars.queuedMs +
  scalars.latencyMs`. It includes queue wait and the submit upload to Azure.
- **Excluded:** the client → API → Storage upload, which Task 07's "review route within 3 s" owns.
- **Also reported, not gated:** the all-at-once run (R3), against PRD §11.4's "four payslips in
  parallel (cap 3) ≤25 s" line.
- **Per document, not per page.** §11.4 says "per page". A01 and D01 have two pages, so
  per-document is the stricter reading. The per-page figure is reported alongside.
- `uploadMs` is reported separately. The development machine's uplink takes about 8 s to send
  B02's 3.6 MB (Task 04 deviation 2), and two passes send it twice. A B02 miss caused by the
  uplink is recorded as such, not hidden. p50 over 11 samples is robust to one outlier.

### D3 — Paid-run budget: up to five runs (product owner)

| Run | Code | Mode | Records to | Est. cost |
| --- | --- | --- | --- | --- |
| R1 | today's single-pass | sequential | `.bakeoff/production-sequential/` | ~$0.30 |
| R2 | two-pass | sequential | `.bakeoff/two-pass-sequential/` | ~$0.42 |
| R3 | two-pass | concurrent (all 11 at once) | `.bakeoff/two-pass-concurrent/` | ~$0.42 |
| R4, R5 | reserve | as needed | a new set name | ~$0.42 each |

- Estimated total: ~$1.15 for R1–R3, and at most ~$2 with the reserve.
- **Ask before a sixth run.**
- Every run, its measured cost and a running total go into `history/05`.
- The two-pass estimate comes from the `cu` set's own `usage`: $0.273 for 11 documents. Two passes
  add 13 more pages (+$0.065), 13,000 more contextualization tokens (+$0.013) and roughly 121K more
  cached input (+$0.061). Output tokens split rather than double. That is about **$0.41 per 11
  documents, ~1.5× per document** (spec estimate: 1.6×).

R1 exists because ROADMAP Task 05 asks for a single-document baseline **on the product path**.
The bake-off's sequential 13.4 s came from a different script with a different submit budget. R1
also gives a third single-pass set, which tightens the run-to-run band that D12's accuracy check
compares against.

### D4 — The deployment's token quota is not the cause of the concurrency slowdown (priming concern 1)

Read on 2026-09-24 from the gpt-4.1 deployment's own response headers, using a one-token chat
completion (~$0.00002) against the same Foundry resource. No portal or Azure CLI was needed.

- `x-ratelimit-limit-tokens: 500000`, `x-ratelimit-limit-requests: 500`, per 60 s.
- `x-ms-region: Sweden Central`, `x-ms-served-model: gpt-4.1-2025-04-14`,
  `x-ms-is-spilled-over: false`.

Task 04 run 3 moved about 125K input and 17K output tokens in roughly 95 s, so it peaked at about
90K TPM. That is under a fifth of the quota. **Throttling does not explain A01 taking 66 s with
three analyses in flight against 22 s alone.** History/04 attributed it to "one deployment's
generation throughput". That is plausible but unproven: a pay-as-you-go deployment does not
normally slow each request because three are concurrent, and the cause may be inside CU instead.
It stays **unexplained**, and this task does not guess at it.

What this means for the design:

- A single payslip now runs **two** analyses at once. If concurrency itself costs latency, the
  scalars pass pays for it. R1 (sequential single-pass) against run 3 (concurrent single-pass)
  measures that penalty. R2 then measures the first form under the real two-pass condition.
- **Decision gate after R2** (step 16): if first-form p50 is >10 s, stop and report the numbers.
  Include the scalars pass's `analyzeMs` against R1's. Do not tune blindly. The runner already
  has the one control that matters, D8's cap: `EXTRACTION_CONCURRENCY=1` serialises the passes
  (scalars first), which trades time-to-complete for time-to-first-form. Whether to use it is a
  measured decision for the product owner, not the executor's.

### D5 — Two analyzers partitioned from one schema, derived IDs, no new environment variable

- **Partition:** `PAYSLIP_FIELDS` entries with `type === "array"` go to the tables analyzer, and
  everything else to the scalars analyzer. That includes `currency`, which the mapper ignores
  just as it does today. **Descriptions and `SHARED_RULES` are unchanged** (Task 04 D8), so the
  re-score isolates the effect of the split.
- **The G01 decimal-separator fix (history/04 open item 6) does not ride along.** Changing a
  description in the same run as the split would make a regression unattributable.
- **`ukupnoSati` belongs to the scalars pass** (spec open question 3). It is a scalar printed on
  the bruto line. Its cross-check against `payComponents` is Task 06's, and runs once the tables
  are `ready` (D11).
- **Analyzer IDs** are derived in the provider module: `analyzerIdFor(base, pass)` →
  `` `${base}_${pass}` ``, giving `hrPayslipV1_scalars` and `hrPayslipV1_tables`. Underscore, not
  period, so the `:analyzeBinary` path segment stays unambiguous.
  - `AZURE_CU_ANALYZER_ID` keeps its name and now names the analyzer **family**.
  - No new variable means no Render dashboard step (Task 13 records that `sync: false` variables
    added later must be set by hand).
- **The single-pass analyzer `hrPayslipV1` stays deployed and untouched.** The product no longer
  calls it, but the `cu`, `production` and R1 recordings came from it, and they are the baseline
  every two-pass figure is compared against. `provision:analyzer` stops managing it.

### D6 — `tablesStatus` is its own field, not new payslip statuses (priming concern 5, spec open question 4)

`PAYSLIP_STATUSES` stays `processing | review | confirmed | failed`: the user-facing lifecycle
that governs editing, confirming and retrying. A new closed enum, `TABLES_STATUSES = pending |
ready | failed`, records whether the line-item tables have landed.

- **Why not extra statuses:** every lifecycle state would need a with-tables and a without-tables
  twin (`review` × pending, `confirmed` × failed, …). The PATCH, confirm and retry rules would
  have to learn them all. The two questions are independent: "may the user act on this payslip?"
  and "have its tables arrived?".
- **Rows:** a new payslip starts `status = processing`, `tables_status = pending` (column default).
  - Scalars recorded → `status = review`.
  - Tables recorded → `tables_status = ready`.
  - Tables failed or cancelled → `tables_status = failed`.
- **"Tables failed but scalars succeeded"** is `status = review, tablesStatus = failed`. It is its
  own state, distinct from `failed`, as the roadmap requires.
- **Confirm is refused while `tablesStatus` is `pending`** (product owner). It is allowed once the
  status is `ready` or `failed`. Task 09 builds confirm and enforces this rule; this task records
  it in PRD §10.7 and ROADMAP Task 09. Export requires `confirmed` (PRD §7.11), so **export is
  blocked until both passes have settled by the same rule**. `tablesStatus` is also part of
  `payslipSchema`, so every JSON export states it explicitly. That satisfies the roadmap DoD's
  export item.
- **Also for Task 09:** table fields are not editable while `tablesStatus` is `pending`.
  `complete_extraction_pass` writes the tables only while they are still `pending`, so a later
  edit is never overwritten. An edit made *before* they land would be, which is why editing waits.
- **`session.ts` comment:** the note that "Task 05 extends them with a tables-pending state" is
  updated to point at `TABLES_STATUSES`.
- **Copy:** Task 07 and Task 09 get hr/en copy for `TABLES_STATUSES`. This task adds no
  user-facing string.

### D7 — One atomic SQL function writes each pass (why not two `update`s from Node)

The two passes finish in either order, and from Task 09 on the user edits scalars while the tables
pass is still running. A read-modify-write of `canonical_data` from Node would lose one side.
PostgREST's `update` cannot express `canonical_data || $1`. So a migration adds:

```sql
create function public.complete_extraction_pass(
  p_payslip_id uuid, p_pass text, p_fields jsonb, p_metadata jsonb, p_raw jsonb
) returns boolean
language plpgsql
security invoker        -- runs under the uploading user's RLS (Task 04 D2)
set search_path = ''
```

- **scalars:** merges `p_fields` into `canonical_data` and sets `status = 'review'`,
  `failure_reason = null`, where `status = 'processing'`.
- **tables:** merges `p_fields` and sets `tables_status = 'ready'`, where
  `tables_status = 'pending' and status <> 'failed'`.
- **both:** filter `id = p_payslip_id and user_id = (select auth.uid()) and deleted_at is null`.
  They set `extraction_metadata = coalesce(extraction_metadata, '{}') ||
  jsonb_build_object(p_pass, p_metadata)` and the same for `raw_provider_result`, and bump
  `updated_at`. They return `row_count = 1`: false means discarded, the same contract as today's
  `#updateProcessing`.
- **An unknown `p_pass` raises.**
- **Grants:** `revoke execute … from public, anon`; `grant execute … to authenticated`. It widens
  nothing: the caller can already update these columns directly (the direct-write gap, ROADMAP §5,
  Task 09's to close).

`jsonb ||` merges top-level keys, so **each pass's `p_fields` must hold only that pass's keys**.
If the scalars object carried `payComponents: []`, it would erase tables that landed first. The
mapper guarantees this (step 5), and a hosted integration test proves the either-order merge
(step 12).

**New stored shapes.** Tasks 06 and 08 read these; ROADMAP notes are updated:

- `extraction_metadata = { scalars?: ExtractionMetadata, tables?: ExtractionMetadata }`
- `raw_provider_result = { scalars?: <operation body>, tables?: <operation body> }`

Both passes OCR the same document, so Task 06's grounding over `pages[].words` can read either
body; the scalars one is present whenever the payslip is in `review`. Task 08 projects regions
from both bodies, whose field paths are disjoint.

**Existing rows:** hosted `payslips` held 0 rows after Task 04's cleanup. Step 1 re-checks this.
If rows exist, they are integration leftovers and are deleted, with the count recorded. That is
better than writing a reader for a shape the product never stores again.

### D8 — The runner queues passes; the cap counts analyses; scalars go first

- `enqueue(job)` puts **two** tasks on one semaphore. It resolves when both are recorded, and
  never rejects, as today.
- **The cap keeps its meaning**: PRD §4.3 and §7.3 say "capped at three concurrent analyses", and a
  pass is one analysis. The default stays 3, so a lone payslip runs both passes at once. No
  `render.yaml` change.
- **Priority:** the semaphore holds two FIFO waiting lists and hands a released slot to a waiting
  scalars pass before any tables pass. With four payslips uploaded together, all four forms
  appear before the last tables start. That is the product goal (first form), at the cost of
  later tables.
- **Cancellation:** each job owns an `AbortController` for its tables pass. When the scalars pass
  fails (any reason, including queue expiry), the tables pass is aborted.
  - If it is still queued, it never calls the provider. That saves a billed analysis.
  - If it is running, polling stops.
  - Either way it records `tables_status = failed` and logs `outcome: "cancelled"`.
- **`queuedMs`** (enqueue → provider call) is measured by the runner and merged into that pass's
  metadata before the write. Task 04 recorded no queue wait (history/04: "`latencyMs` also
  excludes queue wait").
- **The queue-expiry guard** (`queuedMs + timeoutMs > STALE_EXTRACTION_MS`) applies per pass,
  unchanged.
- **Timeout:** `EXTRACTION_TIMEOUT_MS` (120 s) applies per pass.

### D9 — Failure semantics per pass

- **Scalars pass:** exactly today's rules. No markdown text, or no scalar value at all, is
  `unreadable_document`. Any failure writes `status = failed` with the reason. The payslip is
  failed, and retrying (PRD §10.8, a later task) re-runs both passes.
- **Tables pass:** no markdown text is `unreadable_document`. **Three empty tables are not a
  failure**: G01 genuinely prints no pay components, and empty tables are a valid result. Any
  failure writes `tables_status = failed` only, and the reason is logged, not stored.
  - **Not built:** a tables-only retry, or a stored tables failure reason. Neither is specified
    anywhere; it is recorded as an open item for Task 09.
- **`failExtraction`** (scalars) does not touch `tables_status`. The cancelled tables pass records
  its own outcome, so every pass finishes by recording something.

### D10 — The stale reaper also fails pending tables

`failStaleExtractions(cutoff)` gains a second update:

```
tables_status = 'failed' where tables_status = 'pending' and updated_at < cutoff and deleted_at is null
```

It runs after the existing `processing` update, whose rows get `tables_status = failed` too.

- **Why `updated_at`:** it mirrors Task 04 D3. A user edit during the pending window (Task 09)
  bumps `updated_at` and only delays the reap; it can never cause a false one.
- **Return value:** the sum of both counts.

### D11 — Warnings recompute when the second pass lands: Task 06's scope, amended now

No warnings engine exists yet (Task 06), so there is nothing to recompute and no hook is built
here. That would be speculative code. Instead, ROADMAP Task 06 is amended in step 18:

- compute warnings on **each pass's completion** and on every PATCH;
- `pay_components_sum_mismatch` is evaluated only when `tablesStatus = ready`;
- metadata and raw are read in D7's per-pass shape.

### D12 — Harness: two-pass sets, first-form percentiles, spread per kind (priming concern 6)

`score:extraction` recognises two kinds of recording set by body shape:

- **single-pass:** today's CU operation body, from analyzer `<base>`;
- **two-pass:** `{ timings, scalars: <body>, tables: <body> }`, from `<base>_scalars` and
  `<base>_tables`.

Each set is still all-or-nothing and fails loudly (Task 04 D5).

- **Mapping:** a two-pass sample's canonical fields are the scalars body mapped with `"scalars"`
  plus the tables body mapped with `"tables"`, through the real production mapper.
- **Latency:** a single-pass set prints `LATENCY` as today. A two-pass set prints `FIRST FORM
  p50/p90/max` (`scalars.queuedMs + scalars.latencyMs`), `COMPLETE p50/p90/max` (the later pass's
  `queuedMs + latencyMs`), and `FIRST FORM PER PAGE p50`.
- **Spread** is computed **within** each kind. Mixing kinds would report the split's effect as
  noise, the same mistake Task 04 concern 1 prevented for `cu-mini`.
- **A new line**, `TWO-PASS vs SINGLE-PASS`, gives each two-pass set's scalar and line-item-cell
  hits against the single-pass range. It is informational; the harness still gates only on "could
  not measure".
- **The DoD accuracy check:** every two-pass set's scalar hits are ≥ (the lowest single-pass set)
  − 1 field. The documented band is ~0.5% (1.4 of 273 fields).
- **Line-item cells are not in the DoD, but they are watched.** A drop below the single-pass range
  by more than the single-pass spread is **investigated before commit**, not parked.

### D13 — The golden run gets a mode and a named set

`extraction.integration.ts` reads two environment variables:

- **`GOLDEN_MODE`**: `sequential` or `concurrent`, default `concurrent`, today's behaviour.
  Sequential uploads one fixture, settles it, then the next.
- **`GOLDEN_SET`**, required: the `.bakeoff/<name>/` directory to record into. The run **refuses to
  start if that directory already exists**, so a paid run can never overwrite a baseline (`cu`,
  `production` or R1).

**Settled** now means `status !== "processing"` and `tablesStatus !== "pending"`. Two-pass
recordings are written in D12's shape, with per-pass timings next to the bodies. The report prints
per-sample first-form and complete times, per-pass upload, analysis and attempts, and the
estimated cost over both bodies.

- **Timeouts:** the test timeout becomes 20 min in sequential mode, and each poll cap applies per
  sample.
- **Scope:** the blank-page check (`unreadable_document`) runs in both modes. Its sibling must be
  unaffected in concurrent mode only.

### D14 — What stays out

- **The skeleton UI** (Task 09).
- **Any client change.** Task 07 is the first client-to-API call.
- **Tables-only retry** (D9).
- **Changing the completion model**, measured and rejected (locked decision 11).
- **Trimming the schema** (spec "Not doing").
- **An Azure support ticket for the submit stall.** It is still worth raising, but it is not code.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `api/src/providers/document-extraction/types.ts` (whole file, 54 lines). `ExtractionInput`,
  `ExtractionMetadata`, `ProviderExtractionResult` and `ExtractionError` (retryability derived
  from reason).
- `api/src/providers/document-extraction/content-understanding/provider.ts`:
  - lines 75–115: `extract()`, including the unreadable rule at 92–96;
  - lines 117–179: submit with the stall budget, `url` built from `analyzerId` at 124–125;
  - lines 181–222: polling.
- `…/content-understanding/fields.ts`:
  - lines 26–72: `SCALAR_PARSERS` and `TABLE_PARSERS`, already the pass partition;
  - lines 117–161: `mapAnalyzeResult`. It writes **every** canonical key today, with tables
    defaulting to `[]`. That must change per D7.
- `…/content-understanding/analyzer.ts` (whole file). `toCuField` and `buildAnalyzerDefinition`
  (`fieldSchema.fields` is built from all of `PAYSLIP_FIELDS`).
- `…/content-understanding/field-schema.ts` lines 14–171. `FieldDef.type === "array"` marks the
  three tables. Descriptions are **not** to be edited (D5).
- `…/content-understanding/index.ts` (whole file). It builds the provider from `config`.
- `…/content-understanding/usage.ts`. `estimateUsageCost(responses)` already sums any list of
  bodies; pass both passes' bodies.
- `api/src/services/payslip-extraction.ts`:
  - lines 20–40: `ExtractionJob`, `ExtractionRunner`;
  - lines 42–56: `createExtractionRunner`;
  - lines 58–133: `run`, with the logging pattern and the discard semantics;
  - lines 136–156: `createSemaphore`, to be extended with priority.
- `api/src/services/payslip-extraction.test.ts`. Gate-based concurrency tests with `deferred()`,
  a stub provider and fake repositories. Mirror them.
- `api/src/repositories/payslips.ts`:
  - line 27: `PAYSLIP_COLUMNS`, which must list `tables_status`;
  - line 34: `extractionMetadataSchema`, now per pass;
  - line 130: `findDetailState`;
  - line 240: `completeExtraction`, replaced;
  - line 250: `failExtraction`;
  - line 259: `failStaleExtractions`;
  - line 277: `#updateProcessing`;
  - line 298: `mapPayslipRow`.
- `api/src/repositories/payslips.test.ts`. The `payslipRow()` factory at lines 13–40 gains
  `tables_status`.
- `api/src/routes/sessions.ts` lines 85–100 (enqueue) and 105–133 (session detail summary);
  `api/src/routes/payslips.ts` lines 69–93 (detail).
- `api/src/app.ts` lines 28–40. Runner wiring; unchanged except the provider factory.
- `api/src/routes/extraction.integration.ts` (whole file). The golden run, D13.
- `api/src/routes/payslips.integration.ts`. The hosted suite pattern for new SQL-function tests:
  users created with the secret key, cleanup in `afterAll`.
- `api/src/provider-vocabulary.test.ts` line 22. **The word `analyzer` is banned** in `api/src`
  outside the provider module. The runner, repository and migration-facing code say "pass", never
  "analyzer".
- `api/src/scoring/score.ts`:
  - line 25: `TABLES`;
  - lines 66–95: `ScoringInput` and `SetReport`;
  - line 108: `scoreSet`;
  - line 278: `percentiles`.
- `scripts/score-extraction.ts`:
  - line 67: `discoverSets`;
  - line 96: `loadSet`;
  - line 126: `printSet`;
  - line 193: `printSpread`.
- `scripts/provision-analyzer.ts` (whole file). Loop its create and drift check over both pass
  analyzers.
- `shared/src/session.ts` lines 18–24 (statuses and the comment to update), 26–35 (transitions,
  unchanged).
- `shared/src/payslip.ts` lines 150–165 (`payslipSchema` envelope). `tablesStatus` goes here.
- `shared/src/api.ts`:
  - `payslipSummarySchema` (≈ line 96) picks `tablesStatus`;
  - `payslipDetailResponseSchema` inherits it;
  - `exportedPayslipSchema` inherits it, deliberately (D6).
- `supabase/migrations/20260924100541_create_sessions_and_payslips.sql`. Constraint naming
  (`payslips_*_valid`), the grant style, and the function style: `set search_path = ''` plus an
  explicit revoke (lines 153–171).
- `api/src/database.types.ts`. Regenerated through the Supabase MCP (`generate_typescript_types`),
  as Task 03 did. `Functions` is empty today (line 128).
- `.agents/history/04-content-understanding-provider.md`: "Latency on the product path" and
  deviations 2 and 5.

### Recorded evidence this plan relies on (verified 2026-09-24)

Per-sample `.bakeoff/cu` (single-pass, sequential): latency, output tokens, and rows
(pay/obustave/neoporezivi):

| A01 | A02 | A03 | A04 | B01 | B02 | C01 | D01 | E01 | F01 | G01 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 22.4 s · 4518 · 23/18/2 | 22.5 · 1921 · 15/2/1 | 9.4 · 1039 · 5/0/0 | 16.3 · 2738 · 21/5/1 | 13.4 · 823 · 3/0/2 | 26.3 · 1107 · 6/1/2 | 17.6 · 1056 · 5/1/1 | 9.7 · 1088 · 5/0/3 | 8.1 · 678 · 2/0/2 | 13.0 · 1115 · 6/0/3 | 7.7 · 534 · 0/1/2 |

- Inputs are ~9–15K tokens per analysis, ≥98% cached.
- `.bakeoff/production` (run 3) holds `latencyMs` only. It **lacks `uploadMs`/`analyzeMs`/
  `submitAttempts`**, because it predates Task 04 deviation 5. That is why R1 is needed for a
  split baseline.

### New Files to Create

- `supabase/migrations/<version>_two_pass_extraction.sql`: `tables_status`, the backfill, and
  `complete_extraction_pass` (D6, D7). The local file is renamed to the version `apply_migration`
  records (Task 03 D6).
- `.agents/history/05-extraction-latency-two-pass.md`: the completion record.

No new source module. The runner, provider, mapper and harness are extended in place.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Content Analyzers — Analyze Binary (2025-11-01)](https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/analyze-binary?view=rest-contentunderstanding-2025-11-01).
  The operation states and the absence of partial results (D1); the analyzer ID pattern
  `^[a-zA-Z0-9._-]{1,64}$` (D5).
- [Content Understanding service limits](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits).
  1,000 pages/min and 3,000 operations/min per S0 resource, far above this use. Descriptions are
  ≤1,024 characters.
- [PostgreSQL jsonb operators](https://www.postgresql.org/docs/current/functions-json.html#FUNCTIONS-JSONB-OP-TABLE).
  `jsonb || jsonb` concatenates objects with top-level keys replaced. That is the merge D7 relies
  on.
- [Supabase: database functions and `rpc()`](https://supabase.com/docs/reference/javascript/rpc).
  How supabase-js calls a function; it runs with the caller's JWT, so RLS applies under
  `security invoker`.
- [PostgreSQL `GET DIAGNOSTICS … ROW_COUNT`](https://www.postgresql.org/docs/current/plpgsql-statements.html#PLPGSQL-STATEMENTS-DIAGNOSTICS).

### Patterns to Follow

**Discarded-write contract** (`payslips.ts` `#updateProcessing`): a write that matches no row
returns `false`, and the runner logs `outcome: "discarded"`. The SQL function returns the same
boolean.

**Logging** (`payslip-extraction.ts` lines 88–121): one structured line per finish, never document
contents. Extend it with `pass` and `queuedMs`:

```ts
logger.info(
  { payslipId, pass, outcome, queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts,
    extractedFieldCount, unreadableCount },
  recorded ? "extraction pass finished" : "extraction pass result discarded",
);
```

**Error classification:** only `ExtractionError` reasons are recorded. Anything else becomes
`provider_unavailable` and is logged as `"extraction threw unexpectedly"`
(`payslip-extraction.ts` lines 76–82). Keep this per pass.

**Migration style:** named check constraints, `set search_path = ''` on functions, an explicit
`revoke execute … from public, anon` before `grant … to authenticated`, and comments explaining
*why*.

**Response contracts:** response schemas `.strip()`, request schemas `.strict()` (`shared/src/api.ts`
lines 5–29). `tablesStatus` is additive, so an older bundle ignores it.

**Imports:** `api/` and `shared/` use relative imports with `.js` (nodenext). Scripts import `api`
sources with `.ts`, as `scripts/score-extraction.ts` lines 18–26 do.

**Money:** untouched. Nothing here does arithmetic.

---

## IMPLEMENTATION PLAN

### Phase 0: Baseline (before any product change)

Add D13's mode and named set to the golden run on today's single-pass code and run **R1**. It
gives the sequential product-path baseline with the upload/analysis split, and a third
single-pass set.

### Phase 1: Foundation

The migration and generated types; shared contracts (`TABLES_STATUSES`, `tablesStatus`); the
provider types (`ExtractionPass`, `queuedMs`).

### Phase 2: Core

The analyzer split and provisioning; the provider and mapper per pass; the priority runner with
cancellation; repository writes through the SQL function; the reaper.

### Phase 3: Integration

The routes expose `tablesStatus`. Hosted integration tests cover the SQL function's either-order
merge, ownership and discard rules.

### Phase 4: Measurement and proof

The harness learns two-pass sets. Provision both analyzers, then run **R2** (the gate) and **R3**.
Score, record costs, update the documents, run the full validation, write history.

---

## STEP-BY-STEP TASKS

Execute in order. Each step ends green before the next begins.

### 1. VERIFY the starting state

- **IMPLEMENT**:
  - `git status` is clean on `prototype/payslip-ocr`.
  - `npm run validate` is green: 474 tests.
  - `npm run score:extraction` prints `cu` and `production` at 270/273 and 271/273, and exits 0.
  - `npm run provision:analyzer` reports `hrPayslipV1` matches the code.
  - With the Supabase MCP `execute_sql`, run `select count(*) from public.payslips` on the hosted
    project (`hxksulbgluvfxfoxrhse`). If it is non-zero, list them (`id, user_id, status,
    created_at`). Rows belonging to `task0N-*@example.test` users are leftovers: delete those
    users with the admin API and record the count. **Stop and ask about any other row.**
- **VALIDATE**: `npm run validate && npm run score:extraction`

### 2. UPDATE `api/src/routes/extraction.integration.ts` + `scripts/run-supabase-integration-tests.mjs`: the mode and the named set (D13, single-pass form)

- **IMPLEMENT**:
  - Read `GOLDEN_MODE` (`sequential | concurrent`, default `concurrent`) and a **required**
    `GOLDEN_SET`, matching `^[a-z0-9-]+$`. `RECORDING_DIR = join(ROOT, ".bakeoff", GOLDEN_SET)`.
    In `beforeAll`, **throw if it already exists**, before any upload or paid call.
  - Sequential: for each fixture, upload into one session, then `settle` that session until the
    new payslip leaves `processing`, then the next. The blank PDF goes last, in its own session.
  - The test timeout becomes 20 min in sequential mode, 10 min in concurrent.
  - Check that `run-supabase-integration-tests.mjs` passes `process.env` through to Vitest. It
    spawns a child process; if it builds a fresh `env`, add both variables. Print the mode and set
    before starting.
- **GOTCHA**: this step changes only the harness around today's single-pass code. The recording
  shape stays single-pass here.
- **VALIDATE**: `npm run typecheck && npm run lint`. Also run with `GOLDEN_SET=production`: it must
  throw "already exists" **before** any upload. Check that the user was cleaned up, then run
  `git status` (no new file).

### 3. RUN R1: single-pass baseline, sequential (paid, ~$0.30)

- **IMPLEMENT**:
  `GOLDEN_MODE=sequential GOLDEN_SET=production-sequential npm run test:extraction` (bash syntax;
  in PowerShell set `$env:` first).
  Record in the history draft: per-sample latency, upload, analysis and attempts; the cost line;
  and p50/p90/max. Compare with run 3 (concurrent) and `cu` (bake-off sequential): this is D4's
  concurrency-penalty figure.
- **VALIDATE**: `npm run score:extraction` scores **three** single-pass sets and exits 0.
  The spread is printed.

### 4. CREATE the migration, apply it, regenerate types (D6, D7)

- **IMPLEMENT** `supabase/migrations/<version>_two_pass_extraction.sql`:
  1. `alter table public.payslips add column tables_status text not null default 'pending'
     constraint payslips_tables_status_valid check (tables_status in ('pending','ready','failed'));`
  2. Backfill, for correctness on any database:
     `update public.payslips set tables_status = case status when 'processing' then 'pending'
     when 'failed' then 'failed' else 'ready' end;`
  3. `create function public.complete_extraction_pass(...)`, exactly as D7 specifies. Use
     `get diagnostics v_count = row_count; return v_count = 1;` and
     `raise exception 'invalid_pass' using errcode = '22023'` for an unknown pass.
  4. `revoke execute on function public.complete_extraction_pass(uuid, text, jsonb, jsonb, jsonb)
     from public, anon; grant execute on function … to authenticated;`
  5. `comment on column public.payslips.tables_status is …`, stating the D6 meaning.
- **APPLY**:
  - A transactional dry run first (`begin; <migration>; rollback;` through `execute_sql`), as
    Task 03 D6 did.
  - Then `apply_migration` with name `two_pass_extraction`. Rename the local file to the version
    it records.
  - Regenerate `api/src/database.types.ts` with `generate_typescript_types`. Keep only the
    `public` schema output style the file already has, and diff it: expect `tables_status` on
    Row/Insert/Update and one entry under `Functions`.
- **GOTCHA**: `security invoker` is the default; write it explicitly with a comment pointing at
  Task 04 D2. `auth.uid()` inside the function is the caller's.
- **VALIDATE**:
  - `get_advisors` (security): no new finding beyond `auth_leaked_password_protection`.
  - `npm run typecheck` fails where `PayslipRow` factories lack `tables_status`. That is expected
    and fixed in steps 5 and 9.

### 5. UPDATE shared contracts (D6)

- **IMPLEMENT**:
  - `shared/src/session.ts`: `export const TABLES_STATUSES = ["pending", "ready", "failed"] as
    const;`, plus `tablesStatusSchema` and the `TablesStatus` type. Doc comment: D6's meaning, and
    "confirm is refused while `pending` (Task 09)". Update the `PAYSLIP_STATUSES` comment at lines
    18–21.
  - `shared/src/payslip.ts`: `tablesStatus: tablesStatusSchema` in the `payslipSchema` envelope
    (tier 2, server-set; never in `canonicalPayslipFieldsSchema`, so PATCH cannot forge it).
  - `shared/src/api.ts`: add `tablesStatus: true` to `payslipSummarySchema`'s `.pick`. The detail
    and export schemas inherit it.
  - `shared/src/index.ts`: export if it re-exports explicitly.
  - Tests:
    - `session.test.ts`: the enum is closed.
    - `api.test.ts` and `payslip.test.ts`: fixtures gain `tablesStatus`. The strict update schema
      **rejects** a `tablesStatus` key (a forgery test like the existing `userId` one), and the
      stripped summary accepts it.
- **VALIDATE**: `npx vitest run --project shared`

### 6. UPDATE `api/src/providers/document-extraction/types.ts`

- **IMPLEMENT**:
  - `export const EXTRACTION_PASSES = ["scalars", "tables"] as const; export type ExtractionPass
    = …;`
  - `ExtractionInput` gains `readonly pass: ExtractionPass`.
  - `ExtractionMetadata` gains `readonly queuedMs?: number`, documented as set by the runner, not
    the provider.
  - `ProviderExtractionResult.fields` becomes `Partial<CanonicalPayslipFields>`, as PRD §6.3
    already says, and holds only that pass's keys.
- **VALIDATE**: `npm run typecheck`. Errors are expected at the call sites fixed in steps 7–10.

### 7. UPDATE the analyzer definition and provisioning (D5)

- **IMPLEMENT**:
  - `analyzer.ts`:
    - `export function analyzerIdFor(base: string, pass: ExtractionPass): string` returns
      `` `${base}_${pass}` ``.
    - `buildAnalyzerDefinition(completionModel, pass)` filters `PAYSLIP_FIELDS` by `def.type ===
      "array"` for the tables pass and the complement for the scalars pass.
    - `fieldSchema.name` becomes `HrPayslipScalars` / `HrPayslipTables`. The `description` fields
      stay the same strings.
  - `scripts/provision-analyzer.ts`:
    - `ensureDefaults()` stays as it is.
    - `ensureAnalyzer(pass)` runs for both passes, against `analyzerIdFor(analyzerId, pass)`, and
      compares against `buildAnalyzerDefinition(completionModel, pass)`.
    - Exit code: 1 if either analyzer drifted.
    - Header comment: the base analyzer stays deployed as the recorded baseline and is no longer
      managed here.
    - The `--replace` warning names the invalidated set kinds.
  - `index.ts`: no change beyond what step 8 needs.
- **GOTCHA**: `provision-analyzer.ts` compares only `description` and `fieldSchema.fields`. Keep
  it that way.
- **VALIDATE**:
  - `npm run typecheck`.
  - A new `analyzer.test.ts` (no network) asserts:
    - the two field sets are disjoint and their union is exactly `Object.keys(PAYSLIP_FIELDS)`;
    - the tables set is exactly `payComponents, obustave, neoporeziviPrimici`;
    - `ukupnoSati` and `currency` are in scalars;
    - every description is byte-identical to `PAYSLIP_FIELDS`.

### 8. UPDATE the mapper and provider per pass (D7, D9)

- **IMPLEMENT**:
  - `fields.ts`:
    - `mapAnalyzeResult(operation: unknown, pass?: ExtractionPass)`. `undefined` maps every key,
      as today; only the harness uses it, for single-pass baseline sets.
    - `"scalars"` maps `SCALAR_PARSERS` only. `"tables"` maps `TABLE_PARSERS` only.
    - Keys of the other pass are **absent** from `fields`, not `[]` or `null`.
    - `canonicalPayslipFieldsSchema.parse` still validates, since every key is optional.
    - `MappedExtraction.fields` becomes `Partial<CanonicalPayslipFields>`.
  - `provider.ts`:
    - `extract({ bytes, contentType, signal, pass })` submits to
      `analyzerIdFor(this.#options.analyzerId, pass)` and maps with `pass`.
    - `metadata.modelId` is the pass analyzer's ID.
    - Unreadable rule, per D9: scalars keep `!hasText || !anyValue`; tables throw only on
      `!hasText`.
    - The option is renamed to make the meaning plain: `ContentUnderstandingOptions.analyzerId`
      becomes `analyzerFamilyId`, and `index.ts` passes `config.AZURE_CU_ANALYZER_ID`.
- **Tests**:
  - `fields.test.ts`:
    - scalars on a real `.bakeoff/cu` body yields no table key;
    - tables yields only table keys, and `[]` when a table is absent;
    - the union of both equals the no-pass mapping, **byte for byte**, over all 11 `cu` bodies.
      This is the invariant that makes the single- and two-pass harness paths comparable; keep the
      existing `skipIf` for missing recordings.
  - `provider.test.ts`, stubbed `fetch`:
    - the submit URL carries `hrPayslipV1_scalars` or `hrPayslipV1_tables`;
    - a tables body with text but three empty tables succeeds with `[]`;
    - a tables body with no markdown is `unreadable_document`.
- **VALIDATE**:
  `npx vitest run api/src/providers` and `npm run score:extraction` (unchanged numbers: the no-pass
  path must not move).

### 9. UPDATE `api/src/repositories/payslips.ts` + tests (D6, D7, D9, D10)

- **IMPLEMENT**:
  - `PAYSLIP_COLUMNS` adds `tables_status`. `mapPayslipRow` sets `tablesStatus: row.tables_status`,
    validated by the shared schema.
  - `extractionMetadataSchema` becomes
    `z.object({ scalars: passMetadata.optional(), tables: passMetadata.optional() }).loose().nullable()`
    with `passMetadata = z.object({ unreadableFields: z.array(z.string()) }).loose()`.
    `findDetailState` returns the union, scalars first.
  - Replace `completeExtraction` with
    `completeExtractionPass(id: string, pass: ExtractionPass, result: CompletedExtraction):
    Promise<boolean>`. It calls `this.#client.rpc("complete_extraction_pass", { p_payslip_id,
    p_pass, p_fields, p_metadata, p_raw })`, throws `query_failed` on error, and returns
    `data === true`.
    - Import `ExtractionPass` from the provider types as a **type-only** import. The word "pass"
      is fine for the guard; "analyzer" is not.
  - `failExtraction`: unchanged.
  - New `failTablesExtraction(id): Promise<boolean>`: `update({ tables_status: "failed",
    updated_at })` where `id`, `user_id`, `tables_status = 'pending'` and `deleted_at is null`,
    selecting `id`.
  - `failStaleExtractions`:
    - the existing update also sets `tables_status: "failed"`. That is safe because
      `processing ⇒ pending` (D6);
    - then the D10 update;
    - it returns the sum.
  - The `CompletedExtraction.fields` type becomes `Partial<CanonicalPayslipFields>`.
- **Tests** (`payslips.test.ts`, unit, with the existing fake-client pattern):
  - `payslipRow()` gains `tables_status: "ready"`;
  - `mapPayslipRow` maps `tablesStatus`;
  - an unknown `tables_status` is `invalid_data`;
  - detail `unreadableFields` unions both passes.
- **VALIDATE**: `npx vitest run api/src/repositories`

### 10. UPDATE `api/src/services/payslip-extraction.ts` + tests (D8)

- **IMPLEMENT**:
  - `ExtractionJob.repository`:
    `Pick<PayslipRepository, "completeExtractionPass" | "failExtraction" | "failTablesExtraction">`.
  - `createSemaphore` → `createPrioritySemaphore(limit)` returning `acquire(pass)`. It keeps two
    FIFO arrays, and `release` serves the scalars queue first.
  - `enqueue(job)`:
    - `const enqueuedAt = Date.now(); const tablesAbort = new AbortController();`
    - `await Promise.all([runPass("scalars"), runPass("tables")])`. It never rejects.
  - `runPass(pass)`:
    1. Acquire.
    2. Tables pass only: if `tablesAbort.signal.aborted`, record `failTablesExtraction` with
       outcome `cancelled` and release without calling the provider.
    3. Queue-expiry guard, as today.
    4. `provider.extract({ …, pass, signal })`. The signal is
       `AbortSignal.any([AbortSignal.timeout(timeoutMs), tablesAbort.signal])` for tables, and the
       timeout alone for scalars.
    5. On success, `completeExtractionPass(id, pass, { fields, metadata: { ...metadata, queuedMs },
       raw })`.
    6. On failure:
       - scalars: `failExtraction(reason)`, then `tablesAbort.abort()`;
       - tables: `failTablesExtraction(id)`, logging `reason`, with `outcome: "cancelled"` when
         the abort came from `tablesAbort`.
    7. Release in `finally`.
  - **Abort the tables pass even when the scalars *write* fails** (a thrown repository error).
    The payslip then stays `processing` for the reaper, and analysing its tables would be wasted
    money.
- **Tests** (mirror the existing gate tests):
  1. One job: both passes start concurrently with cap ≥2, and `enqueue` resolves after both are
     recorded.
  2. Priority: cap 1, enqueue jobs A and B, and release in turn. The order is `A.scalars,
     B.scalars, A.tables, B.tables`.
  3. A scalars failure while tables is queued means tables never reach the provider, and
     `failTablesExtraction` is called.
  4. A scalars failure while tables is running aborts its signal.
  5. A tables failure leaves the scalars result recorded (`completeExtractionPass("scalars")`
     called, `failExtraction` not called).
  6. `queuedMs` is present in both passes' metadata, and is ≥ the time the gate held the slot
     (fake clock, as the queue-expiry test does).
  7. The existing tests still pass once adapted: FIFO within a priority, the expiry guard, "never
     rejects".
- **VALIDATE**: `npx vitest run api/src/services`

### 11. UPDATE the routes (D6)

- **IMPLEMENT**:
  - `sessions.ts`: the session detail summary adds `tablesStatus: payslip.tablesStatus`. The
    enqueue call is unchanged.
  - `payslips.ts`: the detail inherits it through `...state.payslip`; confirm the response
    parses.
  - `app.test.ts` and route unit tests: adjust fixtures.
- **VALIDATE**: `npm run validate`, green with the new test count recorded.

### 12. EXTEND the hosted integration suite (D7, D10)

- **IMPLEMENT** in `api/src/routes/payslips.integration.ts` (no-op runner, no Azure):
  - `complete_extraction_pass` through the repository, as the uploading user:
    1. tables then scalars: `canonical_data` holds both key sets; `status = review`,
       `tables_status = ready`; `extraction_metadata` and `raw_provider_result` have both keys;
    2. scalars then tables: the same final row;
    3. a second tables write returns `false` and changes nothing;
    4. scalars on a `failed` row returns `false`;
    5. tables on a soft-deleted row returns `false`;
    6. **a second user calling it on the first user's id returns `false`, and the row is
       unchanged** (checked with the secret-key client);
    7. an unknown pass raises (the repository throws `query_failed`).
  - The reaper (D10): a `review` row with `tables_status = pending` and a back-dated `updated_at`
    (set with the admin client) becomes `failed`; a fresh one does not.
- **VALIDATE**: `npm run test:integration`. It was 3/3 auth and 16/16 payslips, and now includes
  the new cases.

### 13. UPDATE `api/src/scoring/score.ts` + `scripts/score-extraction.ts` (D12)

- **IMPLEMENT**:
  - `score.ts`:
    - `ScoringInput` gains `readonly firstFormMs?: number | null` and `readonly completeMs?:
      number | null`;
    - `SetReport` gains `firstForm` and `complete` via `percentiles`. They are `null` when absent.
  - `score-extraction.ts`:
    - `discoverSets` classifies each directory:
      - **single-pass** if every body is a CU body from `analyzerId`, as today;
      - **two-pass** if every body is `{ scalars, tables }`, with CU bodies from
        `analyzerIdFor(analyzerId, "scalars"|"tables")`;
      - otherwise skipped by name with the reason;
      - mixed kinds in one directory are a problem (exit 1).
    - `loadSet` for two-pass: `{ ...mapAnalyzeResult(b.scalars, "scalars").fields,
      ...mapAnalyzeResult(b.tables, "tables").fields }`. `firstFormMs` and `completeMs` come from
      `timings` (D12). A missing `timings` block is **not** a problem, just "not recorded".
    - `printSet` prints `FIRST FORM`, `COMPLETE` and `FIRST FORM PER PAGE`. Page count comes from
      the fixture's `pageCount`, since `loadExpected()` returns it.
    - `printSpread` groups by kind, then prints `TWO-PASS vs SINGLE-PASS` with scalar and cell hits
      per two-pass set against the single-pass min–max.
- **Tests** (`score.test.ts`): percentiles for `firstForm` and `complete`, null when absent.
  The CLI stays untested, as today.
- **VALIDATE**: `npm run score:extraction`. Three single-pass sets score as before; no two-pass
  set exists yet, so the comparison line prints "no two-pass set".

### 14. UPDATE the golden run for two passes (D13)

- **IMPLEMENT** in `extraction.integration.ts`:
  - `settle` waits for `status !== "processing" && tablesStatus !== "pending"`.
  - Every fixture must end `status: "review"` **and** `tablesStatus: "ready"`. The blank ends
    `failed / unreadable_document`, and its `tablesStatus` is `failed`, because it was cancelled
    or unreadable.
  - Recording: `{ timings: { scalars: {queuedMs, latencyMs, uploadMs, analyzeMs, submitAttempts},
    tables: {…} }, scalars: raw.scalars, tables: raw.tables }`, read from `extraction_metadata`
    and `raw_provider_result`.
  - Report per sample: first form, complete, and per pass upload / analysis / attempts. Cost:
    `estimateUsageCost` over both bodies of every sample. Summary: first-form p50/p90/max and
    complete p50/p90/max.
- **VALIDATE**: `npm run typecheck && npm run lint`

### 15. PROVISION the two analyzers

- **IMPLEMENT**: `npm run provision:analyzer`. It creates `hrPayslipV1_scalars` and
  `hrPayslipV1_tables`; creation is free. Run it again: both "match the code", exit 0.
- **VALIDATE**: the second run exits 0.

### 16. RUN R2: two-pass, sequential (paid, ~$0.42) — THE DECISION GATE (D4)

- **IMPLEMENT**:
  `GOLDEN_MODE=sequential GOLDEN_SET=two-pass-sequential npm run test:extraction`, then
  `npm run score:extraction`.
- **GATE**:
  - **first-form p50 ≤10 s** and **scalar hits ≥ (lowest single-pass set − 1)**: continue.
  - **Otherwise stop.** Write what R2 measured into the history draft: first form per sample, the
    scalars pass's `analyzeMs` against R1's analysis times, `uploadMs`, and attempts. Report to
    the product owner with D4's `EXTRACTION_CONCURRENCY=1` option costed from the same numbers.
    **Do not change the schema, the parsers or the cap on your own.**
  - **Line-item cells** below the single-pass range by more than its spread: investigate before
    going on (D12). Compare per table and per sample through the harness's "fields wrong most
    often" lines.
- **VALIDATE**: harness exit 0; the gate numbers are in the history draft.

### 17. RUN R3: two-pass, all 11 at once (paid, ~$0.42)

- **IMPLEMENT**:
  `GOLDEN_MODE=concurrent GOLDEN_SET=two-pass-concurrent npm run test:extraction`, then
  `npm run score:extraction`. It now shows two two-pass sets, so there is a two-pass run-to-run
  spread.
- Record the first-form and complete figures against PRD §11.4's "four in parallel ≤25 s" line
  (report only). Record the measured cost per document for both kinds of run: the DoD's "known
  number".
- **VALIDATE**: harness exit 0 with spread printed per kind.

### 18. UPDATE the documents

- **`.agents/specs/two-pass-extraction.md`**: status "implemented (Task 05)". Answer open
  questions 1–4 with D1, D5, D11 and D6, and replace the estimates with R2 and R3's measurements.
- **`PRD.md`**:
  - §6.3: `extract` takes `pass`; `fields` is partial per pass.
  - §6.6: add the `tablesStatus` sub-machine under the payslip diagram.
  - §7.3: the cap counts analyses, and a payslip is two.
  - §7.4: two analyzers, one schema partitioned.
  - §10.4 and §10.5: `tablesStatus`.
  - §10.7: `409 confirm_not_allowed` also while `tablesStatus = pending`.
  - §11.4: the measured figures.
  - Appendix B: the `tables_status` column, and the per-pass `extraction_metadata` and
    `raw_provider_result` shapes.
- **`CONTEXT.md`**, under Review: a new term.

  > **Extraction pass**: one of the two analyses a Payslip's extraction is split into — the
  > scalars pass, which makes the form usable, and the tables pass, which fills the three
  > line-item tables. _Avoid_: phase, stage, job.

- **`.agents/ROADMAP.md`**:
  - §2: 05 ✅ with the history link.
  - Task 05 DoD ticked, citing figures.
  - Task 06 scope amended (D11): per-pass recompute, the sum check only when tables are `ready`,
    the per-pass shapes, grounding from the scalars body.
  - Task 07: hr/en copy for `TABLES_STATUSES` alongside `PAYSLIP_STATUSES`.
  - Task 08: regions project from both bodies in `raw_provider_result`.
  - Task 09: confirm refused while `pending`; table fields read-only while `pending`; tables-only
    retry and a stored reason, if wanted (D9).
  - §5 latency risk: new figures, plus D4's finding that 500K TPM is not the limit and the
    concurrency penalty is unexplained.
- **`.env.example`**: the `AZURE_CU_ANALYZER_ID` comment ("names the analyzer family:
  `<id>_scalars` and `<id>_tables`"); the `EXTRACTION_CONCURRENCY` comment ("concurrent analyses;
  each payslip runs two").
- **`api/src/config.ts`**: the same two doc comments if they describe these variables.
- **VALIDATE**: `npx prettier --check .` (Markdown is excluded, by design).

### 19. RUN the full validation sweep

- **VALIDATE**, each once (the "don't re-run passed checks" rule):
  `npm run validate` · `npm run build` · `npm run check:golden` · `npm run provision:analyzer`
  (exit 0, GET-only) · `npm run score:extraction` · `npm run test:integration` ·
  lockfile platform check (validate 6.22).

  Then check for orphans with `execute_sql`: 0 `task0N-` users, 0 payslips, 0 orphaned Storage
  objects. Run `get_advisors` (security).

### 20. WRITE `.agents/history/05-extraction-latency-two-pass.md`

- Mirror history/04's sections:
  - what was built;
  - the decisions carried (D1–D14);
  - deviations;
  - scoring: all sets, spread per kind, and the two-pass versus single-pass comparison;
  - paid runs: a table with a running total;
  - latency: R1, R2 and R3 per sample, first form and complete;
  - cost per document measured;
  - validation;
  - open items.
- **Then** `/code-review` on the uncommitted work, fix what holds up, re-validate, and record the
  review in the history file before committing (the project's commit rule).

---

## TESTING STRATEGY

### Unit Tests (no network)

- **Analyzer partition** (step 7): disjoint, complete, descriptions untouched.
- **Mapper per pass** (step 8): keys confined to the pass; **the union equals the single-pass
  mapping over all 11 `cu` bodies**.
- **Provider** (step 8): pass analyzer ID in the URL; the tables-pass unreadable rule.
- **Runner** (step 10): concurrency, priority, cancellation (queued and running), failure
  isolation between passes, `queuedMs`.
- **Repository** (step 9): mapping, per-pass metadata union, `invalid_data`.
- **Shared** (step 5): the closed enum, and `tablesStatus` refused by the strict PATCH schema.
- **Scorer** (step 13): the new percentiles.

### Integration Tests (hosted Supabase, no Azure)

- **Step 12**:
  - either-order merge;
  - discard conditions: already ready, failed, deleted;
  - **cross-user refusal**;
  - an invalid pass;
  - the reaper on pending tables.

### Paid Golden Runs (Azure, budgeted — D3)

- R1 (step 3), R2 (step 16, the gate), R3 (step 17). R4 and R5 are reserve; **ask before a
  sixth**.

### Edge Cases

- The tables pass lands **before** the scalars pass: the row stays `processing` and
  `tables_status = ready`, then becomes `review` (step 12 case 1).
- The scalars pass fails while the tables pass is queued: no provider call for tables (step 10
  case 3).
- A blank page: the scalars pass fails `unreadable_document`, and tables end `failed` (step 14).
- G01: three nearly empty tables are `ready`, not failed (step 8).
- A payslip soft-deleted mid-extraction: both writes are discarded (step 12 case 5).
- A redeploy mid-extraction: `processing` rows are reaped as today, and a `review` row with pending
  tables is reaped to `tables_status = failed` (step 12).
- A user edit while tables are pending: out of scope until Task 09. The row-level merge (D7)
  already preserves scalar edits.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` (oxlint) · `npm run format:check` (or `npx prettier --check .`)

### Level 2: Unit Tests

`npm run test` · `npx vitest run --project shared` · `npx vitest run api/src`

### Level 3: Integration Tests

`npm run test:integration` (hosted, no Azure)

### Level 4: Measurement (paid; D3)

```
GOLDEN_MODE=sequential GOLDEN_SET=production-sequential npm run test:extraction   # R1, step 3
GOLDEN_MODE=sequential GOLDEN_SET=two-pass-sequential   npm run test:extraction   # R2, step 16
GOLDEN_MODE=concurrent GOLDEN_SET=two-pass-concurrent   npm run test:extraction   # R3, step 17
npm run score:extraction
```

### Level 5: Additional Validation

`npm run provision:analyzer` · `npm run check:golden` · `npm run build` · Supabase MCP
`get_advisors` and orphan checks with `execute_sql`.

No browser journey: no UI changes, and Task 07 is the first client-to-API call. That matches
history/04's validation.

---

## ACCEPTANCE CRITERIA

The ROADMAP Task 05 DoD, as interpreted by D2 and D6:

- [ ] **p50 time to first usable form ≤10 s over the 11 samples, measured** (R2, sequential,
      `queuedMs + latencyMs` of the scalars pass). Per-page figures reported alongside.
- [ ] **Scalar accuracy within the noise band of the single-pass baseline**: every two-pass set
      ≥ the lowest single-pass set − 1 field (D12).
- [ ] **Cost per document recorded** in history/05, measured from both passes' `usage`, next to
      the single-pass figure.
- [ ] **Export blocks until both passes complete**: confirm is refused while `tablesStatus` is
      `pending` (rule recorded in PRD §10.7 and ROADMAP Task 09), and export requires `confirmed`.
      Every export also carries `tablesStatus`.

Also:

- [ ] `ukupnoSati`'s owner (scalars) and the warnings-recompute rule (Task 06 amendment) are
      recorded.
- [ ] "Tables failed, scalars succeeded" is `review` + `tablesStatus: failed`, distinct from
      `failed`.
- [ ] The two passes merge correctly in either order, and a second user cannot write a first
      user's payslip (hosted tests).
- [ ] `npm run score:extraction` scores single- and two-pass sets, prints spread per kind, and
      still exits 1 when anything cannot be measured.
- [ ] Line-item cell accuracy has not dropped beyond the single-pass spread, or the drop was
      investigated and explained before commit.
- [ ] `npm run validate` green; hosted integration green; ≤5 paid runs, each recorded with cost.
- [ ] No provider vocabulary outside the provider module (both guards green).

---

## COMPLETION CHECKLIST

- [ ] Steps 1–20 completed in order, each validated
- [ ] R1–R3 run, recorded with cost; the gate at step 16 passed or escalated
- [ ] Migration applied once, types regenerated, advisors clean
- [ ] Documents updated (spec, PRD, CONTEXT, ROADMAP, `.env.example`)
- [ ] History written; `/code-review` run and recorded; re-validated; then committed

---

## NOTES

- **Why not a new payslip status** (D6): it would double the lifecycle for a completeness
  question.
- **Why a SQL function** (D7): the passes race, and Task 09's edits race both. `jsonb ||` in one
  statement is the only atomic merge PostgREST can reach.
- **Why derived analyzer IDs** (D5): no new secret-shaped variable means no manual Render step.
- **Why R1 is worth $0.30** (D3): it is the only way to compare before and after on the same path,
  and it tightens the noise band the accuracy check leans on.
- **The concurrency slowdown is unexplained** (D4). This task measures it and does not build a
  theory into code. If R2 misses the gate, the likely lever is serialising passes, which is a
  product trade (first form against complete time) for the owner to make.
- **The submit stall** (locked decision 12) now applies per pass. Two submits per payslip roughly
  double the chance of a resubmit-billed duplicate. `submitAttempts` per pass makes that visible.
- **Deploying:** the migration is additive. The live Task 04 API ignores `tables_status` and keeps
  working until this code is pushed. Pushing follows AGENTS.md §7, is only done when asked, and
  still needs Task 04's H1.

**Confidence for one-pass execution: 7/10.** The code path is well mapped. The risk is empirical:
R2 may miss 10 s because of the unexplained concurrency penalty (D4). The plan stops and escalates
at that point instead of improvising.
