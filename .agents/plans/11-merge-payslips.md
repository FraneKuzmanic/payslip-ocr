# Feature: Task 11 — Merge payslips

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §1](../ROADMAP.md) (locked decisions 3, 4, 5), §3 Task 11 ·
**PRD:** §4.1, §4.6 (no drag, swap only), §7.8, §10.4, §10.11, §11.2, §14 risk 10, Appendix B
(`merged_from`) · **Previous tasks:** [`history/10`](../history/10-session-navigation-phone-layout.md)
(the rail, the tabpanel, unsaved edits), [`history/09`](../history/09-review-form-two-way-linking.md)
(definer functions, migration workflow, direct-write gap), [`history/07`](../history/07-capture-multi-upload.md)
(retry, HEIC original bytes D10), [`history/04`](../history/04-content-understanding-provider.md)
(`pdf_encrypted` means "needs a password"; B01 is permissions-only) · **Glossary:**
[`CONTEXT.md`](../../CONTEXT.md) (*Merge*, *Source File*, *Page*, *Session*, *Unsaved edits*) ·
**Behaviour rules:** [`AGENTS.md`](../../AGENTS.md) (no `CLAUDE.md`).

## Feature Description

A two-page payslip photographed as two files arrives as two payslips, each with half the fields.
Merge replaces those two with one payslip that owns both pages:

- the **API** combines the two Source Files into one PDF in the chosen page order, stores it,
  creates the merged payslip in one atomic database call that also soft-deletes the originals, and
  re-extracts the combined document with the existing two-pass runner (locked decision 5);
- a **suggestion**: `GET /api/sessions/:id` returns pairs of settled payslips that share employee OIB
  and period (or employer OIB and period when an employee OIB is missing on one side). The session
  page shows one non-blocking banner per pair (locked decision 4);
- a **manual merge** from an overflow menu beside the selected payslip's heading, for when OCR did
  not read the key at all;
- a **merge dialog** that shows both documents' first pages in upload order with a swap control,
  and says that edits and confirmation on both are replaced by a fresh extraction. Never silent.

## User Story

As someone who photographed a two-page payslip as two pictures
I want the app to notice that they belong together, and to let me join them myself when it does
not notice
So that I review and export one payslip with all its values instead of two halves (PRD §7.8,
§11.2 "Merge produces one payslip with the combined pages and a re-extracted form").

## Problem Statement

- One Source File is always one Payslip (locked decision 3), so page 2 photographed separately is
  its own payslip, usually with the employee OIB or the reconciliation chain missing.
- Nothing merges today. The pieces that exist: `mergePayslipsRequestSchema` and
  `mergePayslipsResponseSchema` (`shared/src/api.ts:175-203`), the `merged_from uuid[]` column,
  `listBySession` ordered by upload (`api/src/repositories/payslips.ts:182-195`), an unused
  `ActionMenu` (`client/src/components/ActionMenu.tsx`), and `ConfirmDialog` kept for this task
  (plan 10 D1).
- **Found in planning, measured on 2026-09-26:**
  - **pdf-lib 1.17.1 cannot decrypt.** Copying B01's page (permissions-only `/Encrypt`, empty user
    password) into a new PDF keeps the encrypted content streams: pdf.js reads **no text** from the
    result. `@cantoo/pdf-lib` 2.11.1 loads it with `{ password: "" }` and the copied page keeps its
    text ("OBRAČUN ISPLAĆENE PLAĆE Obrazac IP1 …").
  - **pdf-lib embeds only JPEG and PNG.** A HEIC chosen in Chrome is stored as its original bytes
    (Task 07 D10). `heic-convert` 2.1.0 converted `A02.heic` to a 1220×2712 JPEG in ~0.3 s, upright
    (same dimensions as `A02.jpg`).
  - **EXIF orientation is lost inside a PDF.** Content Understanding applies EXIF 6 on an image
    (history/08), but a JPEG drawn onto a PDF page ignores EXIF. `A02-exif6.jpg` carries
    orientation 6. A small JPEG under 2 MP / 1.5 MB uploads with its EXIF intact (the client only
    re-encodes large images). `exifr.orientation()` reads it; a page drawn at the raw pixel size
    with `/Rotate 90` gives pdf.js a portrait viewport (probe: 200×100 image → 100×200 viewport),
    and CU applies `/Rotate 90` (history/08).
  - The session summary (§10.4) carries `period` and `employeeName`, **not the OIBs** the
    suggestion keys on.
  - `authenticated` may insert only the six upload columns (migration `20260926081337`), so
    `merged_from`, the originals' soft-delete and the insert must happen inside one new
    `security definer` function.

## Solution Statement

- **Shared:** `isMergeable(status, tablesStatus)` and `mergeSuggestions(payslips)` (pure),
  `MERGE_ERROR_CODES`, and `mergeSuggestions` on the session detail response.
- **Database:** one migration adding `public.merge_payslips(…)`: it locks both rows, checks them,
  soft-deletes both, and inserts the merged row with `merged_from` and the earlier original's
  `created_at`. Applied after a transactional dry run; types regenerated.
- **API:**
  - `api/src/services/payslip-merge.ts` builds the combined PDF (`@cantoo/pdf-lib`, `heic-convert`,
    `exifr`);
  - `POST /api/sessions/:id/merge` in `routes/sessions.ts` mirrors the upload route: store the
    source, then write the row, removing the source if the write is refused, then enqueue
    extraction;
  - `GET /api/sessions/:id` adds `mergeSuggestions`;
  - `pdf-lib` is **replaced** by `@cantoo/pdf-lib` at every import (D1).
- **Client:**
  - `client/src/session/` holds `MergeDialog`, `MergeSuggestions` (the banners),
    `SourceThumbnail` and `dismissedSuggestions`;
  - `SessionPage` adds the banners above the rail, the panel's overflow menu, and post-merge
    selection;
  - `mergePayslips()` in `api/client.ts`;
  - hr/en copy, with a guard test for merge error codes.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High. It touches the database, API, shared and client, adds three
dependencies, and swaps the PDF library.
**Primary Systems Affected**:
- `shared/src/{session,api,index}.ts`;
- `supabase/migrations/` (new function), `api/src/database.types.ts`;
- `api/src/{services/payslip-merge.ts, routes/sessions.ts, repositories/payslips.ts, upload/source-file.ts}`;
- `client/src/{session/*, routes/SessionPage.tsx, api/client.ts, review/PageNavigator.tsx, i18n/*}`;
- docs.

**Dependencies** (exact pins, like every existing `api` dependency):
- `api` dependencies: `@cantoo/pdf-lib` **2.11.1** (MIT; replaces `pdf-lib` 1.17.1), `heic-convert`
  **2.1.0** (ISC), `exifr` **7.1.3** (MIT, ships its own types).
- `api` devDependency: `@types/heic-convert` **2.1.1**.
- The lockfile changes; that is expected in this task only.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-26 in the planning session. Do not reopen them without
new evidence.

### D1 — `@cantoo/pdf-lib` replaces `pdf-lib` everywhere (product owner)

- One PDF library, not two. `@cantoo/pdf-lib` is an API-compatible fork of pdf-lib with decryption
  and encryption support.
- **Replace every import:**
  - `api/src/upload/source-file.ts:3`;
  - `api/src/upload/source-file.test.ts:2`;
  - `api/src/routes/payslips.integration.ts:2`;
  - `api/src/routes/extraction.integration.ts:5`.

  Remove `pdf-lib` from `api/package.json`.
- Upload validation keeps its logic unchanged (`ignoreEncryption: true`, then pdf.js's
  `requiresPassword`). The existing `source-file.test.ts` is the regression check for the swap. If a
  test fails only because of a fork difference, fix the call, not the rule, and record it as a
  deviation.
- Merge loads each PDF source with `{ password: "" }` when `isEncrypted`, so a permissions-only
  document is decrypted before its pages are copied. Every source has passed upload validation, so
  none needs a real password. Verify that plain PDFs load without the option (probe: A01, E01).

### D2 — HEIC is converted server-side with `heic-convert` (product owner)

- `image/heic` and `image/heif` sources → `convert({ buffer, format: "JPEG", quality: 0.92 })` →
  `embedJpg`. Pure JS and WASM: no native build on Render or Windows.
- Memory: a 12 MP HEIC decodes to about 48 MB RGBA. That is acceptable on the 512 MB instance for
  two files, sequentially. Convert one source at a time; never `Promise.all` the decodes.
- A HEIC or JPEG that cannot be decoded or embedded → `422 merge_source_unreadable` (D10).

### D3 — What may be merged: anything that is not still extracting (product owner)

- `isMergeable(status, tablesStatus)` in `shared/src/session.ts`:
  - `false` for `processing`;
  - `false` for `review` while `tablesStatus` is `pending`;
  - `true` for every other case: `review` with tables `ready`/`failed`, `confirmed`, and `failed`
    (any tables status).
- This is the same predicate as `SessionPage`'s `isSettled` (`SessionPage.tsx:24-27`). Replace that
  function's body with a call to `isMergeable`, and keep the local name, which says why polling
  stops.
- Rationale: no paid analysis is discarded mid-flight. A failed payslip is a prime candidate, since
  a page 2 alone may be unreadable.
- **Confirmed payslips merge.** The dialog says in words that edits and confirmation on both are
  replaced by a fresh extraction of the combined document.
- Both payslips must be live and in this session. Enforced atomically in the SQL function (D8); the
  route's check is a fast refusal.

### D4 — Page cap: the upload cap applies to the merged PDF (product owner)

- Reject when the combined page count exceeds `config.MAX_PDF_PAGES` (10) with
  **`422 pdf_too_many_pages`**, reusing the upload code, before anything is stored.

### D5 — Suggestions are computed on the server (product owner)

- `mergeSuggestions(payslips: readonly MergeCandidate[]): [string, string][]` in
  `shared/src/session.ts`, pure. `MergeCandidate = Pick<Payslip, "id" | "status" | "tablesStatus" |
  "period" | "employeeOib" | "employerOib">`.
- A pair `(a, b)` is suggested when all of these hold:
  - both are **readable and settled**: `review` or `confirmed`, and `isMergeable`;
  - `a.period` and `b.period` are non-null and equal;
  - and either:
    - both `employeeOib` are non-null and equal, **or**
    - at least one `employeeOib` is null (null or missing, "unread"), and both `employerOib` are
      non-null and equal.
- Two present but **different** employee OIBs never match, even with the same employer and period.
  That is two employees.
- OIBs compare as trimmed strings.
- Pairs come in list (upload) order, `a` before `b`, and every matching pair is returned. Three
  pages give three pairs. That is fine: the rule stays simple, and after one merge the re-extracted
  payslip pairs with the third.
- `GET /api/sessions/:id` computes it over `listBySession`'s `payslip` objects, which already carry
  the canonical fields, and returns `mergeSuggestions: [[idA, idB], …]`. The OIBs never leave the
  server in the summary.
- **Response schema:** `mergeSuggestions: z.array(z.tuple([z.uuid(), z.uuid()])).default([])`. The
  default is load-bearing: the static client can deploy before the API, and a new bundle must parse
  an old API's body (the `shared/src/api.ts:6-30` stale-bundle rule, in the other direction).

### D6 — A dismissal lasts for the tab (product owner)

- `client/src/session/dismissedSuggestions.ts`: a module-level `Set<string>` of pair keys
  (`${a}:${b}` in the suggestion's order), plus a hook `useDismissedSuggestions()` returning
  `{ dismissed: ReadonlySet<string>, dismiss(key) }`. The hook mirrors the module set into React
  state so the banner re-renders. It survives route changes and is lost on reload.
- Export a `resetDismissedSuggestions()` for tests only.
- Payslip ids are UUIDs, so a dismissal can never match another session's or another user's pair.
- No persistence, no endpoint, no migration.

### D7 — The merged payslip takes the earlier original's place (product owner)

- Its `created_at` is the earlier `created_at` of the two originals (not "first in page order"), so
  the rail position of the earlier one is kept and later payslips do not renumber.
- `created_at` is the upload-order key everywhere (`listBySession`, and later history).
- After a merge the client selects the merged payslip with **URL replacement** (D11).

### D8 — One atomic `security definer` function writes the merge

- `public.merge_payslips(p_session_id uuid, p_new_id uuid, p_order uuid[], p_original_filename text,
  p_page_count integer) returns boolean`. Written exactly in step 4. Order of work:
  1. lock the two rows `for update` in id order;
  2. check both are the caller's, live, in the session and mergeable (D3);
  3. soft-delete both;
  4. **then** insert the merged row. Soft-deleting first frees two slots, so a full session (10 live
     payslips) can merge. The insert trigger counts live payslips only (ROADMAP Task 11 scope,
     Task 03 D3).
- `merged_from = p_order` (page order), `content_type = 'application/pdf'`, and the status columns
  keep their defaults (`processing`, `pending`, empty data).
- Returns `false` for anything not mergeable now. A concurrent second merge of the same payslip waits
  on the row lock, then finds it deleted, returns `false`, and gets `409`. Only one analysis is paid
  for.
- Grants follow the Task 09 pattern: `revoke execute … from public, anon; grant execute … to
  authenticated;`.
- The function accepts any `p_page_count` ≥ 1 and filename. A direct RPC can only mislabel the
  caller's own new row, which has no source at that path, and the ROADMAP §5 direct-write row
  already records this class ("on the caller's own payslip only").

### D9 — Building the combined PDF (`api/src/services/payslip-merge.ts`)

- `combineSources(sources: readonly MergeSource[]): Promise<CombinedSource>`, where
  `MergeSource = { bytes: Buffer; contentType: SourceContentType }` and
  `CombinedSource = { bytes: Buffer; pageCount: number }`. The sources are in page order.
- **PDF:** load (D1), then `copyPages(source, source.getPageIndices())`. Each page keeps its size and
  its `/Rotate` (A03-rotate90 keeps 90°).
- **Image:** one page per image. HEIC is converted first (D2); JPEG is embedded with `embedJpg`,
  PNG with `embedPng`.
  - Page geometry: scale `s = 842 / max(width, height)`, so the page's long edge is A4's 842 pt. The
    page is `[width·s, height·s]` and the image is drawn to fill it. The full pixel resolution is
    kept, only the declared page size shrinks. This keeps a 4000 px photo from becoming a 55-inch
    page. Content Understanding documents no PDF page-size limit (service-limits page), but DI
    layout historically capped PDFs at 17×17 in, and A4 costs nothing.
  - **EXIF (JPEG only):** `await exifr.orientation(bytes)`. `3 → setRotation(degrees(180))`,
    `6 → degrees(90)`, `8 → degrees(270)`. Anything else, `undefined` included, is left as drawn. The
    mirrored orientations (2, 4, 5, 7) are not produced by phone cameras and stay unrotated.
  - Converted HEIC output carries no EXIF and is upright (A02.heic probe), so it is not rotated.
- **Errors:** any failure to load, convert or embed a source throws `MergeSourceError` (a small
  class in the same module). The route maps it to `422 merge_source_unreadable`.
- **`originalFilename`:** a helper `mergedFilename(first, second)` returns `` `${first} + ${second}` ``
  sliced to 255 characters, in page order (product owner).

### D10 — Error codes

- `MERGE_ERROR_CODES = ["merge_not_allowed", "merge_source_unreadable", "pdf_too_many_pages"] as
  const` in `shared/src/api.ts`, exported from `shared/src/index.ts`. The last code reuses the upload
  code (D4).
- Route responses:
  - `400 invalid_request`: bad id or body, including the schema's refinements.
  - `404 not_found`: session missing, foreign or deleted, checked before anything else, as the
    upload route does.
  - `409 merge_not_allowed`:
    - either id is not a live payslip of this session (including another user's payslip; it falls
      out of the owner-scoped list);
    - either is not mergeable (D3);
    - the SQL function returned `false`.
  - `422 pdf_too_many_pages` (D4).
  - `422 merge_source_unreadable` (D9).
  - `202 {id, status: "processing"}` on success.
- Client copy lives under `merge.errors.<code>` plus `merge.errors.network`, guarded by
  `client/src/i18n/mergeErrors.test.ts` (mirror `uploadErrors.test.ts`, allowing the extra
  `network` key).

### D11 — Client flow

- **Where:**
  - banners (`MergeSuggestions`) sit between the session heading and the rail;
  - the overflow `ActionMenu` (icon variant, label "Payslip actions") sits beside the tabpanel's
    `<h2>` (`SessionPage.tsx:235-237`);
  - the heading row becomes `flex items-start justify-between gap-2`.
- **Manual entry (product owner):**
  - the menu has one item, **"Merge with another payslip…"** (`Combine` icon from lucide-react);
  - it renders only when the selected payslip `isMergeable` and at least one other payslip in the
    session is mergeable. Otherwise the menu is absent, since a menu of disabled items helps no one;
  - it opens `MergeDialog` at the **pick** step: a radio group of the other mergeable payslips,
    labelled as the rail labels them (position, period or filename, status text). After a choice,
    Continue goes to the **confirm** step.
- **Suggestion entry (product owner):**
  - one banner per undismissed pair: `<div role="status">` with the text "Payslips {{a}} and {{b}}
    look like pages of one payslip." (positions);
  - two buttons: **Review merge** opens `MergeDialog` straight at the confirm step with the pair,
    and **Not now** calls `dismiss(key)`;
  - hide a banner whose ids are not both in the current list.
- **Confirm step (product owner):**
  - two cards in page order, starting in upload order (list order), each showing:
    - a `SourceThumbnail`;
    - "Page {{n}}" (merged page position);
    - "Payslip {{index}}";
    - the filename;
    - the page count ("{{count}} page(s)", plural keys);
  - a **Swap order** button between them (`ArrowUpDown` icon, `aria-label` from copy, ≥ 48 px);
    after a swap, a visually-hidden `role="status"` announces the new order;
  - a consequence paragraph: "The two payslips are replaced by one. It is read again from the
    combined document, so edits, unsaved changes and confirmation on both are discarded.";
  - buttons: **Cancel** (initial focus, as `ConfirmDialog`) and **Merge** (accent colour, not red:
    this is not a delete). While the request runs, `aria-disabled` and a spinner are shown, and
    Escape and backdrop are ignored.
- **Dialog mechanics:** a native `<dialog>` opened with `showModal()`, mirroring `ConfirmDialog`
  (`client/src/components/ConfirmDialog.tsx`): `aria-labelledby`, Escape routed through `onCancel`,
  and the backdrop click cancels. Focus returns to the opener: the menu trigger, or the banner's
  button. It is a new component because `ConfirmDialog` takes only a string description.
- **Request:** `mergePayslips(sessionId, { payslipIds: [a, b], order })`, where `payslipIds` is the
  pair in list order and `order` is the displayed order.
- **On success** (`202 {id}`):
  1. close the dialog;
  2. `setSearchParams({ payslip: id }, { replace: true })`;
  3. store `[a, b]` in a `discardedIds` state;
  4. bump `refreshKey` so polling restarts.

  A `useEffect` on `discardedIds` calls `keep(id, null)` for both originals.

  **GOTCHA:** it must run in an effect, not in the handler. `PayslipForm` hands over its snapshot in
  its unmount cleanup (`keep(id, edits)`), and that runs in the same commit that removes the
  selected original. Parent effects run after child cleanups, so an effect on the parent overwrites
  it with `null`; a call in the click handler would be overwritten by the snapshot. This clears the
  unsaved mark and the reload guard. `useUnsavedEdits` already exposes `keep`
  (`client/src/review/unsaved/UnsavedEditsContext.ts`).

  The merged payslip is `processing`, so its panel shows the processing text until the scalars
  pass lands.
- **On error:**
  - the dialog stays open and shows `merge.errors.<code>` in `role="alert"`, with unknown or network
    errors falling back to `merge.errors.network`;
  - on `409` also bump `refreshKey`, so the list shows why;
  - technical detail goes to `console.error` only (standing rule).

### D12 — `SourceThumbnail`

- Props: `{ payslipId: string; label: string }`. It calls `getPayslipSource(payslipId)`:
  - **image:** `<img alt="" className="block h-40 w-auto max-w-full object-contain">`. `onError`
    (HEIC outside Safari) falls back to a file card: a `FileImage` icon and the text
    `merge.noPreview`;
  - **PDF:** `loadPdfDocument(url, signal)`, then render page 1 with the exported
    `PageThumbnail`;
  - while loading: `Skeleton`. On failure: the same file card, plus `console.error`.
- Clean up: abort the fetch and `destroy()` the loaded PDF on unmount, as in `PdfSource.tsx`.
- **`PageThumbnail`** (`client/src/review/PageNavigator.tsx:12`) gains an exported signature with an
  optional `width = 64` (CSS px, used in both the scale and the class via inline style). The
  navigator keeps 64 unchanged; the dialog passes 112.

### D13 — Paid runs (product owner, standing rule)

- **This implementing session: $0.**
  - The route integration tests use the existing no-op extraction runner (`payslips.integration.ts:52`).
  - The service tests build their PDFs and images in memory.
  - The B01, A02.heic and A02-exif6 checks are local probes over git-ignored `payslip_examples/`,
    with no provider call.
- **The review session** (journey 9.10): at most **three** paid analyses-worth of documents, about
  **$0.15**.
  - Split `E01.pdf` (two pages) into two single-page PDFs locally and upload both to a throwaway
    account. That is two payslips, two two-pass analyses.
  - Expect a suggestion if both pages carry OIB and period, otherwise merge manually.
  - Merge: one more two-pass analysis of a two-page PDF.
  - Log the cost and delete the throwaway data.

### D14 — Session split (standing rule)

This implementing session does **not** run `/code-review`, `/validate` or any browser journey, and
does not commit. It runs `npm run validate`, `npm run build`, the targeted tests, the hosted
integration suite (`npm run test:integration`, no paid calls) and the migration dry run and apply.
It records all of them in `history/11-*.md`, then stops.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Shared**
- `shared/src/api.ts` (lines 6-30, 93-121, 175-203) — Why: the stale-bundle rule
  (`.strip()`/defaults), the session summary and detail schemas to extend, and the existing merge
  request schema (keep it as is).
- `shared/src/session.ts` (whole, 78 lines) — Why: `isMergeable` and `mergeSuggestions` go here, next
  to the status machine and `isRetryableFailure`.
- `shared/src/payslip.ts` (lines 60-130) — Why: `employerOib`, `employeeOib`, `period` are optional
  and nullable canonical fields; `Payslip` type.
- `shared/src/upload.ts` — Why: `UPLOAD_ERROR_CODES` pattern for `MERGE_ERROR_CODES`.
- `shared/src/index.ts` — Why: every new export is listed here.
- `shared/src/api.test.ts` (line 164 on) and `shared/src/session.test.ts` — Why: test style.

**Database**
- `supabase/migrations/20260926065611_server_side_payslip_writes.sql` (whole) — Why: the definer
  function pattern, the `auth.uid()` rule, comments and grants to mirror exactly.
- `supabase/migrations/20260924102451_enforce_session_cap_on_update.sql` — Why: the cap trigger. It
  returns early for rows with `deleted_at` set and counts only live rows, which is why the
  soft-delete must come first.
- `supabase/migrations/20260926081337_revoke_direct_payslip_updates.sql` — Why: only six insertable
  columns, so the insert must be in the definer function.
- `supabase/migrations/20260924100541_create_sessions_and_payslips.sql` (lines 11-75) — Why: column
  names, defaults and checks (`merged_from uuid[]`, `content_type` check).
- `.agents/plans/09-review-form-two-way-linking.md` (lines 680-692) — Why: the dry run → apply →
  rename → `list_migrations` → advisors → type regeneration procedure.

**API**
- `api/src/routes/sessions.ts` (whole) — Why: the upload route is the pattern for the merge route
  (store, write, cleanup on refusal, enqueue, response). Summary mapping at lines 117-132.
- `api/src/routes/payslips.ts` (lines 98-141) — Why: the retry route. Downloading the source bytes
  before the state change is the same shape.
- `api/src/repositories/payslips.ts` (lines 112-195, 307-331) — Why: the RPC wrapper pattern
  (`softDelete`, `beginRetry`), the `PayslipRepositoryError` codes, `listBySession`,
  `findSourceById`.
- `api/src/storage/payslip-sources.ts` — Why: `sourceObjectPath`, `uploadSource`, `downloadSource`,
  `removeSource`.
- `api/src/upload/source-file.ts` (whole) — Why: the pdf-lib import to swap. `config.MAX_PDF_PAGES`.
- `api/src/services/payslip-extraction.ts` (lines 19-33) — Why: the `ExtractionJob` shape to enqueue.
- `api/src/middleware/error-handler.ts` — Why: `HttpError(status, code)`.
- `api/src/routes/payslips.integration.ts` (lines 1-110, plus the `upload`, `pdf`, `createAndSignIn`
  helpers at its end; the pass-completion tests near 391-430) — Why: the hosted-suite setup, cleanup
  discipline (`sourcePaths`), how to put a payslip into `review` (`completeExtractionPass` with
  `mappedPass` from `regions.fixture.ts`) or `failed` (`failExtraction` plus
  `failTablesExtraction`).
- `api/src/routes/direct-writes.integration.ts` — Why: proves the grants. Add the cross-user RPC
  case here.
- `api/src/upload/source-file.test.ts` — Why: the swap's regression tests, and how PDFs are built in
  tests.

**Client**
- `client/src/routes/SessionPage.tsx` (whole) — Why: where the banners, menu, dialog and post-merge
  selection go. `isSettled` at 24-27, the selection effect at 151-154, the panel heading at 235-237.
- `client/src/routes/SessionPage.test.tsx` (1-60 and the retry tests) — Why: the mock setup
  (`vi.mock("../api/client")`, `useUnsavedEdits` mock, `summary()` helper).
- `client/src/components/ActionMenu.tsx` and `ActionMenu.test.tsx` — Why: the menu to reuse, and its
  tests.
- `client/src/components/ConfirmDialog.tsx` — Why: the native `<dialog>` pattern `MergeDialog`
  mirrors.
- `client/src/review/PayslipRail.tsx` (lines 118-146) — Why: the chip label (period via
  `formatField` or filename) and `statusIcon`, reused in the picker.
- `client/src/review/PageNavigator.tsx` (lines 12-58) — Why: `PageThumbnail` to export with a width.
- `client/src/review/pdfDocument.ts` (lines 36-101) — Why: `LoadedPdf`, `loadPdfDocument`,
  `destroy`, `isRenderCancellation`.
- `client/src/review/PdfSource.tsx` — Why: load and cleanup lifecycle for a PDF source.
- `client/src/review/unsaved/UnsavedEditsContext.ts` and `UnsavedEditsProvider.tsx` — Why: `keep`,
  and why snapshots land in unmount cleanups.
- `client/src/api/client.ts` (lines 116-208) — Why: the request/parse pattern for `mergePayslips`.
- `client/src/i18n/uploadErrors.test.ts` — Why: the guard to mirror.
- `client/src/i18n/locales/en.json`, `hr.json` — Why: the `session` block style. Every key exists in
  both.

### New Files to Create

- `supabase/migrations/<timestamp>_merge_payslips.sql` — the D8 function.
- `api/src/services/payslip-merge.ts` — `combineSources`, `mergedFilename`, `MergeSourceError`.
- `api/src/services/payslip-merge.test.ts` — unit tests (in-memory fixtures).
- `client/src/session/MergeDialog.tsx` + `MergeDialog.test.tsx`.
- `client/src/session/MergeSuggestions.tsx` + `MergeSuggestions.test.tsx`.
- `client/src/session/SourceThumbnail.tsx` + `SourceThumbnail.test.tsx`.
- `client/src/session/dismissedSuggestions.ts` + `dismissedSuggestions.test.ts`. Its stem differs
  from every component's stem (the Windows case-collision lesson, history/10 deviation 4).
- `client/src/i18n/mergeErrors.test.ts`.
- `.agents/history/11-merge-payslips.md`.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [@cantoo/pdf-lib README](https://github.com/cantoo-scribe/pdf-lib#readme) — the `load` options
  (`password`, `ignoreEncryption`) and `encrypt()`. Why: D1, and the encrypted-PDF unit test.
- [pdf-lib API: PDFDocument.copyPages, embedJpg, embedPng, PDFPage.setRotation](https://pdf-lib.js.org/docs/api/classes/pdfdocument)
  — Why: D9 (the fork keeps this API).
- [heic-convert README](https://github.com/catdad-experiments/heic-convert#readme) — Why: D2 call
  shape (`{ buffer, format, quality }`, resolves to an ArrayBuffer or Buffer; wrap with
  `Buffer.from`).
- [exifr README, "orientation"](https://github.com/MikeKovarik/exifr#orientation) — Why: D9, which
  returns `undefined` when absent.
- [Content Understanding service limits](https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits#input-file-limits)
  — Why: PDF ≤ 300 pages / 200 MB async. No page-size limit is stated (D9 geometry note).
- [MDN `<dialog>`, `showModal()`](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog) —
  Why: D11 modality and focus.
- [WAI-ARIA APG Radio Group](https://www.w3.org/WAI/ARIA/apg/patterns/radio/) — Why: the picker uses
  native `<input type="radio">` inside `<fieldset><legend>`, which gets the pattern for free.

### Patterns to Follow

**Definer function** (from `20260926065611_server_side_payslip_writes.sql`):
```sql
create function public.soft_delete_payslip(p_payslip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$ … where id = p_payslip_id and user_id = (select auth.uid()) and deleted_at is null; …
revoke execute on function public.soft_delete_payslip(uuid) from public, anon;
grant execute on function public.soft_delete_payslip(uuid) to authenticated;
```

**RPC wrapper** (`repositories/payslips.ts:307-315`): `rpc(...)`, then
`if (error) throw new PayslipRepositoryError("query_failed", error); return data === true;`, with
ids passed through `uuidSchema.parse`.

**Store → write → clean up** (`routes/sessions.ts:53-83`): upload the source first. If the row write
fails with anything but `invalid_data`, `removeSource` it and log a cleanup failure with
`logger.warn({ err }, "orphaned payslip source")`. The extraction is enqueued with `void` only after
the write succeeded.

**Error responses**: `throw new HttpError(409, "merge_not_allowed")`. Never prose.

**Response schemas**: `.strip()` on every response the browser parses. Requests `.strict()`.

**Client API call** (`api/client.ts:169-175`): `request(path, { method, headers, body })` →
`parseResponse(schema, response, "POST /api/sessions/:id/merge")`.

**Copy**: every string is an `en` + `hr` key pair. Croatian tone matches the existing
`session.*` keys. hr terms: "Spoji" (merge), "Spajanje platnih listi", "Zamijeni redoslijed"
(swap order), "Stranica" (page), "Isplatna lista" is **not** used; the app says "platna lista".
Read `hr.json`'s `session` block before writing, and reuse its words.

**Busy buttons**: `aria-disabled`, never `disabled` (Task 07 DoD).

**Tests**: vitest, `@testing-library/react`, `vi.mock` of `../api/client` with a local `ApiError`
class (see `SessionPage.test.tsx:10-21`). jsdom has no `showModal`: stub
`HTMLDialogElement.prototype.showModal` and `close` in the dialog tests, as the `ConfirmDialog`
comment warns (only wiring is testable in jsdom).

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation
Dependencies and the pdf-lib swap, then the shared predicates, schemas and codes.

### Phase 2: Core implementation
The migration (dry run, apply, types), the combine service, the repository method, the merge route
and the session suggestions.

### Phase 3: Client
API call, `PageThumbnail` export, `SourceThumbnail`, dismissals, `MergeSuggestions`, `MergeDialog`,
`SessionPage` wiring, copy.

### Phase 4: Testing, docs and validation
Integration tests on the hosted project, the docs, the full local validation, and the history file.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

### 1. VERIFY the starting state

- `git status --short`: clean except this plan.
- `npm run validate`. Record the file and test counts (history/10 ended at 63 files / 922 tests).
- **VALIDATE**: green.

### 2. UPDATE `api/package.json` and the lockfile (D1, D2)

- `npm uninstall pdf-lib --workspace @payslip/api`, then
  `npm install --save-exact @cantoo/pdf-lib@2.11.1 heic-convert@2.1.0 exifr@7.1.3 --workspace @payslip/api`,
  then `npm install --save-exact --save-dev @types/heic-convert@2.1.1 --workspace @payslip/api`.
- Replace `from "pdf-lib"` with `from "@cantoo/pdf-lib"` at the four sites listed in D1.
- **GOTCHA:** check that no root or other workspace `package.json` lists `pdf-lib`
  (`grep -rn '"pdf-lib"' --include=package.json . | grep -v node_modules` → none).
- **VALIDATE**:
  - `npm run typecheck`;
  - `npx vitest run api/src/upload`, the D1 regression check;
  - `grep -rn 'from "pdf-lib"' api scripts shared client/src` → empty.

### 3. ADD shared merge rules and contracts (D3, D5, D10)

- `shared/src/session.ts`:
  - `export function isMergeable(status: PayslipStatus, tablesStatus: TablesStatus): boolean`, with a
    doc comment citing plan 11 D3. It returns false for `processing`, and for `review` while
    `tablesStatus === "pending"`.
  - `export type MergeCandidate = Pick<Payslip, "id" | "status" | "tablesStatus" | "period" |
    "employeeOib" | "employerOib">`. Import the `Payslip` **type** from `./payslip.js`, and check that
    this creates no runtime import cycle (`payslip.ts` imports from `session.ts`; a type-only import
    is erased).
  - `export function mergeSuggestions(payslips: readonly MergeCandidate[]): [string, string][]`, the
    D5 rule. A small local `known(value)` returns the trimmed string or `null`.
- `shared/src/api.ts`:
  - `sessionDetailResponseSchema` gains
    `mergeSuggestions: z.array(z.tuple([z.uuid(), z.uuid()])).default([])` with a comment on the
    D5 deploy-order reason;
  - `MERGE_ERROR_CODES` + `mergeErrorCodeSchema` + `MergeErrorCode` (D10).
- `shared/src/index.ts`: export `isMergeable`, `mergeSuggestions`, `MergeCandidate`,
  `MERGE_ERROR_CODES`, `mergeErrorCodeSchema`, `MergeErrorCode`.
- Tests:
  - `shared/src/session.test.ts`: `isMergeable` over every status × tables status (a table-driven
    `it.each`).
  - `mergeSuggestions`:
    - same employee OIB + period → pair;
    - different periods → none;
    - different employee OIBs, same employer → none;
    - one employee OIB null, same employer OIB + period → pair;
    - both employee OIBs null, employer OIBs differ → none;
    - period null on either → none;
    - one side `processing`, `failed`, or `review` + tables `pending` → none;
    - `confirmed` + `review` (tables ready) → pair;
    - three matching → three pairs in list order;
    - OIB whitespace trimmed.
  - `shared/src/api.test.ts`: the session detail without `mergeSuggestions` parses to `[]`, with
    pairs parses, and a non-uuid is rejected.
- **VALIDATE**: `npx vitest run shared`, `npm run typecheck`.

### 4. CREATE the migration, dry run, apply, regenerate types (D7, D8)

- File `supabase/migrations/<now UTC, YYYYMMDDHHMMSS>_merge_payslips.sql`:

```sql
-- Task 11 (plan 11 D8): a merge replaces two payslips with one in a single transaction. The
-- originals are soft-deleted before the insert, because the session cap counts live payslips only
-- and a full session must still be able to merge. `authenticated` may insert only the six upload
-- columns (migration `revoke_direct_payslip_updates`), so `merged_from` and `created_at` are
-- written here. Security definer: RLS does not apply inside, so every statement filters
-- `user_id = (select auth.uid())`, which is the ownership check.
--
-- Mergeable means not still extracting: not `processing`, and not `review` while the tables pass
-- is pending (plan 11 D3, `isMergeable` in shared/src/session.ts). The merged row takes the
-- earlier original's `created_at`, keeping its place in upload order (D7).
create function public.merge_payslips(
  p_session_id uuid,
  p_new_id uuid,
  p_order uuid[],
  p_original_filename text,
  p_page_count integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_created_at timestamptz;
begin
  if cardinality(p_order) <> 2 or p_order[1] = p_order[2] then
    return false;
  end if;

  -- In id order, so two merges sharing a payslip cannot deadlock. The second waits, then finds
  -- the row deleted.
  perform 1
  from public.payslips
  where id = any (p_order)
    and user_id = (select auth.uid())
  order by id
  for update;

  select count(*), min(created_at)
  into v_count, v_created_at
  from public.payslips
  where id = any (p_order)
    and user_id = (select auth.uid())
    and session_id = p_session_id
    and deleted_at is null
    and status <> 'processing'
    and not (status = 'review' and tables_status = 'pending');

  if v_count <> 2 then
    return false;
  end if;

  update public.payslips
  set deleted_at = now(),
      updated_at = now()
  where id = any (p_order)
    and user_id = (select auth.uid());

  insert into public.payslips (
    id, session_id, user_id, original_filename, content_type, page_count, merged_from, created_at
  )
  values (
    p_new_id, p_session_id, (select auth.uid()), p_original_filename, 'application/pdf',
    p_page_count, p_order, v_created_at
  );

  return true;
end;
$$;

revoke execute on function public.merge_payslips(uuid, uuid, uuid[], text, integer)
  from public, anon;
grant execute on function public.merge_payslips(uuid, uuid, uuid[], text, integer)
  to authenticated;
```

- **Dry run:** `mcp__supabase__execute_sql` with `begin; <file contents>; rollback;`, then confirm
  the function does not exist (`select to_regprocedure('public.merge_payslips(uuid,uuid,uuid[],text,integer)')`
  → null).
- **Apply:** `mcp__supabase__apply_migration` named `merge_payslips`. Rename the local file to the
  version `list_migrations` records.
- **Types:** `mcp__supabase__generate_typescript_types`. Change **only** the `Functions` section of
  `api/src/database.types.ts` (one entry added), keeping the file's style.
- **VALIDATE**:
  - `list_migrations` shows it once;
  - `get_advisors` (security): no new error beyond `auth_leaked_password_protection`, and record any
    definer notice verbatim;
  - `npm run typecheck`.

### 5. CREATE `api/src/services/payslip-merge.ts` (D1, D2, D9)

- Imports:
  - `import { PDFDocument, degrees } from "@cantoo/pdf-lib";`
  - `import convert from "heic-convert";`
  - `import exifr from "exifr";`
  - `import type { SourceContentType } from "@payslip/shared";`
- Exports: `MergeSource`, `CombinedSource`, `MergeSourceError extends Error` (`name =
  "MergeSourceError"`, `cause` kept), `combineSources`, `mergedFilename`.
- `combineSources`: create a document, then for each source in order (sequential `for … of`, D2):
  - PDF: `PDFDocument.load(bytes, …)`, decrypting per D1, then `copyPages` and `addPage` each;
  - image: embed per D9 and add one page;
  - wrap each source's work in `try/catch → throw new MergeSourceError(cause)`.

  Return `{ bytes: Buffer.from(await doc.save()), pageCount: doc.getPageCount() }`.
- A module comment must explain:
  - why the fork (B01 measurement);
  - why A4 geometry;
  - why EXIF becomes `/Rotate` (CU applies `/Rotate`, history/08);
  - why HEIC is not rotated.
- **GOTCHA:** `exifr.orientation` on a PNG or a JPEG without EXIF resolves `undefined`. Call it only
  for `image/jpeg`.
- **GOTCHA:** `heic-convert` accepts a `Buffer` and resolves an `ArrayBuffer`-like, so wrap it with
  `Buffer.from(...)` before `embedJpg`.
- **VALIDATE**: `npm run typecheck`.

### 6. CREATE `api/src/services/payslip-merge.test.ts`

- Fixtures built in the test:
  - `pdf(pages, size)` with `@cantoo/pdf-lib`, giving pages distinct sizes so order is observable;
  - a 1×1 PNG from base64
    `iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=`;
  - a header-only JPEG helper. pdf-lib's `embedJpg` reads only the markers, so no pixel data is
    needed. Verified in planning (`exifr` → 6, `embedJpg` → 200×100, pdf.js viewport 100×200 after
    `degrees(90)`):

```ts
function jpeg(width: number, height: number, orientation?: number): Buffer {
  const segment = (marker: number, body: Buffer) =>
    Buffer.concat([
      Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 255]),
      body,
    ]);
  const parts = [Buffer.from([0xff, 0xd8])];
  if (orientation !== undefined) {
    // "Exif\0\0", a big-endian TIFF header, and IFD0 with one entry: Orientation (0x0112), SHORT.
    const tiff = Buffer.from([
      0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0,
      0, 0, 0, 0,
    ]);
    parts.push(segment(0xe1, Buffer.concat([Buffer.from("Exif\0\0", "binary"), tiff])));
  }
  parts.push(
    segment(0xc0, Buffer.from([8, height >> 8, height & 255, width >> 8, width & 255, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0])),
  );
  parts.push(Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}
```

- Cases:
  1. Two PDFs (2 pages + 1 page) → 3 pages in order, checked by page sizes.
  2. PDF + PNG → 2 pages. The image page's long edge is 842 and its aspect ratio is preserved.
  3. JPEG with orientation 6 → rotation 90. With 3 → 180, with 8 → 270, with none → 0.
  4. **Encrypted PDF.**
     - Build a PDF with text drawn by `StandardFonts.Helvetica`, then encrypt it with the fork's
       `encrypt({ userPassword: "", ownerPassword: "owner", permissions: { modifying: false } })`
       (check the exact API in the README).
     - Combine it with a PNG.
     - Read page 1's text with `pdfjs-dist/legacy/build/pdf.mjs` `getTextContent()`. It must
       contain the drawn text.
     - If the fork cannot produce such a PDF, replace the case with the local B01 probe (step 13)
       and record the deviation.
  5. HEIC: `vi.mock("heic-convert", () => ({ default: vi.fn(async () => jpegBuffer) }))`. An
     `image/heic` and an `image/heif` source each call it once, with `format: "JPEG"`, and produce
     one page.
  6. Undecodable input: garbage bytes as `application/pdf`, or as `image/png` → `MergeSourceError`.
  7. `mergedFilename`: joins in order with " + ", and slices to 255.
- **VALIDATE**: `npx vitest run api/src/services/payslip-merge.test.ts`.

### 7. ADD `PayslipRepository.merge` (D8)

- In `api/src/repositories/payslips.ts`, after `beginRetry`:

```ts
export interface MergePayslipsInput {
  readonly sessionId: string;
  readonly id: string;
  /** Page order; also stored as `merged_from`. */
  readonly order: readonly [string, string];
  readonly originalFilename: string;
  readonly pageCount: number;
}
```

  `async merge(input: MergePayslipsInput): Promise<boolean>` calls `rpc("merge_payslips", {
  p_session_id, p_new_id, p_order: [...order], p_original_filename, p_page_count })` with every id
  `uuidSchema.parse`d. Doc comment: plan 11 D8, `false` means not mergeable now or not found.
- **VALIDATE**: `npm run typecheck`.

### 8. ADD the merge route and suggestions to `api/src/routes/sessions.ts` (D4, D5, D9, D10)

- `GET /:id`: add `mergeSuggestions: mergeSuggestions(payslips.map(({ payslip }) => payslip))` to
  the body.
- `POST /:id/merge`, registered after `/:id/payslips`:
  1. Parse `id` with `idSchema` and the body with `mergePayslipsRequestSchema`. Failure → `400
     invalid_request`.
  2. `SessionRepository.findById` → `404 not_found` when null.
  3. `repository.listBySession(session.id)`. Find both `payslipIds`. If either is missing or either
     is `!isMergeable(payslip.status, payslip.tablesStatus)` → `409 merge_not_allowed`.
  4. `findSourceById` for both ids in `order` (`null` → `409 merge_not_allowed`: it vanished).
     `downloadSource` both, in parallel (bytes only).
  5. `combineSources` in `order`. A `MergeSourceError` → `422 merge_source_unreadable`. If
     `pageCount > config.MAX_PDF_PAGES` → `422 pdf_too_many_pages`.
  6. `const id = randomUUID()`, then `uploadSource(auth.client, sourceObjectPath(auth.userId, id),
     bytes, "application/pdf")`.
  7. `repository.merge({ sessionId, id, order, originalFilename: mergedFilename(first.originalFilename,
     second.originalFilename), pageCount })`. On `false`, or a thrown error, remove the source,
     mirroring lines 68-78 including the orphan warning, then `409 merge_not_allowed` (or rethrow).
  8. `void extraction.enqueue({ payslipId: id, repository, bytes, contentType: "application/pdf" })`.
  9. `202` with `MergePayslipsResponse` `{ id, status: "processing" }`.
- Doc comment on the route: PRD §10.11, plan 11 D3/D4/D8. The route checks are fast refusals, and
  `merge_payslips` is authoritative. The originals' sources are kept, like a soft delete
  (`routes/payslips.ts:237`).
- One structured log line on success, carrying no document contents:
  `logger.info({ payslipId: id, mergedFrom: order, pageCount }, "payslips merged")`.
- **GOTCHA:** the original filenames come from `listBySession`'s `originalFilename`, which is already
  normalised.
- **VALIDATE**: `npm run typecheck && npx vitest run api`. `app.test.ts` must still pass.

### 9. ADD hosted integration tests

- `api/src/routes/payslips.integration.ts`: a new `describe("merge (PRD §10.11, plan 11)")` using
  its own session, with every source path pushed to `sourcePaths`.
- Setup:
  - upload three payslips (a 1-page PDF, a PNG from the 1×1 base64, and another 1-page PDF). The
    file's fake `jpeg` constant is **not** decodable, so do not use it here;
  - put two into a mergeable state as user A through `new PayslipRepository(userA, userAId)`: one
    `review` via `completeExtractionPass` with `mappedPass`, as the existing pass tests do (scalars
    **and** tables so tables are `ready`), and one `failed` via `failExtraction` + `failTablesExtraction`.
- Cases:
  1. `processing` payslip in the pair → `409 merge_not_allowed`.
  2. Merge the two mergeable ones with `order` reversed → `202 { id, status: "processing" }`.
     Afterwards:
     - both originals `GET` → 404;
     - the session lists the merged payslip in the **earlier** original's position, with
       `pageCount` 2 and `originalFilename` "`<second> + <first>`";
     - the stored source downloads as a PDF with 2 pages;
     - with `admin`, the row has `merged_from` equal to the order and `created_at` equal to the
       earlier original's.
  3. Merging again with an original id → 409.
  4. A payslip from another session of user A → 409; user B with A's session → 404; user B's token
     with its own session and A's payslip ids → 409.
  5. Concurrent: two parallel merges of the same pair (fresh pair) → exactly one 202 and one 409.
  6. Page cap: a 10-page PDF + a 1-page PDF, both failed → `422 pdf_too_many_pages`, both still live.
  7. Full session: ten payslips, two failed → merge returns 202 and the session holds nine.
     Reuse `fullSessionId` if its payslips can be failed; otherwise create one. Keep the upload
     count modest; storage is cleaned by `sourcePaths`.
  8. `mergeSuggestions` in `GET /api/sessions/:id`: two `review` payslips completed with the same
     `employeeOib` and `period` in their scalars → one pair. Build the pass fields by spreading
     `mappedPass`'s fields with overrides.
- `api/src/routes/direct-writes.integration.ts`: user B calling `rpc("merge_payslips", …)` with user
  A's ids → `false`, and A's rows unchanged.
- **VALIDATE**: `npm run test:integration`, all green. Report the counts (history/10: auth 3,
  payslips 45, direct writes 4), then run the orphan check the suite documents.

### 10. CLIENT: API call, thumbnail export, dismissals

- `client/src/api/client.ts`: `mergePayslips(sessionId: string, body: MergePayslipsRequest):
  Promise<MergePayslipsResponse>`, a POST with a JSON body parsed by `mergePayslipsResponseSchema`.
  Add a test in `client/src/api/client.test.ts` mirroring an existing POST test.
- `client/src/review/PageNavigator.tsx`: `export function PageThumbnail({ document, page, width = 64
  })`. The scale uses `width`; the canvas class drops `w-16` for `style={{ width, aspectRatio:
  ratio }}` with `className="block max-w-full"`. The navigator call is unchanged.
  `PageNavigator.test.tsx` must pass unchanged.
- `client/src/session/dismissedSuggestions.ts` + test (D6): dismiss, then read through a second
  hook instance; reset for tests.
- **VALIDATE**: `npx vitest run client/src/api client/src/review/PageNavigator client/src/session`.

### 11. CLIENT: `SourceThumbnail`, `MergeSuggestions`, `MergeDialog` (D11, D12)

- `SourceThumbnail.tsx` (D12). Tests mock `getPayslipSource` and `loadPdfDocument`:
  - image → `<img>`, then `fireEvent.error` → the no-preview card;
  - PDF → `loadPdfDocument` called and `destroy` on unmount;
  - a rejected source → the card plus `console.error`.
- `MergeSuggestions.tsx`:
  - props `{ pairs: readonly [string, string][]; payslips: readonly PayslipSummary[]; onReview(pair)
    }`;
  - uses `useDismissedSuggestions`;
  - renders the banners (D11) with positions from `payslips`, skipping pairs whose ids are absent;
  - buttons ≥ 48 px.

  Tests: renders a pair, Not now hides it, a hidden pair stays hidden after a remount, and a pair
  with a missing id is not rendered.
- `MergeDialog.tsx`:
  - props:
    - `{ open, sessionId, payslips: readonly PayslipSummary[]; pair: readonly [string, string] |
      null`: `null` means pick mode;
    - `selectedId: string`, the pick-mode anchor;
    - `onMerged(id: string, originals: [string, string]); onClose() }`.
  - Internal state: `step`, `chosen`, `order`, `busy`, `errorCode`.
  - Pick step:
    - a `<fieldset><legend>` with one native radio per other mergeable payslip;
    - labels as the rail (position, period via `formatField` or filename, and the status text, with
      `statusIcon` decorative);
    - Continue is `aria-disabled` until a choice.
  - Confirm step as D11.
  - Tests:
    - pick → confirm;
    - swap reverses the displayed order and the `order` sent;
    - Merge calls `mergePayslips` with `payslipIds` in list order, then `onMerged`;
    - a `409` shows `merge.errors.merge_not_allowed`, a network error shows `merge.errors.network`;
    - busy ignores Cancel;
    - Cancel calls `onClose`;
    - stub `showModal`/`close`.
- **VALIDATE**: `npx vitest run client/src/session`.

### 12. CLIENT: wire `SessionPage` and copy (D3, D11)

- `SessionPage.tsx`:
  - `isSettled` delegates to `isMergeable` (D3), keeping its name and comment;
  - state `merge: { pair: [string, string] | null } | null` (null means closed) and
    `discardedIds: readonly string[]`;
  - render `<MergeSuggestions pairs={detail?.mergeSuggestions ?? []} …
    onReview={(pair) => setMerge({ pair })} />` above the rail when `payslips.length > 1`;
  - the panel heading row gets the `ActionMenu` per D11, with `id="payslip-actions"`, and its item
    sets `setMerge({ pair: null })`;
  - render one `<MergeDialog>` with `open={merge !== null}`;
  - `onMerged` follows D11, and the effect on `discardedIds` calls `keep(id, null)`.

    **GOTCHA:** `useUnsavedEdits` is mocked in `SessionPage.test.tsx` as `{ unsaved }` only. Add
    `keep: vi.fn()` to the mock.
- `SessionPage.test.tsx`:
  - a suggestion banner renders from `mergeSuggestions`;
  - Review merge opens the dialog at confirm (mock `MergeDialog` or `mergePayslips`; prefer mocking
    `../session/MergeDialog` to a stub that exposes `onMerged`);
  - the menu is present only for a mergeable selection with a mergeable sibling;
  - `onMerged` replaces the URL with the merged id (`useNavigationType()` is `REPLACE`) and calls
    `keep` with `null` for both originals.
- Locales (`en.json`, `hr.json`), a new top-level `merge` block:
  - `actions`, `mergeWith`, `pickTitle`, `pickLegend`, `continue`, `title`, `consequence`,
    `pagePosition`, `pageCount_one`/`pageCount_other` (hr also `_few`), `swap`, `swapped`,
    `confirm`, `cancel`, `noPreview`, `suggestion`, `reviewSuggestion`, `dismissSuggestion`;
  - `errors.merge_not_allowed`, `errors.merge_source_unreadable`, `errors.pdf_too_many_pages`,
    `errors.network`.
  - The copy states consequences plainly (D11) and is friendly and precise; technical detail stays
    in the console (standing rule).
  - Check how existing plural keys are written in `hr.json` (i18next `_one/_few/_other`) and match.
- `client/src/i18n/mergeErrors.test.ts` (D10).
- **VALIDATE**: `npx vitest run client`, `npm run lint`.

### 13. LOCAL PROBES over the real samples ($0)

- A throwaway script in the **session scratchpad**, not the repo. Run it with `npx tsx`, importing
  `combineSources` from `api/src/services/payslip-merge.ts`:
  - `B01.pdf + A02.jpg` → pdf.js text of page 1 contains "OBRAČUN";
  - `A02.heic + A01.pdf` → 4 pages, and page 1 has the aspect ratio 1220:2712;
  - `A02-exif6.jpg` alone → rotation 90, and the pdf.js viewport is portrait;
  - `A03-rotate90.pdf + G01.png` → page 1 keeps rotation 90.
- Record each result in the history file. Do not commit the script.
- **VALIDATE**: all four as stated.

### 14. UPDATE the docs

- **PRD:**
  - **§7.8:** add "Settled in Task 11" bullets:
    - suggestion rule and that it is computed server-side (D5);
    - mergeable states (D3);
    - page cap (D4);
    - position (D7);
    - dismissals per tab (D6);
    - EXIF → `/Rotate`, HEIC conversion and encrypted-PDF decryption (D1, D2, D9);
    - the merged filename (D9).
  - **§10.4:** `mergeSuggestions: [[id, id], …]`.
  - **§10.11:** the full response list from D10.
  - **§8 Backend table:** the `pdf-lib` row becomes `@cantoo/pdf-lib` (pdf-lib fork; decrypts
    permissions-only PDFs), and add `heic-convert` and `exifr` rows.
  - **§12 Phase 4:** a Task 11 status line.
- **ROADMAP:**
  - §2 row 11: "✅ implemented; pending review".
  - §3 Task 11: an "Added in planning (plan 11)" list of D1–D12, one line each.
  - §5: a new row "**Forked PDF library**: `@cantoo/pdf-lib` replaces `pdf-lib` for decryption
    (plan 11 D1)", status "Watch", noting that a fork's maintenance is the risk.
- **CONTEXT.md:** after **Merge**, add:

  **Merge suggestion**: a non-blocking prompt that two Payslips in a Session look like pages of one:
  same period and employee OIB, or same employer OIB when an employee OIB is unread. It never
  merges by itself. _Avoid_: auto-merge, duplicate detection.

- **`.claude/commands/validate.md`** (git-ignored, edit by hand):
  - Phase 4 rows for each new test file;
  - Phase 6 dependency notes: the three new dependencies, and `pdf-lib` gone;
  - **journey 9.10** (below);
  - delete any "Task 11 future" row.

**Journey 9.10 — merge (Task 11, PAID ≤ 3 analyses, ~$0.15; plan 11 D13).** Use a throwaway account.

1. Split `E01.pdf` into `E01-p1.pdf` and `E01-p2.pdf` locally (pdf-lib `copyPages`). Upload both in
   one session.
2. When both are settled: if both pages carry OIB + period, a banner reads "Payslips 1 and 2 look
   like pages of one payslip." Not now hides it, and a route change and return keep it hidden.
   Otherwise note why and use the menu.
3. The panel's ⋮ menu → Merge with another payslip… → pick payslip 2 → Continue. The thumbnails show
   each first page, then Swap order and swap back. Tab order is Cancel → Swap → Merge; Escape
   closes and focus returns to ⋮.
4. Type into a field of payslip 1 without saving (the unsaved mark shows), then merge. The dialog
   says edits are discarded. After Merge, the URL holds the merged id (Back does not return to a
   dead id), the rail shows one payslip in position 1 with "Reading", the unsaved mark is gone, and
   a reload gives no prompt.
5. When it is ready, the pager reads "Page 1 of 2", fields from both pages fill in, and outlines land
   on page 2.
6. 375 px: dialog fits with no horizontal scroll, and every control is ≥ 48 px. Both locales.
7. Delete the throwaway data; orphan query (the merged source and both originals' sources).

### 15. RUN the full local validation, WRITE the history file, STOP (D14)

- `npm run validate` green. Report counts against step 1.
- `npm run build` green (the known chunk advisory is fine).
- `grep -rn 'from "pdf-lib"' api client/src shared scripts` → empty.
- `grep -rn "react-router-dom" client/src` → empty.
- `git diff --check`.
- If a Windows tool wrote CRLF, run `npx prettier --write` on exactly the changed files.
- **WRITE** `.agents/history/11-merge-payslips.md`, mirroring history/10:
  - outcome and status;
  - what was built (a file table);
  - decisions (D1–D14);
  - deviations;
  - validation, including the migration record, integration counts and step-13 probes;
  - **paid runs: 0, $0**;
  - open items: at least the forked library risk, mirrored EXIF orientations not handled, and the
    three-page suggestion producing three pairs;
  - a review-session handoff: journey 9.10 under D13's budget, the hr/en copy read, `/code-review`,
    `/validate`.
- **Do not** run `/code-review`, `/validate` or any browser journey, and **do not commit**. Stop and
  report.

---

## TESTING STRATEGY

### Unit Tests

- `shared`: `isMergeable` (every status × tables status) and `mergeSuggestions` (the D5 truth
  table), plus the schema default.
- `api`: `payslip-merge.test.ts` (order, geometry, EXIF rotation, encryption, HEIC via mock, errors,
  filename). `source-file.test.ts` unchanged as the regression check for the D1 swap.
- `client`:
  - `SourceThumbnail`, `MergeSuggestions`, `MergeDialog`, `dismissedSuggestions`;
  - `SessionPage` wiring;
  - `api/client` `mergePayslips`;
  - `mergeErrors` copy guard;
  - `PageNavigator` unchanged.

### Integration Tests

Hosted Supabase, no provider (step 9):
- the success path with `merged_from` and `created_at`;
- every 409 and 404;
- concurrency;
- the page cap;
- a full session;
- suggestions;
- the cross-user RPC in `direct-writes.integration.ts`.

### Edge Cases

- Both payslips failed (a failed page 2 is the common case): mergeable.
- A confirmed payslip merged with a review one: allowed, and the dialog says confirmation is lost.
- A full session (10) merges; the insert happens after the soft-delete.
- Double submit or two tabs: one 202 and one 409 (row lock).
- Merging while the selected original has unsaved edits: they are discarded, with no reload prompt
  left behind (the D11 effect ordering).
- Permissions-only PDF (B01): the text survives (D1).
- HEIC in Chrome: server-converted (D2); the dialog thumbnail falls back to the card.
- EXIF 6 JPEG: page rotated 90 (D9).
- A `/Rotate 90` PDF keeps its rotation through `copyPages`.
- 10 + 1 pages: 422, and nothing stored or deleted.
- Session with one payslip: no menu and no banner.
- Suggestion ids no longer in the list (just merged): banner hidden.
- Stale bundle: an old API without `mergeSuggestions` parses to `[]`.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` · `npm run format:check`

### Level 2: Unit Tests

`npm test` · targeted: `npx vitest run shared api/src/services api/src/upload client/src/session client/src/routes/SessionPage client/src/i18n`

### Level 3: Integration Tests

`npm run test:integration` (hosted Supabase; no paid extraction)

### Level 4: Manual Validation

Step 13's local probes ($0). Journey 9.10 is the **review session's**, not this session's (D14).

### Level 5: Additional Validation

Supabase MCP: `list_migrations`, `get_advisors` (security), and the dry run before applying (step 4).

---

## ACCEPTANCE CRITERIA

Mapped to ROADMAP Task 11's Definition of Done:

- [ ] Two images of one payslip merge into one payslip with two pages and a re-extracted form. This
      session proves the API, storage and state (integration step 9.2); journey 9.10 proves the
      re-extraction.
- [ ] Merging a PDF with an image produces a valid combined PDF (unit case 2, integration 9.2 with
      PDF + PNG, probe `A02.heic + A01.pdf`).
- [ ] The suggestion fires on matching OIB + period and never fires otherwise (the `mergeSuggestions`
      truth table, integration case 8).
- [ ] Manual merge works when both OIBs are unreadable (failed payslips merge in integration 9.2;
      the menu does not depend on OIBs).
- [ ] Source payslips are soft-deleted, not hard-deleted, and disappear from the session
      (integration 9.2 with `admin` reading `deleted_at`; sources kept).
- [ ] `npm run validate`, `npm run build` and `npm run test:integration` are green; the migration is
      recorded once; the advisors show no new error.
- [ ] Every new string exists in `en` and `hr`, guarded.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–15 done in order, each validation run once and passed.
- [ ] The migration was dry-run, applied, renamed, and types regenerated.
- [ ] Step 13 probes recorded.
- [ ] Docs updated (PRD, ROADMAP, CONTEXT, `validate.md`).
- [ ] History file written; nothing committed; no review, validate or browser run.

---

## NOTES

- **Why not stitch results?** PRD §7.8: two disagreeing `bruto` values have no principled
  tiebreak. Re-extraction costs one more two-pass analysis per merge (~$0.05–0.10 for two pages),
  which is accepted.
- **Why the request keeps both `payslipIds` and `order`:** the schema already exists and is tested
  (Task 02), and PRD §10.11 fixes it. `order` alone would suffice, but changing the contract is out
  of scope.
- **Not in this task:** page reordering beyond the swap (PRD §4.6), un-merge (the originals stay
  soft-deleted with their sources, so it is possible later), history and export (Task 12).
- **Confidence: 8/10.** The risky parts are measured: decryption, HEIC and EXIF. The remaining risk
  is fork differences surfacing in `source-file.test.ts`, and jsdom's `<dialog>` gaps, both covered
  by explicit fallbacks above.
