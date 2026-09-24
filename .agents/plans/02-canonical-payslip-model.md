# Feature: Task 02 — Canonical payslip domain model & shared contracts

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 02](../ROADMAP.md) · **PRD:** §6.2–6.6, §7.9, §10,
Appendix A · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:**
[`AGENTS.md`](../../AGENTS.md) (this project has no `CLAUDE.md`)

## Feature Description

Express the payslip domain **once**, in `shared/`, as zod schemas and derived TypeScript types:
the canonical payslip fields (25 nullable data scalars + three line-item tables), the server-owned
envelope (identity, status, `pageCount`, `currency`, warnings, timestamps), the Session, the
payslip status machine, the closed warning taxonomy, per-field extraction metadata, and every
request/response DTO in PRD §10. Bring the Croatian parsers (`money`, `quantity`, `datetime`) up
to what payslips actually print, measured against the recorded bake-off output. Add the guard test
that stops provider vocabulary leaking into `shared/`, and a round-trip test proving every
golden-set fixture parses against the canonical schema unchanged.

No endpoint, no table, no UI. Task 03 persists this model, Task 04 maps provider output into it,
Task 06 computes the warnings it names.

## User Story

As the developer building Tasks 03–12
I want one canonical, provider-independent payslip model with its DTOs and parsers in `shared/`
So that the API, the mapper, the warnings engine, the UI and the export all agree on field names,
decimal-string money and status semantics, and swapping the extraction engine never renames a field
(PRD §2 principle 4)

## Problem Statement

`shared/` is the Task 01 stub: health, money, quantity, datetime, upload codes, the error envelope,
failure reasons and the source-region DTOs. There is no payslip type, so
`ProviderExtractionResult.fields` is `Record<string, unknown>`. The parsers came from receipt-ocr
and have three measured defects for payslips:

1. `parseAmount("0,065")` returns `"0065"` (65). A 3-digit fraction is read as a thousands group.
   The golden set has `koeficijent` `0.065`, `0.135` and `1.000` (F01 prints `1,000`).
2. `parseAmount("1.234")` guesses 1234. The roadmap DoD requires it to **reject** what it cannot
   normalise.
3. There is no period parser. The period is printed in five different ways across the seven layouts,
   and the printed month names can be nominative or genitive.

## Solution Statement

- `shared/src/payslip.ts`: `canonicalPayslipFieldsSchema` (the fields the user may edit) and
  `payslipSchema` (fields + server envelope), split exactly like receipt-ocr's tier 1 / tier 2. So a
  PATCH body cannot carry `userId`, `status` or `currency`.
- `shared/src/session.ts`: Session schema, the four payslip statuses, the transition table, and
  failure reasons with their retryability.
- `shared/src/warnings.ts`: the nine PRD §7.9 codes and the `{code, field}` shape.
- `shared/src/api.ts`: every §10 DTO, requests `.strict()`, responses `.strip()`.
- Parsers:
  - `parseAmount` rejects the bare single-separator 3-digit group.
  - `parseQuantity` is documented as the parser for `sati`, `koeficijent` and `ukupnoSati`.
  - `parseIssueDate` becomes `parseDate`.
  - New `parsePeriod`, ported from `scripts/bakeoff/score.ts` `asPeriod`, extended with genitive
    month names, and made to reject rather than guess.
  - `parseIssueTime` and `ISO_TIME_PATTERN` are deleted. A payslip has no time.
- `api/src/providers/document-extraction/types.ts`: the placeholder `fields` becomes
  `CanonicalPayslipFields`, and the per-field metadata becomes the shared `FieldMetadata`.

## Feature Metadata

**Feature Type**: New Capability (domain model + contracts), with parser fixes
**Estimated Complexity**: Medium. Mostly declarative, but the parser changes and the period grammar
need care.
**Primary Systems Affected**: `shared/src/*`, `api/src/providers/document-extraction/types.ts`
**Dependencies**: none new (zod 4, big.js already in `shared/package.json`)

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `PRD.md` §6.4 (lines 305–378): the canonical schema and its rules. §6.5 (380–386): the seven
  critical fields. §6.6 (388–405): the state machine. §7.9 (520–537): the warning codes. §10
  (680–723): every endpoint and its body.
- `CONTEXT.md`: Croatian payroll terms. **`doprinosiIzPlace` ≠ `doprinosiNaPlacu`**,
  **`obustave` ≠ `osobniOdbitak`**, **`netoPlaca` ≠ `iznosZaIsplatu`**. Field doc comments must use
  these meanings.
- `.agents/fixtures/expected/README.md`: `null` vs `"0.00"` is deliberate. `unscorable` exists
  only on G01. Fixtures carry metadata keys that are not schema fields.
- `.agents/fixtures/expected/B01.json`: a complete fixture, and the shape the round-trip test reads.
- `shared/src/money.ts` (whole file, esp. `normalizeSeparators` lines ~138–165): the ambiguity
  branch to change.
- `shared/src/money.test.ts` (lines 14–60): the `it.each` table style. Lines 50–52 assert the
  ambiguity that now flips to `null`.
- `shared/src/quantity.ts` + `quantity.test.ts`: the 3-decimal-first parser, kept for hours and
  coefficients.
- `shared/src/datetime.ts` + `datetime.test.ts`: `parseIssueDate` (to rename), the 70-pivot
  `expandYear`, `isRealDate`. No `Date.parse` anywhere.
- `shared/src/api.ts` (whole file): the long `.strip()` vs `.strict()` rationale comment. **Keep it
  verbatim.** Existing `EXTRACTION_FAILURE_REASONS` (moves), source DTOs (stay).
- `shared/src/api.test.ts`: the "response DTOs tolerate a newer API" test to extend.
- `shared/src/index.ts`: the single export surface. Every new public name is listed here.
- `shared/tsconfig.test.json`: already grants `node` types to tests, with a comment naming the
  provider-independence guard. That is where the `fs` access comes from.
- `api/src/providers/document-extraction/types.ts`: the `fields` placeholder and
  `ExtractionFieldMetadata`, which nothing else imports (verified by grep).
- **Reference implementation (sibling prototype, read-only):**
  - `../receipt-ocr/shared/src/receipt.ts`: the tier-1/tier-2 split, the `optionalText` /
    `optionalAmount` helpers, `.strict()` on field objects. Mirror it.
  - `../receipt-ocr/shared/src/receipt.test.ts`: the schema tests and the `provider independence`
    guard (last `describe`). Mirror both.
  - `../receipt-ocr/shared/src/warnings.ts`: the taxonomy module shape. Mirror it.
  - `../receipt-ocr/shared/src/api.ts` lines 50–188: the detail/list/patch/confirm/export DTO
    derivations. Mirror them.
- `scripts/bakeoff/score.ts` lines 39–84: `MONTHS`, `asDate`, `asPeriod`, the logic `parsePeriod`
  is ported from.

**Verified facts (checked during planning):**

- Nothing outside tests imports any `shared` export today (grep over `api/src`, `client/src`,
  `scripts`). Renaming or deleting parser exports breaks only `shared` tests and `index.ts`.
- No file in `shared/src` currently matches the guard regex below, so the guard passes on day one.
- `scripts/bakeoff/` does not import `@payslip/shared`. `npm run score -- cu` cannot be affected
  by this task.
- Every fixture's three tables are arrays (never `null`). `brojRata` values include `"10/120"`, so
  **`brojRata` is text, not a decimal**.

### New Files to Create

- `shared/src/payslip.ts`: field schemas, envelope, `CRITICAL_FIELDS`, `FieldMetadata`
- `shared/src/payslip.test.ts`: schema tests, fixture round-trip, provider-independence guard
- `shared/src/session.ts`: Session, statuses, transitions, failure reasons
- `shared/src/session.test.ts`: status machine tests
- `shared/src/warnings.ts`: the nine codes + warning shape
- `shared/src/warnings.test.ts`: taxonomy is exactly PRD §7.9

### Relevant Documentation

- [Zod 4 API — objects, `.strict()` / `.strip()`, `.partial()`, `.pick()`, `.extend()`](https://zod.dev/api#objects)
  - Why: strictness survives `.partial()`, which is what makes the PATCH body reject `userId`.
- [Zod 4 ISO formats — `z.iso.date()`, `z.iso.datetime()`](https://zod.dev/api#iso-dates)
  - Why: `paymentDate` and timestamps. `z.iso.date()` rejects `2026-02-31`.
- [Zod 4 tuples and `.refine`](https://zod.dev/api#tuples)
  - Why: the merge request `payslipIds` / `order` pairs.
- PRD Appendix D, *Pravilnik* NN 68/2023: explains why the period prints in so many forms (IP1
  prescribes content, not layout).

### Patterns to Follow

**Schema helpers** (mirror `receipt-ocr/shared/src/receipt.ts` lines 9–13):

```ts
/** Money crosses this boundary already normalized; the raw locale form never reaches the model. */
const decimalSchema = z.string().regex(AMOUNT_PATTERN);
const optionalText = z.string().nullable().optional();
const optionalDecimal = decimalSchema.nullable().optional();
```

**Tier split** (receipt.ts lines 45–95): fields object `.strict()`, envelope via `.extend({...})`,
with the explanatory comment about the PATCH body being structurally incapable of accepting
`userId`. Keep that comment's substance. It is the reason the split exists.

**Enum + schema + type triple** (existing `shared/src/api.ts` lines 43–49):

```ts
export const PAYSLIP_STATUSES = ["processing", "review", "confirmed", "failed"] as const;
export const payslipStatusSchema = z.enum(PAYSLIP_STATUSES);
export type PayslipStatus = z.infer<typeof payslipStatusSchema>;
```

**DTO derivation** (receipt api.ts): detail = `payslipSchema.extend({...}).strip()`; PATCH =
`canonicalPayslipFieldsSchema.partial()` (never redeclared by hand); confirm =
`payslipSchema.pick({...}).strip()`; list items = `payslipSchema.strip()`.

**Tests:** `describe` / `it.each([...])("parses %j as %j", ...)` tables; comments cite the PRD
section or fixture that motivates a case. Imports carry `.js` (`./payslip.js`). No `number` ever
reaches `Big` (`Big.strict = true` throws).

**Parsers:** return `null`, never throw; never `Date.parse`; whitespace class
`/[\s  ]/g`; JSDoc explains *why*, citing evidence.

---

## DESIGN DECISIONS

Settled here: the product owner accepted these as recommendations on 2026-09-24. Do not reopen
them during execution.

**D1 — Hours and coefficients use `parseQuantity`, money uses `parseAmount`.**
- `sati`, `koeficijent` and `ukupnoSati` are read by `parseQuantity`, which takes a 3-digit
  fraction as a decimal: `"1,000"` → `"1.000"`, `"0,135"` → `"0.135"`.
- Every money field is read by `parseAmount`.
- The field-to-parser assignment is the Task 04 mapper's job. Here it is stated in each field's doc
  comment and proven by tests on the printed evidence.
- `quantity.ts` stays; its receipt/POS doc comment is rewritten for payslips.

**D2 — `parseAmount` rejects the ambiguous group.**
- A bare single separator followed by exactly three digits (`"1.234"`, `"1,234"`, `"12.345"`,
  `"123.456"`) returns `null`.
- Payslip money always prints cents (every recorded CU amount has `,dd`). The ambiguous shape is
  therefore more likely an OCR fault than a real value. A `null` becomes an `unparseable_amount`
  warning in Task 06 that the user can see, while a guessed value is invisible.
- Unambiguous grouping stays accepted: several groups (`"1.234.567"`), or both separators
  (`"1.234,56"`).

**D3 — Canonical fields ≠ persisted envelope; fixtures are tested on the fields.**
- `canonicalPayslipFieldsSchema` holds the 25 data scalars + 3 tables.
- `payslipSchema` adds the envelope: `id`, `sessionId`, `userId`, `status`, `pageCount`,
  `currency`, `warnings`, `createdAt`, `updatedAt`, `confirmedAt`, `deletedAt`. With `currency` this
  makes the roadmap's "26 scalars".
- **`currency` is envelope (`z.literal("EUR")`), not an editable field.** It is server-set and
  always EUR (locked decision #7), so PATCH cannot touch it.
- The round-trip test picks the canonical keys out of each fixture, parses them strictly and
  expects deep equality.
- It also **fails loudly** if a fixture holds a key that is neither canonical nor known fixture
  metadata. Otherwise picking would silently drop a field the schema lacks, the exact failure the
  fixtures README warns about.

**D4 — Period and date parsing, tested on recorded print forms.**
- **Test source:** literal strings copied from `.bakeoff/cu/*.json`. That directory is git-ignored,
  so the strings are pasted into the test with their sample ID. They contain no personal data.
  Values come from `result.contents[0].fields.period.valueString` and `paymentDate`, and from the
  page markdown where CU had already normalised the value. The full list is in step 3.
- **Month names:** nominative (`svibanj`) and genitive (`svibnja`) forms, case-insensitive.
  `studeni` has two genitives, `studenoga` and `studenog`.
- **Two-digit years:** keep `datetime.ts`'s pivot at 70. The bake-off `asDate` maps every 2-digit
  year to `20yy`. The two agree on every year below 70, and payslips are 2023+ (locked decision #7),
  so they never disagree on in-scope input. D01 prints `10.06.25`, which both read as 2025. The
  production mapper uses `shared`, and `asDate` is not ported.
- **Where it deliberately departs from `asPeriod`, rejecting rather than guessing:**
  - A date span whose two dates fall in **different** months returns `null`.
  - A **single** date returns `null`, because it could be a payment date or a period end. No
    recorded CU `period` value is a single date.
  - `asPeriod` took the first date in both cases.

**D5 — Four statuses, closed.**
- The statuses are `processing | review | confirmed | failed`, per PRD §6.6.
- Task 05 adds its tables-pending state when it exists. Adding it now would be speculative
  (AGENTS.md §2).
- Transitions:
  - `processing → review`
  - `processing → failed`
  - `review → confirmed`
  - `failed → processing` (retry)
- **`confirmed` has no outgoing transition.** PRD §10.6 says a PATCH never changes status; the
  diagram's back-arrow means "edits still allowed". Confirm is idempotent at the route.
- **Retryability is a function of the failure reason**: only `provider_unavailable` is retryable
  (PRD §7.4). `EXTRACTION_FAILURE_REASONS` moves from `api.ts` to `session.ts` to avoid an import
  cycle (`session ← payslip ← api`).

**D6 — Upload error codes are Task 03's.**
- `unsupported_media_type` vs PRD's `unsupported_file_type`, and the missing `session_full`, are
  **not touched**. `upload.ts` says a code is added together with its rule, and Task 03 owns the
  rules.

**D7 — Parser surface cleanup** (closes Task 01 open items 3 and 9):
- `parseIssueDate` becomes `parseDate`.
- `parseIssueTime` and `ISO_TIME_PATTERN` are deleted along with their tests. A payslip has no time
  and nothing uses them.
- `quantity.ts` stays (D1).
- Money exports and `sourceRegionsResponseSchema` stay; Task 08 uses the latter.

**D8 — Locale copy for statuses and warning codes is deferred.**
- PRD §7.13 wants a guard that every warning code and status has copy in `hr` and `en`.
- Copy is added by the task that first renders it: Task 07 for statuses, Task 09 for warnings. Each
  mirrors `client/src/i18n/uploadErrors.test.ts`.
- Writing copy now would create unused vocabulary, the same reasoning as `upload.ts`'s comment.
- Step 9 adds a line to each task's scope in the ROADMAP so this is not lost.

**D9 — Per-field metadata lives in `shared`, but is not in any DTO.**
- `fieldMetadataSchema {confidence: number [0,1] | null, source: "model" | "text" | "inferred"}` is
  the provider-neutral shape stored in `extraction_metadata`.
- The detail DTO exposes only the PRD §10.5 projections: `lowConfidenceFields`,
  `unreadableFields`, `editedFields`.
- The `ungroundable` signal is Task 06's (roadmap), so no field is added for it here.

---

## STEP-BY-STEP TASKS

Execute in order. Run each step's VALIDATE once. Don't re-run a check that already passed.

### 1. UPDATE `shared/src/money.ts` + `money.test.ts` — reject the ambiguous group (D2)

- **IMPLEMENT**: in `normalizeSeparators`, replace the branch
  `if (after.length === 3 && before.length >= 1 && before.length <= 3) return stripGrouping(...)`
  with `return null`, and rewrite its comment. The comment should say:
  - it rejects instead of guessing;
  - payslip money always prints cents, so this shape is more likely an OCR fault;
  - a `null` becomes a visible `unparseable_amount` warning, where a guess would be invisible.
  - Drop the kilogram remark.
- Update the `parseAmount` JSDoc if it mentions the guess.
- **Condition:** keep the condition *shape* `after.length === 3 && before.length >= 1 &&
  before.length <= 3`. `"1234.567"` (4 digits before the separator) still falls through to
  `splitAtDecimal` → `"1234.567"`. Only the ambiguous shape changes.
- **TESTS**: flip lines 50–52 (`"1.234"`, `"1,234"`) to `null` under a comment "Ambiguous: one
  separator, exactly three digits after it — rejected, not guessed (Task 02 DoD)". Add `"12.345"` →
  `null` and `"123.456"` → `null`.
- **TESTS**: add a DoD block `it.each` over `["1.234,56", "1234,56", "1 234,56", "1234.56"]`, each
  expected to give `"1234.56"` ("handles … identically").
- **TESTS**: add the real OCR misread `"1.219.08"` (G01 `netoPlaca` as recorded by CU) → `null`.
- **GOTCHA**: other existing cases may have relied on the guess, such as `"1.000"`. Update each one
  that fails to `null`, and name them in the history file.
- **VALIDATE**: `npx vitest run --project shared shared/src/money.test.ts`

### 2. UPDATE `shared/src/quantity.ts` + `quantity.test.ts` — the payslip hours/coefficient parser (D1)

- **IMPLEMENT**: code unchanged. Rewrite the JSDoc:
  - It is the parser for `sati`, `koeficijent` and `ukupnoSati`.
  - Coefficients print to three decimals: F01 `1,000`, A03 `0,135`, golden `0.065`.
  - That is why `parseAmount` (money, D2 rejects this shape) must not be used for them.
  - Every other shape follows the money rules.
- **TESTS**: add a payslip-evidence `it.each`:
  - three-decimal coefficients: `["1,000","1.000"]` (F01), `["0,135","0.135"]` (A03),
    `["0,065","0.065"]`
  - two-decimal coefficients: `["1,75","1.75"]`, `["6,25","6.25"]`
  - hours: `["15,5","15.5"]` (A02), `["212","212"]` (A01), `["128,00","128.00"]` (B01)
- Existing cases stay.
- **VALIDATE**: `npx vitest run --project shared shared/src/quantity.test.ts`

### 3. UPDATE `shared/src/datetime.ts` + `datetime.test.ts` — `parseDate`, `parsePeriod`, drop time (D4, D7)

- **REMOVE**: `ISO_TIME_PATTERN`, `TIME`, `parseIssueTime` and their tests.
- **RENAME**: `parseIssueDate` → `parseDate` (JSDoc: "a payslip date such as the payment date").
- **ADD**: `export const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;`
- **ADD**: month tables, nominative and genitive, index = month − 1:
  - nominative: `siječanj veljača ožujak travanj svibanj lipanj srpanj kolovoz rujan listopad
    studeni prosinac`
  - genitive: `siječnja veljače ožujka travnja svibnja lipnja srpnja kolovoza rujna listopada
    studenoga|studenog prosinca`
  - Build one alternation ordered **longest first** so `studenoga` wins over `studenog`, and so a
    genitive never loses to a shorter nominative prefix.
- **ADD**: `parsePeriod(raw: string | null | undefined): string | null`, normalising to `YYYY-MM`.
  - Input: lower-case the input and collapse whitespace (same whitespace class).
  - Rules are tried in this order, first match wins. Rules 2–4 are **unanchored** because CU
    returns surrounding label text; rules 1 and 5 are **anchored** (`^…$`), which is what keeps a
    single date such as `"30.6.2025."` from matching rule 5:
    1. `^\d{4}-\d{2}$`, validated by `PERIOD_PATTERN`.
    2. `godina\s*(\d{4})\.?,?\s*mjesec\s*(\d{1,2}|<month>)` (B, C, D layouts).
    3. `(<month>)\.?\s*(\d{4})` (A layout, genitive included).
    4. A span: two day-first dates separated by `do` or `-` / `–`, optionally prefixed by `od`.
       Parse both with `parseDate`. If both parse and share year-month, return it. **Otherwise
       `null` (D4).**
    5. `^(\d{1,2})[./](\d{4})\.?$` (ported from `asPeriod`).
  - Validate month 1–12 and a 4-digit year.
  - A string holding **only one** date returns `null` (D4).
- **PATTERN**: port the structure of `scripts/bakeoff/score.ts` `asPeriod` (lines 74–90). Do not
  import from `scripts/`.
- **GOTCHA**: rule 4's date regex must accept 2-digit years (`01.05.25`), because D01's full
  string reaches rule 2 first but a bare span must still work. Reuse `parseDate`, don't re-parse by
  hand.
- **TESTS** `parseDate`: keep the existing table, renamed. Add a block "printed on the golden set"
  (sample in a trailing comment):
  - `"09.06.2025"` A01 → `2025-06-09`
  - `"09.06.2025."` A04 → `2025-06-09`
  - `"10.07.2025"` B01 → `2025-07-10`
  - `"02.06.2025"` B02 → `2025-06-02`
  - `"01.07.2025."` C01 → `2025-07-01`
  - `"10.06.25"` D01 → `2025-06-10`
  - `"8.7.2025."` E01 → `2025-07-08`
  - `"6.06.2025"` F01 → `2025-06-06`
  - `"2025-07-10"` (CU-normalised) → same
- **TESTS** `parsePeriod`, printed on the golden set:
  - `"svibanj 2025."` A01/A02/A04 → `2025-05`
  - `"lipanj 2025."` A03 → `2025-06`
  - `"OBRAČUNSKA ISPRAVA ZA ISPLATU PLAĆE-NAKNADE ZA RAZDOBLJE: svibanj 2025."` A01 markdown →
    `2025-05`
  - `"GODINA 2025, MJESEC 6 DANI U MJESECU OD 9 DO 30"` B01 → `2025-06`
  - `"GODINA 2025, MJESEC 5 DANI U MJESECU OD 1 DO 31"` B02 → `2025-05`
  - `"GODINA 2025. MJESEC 6. DANI U MJESECU OD 01. DO 30."` C01 → `2025-06`
  - `"GODINA 2025, MJESEC SVIBANJ, DANI U MJESECU OD 01.05.25 DO 31.05.25"` D01 → `2025-05`
  - `"2025-06"` (CU-normalised B–E) → `2025-06`
  - `"1.05.2025 do 31.05.2025"` F01 → `2025-05`
  - `"01.06.2025-30.06.2025"` G01 naknade range → `2025-06`
- **TESTS** `parsePeriod`, other forms:
  - `it.each` over all 12 nominative and all 13 genitive forms with year 2025 → the right month
  - `"SVIBANJ 2025"` → `2025-05` (case)
  - `"05/2025"` → `2025-05`
- **TESTS** `parsePeriod`, rejects:
  - `"01.05.2025 do 30.06.2025"` (months differ)
  - `"30.6.2025."` (single date; E01 prints this near its period)
  - `"svibanj"` (no year)
  - `"2025-13"`
  - `"GODINA 2025, MJESEC 13"`
  - `"13/2025"`
  - `""`, `null`, `undefined`
- **GOTCHA**: E01's printed period is not isolated in the recorded markdown. CU returned
  `2025-06`, which the ISO case covers. Say so in a test comment rather than inventing a string.
- **VALIDATE**: `npx vitest run --project shared shared/src/datetime.test.ts`

### 4. CREATE `shared/src/warnings.ts` + `warnings.test.ts`

- **MIRROR**: `../receipt-ocr/shared/src/warnings.ts`.
- **IMPLEMENT**: `WARNING_CODES`, in PRD §7.9 order:
  - `missing_critical_field`
  - `unparseable_amount`
  - `unparseable_date`
  - `oib_checksum_failed`
  - `dohodak_mismatch`
  - `porezna_osnovica_mismatch`
  - `neto_mismatch`
  - `isplata_mismatch`
  - `pay_components_sum_mismatch`
- Plus `warningCodeSchema`, `WarningCode`, and `payslipWarningSchema = z.object({ code, field:
  z.string().nullable().optional() }).strict()` with `PayslipWarning`. `field` is a canonical dotted
  path (`netoPlaca`, `payComponents.2.iznos`).
- The module comment says:
  - codes only; the rules are Task 06's;
  - warnings never block confirmation or export (PRD §7.9);
  - the client owns the copy (D8).
- **TESTS**: exactly nine codes, equal to the PRD list; an unknown code is rejected; an unknown key
  is rejected.
- **VALIDATE**: `npx vitest run --project shared shared/src/warnings.test.ts`

### 5. CREATE `shared/src/session.ts` + `session.test.ts` (D5)

- **MOVE**: `EXTRACTION_FAILURE_REASONS`, `extractionFailureReasonSchema` and
  `ExtractionFailureReason` from `api.ts` to here. `api.ts` imports them.
- **IMPLEMENT**:
  - `PAYSLIP_STATUSES` / `payslipStatusSchema` / `PayslipStatus`.
  - `PAYSLIP_STATUS_TRANSITIONS: Readonly<Record<PayslipStatus, readonly PayslipStatus[]>>`,
    holding `processing: ["review","failed"]`, `review: ["confirmed"]`, `confirmed: []`,
    `failed: ["processing"]`.
  - `canTransition(from, to): boolean`.
  - `EDITABLE_PAYSLIP_STATUSES = ["review","confirmed"] as const` (PRD §7.7, §10.6).
  - `RETRYABLE_FAILURE_REASONS = ["provider_unavailable"] as const` and
    `isRetryableFailure(reason): boolean` (PRD §7.4).
  - `sessionSchema = z.object({ id: z.uuid(), userId: z.uuid(), createdAt: z.iso.datetime(),
    deletedAt: z.iso.datetime().nullable().optional() }).strict()` + `Session`.
- JSDoc:
  - a Session has **no status of its own**; its progress derives from its payslips (PRD §6.6);
  - the four statuses are closed and Task 05 extends them;
  - `confirmed` has no outgoing transition, because edits keep it confirmed and confirm is
    idempotent at the route.
- **TESTS**:
  - every allowed transition is true, and a table of disallowed ones is false (`confirmed→review`,
    `review→failed`, `failed→review`, `processing→confirmed`, self-transitions);
  - only `provider_unavailable` is retryable;
  - `sessionSchema` rejects a non-UUID id and an unknown key.
- **GOTCHA**: `api/src/providers/document-extraction/types.ts`'s `ExtractionError` takes
  `retryable` separately from `reason`. **Don't change it here.** Record in NOTES/history that
  Task 04 should derive it from `isRetryableFailure`.
- **VALIDATE**: `npx vitest run --project shared shared/src/session.test.ts`

### 6. CREATE `shared/src/payslip.ts` (D3, D9)

- **IMPORTS**: `z` from `"zod"`; `AMOUNT_PATTERN` from `"./money.js"`; `PERIOD_PATTERN` from
  `"./datetime.js"`; `payslipStatusSchema` from `"./session.js"`; `payslipWarningSchema` from
  `"./warnings.js"`.
- **Helpers**: `decimalSchema`, `optionalText`, `optionalDecimal` (see Patterns).
- **Table rows**, each `.strict()` and every property optional-nullable:
  - `payComponentSchema {naziv: text, sati: decimal, koeficijent: decimal, iznos: decimal}`
  - `obustavaSchema {naziv: text, vjerovnik: text, iznos: decimal, ostatakSalda: decimal,
    brojRata: text}` — `brojRata` is text: A01 prints `10/120`
  - `neoporeziviPrimitakSchema {naziv: text, iznos: decimal}`
  - Export each type.
- **`canonicalPayslipFieldsSchema`** (`.strict()`), in PRD §6.4 order, grouped with comments:
  - parties (English): `employerName`, `employerAddress`, `employerOib`, `employerIban`,
    `employeeName`, `employeeAddress`, `employeeOib`, `employeeIban` — all text. **No OIB/IBAN
    format regex**: C01 has a non-IBAN in its IBAN field, and a misread OIB must stay visible and
    editable. Task 06's checksum warning flags it.
  - period: `period: z.string().regex(PERIOD_PATTERN).nullable().optional()`, `paymentDate:
    z.iso.date().nullable().optional()`, `ukupnoSati: optionalDecimal`.
  - the reconciliation chain (Croatian): `brutoPlaca`, `doprinosiIzPlace`, `doprinosMioIStup`,
    `doprinosMioIiStup`, `dohodak`, `osobniOdbitak`, `poreznaOsnovica`, `porezNaDohodak`,
    `netoPlaca`, `neoporeziviPrimiciUkupno`, `obustaveUkupno`, `iznosZaIsplatu`.
  - employer side: `doprinosiNaPlacu`, `ukupanTrosakRada`.
  - tables: `payComponents`, `obustave`, `neoporeziviPrimici`, each
    `z.array(row).nullable().optional()`.
- **Doc comments** on the less obvious fields use CONTEXT.md meanings:
  - `doprinosiIzPlace` is employee-side, withheld;
  - `doprinosiNaPlacu` is employer-side, on top;
  - `iznosZaIsplatu` is the bank-statement figure, ≠ `netoPlaca`;
  - `poreznaOsnovica` floors at zero;
  - hours and coefficients are read by `parseQuantity`, money by `parseAmount` (D1);
  - `null` ≠ `"0.00"` (fixtures README).
- **`CanonicalPayslipFields`** type.
- **`CRITICAL_FIELDS`**: `["employerName","employeeName","employeeOib","period","brutoPlaca",
  "netoPlaca","iznosZaIsplatu"] as const satisfies readonly (keyof CanonicalPayslipFields)[]`
  (PRD §6.5).
- **`payslipSchema`** = `canonicalPayslipFieldsSchema.extend({...})`:
  - `id: z.uuid()`, `sessionId: z.uuid()`, `userId: z.uuid()`
  - `status: payslipStatusSchema`
  - `pageCount: z.number().int().min(1)`
  - `currency: z.literal("EUR")`
  - `warnings: z.array(payslipWarningSchema)`
  - `createdAt`, `updatedAt`: `z.iso.datetime()`
  - `confirmedAt`, `deletedAt`: `z.iso.datetime().nullable().optional()`
  - Also the `Payslip` type.
  - Carry receipt.ts's tier-2 comment: the split makes the PATCH body structurally incapable of
    carrying `userId` / `status` / `currency`. Do not flatten.
- **`FIELD_SOURCES = ["model","text","inferred"] as const`**, plus `fieldMetadataSchema =
  z.object({ confidence: z.number().min(0).max(1).nullable(), source: z.enum(FIELD_SOURCES)
  }).strict()` and `FieldMetadata`. JSDoc (D9): keyed by canonical dotted path; stored, never sent
  raw to the client.
- **GOTCHA**: `z.uuid()` in zod 4 enforces RFC variant bits. Test UUIDs must look like
  `11111111-1111-4111-8111-111111111111`.
- **VALIDATE**: `npm run typecheck`

### 7. CREATE `shared/src/payslip.test.ts`

- **MIRROR**: `../receipt-ocr/shared/src/receipt.test.ts` (envelope constant, all-null, all-absent,
  fully populated, rejections, provider-independence guard).
- **Schema tests**:
  - all 25 scalars `null` + tables `null` → accepted;
  - envelope only, status `processing` → accepted;
  - fully populated (B01's values) → accepted;
  - unknown status is rejected;
  - non-UUID `id` / `sessionId` / `userId` are rejected;
  - un-normalised money (`"1.234,56"`, `"100,50"`, `"€100.50"`, `"1e5"`) in `brutoPlaca` is
    rejected;
  - `period` is rejected for `"svibanj 2025."`, `"2025-13"` and `"2025-6"`;
  - `paymentDate` is rejected for `"09.06.2025"` and `"2025-02-31"`;
  - `currency` `"HRK"` is rejected;
  - unknown top-level key (`tenantId`) is rejected with `unrecognized_keys`;
  - unknown key inside a `payComponents` row (`confidence: 0.9`) is rejected;
  - `brojRata: "10/120"` is accepted;
  - `CRITICAL_FIELDS` has length 7 and every entry is a key of
    `canonicalPayslipFieldsSchema.shape`.
- **Fixture round trip** (D3). Read `new URL("../../.agents/fixtures/expected/", import.meta.url)`
  with `readdirSync`, filtered to `*.json`.
  - `FIXTURE_METADATA_KEYS = ["sample","sourceFile","layoutFamily","layoutName","sourceKind",
    "pageCount","currency","notes","unscorable"]`
  - canonical keys = `Object.keys(canonicalPayslipFieldsSchema.shape)`
  - `expect(files).toHaveLength(11)`: an empty glob must fail, not pass vacuously.
  - `it.each(files)`, per fixture:
    - (a) every key is canonical or metadata; list the offenders;
    - (b) every canonical key is present;
    - (c) `canonicalPayslipFieldsSchema.parse(picked)` `toEqual(picked)`, the "unchanged" check;
    - (d) `currency === "EUR"` and `pageCount` is a positive integer.
- **Provider-independence guard**: `describe("provider independence")`. The forbidden regex
  extends receipt's with Content Understanding vocabulary:
  `/azure|prebuilt|documentintelligence|contentunderstanding|content understanding|analyzeresult|analyzer|boundingregion|polygon|valuestring|valuearray|valueobject/i`.
  - Scan every `*.ts` in `shared/src`, excluding `payslip.test.ts` itself (it names the
    vocabulary).
  - Comment: PRD §6.2; the canonical model is where a provider name would do lasting damage.
- **GOTCHA**: if the guard trips on a *comment* written in steps 1–6 (for example "CU returned…"),
  reword the comment to "the provider". Never widen the exclusion list.
- **VALIDATE**: `npx vitest run --project shared shared/src/payslip.test.ts`

### 8. UPDATE `shared/src/api.ts` + `api.test.ts` — every PRD §10 DTO

- **KEEP**: the whole leading `.strip()` / `.strict()` comment, `apiErrorResponseSchema`,
  `sourceDocumentResponseSchema`, `sourceRegionSchema`, `sourceRegionsResponseSchema`, unchanged.
- **UPDATE**: the comment's phrase "the `PATCH` body derives from the strict canonical field
  schema" becomes a reference to `updatePayslipRequestSchema`.
- **REMOVE**: the failure-reason block (moved to `session.ts`) and import it.
- **ADD**, each with a `/** PRD §10.x — METHOD path */` header:
  - 10.2 `createSessionResponseSchema = sessionSchema.pick({id, createdAt}).strip()`
  - 10.3 `createPayslipResponseSchema = payslipSchema.pick({id, sessionId, status,
    createdAt}).strip()`. The request is multipart and has no zod schema; say so.
  - 10.4 `payslipSummarySchema = z.object({ id: z.uuid(), status, period:
    nullable PERIOD string, employeeName: z.string().nullable(), pageCount: int min 1,
    failureReason: extractionFailureReasonSchema.nullable(), warningCount: z.number().int().min(0)
    }).strip()`, and `sessionDetailResponseSchema = z.object({ id, createdAt, payslips:
    z.array(payslipSummarySchema) }).strip()`.
  - 10.5 `payslipDetailResponseSchema = payslipSchema.extend({ lowConfidenceFields:
    z.array(z.string()), unreadableFields: z.array(z.string()), editedFields: z.array(z.string()),
    failureReason: extractionFailureReasonSchema.nullable().optional() }).strip()`. Carry
    receipt's `editedFields` comment: scalar paths only, since row indices shift.
  - 10.6 `updatePayslipRequestSchema = canonicalPayslipFieldsSchema.partial()`, with the "never
    redeclare by hand" comment.
  - 10.7 `confirmPayslipResponseSchema = payslipSchema.pick({id, status, confirmedAt}).strip()`
  - 10.8 `retryPayslipResponseSchema = payslipSchema.pick({id, status}).strip()`
  - 10.11 `mergePayslipsRequestSchema = z.object({ payslipIds: z.tuple([z.uuid(), z.uuid()]),
    order: z.tuple([z.uuid(), z.uuid()]) }).strict()`, with a `.refine` that the two ids differ
    and `order` is a permutation of `payslipIds`. `mergePayslipsResponseSchema` = pick
    `{id, status}` `.strip()`.
  - 10.12 `listPayslipsQuerySchema`, mirroring receipt: coerced `page` ≥1 default 1, `limit` 1–100
    default 20, optional `status`, `.strict()`. Also `listPayslipsResponseSchema { items:
    z.array(payslipSchema.strip()), page, limit, total }.strip()`.
  - 10.14/10.15 `EXPORT_FORMATS = ["csv","json"] as const`, `exportFormatSchema`,
    `ExportFormat`, `EXPORT_SCHEMA_VERSION = 1`, `exportedPayslipSchema =
    payslipSchema.omit({userId, deletedAt})`, and `jsonExportResponseSchema { schemaVersion:
    z.literal(EXPORT_SCHEMA_VERSION), payslips: z.array(exportedPayslipSchema) }.strict()`.
    It stays strict because it is a file written by us, not a response a stale tab parses; carry
    receipt's comment if it has one.
  - 10.13 DELETE → 204, no body; 10.9/10.10 exist already. No schema.
  - Export every `type X = z.infer<...>`.
- **TESTS** (`api.test.ts`):
  - Extend the "tolerate a newer API" `it.each` with `createSessionResponseSchema`,
    `createPayslipResponseSchema`, `sessionDetailResponseSchema`, `payslipDetailResponseSchema`,
    `confirmPayslipResponseSchema`, `retryPayslipResponseSchema`,
    `mergePayslipsResponseSchema` and `listPayslipsResponseSchema`, using valid sample bodies.
  - `updatePayslipRequestSchema`:
    - rejects `userId`, `status`, `currency`, `id` and `sessionId` (strict survives `.partial()`);
    - accepts `{}` and `{ netoPlaca: "2298.97" }`;
    - rejects `{ netoPlaca: "2.298,97" }`.
  - `mergePayslipsRequestSchema`: accepts a pair and its swap; rejects identical ids, an `order`
    not matching the ids, three ids, and an extra key.
  - `listPayslipsQuerySchema` coerces `"2"` → 2 and rejects `limit=101`.
- **GOTCHA**: `.pick` / `.omit` on a schema built by `.extend` over a `.strict()` object keeps the
  strict mode. Hence the explicit `.strip()` on every response. `.partial()` also keeps strict,
  which is the point of 10.6.
- **VALIDATE**: `npx vitest run --project shared shared/src/api.test.ts`

### 9. UPDATE `shared/src/index.ts`

- **IMPLEMENT**: export every new public name from `payslip.js`, `session.js`, `warnings.js` and
  `api.js`. In `datetime.js`, replace `ISO_TIME_PATTERN`, `parseIssueDate` and `parseIssueTime`
  with `ISO_DATE_PATTERN`, `PERIOD_PATTERN`, `parseDate` and `parsePeriod`. The failure-reason
  exports now come from `session.js`.
- Keep the existing grouping style: one `export {...} from` per module, `type` inline.
- **VALIDATE**: `npm run typecheck`

### 10. UPDATE `api/src/providers/document-extraction/types.ts`

- **IMPLEMENT**:
  - Import `CanonicalPayslipFields` and `FieldMetadata` as types from `@payslip/shared`.
  - `ProviderExtractionResult.fields: CanonicalPayslipFields` (the placeholder comment goes).
  - Delete the `ExtractionFieldMetadata` interface. `ExtractionMetadata.fields` becomes
    `Record<string, FieldMetadata>`, with a comment "keyed by canonical dotted path".
  - Everything else is unchanged, including `ExtractionError`'s signature (see step 5 GOTCHA).
- **VALIDATE**: `npm run typecheck && npm run lint`

### 11. RUN the gates once each

- `npm run validate` (typecheck → lint → format:check → all three Vitest projects)
- `npm run build` (the client bundle consumes `shared` dist; CI runs this)
- DoD greps: see Level 4 below.
- **Not run, with the reason recorded in the history file:**
  - `npm run score -- cu` and `check:golden`: no fixture changed, and the bake-off does not
    import `shared`.
  - `test:integration`: no API or database behaviour changed.
  - The browser: no UI changed.

### 12. CREATE `.agents/history/02-canonical-payslip-model.md` and UPDATE `.agents/ROADMAP.md`

- History file, in the shape of `history/01-fork-rename-strip.md`:
  - what was built;
  - D1–D9 as carried;
  - every existing test case whose expectation flipped (step 1 GOTCHA);
  - deviations;
  - validation table;
  - open items for later tasks, from NOTES.
- ROADMAP §2: Task 02 → `✅ complete → [history/02](./history/02-canonical-payslip-model.md)`.
  Tick Task 02's DoD boxes.
- ROADMAP Task 07 scope: add "hr/en copy for every `PAYSLIP_STATUSES` value, guarded by a test
  mirroring `uploadErrors.test.ts` (Task 02 D8)".
- ROADMAP Task 09 scope: the same for `WARNING_CODES`.
- ROADMAP Task 04 scope: add "`ExtractionError.retryable` derives from `isRetryableFailure`" and
  "hours/coefficients via `parseQuantity`, money via `parseAmount`, period via `parsePeriod`, dates
  via `parseDate`; `brojRata` stays text".
- Task 01 history open items 3 and 9: append "Resolved by Task 02" lines, and don't rewrite the
  originals.

---

## TESTING STRATEGY

All unit tests are in the `shared` Vitest project (node). There are no integration tests: nothing
here touches the database, the network or the API runtime.

### Unit Tests

- Parsers: `it.each` tables where each case comes from printed evidence and names its sample.
- Schemas: accept/reject tables mirroring receipt.test.ts.
- Contract tests:
  - strict requests reject server-owned keys;
  - responses tolerate and strip unknown keys;
  - the guard test.
- Fixture round trip: the only test reading repo files outside `shared/`. It must fail on zero
  files, on an unknown fixture key, and on a missing canonical key.

### Edge Cases

- `null` vs `"0.00"` survive the round trip unchanged (A03 obustave `"0.00"`, F01 `null`).
- `poreznaOsnovica: "0.00"` with an equal `osobniOdbitak` (B01) is schema-valid. The schema does no
  arithmetic.
- An empty table `[]` vs `null`: both are accepted and distinct.
- Negative amounts (`"-12.50"`) are accepted by the schema (`AMOUNT_PATTERN` allows a sign), for
  correction rows.
- `"1234.567"` still parses (4 digits before the separator, so not ambiguous).
- The genitive `studenog` / `studenoga` both → 11.
- `parsePeriod` on D01's full line resolves through the `godina/mjesec` rule, not the span rule.
- A merge request with its ids swapped in `order` is valid; identical ids are not.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

### Level 2: Unit Tests

- `npx vitest run --project shared` while iterating
- `npm run test` (all projects), as part of `npm run validate`

### Level 3: Build

- `npm run build`

### Level 4: DoD greps (each must print nothing)

- `grep -rnE "parseIssueDate|parseIssueTime|ISO_TIME_PATTERN" shared/src api/src client/src`
- `grep -rniE "azure|contentunderstanding|valuestring|analyzer" shared/src --include=*.ts | grep -v payslip.test.ts`
- `grep -rn "Record<string, unknown>" api/src/providers/document-extraction/types.ts`

### Level 5: Manual validation

None. There is no UI or runtime behaviour, and no ROADMAP §4 manual step belongs to Task 02.

---

## ACCEPTANCE CRITERIA

Roadmap DoD:

- [ ] A test fails the build if any Azure or Content Understanding identifier appears in `shared/`.
- [ ] Round-trip tests: every one of the 11 golden-set fixtures parses against the canonical schema
      unchanged, and the test fails on an unknown or missing key.
- [ ] `parseAmount` handles `1.234,56`, `1234,56`, `1 234,56` and `1234.56` identically, and
      rejects values it cannot normalise (`1.234`, `1.219.08`) rather than guessing.
- [ ] Croatian period and date parsing covers all seven layouts' printed forms, tested against the
      strings recorded from the golden set, including genitive month names.

Plus:

- [ ] Nine warning codes exactly; four statuses with the D5 transitions; retryability derived from
      the reason.
- [ ] Every PRD §10 body has a DTO. Requests are strict; responses strip and tolerate unknown keys.
- [ ] `ProviderExtractionResult.fields` is `CanonicalPayslipFields`.
- [ ] `npm run validate` and `npm run build` are green.
- [ ] History file written; ROADMAP §2 and the Task 04/07/09 scope notes updated.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–12 completed in order, each VALIDATE run once
- [ ] Every test expectation that flipped in step 1 is named in the history file
- [ ] No provider vocabulary in `shared/src` outside the guard test
- [ ] No hand-redeclared DTO shape: all are derived via `.pick`, `.omit`, `.extend` or `.partial`
- [ ] AGENTS.md §3: no change outside `shared/src`, the one `api` types file, the plan, the
      history file and the ROADMAP

---

## NOTES

- **Not in this task:** computing warnings or OIB checksums (06), migrations and repositories (03),
  the mapper and field-to-parser wiring (04), the regions endpoint (08), locale copy (07/09, D8),
  and upload code reconciliation (03, D6).
- **Known stale spots left alone** (AGENTS.md §3, mention don't fix):
  - `sourceRegionsResponseSchema` is a `.strict()` response, which contradicts the file's own
    rule. It is owned by Task 08, which rebuilds the regions contract.
  - `client/src/history/download.ts` still types `"csv" | "json"` inline; Task 12 switches it to
    the new `ExportFormat`.
  - Table-row objects are `.strict()` inside `.strip()` responses, so a newly added row column
    would still break a stale tab. receipt-ocr accepted the same trade-off. Record it for Task 09.
- **Risk:** D2 can turn a real `1.200` (a bare four-digit amount with a grouping dot and no cents)
  into `null`. No recorded payslip amount prints that way. If Task 04 scoring shows a regression,
  the fix is in the field schema's description ("always include decimals"), not a parser special
  case (the no-invented-heuristics rule).
- **Risk:** the period grammar is the one place Croatian knowledge enters code rather than the
  field schema (ROADMAP §5, "hand-written rule creep"). It is a port of already-measured logic plus
  genitive forms, and it rejects rather than guesses. If Task 04 needs a new form, prefer asking the
  analyzer for `YYYY-MM` in the field description over adding a regex.

**Confidence: 8/10** for one-pass success. The main unknowns:
- which existing `money.test.ts` cases flip under D2;
- whether a new doc comment trips the guard regex. Both are caught by the step's VALIDATE.
