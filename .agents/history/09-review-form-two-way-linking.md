# 09 — Review form & two-way linking

**Date:** 2026-09-26
**Plan:** [`plans/09-review-form-two-way-linking.md`](../plans/09-review-form-two-way-linking.md)
**Outcome:** the screen the product exists for. Selecting a payslip on the session page opens its
review:

- every canonical field is editable, including the three line-item tables;
- each field is linked both ways to its outline;
- saving is explicit, and confirming is refused while the form is dirty or the tables are pending;
- every payslip write now goes through a `security definer` function.

**Status: implemented; review session pending; migration 2 pending (step P).** By the session split
(D22, pinned memory), this session did not run:

- `/code-review` or `/validate`;
- any browser journey;
- migration 2;
- a commit.

It spent **$0** on Azure.

## What was built

| File | Contents |
| --- | --- |
| `supabase/migrations/20260926065611_server_side_payslip_writes.sql` | **Applied.** Seven new `security definer` functions (`update_payslip_fields`, `confirm_payslip`, `begin_payslip_retry`, `soft_delete_payslip`, `fail_payslip_extraction`, `fail_payslip_tables`, `fail_stale_payslip_extractions`), and `complete_extraction_pass` altered to definer (D2) |
| `supabase/migrations/20260926081337_revoke_direct_payslip_updates.sql` | **Applied in step P** (D3): `revoke update`, drop the update policy, and (review session) `insert` narrowed to the six upload columns. Renamed from its placeholder version `20260926070000` |
| `api/src/database.types.ts` | `Functions` regenerated: eight entries |
| `api/src/validation/attention.ts` | `GROUNDING_GATED_FIELDS`; the pass's `ungroundableFields` gate `period`/`paymentDate` (D7) |
| `api/src/validation/edited.ts` | `TABLE_FIELDS`, `editedFields` (D5), `liveSignals` (D6) |
| `api/.../content-understanding/original.ts` | `originalExtraction(raw)`: each retained body through its own pass's mapper (D4); exported from `index.ts` |
| `api/.../content-understanding/regions.fixture.ts` | `mappedPass(body, pass)`: a pass write built by the real mapper, for the hosted tests (deviation 4) |
| `api/src/repositories/payslips.ts` | `findRegionSource` → `findRetainedResponses` (status, tables status, fields, raw). Writes as RPCs: `updateFields`, `confirm`, `softDelete`, `beginRetry`, `failExtraction`, `failTablesExtraction`, `failStaleExtractions`. `update`, `UpdatePayslipInput`, `#updateProcessing` and `PayslipUpdate` removed. `findDetailState` and `mapPayslipRow` filter signals through `liveSignals` |
| `api/src/routes/payslips.ts` | `PATCH /:id`, `POST /:id/confirm`, `detailBody()` shared with `GET /:id`; retry and delete adapted to boolean writes |
| `api/src/routes/direct-writes.integration.ts` | Post-step-P assertions; not in the runner yet |
| `scripts/score-extraction.ts` | `signals()` passes each pass's `ungroundableFields` (D7) |
| `shared/src/api.ts` | `editedFields` comment: scalars and positional cells (D5) |
| `client/src/api/client.ts` | `updatePayslip`, `confirmPayslip` |
| `client/src/review/reviewForm.ts` | Kinds, `formatField`, `parseField`, `validatorFor`, `toFormValues`, `toPatch`, `InputPath` (D12, D17) |
| `client/src/review/fieldAttention.ts` | `attentionFor`, `sectionWarnings` (D18) |
| `client/src/review/ReviewField.tsx` | Labelled input, `fieldId`/`pathOfFieldId`, `attentionMessage`, `inputClass` |
| `client/src/review/SectionLegend.tsx` | Section name plus colour dot, shared by the form and the tables |
| `client/src/review/LineItemSection.tsx` | One table: `<table>` at `lg`, cards on a phone; add and remove; pending skeleton; failed notice; visible row notes |
| `client/src/review/PayslipForm.tsx` | The form, sticky action bar, save and confirm (named `PayslipForm`, not `ReviewForm`: deviation 1) |
| `client/src/review/PayslipReview.tsx` | `git mv` from `PayslipPreview.tsx`: loader, D11 layout, `selectRegion`, phone disclosure |
| `client/src/review/ZoomableSourceViewport.tsx` | Escape closes the popover; the viewport is focusable by script (D9) |
| `client/src/review/regionSections.ts` | Exports `SCALAR_SECTIONS`, `SCALAR_LABEL_KEYS`, `COLUMN_LABEL_KEYS`, `TableField` |
| `client/src/routes/SessionPage.tsx` | **Review**/**Hide review** (D16); list on top, review below (D11); discard dialog and `beforeunload` (D13); `onChanged` refreshes the rows |
| `client/src/components/ConfirmDialog.tsx` | Buttons 44 → 48 px (D23) |
| `client/src/i18n/locales/*.json` | Step 16's copy; the `warnings` group |
| `PRD.md` | §7.7 settled rules, §7.9 signal rules, §9.1 write functions, §10.5–10.7, §12 Phase 3 status |
| `CONTEXT.md` | **Edited field** |
| `.agents/ROADMAP.md` | §2 row; §3 Task 09 additions and DoD; Task 10 Back-button gap; §5 direct-write row and the D01 row (D15) |
| `.claude/commands/validate.md` | Phase 4 rows; 6.23 renamed; new 6.24; Phase 8 cases, 8.1 expectations, `direct-writes.integration.ts`; journey 9.8; Phase 10 row 09 removed (git-ignored) |

New tests:

- `edited.test.ts` (12);
- `original.test.ts` (7, one of them over the recordings);
- `reviewForm.test.ts` (50, 22 of them the fixture round trip);
- `fieldAttention.test.ts` (6);
- `LineItemSection.test.tsx` (10);
- `PayslipForm.test.tsx` (17);
- `ZoomableSourceViewport.test.tsx` (3).

Extended tests:

- `attention.test.ts` (+5);
- `payslips.test.ts` (RPC wrappers, D6, `findRetainedResponses`);
- `PayslipReview.test.tsx` (+5, renamed);
- `SessionPage.test.tsx` (+5, and the button copy);
- `client.test.ts` (+4);
- `statusCopy.test.ts` (the `warnings` group);
- `payslips.integration.ts` (+7, and the loosened cap tests and cross-user cases).

## Decisions

D1–D23 as the plan states them, all applied. Two notes:

- **D7 is a per-field rule the product owner chose knowingly** (plan D7), not a threshold fitted to
  the data. Its effect is measured below.
- **D19's RHF risk did not materialise.** `values` with `keepDirtyValues` keeps a dirty scalar
  through the tables landing (`PayslipForm.test.tsx`), so the `resetField` fallback was not needed.

## D7 harness figures (`npm run score:extraction`, free, offline)

| Set | Wrong scalars flagged, before | After | Scalars flagged, before | After |
| --- | --- | --- | --- | --- |
| `cu` | 3/3 | 3/3 | 20 | 11 |
| `production` | 2/2 | 2/2 | 19 | 9 |
| `production-sequential` | 1/1 | 1/1 | 20 | 9 |
| `two-pass-concurrent` | 4/5 | 4/5 | 22 | 13 |
| `two-pass-sequential` | 2/2 | 2/2 | 17 | 8 |

"Wrong scalars flagged" is unchanged in every set, as step 6 required; the flags roughly halve.

## Migration record

- **Dry run:** the whole of migration 1 in `begin; … rollback;` through `execute_sql`, with a
  `pg_proc` check inside the transaction. All eight functions were `prosecdef`, `anon` could execute
  none of them, and `authenticated` could execute all of them.
- **Applied** as `server_side_payslip_writes`, recorded once as version `20260926065611`. The local
  file was renamed to match.
- **Advisors (security):**
  - `authenticated_security_definer_function_executable` (lint 0029, WARN) on all eight functions.
    This is expected and intended (D2); `validate.md` 8.1 now says so.
  - The known `auth_leaked_password_protection`.
  - Nothing else.
- **Migration 2** is written and not applied. Until step P, the hosted list differs from
  `supabase/migrations/` by exactly that file.

## Re-mapping check on the hosted M1 rows (added at execution)

Raised at priming (concern 1): the plan's recordings test builds the "stored" side through the same
mapper call as the original, so it cannot catch a difference between a stored row and a re-map.

- A read-only script, `.bakeoff/task09/m1-remap.ts` (git-ignored), took every live payslip of
  `m1-review-08@example.test`. It re-mapped the retained responses with `originalExtraction` and
  compared them with the stored `canonical_data` through `editedFields`.
- **14 rows, 0 differences.** An untouched payslip analysed before this task is never marked edited.
- It wrote nothing, and the M1 data is unchanged (D21).
- The recordings test now merges the tables pass first, the other landing order, and round-trips
  through JSON and the canonical schema as a read does.

## Deviations from the plan

1. **`ReviewForm.tsx` became `PayslipForm.tsx`.** Windows resolves paths case-insensitively, so
   `./ReviewForm` imported `reviewForm.ts` and the component was `undefined`. Git on this machine
   would also have trouble tracking the two names. The model keeps the plan's `reviewForm.ts`.
2. **`SectionLegend.tsx` was added**, because the scalar sections and `LineItemSection` both render
   the legend.
3. **`regionSections.ts` exports four more names.** The form takes its field order and labels from
   them, as the plan intends.
4. **`mappedPass` lives in `regions.fixture.ts`.** The hosted tests need fields and metadata from
   the real mapper, but the vocabulary guard forbids `analyzeresult` anywhere in `routes/`,
   including the name `mapAnalyzeResult`. The fixture module is inside the provider module.
5. **The source `<aside>` comes first in the DOM** and is placed in the right column at `lg`, so a
   phone shows the preview above the form (D11) from one mount. At `lg`, Tab therefore reaches the
   zoom controls before the form. **For the review session to judge.**
6. **`ConfirmDialog`'s buttons went to 48 px** (D23). This is the only dialog the product shows
   today.
7. **`confirm_payslip`'s generated return type is `string`.** A plpgsql `timestamptz` return is
   nullable, so the repository reads it as `string | null`.
8. **The table's removal column has an empty header cell.** Every removal button names its row, so
   a header would only repeat "Remove row".
9. **Line endings.** Edits made with Python on Windows wrote CRLF. `prettier --write` on exactly the
   23 changed files restored LF; `git diff --stat` shows content-sized diffs only.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` (baseline) | green, 50 files, 743 tests |
| `npm run validate` (final) | green: typecheck, oxlint, Prettier, **57 files, 885 tests** |
| `original.test.ts` recordings block | ran locally (not skipped) |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run test:integration` | hosted `hxksulbgluvfxfoxrhse`: **3/3** auth, **45/45** payslips (38 before). Run after step 12 and again after the final formatting |
| Orphans | the `task*` user query returns `[]` |
| Lockfile | `git diff --stat package-lock.json` empty: no new dependency |
| `grep react-router-dom client/src` | empty |
| Vocabulary grep outside the module | only `provider-vocabulary.test.ts` |
| 6.23 (raw column read once) | ok, as `findRetainedResponses` |
| 6.24 (definer functions check ownership) | ok, 7 functions |
| `npm run score:extraction` | exit 0; the D7 table above |

Not run in this session, by the session split (D22):

- `/code-review`;
- `/validate`;
- journey 9.8;
- migration 2 and step P;
- `npm run test:extraction`, which is paid.

## Paid Azure runs

None. **$0.**

## Open items

1. **Browser Back while dirty loses edits** (D13). `<BrowserRouter>` has no `useBlocker`. It is in
   Task 10's scope.
2. **Migration 2 is pending step P.** After the product owner commits and the subtree push
   deploys, and once Render reports the new API live:
   1. dry run the migration;
   2. `apply_migration`, and rename the file to the recorded version;
   3. add `direct-writes.integration.ts` to the runner's file list;
   4. run `npm run test:integration`;
   5. run `get_advisors`;
   6. record it here, and close the §5 row.
3. **The D01 inside-region check** (D15) is a new ROADMAP §5 row.
4. **Edited is measured against today's mapper** (priming concern 2). A later mapper change that
   maps an old body differently would mark those values edited on that payslip's next save, and
   strip their signals. Payslips are not re-mapped on read, so nothing changes until a save.
   Whoever changes the mapper should re-run the M1 re-mapping check.
5. **On a phone the preview can be scrolled out of view** while lower fields are edited (D11). The
   active outline is set but visible only after scrolling up. Task 10's source strip closes this.
6. **Tab order at `lg`** (deviation 5).

## Handoff to the review session

1. Journey **9.8** in `validate.md`: two documents, about $0.10, under a throwaway account, never on
   the M1 data. Delete its data afterwards.
2. The product owner reads the copy:
   - plan step 16's table;
   - D16's **Review** / **Hide review** ("Pregledaj" / "Sakrij pregled").
3. `/code-review`, then `/validate`. 8.1 expects migration 2 unapplied and lint 0029 on the eight
   functions.
4. Committing waits for the product owner's go-ahead. After the commit and the push, **step P**.

## Review session (2026-09-26)

`/code-review` (Standards and Spec axes, against `a787b80`), `/validate`, and journey 9.8 driven
with `agent-browser` (Chromium, dev server) under throwaway `task09-browser-*` accounts. Never on
the M1 data.

### Findings and what was done

| # | Finding | Found by | Outcome |
| --- | --- | --- | --- |
| 1 | **The dirty flag outlived the form.** Edit, then browser Back: the review unmounted but `SessionPage`'s `dirty` stayed `true`, so reload still prompted and the next **Review** opened "Discard unsaved changes?" with no form open. Reproduced in the browser | both reviews | **Fixed:** `PayslipForm` reports clean on unmount. New test; re-checked in the browser |
| 2 | **Migration 2 left the direct-write gap open through INSERT.** `authenticated` held INSERT on all 23 `payslips` columns (checked on the hosted project), so a user could insert a row already `confirmed`, with any `canonical_data`, while its tables were pending | priming, Spec | **Fixed in migration 2** (still unapplied): INSERT is revoked and re-granted on the six upload columns only. Transactional dry run on the hosted project: `status`, `canonical_data`, `confirmed_at` not insertable, upload columns insertable, no UPDATE; rolled back, verified unchanged. `direct-writes.integration.ts` gains a forged-insert case (`42501`) |
| 3 | **Outlines of removed rows stayed drawn.** After removing a row, the original last row's outline stayed solid and clickable, pointing at an input that no longer exists (`editedCells` covers current rows only). Seen on A01's obustave | journey 9.8 | **Fixed:** `liveRegions` drops regions of rows the saved payslip no longer has. New test; re-checked in the browser (87 → 84 outlines, the shifted row dashed) |
| 4 | Tab order at `lg` (deviation 5): Zoom in and Open in a new tab come before the form | Spec, journey | **For the product owner.** Two tab stops; fixing it moves the mismatch to the phone |
| 5 | Equal-length edits: remove a row and add one, and a shifted cell whose text equals the original at that index keeps its old signals (D5 compares positionally only when lengths differ) | Spec | Open item, not fixed |
| 6 | At 1440 px the line-item text columns are ~90 px wide, so names read "SINDIKAL…", "NAKNADA Z…" | journey | **For the product owner / Task 10**, which reworks the `lg` layout into three zones |
| 7 | `hr` says "redak" in `rowLabel` but "red" in `cellLabel` | Standards | **For the product owner's copy read** |
| 8 | A card's format error sits at the bottom of its card, not under the cell (D18 wording; step 18 says one note per row) | Spec | Matches step 18; noted |
| 9 | Escape listener is on `document`, so Escape in another dialog also closes the popover | Spec | Low impact; noted |
| 10 | Smells: the three table names listed in five places; six RPC wrappers repeat one shape; `SessionPage` still names the panel "preview"; `status: string` in `RetainedResponses` | Standards | Judgement calls; not changed |

### Validation

| Phase | Result |
| --- | --- |
| 0–5 | install clean; oxlint 0; typecheck 0; Prettier clean; 57 files, 885 tests before the fixes, **887** after; each project resolves by name; build green (known chunk-size advisory) |
| 6 | 6.1, 6.1b, 6.2, 6.3, 6.4, 6.4b, 6.5, 6.8, 6.9, 6.11, 6.16, 6.20, 6.21, 6.22, 6.23, 6.24 (7 functions) all ok; lockfile unchanged |
| 7 | `check:golden` passes; `score -- cu` 281/284 98.9%; `score:extraction` exit 0, `cu` 270/273, `production` 271/273, flag counts as the D7 table; both analyzers match the code |
| 8 | hosted: auth 3/3, payslips 45/45; 0 orphans. 8.1: migration list differs only by migration 2; lint 0029 on exactly the eight functions, plus `auth_leaked_password_protection` |
| 9.2–9.4 | health direct and through the proxy; `404 not_found`; `401 unauthorized` on both prefixes; signed-out redirect, register, reload stays signed in |
| 9.5–9.7 | **Not re-run**: Task 09 does not touch the shell, auth or capture, and 9.6/9.7 are paid uploads. The preview parts of 9.7 were exercised through 9.8 on two PDFs |
| 9.8 | all eleven steps pass (A02 = `A02_OCR.pdf`, no `A02.pdf` exists), apart from findings 1 and 3, fixed above. Pending skeleton and Confirm's reason; focus ↔ outline both ways; a page-2 field switches to page 2; phone popover, Edit, Escape; the disclosure keeps the same canvas with no refetch; one-cent `brutoPlaca` → toast, amber `dohodak_mismatch`, dashed outline, cleared on revert; `abc` visible and focused in table and card, no PATCH; discard dialog, Keep editing, Discard, `beforeunload`; second confirm keeps `confirmedAt`, edit keeps Confirmed; `hr` `1307,14` `05/2025` `09.06.2025`; nothing under 48 px, `scrollWidth` 360 at 375 px, the action bar clears the bottom nav |

### Paid Azure runs

Three documents: A02 and A01 for journey 9.8, A02 again to re-check fixes 1 and 3. At Task 05's
$0.045–0.051 per two-pass document, **about $0.15**. All data deleted; 0 orphans.

### Left for the product owner

1. Findings 4, 6 and 7, and the copy read from the handoff above.
2. Committing, then step P. Step P now also closes the INSERT path, and
   `direct-writes.integration.ts` covers it.

## Step P (2026-09-26, after `aab59c0` deployed)

The product owner reported the deploy live; `/api/health` answered with `uptimeSeconds` 278.

1. **Dry run:** migration 2 as written, in `begin; … rollback;`. Afterwards `authenticated` had no
   UPDATE (table or column), INSERT on exactly six columns and not on `status`, and no update
   policy.
2. **Applied** as `revoke_direct_payslip_updates`, recorded once as version `20260926081337`. The
   local file was renamed from `20260926070000`, and the hosted list now matches
   `supabase/migrations/` exactly.
3. `direct-writes.integration.ts` joined the runner's file list.
4. `npm run test:integration` on hosted: auth **3/3**, payslips **45/45** (the two direct-write cap
   tests now refused with a permission error), direct writes **4/4**, including the forged insert.
   0 `task%` users, 0 orphan payslips or Storage objects.
5. **Advisors (security):** lint 0029 on the eight functions and `auth_leaked_password_protection`;
   nothing else.
6. ROADMAP §5 "Direct-write gap" is closed; `validate.md` 8.1 no longer lists an expected exception.

Not run: a paid upload on production. The narrowed INSERT is the one the upload repository
performs, and the hosted suite exercises it through the API.
