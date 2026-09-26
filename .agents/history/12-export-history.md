# 12 — Export & history

**Date:** 2026-09-26
**Plan:** [12-export-history.md](../plans/12-export-history.md)
**Outcome:** confirmed payslips export as JSON and as a Croatian-dialect CSV, one at a time or all
together. A history screen lists, filters, pages and soft-deletes every payslip and links back
into its session. There is no migration and no new dependency.
**Status: implemented, reviewed and validated; journey 9.11 passed. Not committed.**

Following plan 12 D12 and the standing session split, this session did not run `/code-review`,
`/validate` or any browser journey, and did not commit. Paid runs: **0 analyses, $0.**

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `api/src/export/payslips.ts` | `CSV_COLUMNS`, the column classes, `toCsv` (D1, D2) and `toJsonExport` |
| `api/src/export/payslips.test.ts` | The dialect, quoting, neutralisation and column contract, plus the D3 round trip over all 11 fixtures |
| `client/src/history/historyRow.ts` (+ test) | `rowTitle`, `rowPeriod`, `rowAmount`, `rowRoute`, `rowUploaded` |
| `client/src/history/PayslipActions.tsx` | The row menu: CSV/JSON when confirmed, then Delete |
| `client/src/history/PayslipCards.tsx`, `PayslipTable.tsx` | Phone cards and the `lg` table |
| `client/src/routes/HistoryPage.tsx` (+ test) | The page, ported from receipt-ocr |
| `.agents/history/12-export-history.md` | This record |

| Modified file | Change |
| --- | --- |
| `shared/src/api.ts` (+ test), `shared/src/index.ts` | `payslipListItemSchema` with an optional `originalFilename` (D7) |
| `api/src/repositories/payslips.ts` (+ test) | `listConfirmedForExport` (paged, D4); `listPage` items carry `originalFilename` |
| `api/src/routes/payslips.ts` | `GET /export` before `GET /:id`; `GET /:id/export`; a `sendExport` helper |
| `api/src/routes/payslips.integration.ts` | Five cases in `export and history (Task 12)` |
| `client/src/api/client.ts` (+ test) | `getPayslips`, `deletePayslip`, `exportPayslips`, `exportPayslip` |
| `client/src/history/download.ts` (+ test) | `payslipExportFilename` (D9); `format` typed as `ExportFormat`; stale comment removed |
| `client/src/routes/SessionPage.tsx` (+ test) | The `⋮` menu offers downloads on a confirmed payslip (D5); a failure shows on that payslip only |
| `client/src/App.tsx`, `components/NavItems.tsx`, `AppLayout.test.tsx` | The `/history` route and nav item (D10); the sidebar item 44 → 48 px (deviation 1) |
| `client/src/i18n/locales/{en,hr}.json` | `common.navHistory` and a `history` block |
| `PRD.md` | §7.11 dialect paragraph, §10.12, §10.14, the Phase 4 status |
| `.agents/ROADMAP.md` | §2 row 12; Task 12 D-list and DoD |
| `.claude/commands/validate.md` (git-ignored) | Phase 4 rows, check 6.26, journey 9.11, the Phase 10 row removed |

## Decisions

Implemented plan D1–D12 as written, except for the deviations below.

## Deviations and implementation findings

1. **The sidebar nav item went from 44 px to 48 px** (`NavItems.tsx`, `min-h-11` → `min-h-12`). The
   plan requires every new control to be at least 48 px, and the new History item shares the
   sidebar's one class. The Capture item grows with it. This was raised during priming. The bottom
   bar was already `min-h-16`.
2. **PostgREST paging was measured, not assumed.** `listPage` handles `PGRST103` for a range past the
   end. A read-only probe against the hosted project showed that this happens only with
   `count=exact` (`416`). Without a count the same range answers `200 []`. So the ported
   export loop, which requests no count, needs no `PGRST103` branch and ends on the short page.
3. **The paging loop has a unit test.** The plan allowed leaving this to code review. A fake client
   serves 500 + 500 + 3 rows, and the test asserts three ranges, the D4 order and the owner filters.
4. **The strict export schema holds through `.extend().omit()`.** In priming it was unclear whether
   zod 4 keeps `.strict()` through those calls. `toJsonExport` throws on a stray key, which the unit
   test proves.
5. **The client test asserts the BOM on bytes, not text.** `Blob.text()` strips a leading BOM when it
   decodes. The bytes are what `saveBlob` writes, so the test checks `EF BB BF`.
6. **The session page's export error is keyed to the payslip** (`exportFailedId`), so it does not
   follow the user to another chip. There is no reset effect.
7. **Copy reuses existing words.** The English amount column is "Amount paid out" and the Croatian
   employee column is "Radnik", matching the field labels. The statuses reuse `payslipStatus.*`.
8. **`rowUploaded` joined `historyRow.ts`**, so the cards and the table format the upload date the
   same way.
9. **Editing mishaps, all fixed before any test ran.**
   - Python text mode on Windows rewrote three files with CRLF. They were restored to LF.
   - Two `"\r\n"` literals in the integration file were broken by escaping. They were repaired.
   - Three invisible literal BOM characters became `"﻿"` escapes.

   `git diff --check` and Prettier are clean.
10. **Lint:** two findings fixed. `menuItems` moved to module scope (`consistent-function-scoping`),
    and a redundant spread was removed (`no-useless-spread`).

## Validation

| Check | Result |
| --- | --- |
| Baseline `npm run validate` | 69 files / **1000 tests**, green |
| Targeted runs | `shared/src/api.test.ts` 39; `api/src/export` 39; repository 50; client API 24; history + page 32; session 33; layout 9 |
| `npm run test:integration` (hosted, $0) | auth 3, **payslips 62** (+5), direct writes 4 |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **72 files / 1088 tests**: +3 files, +88 tests |
| `npm run build` | Passed; existing chunk-size advisory only |
| Check 6.26, run from `validate.md` | `ok` |
| `git grep react-router-dom client/src` | No matches |
| `git diff --check` (new files included) | Clean |
| `package-lock.json` | Unchanged |

The integration run's data was cleaned up by the suite's own `afterAll`, which deletes both users,
and their rows cascade. The Task 12 cases insert rows without source objects.

### Step 13: Excel import probe (local, $0)

A scratchpad script wrote a CSV with the production `toCsv`. It held A01, B02, A03, and an A01 copy
whose `employerName` is `=1+1` and whose `employeeName` is `Đurđa Čačić-Šimić; Žana`. The file starts
`EF BB BF`, uses `;` and has 34 columns. Excel 16 opened it through COM on this machine, whose
international settings are list separator `,` and decimal `.`.

`Workbooks.OpenText` with positional `[Type]::Missing` fillers failed with "Unable to get the
OpenText property", for both a `.csv` and a `.txt` copy. It worked when called through
`InvokeMember` with **named** arguments: `Origin 65001`, `DataType 1`, `TextQualifier 1`,
`Semicolon true`, `Comma false`, `DecimalSeparator ","` and `ThousandsSeparator "."`.

| Check | Result |
| --- | --- |
| Column count | 34 = `CSV_COLUMNS.length` |
| Diacritics | `Viktorija Mišetić`, `SVEUČILIŠTE U SPLITU`, `Đurđa Čačić-Šimić; Žana` intact; the quoted `;` stayed in one cell |
| `brutoPlaca` | A **number** (`Double`) equal to the fixture: 3292.14, 1348.76, 2801.6 |
| `ukupnoSati`, `iznosZaIsplatu` | Numbers (212, 1772.15) |
| `=1+1` | Stayed text: the cell holds `'=1+1`, with the apostrophe visible, and does not evaluate to 2 |
| `period` | Stayed text: `2025-05` |
| `paymentDate` | Became an Excel date (serial 45817, shown by locale) |
| OIBs | Became numbers and display in scientific notation (`1.07E+10`) at default width. **A03's employer OIB `02879747067` became `2879747067`**: the documented leading-zero loss (D2) |
| Plain `Workbooks.Open` (double-click) | **5 rows × 18 columns**, not the single column the plan expected. The header stayed in A1, but each data row split at every comma, **decimal commas included**, so `3292,14` spans two cells |

The last row corrects the plan's D1 note. In an en-US Excel a double-click does not give one
harmless column. It gives rows split at their decimal commas, which misaligns data. D1 already
accepts that a double-click in en-US does not work, and says Data → From Text/CSV does. The PRD
§7.11 paragraph now says the file "does not split into its columns" rather than repeating "one
column".

## Open items

1. **"History survives a session reload"** is proven only at the API level: a payslip moved to
   yesterday is listed after today's. The browser reload is journey 9.11, so that DoD box stays open.
2. **CSV in Excel** is ticked from the step 13 probe and is to be confirmed in journey 9.11.
3. **OIBs in Excel** show in scientific notation as well as losing a leading zero. Both are the same
   known D2 limitation: the JSON is lossless, and the import wizard can type the column as Text.
4. **The en-US double-click splits rows at decimal commas** (step 13). This is accepted under D1.
   Reopen D1 only if the demo audience turns out to run en-US Excel.
5. **`BottomNav`'s comment** says "this app has two" destinations. It is now true, so it was left as
   the plan says.

## Review-session handoff

- Run journey **9.11** under plan 12 D11's budget: at most one paid two-pass analysis (A03), about
  **$0.05**, with a throwaway account. Seed the rest with the admin key at $0. Log the cost here.
- Read the new `history.*` copy in `hr` and `en` with the product owner, especially the delete
  dialog body, "Platna lista bez naziva", and the column headers.
- Run `/code-review` and `/validate` in the separate review session.
- Nothing has been committed or deployed. `.agents/plans/12-export-history.md` is still untracked.

## Review session (2026-09-26)

`/code-review` ran separate Standards and Spec agents over the uncommitted diff against `785dbda`.
`/validate` ran in full, followed by journey 9.11 in Chromium through `agent-browser`.

### Findings and outcome

| # | Axis | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | Standards | A failed delete left the `ConfirmDialog` open. It is modal (`showModal()`), so the page behind it, where the error `role="alert"` rendered, was inert: nobody could see or hear the failure. Inherited from receipt-ocr | **Fixed.** `remove` closes the dialog on failure (`HistoryPage.tsx`). The test now asserts the dialog closes; it failed against the old code. In the browser, with the payslip's URL aborted, the dialog closed and the alert showed on the live page |
| 2 | Spec | A status filter with no matches said "No payslips yet" with a Scan button, which is false for a user who has payslips. Inherited from receipt-ocr | **Fixed.** A filtered empty list says `history.emptyFiltered` ("No payslip has this status." / "Nijedna platna lista nema ovaj status."), with no call to action. New test, failed against the old code; seen in the browser |
| 3 | Spec | The table's row-header link was inline text, so the focusable control was about 20 px tall against the 48 px rule | **Fixed.** The link is `flex min-h-12` with the title truncated inside it; 48 px in the browser |
| 4 | Spec | `api/src/export/payslips.ts`'s header still said an en-US double-click opens one column, which step 13 disproved | **Fixed**, matching PRD §7.11 |
| 5 | Standards | `rowAmount` passes `currency: "EUR"` rather than `item.currency` | **Not a defect.** `currency` is `z.literal("EUR")` (locked decision 7) |
| 6 | Standards | The bulk and per-row exports share one `exportFailed` message that does not name the payslip | **Kept.** D6 settles one translated message; the row the user just chose is the context |
| 7 | Standards | Smells: `download` in `SessionPage` and `downloadOne` in `HistoryPage` are near twins, as are the two CSV/JSON menu-item pairs; `PayslipTable` and `PayslipCards` share a props clump; the session menu is labelled by `merge.actions` and uses `history.*` keys; `CSV_COLUMNS` restates the scalars that a test keeps in step with the schema; `HistoryPage` holds eleven `useState`s | **Not changed.** Judgement calls with no behaviour behind them, left for the product owner |

Hard standards violations: none. The Spec agent found no missing requirement and no scope creep
beyond the disclosed deviations.

### Validation

| Check | Result |
| --- | --- |
| Phases 0–3: install, oxlint, typecheck, Prettier | Pass |
| Phase 4: `npm test` | 72 files, **1089 tests** after the fixes (+1); shared 299, api 385, client 405 |
| Phase 5: build | Pass; existing chunk-size advisory only |
| Phase 6: 6.1–6.26 | All pass; 6.1 still throws on an added `VITE_…_KEY`; 6.5 resolves 180 `t()` calls. 6.5 must run in PowerShell: under bash its `\b` is unescaped and the regex fails to compile |
| Phase 7 | Golden set passes; `score -- cu` 281/284 (98.9%); `score:extraction` `cu` 270/273, `production` 271/273; analyzer drift check matches both analyzers |
| Phase 8: `npm run test:integration` (hosted) | auth 3, **payslips 62**, direct writes 4; no orphan `task…` users |
| Phase 8.1 | `list_migrations` matches the seven local files; advisors: lint 0029 on the 9 definer functions (by design) and `auth_leaked_password_protection` only |
| 9.2–9.4 | Health direct and through the proxy, `404 not_found`, `401` on both prefixes and on `/api/payslips/export`, sign-up, redirect |
| API log | No names, amounts or IBANs. Two `level 50` lines are the seeded failed row's missing source (step 3), expected |
| Orphans after cleanup | 0 orphan payslips, 0 orphaned objects (20 in storage, all owned by live users) |

### Journey 9.11 (throwaway account, 2026-09-26)

1. `A03.pdf` was ready about 15 s after upload. Before confirming, the panel had no `⋮` (nothing to
   merge, nothing to export). After Confirm, "Payslip actions" (48 × 48) offered Download CSV and
   Download JSON (48 px each), saved as `payslip-2025-06-4fb177df.csv` / `.json`. The CSV: BOM,
   34 columns, `;`, `brutoPlaca` `2801,60`, `SVEUČILIŠTE U SPLITU - MEDICINSKI FAKULTET`, no trailing
   CRLF. The JSON: `schemaVersion` 1, 5 pay components, no `userId`.
2. Seeded 22 rows with the admin key from the golden fixtures' fields, with no source: 19
   confirmed, 2 `review`, 1 `failed`, the oldest dated yesterday. **The journey said "in a second
   session", but the ten-payslip cap refuses that, so they went into three sessions (10 + 10 + 2).**
   `validate.md` now says so.
3. History from the sidebar: "23 payslips", 20 rows newest first (A03 on top), "Page 1 of 2"; Next
   gave 3 rows ending with yesterday's (Sep 25). Filtering Confirmed from page 2 went to "Page 1 of
   1" with 20 Confirmed rows. The failed row reads `seed-failed-scan.jpg`. Reading the payslip, which
   no row has, showed the new filtered empty message. The row link (48 px) opened payslip 6's
   session on that failed payslip.
4. All confirmed as CSV and as JSON: `payslips-2026-09-26.csv` / `.json`. The JSON parsed with
   `jsonExportResponseSchema`: 20 payslips, all confirmed, none in `review`, in upload order. The
   CSV through the Excel `OpenText` probe: 21 rows × 34 columns, 12 name cells with diacritics, 0
   mojibake cells, all 20 `brutoPlaca` cells numbers (3292.14, 1854.91, …).
5. With that payslip's URL aborted, Delete → the dialog named `G01-seed-22.pdf`, was `:modal`, and
   focused "Keep it". Confirm closed it and showed the translated alert; the row stayed (finding 1).
   Unblocked, the delete went through: "22 payslips", the row gone, and its session down from two
   payslips to one.
6. 375 px and 1440 px, `en` and `hr`: cards and table respectively, no horizontal scroll, no raw
   keys, `lang` follows. Every Task 12 control is ≥ 48 px; the only smaller ones are the header's
   language and account buttons (44 px), which journey 9.5 sets. The last row's menu, opened at
   both widths, has all three items hit-testable at 48 px: not clipped. The bottom bar lists Scan
   and History (current), 64 px. A reload of History kept all 22 rows and yesterday's. In `hr` the
   session menu reads Preuzmi CSV / Preuzmi JSON.
7. The account, its 23 rows (the deleted one included), 4 sessions and 1 storage object were deleted; the orphan checks
   returned zero.

**Downloads in headless Chromium.** `agent-browser download` reports "Download was canceled" for
every `saveBlob` file, even with `revokeObjectURL` deferred in the page, so the cancellation is the
automation's, not the app's. The files were read by hooking `URL.createObjectURL` and
`HTMLAnchorElement.prototype.click` in the page, which also yields the real `download` name.

**Paid runs: 1 two-pass analysis** (A03), about **$0.05**, within plan 12 D11's budget.

### Observed, not changed

- The session header's `session.progress` reads "1 of 1 ready to review" for a **confirmed**
  payslip: Task 07 counts `review` and `confirmed` together. Not Task 12's; worth a word with the
  product owner.

### Still open

- Read the `history.*` copy in `hr` and `en` with the product owner, including the new
  `emptyFiltered` line.
- Nothing committed or deployed. `.agents/plans/12-export-history.md` is still untracked.
