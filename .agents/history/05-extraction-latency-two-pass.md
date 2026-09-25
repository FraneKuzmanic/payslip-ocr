# 05 — Extraction latency: two-pass extraction

**Date:** 2026-09-24/25
**Plan:** [`plans/05-extraction-latency-two-pass.md`](../plans/05-extraction-latency-two-pass.md)
**Outcome:** extraction now runs as two passes over each document. The scalars pass makes the
form usable, and the tables pass fills the three line-item tables. They run concurrently, are
recorded atomically in either order, and a waiting scalars pass always goes first.
**The ≤10 s first-form target is missed:** one payslip at a time, first-form p50 is **12.2 s**,
against 20.7 s single-pass on the same path. The measured cause is the service's generation rate
on the day, not the design. The product owner accepted this on 2026-09-25 (option A below).
Scalar accuracy holds. Cost per document rose ~1.5×.

## What was built

| File | Contents |
| --- | --- |
| `supabase/migrations/20260924194757_two_pass_extraction.sql` | `tables_status` (`pending \| ready \| failed`) with backfill; `complete_extraction_pass`, an invoker-rights function merging one pass with `jsonb \|\|` (D7) |
| `api/src/database.types.ts` | Regenerated: `tables_status`, `Functions.complete_extraction_pass` |
| `shared/src/session.ts`, `payslip.ts`, `api.ts`, `index.ts` | `TABLES_STATUSES`, `tablesStatusSchema`; `tablesStatus` on `payslipSchema` (server-set, refused by PATCH) and the session summary |
| `api/src/providers/document-extraction/types.ts` | `EXTRACTION_PASSES`, `ExtractionPass`; `pass` on the input; `queuedMs` on metadata; partial `fields` |
| `…/content-understanding/analyzer.ts` | `analyzerIdFor`, `passFields`, `buildAnalyzerDefinition(model, pass)` |
| `…/content-understanding/fields.ts` | `mapAnalyzeResult(body, pass?)`: only the pass's keys; no pass maps all (harness only) |
| `…/content-understanding/provider.ts`, `index.ts` | `analyzerFamilyId`; submits to `<family>_<pass>`; tables are unreadable only without text (D9) |
| `api/src/services/payslip-extraction.ts` | Two passes per job on a priority semaphore; scalars failure cancels tables; `queuedMs`; per-pass log lines |
| `api/src/repositories/payslips.ts` | `completeExtractionPass` (RPC), `failTablesExtraction`, reaper for pending tables (D10), per-pass metadata read |
| `api/src/routes/sessions.ts` | `tablesStatus` in the session summary |
| `api/src/scoring/score.ts`, `scripts/score-extraction.ts` | Two-pass sets; `FIRST FORM`, `COMPLETE`, `FIRST FORM PER PAGE`; spread per kind; `TWO-PASS vs SINGLE-PASS` |
| `api/src/routes/extraction.integration.ts`, `scripts/run-supabase-integration-tests.mjs` | `GOLDEN_MODE`, required `GOLDEN_SET` (refuses an existing set); two-pass recording shape; per-pass report |
| `scripts/provision-analyzer.ts` | Manages `<id>_scalars` and `<id>_tables`; the single-pass `<id>` stays deployed, unmanaged |
| `.env.example` | `AZURE_CU_ANALYZER_ID` names the family; the concurrency counts analyses |

New tests: `analyzer.test.ts`. Extended: `fields`, `provider`, `payslip-extraction` (rewritten for
passes), `payslips` (repository), `score`, the shared contract tests, and 8 hosted integration
cases (either-order merge, discards, cross-user refusal, invalid pass, reaper).

Azure: `hrPayslipV1_scalars` and `hrPayslipV1_tables` created by `npm run provision:analyzer`.
Supabase: migration `two_pass_extraction` applied once, after a transactional dry run.

## Design decisions carried

D1–D14 as the plan states them. In brief:

- **D1:** Content Understanding has no partial results or streaming, so the extraction is split.
- **D2:** first form = scalars `queuedMs + latencyMs`, one payslip at a time; the client → API
  upload is excluded.
- **D3:** at most five paid runs; four used (below).
- **D4:** the TPM quota (500K) is not the limit. See the finding below: concurrency is not the cause either.
- **D5:** partition by `type === "array"`; descriptions untouched; `ukupnoSati` in scalars;
  derived IDs, so there is no new variable and no Render step.
- **D6:** `tablesStatus` as its own field; confirm refused while `pending` (Task 09).
- **D7:** one atomic SQL function per pass; each pass sends only its own keys.
- **D8:** the cap counts analyses; scalars before tables; cancellation; `queuedMs`.
- **D9:** tables failure → `tables_status = failed` only; three empty tables are a result.
- **D10:** the reaper fails pending tables by `updated_at`.
- **D11:** warnings recompute per pass, recorded in Task 06's scope.
- **D12–D13:** harness and golden-run changes as built.
- **D14:** no UI, no tables-only retry, no model change, no schema trim.

## Deviations from the plan

1. **The plan was committed first** (`54197b7`), so step 1's clean-tree check could pass, as
   earlier tasks did with their plans.
2. **A discarded scalars write also cancels the tables pass.** The plan cancels on a scalars
   failure and on a thrown write. A discarded write (`false`) means the payslip was deleted or
   reaped, so its tables write would be discarded too, and analysing it would waste money. Tested.
3. **Failed passes log at `warn`, and the golden run prints `warn`** (it printed `error`). The first
   R2 attempt lost the reason a pass failed (below). HTTP refusals were already `warn`.
4. **The D4 premise was wrong, and this was found at R1, not at the gate.** Recorded below. The plan's
   fallback, `EXTRACTION_CONCURRENCY=1`, is therefore not offered.
5. **`config.ts` was not changed** (step 18): it carries no doc comments on these variables.
6. **The scalar-accuracy DoD is not met by R3**, by one field (268 against D12's floor of 269). It
   was first ticked in error, and caught by the spec review. Raised with the product owner, who
   accepted it as run-to-run variance on 2026-09-25, rather than spending the fifth paid run.

## Finding: concurrency is not the cause of the slowdown

Effective generation rate, `output tokens ÷ (analysis − 4 s)`, for the same analyzer and tokens:

| Set | When (UTC) | Mode | Rate |
| --- | --- | --- | --- |
| `cu` (bake-off) | 2026-09-20 10:24 | sequential | 50–245 tok/s, A01 245 |
| `production` (Task 04 run 3) | 2026-09-24 15:53 | 3 in flight | 64–76 tok/s |
| `production-sequential` (R1) | 2026-09-24 19:39 | 1 at a time | 69–96 tok/s |

A01 emits ~4,300–4,500 output tokens in every set. It took 65.6 s alone against 66.3 s with three
in flight. history/04 attributed the slowdown to concurrent analyses sharing one deployment; that
was wrong. The service was uniformly slower than on 20 September. A direct streamed completion on
the `gpt-4.1` deployment measured 1.79 s to first token and **99 tok/s** (~$0.006), so most of it is
the deployment's own rate on the day, with Content Understanding overhead on top.

## Latency

**R1: single-pass, one at a time** (`production-sequential`, 2026-09-24 19:39 UTC):

| | A01 | A02 | A03 | A04 | B01 | B02 | C01 | D01 | E01 | F01 | G01 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| latency | 66.8 | 31.3 | 17.2 | 46.2 | 15.8 | 27.2 | 19.0 | 21.4 | 11.3 | 20.7 | 12.3 s |
| submit | 1.1 | 1.5 | 0.7 | 2.3 | 0.5 | 8.3 | 0.6 | 1.2 | 0.3 | 1.2 | 1.4 s |

p50 20.7 s, p90 46.2 s, max 66.8 s. One submit attempt each.

**R2: two-pass, one at a time** (`two-pass-sequential`, 2026-09-24 20:08 UTC):

| Sample | first form | complete | scalars submit / analysis / out tok | tables analysis / out tok |
| --- | --- | --- | --- | --- |
| A01 | 15.1 | 54.4 | 0.9 / 14.3 / 664 | 53.5 / 3,770 |
| A02 | 9.1 | 23.7 | 2.9 / 6.2 / 627 | 20.7 / 1,348 |
| A03 | 11.2 | 13.7 | 0.5 / 10.7 / 608 | 12.7 / 487 |
| A04 | 10.1 | 36.6 | 2.8 / 7.3 / 634 | 33.5 / 2,275 |
| B01 | 10.0 | 10.0 | 0.5 / 9.5 / 580 | 4.7 / 303 |
| B02 | 28.2 | 29.6 | 16.3 / 11.9 / 603 | 13.1 / 642 |
| C01 | 12.3 | 12.7 | 0.6 / 11.7 / 619 | 12.1 / 535 |
| D01 | 13.9 | 13.9 | 2.1 / 11.8 / 630 | 10.8 / 541 |
| E01 | 9.9 | 63.8 | 0.2 / 9.6 / 483 | 63.5 / 249 |
| F01 | 12.2 | 12.2 | 1.7 / 10.5 / 596 | 9.3 / 526 |
| G01 | 14.0 | 14.0 | 2.5 / 11.6 / 632 | 9.2 / 367 |

- **First form p50 12.2 s, p90 15.1 s, max 28.2 s: the ≤10 s gate is missed.** Mean 13.3 s, or
  11.8 s without B02, whose 16.3 s submit is this machine's uplink. Per page, p50 is 10.1 s.
  Server-side only (first form − submit), the median is 10.7 s, so the uplink is not the cause.
- **Against R1:** p50 20.7 → 12.2 s, p90 46.2 → 15.1 s. The large documents gain most (A01
  66.8 → 15.1 s, A04 46.2 → 10.1 s). Small ones barely move, or lose (G01 12.3 → 14.0 s).
- **Why the gate is missed:** a scalars pass emits ~600 tokens and took 6–14 s at the day's rate.
  The ~4 s floor plus ~600 tokens at 70–100 tok/s is 10–12 s: the service rate, not the design.
- **B02** submitted in 16.3 s: two concurrent uploads over this machine's ~8 s uplink, as the plan
  predicted.
- **Complete** p50 14.0 s, p90 54.4 s. E01's tables took 63.5 s for 249 tokens.

**R3: two-pass, all eleven at once** (`two-pass-concurrent`, 2026-09-25 07:38 UTC). Report only:

- **First form:** p50 27.9 s, p90 32.6 s, max 35.2 s. With the cap at 3 analyses, the 12 uploads
  queue: scalars waited up to 25 s.
- **Complete:** p50 71.2 s, and all done in **76 s of wall clock**, against ~95 s for Task 04's
  single-pass run under the same condition.
- **Priority worked:** every scalars pass ran before any tables pass, and tables waited 52–68 s.
- PRD §11.4's "four in parallel ≤25 s" line was not measured as such. Eleven at once is the harder
  case.

**Decision gate (step 16) and outcome.** The executor stopped at R2 and reported. The product
owner chose **A**, 2026-09-25: accept the miss, finish the task, record the figures. The
alternative (**B**) stays open: split the scalars pass further (two or three ~200–300-token
passes), estimated at ~7–8 s at the day's rate for ~$0.01–0.02 more per document. It is viable
because concurrent analyses cost nothing measurable.

## Scoring

`npm run score:extraction` (no network), five sets:

| Set | Kind | Scalars | Critical | Line-item cells | `obustave` cells | Latency / first form p50 |
| --- | --- | --- | --- | --- | --- | --- |
| `cu` | single | 270/273 | 74/77 | 502/548 | 122/150 | 13.4 s |
| `production` | single | 271/273 | 75/77 | 504/548 | 124/150 | 20.5 s |
| `production-sequential` (R1) | single | 272/273 | 76/77 | 503/548 | 108/150 | 20.7 s |
| `two-pass-sequential` (R2) | two | 271/273 | 75/77 | 478/548 | 97/150 | 12.2 s |
| `two-pass-concurrent` (R3) | two | 268/273 | 73/77 | 502/548 | 118/150 | 27.9 s |

Run-to-run spread: single-pass 2 fields (0.7%), two-pass 3 fields (1.1%).

**Scalars.** R2 is inside the band. R3 is **one field under D12's floor** (269). Its misses:

- **A04 `iznosZaIsplatu`:** occluded, so the correct answer is null. R3 returned `2033.32`, as did `cu` and R2.
- **F01 `employerName`:** the correct answer is null. R3 returned the employee's name; `cu` returned "ZAGREB".
- **G01 `netoPlaca`:** the known `1.219.08` case, missed in every set (history/04 open item 6).
- **B01 `period`:** R3's scalars pass printed `"2025, MJESEC 6"`, which the mapper lists as
  unreadable rather than guessing. The same analyzer returned `2025-06` in R2, and the field sits
  at 0.02–0.3 confidence in every run.

Every miss is a field that also flips between runs of one design. **No parser rule was added** for
`MJESEC 6`: that is the rule creep ROADMAP §5 warns against. The fifth paid run was not spent to
break the tie.

**Line-item cells.**

- **R2 lost 24 cells** (478), all in `obustave`, almost all A01's 18 rows returned in a different
  order. The scorer compares rows by index, so a permutation costs ~20 cells. R1 (single-pass) also
  mis-orders A01's rows 1–5, and R1's `obustave` is itself 108, against 122–124 for `cu`/`production`.
- **R3 is 502**, inside the single-pass range. The row order of this two-column layout is unstable
  under both designs.
- **One plausibly systematic effect:** in R2 the tables pass took C01's IP1 statutory breakdown
  ("redoviti rad prema rasporedu radnog vremena", "naknada za godišnji odmor", …) instead of the
  employer's pay rows. Without the scalar fields in its schema, the tables analyzer has less context.
  It did not recur in R3.

## Cost per document (measured, the DoD's "known number")

| | Run | Cost / 11 | Per document |
| --- | --- | --- | --- |
| Single-pass | R1 | $0.34 | **$0.031** |
| Two-pass | R2 | $0.49 | **$0.045** |
| Two-pass | R3 | $0.56 | **$0.051** |

~1.5× (the spec estimated 1.6×). **Against PRD §11.4's ≈ $0.01–0.02 per page this is over target:**
13 pages per golden run gives $0.026/page single-pass (R1) and $0.038–0.043 two-pass. The
bake-off's ~$0.021 was already at the edge. Found in the post-commit audit and now carried in
ROADMAP §5. Pages double (13 → 26), and input tokens roughly double. How much
is cached varies by run (R3: 107,559 uncached against R2's 65,575), which is most of the R2/R3
difference.

## Paid runs (Azure for Students credit)

| # | When (UTC) | Run | Result | Cost | Running total |
| --- | --- | --- | --- | --- | --- |
| 1 | 09-24 19:39 | R1 single-pass sequential | pass | $0.34 | $0.34 |
| — | 09-24 ~19:47 | Probe: `gpt-4.1` streamed completion | 99 tok/s | ~$0.006 | $0.35 |
| 2 | 09-24 20:01 | R2, first attempt | E01 tables failed; not recorded | ~$0.45 est. | $0.80 |
| — | 09-24 ~20:07 | Probe: E01 tables pass | succeeded, 6.8 s | ~$0.02 | $0.82 |
| 3 | 09-24 20:08 | R2, second attempt | pass; gate missed | $0.49 | $1.31 |
| 4 | 09-25 07:38 | R3 two-pass concurrent | pass | $0.56 | $1.87 |

**Running total for Task 05: about $1.87.** That is four of the five budgeted golden runs.

**The first R2 attempt.** E01 ended `review` with `tablesStatus: failed`, and the reason was not
printed (deviation 3).

- **Supabase edge logs:** its scalars write landed 10.5 s after upload, and the tables failure
  about 2 s later. So it failed fast, not by timeout.
- **A direct tables-pass call** on E01 succeeded between the two attempts.
- **Conclusion:** intermittent and service-side. It is not reproduced, and its reason is unknown.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` | green: 39 files, **507 tests** (474 before) |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run check:golden` | `ALL IDENTITIES AND CHECKSUMS PASS` |
| `npm run provision:analyzer` | both pass analyzers match the code; exit 0 |
| `npm run test:integration` | hosted: 3/3 auth + **24/24** payslips (16 before) |
| `npm run test:extraction` | R2 and R3 green (above) |
| `npm run score:extraction` | five sets, spread per kind, exit 0 |
| Harness two-pass path, offline | a synthetic two-pass set built from `cu` bodies scored exactly as `cu` (270/273, 502/548); deleted afterwards |
| Lockfile | unchanged |
| Orphans (`execute_sql`) | 0 `task0N-` users, 0 payslips, 0 sessions, 0 Storage objects |
| `get_advisors` (security) | only the known `auth_leaked_password_protection` |

Not run: browser journeys. No UI changed, and Task 07 is the first client-to-API call.

## Open items for later tasks

1. **Latency option B** (split the scalars pass further) is open, and is the one lever left. The
   product owner accepted 12.2 s for now and **expects latency improved in a later phase**. Re-measure
   on another day first: the 20 September rate would already put a scalars pass near 7 s.
2. **Task 06:** warnings per pass, the sum check only when `ready`, grounding from the scalars body
   (ROADMAP amended).
3. **Task 07:** hr/en copy for `TABLES_STATUSES` (ROADMAP amended).
4. **Task 08:** regions from both bodies (ROADMAP amended).
5. **Task 09:** confirm refused while `pending`, and table fields read-only while `pending`. Decide
   whether `review` + tables `failed` needs a tables-only retry or a stored reason (D9).
6. **The E01 tables failure** is unexplained. With `warn` logging, a repeat now prints its reason.
7. **Deploy:** the migration is live and additive; the deployed Task 04 API ignores
   `tables_status`. Pushing this code needs Task 04's H1 (the four `AZURE_CU_*` variables on Render)
   and nothing new: the pass analyzer IDs are derived.
8. **The concurrent-run row-order instability** on A01 `obustave` affects both designs, and costs
   ~20 cells whenever it happens. It is worth knowing before anyone ranks runs by cell counts.
9. **Retry (PRD §10.8) must reset `tables_status` to `pending`.** The tables pass writes only while
   pending. A payslip whose tables landed before its scalars pass failed is `failed` with tables
   `ready`, and a retry that left that alone would have its new tables write refused.

## Post-completion review and validation

`/code-review` (standards and spec axes) ran on the uncommitted work on 2026-09-25. Each finding
was checked against the code before it was acted on.

**Fixed:**

1. **The scalar-accuracy DoD was ticked although R3 fails D12's test** (268 against the floor of
   269). It is now unticked in ROADMAP, the spec's wording is corrected, it is recorded as deviation
   6, and it is raised with the product owner.
2. **The reaper's comment claimed a `processing` payslip's tables are always pending.** They are not:
   the tables pass may land first, and a hosted test asserts `processing` + `ready`. The comment now
   says what happens: a reaped payslip's `ready` tables become `failed` on a payslip that is failing
   anyway. Filtering that update to `pending` would take a second update, and the first one's
   `updated_at` bump would stop the second from matching.
3. **The paid-runs table** gained a running total, and its rows are now in time order.
4. **Judgement calls taken:** a named `Percentiles` type (it was written out three times), the
   harness's signature constants renamed, and `ExtractionPass` used instead of a string union.

**Rejected, with evidence:**

- *"Payslips extracted before this change lose `unreadableFields`."* The hosted database held 0
  payslips when the migration ran (step 1), and D7 chose not to write a reader for a shape the
  product never stores again.
- **Left as they are (judgement calls):** the duplicated `tables_status = failed` update chains, the
  repeated merge lines in the two SQL branches, and `perPage` re-reading its set. Each reads more
  plainly in place.

**Product owner, 2026-09-25:** R3's one-field miss is accepted as run-to-run variance, and the DoD
item is ticked on that basis.

**Final checks before commit:** the `/validate` Phase 6 checks this change touches passed:

- 6.1 and 6.1b (`.env.example`: no `VITE_` secret, names only);
- 6.2 (no secret in the built bundle);
- 6.3, 6.4 and 6.4b (`.env` ignored; no payslip source or `.bakeoff/` recording tracked);
- 6.8 (money never a number).

Phase 0 is moot, since the lockfile is unchanged. Phase 9 browser journeys were not run: no UI
changed, and `tablesStatus` is an additive response field.

**Re-validated:** `npm run validate` green, 39 files and 507 tests. `npm run score:extraction`
unchanged (single-pass spread 2 fields, two-pass spread 3; R3 below the floor, R2 within).
