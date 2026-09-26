# 11 — Merge payslips

**Date:** 2026-09-26
**Plan:** [11-merge-payslips.md](../plans/11-merge-payslips.md)
**Outcome:** two payslips can be merged into one that re-extracts their combined pages, from a
server-computed suggestion or from the payslip's action menu. The migration is applied to the
hosted project.
**Status: implemented, reviewed and validated, journey 9.10 passed; not committed.** See
"Review session" at the end.

Following plan 11 D14 and the standing session split, this session did not run `/code-review`,
`/validate` or any browser journey, and did not commit. Paid runs: **0 analyses, $0.**

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `supabase/migrations/20260926140159_merge_payslips.sql` | `merge_payslips`: locks both rows in id order, checks, soft-deletes, then inserts (D8) |
| `api/src/services/payslip-merge.ts` | `combineSources`, `MergeSourceError` (D1, D2, D9). `mergedFilename` moved to `shared/src/session.ts` in review |
| `api/src/services/payslip-merge.test.ts` | Order, A4 geometry, EXIF rotation, `/Rotate` kept, encrypted PDF text, HEIC, errors, filename |
| `client/src/session/MergeDialog.tsx` (+ test) | Pick and confirm steps, swap, consequence copy, error copy, busy state |
| `client/src/session/MergeSuggestions.tsx` (+ test) | One banner per undismissed pair |
| `client/src/session/SourceThumbnail.tsx` (+ test) | First page of an image or PDF source, with a fallback card |
| `client/src/session/dismissedSuggestions.ts` (+ test) | Tab-lifetime dismissals through `useSyncExternalStore` (D6) |
| `client/src/i18n/mergeErrors.test.ts` | hr/en copy for every merge error code plus `network` |
| `.agents/history/11-merge-payslips.md` | This record |

| Modified file | Change |
| --- | --- |
| `api/package.json`, `package-lock.json` | `pdf-lib` → `@cantoo/pdf-lib` 2.11.1; `heic-convert` 2.1.0, `exifr` 7.1.3, `@types/heic-convert` 2.1.1 |
| `api/src/upload/source-file.ts` (+ test), `routes/extraction.integration.ts` | Import from the fork; one stale "pdf-lib cannot decrypt" comment corrected |
| `api/src/routes/sessions.ts` | `POST /:id/merge`; `mergeSuggestions` on `GET /:id` |
| `api/src/repositories/payslips.ts` | `merge()` over the RPC |
| `api/src/database.types.ts` | The `merge_payslips` function type only |
| `api/src/routes/payslips.integration.ts` | Ten merge cases; one stale "pdf-lib cannot encrypt" comment corrected |
| `shared/src/session.ts` (+ test) | `isMergeable`, `MergeCandidate`, `mergeSuggestions` |
| `shared/src/api.ts` (+ test), `shared/src/index.ts` | `mergeSuggestions` with a `[]` default; `MERGE_ERROR_CODES` |
| `client/src/routes/SessionPage.tsx` (+ test) | Banners, action menu, dialog, post-merge selection and edit discard; `isSettled` delegates to `isMergeable` |
| `client/src/api/client.ts` (+ test) | `mergePayslips` |
| `client/src/review/PageNavigator.tsx` | `PageThumbnail` exported with a `width` (default 64) |
| `client/src/components/ActionMenu.tsx` | Trigger and items 44 → 48 px (deviation 6) |
| `client/src/review/SourceDocumentPanel.tsx` | Baseline flake fixed (deviation 1) |
| `client/src/i18n/locales/{en,hr}.json` | New `merge` block |
| `PRD.md`, `.agents/ROADMAP.md`, `CONTEXT.md` | §7.8, §8, §10.4, §10.11, Phase 4 status; Task 11 row, D-list, §5 fork risk; *Merge suggestion* |
| `.claude/commands/validate.md` (git-ignored) | Phase 4 rows, 6.24 merge check, 6.25 one PDF library, Phase 8 merge paragraph, journey 9.10, Phase 10 row removed |

## Decisions

Implemented plan D1–D14 as written, except for the deviations below. The main points:

- The route's checks are fast refusals that download nothing. `merge_payslips` is the authority:
  a concurrent second merge waits on the row lock, finds the originals deleted, returns `false`,
  removes the PDF it stored, and answers `409`.
- The merged row takes the earlier original's `created_at`, so it keeps that position. It cannot
  be reaped as stale at once, because the reaper keys on `updated_at`, which defaults to `now()`.
- The originals' sources are kept, like any soft delete, so an un-merge remains possible later.

## Deviations and implementation findings

1. **Baseline flake fixed first.** Step 1's `npm run validate` failed one test,
   `SourceDocumentPanel … measures a never-opened image`. It passed on its own and in three more
   full runs, so it failed about 1 run in 5. Cause: `ImageSource` reset its ratio to `pending` in a
   passive `[url]` effect. When an image's `load` was handled before that effect flushed, the effect
   discarded the measurement. Every image test in the file had this race. The ratio is now stored
   with the URL it measured and reads `pending` for any other URL in the same render, so no reset
   effect exists. After the fix: six consecutive full runs green.
2. **Combined size cap added, as `422 file_too_large`.** D4 capped pages only. Each source may be
   up to 10 MB (`MAX_UPLOAD_BYTES`), and the storage bucket refuses objects over 12 MB, so two large
   PDFs would have failed as a 500 at storage. The route now refuses a combined PDF over
   `MAX_UPLOAD_BYTES` before storing anything, reusing the upload code. `MERGE_ERROR_CODES` has four
   codes, not three. This was raised during priming, before execution.
3. **Cross-user RPC case placed in `payslips.integration.ts`**, not `direct-writes.integration.ts`.
   That file has one user and no mergeable pair. Here user B calls `merge_payslips` through its own
   token with user A's session and ids, gets `false`, and A's rows stay live.
4. **Optimistic post-merge state.** Selecting the new id before the next read lists it left
   `selected === null`, and the arrival effect would then replace the URL with the first payslip,
   possibly a deleted original. Like retry, the page now swaps the originals for a `processing`
   placeholder at the earlier one's position at once; the refresh replaces it.
5. **`onMerged` receives the originals in page order**, so the placeholder's name matches the
   server's. The handler otherwise treats them as a set. Instead of the plan's `discardedIds`
   state, a `lastMerge` effect clears both originals' unsaved edits and then focuses the merged
   payslip's tab. The dialog's opener may no longer exist, and focus would otherwise drop to the
   body. A test proves the ordering: the closing review's `keep(id, edits)` lands first, then
   `keep(id, null)`.
6. **`ActionMenu` touch targets 44 → 48 px.** It had no user before this task. Journey 9.10 and
   Task 08 D12 require at least 48 px on controls a task touches.
7. **`SourceThumbnail` takes no `label`.** Its card already names the payslip and file. An image
   with `alt=""` and an `aria-label` would contradict itself.
8. **Pages, not a page.** A multi-page source's card reads "Pages 2–3", not "Page 2". Added
   `merge.pageRange`.
9. **`MergeDialog` is keyed per opening** by the page, so its state starts from props, with no
   reset effect or suppressed lint rule. It stays mounted while closed, so `close()` still returns
   focus to its opener.
10. **Tab order in journey 9.10.** The plan's "Cancel → Swap → Merge" does not match the DOM order,
    Swap → Cancel → Merge, with focus starting on Cancel. The journey text now says that.
11. **Step 13's expected page count was wrong.** `A02.heic + A01.pdf` is 3 pages, not 4: A01 has
    two.
12. **Lint:** five findings fixed. Three `consistent-function-scoping` helpers moved to module
    scope, one `no-shadow` rename, and one `toSorted`. Also a test-typecheck fix: explicit
    `Buffer[]`, and a typed never-resolving promise.
13. **Test metadata.** The first integration run gave 500s. The merge tests' pass payloads had
    `metadata: {}`, which the read-side `passMetadataSchema` rejects: `unreadableFields` is required.
    The fix was in the test helper. The route was not at fault. That failed run's rows and sources
    were cleaned by the suite's `afterAll`, and a storage orphan query returned 0.

## Validation

| Check | Result |
| --- | --- |
| Baseline `npm run validate` | 63 files; **1 flaky failure** out of 924 (deviation 1) |
| `npx vitest run api/src/upload` after the library swap | 24 passed: the D1 regression check, unchanged tests |
| Migration dry run (`begin; …; rollback;`) | Applied, then `to_regprocedure` null after rollback |
| `apply_migration merge_payslips` | Recorded once as `20260926140159`; local file renamed to match |
| `get_advisors` (security) | Only `authenticated_security_definer_function_executable` (WARN, now 9 functions including `merge_payslips`, expected by design) and `auth_leaked_password_protection`. No errors |
| Types | Regenerated; only the `merge_payslips` entry added to `Functions` |
| `npm run test:integration` (hosted, $0) | **auth 3, payslips 55 (+10), direct writes 4**; run again after lint edits, same result |
| Orphan query | No `task…` users; 0 orphaned storage objects (17 objects, all owned by live users) |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **69 files / 999 tests**: +6 files, +75 tests |
| Repeated full `npx vitest run` | 5 × 999 passed (flake check) |
| `npm run build` | Passed; existing chunk-size advisory only |
| `git grep 'from "pdf-lib"'`, `'"pdf-lib"'` in `package.json` files | No matches |
| `react-router-dom` in `client/src` | No matches |
| New 6.24 `merge_payslips` ownership check | ok |
| `git diff --check` | Passed |

### Step 13 probes (local, real samples, $0)

A scratchpad script combined real samples with the production `combineSources` and read the result
with pdf-lib and pdf.js. It was not committed.

| Probe | Result |
| --- | --- |
| `B01.pdf + A02.jpg` | 2 pages; page 1's pdf.js text starts "OBRAČUN ISPLAĆENE PLAĆE Obrazac IP1": **decrypted** |
| `A02.heic + A01.pdf` | 3 pages; page 1 is 378.78 × 842 pt, ratio 0.4499 = 1220:2712 |
| `A02-exif6.jpg` | Page drawn 842 × 378.8 with `/Rotate 90`; pdf.js viewport **379 × 842, portrait** |
| `A03-rotate90.pdf + G01.png` | Page 1 keeps rotation 90 (viewport 842 × 595, as the original) |
| `A01.pdf + E01.pdf` | 3 pages; plain PDFs load without the password option (D1) |

## Open items

1. **Forked PDF library.** `@cantoo/pdf-lib` is now under both upload validation and merge; its
   maintenance is a watched risk (ROADMAP §5).
2. **Mirrored EXIF orientations (2, 4, 5, 7) are not handled.** Phone cameras do not write them.
   They stay as drawn.
3. **Three pages of one payslip give three suggestion pairs.** After one merge, the re-extracted
   payslip pairs with the third. This is by design (D5) but noisy.
4. **The dialog's modality, focus return and 375 px fit** are browser-only (jsdom has no modal
   dialog). Journey 9.10.
5. **The merged payslip's placeholder** shows until the next read, normally within one request.
6. **Integration test time.** The full-session case uploads ten PNGs; the suite now takes about
   25 s.

## Review-session handoff

- Run journey **9.10** under plan 11 D13's budget: at most three analyses, about $0.15, with a
  throwaway account. Log the cost here.
- Read the new `merge.*` copy in `hr` and `en` with the product owner, especially the consequence
  sentence, the suggestion banner, and "Ne sada".
- Run `/code-review` and `/validate` in the separate review session.
- The migration is already applied to the hosted project. The API that calls it is not deployed.
  `merge_payslips` is additive, so the deployed app is unaffected.
- Nothing has been committed or deployed. `.agents/plans/11-merge-payslips.md` is still untracked.

## Review session (2026-09-26)

`/code-review` ran separate Standards and Spec agents over the uncommitted diff against `f32836b`.
`/validate` ran in full, followed by journey 9.10 in Chromium through `agent-browser`.

### Findings and outcome

| # | Axis | Finding | Outcome |
| --- | --- | --- | --- |
| 1 | Spec | D11 says "on `409` also bump `refreshKey`, so the list shows why". `MergeDialog` showed the error but could not tell the page, and polling has usually stopped by then, so the rail stayed stale | **Fixed.** `onRefused` prop, called only for a `409`; `SessionPage` bumps `refreshKey`. Tests in `MergeDialog.test.tsx` and `SessionPage.test.tsx`. In the browser, the other payslip was soft-deleted behind an open confirm step: Merge showed the refusal and the rail dropped to one payslip |
| 2 | Standards / Spec | The client placeholder's name repeated `mergedFilename` without its 255-character cap | **Fixed.** `mergedFilename` moved to `shared/src/session.ts`, used by the route and the placeholder; its tests moved to `session.test.ts` |
| 3 | Spec | Deviation 2's `422 file_too_large` and the route's `422 merge_source_unreadable` had no test | **Fixed.** Two hosted integration cases: two 5.8 MB PDFs, each under the cap, are refused together; a header-only JPEG uploads and is refused at merge. Both leave the originals live |
| 4 | Spec | "An EXIF block exifr cannot parse becomes `422`" | **Not a defect.** Probed: `exifr.orientation` returned `undefined` for a bad IFD offset, a bad byte order and a truncated APP1, and never threw |
| 5 | Spec | Journey 9.10 step 1 used `E01.pdf`, which has one page | **Fixed** in `validate.md`: A01, the two-page sample |
| 6 | Spec | PRD Phase 4's status note split its bullet list | **Fixed**, moved after the list |
| 7 | Spec | `file_too_large` is `413` on upload and `422` on merge | **Kept, on purpose.** On upload the request body is too large; on merge the request is small and the file it would produce is too large, which is `422` (PRD §10.11 already says so). The client shows one copy for the code either way |
| 8 | Spec | The Swap button has visible text rather than D11's `aria-label` | **Kept.** Visible text gives the accessible name and is better for sighted users too |
| 9 | Standards | `merge_payslips` trusts `p_new_id`, `p_page_count` and `p_original_filename` from a direct RPC | **Kept, noted.** A direct caller can only replace two of their own payslips with a `processing` row that has no source, which the stale reaper then fails. That matches the §5 residual on the other definer functions |
| 10 | Standards | Smells: `isSettled` is now only a wrapper around `isMergeable`; `[string, string]` recurs as the pair type; `request` names the parsed body; the upload route still inlines the orphan-cleanup `try` that `removeOrphan` extracts; the user copy says "combined" where CONTEXT prefers "merge" | **Not changed.** Judgement calls with no behaviour behind them, left for the product owner. The copy is still to be read with them (below) |

Hard standards violations: none. The migration matches the Task 09 definer pattern (`search_path`,
`auth.uid()` on every statement, `revoke … from public, anon`).

### Validation

| Check | Result |
| --- | --- |
| Phases 0–3: install, oxlint, typecheck, Prettier | Pass |
| Phase 4: `npm test` | 69 files, **1000 tests** after the fixes (999 before); shared 293, api 346, client 360 before the fixes |
| Phase 5: build | Pass; existing chunk-size advisory only |
| Phase 6: 6.1–6.25 | All pass (6.24: 7 + 1 functions; 6.25: no `pdf-lib` import) |
| Phase 7 | Golden set passes; `score -- cu` 281/284 (98.9%); `score:extraction` 270/273 scalars, 502/548 cells; analyzer drift check matches both analyzers |
| Phase 8: `npm run test:integration` (hosted) | auth 3, **payslips 57** (+2), direct writes 4 |
| Phase 8.1 | `list_migrations` matches the seven local files; advisors: lint 0029 on the 9 definer functions (by design) and `auth_leaked_password_protection` only |
| 9.2–9.4 | Health through the proxy, `not_found`, 401 on both prefixes, sign-up, redirect |
| Orphans after cleanup | No `task…` users, 0 orphan payslips, 0 orphaned objects (17 in storage, as before) |

### Journey 9.10 (throwaway account, 2026-09-26)

A01.pdf split into `A01-p1.pdf` and `A01-p2.pdf` locally.

1. Both uploaded and settled. The banner read "Payslips 1 and 2 look like pages of one payslip."
   Both buttons are 48 px. Not now hid it, and it stayed hidden after leaving and returning.
2. The ⋮ menu (48 × 48) → "Merge with another payslip…" → a modal (`:modal`) pick step → Continue.
   Both thumbnails rendered (pdf.js canvases). Focus started on Cancel, in DOM order Swap order →
   Cancel → Merge, all 48 px. The consequence sentence was shown.
3. Swap reordered the cards, announcing "Order swapped. Payslip 2 is now first."; a second swap
   restored the order. Escape closed the dialog and returned focus to ⋮.
4. An unsaved IBAN edit showed the "Unsaved changes" mark. After Merge: the URL held the merged id,
   the rail showed one payslip, "A01-p1.pdf + A01-p2.pdf", reading, with focus on its tab and no
   unsaved mark. Back went to the previous page, not a dead id. Reload gave no prompt.
5. Once ready, the page rail had pages 1 and 2. `iznosZaIsplatu`, missing when page 1 was read
   alone, read 1772.15 from page 2. Focusing it moved the rail to page 2 and outlined it there. The
   form matched the A01 fixture on the values checked: `brutoPlaca` 3292.14, `iznosZaIsplatu`,
   18 obustave rows and 23 pay components.
6. At 375 px, in `en` and `hr`: no horizontal scroll, the dialog within the viewport (683 of 812 px
   tall at the confirm step), no button under 48 px, and every string translated. The second
   mergeable payslip for this step was a `failed` row added with the admin key, backed by a copy of
   the merged source, so it cost nothing.
7. The account, its 4 rows and 4 storage objects were deleted, and the orphan query returned zero.

**Paid runs: 3 two-pass analyses** (the two halves plus the merged payslip), estimated
**$0.14–0.15** from Task 05's $0.045–0.051 per document. That is within plan 11 D13's budget.

### Still open

- Read the `merge.*` copy in `hr` and `en` with the product owner (unchanged handoff item).
- Mirrored EXIF orientations, and three suggestion pairs for a three-page payslip (open items 2–3).
- Nothing committed or deployed. The migration was already applied to the hosted project.
