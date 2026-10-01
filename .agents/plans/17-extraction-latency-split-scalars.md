# Feature: Task 17 — Extraction latency: split the scalars pass, poll faster

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md`](../ROADMAP.md): the fourth post-roadmap iteration, after Tasks
14, 15/15b and 16. It works on ROADMAP §5 "Residual latency", which the product owner expected to be
improved in a later phase. Locked decisions that apply: **10/11** (Content Understanding + `gpt-4.1`,
unchanged), **12** (5 s submit budget with resubmit, unchanged, now per analysis), **13** (the
service returns what is printed; unchanged), **15** (accuracy per field instance, ~0.5% noise band),
**16** (grounding stays; every value keeps its source and confidence). · **Evidence:**
[`.agents/research/extraction-latency.md`](../research/extraction-latency.md) **§0**, the paid
experiment of 2026-09-30. · **PRD:** §7.3, §7.4, §11.4 · **Spec:**
[`.agents/specs/two-pass-extraction.md`](../specs/two-pass-extraction.md) · **Glossary:**
[`CONTEXT.md`](../../CONTEXT.md) (Extraction pass) · **Rules:** [`AGENTS.md`](../../AGENTS.md).

**Numbering:** the product owner asked for "task 15"; Task 15 (review-flow iteration) exists, so this
is **Task 17**.

**Starting state:** clean tree at `69e1f0b` (Task 16 committed and on the mirror), plus the untracked
`.agents/research/` and this plan. Record the starting commit in the history file.

**Session split (standing rule):** the implementing session runs the ordinary checks, the scoring
harness and **the one paid run below**, and **stops before** `/code-review`, `/validate`, any browser
journey and the commit. It does **not** change Render (D11).

## Feature Description

Upload to first usable form is p50 ~12 s against PRD §11.4's ≤10 s. The first form waits for the
**scalars pass**: one Content Understanding (CU) analysis that returns 25 scalar fields at ~600
output tokens. A same-day, paired experiment (research §0) ran the scalars pass as-is next to the
same fields split across two analyzers submitted at once:

| Analysis time, 11 golden docs (s) | p10 | p50 | p90 |
| --- | --- | --- | --- |
| scalars pass as deployed (`hrPayslipV2_scalars`) | 9.1 | 11.1 | 13.4 |
| **two halves at once, slower of the two** | 4.9 | **7.0** | 8.6 |

- The split was faster on **11 of 11** documents, by 2.5–6.5 s (median −4.4 s).
- Accuracy: 270/273 scalars and 75/77 critical fields, against the control's 269/273 and 73/77.
  That is within the noise band.
- Cost: +$0.017 per document.

This task ships that split, plus faster status polling on the provider (1 s → 250 ms) and the
client (2 s → 500 ms).

## User Story

As a demo operator photographing a payslip in front of an audience
I want the filled-in form to appear in under ten seconds
So that the demo does not stall and the review loop starts while the room is still watching.

## Problem Statement

1. **The scalars pass is one analysis whose time is mostly generation.** CU's floor (a one-field
   probe) was p50 6.0 s on the day. Each extra ~300 output tokens adds several seconds.
2. **Polling adds dead time.** The provider sleeps 1 s between status GETs
   (`provider.ts:73`, `:230–231`), a mean ~0.5 s wasted per pass. The client re-reads the session
   every 2 s (`client/src/routes/SessionPage.tsx:35`), a mean ~1 s before the loading screen
   clears.

## Solution Statement

- **The scalars pass stays one logical pass (D1).** Inside the provider it becomes two CU analyses,
  `<family>_header` and `<family>_reconciliation`, submitted concurrently. Their fields are merged,
  and both bodies are retained as `raw.scalars = { header, reconciliation }`.
- The runner, the database functions, the repository, the routes and the client do not change.
- The readers of retained bodies are the region projection, the "edited" reference and the
  harnesses. They read either shape through one helper, so V1/V2 payslips and recordings keep
  working (D9).
- A new analyzer family, **`hrPayslipV3`**, has three analyzers built exactly as measured (D3).
- The provider polls every 250 ms and the client every 500 ms (D7).
- One paid golden run on V3 records a set, scores it and measures first form (D10).

## Decisions

The product owner answered D1, D2, D3 and D10 in planning (2026-09-30). The others follow from the
code.

- **D1 — Split inside the provider.** `DocumentExtractionProvider.extract({ pass: "scalars" })` runs
  both parts and returns one `ProviderExtractionResult`. There are no new pass values, no migration,
  and `complete_extraction_pass`, `tables_status` and the client are untouched. `raw` for the
  scalars pass is `{ header: <CU body>, reconciliation: <CU body> }`, both bodies verbatim.
- **D2 — Split only, new family.** The code always uses `analyzerIdFor(family, "header" |
  "reconciliation" | "tables")`. `hrPayslipV3` is provisioned with three analyzers.
  - V1 and V2 stay deployed and unmanaged, as V1's single-pass analyzer already is.
  - Rollback means reverting the commit (CI redeploys) and setting Render back to V2.
  - Stored V1/V2 payslips (a single `raw.scalars` body) stay readable.
  - **Never run `provision:analyzer` with a V1/V2 family after this task.** It would create
    `hrPayslipV2_header` / `_reconciliation` with V3's definitions.
- **D3 — Exactly as measured.** Relative to V2's definitions:
  - `currency` is removed from `PAYSLIP_FIELDS` (the mapper already ignores it, `fields.ts:28`);
  - `config.enableFormula: false` and `config.enableBarcode: false` are set;
  - both scalar parts keep `fieldSchema.name: "HrPayslipScalars"`, the name the experiment's halves
    carried;
  - descriptions are byte-identical.

  The same config applies to `_tables` (one builder). The tables were not measured with the trims,
  so the paid run's cell score is their check (D10).
- **D4 — The partition, as measured:**
  - `header`: `employerName`, `employerAddress`, `employerOib`, `employerIban`, `employeeName`,
    `employeeAddress`, `employeeOib`, `employeeIban`, `period`, `paymentDate` (10 fields);
  - `reconciliation`: every other scalar (15 fields, `ukupnoSati` included);
  - `tables`: the three arrays.

  The names follow the form's sections (`client/src/review/regionSections.ts:38–60`: `employer`,
  `employee` and `period` sit at the top; `reconciliation` is the pay calculation).
- **D5 — Merge semantics.** Each part's body is mapped with `mapAnalyzeResult(body, "scalars")`.
  **Only the keys the part owns (D4) are taken from it**: fields, `fieldMetadata`,
  `unreadableFields` and `ungroundableFields` are all filtered by ownership. Every scalar key is
  therefore present exactly once. `hasText` is true if any part has text.
  - Failure: if either part fails, the pass fails with that part's `ExtractionError`, and the other
    part's requests are aborted.
  - `unreadable_document` is judged on the merge (no text, or no value in either part).
  - Metadata:
    - `modelId` is `"<header id>+<reconciliation id>"`;
    - `latencyMs` runs from the start to the later part's finish;
    - `uploadMs` runs to the later part's `202`;
    - `analyzeMs` is `latencyMs − uploadMs`;
    - `submitAttempts` is the maximum over the parts (">1 may have billed a duplicate" keeps its
      meaning).
- **D6 — Concurrency keeps counting runner slots.** `EXTRACTION_CONCURRENCY` (3) still gates passes
  in `createPrioritySemaphore`.
  - A scalars slot is now two analyses, so up to six analyses can be in flight.
  - Concurrent analyses cost nothing measurable (history/05 "Finding").
  - A single payslip's scalars and tables still start together.
  - PRD §7.3's "capped at three concurrent analyses" is reworded to passes.
- **D7 — Polling.** The provider default `pollIntervalMs` goes 1000 → **250**. The client's
  `POLL_INTERVAL_MS` goes 2000 → **500**.
  - The session read excludes `raw_provider_result` (`repositories/payslips.ts:25–29`), so a
    500 ms poll is cheap.
  - The resource limit is 3,000 operations/minute (research §5.C).
- **D8 — The drift check compares config too.** `provision-analyzer.ts` compares only the
  description and fields (`:86–100`), so a V3 built with the wrong `config` would pass. It now also
  checks that every key `buildAnalyzerDefinition` sets under `config` equals the deployed value.
  The service may echo defaults we don't set, so extra deployed keys are ignored.
- **D9 — One reader helper.** `fields.ts` exports:
  - `scalarPartBodies(retained)`: `[{ body, fields: owned keys }]`. For a legacy single body it is
    one entry owning every scalar; for `{ header, reconciliation }` it is one entry per part; for
    anything else it is `null`.
  - `mapRetainedPass(retained, pass)`: the D5 merge for `scalars`, and `mapAnalyzeResult` for
    `tables`.

  `usage.ts` flattens a parts object into its bodies. Every reader uses these helpers: regions,
  original, the provider, `score-extraction.ts` and the golden run's cost line.
- **D10 — One paid run** (approved, ~$0.75):
  `AZURE_CU_ANALYZER_ID=hrPayslipV3 GOLDEN_SET=task17-sequential GOLDEN_MODE=sequential npm run test:extraction`.
  - **Acceptance:** scalars ≥ 268/273 and cells ≥ 478/548, the floors Task 16 used.
  - **Target:** first form p50 ≤ 10 s on the D2 metric (`queuedMs + latencyMs`).
  - If accuracy fails, record it and stop. Do not iterate; tell the product owner.
  - If only the latency target is missed, record it with the day's context (the experiment's
    control ran p50 11.1 s) and keep the change: the paired comparison, not one run, is the
    evidence.
- **D11 — Deploy is the product owner's.** After the commit, Render's `AZURE_CU_ANALYZER_ID` must
  become `hrPayslipV3` **with** the deploy.
  - Any upload in between fails as `provider_unavailable`, which is retryable: a 404 on an analyzer
    is classified that way (`provider.ts:268–272`).
  - The implementing session updates only the local, git-ignored `.env` (after provisioning, step 9).
- **D12 — The implementing session stops before review** (standing rule, above).

## Feature Metadata

**Feature Type**: Enhancement (performance)
**Estimated Complexity**: Medium
**Primary Systems Affected**: `api/src/providers/document-extraction/content-understanding/`
(analyzer, field-schema, provider, fields, regions, original, usage), `scripts/provision-analyzer.ts`,
`scripts/score-extraction.ts`, `api/src/routes/extraction.integration.ts`, `client/src/routes/SessionPage.tsx`, docs
**Dependencies**: Azure CU (`2025-11-01`), new analyzers `hrPayslipV3_{header,reconciliation,tables}`.
No npm changes.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `.agents/research/extraction-latency.md` §0, §5.A–D, §7: the measured evidence and the
  experiment's design. `.bakeoff/latexp/run.ts` (git-ignored) is the experiment's exact analyzer
  construction (`variant()`, `HALF_A`); **mirror it**.
- `api/src/providers/document-extraction/content-understanding/analyzer.ts` (all 76 lines):
  - `analyzerIdFor` (`:33`), `passFields` (`:42–50`), `buildAnalyzerDefinition` (`:55–76`) are
    what becomes role-based;
  - `toCuField` (`:8–31`) stays.
- `…/content-understanding/field-schema.ts:22–130`: `PAYSLIP_FIELDS`. `currency` at `:63` is
  removed (D3).
- `…/content-understanding/analyzer.test.ts` (all): the partition tests to rewrite for roles.
- `…/content-understanding/provider.ts`:
  - `extract` (`:76–128`) is the single-analysis flow to factor into `#analyze`;
  - `#submitWithRetry` (`:130–190`) and `#poll` (`:196–235`) are unchanged;
  - the default poll is at `:73`;
  - `classifyHttpFailure` (`:262–278`).
- `…/content-understanding/provider.test.ts:1–70`: the `stubFetch` queue. It is **sequential**, so
  concurrent parts need a URL-routed stub (Gotchas).
- `…/content-understanding/fields.ts`: `MappedExtraction` (`:122–138`), `mapAnalyzeResult`
  (`:145–210`), `SCALAR_FIELDS` and the parsers near `:28`.
- `…/content-understanding/regions.ts`:
  - `storedSchema` (`:60–62`);
  - `projectSourceRegions` (`:82–111`) calls `parseBody(stored.data.scalars)` and loops
    `SCALAR_FIELDS` over one body;
  - `parseBody` (`:117–`).
- `…/content-understanding/regions.test.ts:272–340`: recordings `SETS` and `EXPECTED_WITHHELD`.
- `…/content-understanding/original.ts` (all 26 lines), `original.test.ts:51` (recording set path).
- `…/content-understanding/usage.ts:33–65`: `estimateUsageCost`.
- `api/src/providers/document-extraction/types.ts:9–14`: `EXTRACTION_PASSES`, which is **unchanged**
  (D1).
- `api/src/services/payslip-extraction.ts:36–41`: the `concurrency` doc comment (D6). The runner
  logic is unchanged.
- `scripts/provision-analyzer.ts`: the loop at `:40–49` over `EXTRACTION_PASSES` becomes a loop
  over roles; the drift compare is at `:86–100` (D8).
- `scripts/score-extraction.ts`: the signatures at `:43–45`, `discoverSets` at `:86–104`,
  `signatureOf` at `:108–116`, and `twoPass` at `:175–195`.
- `api/src/routes/extraction.integration.ts:255–300`: recording, cost (`estimateUsageCost`) and the
  quads text ("Each payslip is two analyses").
- `client/src/routes/SessionPage.tsx:35`, `:113–135`: the poll loop.
- `api/src/provider-vocabulary.test.ts`: every new provider word stays inside
  `content-understanding/`.
- Docs to update:
  - `PRD.md` §7.3 (line ~499), §7.4 (~505), §11.4 (~854–897);
  - `CONTEXT.md` "Extraction pass" (~148–152);
  - `README.md:39–43`;
  - `.agents/specs/two-pass-extraction.md` status block;
  - ROADMAP §2 and §5 ("Residual latency", "Cost per page");
  - `.claude/commands/validate.md` Phase 7 (~549–566, git-ignored).

### New Files to Create

- `.agents/history/17-extraction-latency-split-scalars.md`: the record.
- `.bakeoff/task17-sequential/` (git-ignored): the paid run's recordings.
- Azure: `hrPayslipV3_header`, `hrPayslipV3_reconciliation`, `hrPayslipV3_tables`.

### Relevant Documentation

- [CU analyzer reference: `config`](https://learn.microsoft.com/azure/ai-services/content-understanding/concepts/analyzer-reference):
  `enableFormula` / `enableBarcode` default to true and are documented as disable-for-performance.
- [CU REST `analyzeBinary` / `analyzerResults`, 2025-11-01](https://learn.microsoft.com/rest/api/contentunderstanding/):
  there is no documented `Retry-After` or polling interval (research §5.C).
- [CU service limits](https://learn.microsoft.com/azure/ai-services/content-understanding/service-limits):
  3,000 operations/minute, well above a 250 ms poll.

### Patterns to Follow

- **Derived analyzer IDs** (`analyzer.ts:28–35`): `${family}_${role}` with an underscore, never a
  period.
- **Provider vocabulary** only under `content-understanding/`. The runner and the routes never learn
  that the scalars pass is two analyses.
- **Logging:** codes and statuses only, never the service's `message` (`provider.ts:57–60`).
- **Readers never throw on a malformed stored row**; they return `null` or `EMPTY`
  (`regions.ts:113–116`, `original.ts:19–24`).
- **Tests:** vitest, colocated `*.test.ts`. Local-only recording tests skip when `.bakeoff/` is
  absent. Write each test red first and record that in history.
- `nodenext`: relative imports in `api/` carry `.js`. Scripts import `../api/src/...ts`.
- **Comments cite the decision** (`(Task 17 D5)`), in the house style.

---

## IMPLEMENTATION PLAN

- **Phase 1 ($0):** roles and partition, the reader helper, the provider split, polling, harnesses,
  drift check. Steps 2–8.
- **Phase 2 (free Azure calls, then one paid run):** provision V3, then the golden run. Steps 9–11.
- **Phase 3:** docs, the history record, final checks. Steps 12–13.

---

## STEP-BY-STEP TASKS

### 1. Starting state

- `git status` (clean apart from `.agents/research/` and this plan) and `git log -1` (expect
  `69e1f0b`).
- `npm run validate` must be green: 76 files / 1,221 tests at Task 16's close.
- **VALIDATE:** record both in history/17.

### 2. UPDATE `field-schema.ts` and `analyzer.ts`: roles, partition, config (D2, D3, D4)

- **REMOVE** `currency` from `PAYSLIP_FIELDS` (`field-schema.ts:63`).
- **ADD** to `analyzer.ts`:
  ```ts
  /** The scalars pass runs as two analyses at once (Task 17 D1, D4). */
  export const SCALAR_PARTS = ["header", "reconciliation"] as const;
  export type ScalarPart = (typeof SCALAR_PARTS)[number];
  export type AnalyzerRole = ScalarPart | "tables";
  export const ANALYZER_ROLES: readonly AnalyzerRole[] = [...SCALAR_PARTS, "tables"];
  const HEADER_FIELDS = [ /* the 10 of D4 */ ];
  export function roleFields(role: AnalyzerRole): Record<string, FieldDef> // replaces passFields
  ```
  `roleFields("tables")` returns the array fields. `header` returns `HEADER_FIELDS`.
  `reconciliation` returns every other non-array field.
- **UPDATE** `analyzerIdFor(familyId, role: AnalyzerRole)` and
  `buildAnalyzerDefinition(model, role)`:
  - `config` gets `enableFormula: false, enableBarcode: false` (D3);
  - `fieldSchema.name` is `"HrPayslipTables"` for tables, `"HrPayslipScalars"` for both parts (D3);
  - update the doc comments.
- **UPDATE `analyzer.test.ts`** (red first):
  - ids `hrPayslipV3_header` / `_reconciliation` / `_tables`;
  - the three roles are disjoint and together exactly `PAYSLIP_FIELDS`;
  - `header` is exactly the 10 fields; `ukupnoSati` is in `reconciliation`;
  - no role has `currency`;
  - `config` carries the two `false`s;
  - field definitions are byte-identical to `toCuField` (keep the existing `it.each`, over
    `ANALYZER_ROLES`).
- **GOTCHA:** `fields.test.ts:125` "ignores currency" stays: the mapper test is about bodies, not
  the schema.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/analyzer.test.ts`

### 3. ADD the reader helper in `fields.ts` (D5, D9)

- **IMPLEMENT** `scalarPartBodies(retained: unknown)`. Its return type is
  `{ body: unknown; fields: readonly string[] }[] | null`.
  - A single CU body (legacy) gives `[{ body, fields: SCALAR_FIELDS }]`.
  - `{ header, reconciliation }` gives one entry per `SCALAR_PARTS` item, each owning
    `Object.keys(roleFields(part))`.
  - Otherwise it returns `null`.
  - Tell the two shapes apart with a narrow zod check: a CU body has `result`; parts have both keys.
- **IMPLEMENT** `mapRetainedPass(retained: unknown, pass: ExtractionPass): MappedExtraction | null`.
  - For `tables`: `mapAnalyzeResult(retained, "tables")`.
  - For `scalars`: map each part with `mapAnalyzeResult(part.body, "scalars")` and take owned keys
    only, into `fields`, `fieldMetadata`, `unreadableFields` and `ungroundableFields`, filtering
    paths by ownership.
  - `hasText` is true if any part has it. Return `null` if any part fails to map.
  - Parse the merged `fields` through `canonicalPayslipFieldsSchema.partial()`, or build it so
    every scalar key is present, as `mapAnalyzeResult` guarantees (`:124–126`).
- **TESTS** in `fields.test.ts` (red first):
  - a legacy body maps as before;
  - with parts, a non-owned value in a part (e.g. `employerName` in the reconciliation body) is
    ignored;
  - owned values, metadata and unreadable/ungroundable paths are merged, with every scalar key
    present once;
  - a missing or garbage part gives `null`;
  - `hasText` is true if any part has text.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/fields.test.ts`

### 4. UPDATE `provider.ts`: two analyses for the scalars pass, 250 ms poll (D1, D5, D7)

- **REFACTOR** the body of `extract` (`:81–92`) into
  `#analyze(analyzerId, bytes, contentType, signal)`. It returns
  `{ body, analyzerId, started, submitted, finished, attempts }` and reuses `#submitWithRetry` and
  `#poll` unchanged.
- **IMPLEMENT** `extract`:
  - `tables`: one `#analyze(analyzerIdFor(family, "tables"))`, mapped with
    `mapRetainedPass(body, "tables")`. The raw is the body, as today.
  - `scalars`:
    ```ts
    const parts = new AbortController();
    const partSignal = AbortSignal.any([signal, parts.signal]);
    const runs = await Promise.all(SCALAR_PARTS.map((part) =>
      this.#analyze(analyzerIdFor(family, part), bytes, contentType, partSignal)
        .catch((error: unknown) => { parts.abort(); throw error; })));
    const raw = Object.fromEntries(SCALAR_PARTS.map((part, i) => [part, runs[i]!.body]));
    const mapped = mapRetainedPass(raw, "scalars");
    ```
  - Keep the `mapped === null` → `provider_unavailable` path and the `unreadable_document` rule on
    the merge (`:100–109`).
  - Build metadata per D5.
- **UPDATE** the default `pollIntervalMs` to `250` and its doc comment ("250 ms by default (Task 17
  D7); tests pass a tiny value").
- **TESTS** in `provider.test.ts` (red first):
  - add a URL-routed stub (`stubFetchByAnalyzer({ header: [...steps], reconciliation: [...],
    tables: [...] })`, keyed by the analyzer segment in the submit URL, with one operation URL per
    analyzer);
  - scalars submits to `hrPayslipV1_header` and `hrPayslipV1_reconciliation` (whatever family the
    test's `provider()` uses) and merges owned fields;
  - `raw` is `{ header, reconciliation }`;
  - `metadata.modelId` joins both ids; `submitAttempts` is the maximum (one part stalls once and
    the other doesn't, giving 2);
  - one part answers HTTP 400: the pass rejects `provider_rejected`, and the other part's in-flight
    `fetch` sees its `signal` aborted;
  - both parts are empty: `unreadable_document`;
  - tables still makes a single analysis.
- **GOTCHA:**
  - The existing queue-stubbed tests (stall, retry, poll failure, classification, streamed body)
    exercise one analysis. **Re-point them to `pass: "tables"`**, which keeps them sequential, or
    to the routed stub. Do not delete a behaviour test.
  - Promise ordering between the two parts is not deterministic: never assert call order across
    parts.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/provider.test.ts`

### 5. UPDATE `regions.ts`, `original.ts` and `usage.ts` to read both shapes (D9)

- **`regions.ts`:** replace `parseBody(stored.data.scalars)` with `scalarPartBodies(...)`.
  - Parse each part's body and, for each owned name, call `addValue(regions, name,
    part.fields[name], part)`.
  - Page dimensions come from the first parsed scalar part, else the tables (`:103–107`).
  - A garbage part contributes nothing and never throws.
- **`original.ts`:** use `mapRetainedPass(stored.data.scalars, "scalars")` and `mapRetainedPass(…,
  "tables")`.
- **`usage.ts`:** `estimateUsageCost` expands each response through a small local "bodies of"
  (a parts object's `header` and `reconciliation`, else itself) before summing.
- **TESTS** (red first):
  - `regions.test.ts`: a parts object yields each scalar's region from its owning part only, and a
    region for a non-owned value in the other part is not drawn; the legacy body still works;
  - `original.test.ts`: a parts object maps; a legacy body maps as before;
  - `usage.test.ts`: a parts object's two bodies are both counted.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/`

### 6. UPDATE `payslip-extraction.ts` comment and the client poll (D6, D7)

- `payslip-extraction.ts:37`: "Concurrent passes, not payslips or analyses: each payslip runs two
  passes, and the scalars pass is two analyses (Task 17 D6)". Update the matching sentence in the
  `createExtractionRunner` doc. **No logic change.**
- `client/src/routes/SessionPage.tsx:35`: `POLL_INTERVAL_MS = 500`. `SessionPage.test.tsx:141`
  already advances by the constant.
- **VALIDATE:** `npx vitest run client/src/routes/SessionPage.test.tsx api/src/services/`

### 7. UPDATE `score-extraction.ts` and `extraction.integration.ts` (D9)

- **`score-extraction.ts`:**
  - `signatureOf`: the scalars signature is the body's `analyzerId` for a legacy body, or the two
    parts' ids joined by `,` in `SCALAR_PARTS` order.
  - Accept a set as two-pass when its signature equals the legacy
    `two:${family}_scalars+${family}_tables` (spelled as a literal template, since `"scalars"` is
    no longer a role) **or** the split `two:${family}_header,${family}_reconciliation+${family}_tables`.
  - `twoPass`: use `mapRetainedPass` for both passes.
  - **V1/V2 sets must score unchanged.**
- **`extraction.integration.ts`:** `estimateUsageCost` now flattens (step 5), so
  `responses.push(raw.scalars, raw.tables)` is correct as is. Update the quads report text: "Each
  payslip is three analyses in two passes, and the concurrency cap counts passes (Task 17 D6)".
- **VALIDATE:**
  - `npm run typecheck`, then `npm run score:extraction` (V2, from `.env`) and
    `AZURE_CU_ANALYZER_ID=hrPayslipV1 npm run score:extraction`: every set's numbers are identical
    to history/16's table;
  - `npx vitest run api/src/providers/document-extraction/content-understanding/regions.test.ts original.test.ts`
    (the local recording tests over V1/V2 sets are unchanged).

### 8. UPDATE `provision-analyzer.ts`: roles and config drift (D2, D8)

- Loop over `ANALYZER_ROLES`, calling `ensureAnalyzer(role)`. The header comment names the three
  analyzers and says: **never run with a V1/V2 family after Task 17** (it would create
  `_header`/`_reconciliation` there).
- The drift compare adds `(config)` to `differing` when any key of `expected.config` differs from
  `deployed.config?.[key]` (`isDeepStrictEqual`). Extra deployed keys are ignored.
- **VALIDATE:** `npm run typecheck`. The script runs in step 9.
- **Checkpoint:** `npm run validate` green (the $0 work is complete).

### 9. Provision `hrPayslipV3` (free: analyzer PUTs and GETs, no analysis)

- `AZURE_CU_ANALYZER_ID=hrPayslipV3 npm run provision:analyzer`. The first run creates the three
  analyzers; a second run must print `matches the code` for all three and exit 0.
- Then set `AZURE_CU_ANALYZER_ID=hrPayslipV3` in the local `.env` (git-ignored; record it).
- **GOTCHA:** never `--replace`. The key is never printed.

### 10. The paid run (D10): PAID, ~$0.75, once

- `GOLDEN_SET=task17-sequential GOLDEN_MODE=sequential npm run test:extraction` (the family is V3
  from `.env`). Record the start time, duration, pass/fail, the harness's cost estimate and the
  running total (Task 17: this run only; the experiment's $1.17 was a research cost, recorded in
  research §0).
- **GOTCHA:**
  - Check one recording before scoring: `scalars.header.result.analyzerId` must be
    `hrPayslipV3_header`.
  - The run goes from the development machine, whose uplink inflates `uploadMs`, twice per scalars
    pass now. Report the analysis part separately.
  - If it fails for an infrastructure reason, stop and ask before re-running.
- **VALIDATE:** 11 files in `.bakeoff/task17-sequential/`.

### 11. Score and measure (D10)

- `npm run score:extraction` (V3): scalars, critical, cells, OIB pass rate and first form for
  `task17-sequential`. Put it in a table next to history/16's sets.
- First form: p50/p90/max of `queuedMs + latencyMs`. Also give the analysis-only p50 (`analyzeMs`)
  and upload p50 (`uploadMs`), so the uplink is visible.
- Add `task17-sequential` to `regions.test.ts` `SETS` with its own `EXPECTED_WITHHELD`, recorded
  as found (expect at most A04's invented payout). Add it to `original.test.ts` if that test
  iterates sets. Otherwise add one assertion over it: an untouched payslip is never marked edited.
- **ACCEPTANCE:** scalars ≥ 268/273 and cells ≥ 478/548. If either fails: record it, stop, and tell
  the product owner (D10); the code stays uncommitted.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/`

### 12. Docs

- **`PRD.md`:**
  - §7.3: "capped at three concurrent passes; the scalars pass is two analyses (Task 17)".
  - §7.4: "Since Task 17 the scalars pass is two analyzers submitted together, `<id>_header`
    (parties, period, payment date) and `<id>_reconciliation` (the pay calculation); either
    failing fails the pass; both bodies are retained."
  - §11.4: add a "Measured in Task 17" paragraph with the experiment (research §0) and this run's
    numbers, plus the cost per document (~$0.065, estimate from the run).
- **`CONTEXT.md` "Extraction pass":** "the scalars pass is itself two analyses run at once (Task
  17); it is still one pass".
- **`README.md:39–43`:** three analyzers, family `hrPayslipV3`.
- **`.agents/specs/two-pass-extraction.md`:** a status line pointing to Task 17 and research §0.
- **`.agents/ROADMAP.md`:**
  - §2: a Task 17 line (plan, record, status, cost).
  - §5 "Residual latency": update with the measured figures. Keep it **Open** until the deployed
    stack is measured, since this is a development-machine run.
  - §5 "Cost per page": +$0.017 per document.
  - §1: no change (decisions 10–12 are untouched).
- **`.claude/commands/validate.md` Phase 7** (git-ignored): the family is V3 with three analyzers;
  remove the V2 provisioning instruction and add the "never provision a V1/V2 family" warning;
  score V1/V2/V3 sets.
- **CREATE `.agents/history/17-extraction-latency-split-scalars.md`** with:
  - outcome, files, decisions and deviations;
  - a validation table;
  - the paid run and its cost;
  - the scoring and latency tables;
  - open items;
  - the review-session handoff: `/code-review` against `69e1f0b`, `/validate`, then commit, then
    the product owner's Render switch with the deploy (D11), then a deployed first-form
    measurement.
- **VALIDATE:** `npm run format:check`;
  `grep -c $'\r' PRD.md CONTEXT.md README.md .agents/ROADMAP.md .agents/history/17-*.md` → all 0.

### 13. Final checks, then stop

- `npm run validate`, `npm run build`, `npm run check:secrets`, `npm run score:extraction` (V3), the
  same under V2 and V1, `npm run check:golden`, `git diff --check`, and `package-lock.json`
  unchanged.
- Do **not** run `/code-review`, `/validate`, browser journeys, commit, push, or change Render.

---

## TESTING STRATEGY

### Unit Tests

- `analyzer.test.ts`: roles, ids, partition, config (step 2).
- `fields.test.ts`: `scalarPartBodies` and `mapRetainedPass` over both shapes; ownership filtering
  (step 3).
- `provider.test.ts`: two concurrent analyses, merge, metadata, abort-on-failure, unreadable, tables
  single; the existing behaviour tests kept (step 4).
- `regions.test.ts`, `original.test.ts`, `usage.test.ts`: both shapes (step 5).

### Recording tests (local-only, $0)

`regions.test.ts` and `original.test.ts` over V1/V2 sets (unchanged) and `task17-sequential`
(step 11). `score:extraction` scores V1/V2 unchanged and V3 new.

### Integration Tests

`npm run test:integration` is **not** required: no route, schema, repository or migration change.
The golden run (step 10) is the end-to-end proof through the real API and hosted Supabase.

### Edge Cases

- One part fails (4xx, 5xx, stall past four tries, timeout): the whole scalars pass fails with
  that reason, the tables are cancelled by the runner as today, and a retryable reason stays
  retryable.
- One part returns no value and the other returns values: the payslip is not unreadable.
- Both parts return text but no values: `unreadable_document`.
- A part returns a value for a field it does not own: ignored, with no duplicate region.
- A stored V1/V2 payslip: regions, "edited" and scoring unchanged.
- A stored row whose `raw.scalars` is garbage or has only one part: regions contribute nothing,
  `originalExtraction` is `null`, and nothing throws.
- The overall `signal` (per-pass timeout) aborts both parts.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` · `npm run format:check`

### Level 2: Unit Tests

`npm run test` (plus the focused `npx vitest run <file>` per step)

### Level 3: Scoring and recordings ($0)

`npm run score:extraction` (V3) · `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run score:extraction` ·
`AZURE_CU_ANALYZER_ID=hrPayslipV1 npm run score:extraction` · `npm run check:golden`

### Level 4: Azure

Free: `npm run provision:analyzer` (V3, twice). Paid, once:
`GOLDEN_SET=task17-sequential GOLDEN_MODE=sequential npm run test:extraction`

### Level 5: Review session (not this session)

- `/code-review` against `69e1f0b`.
- `/validate`: the analyzer check now expects V3 to match.
- A browser pass: upload one payslip locally and watch the loading screen clear, then check the
  outlines on a V3 payslip and on an existing V2 one.
- Then commit, and the product owner switches Render to `hrPayslipV3` with the deploy.
- Measure first form on the deployed stack (one payslip, ≤ $0.07).

---

## ACCEPTANCE CRITERIA

- [ ] The scalars pass runs `<family>_header` and `<family>_reconciliation` concurrently, merges
      owned fields, and retains `{ header, reconciliation }`. Runner, DB and client are unchanged.
- [ ] V1/V2 stored payslips and recordings project regions, "edited" references and scores exactly
      as before.
- [ ] `hrPayslipV3` is provisioned as measured (no `currency`, formula and barcode off), and the
      drift check compares config.
- [ ] Provider polls every 250 ms; client every 500 ms.
- [ ] `task17-sequential`: scalars ≥ 268/273, cells ≥ 478/548; first form p50 reported against
      ≤ 10 s. Exactly one paid run, cost recorded.
- [ ] `npm run validate`, build, `check:secrets`, all three `score:extraction` runs and
      `check:golden` pass.
- [ ] PRD §7.3/§7.4/§11.4, CONTEXT, README, spec, ROADMAP §2/§5, validate.md and history/17
      updated; LF only.
- [ ] Render untouched; the switch is handed off (D11).

---

## COMPLETION CHECKLIST

- [ ] Steps 1–13 in order, each validation run and recorded
- [ ] Red-first tests recorded per step
- [ ] Paid runs: 1, cost and running total in history/17
- [ ] Stopped before review, `/validate`, browser, commit and the Render switch

---

## NOTES

**Evidence and its limits.**
- The −4.4 s median is a **paired** same-minute comparison over 11 documents, faster on every one.
  That is stronger than any cross-day comparison (research §3 shows cross-day variance swamps
  token counts).
- It is still one day. The golden run is a second sample, not a re-test of the pairing.
- The ≤10 s target is on the D2 metric. The PRD's literal "upload to first usable form" also
  includes the phone upload (~3.5 s) and the client poll; see research §2.

**Why not a third pass in the database (D1):**
- it would need a migration of the `security definer` write, new status rules (review only once
  both halves land), and runner and integration-test changes, for bookkeeping the user never sees;
- the provider owns "how many analyses", which is exactly the provider-independence seam (PRD §6.2).

**Not done, by the evidence:**
- config trims alone (neutral, research §0; kept only because D3 ships the measured configuration);
- a three-way split (approaches the ~4–6 s floor, +$0.018 per document);
- PTU or priority processing (a >80 tok/s floor cannot meet 10 s; research §5.G–H);
- turning off source/confidence (reopens decisions 10/16).

**Risks:**
- **The tables pass is re-provisioned with the trims** and was not measured that way (D3). The cell
  floor catches a regression; if it trips, rebuilding `_tables` without the trims is a one-line
  follow-up, and a second paid run needs the product owner.
- **Six analyses in flight** at full concurrency (D6). History/05 found no per-request penalty at
  three; a busy multi-payslip session is the case to watch in the deployed measurement.
- **Cost:** ~$0.065 per payslip, further above PRD §11.4's $0.01–0.02 per page (ROADMAP §5).
- **Deploy window (D11):** uploads between the push and the env switch fail as retryable
  `provider_unavailable`.
- **Upload is sent twice** for the scalars pass (once per part). On Render that is 0.28–0.86 s in
  parallel (research §3); on the development machine's uplink it is visibly more.

**Confidence:** 8/10 for one-pass implementation. The design is small and measured. The two places
that need care are the provider tests' stub (concurrency) and the harness signature for mixed
legacy/split sets.
