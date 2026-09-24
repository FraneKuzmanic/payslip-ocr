# 02 — Canonical payslip domain model & shared contracts

**Date:** 2026-09-24
**Plan:** [`plans/02-canonical-payslip-model.md`](../plans/02-canonical-payslip-model.md)
**Outcome:** the payslip domain is expressed once, in `shared/`: the canonical fields, the
server envelope, the Session and status machine, the nine warning codes, per-field metadata and
every PRD §10 DTO. The Croatian parsers reject what they cannot normalise, and a new period parser
reads all seven layouts' printed forms. No endpoint, table or UI changed.

## What was built

| File | Contents |
| --- | --- |
| `shared/src/payslip.ts` | `canonicalPayslipFieldsSchema` (25 scalars + 3 tables, strict), `payslipSchema` (fields + envelope), the three row schemas, `CRITICAL_FIELDS`, `FIELD_SOURCES`, `fieldMetadataSchema` |
| `shared/src/session.ts` | `sessionSchema`, `PAYSLIP_STATUSES`, `PAYSLIP_STATUS_TRANSITIONS`, `canTransition`, `EDITABLE_PAYSLIP_STATUSES`, the failure reasons (moved from `api.ts`), `RETRYABLE_FAILURE_REASONS`, `isRetryableFailure` |
| `shared/src/warnings.ts` | `WARNING_CODES` (PRD §7.9's nine, in order), `payslipWarningSchema` |
| `shared/src/api.ts` | DTOs for §10.2–10.8, 10.11, 10.12, 10.14–10.15. The existing `.strip()`/`.strict()` comment and source DTOs are unchanged |
| `shared/src/datetime.ts` | `parseIssueDate` → `parseDate`; new `PERIOD_PATTERN` and `parsePeriod`; time parsing removed |
| `shared/src/money.ts` | `parseAmount` rejects the ambiguous single-separator 3-digit group |
| `shared/src/quantity.ts` | Code unchanged; documented as the parser for `sati`, `koeficijent`, `ukupnoSati` |
| `api/src/providers/document-extraction/types.ts` | `fields: CanonicalPayslipFields`; metadata is the shared `FieldMetadata`, keyed by canonical dotted path |

Tests: `payslip.test.ts` (schema, the 11-fixture round trip, the provider-independence guard),
`session.test.ts`, `warnings.test.ts`, and additions to the `money`, `quantity`, `datetime` and
`api` tests.

## Design decisions carried

D1–D9 as the plan states them, accepted on 2026-09-24. In brief:

- **D1:** hours and coefficients use `parseQuantity`, money uses `parseAmount`.
- **D2:** `parseAmount("1.234")` returns `null`.
- **D3:** `currency` is envelope. Fixtures are round-tripped on the canonical keys and fail on an
  unknown or missing key.
- **D4:** `parsePeriod` rejects a span across months and a lone date.
- **D5:** four closed statuses, and `confirmed` has no outgoing transition.
- **D6:** upload codes are left for Task 03.
- **D7:** the parser surface was cleaned up.
- **D8:** locale copy is deferred to Tasks 07 and 09.
- **D9:** per-field metadata is in `shared` but in no DTO.

## Test expectations that flipped

Only two, both under D2, in `money.test.ts`: `"1.234"` and `"1,234"` went from `"1234"` to `null`.
Nothing else relied on the guess. `quantity.test.ts` needed no change, because its three-decimal
branch runs before `parseAmount`.

## Deviations from the plan

1. **`payslipSummarySchema` and `sessionDetailResponseSchema` are derived, not declared with
   `z.object`.**
   - The plan's step 8 wrote them out by hand. Its completion checklist forbids any hand-redeclared
     DTO shape.
   - They are `.pick(...).extend(...)` over `payslipSchema` and `sessionSchema`.
   - `.required({ period: true, employeeName: true })` keeps the plan's required-nullable contract:
     the post-completion review found the bare `.pick` had made them optional, so a body omitting
     them parsed. A test now pins it.
2. **The merge `order` refinement also rejects a repeated id.** The plan asked for "a permutation
   of `payslipIds`". An `every(includes)` check accepts `order: [A, A]`. An added test caught
   this, so the refinement now also requires the two `order` entries to differ.
3. **Extra tests not in the plan:**
   - `"1234.567"` → `"1234.567"` in money, pinning the edge case the plan names.
   - An empty table stays distinct from a `null` one.
   - The merge case above.
4. **Before execution**, the plan's step 3 wording on anchoring was corrected, and the fixtures
   README's stale G01 `period` note was fixed. Both were committed with the plan in `9cd5394`.

## Validation

| Check | Result |
| --- | --- |
| Per-step `vitest run --project shared <file>` | green at every step (api once red, see deviation 2) |
| `npm run validate` (typecheck, lint, format, test) | green: 31 test files, 393 tests (256 before) |
| `npm run build` | green. Vite prints its chunk-size advisory for the client bundle, which this task does not touch |
| `grep parseIssueDate\|parseIssueTime\|ISO_TIME_PATTERN` over `shared`, `api`, `client` | empty |
| Provider vocabulary in `shared/src` outside `payslip.test.ts` | empty |
| `Record<string, unknown>` in the provider types | empty |

**Not run, deliberately:**

- `npm run score -- cu` and `check:golden`: no fixture data changed, and the bake-off harness does
  not import `@payslip/shared`.
- `test:integration`: no API or database behaviour changed.
- The browser: no UI changed.

## Open items for later tasks

1. **Task 04:** `ExtractionError` still takes `retryable` separately from `reason`. Derive it from
   `isRetryableFailure`.
2. **Task 04:** the mapper assigns the parsers. Hours and coefficients go through `parseQuantity`,
   money through `parseAmount`, the period through `parsePeriod`, dates through `parseDate`.
   `brojRata` stays text.
3. **D2 risk:** a real `1.200` (grouped, no cents) now becomes `null`. No recorded amount prints
   that way. If Task 04 scoring regresses on it, fix the field schema's description ("always
   include decimals"), not the parser.
4. **The period grammar is Croatian knowledge in code** (ROADMAP §5, rule creep). If a new form
   appears, prefer asking the analyzer for `YYYY-MM` over adding a regex.
5. **Task 08:** `sourceRegionsResponseSchema` is a `.strict()` response, which contradicts
   `api.ts`'s own rule. Task 08 rebuilds that contract.
6. **Task 09:** table-row objects are `.strict()` inside `.strip()` responses, so a newly added row
   column would still break a stale tab. receipt-ocr accepted the same trade-off.
7. **Task 12:** `client/src/history/download.ts` still types `"csv" | "json"` inline. Switch it to
   `ExportFormat`.
8. **Tasks 07 and 09:** hr/en copy for statuses and warning codes (D8), now in each task's scope.

## Post-completion review and validation (2026-09-24)

Before commit, the uncommitted work was reviewed with `/code-review` (Standards and Spec as
separate agents) and then put through the full `/validate` sweep. The earlier record above had run
only Phases 1–5.

**Spec review: no blocking gaps.** It re-ran the suite (393/393) and probed `parsePeriod` on forms
outside the tests. **Standards review: conventions held**; its findings were judgement calls.

**Fixed in this pass:**

| Finding | Fix |
| --- | --- |
| Deviation 1 had made `period` and `employeeName` optional in `payslipSummarySchema`, against plan step 8 and PRD §10.4 | `.required({ period, employeeName })` on the derived schema; a test proves omitting either fails |
| The provider-vocabulary guard read only the top level of `shared/src`, while the plan says every `*.ts` | Recursive `readdirSync`. A throwaway `shared/src/<dir>/probe.ts` containing `azure` made it fail, then was removed |
| validate.md 6.8 failed: `pageCount` and `confidence` moved from the exempt `api.ts` into `payslip.ts` | The check now allows `z.number()` outside `api.ts` only on keys named in a `NUMERIC` set. A probe `brutoPlaca: z.number()` still fails it |
| validate.md's Phase 4 table was not extended by Task 02 | Rows for `payslip`, `session`, `warnings` and the request tests; `money`, `datetime` and `quantity` rows corrected |

**Reviewed and deliberately not changed:**

- Strict table rows and warnings inside `.strip()` responses: the plan's accepted trade-off, open
  item 6 above.
- `EDITABLE_PAYSLIP_STATUSES` and the export DTOs with no consumer yet: the plan specifies them.
- `retryPayslipResponseSchema` and `mergePayslipsResponseSchema` sharing one shape: two endpoints,
  as the plan writes them.
- `parsePeriod`'s inline whitespace class next to `WHITESPACE`: the constant has no `+` and is
  used to delete, not to collapse, so reusing it would change behaviour.
- A shared `FieldPath` type for the dotted paths repeated as `string`: a judgement call, left to the
  tasks that first consume the paths (06, 08).

**Validation:**

| Phase | Result |
| --- | --- |
| 0–3 install, lint, typecheck, format | green |
| 4 tests | 395/395 (shared 251, api 39, client 105) |
| 5 build | green; the known Vite chunk-size advisory |
| 6 security and configuration | all pass; 6.1 bite test throws as intended |
| 7 golden set and score | `ALL IDENTITIES AND CHECKSUMS PASS`; `SCALAR FIELDS 281/284 98.9%` |
| 8 hosted integration | 3/3 against `hxksulbgluvfxfoxrhse`; no orphan users |
| 9 journeys | 9.2–9.5 all pass at 375 and 1440 px, in both languages; the throwaway user was deleted |

The first typecheck in this pass failed on the new summary test (`it.each` widened the key to
`string`). Vitest does not typecheck, so a green focused run proved nothing about `tsc`.
