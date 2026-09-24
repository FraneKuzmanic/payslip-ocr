# 04 — Content Understanding provider, mapper & scoring harness

**Date:** 2026-09-24
**Plan:** [`plans/04-content-understanding-provider.md`](../plans/04-content-understanding-provider.md)
**Outcome:** uploading a payslip now extracts it. The upload route enqueues the file on an
in-process runner (three at a time, 120 s budget each). The runner calls a Content Understanding
provider ported from the bake-off, maps the printed values to canonical fields with the Task 02
parsers, and writes `review` with `canonical_data`, `extraction_metadata` and the raw response
verbatim, or `failed` with a classified reason. All 11 golden-set payslips extract end to end
through the real API. `npm run score:extraction` scores recorded responses through the production
mapper and exits non-zero when anything cannot be measured.

## What was built

| File | Contents |
| --- | --- |
| `api/src/providers/document-extraction/content-understanding/field-schema.ts` | The field schema, moved verbatim from `scripts/bakeoff/` (D8); the bake-off file re-exports it |
| `…/content-understanding/analyzer.ts` | `toCuField`, `buildAnalyzerDefinition`, `ANALYZER_DESCRIPTION` |
| `…/content-understanding/fields.ts` | `mapAnalyzeResult`: the pure mapper (D10) |
| `…/content-understanding/provider.ts` | `ContentUnderstandingProvider`: streamed submit with the stall budget and resubmit, 1 s polling, D9 classification |
| `…/content-understanding/usage.ts` | `estimateUsageCost` from the responses' `usage` blocks |
| `…/content-understanding/index.ts` | `createDocumentExtractionProvider()` from `config` |
| `api/src/services/payslip-extraction.ts` | `createExtractionRunner` (FIFO semaphore), `STALE_EXTRACTION_MS` |
| `api/src/scoring/score.ts` | Provider-neutral `scoreSet`, `UnscoredExpectationError`, `strictTextKey`, `textKey`, `percentiles` |
| `api/src/provider-vocabulary.test.ts` | The `api/src` vocabulary guard (D4) |
| `api/src/routes/extraction.integration.ts` | The opt-in paid golden run (D17) |
| `api/src/repositories/payslips.ts` | `PAYSLIP_COLUMNS` (no raw column on reads), `completeExtraction`, `failExtraction`, `failStaleExtractions`, `unreadableFields` on the detail state |
| `api/src/routes/{sessions,payslips}.ts` | Enqueue on upload; the lazy reaper on the three polled reads; `unreadableFields` in the detail response |
| `api/src/upload/source-file.ts` | `pdf_encrypted` now means "needs a password" (deviation 1) |
| `api/src/config.ts`, `render.yaml`, `.env.example`, `api/vitest.config.ts` | Four required CU settings plus `EXTRACTION_TIMEOUT_MS` and `EXTRACTION_CONCURRENCY` (D1) |
| `scripts/score-extraction.ts`, `scripts/provision-analyzer.ts` | The harness CLI and the provisioning/drift-check CLI |
| `scripts/run-supabase-integration-tests.mjs` | `--extraction`, hosted only |
| `package.json` | `score:extraction`, `provision:analyzer`, `test:extraction` |
| `api/package.json` | `pdfjs-dist` 6.3.289, the version the client already pins |

Tests: `fields`, `provider`, `usage`, `payslip-extraction`, `score` and `provider-vocabulary` (new),
plus additions to `payslips.test.ts` and `source-file.test.ts`.

## Design decisions carried

D1–D17 as the plan states them, with D5 and step 15 amended before execution (concern 1 below). In
brief:

- **D1:** the CU settings are required at startup and reach Render as `sync: false` (human step H1).
- **D2:** background writes use the uploading user's token; no secret key at runtime.
- **D3:** stale `processing` rows fail as `provider_unavailable` on the next polled read after 15 min.
- **D4:** a second vocabulary guard over `api/src`, allowing only the provider module and `config.ts`.
- **D5:** the harness fails when it cannot measure, and reports targets without gating on them.
- **D6:** low confidence and grounding stay with Task 06. The detail route fills `unreadableFields`
  and leaves `lowConfidenceFields: []`.
- **D7:** ADR-0001 corrected to Sweden Central.
- **D8:** the schema moved, and descriptions were untouched. The analyzer matches the code
  (checked by `provision:analyzer`, below).
- **D9–D17:** classification, mapper rules, no raw column on reads, 1 s poll, no
  `EXTRACTION_PROVIDER`, `processingLocation` left at `global` (PRD §9.4 now says so), dedicated
  repository methods, bytes held in memory, the paid run capped and costed.

## Concern resolved before execution

1. **`.bakeoff/cu-mini/` would have failed every harness run.** It holds CU bodies from the
   `gpt-4.1-mini` analyzer `hrPayslipMini`, with no B02. The plan counted every directory of CU
   bodies as a set, so the missing B02 would have made `score:extraction` exit 1 on every run, and
   a known −2.4 pp model difference would have been reported as run-to-run spread. **Fix:** a set
   must come from the configured analyzer, read from `result.analyzerId`; other directories are
   skipped by name. The harness prints `skipped .bakeoff/cu-mini/: analyzer 'hrPayslipMini', not
   'hrPayslipV1'`.

## Deviations from the plan

1. **`pdf_encrypted` now means "needs a password to open" (a Task 03 correction, decided by the
   product owner).** Golden-set B01 carries permissions-only encryption: standard handler V4/R4,
   `P -3884`, an owner password and no user password. It opens in every reader, and the bake-off
   analysed it. Task 03's check refused any `/Encrypt`, so the golden run could not pass. The
   validator now asks pdf.js, the reader the client renders with, whether the file opens with no
   password. This added `pdfjs-dist` to `api/`, a one-line lockfile change with no platform entry
   lost. Tests:
   - a real permissions-only PDF, its `/U` computed for the empty password (ISO 32000 algorithms
     2 and 4), is accepted;
   - a `/U` matching no empty password is `pdf_encrypted`;
   - the old fixture (`/Encrypt 1 0 R` pointing at the catalog) is a broken PDF, and is now
     `pdf_unreadable`.

   The hosted Task 03 suite now builds a genuine password-protected PDF.
2. **The 5 s submit budget starts when the body has been sent.** Paid run 2 failed B02 (3.6 MB)
   every time. Measured: this machine's uplink takes about 8 s to send it (8.1, 8.0 and 7.8 s to
   Storage). As ported, the budget ran from the request's start, so every one of four attempts
   aborted mid-upload. The stall the budget exists for is server-side, after the body arrives
   (ADR-0001: connect is always <0.15 s). The bake-off never saw this because its B02 submitted in
   1.9 s on a faster link.
   - **The fix:** the body is streamed, and the budget starts when `fetch` takes its last chunk.
     Measured against Storage, that chunk was taken at 7.0 s of an 8.3 s upload. `Content-Length`
     is sent explicitly, so the body is not chunked.
   - **The option:** `submitTimeoutMs` joins `pollIntervalMs` as a constructor option, so a unit
     test can prove a slow upload no longer counts as a stall.
   - **Locked decision 12 is unchanged.** It is still 5 s with resubmit, now measured as it was
     meant to be.
   - **Not fixed:** the bake-off's `run-cu.ts` keeps the old behaviour. It is the reference
     implementation.
3. **`strictTextKey` strips whitespace and punctuation**, rather than only collapsing whitespace.
   That way the strict and lenient lines differ **only** in diacritics, and every strict-only miss
   is a diacritic misread, as D5 intends. A punctuation-spacing difference (`5,10000` against
   `5, 10000`) would otherwise have counted as a strict miss.
4. **The cost estimate lives in the provider module** (`usage.ts`), because `usage` is provider
   vocabulary. The golden-run test imports it rather than naming its fields. It reproduces the
   plan's figures exactly over `.bakeoff/cu`: 13 pages, 802 uncached input, 121,472 cached input,
   16,617 output, **$0.273**.
5. **The golden run's report is written with `process.stdout.write`.** Vitest drops a passing test's
   `console.log` (verified with a probe), so run 3's per-sample lines were lost. Each recording now
   also carries `uploadMs`, `analyzeMs` and `submitAttempts` next to `latencyMs`, so Task 05 can
   split latency without a paid re-run. The run also sets the logger to `error`, so a server fault
   prints.
6. As planned and recorded: **D13** (no `EXTRACTION_PROVIDER`), **D15** (three named repository
   methods instead of a wider `UpdatePayslipInput`), and **D6** (amending Task 03 open item 1).

## Scoring

`npm run score:extraction` (no network):

| Set | Scalars (strict) | Bake-off-comparable | Critical | Line-item cells | Rows exact | payComponents naziv+iznos | Latency p50 / p90 / max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `cu` (bake-off recordings) | **270/273 98.9%** | 270/273 | 74/77 | **502/548 91.6%** | 30/32 | 170/180 | 13.4 / 22.5 / 26.3 s (sequential) |
| `production` (paid run 3) | **271/273 99.3%** | 271/273 | 75/77 | **504/548 92.0%** | 30/32 | 170/180 | 20.5 / 45.7 / 66.3 s (3 in flight) |

**Run-to-run spread: 1 field (0.4%)**, inside the documented ~0.5% band. Both sets clear ≥95% and
≥85%.

Per table (`cu` / `production`): `payComponents` 343/360 on both, `obustave` 122/150 and 124/150,
`neoporeziviPrimici` 37/38 on both. `obustave` is the weak table. The misses are A01's `Č`/`Ć` read
as `C` (strict scoring) and A04's rows misaligned by the model. None is a mapper fault.

**Against the bake-off.** The bake-off implied 271/273 on these 25 scalars: its 281/284 includes 10
`currency` hits. Set `cu` is **one instance lower**. That instance is G01 `netoPlaca`: the service
returned `"1.219.08"`.
- **Why it now misses:** `parseAmount` rejects the two-dot form and lists the field as unreadable,
  rather than guessing. The bake-off had counted it a hit only because its lenient fallback compared
  `1219.08` and `121908` as digit strings.
- **Classification:** parser strictness, not a mapper bug. It is recorded rather than papered over
  (Task 02 open item 3).
- **The better fix is in the schema:** a description asking for one decimal separator. That is a
  measured change for later, because a description edit invalidates the recordings (D8).

**The D2 `1.200` risk** did not materialise: no recorded amount prints a grouped value without
cents. Strict and lenient scalars are equal on both sets: no scalar diacritic misread.

**Probes:**
- Moving `A01.json` out made the harness exit 1 with `cu: A01 has a recording but no expectation`.
  Restored, and `git status .agents/fixtures` was clean.
- A `// valueString` probe under `api/src/services/` failed the vocabulary guard. Removed.

## Paid runs (Azure for Students credit)

| Run | When | Result | Cost |
| --- | --- | --- | --- |
| 1 | 17:34 | A01 and A02 uploaded, then A03's **upload** returned 500 (below); stopped | ~$0.05 est. (two analyses) |
| 2 | 17:47 | All 12 uploads succeeded; B02 failed extraction (deviation 2) | ~$0.25 est. (ten analyses plus the blank; nothing recorded, the test failed first) |
| 3 | 17:53 | **Pass**: 11 × `review`, the blank PDF `failed` / `unreadable_document` beside G01 `review` | **$0.30** measured (13 pages, 20,977 uncached + 101,632 cached input, 16,662 output) |

**Running total for Task 04: about $0.60.** That is three runs, the cap D17 allows without asking.
The blank page's analysis is not in the measured figure, because a failed row keeps no response.

## Latency on the product path

This is not a Task 04 DoD item. It is Task 05's baseline, and it is worse than the bake-off, so it
was investigated before commit.

| Sample | A01 | A02 | A03 | A04 | B01 | B02 | C01 | D01 | E01 | F01 | G01 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Run 3 latency | 66.3 | 32.1 | 19.5 | 45.7 | 16.4 | 28.6 | 18.7 | 20.5 | 13.3 | 21.6 | 15.1 s |

**Cause: concurrent analyses share one deployment's throughput. It is not the submit path, and not
our code.**

- The service's own `result.createdAt` for A01 is 15:53:37. That is about 0.5 s after its upload
  row was inserted (15:53:36.6, Supabase edge log). So the submit was accepted at once.
- Its completion write landed at 15:54:44. The service-side analysis therefore took about 66 s,
  against 22.4 s in the sequential bake-off.
- The one difference: three analyses were in flight on one `gpt-4.1` deployment, which generates
  about 146 tok/s (the spec's decomposition). Per-document time rose while total time fell. All 11
  finished in about 95 s of wall clock; run one at a time at the bake-off's ~13–14 s each, they
  would have taken about 150 s.

`submitAttempts` for run 3 is unknown (deviation 5), and no operation `Failed` or `Canceled` was
observed, so there are no CU error codes to record. The deployment's TPM capacity could not be read:
there is no Azure CLI on this machine. ROADMAP Task 05 now starts from this finding.

`latencyMs` also excludes queue wait, which a user does wait through. Task 05 has that too.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` (typecheck, lint, format, test) | green: 38 files, **472 tests** (406 before) |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run check:golden` | `ALL IDENTITIES AND CHECKSUMS PASS` |
| `npm run score -- cu` | `SCALAR FIELDS 281/284 98.9%`, unchanged (step 1's invariant) |
| `npm run provision:analyzer` | defaults present (`gpt-4.1`, `text-embedding-3-large`, among others); `analyzer 'hrPayslipV1' matches the code`; exit 0; GET-only |
| `npm run test:integration` | hosted `hxksulbgluvfxfoxrhse`: 3/3 auth + **16/16** payslips, with the no-op runner and the new password-protected fixture |
| `npm run test:extraction` | run 3 green (above) |
| `npm run score:extraction` | two sets, spread printed, exit 0 |
| Lockfile platform check (validate 6.22) | ok |
| Orphans (`execute_sql`) | 0 `task03-`/`task04-` users, 0 orphaned Storage objects, 0 sessions and 0 payslips |
| `get_advisors` (security) | only the known project-level `auth_leaked_password_protection` |

Not run: browser journeys. No UI changed; Task 07 is the first client-to-API call.

## Open items for later tasks

1. **The run-1 upload 500 is unexplained.** A03's `POST /api/sessions/:id/payslips` returned 500
   with real analyses in flight, and the request never reached Supabase (edge logs). It did not recur
   in 20 uploads with the provider unreachable, nor in runs 2 and 3 (23 uploads). The integration
   config's `LOG_LEVEL: silent` hid the error. The golden run now logs at `error`, so a recurrence
   prints its cause. Watch for it in Task 07's browser journeys.
2. **Task 05:** start from "Latency on the product path". Measure a single-document baseline, and
   check the deployment's TPM in the portal, before choosing between partial results and two-pass.
3. **Task 06:** grounding over `pages[].words` and the confidence threshold (D6, now in its scope).
4. **Task 09:** the direct-write gap (D2, ROADMAP §5).
5. **Task 07:** refresh the Supabase session before an upload batch. A token near expiry at upload
   can fail the background completion write, which the reaper then fails as retryable (ROADMAP §5).
6. **Field schema:** asking for a single decimal separator would recover G01 `netoPlaca`. This is a
   measured, re-recorded change, never a parser rule.
7. **H1, before the subtree push:** set `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`,
   `AZURE_CONTENT_UNDERSTANDING_KEY`, `AZURE_CU_ANALYZER_ID` and `AZURE_CU_API_VERSION` on
   `payslip-ocr-api` in the Render dashboard. The API refuses to start without them.

## Post-completion review and validation

`/code-review` (standards and spec axes) ran on the uncommitted work on 2026-09-24. Each finding
was checked against the code before it was acted on.

**Fixed:**

1. **The runner could pay for an analysis the reaper had already failed.** D3 sized the 15 min
   cutoff to "exceed the worst queue wait", but the queue is shared by every user and unbounded.
   About 22 jobs queued behind timing-out analyses would be reaped while still waiting, then
   analysed anyway, with the result discarded. Now a job whose queue wait plus
   `EXTRACTION_TIMEOUT_MS` would pass the cutoff is failed as `provider_unavailable` without calling
   the provider, and logs `extraction expired in the queue`. Tested with a fake clock; the test
   fails without the fix.
2. **The harness did not check table rows for unknown keys (D5).** An extra or misspelt column
   key inside a row, or a table expectation that is neither a list nor `null`, was scored silently.
   Both now fail the run. The 11 fixtures carry exactly `TABLE_COLUMNS`, so no score moved: 98.9% /
   99.3%, spread 1 field.
3. **The per-sample table columns are row counts** (`extracted/expected`), not hits. The header now
   says so. F01's `6/5` is one extra `payComponents` row, not a scoring error.

**Rejected, with evidence:**

- *"`content-understanding` imports leak past the vocabulary guard."* The guard bans provider
  vocabulary, not the module path. `app.ts` is the composition root, and the golden run imports
  `usage.ts` on purpose (deviation 4).
- *"`err:` log lines may carry document text."* pino's error serializer writes the cause's
  `message` only, never PostgREST's `details` (where "Failing row contains" would appear); checked
  with a probe. Task 03's error handler logs the same way.
- The duplicated reaper call, the hand-listed `PAYSLIP_COLUMNS` (D11) and the table-column lists
  repeated across the mapper, the schema and the scorer are judgement calls, left as they are.

**Recorded, not changed:** the 5 s submit budget starts only once the body has been sent
(deviation 2). A stall *before* that point, in connect or TLS, or a server that stops reading the
body, gets no resubmit, only the 120 s whole-analysis timeout. ADR-0001 measured connect at
<0.15 s, so this is a residual risk rather than a known fault.

**Re-validated:** `npm run validate` green, 38 files and **474 tests**. `npm run score:extraction`
unchanged. `npm run provision:analyzer` matches. `npm run build` and `npm run check:golden` pass.
Browser smoke test with agent-browser against `npm run dev`: `/api/health` answers with the
Content Understanding settings loaded, the sign-in page renders in both languages, and there are no
console errors. No upload was driven in the browser, because there is no capture UI before Task 07
and the paid golden run already covers the upload path.
