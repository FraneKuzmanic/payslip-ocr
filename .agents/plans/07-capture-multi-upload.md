# Feature: Task 07 — Capture & multi-upload UI

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 07](../ROADMAP.md) and §5 ("Background writes use the
upload's token", "In-memory extraction queue") · **PRD:** §4.1, §6.6, §7.2, §7.3, §7.13, §10.3,
§10.4, §10.8, §11.4, §11.5 · **Previous tasks:** [`history/06`](../history/06-warnings-validation-engine.md),
[`history/05`](../history/05-extraction-latency-two-pass.md) (open items 3 and 9) ·
**Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md)
(this project has no `CLAUDE.md`) · **Prior art (sibling, forked from):**
`../receipt-ocr/client/src/routes/HomePage.tsx`, `ProcessingPage.tsx`,
`../receipt-ocr/api/src/routes/receipts.ts` (retry route, lines 240–272)

## Feature Description

The first real screens of the app. A signed-in user on a phone photographs payslips one at a time
(or picks files; several at once on desktop), sees each one in a **tray** with its preview and any
blur/resolution advice, and sends up to ten as one Session. The app creates the Session, uploads
the files one by one in the order chosen, and **navigates to the session page as soon as the first
Payslip exists**. The remaining uploads continue in the background. The session page lists every
payslip with its live status, the reason for any failure, and a **retry** for a retryable failure.

Backend work: `POST /api/payslips/:id/retry` (PRD §10.8), which nothing has built yet, and
`originalFilename` on the session summary, so a row can be identified before extraction has read a
name.

## User Story

As someone holding a stack of paper payslips
I want to photograph or choose several of them and send them in one go
So that they are all extracted while I start looking at the first one (PRD US-01, US-02)

## Problem Statement

- `client/src/routes/HomePage.tsx` is a stub. There is no way to upload anything from the UI.
- The capture modules (`client/src/capture/`) are forked from receipt-ocr and unused.
- No route exists to land on after upload. The review form (Task 09) and the chip rail (Task 10)
  are later tasks.
- A failed payslip cannot be retried: PRD §10.8 has a DTO (`retryPayslipResponseSchema`) but no
  route.
- The session summary (§10.4) carries no filename. A payslip still `processing` or `failed` has no
  `employeeName` or `period`, so its row would be unidentifiable.

## Solution Statement

- **Capture page (`/`)**: a tray of selected files, each with its own preview built from the exact
  bytes that will upload. Adding stops at ten, with an explanation. One upload button sends the
  batch (D1, D4).
- **Upload batch context** above the routes: it refreshes the auth session, creates the Session,
  and POSTs the files **sequentially in tray order**. It resolves the capture page's wait at the
  first `201`, and keeps going after navigation. It holds a `beforeunload` guard while files are
  unsent (D3, D5, D6).
- **Session page (`/sessions/:sessionId`)**: polls `GET /api/sessions/:id` every 2 s until every
  payslip is settled. It merges in the batch's not-yet-uploaded and rejected files, and offers retry
  on a retryable failure. Tasks 09 and 10 later replace its body and keep the URL (D2, D7).
- **Retry route**: a conditional **full reset** to a fresh extraction, then re-enqueue with bytes
  downloaded from Storage (D8).
- **No new dependency.** The lockfile must not change.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High (first real UI, a cross-route background upload, a new API route
with hosted tests)
**Primary Systems Affected**:
- client: routes, the new `upload/` context, `api/client.ts`, locales
- api: the payslips router, the repository, the app wiring
- shared: `payslipSummarySchema`
- docs: PRD, ROADMAP
**Dependencies**: none new.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-25 in the planning session. Do not reopen them without
new evidence.

### D1 — Tray, then upload (product owner)

- Each **Skeniraj platnu listu** press opens the camera once and adds one photo to the tray. The
  camera input has no `multiple`: `capture` opens a single-shot camera on iOS and Android, and
  `multiple` there is ignored or unreliable.
- **Odaberi datoteku** is permanently visible and carries `multiple`. On desktop it is the only
  picker and is promoted to the primary style. This is receipt-ocr's rule, kept via
  `useCameraCapture()`.
- Each tray item shows its preview, name, size, any quality advice (never blocking, PRD §7.2) and
  a **remove** button whose accessible name includes the file name.
- One button, **"Pošalji N platnih lista" / "Upload N payslips"** (pluralised), starts the batch.
- Files are processed into the tray **one at a time** (analyse, then downscale). Decoding ten 12 MP
  photos at once can exhaust a phone's memory. Items still being processed show a spinner, and the
  upload button is `aria-disabled` until the tray settles.

### D2 — A minimal session page is the landing route (product owner)

- The route is `/sessions/:sessionId`, a protected route. It is **not** in `NAV_ITEMS` (there is no
  "sessions" destination before Task 12's history).
- It shows a heading, a progress summary in a polite `role="status"` region
  ("2 od 4 spremno za pregled"), and one row per payslip in upload order. Each row has:
  - a position label ("Platna lista 1");
  - `originalFilename`;
  - `employeeName · period` when present;
  - a status label with an icon, never colour alone (PRD §11.5);
  - the tables status while in `review`;
  - the failure reason text when `failed`;
  - a retry button for a retryable failure.
- A "Skeniraj još platnih lista" link goes to `/`, which starts a **new** session. Adding to an
  existing session was offered and not chosen: out of scope.
- It is deliberately plain. Task 10 replaces the list with the chip rail, and Task 09 adds the form
  beside it. Build nothing for them now.

### D3 — Sequential upload, from a context above the routes (product owner)

- Navigating unmounts the capture page, so the batch lives in `UploadBatchProvider`, a layout route
  inside `ProtectedRoute`. It wraps both `/` and `/sessions/:sessionId`.
- Files are POSTed **one at a time, in tray order**. Server `created_at` order is then selection
  order, and `listBySession` returns upload order, which Task 11's merge dialog relies on.
- Parallel POSTs were rejected: they reorder the session, and only the first upload is on the
  critical path to the <3 s target anyway.
- `startBatch(files)` resolves with `{ sessionId }` at the **first `201`**. The capture page then
  navigates. Remaining files keep uploading.
- **If every file is rejected** (or session creation fails), `startBatch` resolves with the errors.
  The capture page stays, marks each tray item with its translated reason, and keeps the tray so
  the user can remove the bad ones. The empty session is left behind: it is invisible (no history
  UI yet) and costs one row. Record it as a known leftover.
- **A 401 stops the batch.** `request()` already signs out on 401, and `ProtectedRoute` redirects.
  The remaining items become `rejected` with code `network` and are not attempted.
- **A per-file error** (413/415/422/409 or a network failure) marks that item `rejected` with its
  code, and the batch continues with the next file.
- **No re-upload of a failed POST.** It was offered and not chosen. A rejected item shows its reason
  and a dismiss button.
- The context holds the `File` objects only until each one's POST settles, then drops them.

### D4 — Over the cap: keep the first ten and explain (product owner)

- `MAX_PAYSLIPS_PER_SESSION` (shared, 10) is the cap. A selection that would overflow the tray adds
  files up to ten and shows a persistent notice until the tray next changes:
  "N datoteka nije dodano: jedna sesija može imati najviše 10 platnih lista." (pluralised)
- Once the tray holds ten, both pickers are inert but stay focusable. The `<input>` gets
  `aria-disabled="true"` plus `aria-describedby` pointing at a visible "Dodano je najviše 10 platnih
  lista" line, and its `onClick` calls `preventDefault()` so the dialog never opens.
  - Why not `disabled`: it would drop the control from the tab order and hide *why* it does nothing.
    This mirrors the busy-state rule in the Task 07 DoD.
- Files refused client-side by `classifySourceFile` (`file_too_large`, `unsupported_media_type`)
  are not added to the tray. They are listed in the same notice area with `upload.<code>` copy and
  do not count toward the ten. `SourceFileError` is a subset of `UploadErrorCode`, so the existing
  `upload.*` messages are reused, not duplicated.

### D5 — Refresh the auth session before a batch (product owner, closes a ROADMAP §5 row)

- `startBatch` calls `supabase.auth.refreshSession()` once, before `createSession()`.
  - Why: the background extraction writes use the token the upload carried (Task 04 D2). A token
    near expiry at upload fails the completion write, and the reaper then fails the payslip
    15 minutes later.
  - A fresh token gives every write in the batch about the full token lifetime (1 h default). That
    covers a ten-file batch plus extraction by a wide margin.
- A refresh error is logged to the console and does not stop the batch. If the session is really
  gone, the next request's 401 handling takes over (D3).
- ROADMAP §5's row becomes **Mitigated (Task 07)**.

### D6 — `beforeunload` while files are unsent (product owner)

- `UploadBatchProvider` registers a `beforeunload` handler (`event.preventDefault()`) only while
  some item is `waiting` or `uploading`, and removes it when none is. That gives the browser's
  native "Leave site?" dialog. There is no custom copy: browsers ignore it.
- In-app navigation needs no guard: the provider outlives it.

### D7 — Session-page polling and what "settled" means

- Poll `GET /api/sessions/:id` every **2 s** (`POLL_INTERVAL_MS`, receipt-ocr's value). Use one
  `AbortController` per request and abort on unmount, as in receipt-ocr's `ProcessingPage.tsx`.
- **Settled** payslip: `failed`, `confirmed`, or `review` with `tablesStatus !== "pending"`.
- Polling continues while any server payslip is unsettled **or** the batch for this session has a
  `waiting`/`uploading` item. Each time a batch item turns `uploaded`, fetch immediately rather
  than waiting for the next tick.
- **No client-side poll timeout.** The API's stale reaper runs on this very read
  (`failStaleExtractions` in `GET /api/sessions/:id`) and fails anything stuck after 15 min. Polling
  therefore always ends in a settled state. A second, client-side clock would contradict it.
- A request error stops polling and shows a translated error with a "Pokušaj ponovno" button that
  resumes it. 404 shows "Ova sesija ne postoji." with a link to `/`. The technical detail goes to
  the console via `request()`'s existing logging (see the error-surfacing rule in NOTES).
- **Rows** are the server payslips in server order, then the batch items that have no payslip yet
  (`waiting`, `uploading`, `rejected`), in tray order. A batch item that is `uploaded` is not
  rendered on its own, because its server row represents it. `rejected` rows show
  `upload.<code>` (or `session.uploadNetworkError`) and a dismiss button.

### D8 — Retry is a conditional full reset, then re-enqueue (product owner)

`POST /api/payslips/:id/retry`, in order:

1. `id` must be a UUID, else `400 invalid_request`.
2. `repository.findDetailState(id)`. If null, `404 not_found` (foreign, deleted or missing: the
   owner filter and RLS make these one case). Unless `status === "failed"` and
   `isRetryableFailure(failureReason)`, `409 retry_not_allowed`. This is a fast path that avoids
   downloading bytes for a refusal.
3. `findSourceById(id)` for `contentType`, then `downloadSource(auth.client, sourceObjectPath(...))`.
   The download comes **before** the reset: if Storage fails, the row stays `failed` and retryable,
   instead of `processing` with no job behind it.
4. `repository.beginRetry(id)`. This is **one conditional update**:
   - it sets `status = 'processing'`, `tables_status = 'pending'`, `failure_reason = null`,
     `canonical_data = {}`, `extraction_metadata = null`, `raw_provider_result = null`,
     `edited_fields = '{}'` and `updated_at = now()`;
   - it applies only where `id`, `user_id`, `deleted_at is null`, `status = 'failed'` and
     `failure_reason in RETRYABLE_FAILURE_REASONS`;
   - it selects `PAYSLIP_COLUMNS` back.

   If it returns null, respond `409 retry_not_allowed`: a concurrent retry won the race. That
   refusal is what stops a double click from paying for two analyses.
5. `void extraction.enqueue({ payslipId, repository, bytes, contentType })`, then
   `202 { id, status }` shaped by `RetryPayslipResponse`.

Why each reset:

- **`tables_status = 'pending'`:** the tables pass writes only while pending (history/05 item 9).
- **Clearing `canonical_data`, metadata and raw:** a failed payslip can still hold a tables result
  that landed before its scalars pass failed. Without the clear, a new tables failure would leave
  stale tables under `tablesStatus: failed`.
- **`edited_fields`:** cannot be non-empty on a failed payslip today (no PATCH until Task 09). It is
  reset so that "fresh extraction" holds by construction.

Where it lives:

- `createPayslipsRouter` gains the `ExtractionRunner` parameter that `createSessionsRouter`
  already takes, and `app.ts` passes the same instance. One queue and one concurrency cap.
- **No migration.** `authenticated` already holds `update` on `payslips` under the owner policy.
  This is the same direct-write surface Task 09 must close (ROADMAP §5). Record that the retry
  route is one more server write for Task 09's `revoke update` to keep working, via a
  `security invoker` function or the same columns.

### D9 — `originalFilename` joins the session summary

- `payslipSummarySchema` gains `originalFilename: z.string().min(1)`. `PayslipState` gains
  `originalFilename`, mapped from `original_filename` in `mapPayslipState`, and `sessions.ts`
  copies it into each summary.
- Why: until the scalars pass lands, a row has no `employeeName` or `period`. A failed row never
  gets them. The filename is the only identifier the user recognises.
- It is already user-supplied, stored, and served by `GET /api/payslips/:id/source`, so nothing new
  is exposed. Update PRD §10.4's shape.

### D10 — HEIC: upload the original bytes, degrade the preview (product owner)

- Content Understanding accepts `.heic`/`.heif` (service limits page, see Documentation). The API
  already sniffs `image/heic`/`image/heif` (`source-file.test.ts` covers it).
- Only Safari decodes HEIC in `<img>`/canvas. When `analyzeSourceImage` throws
  `PreviewUnavailableError`, the tray item becomes a **file card**, as for a PDF, with a note
  ("Pregled nije dostupan u ovom pregledniku. Datoteka će se ipak poslati."), and the **original
  file** is what uploads.
  - This changes receipt-ocr's behaviour, which refused the file. PRD §4.1 accepts HEIC, so
    refusing it would contradict the PRD.
  - `downscaleSourceImage` already returns the original when decoding fails. "The preview is built
    from the exact bytes that upload" still holds: no preview is built at all.
- Reword the ROADMAP DoD item to: "A HEIC photo (previewed where the browser can decode it), a
  multi-page PDF and a PNG screenshot all upload and extract."
- **Test fixture:** create `payslip_examples/A02.heic` from `payslip_examples/A02.jpg` (step 1).
  `payslip_examples/` is git-ignored personal data: never commit it, never copy it elsewhere in the
  repo.

### D11 — Status copy guarded like upload errors (ROADMAP Task 07 scope)

- New locale groups: `payslipStatus.*` (every `PAYSLIP_STATUSES`), `tablesStatus.*` (every
  `TABLES_STATUSES`) and `failureReason.*` (every `EXTRACTION_FAILURE_REASONS`).
- A new guard test, `client/src/i18n/statusCopy.test.ts`, mirrors `uploadErrors.test.ts`:
  - every code has a non-empty message in both locales;
  - no group has an extra key.
- The failure reasons get copy now because the session page is the first place they are shown.

### D12 — Timing to the first payslip is logged

- `startBatch` logs `console.info("[upload] first payslip created", { ms })`, measured with
  `performance.now()` from the upload button press to the first `201`.
- This is the evidence for the DoD "review route reachable in under 3 s". The review session reads
  it in the browser console. It is technical detail, so it belongs in the console, not the UI.

### D13 — Paid Azure budget: up to ~20 documents, none planned for this session

- The product owner allowed up to ~20 documents (about $1 at $0.045–0.051 each).
- **This implementation session plans $0.** Retry and upload are proved against hosted Supabase
  with a recording extraction runner, the way `payslips.integration.ts` already avoids the
  provider.
- The paid part belongs to the **review session's** browser journey. Per the project's session
  split, the implementing session does not run browser verification. It should be one four-file
  batch: `A02.heic`, `A01.pdf` (two pages), `G01.png`, `B02.jpg`. That covers the HEIC, multi-page
  PDF, PNG and four-file DoD items in one run (4 documents, about $0.20).
- A real retry costs one more document: fail one payslip via SQL (`status='failed'`,
  `failure_reason='provider_unavailable'`) and press retry.
- The rest of the budget covers repeats. Every paid run is logged with its cost in history/07.

### D14 — What stays out

- The review form, regions, the chip rail, the page pager (Tasks 08–10).
- Adding files to an existing session; re-uploading a failed POST; bulk actions.
- A tables-only retry (Task 09 decides, Task 05 D9).
- Deleting the empty session left by an all-rejected batch (D3).
- **M3** (real-phone capture journey): manual, run separately, recorded in history/07 by the
  product owner. Never part of this unattended plan.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

Client:

- `client/src/routes/HomePage.tsx` (13 lines): the stub being replaced. Its test,
  `HomePage.test.tsx`, asserts the heading `home.title`. Keep the heading key or update the test.
- `../receipt-ocr/client/src/routes/HomePage.tsx` (270 lines): **the pattern to mirror**, including:
  - picker classes `primaryPicker`/`secondaryPicker` (the `focus-within` ring on the `<label>` with
    an `sr-only` input, and why);
  - the `selectionVersion` ref guarding async analysis against a newer selection;
  - `URL.revokeObjectURL` on clear and unmount;
  - the busy button that uses `aria-disabled`, not `disabled`, with a `Spinner label={false}`;
  - an `sr-only role="status"` for the announcement;
  - the error `<p role="alert">`;
  - the page's `min-h-[calc(100svh-3.5rem-4rem)]` layout.
- `../receipt-ocr/client/src/routes/HomePage.test.tsx` (206 lines): test pattern.
  - It mocks `../api/client` with an `ApiError` class, `analyze*` via `importOriginal`, and
    downscale as identity.
  - It stubs `URL` and `matchMedia` (`stubPointer(coarse)`), and asserts navigation with a
    `<Location/>` route.
- `../receipt-ocr/client/src/routes/ProcessingPage.tsx` (151 lines): the polling loop
  (`cancelled`/`finished` flags, per-request `AbortController`, timers cleared on unmount) and the
  retry button. Mirror the loop but **drop its timeout** (D7).
- `client/src/capture/sourceFile.ts`: `classifySourceFile`, `analyzeSourceImage`,
  `PreviewUnavailableError`, `CAMERA_ACCEPT`, `FILE_ACCEPT`, `QualityWarning`.
- `client/src/capture/downscale.ts`: `downscaleSourceImage(file)` returns the original on any
  failure.
- `client/src/capture/useCameraCapture.ts`: the `(pointer: coarse)` hook, re-read on change.
- `client/src/api/client.ts`: `request()` (bearer token, 401 sign-out, error-code parsing,
  console logging) and `parseResponse()`. Every new call goes through both. Note that the client
  has **no direct `zod` dependency**: pass shared schemas to `parseResponse`.
- `client/src/api/client.test.ts`: the `getSession`/`fetch` stubbing pattern for the new calls.
- `client/src/App.tsx`: the route tree. The catch-all must stay inside the protected branch (see
  its comment).
- `client/src/auth/ProtectedRoute.tsx`: renders `<Outlet/>`. `UploadBatchProvider` nests under it.
- `client/src/lib/supabase.ts`: the client for `auth.refreshSession()`.
- `client/src/components/Spinner.tsx`: its `label` prop; `role="status"` is built in when labelled.
- `client/src/i18n/uploadErrors.test.ts`: the guard test to mirror (D11).
- `client/src/i18n/i18n.test.ts`: parity and **CLDR plural categories**. `hr` needs `_one`,
  `_few` and `_other`; `en` needs `_one` and `_other`.
- `client/src/i18n/locales/en.json`, `hr.json`: `upload.*` codes already exist and are reused.
- `client/src/components/NavItems.tsx`: `NAV_ITEMS`. Do **not** add the session route.

API and shared:

- `api/src/routes/sessions.ts` (137 lines): `POST /`, `POST /:id/payslips`, `GET /:id`, and the
  summary mapping (D9). It is the `ExtractionRunner` injection pattern for D8.
- `api/src/routes/payslips.ts` (108 lines): where `/:id/retry` goes. Register it next to the other
  `/:id/*` routes. Neither `/:id/retry` nor `GET /:id` conflicts with a POST.
- `api/src/app.ts` (lines 29–49): runner construction and router wiring.
- `api/src/repositories/payslips.ts`:
  - `PAYSLIP_COLUMNS` (line 30);
  - `PayslipState` (70);
  - `findDetailState` (150);
  - `findSourceById` (188);
  - `update` (235), the conditional-update pattern;
  - `#updateProcessing` (347);
  - `mapPayslipState` (401).
- `api/src/services/payslip-extraction.ts`: the `ExtractionJob` shape and `enqueue`, which never
  rejects.
- `api/src/storage/payslip-sources.ts`: `downloadSource`, `sourceObjectPath`.
- `shared/src/session.ts` (lines 53–80): `TABLES_STATUSES`, `EXTRACTION_FAILURE_REASONS`,
  `RETRYABLE_FAILURE_REASONS`, `isRetryableFailure`.
- `shared/src/api.ts`: `payslipSummarySchema` (~line 94), `retryPayslipResponseSchema` (~168),
  `createSessionResponseSchema`, `createPayslipResponseSchema`, `sessionDetailResponseSchema`.
- `shared/src/upload.ts`: `UPLOAD_ERROR_CODES`, `uploadErrorCodeSchema`,
  `MAX_PAYSLIPS_PER_SESSION`.
- `api/src/routes/payslips.integration.ts`: the hosted suite.
  - Test users follow the `task0N-<uuid>` email pattern.
  - `createApp({ extraction: { enqueue: () => Promise.resolve() } })`.
  - Every uploaded source path goes into `sourcePaths` for cleanup.
  - The `admin` client bypasses RLS to set up states.
  - Line ~126 asserts a summary with `toEqual`: it must gain `originalFilename`.
  - The "another user … 404 on every endpoint" case (line ~267) must include retry.
- `api/src/app.test.ts`: the prefix-guard cases, which need no change. Retry sits under the
  guarded `/api/payslips` prefix.
- `../receipt-ocr/api/src/routes/receipts.ts` (lines 240–272): the sibling retry route. **Do not
  copy** its `processing`-is-retryable rule or its unconditional update. Both are replaced by D8.

### New Files to Create

- `client/src/upload/UploadBatchProvider.tsx`: the context, provider, `beforeunload` guard (D3, D5,
  D6, D12). It is a layout route component rendering `<Outlet/>`.
- `client/src/upload/useUploadBatch.ts`: the hook. It throws outside the provider, as the auth
  hook `client/src/auth/useAuth.ts` does. Read that file for the pattern.
- `client/src/upload/UploadBatchProvider.test.tsx`
- `client/src/routes/SessionPage.tsx`, `SessionPage.test.tsx` (D2, D7, D8 client side)
- `client/src/routes/HomePage.tsx` is rewritten; `HomePage.test.tsx` is rewritten.
- `client/src/i18n/statusCopy.test.ts` (D11)
- `.agents/history/07-capture-multi-upload.md`

### Relevant Documentation — READ BEFORE IMPLEMENTING

- [Content Understanding service limits — Input file limits](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits#input-file-limits):
  documents and images accept `.jpg .jpeg .png .bmp .heif .heic .pdf .tiff`, images from 50×50 to
  10k×10k px. This is D10's evidence.
- [MDN `<input type="file">` — `capture`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture)
  and [`multiple`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/file#multiple):
  why the camera input is single and the file input is multiple (D1).
- [MDN `beforeunload`](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeunload_event):
  call `preventDefault()`, and register only while needed, because the listener disables the
  bfcache (D6).
- [Supabase JS `auth.refreshSession()`](https://supabase.com/docs/reference/javascript/auth-refreshsession)
  (D5).
- [i18next plurals](https://www.i18next.com/translation-function/plurals): `t(key, { count })`
  with `_one`/`_few`/`_other` for `hr`.
- [WAI-ARIA `aria-disabled`](https://www.w3.org/TR/wai-aria-1.2/#aria-disabled): it stays
  focusable, unlike `disabled` (D4 and the DoD busy state).

### Patterns to Follow

**Client API call** (mirror `getPayslipSource` in `client/src/api/client.ts`):

```ts
export async function createSession(): Promise<CreateSessionResponse> {
  const response = await request("/api/sessions", { method: "POST" });
  return await parseResponse(createSessionResponseSchema, response, "POST /api/sessions");
}

export async function uploadPayslip(sessionId: string, file: File): Promise<CreatePayslipResponse> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await request(`/api/sessions/${encodeURIComponent(sessionId)}/payslips`, {
    method: "POST",
    body: formData,
  });
  return await parseResponse(
    createPayslipResponseSchema,
    response,
    "POST /api/sessions/:id/payslips",
  );
}
// getSessionDetail(id, signal) → sessionDetailResponseSchema, "GET /api/sessions/:id"
// retryPayslip(id)             → retryPayslipResponseSchema,  "POST /api/payslips/:id/retry"
```

- The session read is `getSessionDetail`, not `getSession`: that name would read as
  `supabase.auth.getSession`, which `request()` in the same file calls.

**Mapping an `ApiError` to a translated upload code** (receipt-ocr `HomePage.tsx`):

```ts
if (caught instanceof ApiError && caught.code) {
  const code = uploadErrorCodeSchema.safeParse(caught.code);
  if (code.success) return code.data;
}
console.error("[upload] upload failed for an unrecognised reason", caught);
return "network";
```

**Conditional repository update** (mirror `#updateProcessing`):

```ts
/** Task 07 D8: a fresh extraction, only from a retryable failure. Null: not retryable now. */
async beginRetry(id: string): Promise<Payslip | null> {
  const { data, error } = await this.#client
    .from("payslips")
    .update({
      status: "processing",
      tables_status: "pending",
      failure_reason: null,
      canonical_data: {},
      extraction_metadata: null,
      raw_provider_result: null,
      edited_fields: [],
      updated_at: new Date().toISOString(),
    })
    .eq("id", uuidSchema.parse(id))
    .eq("user_id", this.#userId)
    .eq("status", "failed")
    .in("failure_reason", [...RETRYABLE_FAILURE_REASONS])
    .is("deleted_at", null)
    .select(PAYSLIP_COLUMNS)
    .maybeSingle();

  if (error) throw new PayslipRepositoryError("query_failed", error);
  return data === null ? null : mapPayslipRow(data);
}
```

**Route shape** (mirror `authenticated(async (req, res, auth) => …)` in `payslips.ts`). Errors are
`throw new HttpError(status, code)`, and `errorHandler` renders `{ error: { code } }`.

**Naming:**

- React components are PascalCase files.
- Hooks are `useX.ts`.
- API workspace relative imports carry `.js`; client imports carry none.
- Locale keys are camelCase groups, and code-keyed groups use the code verbatim (`upload.file_too_large`).

**Comments:** match the density of the files you touch. Explain *why* (a WCAG rule, a race, a
measured number), never what the next line does.

---

## LOCALE COPY (en / hr)

Add exactly these (plural keys expanded per CLDR). Keep `home.title`/`home.subtitle` as the page
heading and intro.

| Key | en | hr |
| --- | --- | --- |
| `capture.scan` | Scan payslip | Skeniraj platnu listu |
| `capture.scanAnother` | Scan another | Skeniraj još jednu |
| `capture.chooseFiles` | Choose files | Odaberi datoteku |
| `capture.guidance` | Photograph each payslip flat and fully in frame, or choose image or PDF files. Up to 10 at once. | Fotografirajte svaku platnu listu ravno i cijelu u kadru ili odaberite slike ili PDF datoteke. Najviše 10 odjednom. |
| `capture.trayLabel` | Selected payslips | Odabrane platne liste |
| `capture.remove` | Remove {{name}} | Ukloni {{name}} |
| `capture.fileSize` | {{size}} MB | {{size}} MB |
| `capture.documentPreview` | PDF document | PDF dokument |
| `capture.previewUnavailable` | Preview is not available in this browser. The file will still be uploaded. | Pregled nije dostupan u ovom pregledniku. Datoteka će se ipak poslati. |
| `capture.imagePreview` | Preview of {{name}} | Pregled datoteke {{name}} |
| `capture.lowResolution` | The photo has a low resolution, so some values may be misread. | Fotografija ima nisku razlučivost pa neke vrijednosti mogu biti pogrešno očitane. |
| `capture.possibleBlur` | The photo may be blurred. A sharper photo gives better results. | Fotografija je možda mutna. Oštrija fotografija daje bolje rezultate. |
| `capture.processing` | Preparing {{name}} | Priprema datoteke {{name}} |
| `capture.cap` | At most 10 payslips have been added. | Dodano je najviše 10 platnih lista. |
| `capture.overCap_one` / `_other` | {{count}} file was not added: a session holds at most 10 payslips. / {{count}} files were not added: … | — |
| `capture.overCap_one` / `_few` / `_other` (hr) | — | {{count}} datoteka nije dodana: jedna sesija može imati najviše 10 platnih lista. / {{count}} datoteke nisu dodane: … / {{count}} datoteka nije dodano: … |
| `capture.rejectedFile` | {{name}}: {{reason}} | {{name}}: {{reason}} |
| `capture.upload_one` / `_other` | Upload {{count}} payslip / Upload {{count}} payslips | — |
| `capture.upload_one` / `_few` / `_other` (hr) | — | Pošalji {{count}} platnu listu / Pošalji {{count}} platne liste / Pošalji {{count}} platnih lista |
| `capture.uploading` | Uploading… | Slanje u tijeku… |
| `capture.uploadingStatus` | Uploading your payslips. | Vaše platne liste se šalju. |
| `capture.allRejected` | None of the files could be uploaded. Remove them or choose others. | Nijednu datoteku nije bilo moguće poslati. Uklonite ih ili odaberite druge. |
| `capture.sessionError` | The upload could not start. Try again. | Slanje nije moguće započeti. Pokušajte ponovno. |
| `session.title` | Your payslips | Vaše platne liste |
| `session.progress` | {{ready}} of {{total}} ready to review | {{ready}} od {{total}} spremno za pregled |
| `session.position` | Payslip {{index}} | Platna lista {{index}} |
| `session.waiting` | Waiting to upload | Čeka slanje |
| `session.uploading` | Uploading | Slanje u tijeku |
| `session.uploadNetworkError` | The upload failed. Check your connection. | Slanje nije uspjelo. Provjerite vezu. |
| `session.dismiss` | Dismiss {{name}} | Odbaci {{name}} |
| `session.retry` | Try again | Pokušaj ponovno |
| `session.scanMore` | Scan more payslips | Skeniraj još platnih lista |
| `session.notFound` | This session does not exist. | Ova sesija ne postoji. |
| `session.loadError` | The session could not be loaded. | Sesiju nije moguće učitati. |
| `payslipStatus.processing` | Reading the payslip | Očitavanje u tijeku |
| `payslipStatus.review` | Ready to review | Spremno za pregled |
| `payslipStatus.confirmed` | Confirmed | Potvrđeno |
| `payslipStatus.failed` | Could not be read | Nije očitano |
| `tablesStatus.pending` | Line items still loading | Stavke se još učitavaju |
| `tablesStatus.ready` | Line items ready | Stavke su učitane |
| `tablesStatus.failed` | Line items could not be read | Stavke nije moguće očitati |
| `failureReason.unreadable_document` | The document could not be read. Try a sharper photo. | Dokument nije moguće pročitati. Pokušajte s oštrijom fotografijom. |
| `failureReason.provider_rejected` | The extraction service refused this document. | Servis za očitavanje odbio je ovaj dokument. |
| `failureReason.provider_unavailable` | The extraction service was unavailable. Try again. | Servis za očitavanje nije bio dostupan. Pokušajte ponovno. |

- The `hr` `capture.overCap` forms follow Croatian number agreement: 1, 21 → *nije dodana*; 2–4 →
  *nisu dodane*; 5+ → *nije dodano*. If you are unsure of a form, keep the table's wording. The
  product owner reviews the copy in the review session.
- `session.progress` counts payslips in `review` or `confirmed` (the scalars form exists, PRD §7.3
  "first usable form").

---

## IMPLEMENTATION PLAN

### Phase 0: Baseline and fixture

Confirm a green start and produce the HEIC fixture.

### Phase 1: Backend (shared → repository → route → wiring → hosted tests)

D8 and D9 — small, testable without the UI, and depended on by the session page.

### Phase 2: Client plumbing

API client calls, locale copy and the guard test, then the upload batch context.

### Phase 3: Screens

The capture page, the session page, and the routes.

### Phase 4: Validation and documents

The checks this work needs, PRD/ROADMAP updates, and the history file. Then hand off to the review
session.

---

## STEP-BY-STEP TASKS

Execute every step in order. Each ends with its validation.

### 1. VERIFY the starting state and CREATE the HEIC fixture

- `git status` is clean on `prototype/payslip-ocr`, and `npm run validate` is green (632 tests at
  the end of Task 06).
- Install the encoder outside the project: `python -m pip install --user pillow-heif`. It is a dev
  tool only, not a dependency; do not add it to any manifest. Then:
  `python -c "from PIL import Image; import pillow_heif; pillow_heif.register_heif_opener(); Image.open('payslip_examples/A02.jpg').save('payslip_examples/A02.heic', quality=90)"`.
- **VALIDATE**:
  - `python -c "import pillow_heif; print(pillow_heif.open_heif('payslip_examples/A02.heic').mode)"`
    prints a mode;
  - `node -e "import('file-type').then(async m => console.log((await m.fileTypeFromFile('payslip_examples/A02.heic'))?.mime))"`
    run from `api/` prints `image/heic` or `image/heif`. Either is accepted.
  - `git status` still shows no tracked change, since `payslip_examples/` is ignored.

### 2. UPDATE `shared/src/api.ts` (D9)

- ADD `originalFilename: z.string().min(1)` to `payslipSummarySchema`'s `.extend({...})`, with a
  one-line comment: the only identifier a row has before extraction reads a name.
- UPDATE `shared/src/api.test.ts` if it builds a summary fixture (grep `payslipSummarySchema`).
- **VALIDATE**: `npm run typecheck` fails in `api/src/routes/sessions.ts` (expected; fixed in step
  3) and nowhere unexpected. `npx vitest run shared` is green.

### 3. UPDATE `api/src/repositories/payslips.ts` and `api/src/routes/sessions.ts` (D8, D9)

- ADD `readonly originalFilename: string` to `PayslipState`, and set it from
  `row.original_filename` in `mapPayslipState`.
- ADD `beginRetry(id)` exactly as in Patterns. IMPORTS: `RETRYABLE_FAILURE_REASONS` from
  `@payslip/shared`.
  - GOTCHA: the generated `Update` type may type `canonical_data` as `Json`, so `{}` is fine.
  - GOTCHA: `.in()` wants a mutable array, hence the spread.
- UPDATE `sessions.ts` so the summary `map` destructures `{ payslip, failureReason, originalFilename }`
  and emits `originalFilename`.
- UPDATE `api/src/repositories/payslips.test.ts`:
  - `mapPayslipState` or `listBySession` carries `originalFilename`;
  - `beginRetry` sends the D8 update and filters, using the file's existing client-stub pattern.
- **VALIDATE**: `npm run typecheck` and `npx vitest run api/src/repositories` are green.

### 4. ADD `POST /:id/retry` to `api/src/routes/payslips.ts` and UPDATE `api/src/app.ts` (D8)

- CHANGE the signature to `createPayslipsRouter(extraction: ExtractionRunner)`. IMPORT
  `type ExtractionRunner` from `../services/payslip-extraction.js`. `app.ts` passes `extraction`.
- IMPLEMENT the route in D8's five steps. IMPORTS:
  - `isRetryableFailure` and `type RetryPayslipResponse` from `@payslip/shared`;
  - `downloadSource` from `../storage/payslip-sources.js`.
- Keep the doc comment style: `/** PRD §10.8 (Task 07 D8). … */` naming the race that the
  conditional update closes.
- Do **not** call `failStaleExtractions` here: a payslip that is only stale is still `processing`
  and not retryable until a read reaps it, and the session page's poll does that.
- **VALIDATE**: `npm run typecheck`, `npm run lint`, `npx vitest run api/src/app.test.ts`.

### 5. EXTEND `api/src/routes/payslips.integration.ts` (hosted Supabase, $0)

- UPDATE the existing summary `toEqual` (~line 126) to include `originalFilename: "payslip.jpg"`.
- ADD retry to the "another user … 404 on every endpoint" case: user B's
  `POST /api/payslips/<A's id>/retry` returns 404.
- ADD `describe("retry (Task 07 D8)")` with **its own session**. The existing ones are near the cap.
  - Use a second app whose runner records jobs:
    `const enqueued: ExtractionJob[] = []; const retryApp = createApp({ extraction: { enqueue: (job) => { enqueued.push(job); return Promise.resolve(); } } });`
    Import `type ExtractionJob`.
  - Upload one JPEG through `retryApp`, push its source path, and clear `enqueued`.
  - With `admin`, set the row to `status='failed'`, `failure_reason='provider_unavailable'`,
    `tables_status='ready'`, `canonical_data={"brutoPlaca":"1.00","payComponents":[]}` and
    non-null `extraction_metadata`/`raw_provider_result`. That is the history/05 item 9 shape.
  - Cases:
    1. Retry → `202`, `retryPayslipResponseSchema.parse(body)` equals `{ id, status: "processing" }`.
       The admin read of the row shows `tables_status='pending'`, `failure_reason=null`,
       `canonical_data={}`, and null metadata and raw. Exactly one job was enqueued, whose `bytes`
       equal the uploaded bytes and whose `contentType` is `image/jpeg`.
    2. A second retry immediately → `409 retry_not_allowed`, with no second job.
    3. Set `failure_reason='unreadable_document'` (status failed) → `409`.
    4. Set `status='review'`, `failure_reason=null` → `409`.
    5. Status `processing` → `409`.
    6. Soft-deleted → `404`.
    7. `POST /api/payslips/not-a-uuid/retry` → `400 invalid_request`.
- **VALIDATE**: `npm run test:integration` passes (3 auth + 27 payslips before; expect 34 payslips).
  Then check orphans with Supabase MCP `execute_sql`: 0 `task0%` users, 0 payslips, 0 sessions,
  0 Storage objects for them.

### 6. ADD client API calls to `client/src/api/client.ts` + tests

- ADD `createSession`, `uploadPayslip`, `getSessionDetail(id, signal?)` and `retryPayslip(id)` per
  Patterns. IMPORT the four schemas and types from `@payslip/shared`.
- ADD cases to `client.test.ts`:
  - `uploadPayslip` sends `FormData` with one `file` part to the encoded path;
  - `getSessionDetail` passes the signal;
  - a `409` from `retryPayslip` surfaces as `ApiError` with code `retry_not_allowed`.
- **VALIDATE**: `npx vitest run client/src/api`.

### 7. ADD locale copy and CREATE `client/src/i18n/statusCopy.test.ts` (D11)

- ADD every key in LOCALE COPY to `en.json` and `hr.json`, in the same group order in both files.
- CREATE the guard: mirror `uploadErrors.test.ts` for three pairs:
  - `PAYSLIP_STATUSES` → `payslipStatus`;
  - `TABLES_STATUSES` → `tablesStatus`;
  - `EXTRACTION_FAILURE_REASONS` → `failureReason`.

  `it.each` over locales × groups, with the "no extra key" assertion per group.
- **VALIDATE**: `npx vitest run client/src/i18n` (parity, plural categories and both guards).

### 8. CREATE `client/src/upload/UploadBatchProvider.tsx`, `useUploadBatch.ts` + test (D3, D5, D6, D12)

- **State** (a `useReducer` or a `useState` of a `Map<sessionId, BatchItem[]>`):
  `BatchItem = { localId: string; name: string; state: "waiting" | "uploading" | "uploaded" | "rejected"; payslipId?: string; errorCode?: UploadErrorCode | "network" }`.
  Hold `File`s in a `useRef<Map<localId, File>>` and delete each one when its POST settles.
- **Context value:**
  - `startBatch(files: File[]): Promise<{ ok: true; sessionId: string } | { ok: false; errors: Map<number, UploadErrorCode | "network"> | "session" }>`.
    It resolves at the first `201`; if none succeeds, it resolves after the last file.
  - `itemsFor(sessionId): readonly BatchItem[]`
  - `dismiss(sessionId, localId)`
- **`startBatch` flow:**
  1. `const started = performance.now()`.
  2. `await supabase.auth.refreshSession()`, with any error logged (D5).
  3. `createSession()`. On failure, resolve `{ ok: false, errors: "session" }`.
  4. Register every item as `waiting`.
  5. For each file, in order: mark it `uploading`; `uploadPayslip`; on success mark it `uploaded`
     with `payslipId`, and at the first success log D12's timing and resolve `{ ok: true }`. On an
     error, map it to a code per Patterns. `ApiError.status === 401` marks the rest `rejected` with
     `network` and stops the batch.
- **Unmount safety:** the loop runs detached from any component, so write state through a stable
  dispatch that is safe after the capture page unmounts. The provider itself stays mounted.
- **`beforeunload`:** a `useEffect` keyed on "any item waiting or uploading" adds or removes the
  listener (D6).
- **The component renders `<Outlet/>`.** `useUploadBatch` throws `Error("useUploadBatch must be used inside UploadBatchProvider")` outside the provider.
- **Tests** (mock `../api/client` and `../lib/supabase`):
  - uploads are sequential and in order: assert call order and that the second call starts only
    after the first resolves, using deferred promises;
  - `startBatch` resolves after the first `201` while later files are still `waiting`/`uploading`;
  - a 415 on file 2 marks it `rejected` with `unsupported_media_type`, and file 3 still uploads;
  - all files rejected resolves with `ok: false`;
  - a 401 stops the batch;
  - `refreshSession` is called once, before `createSession`;
  - `beforeunload` `preventDefault` fires while `uploading` and not after settling (dispatch a
    `new Event("beforeunload", { cancelable: true })` and check `defaultPrevented`);
  - `console.info` is called with `"[upload] first payslip created"`.
- **VALIDATE**: `npx vitest run client/src/upload`.

### 9. REWRITE `client/src/routes/HomePage.tsx` + test (D1, D4, D10)

- Mirror receipt-ocr's HomePage structure, classes and comments, generalised to a tray:
  - **Pickers:**
    - camera `<label>` + `<input capture="environment" accept={CAMERA_ACCEPT}>`, rendered only when
      `useCameraCapture()` is true;
    - file `<label>` + `<input multiple accept={FILE_ACCEPT}>`, primary style when there is no
      camera.
    - Once the tray is non-empty, the camera label text becomes `capture.scanAnother`.
    - `onChange` hands `Array.from(files)` to `addFiles`, then **resets `input.value = ""`**, so
      choosing the same file again fires `change`.
  - **`addFiles`:**
    - classify each file;
    - list refusals (D4);
    - apply the cap against the tray length plus files still being processed;
    - append accepted items as `{ localId: crypto.randomUUID(), status: "processing" }`;
    - process them **sequentially**: `analyzeSourceImage` for its warnings, then
      `downscaleSourceImage`, then `URL.createObjectURL(uploadFile)`.
    - On `PreviewUnavailableError`, keep the original file with `previewUnavailable: true` (D10).
    - A PDF gets no analysis.
    - Guard every async step against the item having been removed meanwhile (the
      `selectionVersion` idea, applied per item via a removed-ids ref).
  - **Tray:** a `<ul aria-label={t("capture.trayLabel")}>`, each `<li>` holding the preview
    (`<img alt={t("capture.imagePreview",{name})}>` or a file card), name, size, warnings and a
    remove button (`aria-label={t("capture.remove",{name})}`, ≥44 px hit box, `min-h-11 min-w-11`).
  - **Cap:** D4's `aria-disabled` pickers with `aria-describedby` and a `preventDefault` click.
  - **Upload button:**
    - `t("capture.upload", { count })`;
    - `aria-disabled` while uploading or while any item is still processing, and an `onClick`
      guard;
    - a spinner and `capture.uploading` while busy;
    - a sibling `<p role="status" className="sr-only">` with `capture.uploadingStatus`.
  - On `{ ok: true }`, `navigate(`/sessions/${sessionId}`)`. On `{ ok: false }`, mark tray items
    with their error (`upload.<code>` / `session.uploadNetworkError`) or show `capture.sessionError`
    in the `role="alert"` paragraph.
  - Revoke every object URL on remove and on unmount. **Don't revoke** on successful navigation
    before the `<img>` unmounts; the unmount cleanup handles it.
- **Tests:** mirror receipt-ocr's `HomePage.test.tsx` setup (mock the client, the provider hook or
  a real provider around a `MemoryRouter`, `stubPointer`, the `URL` stub). Cases:
  - coarse pointer shows both pickers; fine pointer shows only the file picker, as primary;
  - the file input has `multiple` and the camera input does not;
  - adding three files shows three tray items with remove buttons; removing one leaves two and
    updates the button to "Upload 2 payslips";
  - selecting 12 into an empty tray keeps 10, shows `overCap` with count 2, and makes the pickers
    `aria-disabled` with the explanation;
  - an 11 MB file is refused with `upload.file_too_large` and not added;
  - `analyzeSourceImage` rejecting with `PreviewUnavailableError` shows `capture.previewUnavailable`
    and still uploads the original file;
  - the upload button keeps focus and has `aria-disabled="true"` while uploading, and the status
    text is present;
  - on success, navigation goes to `/sessions/<id>`;
  - all rejected keeps the tray and shows each reason.
- **VALIDATE**: `npx vitest run client/src/routes/HomePage.test.tsx`.

### 10. CREATE `client/src/routes/SessionPage.tsx` + test (D2, D7)

- `useParams().sessionId`, then a polling effect per D7. Mirror receipt-ocr's `ProcessingPage` loop
  without its timeout. Re-run the effect on a `refreshKey` bumped by retry, by "try again" and by a
  batch item turning `uploaded`.
- Render per D2 and D7. Status icons come from `lucide-react`:
  - `Loader2` or `Spinner` while processing;
  - `CheckCircle2` for review/confirmed;
  - `AlertCircle` for failed;
  - `Clock` while waiting.

  Each is `aria-hidden`, with the text label beside it.
- **Retry:**
  - shown only when `status === "failed" && failureReason && isRetryableFailure(failureReason)`;
  - `aria-disabled` while its request is in flight;
  - on 202, set that row to `processing` locally and resume polling;
  - on 409, just refetch;
  - on any other error, show `session.loadError` for that row.
- **Tests:** mock `getSessionDetail`/`retryPayslip` and the batch hook, and use fake timers. Cases:
  - rows render in server order with filename, status label and position;
  - polling stops when all rows are settled (`review` + `ready`, `failed`), and continues while
    one is `review` + `pending`;
  - no client timeout: after 5 simulated minutes of `processing` it is still polling;
  - batch `waiting` and `rejected` items render after the server rows;
  - `rejected` shows its `upload.*` message and a dismiss button;
  - an `uploaded` item with a payslip id appears only once;
  - retry appears only for `provider_unavailable`, and pressing it calls `retryPayslip` and shows
    `processing`;
  - 404 renders `session.notFound` with a link to `/`;
  - the progress text counts review and confirmed.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx`.

### 11. UPDATE `client/src/App.tsx`

- Nest the routes: `ProtectedRoute` → `UploadBatchProvider` → `index` (`HomePage`),
  `sessions/:sessionId` (`SessionPage`) and `*` (`NotFoundPage`). Keep the existing comment about
  the catch-all.
- **VALIDATE**:
  - `npm run validate` is green;
  - `npm run build` is green (the known Vite chunk-size advisory is expected);
  - `git diff --stat package-lock.json` is empty.

### 12. UPDATE the documents

- **PRD:**
  - §10.4: add `originalFilename` to the summary shape.
  - §10.8: state that a retry is a full reset to a fresh extraction and that a concurrent retry gets
    `409`.
  - §7.2: add HEIC preview degradation (D10) and the tray, "each camera press adds one photo".
  - §7.3: sequential upload in tray order, and the refresh before a batch.
- **ROADMAP:**
  - Task 07 DoD: reword the HEIC item per D10.
  - Task 07 scope: add "Added in planning: the tray (D1), the minimal session page (D2),
    `originalFilename` on the summary (D9)".
  - §5: the "Background writes use the upload's token" row becomes *Mitigated (Task 07 D5)*.
  - The "Direct-write gap" row: note that the retry route is one more server write Task 09 must
    preserve.
  - §2 Progress: Task 07 → complete, **only when the history file is written**.
- CONTEXT.md: no new term. The tray is UI, not domain. Leave it unchanged.
- **VALIDATE**: `npm run format:check` (Prettier does not touch `*.md`; this checks nothing broke
  elsewhere).

### 13. WRITE `.agents/history/07-capture-multi-upload.md`, then stop

- Mirror history/06's sections:
  - what was built;
  - design decisions carried (D1–D14);
  - deviations;
  - validation;
  - paid runs: **$0 in this session** (D13);
  - open items.
- Open items must include:
  - the empty session left by an all-rejected batch (D3);
  - the retry route and the direct-write gap for Task 09 (D8);
  - M3 pending;
  - the review-session handoff below;
  - the leftover receipt field labels in `review.fields` of both locales (`sellerName`,
    `vatAmount`, …). They are pre-existing dead copy that Task 09 should replace. **Mention them,
    don't delete them.**
- **Handoff to the review session.** Per the project's session split, do **not** run
  `/code-review`, `/validate` or browser checks here. List for the review session:
  1. The browser journey on the dev server, with the D13 four-file batch (`A02.heic`, `A01.pdf`,
     `G01.png`, `B02.jpg`): the console's `[upload] first payslip created` timing, the session page
     reached in <3 s, four independent extractions, and the paid cost logged.
  2. The busy state: the pressed button stays focusable with `aria-disabled`, and the status is
     announced.
  3. A real retry: fail one payslip via SQL, then press retry (1 document).
  4. 375 px width with no horizontal scroll, and hr/en copy read through.
- Committing waits for the product owner's go-ahead.

---

## TESTING STRATEGY

### Unit Tests (Vitest, jsdom, no network)

- **API client:** the four new calls.
- **Locales:** parity, plural categories, `uploadErrors`, and the new `statusCopy` guard.
- **Upload batch:** ordering, first-201 resolution, per-file rejection, 401 stop, refresh order,
  the `beforeunload` guard, the timing log.
- **HomePage:** pickers by pointer, `multiple`, the tray, the cap, client refusals, HEIC fallback,
  busy state, navigation, all rejected.
- **SessionPage:** ordering, the polling stop rule, no timeout, merged batch rows, retry
  visibility and action, 404, progress.
- **Repository:** the `beginRetry` update and filters, and `originalFilename` mapping.

### Integration Tests (hosted Supabase, recording runner, $0)

Step 5's retry cases (a successful reset with the exact bytes enqueued, a race refusal,
non-retryable, review, processing, deleted, bad id), cross-user 404, and the summary's
`originalFilename`.

### Edge Cases

- The same file chosen twice in a row: input value reset.
- A file removed while it is still being analysed: no ghost item, URL revoked.
- Twelve files chosen with 9 already in the tray: 1 added, notice says 11 not added.
- A HEIC on Chrome: file card and original bytes uploaded.
- A PDF over 10 pages or encrypted: only the server knows, so it is `rejected` on the session
  page with the `upload.pdf_*` copy and the batch continues.
- Every file rejected: stay on `/`.
- A 401 mid-batch: stops, and the redirect happens through `ProtectedRoute`.
- Navigating away from `/sessions/:id` to `/` mid-batch: the batch continues. The provider is
  above both routes.
- Retry double-click: one job only (hosted case 2), and the client button is `aria-disabled` while
  in flight.
- `review` + `tablesStatus: failed`: settled, shows "Line items could not be read", no retry
  (D14).
- A stale `processing` payslip: the poll's own read reaps it to `failed provider_unavailable`,
  and retry appears.

---

## VALIDATION COMMANDS

Run each once, with purpose. Don't re-run a check that already passed after an unrelated or
doc-only edit.

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` (oxlint) · `npm run format:check`

### Level 2: Unit Tests

`npm run test`: all three workspaces. Expect 632 plus the new tests, all green.

### Level 3: Integration Tests

`npm run test:integration`: hosted auth and payslips suites, $0. Then the orphan check via
Supabase MCP `execute_sql`.

### Level 4: Manual Validation — review session only

Listed in step 13's handoff. **Not run by the implementing session** (project session split).

### Level 5: Additional Validation

- `npm run build`
- `git diff --stat package-lock.json` is empty (no new dependency).
- `grep -rn "react-router-dom" client/src` is empty.
- `grep -rnE "\"[A-Z][a-z]+ [a-z]+" client/src/routes/HomePage.tsx client/src/routes/SessionPage.tsx`
  shows no hardcoded user-facing string (inspect any hit).

---

## ACCEPTANCE CRITERIA

- [ ] Selecting four files creates one session with four payslips, uploaded in tray order, each
      extracting independently. Unit-proved here; browser-proved in the review session.
- [ ] `startBatch` resolves, and the page navigates, at the first `201`. The timing is logged for
      the <3 s DoD.
- [ ] A HEIC (previewed where decodable, file card otherwise), a multi-page PDF and a PNG all
      upload. Unit-proved; the paid extraction runs in the review session.
- [ ] The busy button stays in the tab order (`aria-disabled`), and a visually hidden
      `role="status"` announces the upload.
- [ ] The cap is explained: the first ten are kept, the rest counted, and the pickers are inert
      but focusable, with a reason.
- [ ] The session page shows every payslip's status, tables status and failure reason in hr and
      en. Polling stops when all are settled.
- [ ] `POST /api/payslips/:id/retry`:
  - [ ] `202` performs D8's full reset and enqueues the stored bytes;
  - [ ] a concurrent or second retry, a non-retryable reason, `review` and `processing` all get
        `409 retry_not_allowed`;
  - [ ] a foreign or deleted payslip gets `404`.
- [ ] The auth session is refreshed before each batch. ROADMAP §5 is updated.
- [ ] `beforeunload` guards only while files are unsent.
- [ ] Both locales are complete. The parity, plural, `uploadErrors` and `statusCopy` guards pass.
- [ ] `npm run validate`, `npm run build` and `npm run test:integration` are green. The lockfile is
      unchanged and there are 0 hosted orphans.
- [ ] PRD, ROADMAP and history/07 are updated, with the review-session handoff recorded.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–13 done in order, each step's validation green
- [ ] No paid Azure call made in this session (D13)
- [ ] No new dependency; lockfile unchanged
- [ ] History file written with the handoff; no `/code-review`, `/validate` or browser run here
- [ ] Commit waits for the product owner

---

## NOTES

- **Why sequential upload is not a latency cost that matters.** Only the first POST gates
  navigation. Extraction of file 1 starts at its `201` while file 2 uploads, and the server caps
  analyses at 3 anyway. Parallel POSTs would buy wall-clock time on the last upload only, at the
  price of upload order.
- **Why no client poll timeout.** The server already has a clock (`STALE_EXTRACTION_MS`, 15 min)
  and the poll triggers it. receipt-ocr's 100 s client timeout predates its reaper. A second clock
  would show "timed out" for a payslip the server still considers alive.
- **Why the download comes before the reset.** It keeps the failure mode "still retryable" rather
  than "stuck in processing for 15 minutes".
- **Error surfacing.** Technical detail goes to the console: `request()` already logs method,
  path, status and code. The UI shows only the translated code copy or a friendly generic line.
- **The receipt-ocr pieces deliberately not taken:**
  - the single-file flow and its separate processing route;
  - `processing` counted as retryable;
  - the 100 s client timeout;
  - refusing an undecodable image.
- **Risks:**
  - The cross-route batch lifecycle (step 8) is the novel part. Its tests use deferred promises so
    the ordering is asserted, not inferred.
  - Croatian plural copy: the product owner reads it in the review session.
- **Confidence score for one-pass success: 8/10.** The backend is small and patterned. The client
  is the first real UI and has the most surface, but every piece has a direct receipt-ocr
  precedent except the batch context.
