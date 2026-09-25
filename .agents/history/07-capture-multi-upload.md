# 07 — Capture & multi-upload UI

**Date:** 2026-09-25
**Plan:** [`plans/07-capture-multi-upload.md`](../plans/07-capture-multi-upload.md)
**Outcome:** the app's first real screens. A signed-in user can:

- collect up to ten payslips in a tray, by camera (one photo per press) or by choosing files;
- send them as one Session, uploaded one at a time in tray order;
- land on `/sessions/:sessionId` at the first `201`, while the rest keep uploading;
- watch each payslip's status, tables status and failure reason there;
- retry a retryable failure.

The backend gained `POST /api/payslips/:id/retry` (PRD §10.8) and `originalFilename` on the session
summary.

**Status: implemented, reviewed and validated (review session, 2026-09-25); M3 pending.** The
implementing session made no paid Azure run ($0). The review session's findings, fixes, validation
and browser journey are recorded under "Review session" at the end; it spent about **$0.29**.

## What was built

| File | Contents |
| --- | --- |
| `shared/src/api.ts` | `originalFilename` on `payslipSummarySchema` (D9) |
| `api/src/repositories/payslips.ts` | `PayslipState.originalFilename`; `beginRetry`, the one conditional reset (D8) |
| `api/src/routes/payslips.ts` | `POST /:id/retry` in D8's five steps; the router takes the `ExtractionRunner` |
| `api/src/routes/sessions.ts`, `app.ts` | the summary's `originalFilename`; one runner shared by both routers |
| `client/src/api/client.ts` | `createSession`, `uploadPayslip`, `getSessionDetail`, `retryPayslip` |
| `client/src/upload/UploadBatchContext.ts` | `BatchItem`, `StartBatchResult`, the context |
| `client/src/upload/UploadBatchProvider.tsx` | refresh (D5), sequential upload, first-`201` resolution, 401 stop (D3), `beforeunload` (D6), timing log (D12) |
| `client/src/upload/useUploadBatch.ts` | the hook, throwing outside the provider |
| `client/src/routes/HomePage.tsx` | the tray, pickers, cap (D1, D4), HEIC fallback (D10), upload button |
| `client/src/routes/SessionPage.tsx` | polling without a client timeout (D7), merged batch rows, retry (D2) |
| `client/src/App.tsx` | `ProtectedRoute` → `UploadBatchProvider` → `/`, `sessions/:sessionId`, `*` |
| `client/src/i18n/locales/*.json` | `capture.*`, `session.*`, `payslipStatus.*`, `tablesStatus.*`, `failureReason.*` |
| `PRD.md` | §7.2 the tray and HEIC; §7.3 refresh and sequential upload; §10.4 `originalFilename`; §10.8 the full reset |
| `.agents/ROADMAP.md` | Task 07 scope and DoD (HEIC reworded); §5 token row mitigated, direct-write row notes retry |

New tests:

- `UploadBatchProvider.test.tsx` (9);
- `HomePage.test.tsx`, rewritten (10);
- `SessionPage.test.tsx` (10);
- `statusCopy.test.ts` (6).

Extended tests:

- `client.test.ts` (+3);
- `payslips.test.ts` (+3);
- `api.test.ts` (the summary requires `originalFilename`);
- the hosted `payslips.integration.ts` (+6, and retry in the cross-user 404 case).

Fixture: `payslip_examples/A02.heic` was created from `A02.jpg` with `pillow-heif`, installed
per-user and outside any manifest. `file-type` sniffs it as `image/heic`. It is git-ignored personal
data and is not committed.

## Design decisions carried

D1–D14 as the plan states them.

Two points raised at priming were not answered before execution, so the plan was followed as
written:

- **Hit-box size.** New controls use `min-h-11` (44 px), matching the rest of the client, while PRD
  §11.5 says 48 px. See open item 1.
- **Clean start.** The plan's own file was the one untracked change at the start. That was treated
  as the expected exception to step 1's "clean `git status`".

## Deviations from the plan

1. **A third file, `UploadBatchContext.ts`**, holds the context object and types, as
   `auth/AuthContext.ts` does. It keeps the provider's `.tsx` exporting only a component, and lets
   the capture page import `BatchErrorCode` without importing the provider.
2. **An uploaded batch item stays visible until the session read lists it.** D7 says an `uploaded`
   item is not rendered, because its server row represents it. Between the `201` and the next
   read, though, there is no server row, and the item would vanish for up to one fetch. It is now
   hidden only once its `payslipId` is in the server list. Until then it shows "Reading the
   payslip". The "appears only once" test still holds.
3. **`session.progress` counts in-flight items in its total.** `total` is the server payslips plus
   the batch items still `waiting` or `uploading`. Rejected items are not counted, since they will
   never become payslips. "2 of 4" therefore does not jump to "2 of 5" as the last upload lands.
4. **Six hosted retry cases, not seven.** "Soft-deleted → 404" and "malformed id → 400" share one
   test. The suite is **33** payslip cases, not the plan's expected 34, and every listed case is
   asserted.
5. **Hosted case 2 exercises the fast path, not the race.** A second retry, immediately after the
   first, is refused by the `findDetailState` pre-check, because the row is already `processing`.
   The race itself (two requests passing the pre-check, one matching the conditional update) is
   covered by the repository unit test, which asserts the `status = 'failed'` and `failure_reason
   in (…)` filters and that a null result is a refusal. No hosted test drives two truly
   concurrent retries.
6. **The rejected item's upload-page reason clears on the next upload attempt.** D3 keeps the tray
   after an all-rejected batch. Pressing upload again re-sends every tray item, including a
   still-present rejected one, so its old reason is cleared first. Removing bad items stays the
   user's choice.
7. **The shared test name changed** from "requires %s, even when null" to "requires %s", because
   `originalFilename` joined the list and is never null.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` (baseline) | green, 43 files, 632 tests |
| `npm run validate` (final) | green: typecheck, oxlint, Prettier, **46 files, 679 tests** |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run test:integration` | hosted: 3/3 auth + **33/33** payslips (27 before) |
| Orphans (`execute_sql`) | 0 `task0%` users; 0 payslips, sessions or Storage objects without an owner |
| Lockfile | `git diff --stat package-lock.json` empty: no new dependency |
| `grep react-router-dom client/src` | empty |
| Hardcoded-string grep on `HomePage.tsx`, `SessionPage.tsx` | no hits |

Not run in this session, by the session split:

- `/code-review`;
- `/validate`;
- any browser journey;
- `npm run test:extraction`, which is paid.

## Paid Azure runs

None. **$0** in this session (D13). The review session has a budget of about 20 documents (~$1).

## Open items for later tasks

1. **Hit-box size: settled in review.** The product owner chose PRD §11.5's 48 px for Task 07's
   controls, and left the inherited 44 px controls (auth forms, account and action menus) to be
   raised by whichever task next touches them. Every Task 07 control now measures at least 48 px.
   ROADMAP M3's "44 px controls" wording predates the decision.
2. **Empty session after an all-rejected batch (D3).** The session row is created before any upload
   and is left behind when none succeeds. It is invisible (no history UI yet) and costs one row.
3. **Retry and the direct-write gap (D8), for Task 09.** Retry is one more server write to
   `status`, `tables_status`, `canonical_data`, `extraction_metadata`, `raw_provider_result` and
   `edited_fields`, through the user's own `update` grant. Task 09's `revoke update` must keep it
   working, via a `security invoker` function or by granting the same columns (ROADMAP §5 updated).
4. **A still-running old pass after a retry: accepted.**
   - Retry resets `tables_status` to `pending`. If a reaped payslip's old tables pass were somehow
     still alive, it could write into the new attempt.
   - That needs a pass to outlive the 15-minute reaper, while each pass runs under
     `EXTRACTION_TIMEOUT_MS` (120 s by default). So nothing guards against it.
5. **M3 pending:** real-phone capture journey (camera denial, retake, rotation, one-handed reach),
   run and recorded here by the product owner.
6. **Leftover receipt copy.** `review.fields` in both locales still holds receipt field labels
   (`sellerName`, `buyerOib`, `issueDate`, `subtotal`, …). They are pre-existing dead copy that
   Task 09 should replace; left untouched here.
7. **Croatian plural copy** (`capture.overCap_*`, `capture.upload_*`) follows the plan's table. The
   product owner reads it in the review session.

## Handoff to the review session

Do these in the review session, not the implementing one:

1. **Browser journey** on the dev server with the D13 batch: `A02.heic`, `A01.pdf` (two pages),
   `G01.png` and `B02.jpg`, one run of 4 documents (~$0.20). Check:
   - the console's `[upload] first payslip created { ms }` shows under 3 s;
   - the session page is reached before extraction completes;
   - four independent extractions complete;
   - the HEIC shows a file card on Chrome and a preview on Safari;
   - log the cost here.
2. **Busy state:** the pressed upload button keeps focus with `aria-disabled="true"`, and the
   visually hidden status announces "Uploading your payslips."
3. **A real retry:** fail one payslip with SQL (`status='failed'`,
   `failure_reason='provider_unavailable'`), press retry, and watch it re-extract (1 document).
4. **Layout and copy:** 375 px width with no horizontal scroll; hr and en copy read through,
   including the plurals.
5. Then `/code-review` and `/validate`. Committing waits for the product owner's go-ahead.

## Review session (2026-09-25)

Run in a separate session, as the project's session split requires: `/code-review` (standards and
spec, as two parallel reviewers), then fixes, then `/validate` including the paid browser journey.

### Findings and what was done

| # | Finding | Axis | Outcome |
| --- | --- | --- | --- |
| 1 | Task 07's links, retry, dismiss and remove controls were 44 px against PRD §11.5's 48 px | standards | **Fixed**: `min-h-12`/`min-w-12`, per the product owner's decision (open item 1) |
| 2 | A failed retry POST showed `session.loadError`, "The session could not be loaded", under the payslip | standards | **Fixed**: new `session.retryError` in en and hr |
| 3 | After a successful retry the button unmounts and keyboard focus fell to the page body | standards | **Fixed**: the row is focusable (`tabIndex=-1`) and receives focus. Verified in the browser |
| 4 | File sizes formatted with the browser's locale, not the UI language ("1.5 MB" on a Croatian page) | standards | **Fixed**: `Intl.NumberFormat(i18n.resolvedLanguage)`. Verified: "0,1 MB" |
| 5 | A file still being prepared when the capture page unmounts created an object URL nothing revoked | spec | **Fixed**: an `unmounted` ref stops `prepare` before it creates the URL |
| 6 | The retry's 409 and other-error branches were untested | spec | **Fixed**: two tests, plus focus and locale tests (**+4**, 683 in all) |
| 7 | CONTEXT.md lists "Batch" as a term to avoid for Session, and the client says `UploadBatch…` | standards | **Kept**, per the product owner: CONTEXT.md gains an **Upload batch** entry that separates the client's transient send state from the Session |
| 8 | A downscaled `G01.png` is stored and listed as `G01.jpg` (the rename is in `downscale.ts`, unchanged since the fork) | spec | **Left as is**: the stored bytes are JPEG, and the signed source URL serves them under that name. The tray shows the chosen name; the session page shows the stored one |
| 9 | The preparation chain has no `catch`, so a rejecting `prepare` would stall the tray | spec | **Left**: nothing in `prepare` can reject (`analyzeSourceImage` is caught; `downscaleSourceImage` never throws) |
| 10 | Leaving `/` before the first `201` still navigates to the session when it lands | spec | **Left**: that is where the user's files went |
| 11 | Duplicated error-code-to-copy mapping and the "unsent" predicate; a nested ternary beside `batchIcon`'s switch; `HomePage.tsx` doing several jobs | standards (smells) | **Left**: judgement calls. Tasks 09 and 10 replace the session page in place |

Also found by `/validate` rather than the reviewers:

- **Check 6.5 did not understand plural keys.** It flagged `capture.overCap` and `capture.upload`,
  the project's first i18next plural keys, which resolve at runtime through their `_one`/`_few`/
  `_other` forms. The check now accepts a key when any CLDR-suffixed form exists, and says why.
- **`validate.md` had not been extended by the implementing session**, as its "Maintaining this file"
  section requires. Added: Phase 4 rows for `HomePage`, `SessionPage`, `UploadBatchProvider`,
  `statusCopy` and `beginRetry`; the retry cases in Phase 8; journey **9.6** for Task 07; and the
  Task 07 row deleted from Phase 10.

### Validation

| Phase | Result |
| --- | --- |
| 0 `npm install` | clean, no overrides |
| 1–3 lint, typecheck, format | oxlint 0 errors, `tsc --build` exit 0, Prettier clean |
| 4 unit tests | **46 files, 683 tests** (shared 264, api 267, client 152) |
| 5 build | green; the known Vite chunk-size advisory |
| 6 security and configuration | all pass (6.5 after the plural fix above) |
| 7 golden set and harness | `check:golden` all pass; `score -- cu` **281/284 (98.9%)**; `score:extraction` exit 0 and unchanged from Task 05 (R3's 268 is the accepted run-to-run case); both two-pass analyzers match the code |
| 8 hosted integration | host `hxksulbgluvfxfoxrhse`: **3/3** auth, **33/33** payslips |
| 8.1 hosted schema | four migrations, matching `supabase/migrations/`; security advisor shows only the known `auth_leaked_password_protection` |
| 9.2–9.4 API journeys | health direct and through the Vite proxy; `404 not_found`; `401 unauthorized` on both prefixes |
| 9.6 Task 07 journey | below |

### Browser journey (agent-browser, Chromium, dev server)

1. **Desktop, 1440 px:** Choose files only, as the primary action.
2. **Tray:** `A02.heic`, `A01.pdf` (2 pages), `G01.png`, `B02.jpg`.
   - The HEIC shows a file card with the preview-unavailable note, and the console logs the
     expected warning. Chromium cannot decode HEIC.
   - `B02.jpg` was downscaled from 3.4 MB to 0.3 MB; `G01.png` was re-encoded to 0.2 MB.
3. **Busy state:**
   - The pressed button kept focus with `aria-disabled="true"` and the text "Uploading…".
   - The visually hidden `role="status"` read "Uploading your payslips."
4. **Time to the review route:** the console logged `[upload] first payslip created {ms: 2273}`,
   under the 3 s target. The URL became `/sessions/<id>` about 2.3 s after the press, with
   "0 of 4 ready to review", before any extraction finished.
5. **Four independent extractions:** eight passes, every one `submitAttempts: 1`, with no error.
   - Scalars: 8.3–9.4 s.
   - Tables: 6.1–23.8 s.
   - The HEIC extracted with employee name and period, so the service decodes it (D10).
   - `A01.pdf` is stored with `page_count` 2.
   - G01's row has no name or period, which matches its ground truth (cropped screenshot).
6. **Retry:**
   - `B02` was set to `failed` / `provider_unavailable` with SQL, and "Try again" pressed with
     Enter.
   - Focus moved to its row. The row reset to "Reading the payslip" with its old data cleared.
   - It re-extracted to "Ready to review" and "Line items ready" in about 15 s.
7. **Session page at 375 px:**
   - en and hr: `scrollWidth` 360 against a 375 viewport, so no horizontal scroll.
   - No control under 48 px.
8. **Capture page at 375 px, touch emulated over CDP** (agent-browser's device preset does not
   make `(pointer: coarse)` match):
   - The pickers:
     - **Skeniraj platnu listu**: 56 px, `capture="environment"`, no `multiple`.
     - **Odaberi datoteku**: 48 px, `multiple`.
   - Twelve files: ten kept, and the notice "2 datoteke nisu dodane: jedna sesija može imati najviše
     10 platnih lista."
   - Both pickers `aria-disabled` with the cap as their description, never `disabled`.
   - No overflow; no control under 48 px.
9. **Cleanup:** the throwaway user and its four Storage objects were deleted. Zero `task%` users,
   and zero payslips, sessions or objects without an owner.

**Not covered by this run:**

- The HEIC preview on Safari. Chromium has no HEIC decoder, and the app's own file card is what
  Chrome and Android users get.
- A real phone's camera. That is M3.

### Paid Azure runs

| Run | Documents | Estimated cost |
| --- | --- | --- |
| Four-document batch (A02.heic, A01.pdf ×2 pages, G01, B02), two passes each | 4 | $0.2475 |
| Retry of B02 | 1 | ~$0.04 |
| **Total** | **5** | **~$0.29** |

Estimated from each stored response's `usage`, at `usage.ts`'s list prices ($5 per 1,000 pages,
$1 per M contextualization tokens, `gpt-4.1` $2 / $0.50 / $8 per M input / cached input / output).
Per document: A02 $0.065, A01 $0.108 (two pages), G01 $0.036, B02 $0.040.

### Left for the product owner

1. **M3**, the real-phone capture journey (camera denial, retake, rotation, one-handed reach).
2. **Copy, two changes, applied at the product owner's request:**
   - `payslipStatus.failed` was "Could not be read" / "Nije očitano", which misstated a
     `provider_unavailable` failure where the document was never read. It is now "Failed" /
     "Nije uspjelo"; the reason line beneath it says why.
   - `capture.uploadingStatus` in hr: "Vaše se platne liste šalju." (the clitic in second place).
3. Committed and pushed on the product owner's go-ahead.
