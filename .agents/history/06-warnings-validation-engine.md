# 06 — Warnings & validation engine

**Date:** 2026-09-25
**Plan:** [`plans/06-warnings-validation-engine.md`](../plans/06-warnings-validation-engine.md)
**Outcome:** every extracted payslip now carries three attention signals:

- the nine PRD §7.9 warnings, computed on every read and never stored;
- `lowConfidenceFields`, at a global threshold of 0.5;
- `ungroundableFields`: values whose printed text is not among the page's OCR words.

The golden set produces exactly the expected warnings, including zero arithmetic and zero OIB
warnings on all eleven. The scoring harness now reports warnings, the OIB checksum pass rate (100%
in every set) and attention on wrong values (12 of 13 flagged across five sets). Accuracy figures
are unchanged. No paid Azure run was made.

## What was built

| File | Contents |
| --- | --- |
| `shared/src/money.ts`, `index.ts` | `subtractAmounts`, `amountsAgreeToTheCent` (D3, D6) |
| `api/src/validation/oib.ts` | `isValidOib`, ISO 7064 MOD 11,10 ported from `check-golden-set.py` |
| `api/src/validation/warnings.ts` | `computeWarnings`: the nine rules with the D2 and D5 null rules, in `WARNING_CODES` order |
| `api/src/validation/attention.ts` | `LOW_CONFIDENCE_THRESHOLD = 0.5`, `lowConfidenceFields` (D7) |
| `…/content-understanding/grounding.ts` | `groundingKey`, `surfaceForms` (dates and OIBs), `keyPages`, `isGrounded`, `UNGROUNDABLE_BY_DESIGN = ["period"]`, `MAX_RUN = 40` (D8) |
| `…/content-understanding/fields.ts` | Reads `contents[].pages[].words`; `ungroundableFields` on `MappedExtraction` |
| `…/document-extraction/types.ts`, `provider.ts` | `ExtractionMetadata.ungroundableFields` |
| `api/src/services/payslip-extraction.ts` | `ungroundableCount` on the per-pass log line |
| `supabase/migrations/20260925085725_drop_stored_warnings.sql` | Drops `payslips.warnings` and its check (D1) |
| `api/src/database.types.ts` | The three `warnings` entries removed, nothing else |
| `api/src/repositories/payslips.ts` | Warnings computed in `mapPayslipRow`; `readPassMetadata`; detail state gains `lowConfidenceFields` and `ungroundableFields` |
| `api/src/routes/payslips.ts` | The detail body serves both projections |
| `shared/src/api.ts`, `warnings.ts`, `payslip.ts` | `ungroundableFields` on the detail DTO (D9); comments |
| `api/src/scoring/score.ts`, `scripts/score-extraction.ts` | `oib`, `warningsByCode`, `attention` per set; a `warnings` column per sample (D11) |
| `PRD.md`, `CONTEXT.md`, `.agents/ROADMAP.md` | §7.9 rules, §7.12, §10.5, §11.3, Appendix B; the term *Attention signal*; DoD, Tasks 08 and 09 |

New tests: `oib`, `warnings`, `attention` and `grounding`. Extended: `money`, `fields` (grounding and
the recordings block), `provider`, `payslip-extraction`, `payslips` (repository), `score` and
`api`. There are also 3 new hosted integration cases.

Supabase: migration `drop_stored_warnings` applied once (version `20260925085725`), after a
transactional dry run.

## Design decisions carried

D1–D13 as the plan states them. Before execution the product owner confirmed two choices raised
at priming:

- **Accept D1's deploy window:** apply the column drop now rather than deferring it.
- **Keep `period` and `paymentDate` in the low-confidence list** rather than excluding them per
  field, and revisit their rendering in Task 09.

## Deviations from the plan

1. **Grounding also matches Croatian surface forms of the canonical value (D8 corrected).**
   - **D8's premise was wrong.** It dropped the bake-off's `surfaceForms()` because the service
     "returns the printed string". It does not for every field. The field schema asks for
     `paymentDate` as `YYYY-MM-DD` and for OIBs without their `HR` prefix.
   - **Matching the returned string alone** flagged 5 correct payment dates and F01's correct
     `employerOib` in `cu`.
   - **The fix:** a value is grounded when its printed string, or any printed form of its
     canonical value, is on the page. That is the bake-off's measured method, not a new rule. Only
     the date and OIB branches are ported: those are the two kinds the schema normalises. Amounts
     come back as printed, and `groundingKey` already ignores their separators. The period branch
     would be unused, since `period` is never grounded.
   - **Result:** exactly the figures planning reported. There is 1 ungrounded scalar (production
     A04's invented `1801.77`), and 2 table cells (A01 `obustave.10.naziv` in `cu` and R3).
2. **Grounding keys each page's words once, and stops a run that is no target's prefix.** As first
   written, it re-keyed every page word for every value, and the recordings test timed out
   (11.3 s) under the full suite. The pruning cannot change a result: a run that is no target's
   prefix can never become one. The provider tests now take under 1 s. The bake-off's
   200-character cap is dropped: with pruning it did nothing except make a longer value
   ungroundable. No recorded value is that long, so no figure moved.
3. **Warned statuses are their own constant**, `WARNED_STATUSES` in the repository, rather than
   the equal `EDITABLE_PAYSLIP_STATUSES`: "editable" and "has a readable form" are different
   concepts that should not change together by accident.
4. **The integration cases use their own session.** The Task 05 session already holds 8 live
   payslips, and three more would cross the cap of ten. The pass-writing helper is at module scope
   because oxlint's `consistent-function-scoping` requires it.
5. **The third integration case also expects `unparseable_amount payComponents.0.sati`.** The
   shared tables fixture lists that null cell as unreadable, so the warning is correct.
6. **Attention is reported over all wrong scalars.** Planning's "6/7" counted only non-null wrong
   values. Measured: 12 of 13 across the five sets. The one miss is R3 F01 `employerAddress`, at
   confidence 0.735, as D7 predicted.

## Golden set (fixtures, gated)

`computeWarnings` over each fixture, with `tablesStatus: ready` and no unreadable fields, equals
D10's table exactly:

| Sample | Warnings |
| --- | --- |
| A01 A02 A03 B01 B02 C01 D01 | none |
| A04 | `missing_critical_field` `iznosZaIsplatu` |
| E01, F01 | `missing_critical_field` `employerName` |
| G01 | `missing_critical_field` × `employerName`, `employeeName`, `employeeOib`, `period` |

No fixture raises an arithmetic or OIB warning:

- B01 is consistent at its zero floor.
- B02's hours are never summed.
- F01's absent obustave total is taken as zero, and reconciles.
- G01's empty pay-components table raises no sum warning.

A one-cent injection into each of five operands of A02 raises exactly that identity's warning.

## Harness (recordings, reported, never gated)

`npm run score:extraction`, five sets, exit 0. Accuracy is unchanged: scalars 270 / 271 / 272 /
268 / 271, cells 502 / 504 / 503 / 502 / 478.

| Set | OIB checksum | Warnings beyond the fixtures' | Wrong scalars flagged | Scalars flagged |
| --- | --- | --- | --- | --- |
| `cu` | 19/19 | A04 `isplata`, F01 sum, G01 `unparseable_amount` | 3/3 | 20 |
| `production` | 19/19 | F01 sum, G01 `unparseable_amount` | 2/2 | 19 |
| `production-sequential` | 19/19 | G01 `unparseable_amount` | 1/1 | 20 |
| `two-pass-concurrent` (R3) | 19/19 | A04 `isplata`, B01 `unparseable_date`, C01 sum, G01 `unparseable_amount` | 4/5 | 22 |
| `two-pass-sequential` (R2) | 19/19 | A04 `isplata`, G01 `unparseable_amount` | 2/2 | 17 |

Every warning beyond the fixtures' marks a real extraction fault, as D10 predicted:

- **A04 `isplata`:** the occluded payout invented as `2033.32`.
- **F01 sum:** the total row read as a component.
- **C01 sum:** R3's IP1 statutory breakdown.
- **G01 `unparseable_amount`:** the `1.219.08` case.
- **B01 `unparseable_date`:** R3's `2025, MJESEC 6`.

Some faults show up another way instead:

- **`production` A04:** the invented `1801.77` reconciles and raises no `isplata_mismatch`. It is
  caught by grounding and by its confidence of 0.044.
- **`cu`, `production` and R3 F01:** a wrong `employerName` is present, so no
  `missing_critical_field` fires. The low-confidence mark catches it (R3: 0.146).

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` | green: 43 files, **631 tests** (507 before); 632 after the review |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run check:golden` | `ALL IDENTITIES AND CHECKSUMS PASS` |
| `npm run score:extraction` | five sets, accuracy unchanged, exit 0 |
| `npm run test:integration` | hosted: 3/3 auth + **27/27** payslips (24 before) |
| Migration | dry run clean; `list_migrations` shows `drop_stored_warnings` once |
| `get_advisors` (security) | only the known `auth_leaked_password_protection` |
| Orphans (`execute_sql`) | 0 `task0N-` users, 0 payslips, 0 sessions, 0 Storage objects |
| Lockfile | unchanged |
| `grep warnings api/src` | computation and response mapping only; no status write reads them |

Not run:

- `npm run test:extraction`: paid (D12). Total Azure cost for this task: **$0**.
- Browser journeys: no UI changed.

## Post-completion review and validation

`/code-review` (standards and spec axes) ran on the uncommitted work on 2026-09-25. Each finding
was checked against the code before it was acted on.

**Fixed:**

1. **The amount branch of `surfaceForms` was removed.** It was redundant, and its bare-integer
   form (`1800` for `1800.00`) loosened the hallucination signal with no evidence behind it.
2. **The 200-character run cap was removed** (deviation 2).
3. **`WARNED_STATUSES` replaces `EDITABLE_PAYSLIP_STATUSES`** (deviation 3).
4. **Doc comments** on `WarningInput` and `PassFieldConfidence`.

**Recorded:**

- **Metadata is now parsed on every read path, not only on detail.** `mapPayslipRow` computes
  warnings from it. A payslip with malformed `extraction_metadata` fails the session, list and
  history reads as `invalid_data`, as a malformed `canonical_data` already did. Only the API
  writes that column.
- **Plan D10 says A04's payout was null "in 2 of the 5 recorded sets".** Only
  `production-sequential` is null. `production` invents `1801.77`, which reconciles, so there it
  is marked by grounding and confidence rather than by `isplata_mismatch`. The ROADMAP DoD states
  this.

**Rejected, with evidence:**

- *"An unreadable path to a deleted row raises a phantom warning."* D5 chose this deliberately and
  deferred row edits to Task 09 (open item 3). No row can be deleted before Task 09.
- *"Edited values stay low-confidence or ungroundable."* D13 assigns this to Task 09, the first
  writer of `edited_fields` (open item 4).
- **Left as judgement calls:**
  - the harness's `signals()` mirroring the repository projection (D11 asks for the same
    functions, with tables taken as landed);
  - the OIB field pair listed in two modules;
  - metadata parsed twice on a detail read;
  - `isGrounded`'s `maxRun` parameter, which the test uses to prove the 12-versus-40 finding.

**Re-validated:**

- `npm run validate`: green, 43 files and **632 tests**.
- `npm run score:extraction`: every figure unchanged, including grounding (1 ungrounded scalar,
  2 cells) and attention (12 of 13).
- Hosted integration was not re-run. The one repository change swaps an equal status list.

## Open items for later tasks

1. **Deploy window (D1, accepted).** The hosted `payslips.warnings` column is gone. The deployed API
   still selects it, so every payslip read on Render fails until this code is subtree-pushed. The
   push also needs Task 04's H1 (the four `AZURE_CU_*` variables on Render).
2. **Task 09: dates below the threshold.** `period` and `paymentDate` sit below 0.5 on most
   payslips even when correct, 49 of the 68 scalar flags planning measured. The product owner kept
   them in the list; Task 09 decides how they render.
3. **Task 09: positional table paths.** `unreadableFields` paths such as `payComponents.3.iznos`
   are positional. Once rows can be added or removed they can name the wrong row (D5).
4. **Task 09: edited fields.** Excluding edited fields from `lowConfidenceFields` and
   `ungroundableFields` is Task 09's, since it is the first writer of `edited_fields`.
5. **A present but wrong critical value raises no warning of its own.** An example is F01's
   employee name in `employerName`. Only the confidence and grounding signals can mark it. This
   is by design: the taxonomy is closed at nine codes.
