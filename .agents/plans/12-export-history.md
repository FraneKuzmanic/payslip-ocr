# Feature: Task 12 — Export & history

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §1](../ROADMAP.md) (locked decisions 1, 2, 7, 8, 14), §3 Task 12,
§3 Task 05 DoD ("every export carries `tablesStatus`") · **PRD:** §4.1, §4.4, §4.6 (no session-wide
bulk actions), §6.4, §7.10, §7.11, §10.12–10.15, §11.1 step 4–5, §11.2 (exports round-trip) ·
**Previous tasks:** [`history/11`](../history/11-merge-payslips.md) (the session `⋮` menu, unsaved-edit
clearing after a merge), [`history/10`](../history/10-session-navigation-phone-layout.md) (the
`?payslip=` selection, `useWideLayout`, `UnsavedEditsProvider`), [`history/09`](../history/09-review-form-two-way-linking.md)
(confirm stays confirmed through a later edit), [`history/03`](../history/03-session-payslip-persistence-upload.md)
(list, soft delete, 404-never-403) · **Reference implementation:** `../receipt-ocr` (the sibling
prototype this was forked from) — `api/src/export/receipts.ts`, `client/src/routes/HistoryPage.tsx`,
`client/src/history/*` · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:**
[`AGENTS.md`](../../AGENTS.md) (no `CLAUDE.md`).

## Feature Description

Confirmed payslips leave the application, and past work can be found again:

- **JSON export** (`schemaVersion: 1`): full fidelity, including all three line-item tables,
  `tablesStatus` and warnings. It uses the export schema Task 02 already defined in
  `shared/src/api.ts:254-279`.
- **CSV export**: one row per payslip, no line-item tables. It is written in the **Croatian Excel
  dialect**: `;` separator, decimal comma, UTF-8 BOM, CRLF, and formula neutralisation on text
  columns.
- **Two scopes**: one payslip (`GET /api/payslips/:id/export`, `409 export_not_allowed` unless
  confirmed) and all confirmed (`GET /api/payslips/export`).
- **History** (`/history`): a flat, paginated list of the user's payslips with a status filter.
  Phones get cards and `lg` gets a table. Each row links into its session's review with
  `?payslip=`. Each row has a menu with CSV/JSON download (confirmed only) and soft delete. An
  "Export all confirmed" menu offers both formats.
- **Session page**: the selected payslip's `⋮` menu also offers CSV/JSON download once the payslip
  is confirmed. This is PRD §11.1 step 4, "confirms all four, and downloads a JSON export".
- A **History** destination in the primary navigation (sidebar and bottom bar).

## User Story

As someone who has reviewed and confirmed their payslips
I want to download them as JSON or as a CSV that opens correctly in Croatian Excel, and to find
yesterday's payslips again
So that the corrected data leaves the app intact and past work is not lost (PRD §7.10, §7.11,
§11.1 steps 4–5).

## Problem Statement

- Nothing exports today. The pieces that exist:
  - `EXPORT_FORMATS`, `exportFormatSchema`, `EXPORT_SCHEMA_VERSION = 1`, `exportedPayslipSchema`
    (payslip minus `userId`, `deletedAt`) and `jsonExportResponseSchema` (strict) in
    `shared/src/api.ts:254-279`;
  - `client/src/history/download.ts` (`exportFilename`, `saveBlob`) with its test;
  - `GET /api/payslips` (list, with `page`/`limit`/`status`) and `DELETE /api/payslips/:id`
    (soft delete), both with hosted integration tests.
- There is no history screen. Once a user leaves a session, the only way back is its URL.
  `NAV_ITEMS` (`client/src/components/NavItems.tsx:9`) has only Capture.
- **List items carry no name before extraction.** `GET /api/payslips` items are
  `payslipSchema.strip()`, with no `originalFilename`. A processing or failed row would have no
  label.
- **Found in planning (2026-09-26):**
  - Excel on Windows splits a CSV by the **OS list separator**, which is `;` for hr-HR. The `sep=`
    hint line makes Excel ignore the UTF-8 BOM, so the BOM rule (PRD §7.11) and `sep=` cannot
    coexist. With dot decimals, a Croatian Excel can read hours such as `8.5` as a date.
  - **The product owner's own machine runs Excel 16 on en-US** (list separator `,`, decimal `.`),
    checked through Excel COM. Double-clicking the semicolon CSV there gives one column. This is
    expected under D1. The review session verifies the file with Excel's import API under hr-HR
    semantics (step 9.11).
  - `supabase/config.toml` has `max_rows = 1000`. An unpaged all-confirmed select would be
    **silently truncated** at 1,000 rows. receipt-ocr's `listConfirmedForExport` already pages.

## Solution Statement

- **Shared:** `payslipListItemSchema` (payslip + optional `originalFilename`) for §10.12 items.
  There are no new error codes: `export_not_allowed` reaches the client only as a generic export
  failure (D6).
- **API:**
  - `api/src/export/payslips.ts`: `toJsonExport`, `toCsv`, `CSV_COLUMNS`, ported from receipt-ocr
    with the D1 dialect;
  - `PayslipRepository.listConfirmedForExport()` (paged, D4) and `listPage` returning
    `originalFilename`;
  - two routes in `routes/payslips.ts`, with `/export` registered **before** `/:id`.
- **Round trip (D3):** a $0 unit test takes the 11 golden fixtures through the JSON export, then
  re-parses them and scores them with `scoreSet`. It proves deep equality and 100%.
- **Client:**
  - `HistoryPage` with `PayslipCards`, `PayslipTable`, `PayslipActions` and a `historyRow.ts`
    helper;
  - `exportPayslips`, `exportPayslip`, `getPayslips` and `deletePayslip` in `api/client.ts`;
  - a `/history` route and a nav item;
  - export items in `SessionPage`'s `⋮` menu;
  - hr/en copy.
- **Docs:** PRD §7.11, §10.12, §10.14; the ROADMAP Task 12 D-list and §2; `validate.md` (Phase 4
  rows, check 6.26, journey 9.11, the Phase 10 row removed).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium. No migration, no new dependency, no paid call. Most of the
code is a port of receipt-ocr's working export and history screen.
**Primary Systems Affected**:
- `shared/src/{api,index}.ts`;
- `api/src/{export/payslips.ts, repositories/payslips.ts, routes/payslips.ts}`;
- `client/src/{routes/HistoryPage.tsx, history/*, api/client.ts, App.tsx, components/NavItems.tsx, routes/SessionPage.tsx, i18n/locales/*}`;
- docs.
**Dependencies**: none new. No lockfile change is expected; if the lockfile changes, stop and
explain why.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-26 in the planning session. Do not reopen them without
new evidence.

### D1 — CSV dialect: Croatian Excel (product owner)

- The separator is **`;`**. Numeric columns use a **decimal comma**: the `.` in the canonical
  decimal string becomes `,` (`"2298.97"` → `2298,97`, `"-12.50"` → `-12,50`, `"176.000"` →
  `176,000`). There is no thousands grouping, and the digits and scale stay unchanged.
- **UTF-8 BOM** (`﻿`) first, **CRLF** between rows, and **no trailing line break**, as in
  receipt-ocr. There is **no `sep=` line**: it makes Excel ignore the BOM (see Relevant
  Documentation).
- The header row is the **canonical identifiers** (locked decision 14). It never changes with
  the UI language.
- Quoting: a field containing `;`, `"`, `\r` or `\n` is wrapped in `"…"` with `"` doubled.
  Commas no longer force quoting.
- Dates stay ISO: `period` `2025-06`, `paymentDate` `2025-07-10`, timestamps ISO 8601 UTC. Excel
  may display `period` as a month date. That is acceptable and documented.
- **JSON is unchanged**: canonical decimal strings with a `.` separator. JSON is the machine
  format, and the CSV is for Excel (PRD §7.11's rationale).
- Accepted consequence: in an en-US Excel (as on the product owner's machine), double-click opens
  each row in one column. Data → From Text/CSV, or Excel with hr-HR regional settings, reads it
  correctly.

### D2 — CSV columns (planner, product owner had no preference)

In this order:

1. `id`, `sessionId`, `status`, `tablesStatus`, `currency`, `pageCount`.
2. The 25 canonical scalars, in `canonicalPayslipFieldsSchema.shape` order.
3. `confirmedAt`, `createdAt`, `updatedAt`.

Column classes:

- `tablesStatus` is required by the Task 05 DoD. A confirmed payslip with `tablesStatus: failed`
  and empty tables must be distinguishable from one whose tables are genuinely empty.
- **Text columns** (formula-neutralised): the eight party fields, `employerName` … `employeeIban`.
- **Decimal columns** (decimal comma): `ukupnoSati` and the 14 chain and employer-side amounts.
  Derive both lists from the schema **once**, as module constants, and test that every scalar is in
  exactly one class: text, decimal, or ISO (`period`, `paymentDate`).
- Structure columns (`id`, `sessionId`, `status`, `tablesStatus`, `currency`, `pageCount`,
  timestamps) are server-generated and neither neutralised nor converted.
- **Warnings are not in the CSV.** The JSON carries them, because `exportedPayslipSchema` includes
  `warnings`.
- **OIBs are written raw (product owner).** Excel drops a leading zero from an all-digit cell
  (`01234567890` → `1234567890`). This is documented as a known Excel limitation. JSON is lossless,
  and Excel's import wizard can type the column as Text. No `="…"` formula trick is used.
- Formula neutralisation, ported unchanged: a text value starting with `= + - @ \t \r \n` or their
  full-width forms `＝ ＋ － ＠` is prefixed with `'`. Numeric columns are **never** neutralised,
  so negative amounts stay numbers.

### D3 — The round-trip DoD is a $0 unit test through `scoreSet` (product owner)

"A JSON export re-imported into the scoring harness reproduces the same values" is met in
`api/src/export/payslips.test.ts`:

1. For each of the 11 golden fixtures, build a `Payslip` from the fixture's canonical fields and a
   fixed envelope (`status: "confirmed"`, `tablesStatus: "ready"`, fixed ids and timestamps).
2. `toJsonExport` → `JSON.stringify` → `JSON.parse` → `jsonExportResponseSchema.parse`.
3. Assert that each exported payslip's canonical fields **deep-equal** the input's.
4. Assert that `scoreSet` over `{ sample, expected: <fixture JSON>, actual: <re-imported fields> }`
   reports `scalars.hit === scalars.total`, `critical.hit === critical.total`, and every table's
   `cells.hit === cells.total`.

There is no harness CLI mode and no paid run. A CSV round trip is **not** claimed: the CSV omits
the tables by design.

### D4 — All-confirmed export: the whole account, paged (planner)

- The scope is every confirmed, non-deleted payslip of the user, across sessions (PRD §10.14).
  Session-wide bulk actions are out of scope (PRD §4.6).
- `listConfirmedForExport()` pages with `.range()` in chunks of `EXPORT_PAGE_SIZE = 500`, until a
  short page arrives. This is receipt-ocr's loop, and it defeats `max_rows = 1000`'s silent
  truncation. Order: `created_at` ascending, then `id` ascending, so a file lists payslips in the
  order they were uploaded and is stable between runs.
- The single-payslip export reads through the existing `findDetailState(id)` and uses
  `state.payslip`. No new query is needed.

### D5 — Where export is offered (product owner)

- **History:**
  - a labelled "Export" `ActionMenu` (variant `labelled`, icon `Download`) in the toolbar, with
    "All confirmed as CSV" and "All confirmed as JSON";
  - per row, CSV and JSON items only when the row is `confirmed`, plus Delete. This is receipt-ocr's
    `ReceiptActions` shape.
- **Session page:** the panel's existing `⋮` menu (`SessionPage.tsx:315-329`) shows when
  `canMerge(...)` **or** the selected payslip is `confirmed`. Its items are Merge (only when
  `canMerge`), then "Download CSV" and "Download JSON" (only when confirmed).
- An export while the form holds unsaved edits exports the **saved** payslip. A confirmed payslip
  stays confirmed through a later save (history/09), so the export is always the latest save. There
  is no extra guard; the unsaved mark on the chip is already visible.
- The UI only offers export on confirmed payslips, but the API is the guard (`409`).

### D6 — Errors (standing rule: console detail, friendly translated copy)

- One translated message for any export failure (`history.errors.export`), shown as an
  `ErrorMessage`, with `console.error("[history] …", error)` for the detail. The same message is
  used on the session page, shown as an `ErrorMessage` under the panel heading.
- History load and delete failures: `history.errors.load` (with Retry) and `history.errors.delete`,
  as in receipt-ocr.
- No per-code copy: `export_not_allowed` only arises from a race (for example, deleted in another
  tab), and a code the UI never provokes needs no dedicated sentence.

### D7 — History rows (product owner)

- `GET /api/payslips` items gain **`originalFilename`** (PRD §10.12 updated). It is added to list
  items only, not to `payslipSchema` or the export.
- In `shared`: `payslipListItemSchema = payslipSchema.extend({ originalFilename: z.string().min(1).optional() }).strip()`.
  It is **optional** under the stale-bundle rule (`shared/src/api.ts:6-30`): the static client can
  deploy before the API, and a new bundle must parse the old list body. The label falls back to
  `history.untitled` when it is missing.
- **Row label**, the same rule the rail uses (`PayslipRail.tsx:118-125`):
  - title: `employeeName`, otherwise `originalFilename`, otherwise `history.untitled`;
  - secondary line: `employerName` when present;
  - period: `formatField("period", …)` in the UI language, otherwise `history.noPeriod`.
- **Amount: `iznosZaIsplatu`** (product owner), shown with `formatAmount(value, { locale, currency: "EUR" })`,
  otherwise `history.noAmount`.
- Also shown: the translated status (`payslipStatus.*`, reused), and the upload date
  (`createdAt`, `Intl.DateTimeFormat(language, { dateStyle: "medium" })`) so "yesterday's
  payslips" can be recognised.
- The table at `lg` has these columns: Period · Employee (a row-header link) · Employer · Iznos za
  isplatu (right-aligned, `tabular-nums`) · Status · Uploaded · actions. Use `table-fixed` with
  explicit widths and **no `overflow` on the container**, which would clip the row menu (the
  receipt-ocr comment).
- A row links to `/sessions/${sessionId}?payslip=${id}` for every status. The session page already
  handles processing and failed payslips (Task 10 D7).
- The filter is a `<select>` over `PAYSLIP_STATUSES` with an "All" option. Pagination uses the API
  default `limit` (20), with Previous/Next and "Page X of Y". An empty page past the end steps
  back (receipt-ocr's `page > 1` rule).

### D8 — Soft delete from history

- A `ConfirmDialog` names the payslip by its row label. Confirm calls `DELETE /api/payslips/:id`,
  then re-reads the list.
- After a successful delete, **clear that payslip's unsaved edits**: `keep(id, null)`, mirroring
  how `SessionPage` clears merged originals (history/11 deviation 5). Otherwise the reload prompt
  would keep firing for a payslip that no longer exists. Read `UnsavedEditsProvider.tsx` and
  `SessionPage`'s `lastMerge` effect for the exact calls before writing this.
- A soft-deleted payslip disappears from its session too. No session-level change is needed.

### D9 — Filenames (planner)

- All confirmed: `payslips-YYYY-MM-DD.{csv,json}` (the existing `exportFilename`; delete its
  "Task 12 re-derives" comment).
- One payslip: `payslip-<period>-<first 8 of id>.{csv,json}`, or `payslip-<first 8 of id>.…` when
  the period is unread. **No names in filenames**, because filenames leak into download bars and
  sync folders, and names and OIBs are personal data.
- On the server, `Content-Disposition: attachment; filename="payslips.csv"` and
  `"payslip-<id>.csv"` for CSV. The client's `saveBlob` name wins in the browser.

### D10 — Navigation

- `NAV_ITEMS` gains `{ to: "/history", labelKey: "common.navHistory", Icon: History }`
  (lucide-react `History`). `BottomNav` and the sidebar render from the list, so both update.
- The route is `<Route path="history" element={<HistoryPage />} />` inside the same protected,
  unsaved-edits branch as `sessions/:sessionId` (`App.tsx:24-28`).

### D11 — Paid runs (standing rule, budget)

- **This implementing session: $0.**
  - Export and history tests are in-memory or use the hosted integration suite's no-op extraction
    runner.
  - Payslips are put into `review`/`confirmed` with `completeExtractionPass` and the confirm route,
    as Task 09's tests do.
- **The review session** (journey 9.11): at most **one** paid two-pass analysis, about **$0.05**.
  - Upload `A03.pdf` (native, one page, with diacritics in names), then confirm and export it.
  - Paging, filter and "previous day" rows are **seeded with the admin key** at $0, from golden
    fixtures' canonical data, with no source object.
  - Log the cost in history/12 and delete the throwaway data.

### D12 — Session split (standing rule)

This implementing session does **not** run `/code-review`, `/validate` or any browser journey, and
does not commit. It runs:

- `npm run validate` and `npm run build`;
- the targeted tests;
- the hosted integration suite (`npm run test:integration`, no paid calls);
- the local CSV probe in step 13.

It records all of them in `history/12-*.md`, then stops.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Reference implementation (receipt-ocr, sibling directory `../receipt-ocr`)**
- `api/src/export/receipts.ts` (whole, 103 lines) — Why: the module to port. It covers BOM, CRLF,
  column list, `TEXT_COLUMNS`, `FORMULA_STARTS`, `neutralizeFormula` and `escapeCsvField`. Change
  `,` → `;`, the quoting set, and add decimal-comma conversion (D1).
- `api/src/export/receipts.test.ts` — Why: its test cases, to adapt.
- `api/src/routes/receipts.ts` (lines 40-100) — Why: both export routes, the `/export` before `/:id`
  ordering, headers, and the `409 export_not_allowed` check.
- `api/src/repositories/receipts.ts` (lines 260-285) — Why: `listConfirmedForExport`'s paging loop
  and `EXPORT_PAGE_SIZE`.
- `client/src/routes/HistoryPage.tsx` (whole, 285 lines) and `HistoryPage.test.tsx` — Why: the page
  to port. It covers state, the effect with `active` guard, delete, bulk and per-row download, busy
  status, skeleton, empty state, pager and `ConfirmDialog`.
- `client/src/history/{ReceiptActions,ReceiptCards,ReceiptTable}.tsx` and `receiptSummary.ts` — Why:
  the row menu, card, table (`isInteractiveTarget` row click) and route helper to port.
- `client/src/history/download.ts` — Why: `receiptExportFilename` and `safeFilenamePart` (the D9
  shape, minus names).
- `client/src/api/client.ts` (lines 180-202) — Why: `exportReceipts`/`exportReceipt` return
  `response.blob()`.
- `client/src/i18n/locales/{en,hr}.json`, the `history` block — Why: the copy to adapt. "račun"
  becomes "platna lista", and "Seller" becomes "Employee".

**Shared**
- `shared/src/api.ts` (lines 6-30 stale-bundle rule, 94-113 `payslipSummarySchema` with
  `originalFilename`, 225-279 list and export schemas) — Why: `payslipListItemSchema` goes beside
  `listPayslipsResponseSchema`; the export schemas already exist and stay unchanged.
- `shared/src/payslip.ts` (lines 60-160) — Why: scalar order and kinds (text, `decimalSchema`,
  `period`, `paymentDate`) for D2's classes; the `payslipSchema` envelope.
- `shared/src/index.ts` — Why: every new export is listed here.
- `shared/src/api.test.ts` (around lines 100-120 and 202-210) — Why: the strip test and the list
  query tests to extend.
- `shared/src/money.ts` (lines 105-135) — Why: `formatAmount` takes the **string**.

**API**
- `api/src/routes/payslips.ts` (whole) — Why: the list route (37-54) is the pattern. The new
  `GET /export` goes **before** `GET /:id` (line 223); `GET /:id/export` can sit next to it.
- `api/src/repositories/payslips.ts` (lines 31-32 `PAYSLIP_COLUMNS`, 101-119 `ListPayslipsOptions`
  and `PayslipPage`, 165-189 `findDetailState`, 254-280 `listPage`, 433-470 `mapPayslipRow`) —
  Why: where the paged export read and the list's `originalFilename` go. Warnings are computed in
  `mapPayslipRow`, so exported warnings are current.
- `api/src/scoring/score.ts` (lines 22-35, 65-145) — Why: `scoreSet`, `ScoringInput`, `TABLES`,
  `SCALAR_FIELDS`, for D3.
- `api/src/validation/warnings.test.ts` (lines 1-25) — Why: how an api test loads golden fixtures
  (`FIXTURE_DIRECTORY`, the `fixture()` helper). Mirror it; do **not** import from `scripts/`.
- `api/src/middleware/error-handler.ts` — Why: `HttpError(status, code)`.
- `api/src/routes/payslips.integration.ts` (lines 1-80 setup and cleanup; 246-260 list test; 790-948
  editing and confirming, which shows how to reach `confirmed`; 1252 on, soft delete; helpers at the
  end) — Why: where the export and history integration cases go, and the `admin` client for the
  previous-day `created_at` update.

**Client**
- `client/src/App.tsx` (whole) — Why: the route branch for `/history`.
- `client/src/components/NavItems.tsx`, `BottomNav.tsx`, `AppLayout.tsx` + `AppLayout.test.tsx` —
  Why: the nav list and its tests. The bottom nav comment says "this app has two"
  destinations; it will now truly have two, so leave it.
- `client/src/components/ActionMenu.tsx` — Why: `items`, `busy`, `variant="labelled"`, `icon`;
  touch targets are 48 px since Task 11.
- `client/src/components/ConfirmDialog.tsx`, `ErrorMessage.tsx`, `Skeleton.tsx` — Why: reused as
  receipt-ocr did.
- `client/src/routes/SessionPage.tsx` (lines 28-39 `isSettled`/`canMerge`, 300-330 panel heading and
  menu; the `lastMerge` effect) — Why: D5 menu items and D8's unsaved-edits clearing pattern.
- `client/src/routes/SessionPage.test.tsx` (lines 1-60, and the merge menu tests) — Why: mock setup
  to extend with `exportPayslip`.
- `client/src/review/PayslipRail.tsx` (lines 118-125) — Why: the label rule D7 mirrors.
- `client/src/review/reviewForm.ts` (lines 90-115) — Why: `formatField("period", value, "hr"|"en")`.
- `client/src/review/unsaved/UnsavedEditsContext.ts`, `UnsavedEditsProvider.tsx`,
  `useUnsavedEdits.ts` — Why: `keep(id, null)` for D8.
- `client/src/history/download.ts` + `download.test.ts`, `useWideLayout.ts` — Why: existing helpers
  (`LG` default).
- `client/src/api/client.ts` (lines 1-118 `request`/`parseResponse`, 144-160 `getSessionDetail`) —
  Why: the call pattern; blobs skip `parseResponse`.
- `client/src/i18n/statusCopy.test.ts`, `i18n.test.ts` — Why: parity and key-scan guards that the
  new copy must pass.

### New Files to Create

- `api/src/export/payslips.ts` — `CSV_COLUMNS`, `toCsv`, `toJsonExport`.
- `api/src/export/payslips.test.ts` — CSV unit tests and the D3 round trip.
- `client/src/routes/HistoryPage.tsx` + `HistoryPage.test.tsx`.
- `client/src/history/PayslipActions.tsx`, `PayslipCards.tsx`, `PayslipTable.tsx`.
- `client/src/history/historyRow.ts` + `historyRow.test.ts` — the label, period, amount, route and
  filename helpers. Its stem differs from every component's stem (the Windows case-collision
  lesson, history/10 deviation 4).
- `.agents/history/12-export-history.md`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Chase Seibert — Creating international CSV files](https://chase-seibert.github.io/blog/2014/07/30/international-csv-files-python.html)
  — Why: D1. Writing both the BOM and `sep=` makes Windows Excel forget the BOM.
- [Ablebits — Converting CSV to Excel: common issues](https://www.ablebits.com/office-addins-blog/converting-csv-excel-issues/)
  — Why: D1. Excel splits by the Windows list separator, which is `;` in most European locales.
- [OWASP — CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) — Why: D2's
  leading-character set and the `'` prefix.
- [RFC 4180 §2](https://www.rfc-editor.org/rfc/rfc4180#section-2) — Why: the quoting rules, with
  `;` substituted as the separator.
- [Excel VBA `Workbooks.OpenText`](https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.opentext)
  — Why: step 13's local probe and journey 9.11 (`Origin: 65001`, `Semicolon`, `DecimalSeparator`).
- [MDN `Intl.DateTimeFormat` `dateStyle`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/DateTimeFormat/DateTimeFormat#datestyle)
  — Why: the upload date column.

### Patterns to Follow

**Export module** (receipt-ocr `export/receipts.ts`, adapted):
```ts
const UTF8_BOM = "﻿";
const CSV_LINE_BREAK = "\r\n";
const CSV_SEPARATOR = ";";
export function toCsv(payslips: Payslip[]): string {
  const rows = [
    CSV_COLUMNS.join(CSV_SEPARATOR),
    ...payslips.map((payslip) => CSV_COLUMNS.map((column) => escapeCsvField(csvValue(payslip, column))).join(CSV_SEPARATOR)),
  ];
  return `${UTF8_BOM}${rows.join(CSV_LINE_BREAK)}`;
}
// csvValue: text → neutralizeFormula(value); decimal → value.replace(".", ","); else raw; null/undefined → "".
// pageCount is a number: String(value).
function escapeCsvField(value: string): string {
  return /[;"\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
```
`toJsonExport` parses through `jsonExportResponseSchema` (strict), after deleting `userId` and
`deletedAt` from a copy, exactly as receipt-ocr does. A stray key is then a bug on our side and
throws.

**Route** (receipt-ocr `routes/receipts.ts:51-99`): `exportFormatSchema.safeParse(req.query["format"])`
→ `400 invalid_request`; CSV `res.setHeader("Content-Type", "text/csv; charset=utf-8")`,
`Content-Disposition`, `res.send(toCsv(...))`; JSON `res.json(toJsonExport(...))`. The single
route uses `idSchema` → `400`, then `findDetailState` → `404 not_found`, then
`status !== "confirmed"` → `409 export_not_allowed`. Call `failStaleExtractions` first, as the
other reads do (`routes/payslips.ts:46`).

**Repository paging** (receipt-ocr `repositories/receipts.ts:267-285`), with
`.select(PAYSLIP_COLUMNS)`, `.eq("user_id", this.#userId)`, `.is("deleted_at", null)`,
`.eq("status", "confirmed")`, the D4 order, `.range(from, from + EXPORT_PAGE_SIZE - 1)`, mapped with
`mapPayslipRow`.

**Client blob call**:
```ts
export async function exportPayslips(format: ExportFormat): Promise<Blob> {
  const response = await request(`/api/payslips/export?format=${format}`);
  return await response.blob();
}
```

**Copy**: every string is an `en` + `hr` key pair.
- hr words: "Povijest" (history), "Izvoz"/"Izvezi" (export), "Preuzmi CSV" / "Preuzmi JSON",
  "Sve potvrđene kao CSV", "Obriši" (delete), "platna lista" (never "isplatna lista"), "Iznos za
  isplatu".
- Read `hr.json`'s `session` and `merge` blocks first and reuse their words.

**Busy buttons**: `aria-disabled`, never `disabled`, for anything with a busy state (Task 07
DoD). The pager's Previous/Next may stay `disabled` at the ends, as in receipt-ocr: they are not
busy states.

**Touch targets**: every new control is **≥ 48 px** (`min-h-12`). receipt-ocr used `min-h-11`
(44 px): raise it when porting (Task 08 D12, PRD §11.5).

**Tests**: vitest and `@testing-library/react`. `vi.mock("../api/client")` with a local `ApiError`
class (see `SessionPage.test.tsx:10-21`). Stub `matchMedia` for the wide/narrow switch as
receipt-ocr's `stubViewport` does. `HTMLDialogElement.prototype.showModal`/`close` are stubbed
where `ConfirmDialog` opens.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation
The shared list item schema; the export module and its unit tests, including the D3 round trip.

### Phase 2: API
The repository reads (paged export, `originalFilename`), the two export routes, and the hosted
integration cases.

### Phase 3: Client
API calls, `historyRow` helpers, `PayslipActions`, `PayslipCards`, `PayslipTable`, `HistoryPage`,
route and nav, the session menu, copy.

### Phase 4: Probe, docs and validation
The local Excel-import probe, the docs, the full validation, and the history file.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

### 1. VERIFY the starting state

- `git status --short`: clean except this plan.
- `npm run validate`. Record the file and test counts (history/11 ended at 69 files / 1000 tests).
  If a test fails, rerun it alone and in two more full runs before blaming this task (history/11
  deviation 1).
- **VALIDATE**: `npm run validate`

### 2. ADD `payslipListItemSchema` to `shared/src/api.ts` (D7)

- **IMPLEMENT**: `export const payslipListItemSchema = payslipSchema.extend({ originalFilename: z.string().min(1).optional() }).strip();`
  plus a type `PayslipListItem`. `listPayslipsResponseSchema.items` becomes
  `z.array(payslipListItemSchema)`. Keep the existing comment about loosening the payslip itself,
  and add one line on why `originalFilename` is optional (a new bundle reading an older API).
- **UPDATE** `shared/src/index.ts`: export `payslipListItemSchema` and `type PayslipListItem`.
- **TEST** in `shared/src/api.test.ts`: a list body with `originalFilename` keeps it; one without
  it parses (older API); an empty string is rejected; an unknown item key is stripped.
- **VALIDATE**: `npx vitest run shared/src/api.test.ts`

### 3. CREATE `api/src/export/payslips.ts` (D1, D2)

- **IMPLEMENT**:
  - Column classes, derived from the schema once:
    - `SCALAR_COLUMNS` = `Object.keys(canonicalPayslipFieldsSchema.shape)` minus the three tables;
    - `TEXT_COLUMNS` = the eight party fields, listed explicitly;
    - `ISO_COLUMNS` = `period`, `paymentDate`;
    - `DECIMAL_COLUMNS` = every other scalar.
  - `CSV_COLUMNS` in D2's order, typed `as const satisfies readonly (keyof Payslip)[]`.
  - `toCsv(payslips: Payslip[])` and `toJsonExport(payslips: Payslip[]): JsonExportResponse`,
    following Patterns to Follow.
  - A module comment stating the dialect, **why** (Excel list separator, the BOM/`sep=` conflict),
    and the OIB leading-zero limitation.
- **IMPORTS**: `EXPORT_SCHEMA_VERSION`, `canonicalPayslipFieldsSchema`, `jsonExportResponseSchema`,
  `type Payslip`, `type JsonExportResponse` from `@payslip/shared`. Relative imports need `.js`.
- **GOTCHA**: `value.replace(".", ",")` replaces the first dot only, which is correct for a decimal
  string (`AMOUNT_PATTERN` allows one). Do not use a global replace on text.
- **GOTCHA**: never convert money to a `number`.
- **VALIDATE**: `npx tsc -p api/tsconfig.json --noEmit` (or `npm run typecheck`).

### 4. CREATE `api/src/export/payslips.test.ts` (D1–D3)

- **CSV cases**:
  - starts with the BOM; rows joined by `\r\n` with no trailing break;
  - the header equals `CSV_COLUMNS.join(";")`;
  - D2 order: `id;sessionId;status;tablesStatus;currency;pageCount;employerName…`;
  - every canonical scalar is in exactly one of text, decimal or ISO, and every scalar is a column;
  - `"2298.97"` → `2298,97`, `"-12.50"` → `-12,50`, `"176.000"` → `176,000`;
  - null and undefined → empty field;
  - `Ivić; d.o.o.` is quoted; `Say "hi"` → `"Say ""hi"""`; a comma alone is **not** quoted;
  - an embedded newline is quoted;
  - a text value `=SUM(A1)` → `'=SUM(A1)`, and likewise `+`, `-`, `@`, tab, and full-width `＝`;
  - a negative decimal is **not** prefixed;
  - `č ć ž š đ Č Ć Ž Š Đ` pass through unchanged;
  - `tablesStatus: "failed"` is written;
  - `pageCount` 2 → `2`;
  - `warnings` does not appear.
- **JSON cases**:
  - `schemaVersion: 1`;
  - no `userId` or `deletedAt`;
  - all three tables and `tablesStatus` present;
  - an extra key on the input throws (strict schema).
- **D3 round trip**: mirror `warnings.test.ts`'s fixture loader (`FIXTURE_DIRECTORY`, canonical keys
  only). For all 11 fixtures, assert deep equality and the full `scoreSet` tallies described in D3.
  Assert the fixture count is 11, so a removed fixture fails rather than shrinking the test.
- **VALIDATE**: `npx vitest run api/src/export`

### 5. UPDATE `api/src/repositories/payslips.ts` (D4, D7)

- **ADD** `const EXPORT_PAGE_SIZE = 500;` and `async listConfirmedForExport(): Promise<Payslip[]>`
  (the paging pattern, D4 order: `created_at` asc, then `id` asc).
- **UPDATE** `PayslipPage.items` to `PayslipListItem[]`. `listPage` maps
  `(row) => ({ ...mapPayslipRow(row), originalFilename: row.original_filename })`. The column is
  already in `PAYSLIP_COLUMNS`.
- **GOTCHA**: `original_filename` is `not null` in the migration. If the generated type says
  otherwise, check `database.types.ts` rather than adding a runtime check.
- **VALIDATE**: `npm run typecheck`

### 6. ADD the export routes to `api/src/routes/payslips.ts` (D4, D9)

- **ADD** `GET /export` **immediately after** `GET /` and **before** `GET /:id`, with a comment
  saying why (PRD §10 route-order note). Also add `GET /:id/export`.
- The single route: `idSchema` → `400`; `exportFormatSchema` → `400`; `failStaleExtractions`;
  `findDetailState` → `404`; not confirmed → `409 export_not_allowed`; then CSV or JSON.
- The `GET /` handler's body type is still `ListPayslipsResponse`, now with `originalFilename`.
- **VALIDATE**: `npx vitest run api/src/app.test.ts` and `npm run typecheck`.

### 7. ADD hosted integration cases to `api/src/routes/payslips.integration.ts`

New `describe("export and history (Task 12)")`, reusing the file's upload, pass-completion and
confirm helpers:

- An unconfirmed (`review`) payslip: `GET /:id/export?format=json` → `409 export_not_allowed`, and
  the same for CSV. A `processing` one → `409`.
- The same payslip after confirm:
  - JSON → `200`, `jsonExportResponseSchema.parse` succeeds, one payslip with the same id and
    `tablesStatus`;
  - CSV → `200`, `content-type` starts with `text/csv`, the body starts with `﻿`, has two
    CRLF-separated lines, and the header starts `id;sessionId;status;tablesStatus`.
- `GET /export?format=json` lists confirmed payslips only (a `review` sibling is absent), and never
  another user's (user B's confirmed payslip is absent from A's export). A soft-deleted confirmed
  payslip is absent.
- `?format=xml` → `400`; a malformed id → `400`; another user's id → `404` (never `403`); a
  soft-deleted id → `404`.
- **Route order**: `GET /export` must not be treated as `GET /:id`. Its `200` above proves it;
  add a comment saying so.
- **History**:
  - list items carry `originalFilename`;
  - after `admin.from("payslips").update({ created_at: <yesterday> })` on one payslip, it is still
    listed, after today's (newest first). This is the "previous day" DoD at the API level.
- Keep the `sourcePaths` cleanup discipline. No paid call: the runner is the file's no-op.
- **VALIDATE**: `npm run test:integration` (hosted, $0). Record the per-suite counts.

### 8. CLIENT: API calls (`client/src/api/client.ts` + test)

- **ADD**:
  - `getPayslips(query: { page: number; status?: PayslipStatus })` →
    `parseResponse(listPayslipsResponseSchema, …, "GET /api/payslips")`, building the query string
    with `URLSearchParams`;
  - `deletePayslip(id)` → `DELETE`, no body;
  - `exportPayslips(format)`, `exportPayslip(id, format)` → `Blob`.
- **TEST** in `client.test.ts`, mirroring its merge cases: the query string; a `204` delete
  resolves; export returns the blob; a `409 export_not_allowed` surfaces as an `ApiError` with that
  code.
- **VALIDATE**: `npx vitest run client/src/api`

### 9. CLIENT: `historyRow.ts`, `download.ts` (D7, D9)

- `historyRow.ts` exports:
  - `rowTitle(item, t)` (employee name, filename, untitled);
  - `rowPeriod(item, language)`;
  - `rowAmount(item, language)`, which uses `formatAmount` with `currency: "EUR"` and returns
    `null` when unread;
  - `rowRoute(item)` → `/sessions/${encodeURIComponent(sessionId)}?payslip=${encodeURIComponent(id)}`.
- `download.ts`: add `payslipExportFilename({ id, period }, format)` (D9). Remove the stale
  "Task 12 re-derives" comment and type `format` as `ExportFormat`.
- **TEST**: `historyRow.test.ts` covers each fallback in both languages, the amount in hr
  (`1.772,15 €`) and en, and the route. Extend `download.test.ts` with and without a period.
- **VALIDATE**: `npx vitest run client/src/history`

### 10. CLIENT: `PayslipActions`, `PayslipCards`, `PayslipTable`, `HistoryPage` (D5–D8)

- Port the receipt-ocr files one to one, renamed, with D7's fields and D5's items.
  - `PayslipActions` uses the menu id `history-actions-${id}`, distinct from the session page's
    `payslip-actions`.
  - The menu label is `history.actionsFor` with the row title.
- `HistoryPage`:
  - the `select` id is `history-status`;
  - statuses come from `PAYSLIP_STATUSES`, with copy from `payslipStatus.*`;
  - D8's `keep(id, null)` goes after a successful delete;
  - the empty state links to `/` (`history.emptyAction`);
  - everything is ≥ 48 px.
- **TEST** `HistoryPage.test.tsx`, ported from receipt-ocr's and adapted:
  - rows render title, period, amount and status;
  - table at wide, cards at narrow, never both;
  - the filter resets to page 1 and passes `status`;
  - the pager steps back from an empty page;
  - a confirmed row offers CSV/JSON, a `review` row only Delete;
  - per-row and bulk downloads call the API and `saveBlob` with the D9 filenames;
  - an export failure shows `history.errors.export` and logs;
  - delete confirms, calls `deletePayslip`, clears unsaved edits, and re-reads;
  - a load failure shows Retry;
  - a row without `originalFilename` or name shows the untitled copy;
  - a row click and the link both navigate to `/sessions/:sessionId?payslip=:id`.
- **VALIDATE**: `npx vitest run client/src/routes/HistoryPage.test.tsx client/src/history`

### 11. CLIENT: route, nav, session menu, copy (D5, D6, D10)

- `App.tsx`: the `history` route (D10). `NavItems.tsx`: the `History` item. Update
  `AppLayout.test.tsx` if it asserts the destination count or names.
- `SessionPage.tsx`:
  - the `⋮` menu renders when `canMerge(selected, payslips) || selected.status === "confirmed"`,
    with items per D5;
  - downloads go through `exportPayslip` + `saveBlob(payslipExportFilename(selected, format))`;
  - the menu's `busy` is set while downloading;
  - a failure shows `ErrorMessage` with `history.errors.export` under the heading and logs
    `[session]`;
  - the menu label stays `merge.actions` ("Payslip actions"), which already reads generically. Check
    both locales.
- `SessionPage.test.tsx`:
  - a confirmed payslip without a mergeable sibling shows the menu with CSV/JSON only;
  - a `review` payslip with a sibling shows Merge only;
  - a confirmed one with a sibling shows all three;
  - a download calls `exportPayslip` with the id and format;
  - a failure shows the error.
- Copy in `en.json`/`hr.json`:
  - `common.navHistory`;
  - a `history` block: title, count (plural forms, `_one`/`_few`/`_other` in hr as the `merge` block
    does), filter label/all, `export`, `exportAllCsv`/`exportAllJson`, `downloadCsv`/`downloadJson`,
    `delete`, `actionsFor`, the delete dialog strings, column headers, `untitled`, `noPeriod`,
    `noAmount`, empty title/body/action, previous/next/`pageOf`, `exportingStatus`/`deletingStatus`,
    `errors.load`/`errors.delete`/`errors.export`.
- **VALIDATE**: `npx vitest run client` (the i18n parity and key-scan guards included).

### 12. RUN lint, format and typecheck

- **VALIDATE**: `npm run validate`. Fix oxlint findings at their cause: for example, move helpers to
  module scope for `consistent-function-scoping`, and use `toSorted`.

### 13. LOCAL PROBE: the CSV in Excel under hr-HR semantics ($0)

A scratchpad script (not committed) does the following:

1. Builds a CSV with `toCsv` from the A01 and B02 fixtures, plus a row whose `employerName` is
   `=1+1` and whose `employeeName` is `Đurđa Čačić-Šimić; Žana`. Writes it to the scratchpad.
2. Opens the CSV through **Excel COM** (PowerShell `New-Object -ComObject Excel.Application`) with
   `Workbooks.OpenText(path, Origin: 65001, StartRow: 1, DataType: 1 (xlDelimited), TextQualifier: 1,
   ConsecutiveDelimiter: false, Tab: false, Semicolon: true, Comma: false, …, DecimalSeparator: ",", ThousandsSeparator: ".")`.
3. Reads the results back.

Record:

- the diacritics read back intact;
- `brutoPlaca` is a **number** cell (`Value2` is a double) equal to the fixture;
- `=1+1` is shown as text `'=1+1`, not `2`;
- the column count equals `CSV_COLUMNS.length`;
- what Excel does with `period` and a leading-zero OIB, if a fixture has one (note it, do not fix
  it).

Also record, for honesty, that on this en-US machine a plain `Workbooks.Open` (double-click
behaviour) yields one column (D1's accepted consequence). Quit Excel in a `finally`. If Excel is
unavailable, say so in the history file; do not skip silently.

### 14. UPDATE the docs

- `PRD.md`:
  - §7.11: add the dialect sentence (`;`, decimal comma, no `sep=`, header = canonical
    identifiers, OIB leading-zero note);
  - §10.12: items carry `originalFilename` (Task 12);
  - §10.14: paged, ordered by upload;
  - §4.4 is unchanged;
  - the Phase 4 status note: Task 12.
- `.agents/ROADMAP.md`:
  - §2 row 12 → "✅ implemented; review pending";
  - §3 Task 12: "Added in planning (plan 12)" with D1–D12 one-liners, and the DoD boxes ticked
    **only** with evidence (D3's test, step 7, step 13). "CSV opens in Excel" is ticked from
    step 13 and **confirmed in journey 9.11**;
  - §5: no new risk unless one is found.
- `CONTEXT.md`: no new term is expected. If "Export" needs a definition while writing copy, ask
  rather than invent.
- `.claude/commands/validate.md` (git-ignored):
  - Phase 4 rows for every new or extended test file;
  - **6.26 `/export` is registered before `/:id`**: a grep that `router.get(\n    "/export"`
    appears before `"/:id"` in `routes/payslips.ts`;
  - **journey 9.11** (below);
  - delete Phase 10's Task 12 row.

Journey 9.11 text for `validate.md` (**PAID ≤ 1 analysis, ~$0.05**, D11):

1. Throwaway account. Upload `A03.pdf`, wait for ready, and confirm. The session `⋮` menu shows
   Download CSV/JSON and saves `payslip-<period>-<id8>.csv`/`.json`.
2. With the admin key, seed 22 payslips in a second session, copying golden fixtures'
   `canonical_data`, all confirmed but two in `review`, one `failed`, and one with `created_at`
   yesterday.
3. History (nav item in the sidebar at `lg` and the bottom bar at 375 px):
   - page 1 has 20 rows, newest first;
   - "Page 1 of 2", and Next works;
   - filtering "Confirmed" resets to page 1;
   - the failed row is named by its filename;
   - yesterday's row is present with its date;
   - a row opens its session on that payslip.
4. Export all confirmed, CSV and JSON. The JSON parses with `jsonExportResponseSchema` and has no
   `review` payslip. The CSV opens via the step-13 Excel `OpenText` script with diacritics intact
   and numbers as numbers.
5. Delete a row: the dialog names it, it disappears from history and from its session, and the
   counts update.
6. 375 px and `lg`, `hr` and `en`: no horizontal scroll, every control ≥ 48 px, every string
   translated, the table's row menu not clipped.
7. Delete the throwaway data; run the orphan query.

### 15. RUN the full local validation, WRITE the history file, STOP (D12)

- `npm run validate`, `npm run build`, `npm run test:integration`,
  `git grep -n "react-router-dom" client/src` (none), `git diff --check`.
- Write `.agents/history/12-export-history.md` in the history/11 shape:
  - what was built;
  - decisions and deviations;
  - validation table with counts;
  - the step 13 probe results;
  - open items;
  - review-session handoff (journey 9.11 under D11's budget, the hr copy to read with the product
    owner, `/code-review` and `/validate`);
  - "Paid runs: 0, $0".
- Do **not** run `/code-review`, `/validate` or a browser journey. Do **not** commit. Stop and
  report.

---

## TESTING STRATEGY

### Unit Tests

- `api/src/export/payslips.test.ts` is the dialect, neutralisation and column contract, plus the
  D3 round trip over all 11 fixtures.
- `shared/src/api.test.ts` covers the list item's optional `originalFilename` and stripping.
- Client:
  - `historyRow.test.ts`, `download.test.ts`, `client.test.ts`;
  - `HistoryPage.test.tsx`;
  - `SessionPage.test.tsx` (menu items by state, download, failure);
  - `AppLayout.test.tsx` if it counts destinations;
  - the i18n guards.

### Integration Tests

The hosted Supabase suite covers:

- both export routes: `409`, `200`, `400`, `404`, user scoping, soft-delete exclusion and route
  order;
- the list's `originalFilename` and a previous-day row.

$0: the extraction runner is a no-op, and payslips reach `confirmed` through recorded pass
payloads and the confirm route.

### Edge Cases

- No confirmed payslips: the all-confirmed export returns `{ schemaVersion: 1, payslips: [] }` and
  a CSV with the header only. The UI still downloads it; say nothing more.
- A confirmed payslip with `tablesStatus: "failed"` exports with empty tables and that status.
- A text value that is only `-` or starts with `@`: neutralised. A decimal `-0.50`: not neutralised.
- An employee name containing `;` or `"` or a line break: quoted correctly.
- An export read racing a delete: `404` or `409`, shown as the generic export error.
- A history page emptied by a delete on the last page: the page steps back.
- A payslip deleted from history while it has unsaved edits in this tab: the edits are cleared, so
  there is no reload prompt.
- `originalFilename` absent (an older API): the untitled copy.
- More than 1,000 confirmed payslips: paged, not truncated. This is covered by the loop's logic;
  the unit test asserts the loop requests a second page when the first is full, using a mocked
  client if that is simple, otherwise note it as covered by code review.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
`npm run validate` (typecheck → oxlint → Prettier check → Vitest)

### Level 2: Unit Tests
`npx vitest run api/src/export shared/src/api.test.ts client/src/history client/src/routes client/src/api client/src/i18n`

### Level 3: Integration Tests
`npm run test:integration` (hosted Supabase, $0)

### Level 4: Manual Validation
The step 13 Excel COM probe (local, $0). Journey 9.11 is the **review session's** job (D12).

### Level 5: Additional Validation
`npm run build`; `git diff --check`; `git grep -n "react-router-dom" client/src` returns nothing.

---

## ACCEPTANCE CRITERIA

- [ ] JSON export round-trips: all 11 golden fixtures, exported, re-parsed and scored with
      `scoreSet`, deep-equal their input at 100% scalars, critical fields and cells (D3).
- [ ] CSV: BOM, CRLF, `;`, decimal comma, canonical headers, D2 columns, `tablesStatus` present,
      text columns neutralised and decimals never neutralised. Verified by unit tests and by the
      step 13 Excel import (diacritics intact, numbers numeric, `=1+1` inert).
- [ ] `GET /api/payslips/:id/export` returns `409 export_not_allowed` for an unconfirmed payslip,
      `404` for a foreign or deleted one, and `200` in both formats once confirmed.
- [ ] `GET /api/payslips/export` returns only the caller's confirmed, live payslips, paged past
      `max_rows`.
- [ ] History lists, filters, pages, links into the session, exports per row and in bulk, and
      soft-deletes. A previous day's payslip is listed.
- [ ] The session `⋮` menu offers CSV and JSON for a confirmed payslip.
- [ ] Both locales complete; every new control ≥ 48 px; no hardcoded strings.
- [ ] `npm run validate`, `npm run build` and `npm run test:integration` pass.
- [ ] Docs updated; history/12 written; nothing committed.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task's validation passed immediately
- [ ] Full test suite passes (unit + integration)
- [ ] No lint, format or type errors
- [ ] Step 13 probe recorded
- [ ] Acceptance criteria met, or each gap stated in history/12
- [ ] Stopped before review, `/validate`, browser journeys and commit (D12)

---

## NOTES

- **Why not RFC 4180 commas?** The CSV exists for Excel (PRD §7.11 names Excel), and the demo's
  audience runs Croatian Excel. JSON already serves machines at full fidelity. The product owner
  chose the Croatian dialect knowing that their own en-US Excel opens it in one column on
  double-click.
- **Why the list item is extended rather than slimmed:** `GET /api/payslips` returns whole payslips,
  tables included, which is more than history needs. Slimming it would be an unrequested API change
  (surgical-changes rule). At `limit = 20` the payload is small.
- **Deliberately not built:**
  - a harness CLI mode for real exports (D3);
  - per-code export error copy (D6);
  - a session-scoped bulk export (PRD §4.6);
  - un-delete;
  - an OIB text-formula workaround (D2).
- **Confidence: 8/10** for one-pass success. The ports are proven code. The main risks are:
  - the integration helpers' exact names for reaching `confirmed`, so read lines 790–948 first;
  - the Excel COM `OpenText` argument list in PowerShell, which uses positional `[Type]::Missing`
    fillers;
  - the lint rules on the ported client files.
