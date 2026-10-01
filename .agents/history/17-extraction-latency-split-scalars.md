# 17 — Extraction latency: split the scalars pass, poll faster

**Date:** 2026-10-01
**Plan:** [17-extraction-latency-split-scalars.md](../plans/17-extraction-latency-split-scalars.md)
**Evidence:** [research/extraction-latency.md](../research/extraction-latency.md) §0
**Starting state:** clean at `69e1f0b` (Task 16), plus the untracked `.agents/research/` and plan 17.
Baseline `npm run validate`: 76 files / 1,221 tests, green.

**Outcome:** the split is built, provisioned and measured.

- The scalars pass runs as two analyses at once inside the provider (`_header`, `_reconciliation`)
  on a new `hrPayslipV3` family; the runner, database, routes and client do not know (D1).
- The provider polls every 250 ms and the client every 500 ms (D7).
- Golden run: **first form p50 9.1 s** (target ≤ 10 s), scalars **272/273**, critical **76/77**.
- **Line-item cells 468/548 as returned, under the plan's floor of 478.** Under D10 the session
  recorded it, stopped and told the product owner, who asked for the row order to be fixed if a
  $0 prototype showed it was the fix. It did: **table rows are now stored in printed order (D13,
  below), which scores this set 495/548** and every earlier set 502–518, with no further paid
  run. F01's extra total row (15 cells) is not addressed (open item 1).

**Status: implemented, then reviewed and validated in a separate session (below); not
committed.** Render is untouched. **Paid runs: 2, about $1.14** (one failed on infrastructure before recording; below).

## What was built

Paths are relative to this project root.

| Created | Contents |
| --- | --- |
| `.agents/history/17-extraction-latency-split-scalars.md` | This record |
| `api/src/providers/document-extraction/content-understanding/row-order.ts` (+ test) | `inPrintedOrder`, `storedRowOrder`, and `parseSegment`, moved from `regions.ts` (D13) |
| `.bakeoff/task17-sequential/` (git-ignored) | The first V3 recording set, 11 samples |
| Azure: `hrPayslipV3_header`, `_reconciliation`, `_tables` | Provisioned from the code (step 9) |

| Modified file | Change |
| --- | --- |
| `api/src/providers/document-extraction/content-understanding/field-schema.ts` | `currency` removed (D3) |
| `…/analyzer.ts` (+ test) | `SCALAR_PARTS`, `AnalyzerRole`, `ANALYZER_ROLES`, `roleFields` (replaces `passFields`); `analyzerIdFor` and `buildAnalyzerDefinition` take a role; `enableFormula: false` (D2–D4) |
| `…/fields.ts` (+ test) | `scalarPartBodies` and `mapRetainedPass`: either stored shape, each scalar from the part that owns it (D5, D9) |
| `…/provider.ts` (+ test) | `#analyze`; the scalars pass submits both parts, aborts the other when one fails, merges; metadata per D5; poll default 250 ms (D1, D5, D7) |
| `…/regions.ts`, `original.ts`, `usage.ts` (+ tests) | Read both shapes through the helpers (D9) |
| `api/src/services/payslip-extraction.ts` | Comments only: the cap counts passes (D6) |
| `api/src/routes/extraction.integration.ts` | The quads report text (D6) |
| `client/src/routes/SessionPage.tsx` | `POLL_INTERVAL_MS = 500` (D7) |
| `scripts/provision-analyzer.ts` | Loops over roles; drift check compares config; the "never run with V1/V2" warning (D2, D8) |
| `scripts/score-extraction.ts` | Accepts the single-body and the split signature; maps through `mapRetainedPass` (D9) |
| `api/src/providers/document-extraction/types.ts` | `ExtractionMetadata.rowOrder` (D13) |
| `api/src/repositories/payslips.ts` (+ test), `api/src/routes/payslips.ts` | `findRetainedResponses` also returns `extractionMetadata`; the regions and PATCH routes pass it on (D13) |
| `…/regions.fixture.ts` | `mappedPass` marks the tables pass as the provider does (D13) |
| `PRD.md` | §4.3, §7.3, §7.4 (the split, and rows in printed order), §9.2, §11.4 (two paragraphs), Appendix B |
| `CONTEXT.md`, `README.md`, `.agents/specs/two-pass-extraction.md`, `.agents/ROADMAP.md` | Extraction pass; three analyzers and cost; status line; §2 and §5 |
| `.claude/commands/validate.md` (git-ignored) | Phase 7: the V3 family, three analyzers, the warning, the V3 score |
| `.env` (git-ignored) | `AZURE_CU_ANALYZER_ID=hrPayslipV3`, set after provisioning (D11) |

## Decisions

Implemented plan D1–D12 as written, except for the deviations below.

## Deviations and implementation findings

1. **`enableBarcode: false` is not sent (D3 as written sets it).** The service drops the key in
   `2025-11-01`: the deployed config does not carry it (nor does `hrPayslipV2_scalars`'s), and
   barcodes still come back, in the experiment's trimmed analyzers and in this run (A01, one per
   page). D8's drift check therefore reported `(config)` drift on all three freshly created
   analyzers. Removing the key from the code changes nothing deployed: the analyzers built with it
   match the code without it, so they were not rebuilt, and they equal what the experiment measured.
   Research §0's "barcode off" was never in effect. `enableFormula: false` is kept and is echoed.
2. **The first paid run failed on infrastructure and recorded nothing.** 07:43:46–07:46:46 UTC:
   the eighth upload (D01) answered 500, "Could not store payslip source". Supabase's edge log holds
   the earlier Storage POSTs and none for D01, so the request never arrived from this machine.
   The harness writes recordings only after every sample settles, so the seven finished payslips
   (A01–C01) were paid for and lost: **about $0.46** (estimate, the same seven in the recorded run).
   Cleanup was verified: no user, payslip or object left. The plan says to ask before re-running;
   the product owner approved the re-run as is.
3. **The single-analysis provider tests moved to the tables pass.** `input()` now defaults to
   `tables`, which is still one analysis, so the stall, retry, streaming, classification and abort
   tests keep their sequential stub unchanged. The scalars pass has its own block on a stub routed
   by analyzer (`stubFetchByAnalyzer`). No behaviour test was deleted.
4. **Test readers the plan did not list** also read `stored.scalars` as one body:
   `regions.test.ts`'s recordings test (the mapped paths and the page count) and
   `original.test.ts`'s. They now go through `mapRetainedPass` and `scalarPartBodies`; the
   recordings test also asserts that both passes map, so a set in an unreadable shape cannot pass
   with half its paths missing. `original.test.ts` runs over `two-pass-sequential` and
   `task17-sequential`.
5. **`scalarPartBodies` tells the shapes apart without zod.** A body is an object with `result`;
   parts are an object with both part keys. In zod 4 `z.unknown()` keys are optional, so a schema
   would have accepted `{}`.
6. **`usage.ts` reuses `scalarPartBodies`** instead of a local "bodies of".
7. **`scripts/bakeoff/` shares `PAYSLIP_FIELDS`**, so a new bake-off run (`npm run cu`, `llm`) no
   longer asks for `currency`. Scoring the recorded bake-off sets is unchanged (`score -- cu`
   281/284).
8. `.bakeoff/latexp/run.ts` (git-ignored, the experiment) calls
   `buildAnalyzerDefinition(model, "scalars")` and no longer runs as it is. Its analyzers were
   deleted after the experiment.
9. Long Bash heredocs again failed to parse; edits ran as scratchpad Python scripts writing with
   `newline=""`.

## Red first

| Step | Red | Green |
| --- | --- | --- |
| 2 analyzer | the file failed to load (`roleFields`) | 13 tests |
| 3 fields | 15 failed | 40 tests |
| 4 provider | 8 failed (the ninth new test, a part the mapper cannot read, passed by the stub's error) | 31 tests |
| 5 regions, original, usage | 5 failed | 144 tests in the module |

## The paid run (D10)

`GOLDEN_SET=task17-sequential GOLDEN_MODE=sequential npm run test:extraction` (family V3 from
`.env`), 2026-10-01 08:08:01–08:12:46 UTC (283 s), **passed**. Recorded analyzer ids:
`hrPayslipV3_header`, `hrPayslipV3_reconciliation`, `hrPayslipV3_tables`. One pass resubmitted
(D01 scalars, 2 attempts).

| Measure | Value |
| --- | --- |
| Estimated cost | **$0.68** (39 pages, 111,739 uncached + 161,664 cached input, 18,049 output tokens); scalars $0.41, tables $0.27; **$0.062 a payslip** |
| Running total, Task 17 | **about $1.14**, two runs ($0.46 estimate + $0.68). The experiment's $1.17 is a research cost (research §0) |
| First form (`queuedMs + latencyMs`) | **p50 9.1 s**, p90 14.9 s, max 33.8 s |
| Scalars analysis (`analyzeMs`) | **p50 6.0 s**, p90 7.3 s, min 4.3 s, max 7.7 s |
| Scalars upload (`uploadMs`) | p50 3.0 s, max 28.1 s (B02): this machine's uplink, three uploads at once |
| Complete | p50 11.8 s, p90 39.0 s, max 61.9 s (A01's tables analysis, 60.5 s) |
| Output tokens | header 191–295, reconciliation 343–437 |

Per sample, first form (s): A01 8.4, A02 11.7, A03 7.0, A04 11.5, B01 6.7, B02 33.8, C01 8.1,
D01 14.9, E01 4.8, F01 9.3, G01 9.1. Every miss of 10 s is upload time: A02 4.0 s, A04 5.5 s, D01
7.6 s (a resubmit), B02 28.1 s. On Render the upload to the service measured 0.28–0.86 s
(research §3).

## Scoring (D10)

| Set | Family | Scalars | Critical | Cells | OIB checksum |
| --- | --- | --- | --- | --- | --- |
| **task17-sequential** | V3 | **272/273** | **76/77** | **468/548** | 19/19 |
| task16-sequential | V2 | 271/273 | 75/77 | 509/548 | 19/19 |
| two-pass-sequential | V1 | 271/273 | 75/77 | 478/548 | — |
| two-pass-concurrent | V1 | 268/273 | 73/77 | 502/548 | — |
| hosted-quads | V1 | 270/273 | 74/77 | 518/548 | — |

**Acceptance:** scalars ≥ 268 ✅. **Cells ≥ 478 ❌ (468).** First form p50 ≤ 10 s ✅ (9.1 s).

The one scalar miss is G01's `netoPlaca`, returned as `1.219.08` and so unreadable
(`unparseable_amount`, flagged). A04's occluded `iznosZaIsplatu` came back null this time, which is
what the fixture expects.

### Where the cells went

Against `task16-sequential`, by position, as the harness scores:

| Sample, table | V2 | V3 | What changed |
| --- | --- | --- | --- |
| A01 obustave (90 cells) | 75 | 49 | The same 18 rows in another order: the three rows of 40,00, 15,00 and 1,00 first. It is `two-pass-sequential`'s order exactly, the run that set the floor |
| F01 payComponents (20) | 20 | 5 | Six rows, not five: the total row `PLAĆA (BRUTO SVOTA) 2.009,94` came first, shifting the five correct rows down. It raises `pay_components_sum_mismatch`. Not seen in the four earlier two-pass sets |
| A04 obustave (35) | 27 | 25 | |
| B01 payComponents (12) | 12 | 11 | |

The other 29 sample-tables are equal. Two facts bear on the cause, both $0:

- The tables analyzer's schema is byte-identical to V2's (`currency` was a scalar), and its only
  config difference is `enableFormula: false`.
- **The markdown the tables analyzer read is byte-identical to the Task 16 run's for all eleven
  documents.** So the trim did not change what the model was given.

One run cannot separate a run-to-run effect from an effect of the new analyzer. What the evidence
supports: the shortfall is two row-level effects in the tables pass, one of them already recorded
on V1, on an unchanged input. What it does not support is a claim that the cells are within the
band: 468 is below every earlier set.

## Follow-up D13: table rows in printed order (2026-10-01, $0)

**Asked by the product owner** after the result above: do not trade accuracy for speed; if the
row order is a real problem and sorting by position fixes it, do it.

**The problem is real and older than this task.** A01's obustave came back in another order in
four of the eight recorded sets, single-pass ones included, and Task 16 D2's "rows in printed
order" in the field description did not stop it. The values are right; the rows are not where
the document prints them, and every positional comparison below a moved row fails.

**The prototype** sorted each table's rows in copies of all eight sets and scored them with the
real harness. Only A01 moved; no set lost a cell.

| Set | Cells as returned | Cells in printed order |
| --- | --- | --- |
| task17-sequential (V3) | 468 | **495** |
| two-pass-sequential (V1) | 478 | **505** |
| two-pass-concurrent (V1) | 502 | **512** |
| production-sequential (V1, single-pass) | 503 | **518** |
| task16-sequential, hosted-quads, cu, production | 509, 518, 502, 504 | unchanged |

Scalars are untouched. The built version reproduces the table exactly.

**What was built:**

- `inPrintedOrder` orders a table's rows by page, then by height on the page. A row's place is
  the middle one of its cells' places, each cell placed by the first line of its value, so one
  cell whose source sits on other text (A01's creditors, Task 16 D6) cannot move its row. A row
  with no source keeps its position; rows at one height keep the order returned.
- The mapper applies it by default, so stored rows, field paths, confidence, unreadable and
  ungroundable paths all follow the printed order.
- **A payslip stored before keeps its order.** The tables pass's metadata now carries
  `rowOrder: "printed"`. The regions projection and the "edited" reference read it
  (`storedRowOrder`) and re-map in the stored order; without the mark, the returned order. So a
  stored payslip's outlines stay on its rows, and none is marked edited by the change. This is
  why `findRetainedResponses` now returns the metadata with the bodies.
- The harness scores recordings as the product would store them today, in printed order. **Sets
  recorded earlier therefore score more cells than their own history files say** (the table
  above); their scalars are unchanged.

**Limits, stated plainly:**

- It is a deterministic post-processing rule, which ADR-0001 and ROADMAP §5 ask to be watched.
  It reads geometry and no Croatian, and the schema instruction it backs up had failed.
- It assumes a table's rows are stacked top to bottom. Rows of one table printed side by side
  at the same height keep the returned order; none of the seven layouts does that.
- It does not remove a row that should not be there. F01's total row stays (open item 1).
- Stored payslips are not re-sorted. One whose rows were returned out of order shows them so
  until it is extracted again.
- The middle cell protects a row of three or more sourced cells. A row with two has no middle:
  the upper cell places it, so a stray source above the row would move it (review, below).
- **Rolling the code back is no longer clean.** The code before this task has no row order to
  read: a payslip stored in printed order would be re-mapped in the returned order, so its table
  outlines would sit on other rows and its cells would be marked edited on the next save. After
  a roll-back, payslips extracted under this code need extracting again (review, below).

Red first: `row-order.test.ts` failed to load, and 8 tests failed across `fields`, `regions`,
`original`, `provider` and the repository; all green after.

## Regions over the V3 set

`regions.test.ts` runs over `task17-sequential` too. Withheld, in the returned order: A01
`obustave.0/1/2.vjerovnik`, the same three as `two-pass-sequential` (same row order, same
creditors on the wrong text). No scalar outline is withheld. In printed order every set withholds
the same number of table outlines, and the mapper and the projection agree on every path.
`original.test.ts`: no untouched payslip is marked edited, in either scalars shape and in either
row order.

## Validation

| Check | Result |
| --- | --- |
| Baseline `npm run validate` | 76 files / **1,221 tests** |
| Checkpoint after step 8 | 76 files / 1,256 tests |
| `npm run score:extraction` V2 and V1, before provisioning | Every set identical to history/16's table |
| `provision:analyzer` (V3), first run | Created the three analyzers |
| `provision:analyzer` (V3), second run | `(config)` drift on all three (deviation 1); after it, **matches the code**, exit 0 |
| `npm run validate` before D13 | 76 files / 1,258 tests |
| Final `npm run validate` (with D13) | Typecheck, oxlint, Prettier, **77 files / 1,287 tests** (+1 file, +66 tests) |
| `npm run test:integration` (hosted, $0), after D13's repository and route change | 3 + 65 + 4, green |
| `npm run build` | Pass |
| `npm run check:secrets` | ok: 5 bundle files free of 7 markers and 4 server secret values |
| `npm run check:golden` | All identities and checksums pass |
| `score:extraction` V3 / V2 / V1 | Exit 0 each. Before D13, V2 and V1 unchanged; after it, the D13 table |
| `npm run score -- cu` | 281/284 |
| `git diff --check`, `package-lock.json`, CRLF in the edited `.md` files | Clean, unchanged, 0 |

## Open items

1. **F01's total row is open, and one run cannot say whether it is chance.** With D13 the set is
   at 495/548, above the plan's floor but 7 cells under the lowest earlier set (502), and all of
   that gap is F01: its pay components came back with the total row first, in one of the six
   two-pass sets. The app flags it (`pay_components_sum_mismatch`). It is either run-to-run
   variation or an effect of the V3 tables analyzer, whose only difference from V2 is
   `enableFormula: false` on an identical input. The next paid run is the test: the deployed
   measurement (handoff step 5) run over the whole golden set gives a second sample at about
   $0.68. If F01's total row returns, rebuild `_tables` without the trim (the config would vary
   by role) or name the total row in the pay-components description.
2. **Render is on V1 or V2, unconfirmed.** History/16 left production on `hrPayslipV1` until the
   product owner's switch; plan 17 assumes V2. Either way it must become `hrPayslipV3` with this
   deploy, and the roll-back target is whichever it is now.
3. **The deploy window fails in either order** (D11): this code with an older family calls
   `<family>_header` (404), and the old code with V3 calls `hrPayslipV3_scalars` (404). Both are
   retryable `provider_unavailable`. Do not demo during the switch.
4. **First form is not measured on the deployed stack.** The 9.1 s is from the development
   machine, one payslip at a time. Several payslips at once put up to six analyses in flight (D6).
5. **The client's 500 ms poll is unmeasured under load.** Each session read also runs the stale
   reaper RPC and two queries. The loop waits for each response before the next timer, so reads
   never overlap.
6. **A second fault mid-run would lose paid results again** (deviation 2): the golden harness
   records only at the end. Writing each sample as it settles is a small harness change, not made.
7. `uploadSource` discards the storage error it gets, so the first run's fault could only be read
   from Supabase's logs. Not changed.
8. Stale records, unchanged: history/16's header says "not committed" (it is `69e1f0b`), and
   ROADMAP §2 says 15b is "awaiting its review session".
9. `.agents/research/` and plan 17 are untracked. They are this task's evidence and should be
   committed with it.

## Review-session handoff

1. `/code-review` against `69e1f0b`. D13 was not in the plan: review `row-order.ts`, the mark in
   the tables metadata, and that a payslip without it is read in the returned order.
2. Decide whether step 5 covers the whole golden set (open item 1).
3. `/validate`: the analyzer check expects V3 to match. A browser pass: one payslip uploaded
   locally, watching the loading screen clear; the outlines on a V3 payslip and on a stored V2 one;
   and table outlines on their own rows for A01 seeded both ways, with and without the mark.
4. Commit (with `.agents/research/` and the plan), subtree push, and the Render switch to
   `hrPayslipV3` with the deploy (open items 2 and 3).
5. First form on the deployed stack: one payslip (≤ $0.07), or the golden set through
   `GOLDEN_API_URL` (about $0.68), which also answers open item 1.

## Review session (2026-10-01)

A separate session, at the product owner's request: `/code-review` against `69e1f0b` (the
Standards and Spec reviews ran in parallel, read-only), then `/validate` with a new journey 9.16.
**Paid: 0 analyses, $0.** The browser pass used an API started with an invalid extraction key and
payslips recorded through `complete_extraction_pass` as the signed-in user, from the recordings
and the real mapper, with their real sources.

### Findings and what was done

| # | Finding | Axis | Action |
| --- | --- | --- | --- |
| 1 | `placeOf`'s comment says one stray cell "cannot move its row". For a row with two sourced cells the index taken is the upper one, so a stray source above the row moves it. Both reviews found it | Both | **Measured, then documented.** Over all recordings: 1,234 table rows; 192 have two sourced cells and none of those has cells that disagree (the 15 rows with a stray cell all have three or more). The comment now states the limit, a test pins it, and D13's limits list it. No rule added: two cells give nothing to choose by |
| 2 | Rolling back the commit is not clean after D13 (plan D2 says it is): the old code re-maps a printed-order payslip in the returned order | Spec | **Documented** in D13's limits and under "Still open" below |
| 3 | `placeOf` ran twice per row | Standards | **Fixed**: `inPrintedOrder` computes each place once |
| 4 | Bare `(D5)` and `(D9)` in `provider.ts` and `regions.ts`, where bare D-numbers mean other tasks; `provider.ts`'s "whole-analysis budget is spent" also fires when the other part failed | Standards | **Fixed**: `(Task 17 D5)`, `(Task 17 D9)`, and the comment says both |
| 5 | Stale neighbours: `payslip-extraction.test.ts` "at most `concurrency` analyses"; `.env.example` naming `<id>_scalars` and "3 concurrent analyses"; PRD §7.4 opening with `<id>_scalars`; CONTEXT defining a pass as "one of the two analyses" and then as two | Both | **Fixed**. CONTEXT: a pass is one or more analyses |
| 6 | The golden harness polled the session every 2 s while the client now polls every 500 ms | Standards | **Fixed**: 500 ms, so the quads wall clock is the client's |
| 7 | No test asserted the scalars pass's `latencyMs`, `uploadMs` and `analyzeMs` | Spec | **Fixed**: asserted in the merge test |
| 8 | A scalars body that no longer maps, beside a tables body that does, gives `originalExtraction` the tables alone, so the next save would mark every scalar edited; the plan's edge case says `null` | Spec | **Left.** It is the behaviour before this task, the provider refuses to store a part that does not map, and `null` would instead clear every edited mark on the next save. Reachable only through a later mapper change, which the function's comment already warns about |
| 9 | `source: z.string().optional()` in the mapper's value schema: a non-string `source` would fail the pass as `provider_unavailable` | Both | **Left.** The service's contract is a string; `regions.ts` has always required it |
| 10 | A 5xx and a stall are tested on the tables pass only | Spec | **Left.** `#analyze` is one code path for every analysis; the scalars pass tests a 400 and the outer abort |
| 11 | Side-by-side rows of one table would be ordered by OCR jitter in their heights | Both | Noted. No layout in the set prints rows that way (D13's limits) |
| 12 | Smells, judgement calls: `rawProviderResult` and `extractionMetadata` travel as two `unknown`s; an omitted `rowOrder` defaults to `printed` while an omitted `extractionMetadata` reads as `returned`; `mapRetainedPass` repeats the mapper's accumulator; `modelId` joins parts with `+` and the harness's signature with `,` | Standards | **Kept.** The two defaults are the two cases D13 names (a new mapping, a payslip stored before) |
| 13 | D13 is one more deterministic post-processing rule | Standards | Noted in ROADMAP §5 by the implementing session |

Also fixed, from the priming read: PRD §9.2's `hr-payslip` example, and PRD §10.4's "pairs"
(groups since Task 15b). The plan's D3 and acceptance line still say "barcode off"; deviation 1
is the record.

Verified clean by the reviews: the split (D1, D5), the partition and config (D2–D4), the runner
(D6), polling (D7), the drift check (D8), every reader of retained bodies (D9), no provider
vocabulary outside the module, and the only two readers of a stored payslip's tables
(`routes/payslips.ts`), both of which pass the metadata. A retry clears the metadata and a merge
re-extracts through the runner, so both store the mark.

### Validation

| Phase | Result |
| --- | --- |
| 0 | `npm install`: no `ERESOLVE`; lockfile unchanged |
| 1–4 | oxlint, typecheck, Prettier; **77 files / 1,287 tests** before the fixes, each project by name (shared 316, api 464, client 507). After the fixes: typecheck, oxlint, Prettier and the 9 touched test files (189 tests, one new) |
| 5 | Build: main chunk, CSS, lazy `pdf-*.js` and the worker |
| 6 | `check:secrets` ok (re-run after the `.env.example` edit); 6.3, 6.4, 6.4b, 6.5, 6.8, 6.9, 6.11, 6.16, 6.20–6.26 pass |
| 7 | `check:golden` pass; `score -- cu` 281/284; `provision:analyzer`: the three V3 analyzers match the code; `score:extraction` V3 272/273, 76/77, 495/548; V2 271/273, 509/548; V1 sets as D13's table (505, 512, 518, 518, 502, 504) |
| 8 | `npm run test:integration` on the hosted project: **the first run failed one test**, `payslips.integration.ts` "refuses a combined PDF over the size cap": a 5.8 MB upload answered 500, the Storage fault of deviation 2 from this machine. The second run passed, 3 + 65 + 4. 8 migrations match the local files; advisors only the 9 by-design definer findings and leaked-password protection. Orphan query: only the plan 13 D12 account |
| 9.1–9.4 | Ports free; health direct and through the proxy; `404 not_found`; `401` on both prefixes |

### Journey 9.16

Seeded in one session: A01 from `task17-sequential` (stored as this code stores it, with the
mark), A01 from `two-pass-sequential` (V1, a single scalars body, rows as returned, no mark), C01
from `task16-sequential` (V2, no mark), F01 from `task17-sequential`, and B02 left `processing`.

| Step | Result |
| --- | --- |
| 1 The mark | `extraction_metadata.tables.rowOrder` is `printed` on the two Task 17 payslips and absent on the two stored before |
| 2 Outlines on their own rows (API, as the page fetches) | For every numeric table cell, the OCR words under its outline read as the value the form shows for that row: A01 with the mark 59/59, A01 stored before 59/59, C01 13/13, F01 13/13. **Bite-checked**: with the mark wrongly set on the stored-before A01, 8 cells disagree (`obustave.0.iznos`: the form shows 40.00, its outline is on "200,00"); restored, 59/59 |
| 3 Edited | A changed `brutoPlaca` marks only `brutoPlaca` on all four, and reverting clears it. No table cell is marked on the payslips stored before |
| 4 Poll | The page re-reads the session every 0.74–0.88 s: the 500 ms timer plus a read of about 0.3 s from this machine. B02's tab went from "Reading the payslip" to "Ready to review" as its scalars landed, before its tables write returned |
| 5 Browser at 1440 px | Focusing `obustave.0.iznos` on the stored-before A01 (40.00, printed on page 2) switches the preview to page 2, and the active outline is at (0.945, 0.219), the API's region. On the Task 17 A01, row 0 is 200.00, on page 1. C01 (V2), F01 and B02 (two-part scalars) draw 46, 48 and 49 outlines, with period and payment date; F01 shows 6 pay-component rows and its sum warning. No console error |
| 6 Phone width | 375 px: no horizontal scroll |
| 7 Cleanup | 5 Storage objects and the user deleted; orphan query lists only the plan 13 D12 account |

A01's Obustave header reads "7 to check" on the Task 17 recording against 3 on
`two-pass-sequential`. It is the service's confidence in that run (0 to 7 flagged cells across
the five two-pass sets), the same in either row order.

Not run: a real upload through the split provider in a browser (paid, about $0.06). The golden
run exercised that path end to end; the deployed measurement below is its browser counterpart.
The other journeys (9.5–9.15) were not re-run: Task 17 changes no capture, merge, export,
navigation or form code.

### Still open

- Commit (with `.agents/research/` and the plan), subtree push, and the Render switch to
  `hrPayslipV3` with the deploy. Confirm Render's current family first: it is the roll-back
  target, and a roll-back now also needs the payslips extracted under this code extracted again.
- First form on the deployed stack, and F01's total row (open items 1 and 4): one payslip
  (≤ $0.07) or the golden set (about $0.68).
- Open items 5–7 above are unchanged. Of item 8, history/16's header is corrected; whether 15b
  had its review session is still unrecorded.

## Production measurement (2026-10-01)

Committed as `2d303d7`, pushed to the mirror (`8794e2b`), deployed, and Render switched to
`hrPayslipV3` by the product owner. Then measured on the deployed stack through
`GOLDEN_API_URL=https://payslip-ocr-api.onrender.com`, from the development machine. Every
recording's analyzers are `hrPayslipV3_header`, `_reconciliation` and `_tables`.
**Paid: two golden runs, $0.76 and $0.75, and an 18-analysis experiment (about $0.30, estimate).
Running total for Task 17: about $2.95.**

### Latency

| Measure | Before (Task 13, deployed, V1) | Now (deployed, V3) | Target |
| --- | --- | --- | --- |
| First form, one payslip at a time | p50 11.9 s, max 22.7 s (in quads) | **p50 8.2 s, p90 10.2 s, max 11.7 s** | ≤ 10 s |
| Scalars analysis alone | — | 3.9–10.7 s, median 7.6 s | — |
| Complete, one at a time | p50 17.9 s (in quads) | p50 9.4 s, p90 22.2 s, max 33.7 s (A01) | ≤ 25 s |
| First form, four at once | p50 11.9 s | p50 10.6 s, p90 16.7 s, max 18.7 s | — |
| Four in parallel, wall clock | 73.3 / 32.4 / 73.2 s | **43.8 / 32.8 / 78.3 s** | ≤ 25 s |

Four in parallel is still missed. A01's tables analysis sets it (22.8 s in quad 1, 57.8 s in
quad 3), and with four payslips the tables passes wait behind the scalars passes (queued up to
19.6 s). Quad 2 includes 15.5 s of uploads from this machine. The upload from Render to the
service was 0.2–3.1 s per pass, one resubmit in 46 passes.

### Accuracy over three V3 runs

| Set | Scalars | Critical | Cells |
| --- | --- | --- | --- |
| task17-sequential (dev machine) | 272/273 | 76/77 | 495/548 |
| task17-hosted-sequential | 271/273 | 75/77 | 509/548 |
| task17-hosted-quads | 269/273 | 74/77 | **524/548** |
| Earlier sets, scored the same way (printed order) | 268–272 | 73–76 | 502–518 |

- **Scalars: no change.** Every miss in the three runs is one the V1 and V2 sets also have:
  G01's `netoPlaca` printed as `1.219.08` (unreadable, flagged), A04's occluded payout invented
  (ungroundable, flagged), and on F01 an employer name invented from other text (one run; also in
  `two-pass-concurrent` and `hosted-quads`).
- **Cells: the three runs span the earlier range and exceed it once.** The whole spread is two
  tables: F01's pay components (20/20 or 5/20) and C01's (20/20 or 9/20, which varied on V1 too:
  6, 9, 20). Every other table is equal or better (A02 and A04 obustave +2 each in both hosted
  runs).

### F01's total row is older than this task, and not caused by the trim

Open item 1 asked whether `enableFormula: false` on the V3 tables analyzer adds F01's total row
(`PLAĆA (BRUTO SVOTA) 2.009,94` as a sixth pay component, first). It does not:

- The row is in **4 of the 10 recorded sets, from 2026-09-20 on**: `cu` and `production` (V1,
  single-pass, formula on), `task17-sequential` and `task17-hosted-sequential` (V3). History
  above says "not seen in the four earlier two-pass sets", which is true and missed the
  single-pass ones. The markdown the model read is the same 4,797 characters in all ten.
- **Paired experiment:** F01's tables pass six times each, interleaved, through
  `hrPayslipV2_tables` (formula on), `hrPayslipV3_tables` (formula off) and a candidate with one
  added sentence saying the gross-total row is not a component. **18 of 18 returned the five
  correct rows.** So neither the trim nor the sentence can be judged from it: the fault did not
  occur. The candidate analyzer was deleted.
- The third V3 golden run returned the five correct rows too.

It is a run-to-run behaviour of the model on this layout. When it happens the app flags it
(`pay_components_sum_mismatch`), and D13 keeps the other five rows in order behind it.

**A $0 prototype of the one deterministic fix:** drop a pay-component row whose amount equals
`brutoPlaca` when the other rows already sum to `brutoPlaca`. Over all ten sets it removes
exactly F01's total row in the four affected sets and nothing else: `cu` 502 → 517, `production`
504 → 519, `task17-sequential` 495 → 510, `task17-hosted-sequential` 509 → 524; the other six
unchanged. Not built: it is one more post-processing rule, and the product owner decides.

### Open items now

- Open item 1 is answered as above; open items 2–4 are closed by the deploy and this section.
- C01's pay components (the statutory breakdown taken instead of the employer's rows, in 4 of 7
  two-pass sets) is the larger intermittent table fault left, with no fix proposed.
- Four in parallel stays missed (ROADMAP §5).

## Follow-up D14: the pay components' total row is left out (2026-10-01, $0)

**Asked by the product owner** after the production measurement: build the fix for F01's total
row, test first. Accuracy ranks above speed for this product.

**The rule.** A pay-component row is left out when its amount equals `brutoPlaca` and the other
rows already sum to `brutoPlaca`, both to the cent. It is the payslip's own arithmetic (the
field description already says the components sum to bruto plaća) and reads no label.

**What was built:**

- `findTotalRow(tablesBody, brutoPlaca)` in `fields.ts`: the index of that row among the rows as
  returned, or `null`.
- The rule needs both passes: bruto plaća is a scalar, the pay components a table. The runner
  gives the tables pass a promise of the scalars pass's `brutoPlaca`
  (`ExtractionInput.brutoPlaca`), settled when the scalars pass ends and `null` when it read none
  or failed. The provider awaits it after its analysis, so the tables pass's timings do not
  include the wait, and both passes still run at once.
- The row is left out **before any path is numbered** (`storedRows` in `row-order.ts`, used by
  the mapper and the regions projection), so stored rows, field paths, confidence, unreadable and
  ungroundable paths and outlines all name the same rows. The retained body is verbatim: the row
  is still in it.
- The tables metadata records which row: `totalRow`, its index as returned. The regions
  projection and the "edited" reference replay that index (`storedTotalRow`). **A payslip stored
  with its total row keeps it**: no mark, no change, as with D13.
- The harness scores recordings as the product would store them today, so it applies the rule.

**Measured at $0, over every recorded set, with the built code:** the rule leaves out exactly
F01's `PLAĆA (BRUTO SVOTA)` row in the four sets that have it, and no row anywhere else.

| Set | Cells before | Cells with D14 |
| --- | --- | --- |
| cu (V1) | 502 | **517** |
| production (V1) | 504 | **519** |
| task17-sequential (V3) | 495 | **510** |
| task17-hosted-sequential (V3) | 509 | **524** |
| the other six | 505–524 | unchanged |

Scalars are unchanged in every set. F01's `pay_components_sum_mismatch` no longer fires. The V3
sets now score **510, 524 and 524** cells, against 505–519 for every earlier set.

**Red first:** 18 tests failed (`findTotalRow` missing, the row still mapped, no mark, the
projections keeping the row, the runner giving no promise); all green after.

**End to end, $0** (the local API with an invalid extraction key, payslips recorded through
`complete_extraction_pass` from the `task17-sequential` recording): F01 stored with the rule has
5 pay components, `totalRow: 0`, no sum warning, and every numeric cell's outline on its own value
(11/11); F01 stored without it has 6 rows, the sum warning, and 13/13; A01 has no total row and
59/59. On all three, editing `brutoPlaca` marks only `brutoPlaca`, and reverting clears it.

**Limits, stated plainly:**

- It is a second deterministic post-processing rule in this task (ROADMAP §5). It is arithmetic
  on canonical values, not Croatian, and it cannot fire unless the table double-counts bruto
  plaća exactly.
- It removes a **total** row only. A subtotal row, or C01's statutory breakdown taken instead of
  the employer's rows, is not touched: C01's pay components stay the larger intermittent fault.
- It needs the scalars pass's bruto plaća. When that is unread or wrong, the row stays and the
  sum warning flags it, as before.
- An edit to `brutoPlaca` afterwards changes nothing: the decision is made once, at extraction.
- A row left out is not shown to the user. The retained response still holds it.
- Rolling the code back has the same caveat as D13: a payslip stored with `totalRow` would be
  re-mapped with the row by older code.

**Validation:** typecheck, oxlint, Prettier; **77 files / 1,312 tests** (+25); `npm run
test:integration` 3 + 65 + 4; build; `check:secrets`; `check:golden`; `score:extraction` V3, V2
and V1 exit 0 with the table above. No analyzer changed: `hrPayslipV3` stays as provisioned, and
Render needs no change.
