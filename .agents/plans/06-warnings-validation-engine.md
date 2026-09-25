# Feature: Task 06 — Warnings & validation engine

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 06](../ROADMAP.md) · **PRD:** §6.4, §6.5, §7.9, §7.12,
§10.4, §10.5, §11.3, Appendix B · **Previous task:**
[`history/05`](../history/05-extraction-latency-two-pass.md) (open item 2) ·
[`history/04`](../history/04-content-understanding-provider.md) (D6, open item 3) · **Bake-off
grounding finding:** [`history/01`](../history/01-extraction-bakeoff.md) "Grounding is a
hallucination detector" · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:**
[`AGENTS.md`](../../AGENTS.md) (this project has no `CLAUDE.md`)

## Feature Description

Every extracted payslip gets the signals that tell a reviewer which few of ~40 fields to check
first. There are three kinds:

1. **Warnings**, the closed nine-code taxonomy in `shared/src/warnings.ts` (PRD §7.9):
   `missing_critical_field`, `unparseable_amount`, `unparseable_date`, `oib_checksum_failed`, four
   payroll identities (`dohodak_mismatch`, `porezna_osnovica_mismatch`, `neto_mismatch`,
   `isplata_mismatch`) and `pay_components_sum_mismatch`.
2. **`lowConfidenceFields`**: canonical paths whose extraction confidence is below a measured
   threshold. The detail route currently hardcodes `[]` for this, with a comment that Task 06 owns
   the threshold.
3. **`ungroundableFields`**: canonical paths whose printed value cannot be found in the page's OCR
   words. The bake-off measured this signal at 100% precision as a hallucination detector
   (ROADMAP locked decision 16).

All three are provider-neutral. Confidence and grounding **mark** a value and never suppress it,
and warnings never block anything (PRD §7.9).

The scoring harness also reports warnings over the recorded extractions, the **OIB checksum pass
rate on extracted OIBs** (PRD §11.3 lists it as measured, and nothing measures it yet), and how
many wrong values carry at least one attention signal.

## User Story

As someone reviewing forty extracted fields on a payslip
I want the app to tell me which ones it is unsure about, and where the payslip's own arithmetic
does not add up
So that I check those first instead of reading everything (PRD US-05)

## Problem Statement

- `payslips.warnings` is always `[]`, the detail route returns `lowConfidenceFields: []`, and
  nothing computes grounding. The review UI (Task 09) has nothing to mark.
- The data is already there:
  - canonical values are in `canonical_data`;
  - per-field confidences and `unreadableFields` are in `extraction_metadata.{scalars,tables}`;
  - the OCR words are in each pass's raw body (`result.contents[0].pages[].words`).
- Two extraction passes land in either order, each through its own atomic SQL merge (Task 05 D7).
  Anything computed from "the whole payslip" at write time can race.

## Solution Statement

- **Warnings are a pure read-time projection** (D1). A new
  `api/src/validation/warnings.ts#computeWarnings(fields, unreadableFields, tablesStatus)` is
  called inside `mapPayslipRow`, so every read path (detail, session summary `warningCount`,
  history list) gets the same freshly computed warnings. There is no write-time race, a later PATCH
  (Task 09) recomputes for free, and the unused `warnings` column is dropped.
- **Low confidence is a read-time projection** over `extraction_metadata.<pass>.fields`, at a
  global threshold of **0.5**, measured below (D7).
- **Grounding is computed once, at pass time, inside the mapper**, where the raw body is in
  memory. It is stored as `ungroundableFields` in that pass's metadata and exposed on the detail
  DTO (D8). The raw column (0.2–1 MB per row) is still never read on a request path.
- **The harness** runs the same `computeWarnings`, confidence projection and mapper-produced
  grounding over every recorded set. It reports them without gating (D11).
- **No paid Azure run is needed.** Everything is measured offline over the five recorded sets
  already in `.bakeoff/` (D12).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium
**Primary Systems Affected**:
- `api/src/validation/` (new)
- the content-understanding mapper
- the payslip repository and the detail route
- `shared` contracts and money helpers
- one migration
- the scoring harness

**Dependencies**: none new. `big.js` stays behind `shared/src/money.ts`.

---

## DESIGN DECISIONS

Priming raised seven concerns. The product owner delegated them on 2026-09-25 ("settle 1–3 and
the other concerns by your own recommendation"). Each decision below names the concern it
settles. Do not reopen any of them without new evidence.

### D1 — Warnings are computed on read; the `warnings` column is dropped (priming concern 1)

- **Why not stored.** The passes merge independently in SQL (`complete_extraction_pass`). If Node
  wrote warnings after each pass, a pass landing while the other one is writing would read a
  partial row, and the last writer could leave stale warnings. That would need a re-read plus an
  optimistic `updated_at` guard and a retry, plus another write path Task 09's PATCH would have to
  repeat.
- **Why on read works.** Warnings are a pure function of values the read already selects:
  `canonical_data`, `status`, `tables_status` and `extraction_metadata` (for `unreadableFields`).
  They take microseconds to compute. Task 05 D11 ("recompute on each pass's completion") and
  PRD §7.9 ("recomputed on every save") are then satisfied by construction.
- **Where.** In `mapPayslipRow`, which every read path goes through. `create`, `update`,
  `listBySession` and `listPage` all return warnings computed identically.
- **The column goes.** A column that is always `[]` and never read is a trap: someone will one day
  read it and believe it. The migration drops `payslips.warnings` and its
  `payslips_warnings_array` check. PRD Appendix B is updated to say warnings are computed on read.
- **Deploy note.** The Render API currently deployed selects `warnings`. From the moment the
  migration is applied until this task's code is subtree-pushed, reads on the deployed API fail.
  There are no real users, and the push already waits on Task 04's H1. Say so in the history
  file's open items.

### D2 — When each rule is evaluated (priming concerns 2–3)

- **Only a readable form gets warnings.** `computeWarnings` runs for `status` `review` or
  `confirmed`. A `processing` payslip (whose tables may have landed first) and a `failed` one get
  `[]`. Otherwise an early tables write would raise seven false `missing_critical_field` warnings.
- **An identity with a null operand is skipped, never raised.** A missing value already raises
  `missing_critical_field` or `unparseable_*` where that applies. Two arithmetic warnings about one
  gap would be noise.
- **Exception: `isplata_mismatch` treats a null `neoporeziviPrimiciUkupno` or `obustaveUkupno` as
  zero.**
  - The golden-set README defines `null` for these two totals as "no such section on the page"
    (F01 has no obustave section), and an absent section contributes nothing.
  - Verified: F01 reconciles exactly with `obustaveUkupno` taken as 0.
  - Payoff: if OCR drops a printed total, the payout identity still fires and points at it.
  - `netoPlaca` and `iznosZaIsplatu` must both be non-null.
- **`pay_components_sum_mismatch`** needs all three of:
  - `tablesStatus === "ready"` (Task 05 D11);
  - a non-null `brutoPlaca`;
  - **at least one pay-component row with a non-null `iznos`**. With no amounts there is nothing
    to compare. G01's pay-components section is scrolled off-screen, so its table is empty and
    `unscorable`. A warning there would say "these components do not add up" about components
    that do not exist.

  It sums **amounts only, never hours** (ROADMAP: B02's leaf hours total 266 against a printed
  176). Rows with a null `iznos` are left out of the sum, so a partly read table usually raises the
  warning, which is the point.
- **"Zero arithmetic warnings on the ten that reconcile" becomes "on all eleven".** With these
  rules, G01 (the eleventh, with its empty pay-components table) reconciles vacuously. Measured on
  the fixtures (see "Recorded evidence"): all eleven are **exactly** consistent on every
  applicable identity, and zero arithmetic warnings fire.

### D3 — Tolerance: a difference of one cent or more is a mismatch (roadmap contradiction)

The roadmap asks for an "absolute tolerance of 0.01", and also says "injecting a one-cent error
into each identity raises exactly that identity's warning". Those contradict each other if the
tolerance is read as `|diff| ≤ 0.01`, which is how `scripts/check-golden-set.py:28` implements it
(`> tol`).

- **Resolution:** a mismatch is `|lhs − rhs| ≥ 0.01`. Values that agree to the cent reconcile;
  anything a cent or more apart does not.
- **Why not relative:** it stays absolute and never relative, which was the actual lesson from
  doc-guard's nine-significant-figure comparison.
- **Evidence:** every applicable identity on all 11 fixtures has a residual of exactly `0`. These
  chains subtract printed, already-rounded figures, so they are exact by construction.
- **Implementation:** add one helper to `shared/src/money.ts` (D6), and phrase PRD §7.9 as "agree
  to the cent".
- **Do not change `check-golden-set.py`**: it verifies fixtures, and its tolerance is harmless
  there.

### D4 — Warning `field` paths and order

| Code | `field` |
| --- | --- |
| `missing_critical_field` | the critical field (`employerName` …) |
| `unparseable_amount` / `unparseable_date` | the unreadable canonical path (`brutoPlaca`, `payComponents.2.iznos`) |
| `oib_checksum_failed` | `employerOib` or `employeeOib` |
| `dohodak_mismatch` | `dohodak` |
| `porezna_osnovica_mismatch` | `poreznaOsnovica` |
| `neto_mismatch` | `netoPlaca` |
| `isplata_mismatch` | `iznosZaIsplatu` |
| `pay_components_sum_mismatch` | `payComponents` |

- **The identity's result field** is what each arithmetic warning attaches to. It is where the
  printed figure sits that the payslip's own arithmetic contradicts, and the form attaches the
  message there (Task 09).
- **Output order is deterministic**: `WARNING_CODES` order first, then `CRITICAL_FIELDS` order or
  the order in `unreadableFields`. Tests use `toEqual`.

### D5 — `unparseable_*` and its interaction with `missing_critical_field` (priming concern 4)

- **Source:** the stored `unreadableFields` (both passes, scalars first, as `findDetailState`
  already concatenates them).
- **Only while the value is still null.** A path raises `unparseable_*` only while its current
  canonical value is `null`. Once a user types a value (Task 09), the warning clears.
- **Which code:**
  - `period` and `paymentDate` raise **`unparseable_date`**;
  - **every other unreadable path raises `unparseable_amount`**: money, hours (`ukupnoSati`,
    `payComponents.N.sati`) and coefficients (`…koeficijent`).
  - Text fields are never unreadable, because the mapper's `text` parser cannot fail.
  - The taxonomy is closed. An unreadable hour value needs checking exactly as an unreadable
    amount does, and "amount" is the nearer of the two codes. Dropping it silently would hide a
    field the reader must fix.
- **Unreadable supersedes missing.** A critical field that is `null` *because* it was unreadable
  raises only `unparseable_*`. "We could not read this" and "this was not on the document" stay
  distinct (CONTEXT.md, Unreadable field).
- **Known limit, recorded for Task 09:** table-cell paths are positional. Once Task 09 lets a user
  add or delete rows, a stored `payComponents.3.iznos` may name a different row. This is the same
  reason `editedFields` excludes tables. Task 09 decides the answer (for example, clearing a
  table's unreadable paths on its first edit).

### D6 — OIB checksum and money helpers

- **`api/src/validation/oib.ts#isValidOib(oib: string): boolean`** implements ISO 7064 MOD 11,10:
  - `a = 10`; for each of the first ten digits: `a = (a + d) % 10`, if `a === 0` then `a = 10`,
    then `a = (a * 2) % 11`;
  - check digit `c = 11 − a`, and `10` becomes `0`;
  - valid iff the value is exactly 11 ASCII digits and `c` equals the eleventh digit.
  - Anything else fails, including an `HR` prefix or spaces. The schema deliberately accepts any
    text in OIB fields (see `shared/src/payslip.ts:68`), and a malformed OIB is exactly what this
    warning exists to surface.
  - Checked for both parties; `null` is skipped. Port the arithmetic from
    `scripts/check-golden-set.py` (read it; do not import Python).
- **In `api/`, not `shared/`.** Only the API computes warnings. The client needs it at the
  earliest in Task 09, which can move it then.
- **`shared/src/money.ts` gains two helpers**, both export-listed in `shared/src/index.ts`,
  with their own tests. `api` has no direct `big.js` dependency and must not gain one.
  - `subtractAmounts(a, b)`, mirroring `addAmounts`: the wider scale, `Big` in strict mode.
  - `amountsAgreeToTheCent(a, b): boolean`, which is `new Big(a).minus(b).abs().lt("0.01")`.

### D7 — Low confidence: global threshold 0.5, projected on read (priming concern 5)

Measured over **all five recorded sets** (`cu`, `production`, `production-sequential`,
`two-pass-sequential`, `two-pass-concurrent`) through the real mapper: 1,271 non-null scalar
observations, 7 of them wrong against the golden set.

| Threshold | Scalars flagged | Wrong scalars caught | Table cells flagged (of 2,239) |
| --- | --- | --- | --- |
| < 0.3 | 2.3% | 4/7 | 2 |
| **< 0.5** | **5.0% (~1.2 per document)** | **6/7** | **26 (1.2%)** |
| < 0.7 | 9.7% | 6/7 | 201 |
| < 0.8 | 18.7% | 7/7 | — |

- **0.5 is the knee.** It catches every wrong value that 0.7 catches at half the flags. The one it
  misses, R3 F01 `employerAddress` at 0.735, needs 0.8 and nearly four times the flags.
- **Known noise:** `period` and `paymentDate` are systematically low even when correct (correct
  minimums 0.004 and 0.079). They account for 49 of the 68 scalar flags at 0.5. This is left
  honest rather than special-cased per field, which would be exactly the hand-written rule creep
  ROADMAP §5 warns against.
- **The rule:**
  - `lowConfidenceFields` = every path in `extraction_metadata.scalars.fields`, then
    `.tables.fields`, whose `confidence` is a number `< LOW_CONFIDENCE_THRESHOLD`;
  - `null` confidence is unknown, not low, and is not flagged;
  - paths are unique, in that order.
- **Where it lives:** `LOW_CONFIDENCE_THRESHOLD = 0.5` and `lowConfidenceFields(passes)` in
  `api/src/validation/attention.ts`, shared by the repository and the harness.
- **Both kinds of path.** It applies to scalars and table cells alike.

### D8 — Grounding: in the mapper, per pass, against the printed text (priming concern 6)

- **Why at pass time.** Grounding needs the OCR words, which live only in the raw body. Reading
  `raw_provider_result` on every detail request would move 0.2–1 MB per read (Task 04 D11 keeps it
  off request paths). So grounding is computed when the pass is mapped and stored as
  `ungroundableFields` in that pass's metadata, exactly like `unreadableFields`.
- **Deviation from the roadmap's wording**, which suggested grounding from the scalars body. Each
  pass is grounded against **its own** body's `pages[].words`: both passes OCR the whole document,
  so the words are the same, and there is no cross-pass dependency or ordering to handle.
- **What is matched: the printed `valueString`**, not the normalised canonical value.
  - Content Understanding returns what is printed (locked decision 13), so the printed string is
    already the page's surface form, and the bake-off's `surfaceForms()` table is unnecessary.
  - Port only `key()` (whitespace, `.,;:`, diacritic, `đ` and case insensitive) and the
    contiguous-run matcher from `scripts/bakeoff/ground.ts:108-194`. Drop `envelope`, `Region`,
    page dimensions and geometry: Task 08 draws boxes from CU's own `source`, and this signal is
    only "was it found".
- **`maxRun` is 40 words**, and the 200-character accumulator cap is kept.
  - With the bake-off's 12, correct long `obustave.N.naziv` values ("SINDIKALNA ČLANARINA - RATA
    KAO POSTOTAK NA NETO PLAĆU, BEZ KONTROLE SALDA", 13+ tokens) fail to ground: 6–7 false flags
    per A01 run.
  - At 40, across all five sets: **1 ungrounded scalar** (production A04 `iznosZaIsplatu`
    `1.801,77`, which was invented, confidence 0.044), so precision is 1/1. **2 ungrounded table
    cells** of 2,239, both A01 `obustave.10.naziv`.
- **`period` is not grounded.** CU composes it from non-adjacent tokens on some layouts
  (`GODINA 2025, MJESEC 6` printed as separate cells), so 14 of 49 **correct** periods fail to
  ground and none of the wrong ones are caught. The bake-off excluded `period` for the same
  measured reason (history/01, "non-groundable by design"). Put this as a named constant with that
  reason, not as an inline `if`.
- **Only present values are grounded:** a value that the mapper `read()` found with a non-blank
  `valueString`. An unreadable value is still grounded against its printed text. Unreadable and
  ungroundable are independent signals.
- **Rows written before this task** have no `ungroundableFields`, so the metadata schema makes it
  optional, defaulting to `[]`. The hosted database had 0 real payslips at Task 05, but test rows
  written by the integration suite use minimal metadata.

### D9 — The detail DTO gains `ungroundableFields`

- Add `ungroundableFields: z.array(z.string())` to `payslipDetailResponseSchema` in
  `shared/src/api.ts`, next to `lowConfidenceFields`, with a doc comment: "paths whose printed
  value was not found in the page's OCR words: a likely invented value (ROADMAP locked decision
  16)".
- The response is `.strip()`, so older bundles are unaffected.
- PRD §10.5 lists it.
- `FieldMetadata.source` (`"text"`) is **not** used for this. That value means "re-grounded", which
  is Task 08's origin concept.

### D10 — What "Every golden-set payslip produces the expected warning set" means (priming concern 2)

Two layers, because the fixtures and the recordings answer different questions.

1. **Fixtures (ground truth), gated in unit tests.** `computeWarnings` over each fixture, parsed
   through `canonicalPayslipFieldsSchema` with the metadata keys removed (as
   `shared/src/payslip.test.ts` does), with `tablesStatus: "ready"` and no unreadable fields, must
   equal exactly:

   | Sample | Expected warnings |
   | --- | --- |
   | A01 A02 A03 B01 B02 C01 D01 | none |
   | A04 | `missing_critical_field` `iznosZaIsplatu` |
   | E01 | `missing_critical_field` `employerName` |
   | F01 | `missing_critical_field` `employerName` |
   | G01 | `missing_critical_field` × `employerName`, `employeeName`, `employeeOib`, `period` |

   That includes zero arithmetic and zero OIB warnings on all eleven (verified in planning), B01
   without `porezna_osnovica_mismatch` (its zero floor), and B02 without
   `pay_components_sum_mismatch`.

2. **Recordings (what the engine actually returns), reported, never gated** ("measure, don't
   guarantee", PRD §11.3). The harness prints each set's warnings per sample. From planning's
   measurement, these are the warnings to expect, and each one is **correct**:
   - A04 `isplata_mismatch`: the engine invents the occluded `iznosZaIsplatu` as `2033.32` in
     `cu`, R2 and R3;
   - F01 `pay_components_sum_mismatch` in `cu` and `production` (4019.88 = 2 × bruto: the total
     row was read as a component);
   - C01 `pay_components_sum_mismatch` in R3 (the IP1 statutory-breakdown rows, history/05);
   - G01 `unparseable_amount` `netoPlaca` (the `1.219.08` case);
   - R3 B01 `unparseable_date` `period`.

**A04 DoD correction (the roadmap's "A04's occluded `iznosZaIsplatu` raises
`missing_critical_field` rather than being invented").**

- The warnings engine cannot stop the engine inventing a value. The engine returned `null` in 2 of
  the 5 recorded sets and invented a value in the other 3.
- Achievable and verified:
  - when it is null (the fixture, and `production-sequential`), `missing_critical_field` fires;
  - when it is invented, `isplata_mismatch` fires, and its confidence of 0.25–0.35 is below D7's
    0.5.
- The roadmap item is reworded to say exactly this, and the history file records the rewording.

### D11 — Harness additions (`api/src/scoring/score.ts`, `scripts/score-extraction.ts`)

Per set, on top of what it prints today:

- **`OIB checksum`**: `pass/extracted` over every non-null `employerOib` and `employeeOib` in the
  **actual** values. Provider-neutral, so `scoreSet` computes it.
- **`Warnings`**: counts per code for the set, plus each sample's codes in the per-sample table.
  Uses the same `computeWarnings` as the product, with `tablesStatus: "ready"` and the recording's
  `unreadableFields`.
- **`Attention on wrong scalars`**: of the scalar values scored wrong, how many carry at least one
  signal (a warning whose `field` is that path, a low-confidence flag or an ungroundable flag).
  Also print the total flagged scalar count, so a rise in recall bought by flagging everything is
  visible. This is the evidence base for D7 and D8 staying true on future recordings.

Nothing new is gated: exit 1 still means only "could not measure". `ScoringInput` gains optional
`warnings`, `lowConfidenceFields` and `ungroundableFields`. Single-pass bodies are mapped once,
and two-pass bodies per pass, with the passes' lists concatenated as the repository does.

### D12 — No paid runs; cost $0

Every figure in this task comes from the five recorded sets (Task 04–05 recordings, already paid
for) and the fixtures. `npm run test:extraction` is **not** run. Hosted Supabase integration tests
(free) are.

### D13 — What stays out

- Rendering, copy and `aria-describedby` for warnings: Task 09 (hr/en copy for every
  `WARNING_CODES` value, guarded by a test).
- PATCH: Task 09. It gets recomputation for free from D1.
- Excluding edited fields from the low-confidence and ungroundable lists: Task 09, which is the
  first writer of `edited_fields`.
- Regions and geometry: Task 08.
- Any field-schema description change (G01 `netoPlaca`, history/04 item 6): a measured,
  re-recorded change, not this task.
- The golden-set checker's extra identities (MIO I + II = doprinosi, `ukupanTrosakRada`, the other
  two tables' totals) have **no** warning codes. The taxonomy is closed at nine (PRD §7.9). Do not
  add codes.
- Confirm and export gating: Tasks 09 and 12. Warnings are never consulted by any status write.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `shared/src/warnings.ts` (all) — `WARNING_CODES`, `payslipWarningSchema` (`{code, field?}`, strict). Only its doc comment changes.
- `shared/src/payslip.ts` (lines 65–131, 161–177) — `canonicalPayslipFieldsSchema`, `CRITICAL_FIELDS`, `fieldMetadataSchema`. `payslipSchema.warnings` stays.
- `shared/src/money.ts` (lines 1–90) — `Big.strict`, `addAmounts` (the pattern for `subtractAmounts`), `compareAmounts`, `scaleOf`.
- `shared/src/index.ts` (lines 3–12, 64–69) — the export lists to extend.
- `shared/src/api.ts` (lines 119–143) — `payslipDetailResponseSchema`. Add `ungroundableFields`.
- `shared/src/payslip.test.ts` (lines 1–40, 126–150) — how fixtures are found and read (`FIXTURE_DIRECTORY`, `FIXTURE_METADATA_KEYS`). Mirror it for the fixture warnings test.
- `api/src/repositories/payslips.ts` (all) — `PAYSLIP_COLUMNS` (line 29), `passMetadataSchema` and `extractionMetadataSchema` (lines 34–40), `findDetailState` (134–156), `mapPayslipRow` (354–375), `mapPayslipState`.
- `api/src/repositories/payslips.test.ts` (lines 1–60) — the `payslipRow()` factory. It carries `warnings: []`, which goes when the column goes.
- `api/src/routes/payslips.ts` (lines 60–95) — the detail body with `lowConfidenceFields: []`.
- `api/src/routes/sessions.ts` (line 129) — `warningCount: payslip.warnings.length`. It stays and is now live.
- `api/src/providers/document-extraction/content-understanding/fields.ts` (lines 60–175) — the mapper: `read()`, `rawValueSchema`, `operationSchema`, `MappedExtraction`. Grounding lands here.
- `api/src/providers/document-extraction/content-understanding/fields.test.ts` (lines 1–60, 160+) — the `operation()`, `str()` and `table()` builders, and the `describe.skipIf(!existsSync(recordingsDir))` recordings pattern.
- `api/src/providers/document-extraction/content-understanding/provider.ts` (lines 90–130) — where `metadata` is assembled. Add `ungroundableFields`.
- `api/src/providers/document-extraction/types.ts` (lines 24–43) — `ExtractionMetadata`.
- `api/src/services/payslip-extraction.ts` (lines 180–215) — `record()` stores `result.metadata` as-is; `logSuccess` logs counts. Add `ungroundableCount`.
- `api/src/provider-vocabulary.test.ts` — `api/src/validation/` and `api/src/scoring/` must not contain `analyzer`, `polygon`, `valueString` and the rest. Word your comments accordingly.
- `api/src/scoring/score.ts` (all) and `api/src/scoring/score.test.ts` — `ScoringInput`, `SetReport`, `scoreSet`, `strictTextKey`.
- `scripts/score-extraction.ts` (all) — `loadSet`, `singlePass`, `twoPass`, `printSet`.
- `scripts/bakeoff/ground.ts` (lines 108–194) — `key()` and `groundValue` to port.
- `scripts/check-golden-set.py` — the OIB arithmetic to port, and the identities as the golden set checks them.
- `supabase/migrations/20260924100541_create_sessions_and_payslips.sql` (lines 25–35) — the `warnings` column and `payslips_warnings_array` constraint to drop.
- `api/src/database.types.ts` (lines ~42, 68, 94) — the `warnings` entries in Row, Insert and Update.
- `api/src/routes/payslips.integration.ts` (lines 95–135, 310–400) — the detail and summary expectations, and the pass-writing helpers (`completeExtractionPass` with minimal metadata) to extend.

### Recorded evidence this plan relies on (measured 2026-09-25, offline)

Research scripts (in the planning session's scratchpad, not committed) mapped every recording
through the production `mapAnalyzeResult`:

- **Fixtures:** every applicable identity is exact (residual 0) on all 11. Missing criticals:
  - A04: `iznosZaIsplatu`;
  - E01 and F01: `employerName`;
  - G01: `employerName`, `employeeName`, `employeeOib`, `period`.
- **G01's `payComponents`** is `[]` (unscorable), so D2's empty-table skip decides whether it
  raises.
- **Confidence, grounding and per-set warnings:** as tabulated in D7, D8 and D10.
- **OIB:** no extracted OIB failed its checksum in any set.
- The recordings are git-ignored (`.bakeoff/`). CI has none, so every recordings-based assertion
  is either in the harness or under `describe.skipIf(!existsSync(…))`.

### New Files to Create

- `api/src/validation/oib.ts` + `oib.test.ts` — `isValidOib`.
- `api/src/validation/warnings.ts` + `warnings.test.ts` — `computeWarnings`. The fixture table (D10), one-cent injections, D2 and D5 edge cases.
- `api/src/validation/attention.ts` + `attention.test.ts` — `LOW_CONFIDENCE_THRESHOLD`, `lowConfidenceFields`.
- `api/src/providers/document-extraction/content-understanding/grounding.ts` + `grounding.test.ts` — `isGrounded(printed, words)` and the `period` exclusion constant.
- `supabase/migrations/<version>_drop_stored_warnings.sql`.

### Relevant Documentation — READ BEFORE IMPLEMENTING

- ISO 7064 MOD 11,10 (the OIB check digit): the reference implementation is
  `scripts/check-golden-set.py`, which passes all 22 fixture OIBs. D6 states the algorithm. No URL
  is given because none was verified during planning.
- [big.js API](https://mikemcl.github.io/big.js/#minus) — `minus`, `abs`, `lt`, `toFixed`. `Big.strict = true` rejects numbers, so pass strings only (`"0.01"`, `"0"`).
- [Supabase: `apply_migration` / `generate_typescript_types`](https://supabase.com/docs/guides/deployment/database-migrations) — as Task 05 step 4 used them.
- [Vitest `describe.skipIf`](https://vitest.dev/api/#describe-skipif) — the recordings-only test pattern.

### Patterns to Follow

**Naming:** camelCase functions, `SCREAMING_SNAKE` constants, kebab-case filenames under `api/src`
(`payslip-extraction.ts`). In `api` and `shared`, relative imports carry `.js`.

**Pure module with a doc comment per exported symbol** (from `shared/src/money.ts`):

```ts
/**
 * Adds two canonical amounts at the wider of their two scales, so `100.50 + 0.00` is
 * `100.50` rather than `100.5`.
 * …
 */
export function addAmounts(a: string, b: string): string {
  return new Big(a).plus(b).toFixed(Math.max(scaleOf(a), scaleOf(b)));
}
```

**Loose metadata parsing with defaults** (`api/src/repositories/payslips.ts:35`):

```ts
const passMetadataSchema = z.object({ unreadableFields: z.array(z.string()) }).loose();
```

Extend it to:
- `ungroundableFields: z.array(z.string()).default([])`;
- `fields: z.record(z.string(), z.object({ confidence: z.number().nullable() }).loose()).default({})`.

Minimal test metadata (`{ unreadableFields: [...], queuedMs: 1 }`) must still parse.

**Errors:** repository parse failures throw `PayslipRepositoryError("invalid_data", cause)`, as
`findDetailState` does today. Validation functions never throw on data: `computeWarnings` receives
already-parsed canonical fields.

**Tests:** Vitest with `describe`/`it`/`it.each`, one behaviour per `it`, exact `toEqual` on
arrays. Fixture tests assert "found all eleven" first, so an empty directory cannot pass
vacuously (`shared/src/payslip.test.ts:127`).

**Logging:** add `ungroundableCount` to the existing `logSuccess` fields. Never log values or
paths' contents: counts only.

---

## IMPLEMENTATION PLAN

### Phase 0: Baseline
Clean tree, green validate, the harness baseline, and the hosted row count.

### Phase 1: Foundation
Money helpers in `shared`; `isValidOib`; `computeWarnings`; `lowConfidenceFields`; grounding. All
pure and unit-tested against the fixtures.

### Phase 2: Core
The mapper and provider emit `ungroundableFields`. The migration drops `warnings`. The repository
computes warnings on read and projects both attention lists. The detail route and DTO expose them.

### Phase 3: Integration
Hosted integration tests: warnings appear after the scalars pass, pay-component warnings only
after the tables pass, `warningCount` in the session summary, and the attention lists on detail.

### Phase 4: Measurement and documents
The harness reports warnings, OIB rate and attention. Run it. Update PRD, ROADMAP and CONTEXT.
Validate. Write history, run `/code-review`, fix, re-validate.

---

## STEP-BY-STEP TASKS

Execute in order. Each step ends green before the next begins.

### 1. VERIFY the starting state

- **IMPLEMENT**:
  - `git status` is clean on `prototype/payslip-ocr` (commit this plan first, as Tasks 04–05 did).
  - `npm run validate` is green: **507 tests**.
  - `npm run score:extraction` exits 0 with five sets (`cu` 270/273, `production` 271/273,
    `production-sequential` 272/273, `two-pass-sequential` 271/273, `two-pass-concurrent`
    268/273).
  - Supabase MCP `execute_sql` on project `hxksulbgluvfxfoxrhse`:
    `select count(*) from public.payslips`. Leftover rows belonging to `task0N-*@example.test`
    users: delete those users and record it. **Stop and ask about any other row.**
- **VALIDATE**: `npm run validate && npm run score:extraction`

### 2. ADD money helpers to `shared/src/money.ts` (D3, D6)

- **IMPLEMENT**:
  - `subtractAmounts(a, b)`, mirroring `addAmounts`:
    `new Big(a).minus(b).toFixed(Math.max(scaleOf(a), scaleOf(b)))`.
  - `amountsAgreeToTheCent(a, b)`: `new Big(a).minus(b).abs().lt("0.01")`. Its doc comment states
    D3 (absolute, never relative; a one-cent difference is a mismatch).
  - Export both from `shared/src/index.ts`.
- **TEST** (`shared/src/money.test.ts`):
  - `subtractAmounts("100.50", "0.5")` is `"100.00"`; a negative result;
  - `amountsAgreeToTheCent`: `"1.00"` vs `"1.0"` true; `"1.00"` vs `"1.01"` false; `"1.00"` vs
    `"1.009"` true; `"1.00"` vs `"0.99"` false.
- **GOTCHA**: `Big.strict` means a literal `0.01` number throws. Use the string `"0.01"`.
- **VALIDATE**: `npx vitest run shared/src/money.test.ts`

### 3. CREATE `api/src/validation/oib.ts` + test (D6)

- **IMPLEMENT** `isValidOib(oib: string): boolean` as D6 specifies.
- **TEST**:
  - every non-null `employerOib` and `employeeOib` in the 11 fixtures is valid (read the fixture
    directory as `shared/src/payslip.test.ts` does, path `../../../.agents/fixtures/expected/`
    relative to `api/src/validation/`);
  - changing the last digit of each makes it invalid;
  - rejects `HR` + a valid OIB, 10 and 12 digits, and letters;
  - accepts a known check-digit-0 case (construct one: take ten digits whose computed check is 10,
    so the check digit is 0).
- **VALIDATE**: `npx vitest run api/src/validation/oib.test.ts`

### 4. CREATE `api/src/validation/warnings.ts` + test (D2–D5, D10)

- **IMPLEMENT**:

  ```ts
  export interface WarningInput {
    readonly fields: CanonicalPayslipFields;
    /** Both passes' unreadable canonical paths, scalars first. */
    readonly unreadableFields: readonly string[];
    readonly tablesStatus: TablesStatus;
  }
  export function computeWarnings(input: WarningInput): PayslipWarning[];
  ```

  In `WARNING_CODES` order:
  1. `missing_critical_field` for each `CRITICAL_FIELDS` entry whose value is null or undefined
     and that is **not** in `unreadableFields` (D5).
  2. `unparseable_amount` and `unparseable_date` for each unreadable path whose current value is
     null. Resolve dotted paths against `fields`, for example `payComponents.2.iznos` gives
     `fields.payComponents?.[2]?.iznos`. A path whose row no longer exists counts as null. Emit
     both codes in one pass over `unreadableFields`, keeping its order, then **stable-sort by
     code order**.
  3. `oib_checksum_failed` for `employerOib`, then `employeeOib`, when non-null and
     `!isValidOib`.
  4. The four identities (D2 null rules, D3 comparison):
     - `brutoPlaca − doprinosiIzPlace` vs `dohodak`;
     - `max(0, dohodak − osobniOdbitak)` vs `poreznaOsnovica` (floor via
       `compareAmounts(diff, "0") < 0 ? "0" : diff`);
     - `dohodak − porezNaDohodak` vs `netoPlaca`;
     - `netoPlaca + (neoporeziviPrimiciUkupno ?? "0") − (obustaveUkupno ?? "0")` vs
       `iznosZaIsplatu`.
  5. `pay_components_sum_mismatch` per D2: `tablesStatus === "ready"`, a non-null `brutoPlaca`,
     and at least one row with a non-null `iznos`. Sum with `addAmounts` over those rows.
  - Module doc comment: rules from PRD §7.9, D1 (computed on read, never stored), D3 tolerance.
- **TEST** (`warnings.test.ts`):
  - **Fixtures (D10 table), gated:**
    - assert all eleven were found;
    - `it.each` over samples: `computeWarnings({ fields, unreadableFields: [], tablesStatus:
      "ready" })` `toEqual` the table's expectation exactly.
  - **One-cent injections on A02** (all operands non-null; assert that in the test). Add `0.01` to
    **one operand used only by that identity**, and expect exactly one warning:
    - `doprinosiIzPlace` → `dohodak_mismatch`;
    - `poreznaOsnovica` → `porezna_osnovica_mismatch`;
    - `porezNaDohodak` → `neto_mismatch`;
    - `obustaveUkupno` → `isplata_mismatch`;
    - `payComponents[0].iznos` → `pay_components_sum_mismatch`.
  - **Do not inject into `dohodak`, `brutoPlaca` or `netoPlaca`**: each is an operand of two
    identities.
  - **B01 floor:** B01 with `poreznaOsnovica` `"0.00"` raises nothing. The same with `"0.01"`
    raises `porezna_osnovica_mismatch`.
  - **D2 skips:**
    - null `dohodak` skips the three identities that use it and raises nothing arithmetic;
    - F01's `obustaveUkupno: null` is taken as zero and reconciles;
    - setting F01's `neoporeziviPrimiciUkupno` to null raises `isplata_mismatch`, because an
      absent total is zero and the printed payout no longer matches;
    - G01's empty `payComponents` raises no sum warning;
    - `tablesStatus` `pending` or `failed` raises no sum warning even when it would mismatch;
    - rows with null `iznos` are excluded from the sum.
  - **D5:**
    - an unreadable `period` with a null value gives `unparseable_date` and **no**
      `missing_critical_field` for `period`;
    - an unreadable `brutoPlaca` that now has a value gives nothing;
    - an unreadable `payComponents.1.sati` gives `unparseable_amount`;
    - an unreadable path to a deleted row (index beyond length) gives `unparseable_amount`.
  - **OIB:** a fixture with one digit of `employeeOib` changed gives exactly
    `oib_checksum_failed` `employeeOib`.
  - **Order:** a crafted input raising five codes returns them in `WARNING_CODES` order.
- **VALIDATE**: `npx vitest run api/src/validation`

### 5. CREATE `api/src/validation/attention.ts` + test (D7)

- **IMPLEMENT**:
  - `export const LOW_CONFIDENCE_THRESHOLD = 0.5;`, with a comment carrying D7's table in one
    sentence and "measured 2026-09-25 over five recorded sets";
  - `export function lowConfidenceFields(passes: readonly { fields: Record<string, { confidence:
    number | null }> }[]): string[]`: unique paths in pass order where confidence is a number
    below the threshold.
- **TEST**: 0.49 is flagged, 0.5 is not, `null` is not; the order across two passes; duplicates
  collapse.
- **VALIDATE**: `npx vitest run api/src/validation/attention.test.ts`

### 6. CREATE `content-understanding/grounding.ts` + test, and UPDATE the mapper (D8)

- **IMPLEMENT** `grounding.ts`:
  - `groundingKey(text)`, ported from `ground.ts` `key()`;
  - `isGrounded(printed: string, words: readonly string[], maxRun = 40): boolean`: the
    contiguous-run match (a run never crosses a page: accept `words` as a per-page
    `string[][]`, or pass page numbers, whichever reads more plainly), capped at 200
    accumulated characters;
  - `UNGROUNDABLE_BY_DESIGN = ["period"]`, with the D8 reason in its comment.
- **UPDATE** `fields.ts`:
  - `operationSchema`: `contents[].pages` becomes optional
    `z.array(z.object({ words: z.array(z.object({ content: z.string() }).loose()).optional()
    }).loose())`;
  - `MappedExtraction` gains `ungroundableFields: string[]`;
  - in `read()`, after recording metadata, push the path when
    `!UNGROUNDABLE_BY_DESIGN.includes(path) && !isGrounded(printed, pageWords)`. Only the scalar
    path `period` is excluded;
  - order follows mapping order, as `unreadableFields` does.
- **TEST**:
  - `grounding.test.ts`:
    - `1.801,77` against words `["1.801,77"]` is grounded;
    - `2.298,97` against `["2.298,97"]` is grounded;
    - a multi-word name split across words is grounded;
    - a diacritic variant (`PLACU` vs `PLAĆU`) is grounded;
    - a 13-word value is grounded with the default `maxRun` and not with 12;
    - a run across two pages is not grounded;
    - an absent value is not grounded.
  - `fields.test.ts`:
    - an `operation()` with `pages: [{ words: [...] }]` puts an invented `iznosZaIsplatu` in
      `ungroundableFields`, and a printed one not;
    - `period` is never listed;
    - a table cell path (`obustave.0.naziv`) is listed when absent from the words;
    - a body without `pages` gives every present value as ungroundable (no words, nothing
      grounds). Assert it, and note it in the mapper comment: real bodies always carry pages.
  - Extend the existing `skipIf` recordings block over `.bakeoff/cu/`: every sample maps, and
    across the set `ungroundableFields` holds **no scalar path** and **at most one table-cell
    path** (planning measured: A01 `obustave.10.naziv` only).
- **GOTCHA**:
  - `markdown` is **not** the source. It contains table pipes and reordered text; the words are
    what the bake-off measured.
  - Keep `key()`'s combining-mark range written as an escape (`/[̀-ͯ]/g`) so the source
    stays ASCII-safe.
- **VALIDATE**: `npx vitest run api/src/providers`

### 7. UPDATE the provider and extraction metadata (D8)

- **IMPLEMENT**:
  - `types.ts`: `ExtractionMetadata.ungroundableFields: string[]`, with a doc comment;
  - `provider.ts`: `ungroundableFields: mapped.ungroundableFields`;
  - `payslip-extraction.ts#logSuccess`: `ungroundableCount`.
- **TEST**: extend `provider.test.ts` where it asserts metadata; extend
  `payslip-extraction.test.ts` fakes if their metadata literals must now carry the field (the
  typecheck will say).
- **VALIDATE**: `npm run typecheck && npx vitest run api/src/providers api/src/services`

### 8. UPDATE `shared/src/api.ts` and `shared/src/warnings.ts` (D9)

- **IMPLEMENT**:
  - `ungroundableFields` on `payslipDetailResponseSchema` (D9's comment);
  - `shared/src/warnings.ts` module comment: the rules now live in
    `api/src/validation/warnings.ts`, and warnings are computed on read (D1);
  - update `shared/src/payslip.ts`'s `fieldMetadataSchema` comment to name the projections
    `lowConfidenceFields` and `ungroundableFields`.
- **TEST**: `shared/src/api.test.ts`: detail parses with `ungroundableFields`; strip behaviour
  unchanged.
- **VALIDATE**: `npx vitest run shared`

### 9. CREATE the migration, dry-run, apply, regenerate types (D1)

- **IMPLEMENT** `supabase/migrations/<version>_drop_stored_warnings.sql`:

  ```sql
  -- Task 06 D1: warnings are a pure function of canonical_data, status, tables_status and
  -- extraction_metadata, computed on every read. A stored copy would race between the two
  -- extraction passes and could only ever go stale.
  alter table public.payslips drop constraint payslips_warnings_array;
  alter table public.payslips drop column warnings;
  ```

- **APPLY** exactly as Task 05 step 4:
  - `execute_sql` `begin; <migration>; rollback;` as the dry run;
  - then `apply_migration` named `drop_stored_warnings`, and rename the local file to the recorded
    version;
  - regenerate types with `generate_typescript_types`, keeping the file's existing output style.
    The diff should be exactly the three `warnings` entries removed.
- **GOTCHA**:
  - Check `list_migrations` first: the local file's version must match what gets recorded.
  - The deploy window is in D1. It goes in history's open items.
- **VALIDATE**:
  - `get_advisors` (security): only the known `auth_leaked_password_protection`;
  - `npm run typecheck` then fails in the repository and its test factory. That is expected, and
    step 10 fixes it.

### 10. UPDATE `api/src/repositories/payslips.ts` + tests (D1, D5, D7, D8)

- **IMPLEMENT**:
  - remove `warnings` from `PAYSLIP_COLUMNS`, and drop `warningsSchema` if it is now unused;
  - extend `passMetadataSchema` per "Patterns to Follow";
  - one private helper `readPassMetadata(row)` returns the parsed `{ scalars?, tables? }` or
    throws `invalid_data`;
  - `mapPayslipRow`:
    - parse the canonical fields once;
    - `warnings`: for `review` or `confirmed` rows,
      `computeWarnings({ fields, unreadableFields: [...scalars.unreadableFields,
      ...tables.unreadableFields], tablesStatus })`;
    - otherwise `[]`;
  - `PayslipDetailState` gains `lowConfidenceFields` and `ungroundableFields`. `findDetailState`
    fills them with `lowConfidenceFields([...])` and the concatenated `ungroundableFields`;
  - the row type for `mapPayslipRow` must include `extraction_metadata`, which `PayslipReadRow`
    already does.
- **TEST** (`payslips.test.ts`):
  - remove `warnings: []` from the factory;
  - a `review` row whose `canonical_data` lacks `employerName` yields
    `missing_critical_field employerName`;
  - the same row in `processing` or `failed` yields `[]`;
  - a mismatching pay-component sum warns only with `tables_status: "ready"`;
  - `extraction_metadata.scalars.unreadableFields: ["period"]` with a null period yields
    `unparseable_date`;
  - `findDetailState` projects `lowConfidenceFields` and `ungroundableFields` from a two-pass
    metadata literal, and old metadata without either key parses to `[]`;
  - malformed metadata throws `invalid_data`.
- **VALIDATE**: `npm run typecheck && npx vitest run api/src/repositories`

### 11. UPDATE `api/src/routes/payslips.ts` (D7, D9)

- **IMPLEMENT**: the detail body uses `state.lowConfidenceFields` and `state.ungroundableFields`.
  Remove the "Task 06 owns the confidence threshold" comment. `sessions.ts` needs no change:
  `payslip.warnings.length` is now live.
- **TEST**: `api/src/app.test.ts` or route-level tests, if any fake the repository's detail
  state, gain the two fields (the typecheck finds them).
- **VALIDATE**: `npm run validate`

### 12. EXTEND the hosted integration suite (`api/src/routes/payslips.integration.ts`)

- **IMPLEMENT** new cases, reusing the file's user, session and pass-writing helpers:
  1. A scalars pass written with `employerName: null` and an `unreadableFields: ["brutoPlaca"]`
     metadata with `brutoPlaca: null`. The detail `warnings` contain `missing_critical_field
     employerName` and `unparseable_amount brutoPlaca`, and `warningCount` in `GET
     /api/sessions/:id` equals `warnings.length`.
  2. A scalars pass with metadata `fields: { netoPlaca: { confidence: 0.2, source: "model" } }` and
     `ungroundableFields: ["netoPlaca"]`. Detail has `lowConfidenceFields: ["netoPlaca"]` and
     `ungroundableFields: ["netoPlaca"]`.
  3. Pay components that do not sum to `brutoPlaca`: no `pay_components_sum_mismatch` while
     `tablesStatus` is `pending`. Once the tables pass lands, it appears. This is the per-pass
     recompute of Task 05 D11, now by construction.
  - Existing expectations stay green: a `processing` payslip has `warnings: []`,
    `warningCount: 0`, `lowConfidenceFields: []`, and now `ungroundableFields: []`.
- **VALIDATE**: `npm run test:integration` (hosted, no Azure). Then check for orphans with
  `execute_sql` (0 `task0N-` users, payslips and Storage objects).

### 13. UPDATE the harness (D11)

- **IMPLEMENT**:
  - `score.ts`:
    - `ScoringInput` gains optional `warnings: PayslipWarning[]`, `lowConfidenceFields:
      string[]` and `ungroundableFields: string[]`;
    - `SetReport` gains `oib: Tally`, `warningsByCode: Record<WarningCode, number>` and
      `attention: { wrongFlagged: Tally; flaggedScalars: number }`;
    - `SampleReport` gains `warningCodes: string[]`;
    - OIB counts non-null actual `employerOib` and `employeeOib`, with `hit = isValidOib`;
    - attention: of the scalar fields scored wrong (the `wrong` list already built), `hit` when
      the path is in `lowConfidenceFields`, in `ungroundableFields`, or the `field` of a warning.
  - `score-extraction.ts`:
    - `singlePass` maps once;
    - `twoPass` maps per pass and concatenates both passes' `unreadableFields`,
      `ungroundableFields` and `lowConfidenceFields([...])`;
    - both compute `computeWarnings({ fields, unreadableFields, tablesStatus: "ready" })`;
    - `printSet` prints the new lines and adds a `warnings` column to the per-sample table.
- **TEST** (`score.test.ts`):
  - OIB tally over a valid and an invalid value;
  - attention hit and miss;
  - `warningsByCode` counting;
  - an input without the optional fields reports zeros and does not throw.
- **GOTCHA**: `score.ts` is under `api/src` and falls under the vocabulary guard. Say
  "recording", not "analyzer".
- **VALIDATE**: `npx vitest run api/src/scoring && npm run score:extraction`
  - Expected, as measured in planning: accuracy numbers unchanged; the D10 recordings warnings;
    OIB 100% in every set; attention on wrong scalars ≥ 6/7 overall, per set as printed.
  - If any accuracy number moves, **stop**: the mapper change leaked into values.

### 14. UPDATE the documents

- **`PRD.md`**:
  - §7.9 Rules:
    - "agree to the cent: a difference of one cent or more is a mismatch (absolute, never
      relative)";
    - identities with a null operand are skipped, except that `isplata` treats a null
      `neoporeziviPrimiciUkupno` or `obustaveUkupno` as zero;
    - the sum check needs `tablesStatus: ready` and at least one amount;
    - computed on every read, never stored.
  - §10.5: add `ungroundableFields`.
  - §11.3: the OIB row "measured" now points at the harness.
  - Appendix B: remove `warnings jsonb`, with a note "computed on read (Task 06 D1)".
- **`.agents/ROADMAP.md`**:
  - §2: Task 06 ✅ with the history link.
  - Task 06 DoD ticked with evidence. Reword the A04 item per D10, "ten" to "all eleven" per D2,
    and "warnings never block" to "no status write consults warnings (confirm and export are
    Tasks 09 and 12)".
  - Task 09 scope: excluding edited fields from `lowConfidenceFields` and `ungroundableFields`, and
    positional table paths after row edits (D5). Warnings render from the detail response.
  - Task 08: `ungroundableFields` exists and is a different thing from region `origin: "text"`.
  - §5: add nothing unless something new was found. The rule-creep risk stays "watch": this task
    adds no parser rule.
- **`CONTEXT.md`**, under Review, a new term:

  > **Attention signal**: a mark on an extracted value that asks the reviewer to check it — a
  > Warning, low confidence, or an ungroundable value (its printed text is not in the page's OCR
  > words). Attention signals mark; they never suppress a value or block a workflow.
  > _Avoid_: error, validation failure, flag

- **VALIDATE**: `npx prettier --check .`

### 15. RUN the full validation sweep

- **VALIDATE**, each once (the project's "don't re-run passed checks" rule):
  - `npm run validate`;
  - `npm run build`;
  - `npm run check:golden`;
  - `npm run score:extraction`;
  - `npm run test:integration` (only if step 12's run preceded code changes; otherwise it already
    passed);
  - lockfile unchanged (`git diff --stat package-lock.json` is empty);
  - `get_advisors` (security);
  - the orphan check.
- Not run: `npm run test:extraction` (D12, paid) and browser journeys (no UI changed).

### 16. WRITE `.agents/history/06-warnings-validation-engine.md`

- Mirror history/05's sections:
  - what was built;
  - decisions carried (D1–D13);
  - deviations;
  - the D10 fixture table as verified;
  - the harness output per set (warnings, OIB, attention);
  - validation;
  - open items, including D1's deploy window, D5's positional paths for Task 09, and D7's
    `period`/`paymentDate` noise.
- **Then** run `/code-review` on the uncommitted work, fix what holds up, re-validate, and record
  the review in the history file before committing (the project's commit rule).

---

## TESTING STRATEGY

### Unit Tests (no network)

- `shared/src/money.test.ts`: the two helpers.
- `api/src/validation/*.test.ts`:
  - the fixture table (gated, all 11);
  - one-cent injections per identity;
  - D2 and D5 rules;
  - OIB edge cases;
  - the confidence threshold boundary.
- `content-understanding/grounding.test.ts` and `fields.test.ts`: grounding semantics, the `period`
  exclusion, table-cell paths, plus the recordings block under `skipIf`.
- `payslips.test.ts`: read-time computation by status and `tablesStatus`, and metadata
  projections with old-shape tolerance.
- `score.test.ts`: the new report fields.

### Integration Tests (hosted Supabase, no Azure)

Step 12's three cases, plus the unchanged existing suite. They prove the column drop, the
read-time computation through PostgREST rows, and the per-pass recompute.

### Measurement (offline, $0)

`npm run score:extraction` over all five recorded sets. The expected output is recorded in D7, D8
and D10.

### Edge Cases

- Tables land before scalars (`processing` + `ready`): `[]` until `review`.
- `review` + `tablesStatus: failed`: no sum warning; everything else is computed.
- B01's zero floor; `"0.00"` against `null` totals (A03 prints `0,00`, F01 has none).
- An unreadable critical field: `unparseable_*` only.
- Unreadable paths pointing past a table's current length.
- OIB with an `HR` prefix or wrong length.
- Metadata written before this task (no `ungroundableFields`, no `fields`).
- `confidence: null`.
- A body without `pages` (synthetic only).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` (oxlint) · `npm run format:check`

### Level 2: Unit Tests

`npm run test` (Vitest, all three workspaces). Expect 507 plus the new tests, all green.

### Level 3: Integration Tests

`npm run test:integration`: hosted Supabase, the auth and payslips suites.

### Level 4: Manual Validation

- `npm run score:extraction`: read the new Warnings, OIB and Attention lines against D7, D8 and
  D10.
- With the dev server and a signed-in token, `GET /api/payslips/:id` on a payslip from step 12's
  flow shows `warnings`, `lowConfidenceFields` and `ungroundableFields`. This is optional: the
  integration test already asserts it.

### Level 5: Additional Validation

- Supabase MCP: `list_migrations` shows `drop_stored_warnings` once, and `get_advisors` (security)
  shows only the known finding.
- The `execute_sql` orphan check.
- `npm run check:golden` (no fixture changed; M4 is not triggered).

---

## ACCEPTANCE CRITERIA

- [ ] All eleven fixtures produce exactly the D10 warning sets, gated in `warnings.test.ts`: zero
      arithmetic and zero OIB warnings on all eleven.
- [ ] B01 raises no `porezna_osnovica_mismatch`; B02 raises no `pay_components_sum_mismatch`.
- [ ] A one-cent error in each identity raises exactly that identity's warning (five injections).
- [ ] A04: `missing_critical_field` when `iznosZaIsplatu` is null. When the engine invents it,
      `isplata_mismatch` fires and its confidence is below the threshold, as reported by the
      harness (D10).
- [ ] No status write reads warnings. `grep -rn "warnings" api/src` shows only computation and
      response mapping.
- [ ] `lowConfidenceFields` and `ungroundableFields` are served on detail, computed per D7 and D8.
- [ ] `npm run score:extraction` reports warnings, the OIB checksum pass rate and attention on
      wrong scalars for all five sets, with accuracy figures unchanged.
- [ ] Migration `drop_stored_warnings` applied once; advisors clean; types regenerated.
- [ ] `npm run validate`, `npm run build` and `npm run test:integration` are green; the lockfile
      is unchanged.
- [ ] PRD, ROADMAP and CONTEXT updated; history written; `/code-review` findings addressed and
      recorded.

---

## COMPLETION CHECKLIST

- [ ] All steps completed in order, each step's validation green
- [ ] Full sweep (step 15) run once each
- [ ] No paid Azure call made (D12)
- [ ] Hosted orphans 0
- [ ] History file and review recorded before commit

---

## NOTES

- **Why not compute warnings in SQL?** It would duplicate the rules in a second language, and
  PL/pgSQL numeric comparisons would be a second implementation of D3. The read path already has
  every input.
- **Why the threshold is global:** per-field thresholds tuned to 11 documents would be fitting
  noise, with a 0.5% run-to-run band and 7 wrong observations in total. Revisit only with more
  recordings.
- **Harness recall is not a target.** It exists so a future schema or model change that silently
  loses the signal on wrong values is visible.
- **Confidence score for one-pass success: 8/10.** The risky parts are:
  - the mapper change leaking into values (guarded by the unchanged-accuracy check in step 13);
  - the hosted migration step (guarded by the dry run and advisors);
  - the integration helpers' metadata shapes (the typecheck finds them).
