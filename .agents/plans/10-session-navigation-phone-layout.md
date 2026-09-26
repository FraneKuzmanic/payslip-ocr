# Feature: Task 10 — Session navigation & phone layout

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 10](../ROADMAP.md), §4 (M2), §5 ("Phone layout has no
prior art") · **PRD:** §2 (principles 2, 3, 6), §7.6, §7.7, §11.1 step 3, §11.5 · **Previous
tasks:** [`history/09`](../history/09-review-form-two-way-linking.md) (open items 1, 5, 6; review
findings 4 and 6), [`history/08`](../history/08-source-regions-preview.md) (the viewport, overlay
and PDF modules), [`history/07`](../history/07-capture-multi-upload.md) (the session page, the
upload batch provider) · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) (*Session*, *Page*,
*Upload batch*, *Source Region*, *Extracted value*) · **Behaviour rules:**
[`AGENTS.md`](../../AGENTS.md) (no `CLAUDE.md`).

## Feature Description

Task 09 built the review form, but moving around a session is still a vertical list of rows with
**Review** buttons. On a phone, the source preview also scrolls away as soon as the user edits a
lower field. This task makes navigation obvious and keeps the form usable with the software
keyboard open:

- a **payslip selector**: a scroll-snap chip rail on a phone and below `xl`, a vertical list at
  `xl`, built as a `tablist` with manual activation;
- a **page navigator** for multi-page PDFs: a pager pill that opens a page sheet on a phone, and a
  72 px page rail inside the source panel at `lg`, as `<nav>` with `aria-current="page"`;
- **three zones at `xl`**: the payslip list, the scrolling form, and the sticky source;
- **unsaved edits kept per payslip** while the user switches payslips, presses Back, or leaves the
  session route and comes back. This replaces Task 09's discard prompt;
- **the keyboard layout**: `interactive-widget=resizes-content`, a `visualViewport` fallback for
  iOS, and a 64 px **source strip** showing the focused field's region while the keyboard is open,
  with the bottom navigation and the action bar hidden.

## User Story

As someone reviewing several payslips on my phone
I want to move between payslips and pages without losing what I typed, and to see where a value
came from while I type it
So that I can check and correct a whole session quickly (PRD US-05; §11.1 step 3; §11.5 "the
focused field and its highlight are visible simultaneously on a phone with the keyboard open").

## Problem Statement

- **Switching loses edits.** `PayslipReview` is keyed by payslip, so leaving it unmounts the form.
  Task 09 D13 asks before discarding. The browser Back button changes `?payslip=` without asking
  and loses the edits silently (history/09 open item 1). `<BrowserRouter>` has no `useBlocker`.
- **The selector is a list of rows** (`SessionPage.tsx` lines 250–333), with a toggle button per row
  and no keyboard model. A session opens with nothing selected.
- **Pages** are a bare previous/next `Pager` in `PdfSource.tsx` lines 214–245. There is no overview
  of the pages and no desktop rail.
- **The keyboard.** On a phone the preview sits above the form, so it scrolls out of view while the
  user edits lower fields (history/09 open item 5). The fixed bottom nav (64 px) and the sticky
  action bar (~90 px) take a third of what is left above the keyboard. The viewport meta has no
  `interactive-widget`.
- **Desktop.** At `lg` the source `<aside>` comes first in the DOM, so Tab reaches the zoom controls
  before the form (finding 4). The line-item `<table>` is `table-fixed` with equal columns, so text
  cells are ~90 px wide and names read "SINDIKAL…" at 1440 px (finding 6).

## Solution Statement

- **Unsaved edits** live in an `UnsavedEditsProvider`, a layout route above `SessionPage` (mirroring
  `UploadBatchProvider`). `PayslipForm` hands over a snapshot of its dirty values when it unmounts,
  and applies one when it mounts. The discard dialog goes. `beforeunload` guards reload while any
  payslip has unsaved edits. The provider sits inside `ProtectedRoute`, so signing out clears it.
- **`PayslipRail`** is a `tablist` of every server payslip. Its orientation comes from the new `xl`
  query. `SessionPage` auto-selects the first payslip when the URL names none, and renders a
  `tabpanel`: the review for a readable payslip, or a status panel with Retry.
- **`PageNavigator`** replaces `Pager`: a pill plus sheet on a phone, and a thumbnail rail at `lg`.
  It renders from the `LoadedPdf` that `PdfSource` already holds, so there is no second load.
- **The keyboard:**
  - `useSoftKeyboard` detects keyboard mode (a coarse pointer and a review input focused). It sets
    `data-keyboard="open"` on `<html>` and tracks `visualViewport` for iOS.
  - In keyboard mode the source panel renders a **`SourceStrip`** instead of the zoomable viewport.
    The strip is fixed to the top of the visual viewport and magnifies the focused field's region.
  - A CSS rule hides everything marked `data-hide-with-keyboard`, which covers the bottom nav and
    the action bar.
- **Layout:**
  - The DOM order is rail → form → source. On a phone the preview is placed above the form with CSS
    `order`.
  - The review grid is `3fr / 2fr` at `lg`.
  - At `xl`, `SessionPage` adds the vertical list as a third zone.
  - Line-item tables get a `<colgroup>`: fixed numeric columns and flexible text columns.

## Feature Metadata

**Feature Type**: Enhancement (New Capability for the keyboard strip and the page sheet)
**Estimated Complexity**: High. It touches almost all of the client, and the keyboard behaviour can
only be judged on a real device (M2), so everything else must be pinned by unit tests.
**Primary Systems Affected**:
- client: `routes/SessionPage.tsx`, `review/*` (`PayslipReview`, `PayslipForm`, `LineItemSection`,
  `SourceDocumentPanel`, `PdfSource`), a new `review/unsaved/` module, new `review/PayslipRail`,
  `review/PageNavigator`, `review/SourceStrip`, `review/sourceStrip`, `review/useSoftKeyboard`,
  `history/useWideLayout`, `components/BottomNav`, `App.tsx`, `index.html`, `index.css`, locales;
- docs: PRD §7.6, §7.7, §12; ROADMAP §2, §3 Task 10, §5; CONTEXT (*Unsaved edits*); `validate.md`
  (git-ignored).

**No API, shared, or database change.** `PayslipSummary` already carries `pageCount`, `period`,
`status`, `tablesStatus`, `failureReason` and `originalFilename`.
**Dependencies**: none new. The lockfile must not change.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-26 in the planning session. Do not reopen them without
new evidence.

### D1 — Unsaved edits are kept in memory, per payslip (product owner)

- **`UnsavedEditsProvider`** is a layout route directly inside `UploadBatchProvider` in `App.tsx`.
  It lives above `HomePage` and `SessionPage` and inside `ProtectedRoute`, so a sign-out (which
  unmounts the protected branch) drops every entry.
- **What it holds:**
  - a `Map<payslipId, UnsavedEdits>` in a **ref**, so keystrokes never re-render the page;
  - a state `ReadonlySet<string>` of payslip ids with unsaved edits, including the mounted form
    while it is dirty. The set changes only when membership changes.
- `UnsavedEdits = { values: ReviewFormValues; dirtyKeys: readonly (keyof ReviewFormValues)[] }`.
  A top-level key is dirty if any of its nested `dirtyFields` is true, so a table counts as a whole.
- **Lifecycle:**
  - `PayslipForm` reports `isDirty` changes (`markUnsaved(id, dirty)`).
  - On unmount it hands over `{ values: getValues(), dirtyKeys }` when dirty, or `null` when clean
    (`keep(id, edits | null)`).
  - On mount it takes that payslip's entry (`take(id)`) and applies it with
    `setValue(key, values[key], { shouldDirty: true })` for each dirty key, tables as whole arrays.
  - A successful save resets the form and so clears it.
- **Covers:** switching chips, browser Back and Forward changing `?payslip=`, leaving to `/` and
  returning, and a StrictMode remount.
- **Does not cover a reload.** `beforeunload` is registered by the provider while the set is
  non-empty, and replaces `SessionPage`'s listener.
- **The Task 09 discard dialog is removed** (`pendingToggle`, `ConfirmDialog` usage in
  `SessionPage`, keys `review.discardTitle`, `review.discardDescription`, `review.discard`,
  `review.keepEditing`). `components/ConfirmDialog.tsx` stays: Task 11's merge confirmation and
  Task 12's delete need it, and it is not dead code of this task's making.
- **Naming.** CONTEXT.md already says an *Extracted value* "is always a draft", so this is
  **"unsaved edits"** in code, copy and docs (`UnsavedEditsProvider`, `useUnsavedEdits`), never
  "draft".
- Values are kept as the form's strings, in the UI language of the moment. The parsers accept both
  locales' forms (Task 09 D12), so a language switch between leaving and returning is harmless.

### D2 — The chip has no thumbnail (product owner)

- The payslips in a session usually share an employer and an employee, so their letterheads look
  the same; the **period** is what tells them apart. Up to ten pdf.js renders for chips alone is
  cost with no gain (PRD principle 6).
- **A chip shows:**
  - the position (`1`, `2`, …);
  - the period, formatted by `formatField("period", …, language)` from `reviewForm.ts`, or the
    `originalFilename` (truncated) while the period is unread;
  - a status icon with the visible `payslipStatus.*` text;
  - an unsaved-edits icon (`PencilLine`) with visually hidden `session.unsaved` text when its id is
    in the D1 set.
- **Selection is marked without colour:** a 2 px `border-accent` plus a `font-semibold` position,
  against a 1 px slate border. `aria-selected` carries it for assistive technology.
- PRD §7.6 is amended accordingly.

### D3 — Pages: one at a time, with a pager and a sheet or rail (product owner)

- `PdfSource` keeps showing one page, and field focus keeps following its page (`pageForField`).
  PRD §7.6's "scrolls continuously through the current payslip's pages" is reworded. The rule that
  matters, "no page reachable only by horizontal scroll", holds.
- **Phone (`!wide`):**
  - Beneath the viewport there is `<nav aria-label={t("review.pages")}>` holding previous, a pill
    button `‹ Page 2 of 3 ›` (`review.pdfPage`, `aria-haspopup="dialog"`), and next.
  - The pill opens **`PageSheet`**, a native `<dialog>` opened with `showModal()` (mirror
    `ConfirmDialog.tsx`). It lists one thumbnail button per page, and the current page carries
    `aria-current="page"`.
  - Choosing a page sets it and closes the sheet; focus returns to the pill.
- **`lg` (`wide`):** a **72 px wide** vertical rail left of the viewport, inside the source panel.
  It is `<nav aria-label={t("review.pages")}><ol>` of thumbnail buttons, each with a visible page
  number, the current one with `aria-current="page"` and a 2 px accent border.
- **Never a tablist** nested in the payslip tabpanel.
- Rendered only when `document.numPages > 1`. **Images and single-page PDFs show no page
  navigation.** Until merge (Task 11) only PDFs can have several pages.
- Thumbnails render lazily from the loaded document at `64 × devicePixelRatio / pageWidth`, one
  small canvas each, cancelled on unmount.

### D4 — Desktop: two zones at `lg`, three from `xl` (product owner)

At 1024 px the app sidebar (240 px) plus three zones leaves ~270 px each for the form and the
source.

| Width | Payslip selector | Review area |
| --- | --- | --- |
| < 1024 | horizontal chip rail | preview disclosure above the form, keyboard strip (D5) |
| 1024–1279 (`lg`) | horizontal chip rail | form \| sticky source, `lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]` |
| ≥ 1280 (`xl`) | vertical list, `xl:sticky xl:top-20`, in a `13rem` column | the same review grid beside it |

- The source column is ~2/5 because the viewport's width is bounded by its height budget anyway
  (`min(100%, 65dvh * ratio)`, about 370 px on a 900 px tall screen). At 1440 px the form gets
  ~550 px.
- The page's width cap becomes `lg:max-w-6xl xl:max-w-7xl` while a payslip is selected.
- **`useWideLayout` takes an optional query**, and a new exported `XL = "(min-width: 1280px)"`
  sits beside the existing `lg` one. The rail's orientation needs it in JS, for `aria-orientation`
  and the arrow keys. The table-versus-cards choice stays at `lg` (PRD §7.7).
- **Line-item tables (finding 6):** a `<colgroup>`. Amount and quantity columns (from
  `columnKind`) get `w-28`, the removal column `w-14`, and text columns take the rest.
  `table-fixed` stays.

### D5 — The keyboard: a 64 px strip; the nav and action bar hide (product owner)

- **Keyboard mode** = `(pointer: coarse)` **and** a review input focused, meaning `PayslipForm`'s
  `onFieldFocus` reports a non-null path. It is detected by focus rather than by measuring the
  viewport, because it has to work before the keyboard has finished animating.
  - Known limit: on Android, dismissing the keyboard with the back gesture leaves the input focused,
    so the strip stays until the user taps elsewhere. Record it; M2 judges it.
- **While in keyboard mode:**
  1. `document.documentElement.dataset.keyboard = "open"`, removed on exit and on unmount.
  2. In `index.css`: `html[data-keyboard="open"] [data-hide-with-keyboard] { display: none; }` hides
     `BottomNav` and `PayslipForm`'s action bar.
     - Save is unreachable while typing. The user closes the keyboard first, as in most phone forms.
     - Plain CSS rather than a Tailwind variant, so nothing depends on variant composition.
  3. `html[data-keyboard="open"] { scroll-padding-top: 5rem; }` keeps focus scrolling clear of the
     strip.
  4. The source panel renders **`SourceStrip`** in place of `ZoomableSourceViewport`, in a wrapper
     that is `fixed inset-x-0 z-40 h-16`, with `top: var(--visual-top, 0px)`, a white background
     and a bottom border.
     - The document stays loaded, because the panel does not unmount.
     - The zoom level resets to fit when the keyboard closes; the focused field's pan re-centres
       anyway.
     - The strip covers the app header in keyboard mode, which gives the form another 56 px.
- **iOS fallback.** No iOS browser honours `interactive-widget`, because all of them are WebKit.
  - While in keyboard mode, `useSoftKeyboard` listens to `visualViewport` `resize` and `scroll`. It
    writes `--visual-top: ${offsetTop}px` on `<html>`, so the fixed strip follows the visible area.
  - After the first `resize`, if the focused input's rect is under the strip or below the visual
    viewport's bottom (`isObscured`, a pure helper), it calls
    `scrollIntoView({ block: "center" })` once.
  - On Chrome for Android, `resizes-content` shrinks the layout viewport itself, so `offsetTop` stays
    0 and the same code is a no-op.
- **The strip shows:**
  - the focused field's first region on its page, magnified (D6), with only that region outlined;
  - when the field has no region, or the page's outlines are withheld (the aspect-ratio guard,
    PRD principle 2), the text `review.stripNoOutline` instead of an image.
- **The strip is `aria-hidden="true"`.** It duplicates the preview visually; the value and its
  label are in the focused input. It is not interactive (`pointer-events-none`), so the 48 px
  hit-box rule does not apply.
- **The strip is 64 px, not the 44 px in the PRD and roadmap:** a payslip line needs about 2×
  magnification to read. Both documents are amended.

### D6 — The strip's geometry is a pure function

`sourceStrip.ts` exports `stripView(bounds, ratio, box)`, where `bounds` is the region's
page-relative `{ minX, minY, maxX, maxY }` (from `boundsOf` in `sourceZoom.ts`), `ratio` is the page's
width ÷ height, and `box` is `{ width, height }` in CSS px. It returns
`{ surfaceWidth, x, y } | null`:

- `surfaceWidth = min(0.45·box.height·ratio / (maxY − minY), 0.9·box.width / (maxX − minX),
  8·box.width)`, so the region's height takes ~45% of the strip, it never exceeds 90% of the width,
  and the render stays bounded. The surface height is `surfaceWidth / ratio`.
- `x = box.width/2 − centreX·surfaceWidth` and `y = box.height/2 − centreY·surfaceHeight`, then
  clamped so the surface covers the box wherever it is larger than the box (no blank edge beside a
  page margin).
- `null` for a degenerate region (zero width or height), so the caller shows the note.

`SourceStrip` positions the surface with `transform: translate(x, y)` at `width: surfaceWidth`:

- **PDF:** the existing `PdfCanvas` (moved to export from `PdfSource.tsx`), whose `renderScale`
  already caps the bitmap at 2600 device px;
- **image:** an `<img>`.

The outline is drawn by `SourceOverlay` given only that region.

### D7 — The rail: every payslip is a tab; the first is selected on arrival (product owner)

- **`PayslipRail`** renders `<div role="tablist" aria-label={t("session.payslips")}
  aria-orientation=…>` with one `<button role="tab">` per server payslip, whatever its status.
  - `id="payslip-tab-<id>"`, `aria-selected`, `aria-controls="payslip-panel"`.
  - Roving `tabIndex`: 0 on the selected tab, −1 on the rest.
- **Manual activation**
  ([APG tabs, manual activation](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-manual/)):
  - Left and Right (horizontal) or Up and Down (vertical) move focus with wrap-around, and Home and
    End jump to the ends. Focus alone never selects.
  - Enter and Space activate, through the button's native click.
  - Activating keeps focus on the tab. The Task 09 "focus the preview heading" behaviour is removed.
- **Horizontal rail:**
  - `flex gap-2 overflow-x-auto snap-x snap-mandatory`; chips are `snap-start shrink-0`.
  - Chips are `w-[calc((100%-2rem)/2)]`, so two chips fit and the third peeks ~24 px when there are
    more than two.
  - The focused or selected chip scrolls into view with `scrollIntoView?.({ block: "nearest",
    inline: "nearest" })`.
- **`+N`:** an `IntersectionObserver` (root: the rail, threshold 1) records which chips are fully
  visible. The pure helper `overflowAfter(visible: boolean[])` counts the chips after the last fully
  visible one. The badge `+N` sits on that last visible chip and is `aria-hidden`: the tablist's
  tabs are all in the accessibility tree anyway. There is no badge in vertical mode.
- **Vertical (`xl`):** full-width chips in a column; the list scrolls inside its sticky column when
  it outgrows it.
- **Every chip is at least 48 px** tall (`min-h-12`), and the text carries the status, never colour
  alone.
- **Arrival:**
  - When `?payslip=` is missing or names no payslip in the session, `SessionPage` selects the first
    one with `setSearchParams({ payslip }, { replace: true })`, so Back does not return to an empty
    selection.
  - A selected payslip is kept even while it is `processing` or `failed`.
  - A chip press uses a push, as the Task 08 D1 URL selection always has, so Back walks the
    selections and D1 keeps their edits.
- **The panel** is `<div role="tabpanel" id="payslip-panel" aria-labelledby="payslip-tab-<id>">`.
  Its heading `h2` keeps `session.position` plus the filename. It holds:
  - `review` or `confirmed`: `PayslipReview`, keyed by id;
  - `processing`: a `role="status"` line, `session.processingPanel`, and `tablesStatus` copy is not
    needed;
  - `failed`: the `failureReason.*` copy, the retry error if any, and **Retry** when retryable. The
    existing `retry()` moves here unchanged. After a retry, focus stays on the selected tab rather
    than a row (the row ids go away).
- **Upload-batch items not yet on the server** (waiting, uploading, rejected) are not tabs, because
  they have no server id. They keep the existing `Row` rendering in a plain list under the rail,
  with the dismiss button for a rejected one.

### D8 — DOM order: rail → form → source (product owner)

- `PayslipReview` renders the form's column first and the `<aside>` second.
  - On a phone the aside is shown first with `order-first lg:order-none`.
  - At `lg` the grid places it in column 2 (`lg:col-start-2 lg:row-start-1`).
- At desktop, Tab reaches the form before the zoom controls (finding 4).
- On a phone the preview's few controls (zoom, pager, open) now come after the form in Tab order.
  This is accepted: in keyboard mode the preview is the aria-hidden strip anyway.

### D9 — Paid runs (product owner, standing rule)

- **This implementing session: $0.** Every behaviour is unit-tested with mocked API calls and a fake
  `LoadedPdf`.
- **The review session:**
  - It may read the M1 data (`m1-review-08@example.test`) for navigation only: the rail, the pager
    on A01 (two pages), switching. It **must not edit, save or confirm** there, because the product
    owner's M1 spot-check is still pending.
  - For unsaved-edits and keyboard journeys it uploads at most **two** documents under a throwaway
    account (A01.pdf and one image, about $0.10), logs the cost and deletes them.

### D10 — Session split

This implementing session does **not** run `/code-review`, `/validate` or any browser journey, and
does not commit. It runs `npm run validate`, `npm run build` and the targeted test files, records
them in `history/10-*.md`, and stops.

**M2** (the real iPhone keyboard) is the product owner's manual step, never part of this plan.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `client/src/routes/SessionPage.tsx` (all, 446 lines). Why: it is rewritten around the rail.
  - Keep: the poll loop (lines 74–110), `retry()` (112–150), the not-found and error states
    (192–248), the pending-batch `Row`s (302–332), and `isSettled`.
  - Remove: `dirty`, `pendingToggle`, `focusPreview`, `previewHeading` focusing, `togglePreview`,
    `switchPreview`, the `beforeunload` effect (165–174), `ConfirmDialog`, and the payslip `Row`s
    (251–301).
- `client/src/routes/SessionPage.test.tsx` (all). Why:
  - The `describe` blocks at 353 ("review") and 462 ("unsaved edits") are rewritten.
  - Mirror `renderPage` (line 80), the `vi.mock` of `PayslipReview` (27) and `useUploadBatch` (46).
- `client/src/review/PayslipReview.tsx` (all). Why: DOM order (D8), the grid (D4), the unsaved-edits
  wiring (D1), keyboard mode (D5). `liveRegions` and `fieldValuesOf` stay untouched.
- `client/src/review/PayslipForm.tsx` (all). Why:
  - `onDirtyChange` (lines 93–98) and the unmount-clean effect;
  - the `values` + `keepDirtyValues` setup (84–87) that restoring must survive;
  - the action bar (194) gains `data-hide-with-keyboard`;
  - `onFieldFocus` (149–152) is the keyboard-mode signal.
- `client/src/review/PayslipForm.test.tsx`. Why: the pattern for rendering the form with a detail
  fixture, and the D19 "dirty scalar survives the tables landing" test to mirror for restoring.
- `client/src/review/PdfSource.tsx` (all). Why: `Pager` (214–270) is replaced by `PageNavigator`;
  `PdfCanvas` (182–212) is exported for the strip; `page` follows `activeField` (124–126); the
  IntersectionObserver lazy load (64–76) must keep working in strip mode.
- `client/src/review/SourceDocumentPanel.tsx` (all). Why: it gains a `strip` prop passed to
  `PdfSource` and `ImageSource`. `ImageSource`'s ratio check (221–229) is what `overlaySafe` means for
  an image.
- `client/src/review/ZoomableSourceViewport.tsx` (all). Why: **do not change it** (locked decision
  17). Read it to see what the strip must not duplicate, and `footer` (line 56), which the phone pager
  still uses.
- `client/src/review/sourceZoom.ts`. Why: `boundsOf` and `centroidOf`, used by `stripView`.
- `client/src/review/SourceOverlay.tsx`. Why: the strip draws one region through it, with a no-op
  `onSelect` inside a `pointer-events-none` wrapper.
- `client/src/review/pdfDocument.ts`. Why: the `LoadedPdf` interface (`numPages`, `viewportOf`,
  `render`, which returns a cancellable task) used for thumbnails, and the fake to build in tests.
- `client/src/review/pdfRender.ts`. Why: `renderScale`, `MAX_CANVAS_WIDTH`, `pageForField`.
- `client/src/review/LineItemSection.tsx` lines 214–260. Why: the `<table>` gets its `<colgroup>`
  (D4); `columnKind` and `columnsOf` come from `reviewForm.ts`.
- `client/src/review/reviewForm.ts` lines 16, 98+. Why: `FormLanguage`, `formatField` for the chip
  period, and the `ReviewFormValues` type.
- `client/src/review/ReviewField.tsx`. Why: `fieldId` and `pathOfFieldId`.
- `client/src/history/useWideLayout.ts`. Why: it gains the optional query (D4).
- `client/src/capture/useCameraCapture.ts` lines 10–25. Why: the `(pointer: coarse)` matchMedia
  pattern to mirror in `useSoftKeyboard`.
- `client/src/upload/UploadBatchProvider.tsx`, `UploadBatchContext.ts`, `useUploadBatch.ts`. Why:
  the provider, context and hook trio and the layout-route shape that D1 mirrors.
- `client/src/App.tsx`. Why: where the provider route goes (inside `UploadBatchProvider`).
- `client/src/components/ConfirmDialog.tsx`. Why: the native `<dialog>` + `showModal()` pattern for
  `PageSheet`, with focus returned to the opener. jsdom has no `showModal`: see how the test copes.
- `client/src/components/BottomNav.tsx`. Why: it gains `data-hide-with-keyboard`.
- `client/src/components/AppLayout.tsx`. Why: the 56/64 px header and the `pb-16` under the bottom nav.
- `client/index.html` line 5 and `client/src/index.css`. Why: the viewport meta and the base layer.
- `client/src/i18n/locales/en.json`, `hr.json`, and `i18n/i18n.test.ts`. Why: key parity.
- `.claude/commands/validate.md` lines 660–700. Why: journey 9.8's shape for the new 9.9, and the
  Phase 10 row to delete.

### New Files to Create

- `client/src/review/unsaved/UnsavedEditsContext.ts`: types and context (D1).
- `client/src/review/unsaved/UnsavedEditsProvider.tsx`: the layout route (D1).
- `client/src/review/unsaved/useUnsavedEdits.ts`: the hook, which throws outside the provider.
- `client/src/review/unsaved/UnsavedEditsProvider.test.tsx`
- `client/src/review/PayslipRail.tsx` and `PayslipRail.test.tsx` (D2, D7).
- `client/src/review/PageNavigator.tsx` and `PageNavigator.test.tsx` (D3): `PageNavigator`,
  `PageSheet`, `PageRail`, `PageThumbnail`.
- `client/src/review/sourceStrip.ts` and `sourceStrip.test.ts` (D6): `stripView`, `isObscured`.
- `client/src/review/SourceStrip.tsx` and `SourceStrip.test.tsx` (D5, D6).
- `client/src/review/useSoftKeyboard.ts` and `useSoftKeyboard.test.ts` (D5).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [WAI-ARIA APG — Tabs, manual activation](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/examples/tabs-manual/)
  and [Tabs pattern, keyboard interaction](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/#keyboardinteraction).
  Why: D7's roles, roving tabindex, and why focus never selects.
- [MDN — `<meta name="viewport">`, `interactive-widget`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#interactive-widget)
  and [Chrome — viewport resize behaviour](https://developer.chrome.com/blog/viewport-resize-behavior).
  Why: `resizes-content` shrinks the layout viewport on Chrome for Android (108+); WebKit ignores it.
- [MDN — VisualViewport](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport) (`offsetTop`,
  `height`, `resize` and `scroll` events). Why: the iOS fallback in D5.
- [MDN — `scroll-padding-top`](https://developer.mozilla.org/en-US/docs/Web/CSS/scroll-padding-top).
  Why: keeping focus scrolling clear of the fixed strip.
- [WAI-ARIA APG — Dialog (modal)](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Why:
  `PageSheet`'s focus rules; `showModal()` provides the trap and Escape.
- [`aria-current`](https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Reference/Attributes/aria-current).
  Why: `page` on the current page in the navigator (D3).
- [React Hook Form — `setValue`](https://react-hook-form.com/docs/useform/setvalue) (targets a field
  array by name; `shouldDirty`) and [`getValues`](https://react-hook-form.com/docs/useform/getvalues).
  Why: D1's snapshot and restore.
- [Tailwind — scroll snap](https://tailwindcss.com/docs/scroll-snap-type). Why: `snap-x
  snap-mandatory` and `snap-start` in D7.

### Patterns to Follow

**Provider, context and hook trio** (`upload/`):

```ts
export const UploadBatchContext = createContext<UploadBatchContextValue | null>(null);
export function useUploadBatch(): UploadBatchContextValue {
  const value = useContext(UploadBatchContext);
  if (value === null) throw new Error("useUploadBatch must be used inside UploadBatchProvider");
  return value;
}
```

The provider is a layout route rendering `<Context value={…}><Outlet /></Context>`. Check how
`UploadBatchProvider` renders its context and mirror exactly the same form.

**Media queries** (`history/useWideLayout.ts`, `capture/useCameraCapture.ts`): the initial state
comes from `window.matchMedia?.(Q).matches ?? false`, with a `change` listener in an effect.
Tests stub `matchMedia` with `vi.stubGlobal` (see `PayslipReview.test.tsx` line 67 and
`HomePage.test.tsx` line 46).

**Busy and disabled state** (Task 07): `aria-disabled`, never `disabled`, on a button that must
stay focusable. The pager's prev and next at the ends keep the existing `disabled`, because nothing
announces there.

**Comments** explain *why* and cite the decision (`(Task 10 D5)`), as in every file above. No
comment restates the code.

**Logging:** `console.error("[review] …", error)` for technical detail only. User copy comes from
the locales (see the `error-surfacing-console-vs-ui` rule).

**Hit boxes:** `min-h-12` / `size-12` on every control (PRD §11.5).

**Imports:** client imports have no `.js` extension; routing comes from `react-router`; icons from
`lucide-react`.

**jsdom gaps** the existing tests already work around: `scrollIntoView` is absent (call it
`?.()`), `IntersectionObserver` and `ResizeObserver` are absent (guard with `typeof`), `showModal`
is absent, and `visualViewport` is absent (guard `window.visualViewport ?? null`).

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

`useWideLayout(query)`, the unsaved-edits provider, and the pure helpers (`stripView`,
`isObscured`, `overflowAfter`).

### Phase 2: Core implementation

`PayslipRail`, `PageNavigator`, `SourceStrip`, `useSoftKeyboard`, and the form's snapshot and
restore.

### Phase 3: Integration

`SessionPage` around the rail and panel, `PayslipReview`'s order, grid and keyboard mode,
`SourceDocumentPanel` and `PdfSource` strip mode and pager, the line-item `<colgroup>`, viewport
meta, CSS, `BottomNav`, and locales.

### Phase 4: Testing, docs and validation

Unit tests with every step, then the docs, `npm run validate`, `npm run build`, the history file,
and **stop**.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable. Run commands from `prototypes/payslip-ocr` unless stated.

### 1. VERIFY the starting state

- `git status --short` is clean; HEAD is at or after `6348827`.
- Baseline `npm run validate`: green, 57 files, 887 tests (history/09). Record the actual figure.
- **VALIDATE**: `npm run validate`

### 2. UPDATE `client/src/history/useWideLayout.ts` (D4)

- **IMPLEMENT**:
  - Export `LG = "(min-width: 1024px)"` (the existing `WIDE`, renamed) and
    `XL = "(min-width: 1280px)"`.
  - `useWideLayout(query: string = LG)`: the effect depends on `[query]`, and the initial state reads
    that query.
  - Update the doc comment: `lg` is the default, and `xl` drives the three-zone layout (Task 10 D4).
- **GOTCHA**: every existing caller passes nothing and must behave exactly as before.
- **VALIDATE**: `npx vitest run LineItemSection PayslipReview SessionPage`
  (the callers of `useWideLayout`), then `npm run typecheck`.

### 3. CREATE `client/src/review/unsaved/` (D1)

- **`UnsavedEditsContext.ts`**:

  ```ts
  export interface UnsavedEdits {
    readonly values: ReviewFormValues;
    readonly dirtyKeys: readonly (keyof ReviewFormValues)[];
  }
  export interface UnsavedEditsContextValue {
    /** Payslip ids whose edits are unsaved, including the open form while it is dirty. */
    readonly unsaved: ReadonlySet<string>;
    markUnsaved(payslipId: string, dirty: boolean): void;
    /** Stores the edits of a form that is closing, or forgets them when `null`. */
    keep(payslipId: string, edits: UnsavedEdits | null): void;
    /** Returns and removes the stored edits for a form that is opening. */
    take(payslipId: string): UnsavedEdits | undefined;
  }
  ```

- **`UnsavedEditsProvider.tsx`**:
  - A `useRef(new Map())` for the edits, and `useState<ReadonlySet<string>>` for `unsaved`, updated
    only when membership changes (return the previous set otherwise).
  - `keep(id, null)` also removes `id` from `unsaved`. `keep(id, edits)` adds it.
  - `take` does not touch `unsaved`: the reopened form marks itself dirty.
  - The `beforeunload` effect runs while `unsaved.size > 0`, with the same body as `SessionPage`
    lines 167–174. Move the comment ("Browsers ignore custom text here.").
  - Renders `<Outlet />` inside the context, mirroring `UploadBatchProvider`.
- **`useUnsavedEdits.ts`**: the hook, throwing `"useUnsavedEdits must be used inside
  UnsavedEditsProvider"`.
- **UPDATE `App.tsx`**: `<Route element={<UnsavedEditsProvider />}>` directly inside the
  `UploadBatchProvider` route, wrapping the index, `sessions/:sessionId` and `*` routes. Comment:
  inside `ProtectedRoute`, so a sign-out drops every unsaved edit (Task 10 D1).
- **TEST** `UnsavedEditsProvider.test.tsx`:
  - `markUnsaved` adds and removes;
  - `keep` stores and `take` returns once, then `undefined`;
  - `keep(id, null)` clears membership;
  - `beforeunload` calls `preventDefault` only while something is unsaved;
  - the hook throws outside the provider.
- **VALIDATE**: `npx vitest run UnsavedEditsProvider`

### 4. UPDATE `client/src/review/PayslipForm.tsx`: snapshot and restore (D1)

- **IMPLEMENT**:
  - New props:
    - `initialEdits?: UnsavedEdits`;
    - `onClose: (edits: UnsavedEdits | null) => void`;
    - keep `onDirtyChange`.
  - Take `getValues` and `setValue` from `useForm`. Keep `latest = useRef({ isDirty, dirtyFields })`
    updated every render.
  - **Restore**: a `useEffect(() => { … }, [])`, declared **after** `useForm` so that RHF's own
    `values` reset has already run. For each key in `initialEdits?.dirtyKeys`, call
    `setValue(key, initialEdits.values[key], { shouldDirty: true })`.
  - **Snapshot**: fold it into the existing unmount effect (line 98). The cleanup calls
    `onClose(dirty ? { values: getValues(), dirtyKeys } : null)` and then `onDirtyChange(false)`.
    `dirtyKeys` = the top-level keys of `latest.current.dirtyFields` with any truthy leaf (a small
    `hasDirtyLeaf` recursion, or `Object.keys` filtered by a deep check).
  - Mark the action bar's wrapper `data-hide-with-keyboard` (D5).
- **GOTCHA**:
  - `formState` is a proxy, and only fields read during render are subscribed. `dirtyFields` is
    already read at line 88, so the ref sees current values.
  - A table key's value is an array: `setValue("obustave", rows, { shouldDirty: true })` updates
    `useFieldArray`. If the rows do not appear in the test, fall back to
    `reset({ ...getValues(), ...picked }, { keepDefaultValues: true })`. Record which one was used.
  - Under StrictMode the effect runs mount → cleanup → mount. The first cleanup sees a clean form
    and passes `null`; the restore must still apply on the second mount. The parent passes the same
    `initialEdits` object, so this holds as long as `take` is called once, outside the form (step 8).
- **TEST** (extend `PayslipForm.test.tsx`):
  1. A form rendered with `initialEdits` for one scalar shows that value, reports dirty, and a save
     sends only that key.
  2. `initialEdits` with a removed `obustave` row renders one row fewer, and a save sends
     `obustave`.
  3. Unmounting a dirty form calls `onClose` with the typed value and its key; unmounting a clean
     one calls `onClose(null)`.
  4. Restored edits survive the tables landing (mirror the existing D19 test).
  5. The action bar carries `data-hide-with-keyboard`.
- **VALIDATE**: `npx vitest run PayslipForm`

### 5. CREATE `client/src/review/sourceStrip.ts` (D5, D6, D7 helpers)

- **IMPLEMENT**:
  - `stripView(bounds, ratio, box)` exactly as D6.
  - `isObscured(rect: { top: number; bottom: number }, visibleTop: number, visibleBottom: number)`:
    true when `rect.top < visibleTop` or `rect.bottom > visibleBottom`.
  - `overflowAfter(visible: readonly boolean[]): { index: number; count: number } | null`: the last
    fully visible chip's index and how many follow it, or `null` when none follow.
- **TEST** `sourceStrip.test.ts`:
  - `stripView`:
    - a thin line region fills ~45% of the height and is centred;
    - a very wide region is limited to 90% of the width;
    - a region at the page's left edge clamps `x` to 0 with no blank;
    - the result is capped at 8× the box width;
    - a zero-height region returns `null`.
  - `isObscured`: above, below and inside.
  - `overflowAfter`: all visible gives `null`; `[t,t,f,f,f]` gives `{index:1,count:3}`; the first
    partially visible gives the index before it.
- **VALIDATE**: `npx vitest run sourceStrip`

### 6. CREATE `client/src/review/PayslipRail.tsx` (D2, D7)

- **Props**:
  - `payslips: readonly PayslipSummary[]`;
  - `selectedId: string | null`;
  - `unsaved: ReadonlySet<string>`;
  - `orientation: "horizontal" | "vertical"`;
  - `onSelect(id: string)`.
- **IMPLEMENT**: D7's markup, keys, roving tabindex, snap classes and the `+N` observer (guard
  `typeof IntersectionObserver`), plus D2's chip content.
  - Language for the period comes from `i18n.language.startsWith("hr") ? "hr" : "en"`, as
    `PayslipForm` does.
  - Status icons: reuse `SessionPage`'s `statusIcon` (move it into this file, exported). Pending
    tables need no chip treatment.
- **TEST** `PayslipRail.test.tsx`:
  - one `tab` per payslip, `aria-selected` only on the selected one, and its `tabIndex` 0;
  - Right, Left (wrapping), Home and End move focus without calling `onSelect`;
  - in vertical mode Down and Up do the same, and `aria-orientation="vertical"` is set;
  - Enter and Space (a click) call `onSelect`;
  - the chip text shows the period in `hr` (`07/2025`) and `en` (`2025-07`), and the filename when
    the period is null;
  - the status text is visible;
  - the unsaved icon and its hidden text appear only for ids in `unsaved`;
  - every tab has the `min-h-12` class.
- **VALIDATE**: `npx vitest run PayslipRail`

### 7. CREATE `client/src/review/useSoftKeyboard.ts` (D5)

- **Signature**: `useSoftKeyboard(focusedPath: string | null): boolean`.
- **IMPLEMENT**:
  - A coarse-pointer state, mirroring `useCameraCapture`.
  - `open = coarse && focusedPath !== null`.
  - An effect on `open` sets and removes `document.documentElement.dataset.keyboard`, and removes it
    on unmount.
  - While `open` and `window.visualViewport` exists: `resize` and `scroll` listeners write
    `--visual-top` on `document.documentElement.style`. The first `resize` also runs
    `isObscured(document.activeElement.getBoundingClientRect(), 64, vv.height)` and, if true, calls
    `scrollIntoView?.({ block: "center" })` once.
  - Clean up the listeners and `--visual-top` on close.
- **TEST** `useSoftKeyboard.test.ts` (`renderHook`):
  - with a fine pointer, never open, and no attribute set;
  - with a coarse pointer, a path opens it and `null` closes it;
  - the attribute is removed on unmount;
  - with a stubbed `visualViewport` (an `EventTarget` with `offsetTop` and `height`), a `scroll`
    event writes `--visual-top`.
- **VALIDATE**: `npx vitest run useSoftKeyboard`

### 8. UPDATE `client/src/review/PayslipReview.tsx` (D1, D4, D5, D8)

- **IMPLEMENT**:
  - `const edits = useUnsavedEdits()`.
  - `const [initialEdits] = useState(() => edits.take(payslipId))`, taken **once** per mount (the
    component is keyed by id).
  - Pass `initialEdits` and `onClose={(e) => edits.keep(payslipId, e)}` to `PayslipForm`.
  - `onDirtyChange` becomes `(dirty) => edits.markUnsaved(payslipId, dirty)`. The prop leaves
    `PayslipReviewProps`.
  - A separate `focusedPath` state is set from `PayslipForm`'s `onFieldFocus`, alongside the
    existing `setActiveField`. The form's `onFieldFocus` now calls both.
  - `const keyboard = useSoftKeyboard(focusedPath) && !wide`.
  - **Grid**: `lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]`.
  - **DOM order**: the form `<div>` first (`lg:col-start-1 lg:row-start-1`), then the `<aside>`
    (`order-first lg:order-none lg:sticky lg:top-20 lg:col-start-2 lg:row-start-1`). Update the comment
    at line 94 to cite D8.
  - Pass `strip={keyboard}` to `SourceDocumentPanel`. While `keyboard`, the preview disclosure
    button is not rendered, and the `#payslip-source` wrapper is shown regardless of `previewOpen`:
    the strip replaces the collapsed and expanded preview alike.
- **GOTCHA**: the `take` must not run in render more than once per mount, hence the lazy
  `useState`. `useMemo` is not a semantic guarantee.
- **TEST** (extend `PayslipReview.test.tsx`, wrapping renders in `UnsavedEditsProvider` through a
  `MemoryRouter` + `Routes` layout, or a test wrapper that provides the context value directly):
  - edits kept for this payslip are passed to the form, and a dirty form marks the id unsaved;
  - the form column precedes the `<aside>` in the DOM;
  - with a coarse pointer and a focused input, `SourceDocumentPanel` (already mocked here) receives
    `strip: true`; blurring gives `false`; with a fine pointer it stays `false`.
- **VALIDATE**: `npx vitest run PayslipReview`

### 9. CREATE `client/src/review/SourceStrip.tsx` (D5, D6)

- **Props**:
  - `ratio: number`;
  - `overlaySafe: boolean`;
  - `regions: readonly SourceRegion[]`;
  - `page: number`;
  - `activeField: string | null`;
  - `editedFields`;
  - `children: (surfaceWidth: number) => ReactNode` (the canvas or the `<img>`).
- **IMPLEMENT**:
  - Measure the strip box with a `ResizeObserver` (guarded) plus an initial `clientWidth`, with the
    height fixed at 64.
  - Find the active field's first region on `page`, then compute
    `stripView(boundsOf(region.corners), ratio, box)`.
  - When the region is missing, the view is `null`, or `!overlaySafe`, render
    `<p className="px-3 text-sm text-slate-600">{t("review.stripNoOutline")}</p>`.
  - Otherwise render an `overflow-hidden relative h-16` box containing an absolutely positioned
    surface. The surface is `width: surfaceWidth`, `aspectRatio: ratio`, `transform: translate(x, y)`,
    with `children(surfaceWidth)` and
    `<SourceOverlay regions={[region]} page={page} activeField={activeField} editedFields={editedFields} onSelect={() => {}} />`
    inside a `pointer-events-none` wrapper.
  - The root is `aria-hidden="true"`.
- **TEST** `SourceStrip.test.tsx`:
  - with a region and `overlaySafe`, the surface gets the `translate` from `stripView` (stub
    `clientWidth` 343) and one polygon;
  - with no region for the field, the note shows;
  - with `overlaySafe` false, the note shows and no polygon;
  - the root is `aria-hidden`.
- **VALIDATE**: `npx vitest run SourceStrip`

### 10. CREATE `client/src/review/PageNavigator.tsx` (D3)

- **IMPLEMENT**:
  - `PageThumbnail({ document, page })`:
    - `viewportOf(page)`, then
      `document.render(page, (64 * devicePixelRatio) / width, canvas)`;
    - cancel the task on unmount;
    - ignore `isRenderCancellation` errors, and `console.error` anything else;
    - a `w-16` canvas with `aspect-ratio` from the viewport.
  - `PageRail({ document, page, onChange })`: D3's `lg` rail. Each button is
    `aria-label={t("review.pageThumbnail", { page })}` with a visible number, and the current one has
    `aria-current="page"`.
  - `PageSheet({ open, document, page, onChange, onClose })`:
    - a native `<dialog>`; `showModal()` when `open` (guarded as `ConfirmDialog` does);
    - title `review.choosePage` and a close button `review.closePages`;
    - a grid of thumbnail buttons.
  - `PageNavigator({ document, page, onChange, wide })`: returns `null` when `numPages <= 1`.
    - When `wide`, it renders `PageRail`.
    - Otherwise it renders the phone `<nav>`: prev, the pill (`review.pdfPage`) that opens the sheet,
      and next. Move `PagerButton` here from `PdfSource.tsx`.
- **TEST** `PageNavigator.test.tsx`, with a fake `LoadedPdf`
  (`{ numPages, viewportOf: async () => ({ width: 595, height: 842 }), render: () => ({ completed: Promise.resolve(), cancel: vi.fn() }), destroy: vi.fn() }`):
  - `numPages: 1` renders nothing, both wide and not;
  - wide: a `navigation` named "Pages", one button per page, `aria-current="page"` on the current,
    and a click calls `onChange(2)`;
  - phone: prev is disabled on page 1, next calls `onChange(2)`, and the pill opens the dialog (its
    `open` attribute, or the `showModal` stub called) listing both pages; choosing page 2 calls
    `onChange(2)` and closes it;
  - a thumbnail cancels its render on unmount.
- **VALIDATE**: `npx vitest run PageNavigator`

### 11. UPDATE `client/src/review/PdfSource.tsx` and `SourceDocumentPanel.tsx` (D3, D5)

- **`PdfSource`**:
  - New props: `strip: boolean` and `wide: boolean`, the latter from `useWideLayout()` inside
    `PdfSource`, which is simpler than threading it through.
  - Export `PdfCanvas`.
  - Remove `Pager` and `PagerButton`.
  - **Strip mode** returns `<div ref={host}>` wrapping
    `<SourceStrip ratio={rendered} overlaySafe={overlaySafe} …>{(w) => <PdfCanvas … viewport={{ width: w, height: w / rendered }} />}</SourceStrip>`.
    `page` already follows `activeField`, so `pageViewport` is the region's page.
  - Otherwise: when `wide`, `<div className="flex gap-2"><PageNavigator wide …/><div className="min-w-0 flex-1"><ZoomableSourceViewport …/></div></div>`.
    When not wide, `footer={<PageNavigator wide={false} …/>}`.
  - Keep the host `ref` on the outermost element in every branch, so the lazy-load observer still
    fires.
- **`SourceDocumentPanel`**:
  - Gains `strip?: boolean` (default `false`), passed to `PdfSource` and `ImageSource`.
  - `ImageSource` in strip mode renders `SourceStrip` with `ratio={aspectRatio ?? 1}`, `page={1}`,
    and `overlaySafe` from the same load check. Move the `onLoad` ratio computation so the strip's
    `<img>` sets `ratio` too. `children={(w) => <img … style={{ width: w }} />}`.
  - In strip mode the "Open in a new tab" link row is not rendered, and neither is the section's
    border: the strip wrapper owns the chrome.
  - The strip wrapper itself (`fixed inset-x-0 z-40 h-16 border-b bg-white`, `style={{ top:
    "var(--visual-top, 0px)" }}`) is rendered here around the strip branch.
- **GOTCHA**: do not touch `ZoomableSourceViewport.tsx`, `SourceOverlay.tsx` or `sourceZoom.ts`
  (locked decision 17). If the strip seems to need a change there, stop and record why.
- **TEST**: extend `SourceDocumentPanel.test.tsx`. On the image path, `strip` renders the strip,
  not the zoom controls, and does not render the open link. The PDF branch is covered by the
  `PageNavigator` and `SourceStrip` tests; `PdfSource` has no test today, so add none beyond that.
- **VALIDATE**: `npx vitest run SourceDocumentPanel SourceStrip PageNavigator`

### 12. UPDATE `client/src/review/LineItemSection.tsx` (D4, finding 6)

- **IMPLEMENT**: a `<colgroup>` inside the `<table>`:
  - `<col className="w-28" />` for a column whose `columnKind(table, column)` is `amount` or
    `quantity`;
  - `<col />` for text;
  - `<col className="w-14" />` for the removal column.
  - Remove the `w-14` on the header `<td>` (line 227), now carried by the `<col>`.
- **TEST**: extend `LineItemSection.test.tsx`: in wide mode the table has one `<col>` per column
  plus one, and the `iznos` column carries `w-28`.
- **VALIDATE**: `npx vitest run LineItemSection`

### 13. UPDATE `client/src/routes/SessionPage.tsx` (D4, D7)

- **IMPLEMENT**:
  - Remove what the CONTEXT REFERENCES list says to remove, and the imports that become unused
    (`ConfirmDialog`, `useRef` if unused, the `CheckCircle2`/`Loader2`/`AlertCircle` icons once
    `statusIcon` moves).
  - `const xl = useWideLayout(XL)`, `const { unsaved } = useUnsavedEdits()`.
  - `selected = payslips.find((p) => p.id === selectedId) ?? null`, any status. An effect on
    `[detail, selectedId]` calls `setSearchParams({ payslip: payslips[0].id }, { replace: true })`
    when `selected` is null and `payslips.length > 0`.
  - **Layout**:
    - `<section>` keeps the title and progress; the width is
      `max-w-xl lg:max-w-6xl xl:max-w-7xl` when any payslip exists.
    - Then `<div className="flex flex-col gap-5 xl:grid xl:grid-cols-[13rem_minmax(0,1fr)] xl:items-start xl:gap-6">`
      containing the rail (`xl:sticky xl:top-20`) and the tabpanel.
    - Then the pending batch list (`<ol>` of `Row`, as today, only when `pending.length > 0`), then
      **Scan more**.
  - **The tabpanel** is D7's; the `failed` branch reuses today's retry markup from lines 268–288
    verbatim, minus the row wrapper. The `retry()` focus line becomes
    `document.getElementById(`payslip-tab-${id}`)?.focus()`. Remove `rowId`.
  - The `h2` in the panel stays for structure. Drop `ref`, `tabIndex` and `scroll-mt-20`: nothing
    focuses it now.
  - `PayslipReview` no longer receives `onDirtyChange`.
- **TEST**: rewrite the two `describe` blocks at 353 and 462 (mock `useUnsavedEdits`, or wrap in the
  real provider):
  1. With no `?payslip=`, the first payslip is selected and the URL gains it by replace (assert
     through `useLocation` as the file already does).
  2. A payslip named in the URL is selected, even when `processing`: the panel shows
     `session.processingPanel`.
  3. A failed retryable payslip's panel shows its reason and Retry. Adapt the existing retry tests
     (215–311) to select it first; their assertions about focus move to the tab.
  4. Clicking another chip switches the panel with **no dialog**, and `PayslipReview` is rendered
     with the new id.
  5. A chip for an id in `unsaved` shows the unsaved text.
  6. Pending batch items still render with their status and dismiss (the existing 181 and 205
     tests).
  7. The rail is `aria-orientation="vertical"` with `matchMedia` for `XL` matching, and horizontal
     otherwise.
  8. `beforeunload` is no longer registered by the page (the provider's test covers it). Delete the
     old D13 tests.
- **VALIDATE**: `npx vitest run SessionPage`

### 14. UPDATE `client/index.html`, `client/src/index.css`, `BottomNav.tsx` (D5)

- `index.html` line 5:
  `content="width=device-width, initial-scale=1, interactive-widget=resizes-content"`.
- `index.css`, in `@layer base` after the focus rule:

  ```css
  /* Task 10 D5: while a review input is focused on a phone, the keyboard takes half the screen;
     the strip, the field and its note need the rest. */
  html[data-keyboard="open"] {
    scroll-padding-top: 5rem;
  }
  html[data-keyboard="open"] [data-hide-with-keyboard] {
    display: none;
  }
  ```

- `BottomNav.tsx`: `data-hide-with-keyboard` on the `<nav>`.
- **VALIDATE**: `npm run build` (confirms the CSS compiles) and
  `npx vitest run AppLayout`.

### 15. UPDATE `client/src/i18n/locales/en.json` and `hr.json`

| Key | en | hr |
| --- | --- | --- |
| `session.payslips` | Payslips | Platne liste |
| `session.unsaved` | Unsaved changes | Nespremljene promjene |
| `session.processingPanel` | This payslip is still being read. Its form opens here when it is ready. | Ova se platna lista još čita. Obrazac će se otvoriti ovdje kad bude spreman. |
| `review.pages` | Pages | Stranice |
| `review.pageThumbnail` | Page {{page}} | Stranica {{page}} |
| `review.choosePage` | Choose a page | Odaberite stranicu |
| `review.closePages` | Close | Zatvori |
| `review.stripNoOutline` | This value has no highlight on the payslip. | Ova vrijednost nema oznaku na platnoj listi. |

- **Remove**:
  - `review.discardTitle`, `review.discardDescription`, `review.discard`, `review.keepEditing`;
  - `session.review` and `session.hideReview`.

  Grep first to confirm no other user: `grep -rn "discardTitle\|keepEditing\|hideReview\|session.review\b" client/src`.
- **Keep** `session.showDocument` / `session.hideDocument` (the phone disclosure) and
  `review.pdfPage`, `pdfPreviousPage`, `pdfNextPage` (the phone pager).
- The product owner reads the copy at review.
- **VALIDATE**: `npx vitest run i18n statusCopy`

### 16. UPDATE the docs

- **PRD §7.6:**
  - Chips carry the position, the period (or filename) and a status icon with text. There are no
    thumbnails: letterheads in one session look alike (D2).
  - One page at a time: a pager pill with a page sheet on a phone, and a 72 px rail at `lg`.
    Replace "the preview scrolls continuously…" with "every page is reachable from the pager, sheet
    or rail; none only by horizontal scroll" (D3).
  - The vertical list is at `xl` (D4).
- **PRD §7.7:**
  - Replace "Unsaved edits prompt before switching…; the browser Back button is not covered until
    Task 10" with "Unsaved edits are kept per payslip in the tab while the user switches payslips,
    goes Back or leaves the session; the browser prompts on reload" (D1).
  - Add the keyboard layout: a 64 px source strip, and the bottom nav and action bar hidden while
    typing (D5).
- **PRD §12 Phase 3:** a Task 10 status line, "implemented; pending review; M2 pending".
- **ROADMAP:**
  - §2 row 10: "✅ complete, pending review; M2 pending".
  - §3 Task 10: an "Added in planning (plan 10)" list of D1–D8 in one line each, and DoD notes
    (below).
  - §3 Task 10 Scope: "44 px source strip" → "64 px (plan 10 D5)", and the chip thumbnail line
    marked superseded by D2.
  - §5 "Phone layout has no prior art": note that Task 10 built it and that M2 is the test.
- **CONTEXT.md**, new entry after **Edited field**:

  **Unsaved edits**: changes typed into a Payslip's review form and not yet saved. They are kept
  per Payslip in the browser tab while the user moves between Payslips, and lost on reload.
  _Avoid_: draft (every Extracted value is already a draft).

- **`.claude/commands/validate.md`** (git-ignored, edit by hand):
  - Phase 4 rows for each new test file;
  - **journey 9.9** (below);
  - delete the Phase 10 row for Task 10.

**Journey 9.9 — navigation and phone layout (Task 10, PAID ≤ 2 documents).** Navigation-only steps
may use the M1 data **read-only**. Edit steps use a throwaway account (plan 10 D9).

1. On M1 session with A01, arrive without `?payslip=`: the first chip is selected, the URL gains it,
   and Back leaves the session rather than un-selecting.
2. Rail at 375 px: two chips and a ~24 px peek, `+N` on the last visible chip, and scroll-snap on a
   swipe. Keyboard: Tab into the rail, Left and Right move focus without switching, Enter switches,
   Home and End work, and the focus ring is visible.
3. At 1280 px and above: a vertical list, the form, and a sticky source; Tab order goes rail → form →
   source; line-item names are not cut at 1440.
4. A01 (two pages): the phone pill reads "Page 1 of 2" and opens the sheet, choosing page 2 works,
   and focusing a page-2 field switches page. At 1024 px the page rail has `aria-current`. A
   single-page payslip shows no pager.
5. Throwaway account: edit a field on payslip 1, switch to 2, then back. The value is still there and
   Save sends it. Edit again and press browser Back, then Forward: still there. Chip 1 shows the
   unsaved mark. Reload while unsaved: the browser prompt.
6. 375 px, emulating touch: focus a field. The strip shows its region magnified; the bottom nav and
   action bar hide; blur brings them back. A field without a region shows the note.
7. No horizontal page scroll at 375 px (`document.documentElement.scrollWidth` 375), and every new
   control is ≥ 48 px.
8. Delete the throwaway data; orphan query.

The **real-iPhone** half of step 6 is M2, the product owner's.

### 17. RUN the full local validation, then WRITE the history file and STOP (D10)

- `npm run validate` must be green: typecheck, oxlint, Prettier, all tests. Report the file and test
  counts against step 1.
- `npm run build` must be green. The known Vite chunk-size advisory is fine.
- `git diff --stat package-lock.json` must be empty.
- `grep -rn "react-router-dom" client/src` must be empty.
- `grep -rn "draft" client/src/review/unsaved` must be empty, apart from a comment explaining the
  naming (D1).
- If any edit was made with a Windows tool that writes CRLF, run `npx prettier --write` on exactly
  the changed files (history/09 deviation 9).
- **WRITE** `.agents/history/10-session-navigation-phone-layout.md`, mirroring history/09's
  structure:
  - outcome and status;
  - what was built (a file table);
  - decisions;
  - deviations;
  - validation;
  - $0 paid runs;
  - open items, which at least include: M2; the Android back-gesture limit (D5); the zoom reset on
    leaving keyboard mode (D5); Task 09 findings 5 and 7, still open and not this task's;
  - a handoff to the review session: journey 9.9 under D9's budget, the copy read (step 15),
    `/code-review`, `/validate`.
- **Do not** run `/code-review`, `/validate` or any browser journey, and **do not commit**. Stop and
  report.

---

## TESTING STRATEGY

### Unit Tests

Vitest + Testing Library + jsdom, as in every `client/src/**/*.test.tsx`. New files:

- `UnsavedEditsProvider.test.tsx`
- `PayslipRail.test.tsx`
- `PageNavigator.test.tsx`
- `sourceStrip.test.ts`
- `SourceStrip.test.tsx`
- `useSoftKeyboard.test.ts`

Extended:

- `PayslipForm`, `PayslipReview`, `SourceDocumentPanel`, `LineItemSection` and `SessionPage` tests;
- the locale guards.

The pure functions (`stripView`, `isObscured`, `overflowAfter`) carry the geometry, so the parts
jsdom cannot lay out are still pinned.

### Integration Tests

None. No API, shared or database code changes. `npm run test:integration` is not required. Run it
only if something outside `client/` changed by accident, which it should not.

### Edge Cases

- A session with one payslip: a rail with one chip, no `+N`, no peek.
- A session whose only payslip is still `processing`: it is selected and the status panel shows.
  When it reaches `review`, the panel becomes the form without a reselect, because it is keyed by id
  and branches on status.
- A payslip retried while selected: processing, then the form.
- Unsaved edits for a payslip that is deleted or no longer in the session: never taken, and they
  stay in the ref map until sign-out. That is harmless and bounded by ten payslips per session.
- Unsaved edits reopened after the tables pass landed in the meantime: the scalar edits apply over
  the fresh values, and the tables were read-only while pending, so they cannot be dirty.
- A language switch between leaving and returning: the kept strings parse in either locale.
- The strip for a multi-line field (an address): the first region, one line.
- The strip on a page whose outlines are withheld: the note, never a misplaced crop.
- A 10-page PDF: ten thumbnails in the sheet and the rail, each cancelled on unmount.
- StrictMode's double effects in dev: `take` runs once per mount; the restore applies.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run lint`, `npm run typecheck`, `npm run format:check` (or `npm run validate`, which runs all
three).

### Level 2: Unit Tests

`npx vitest run client`, then the full `npm run validate`.

### Level 3: Integration Tests

Not applicable (client only). `npm run build` must succeed.

### Level 4: Manual Validation

**Not in this session** (D10). Journey 9.9 belongs to the review session, and M2 to the product
owner.

### Level 5: Additional Validation

`grep` checks from step 17. `git diff --stat package-lock.json` is empty.

---

## ACCEPTANCE CRITERIA

- [ ] The Task 10 DoD, "Switching payslips preserves unsaved edits on the one being left", holds
      for chip switches, Back and Forward, and leaving and returning to the session (D1). It is
      unit-tested here; journey 9.9 step 5 is for the review session.
- [ ] "A two-page payslip navigates and highlights across both pages; single-page payslips show no
      pager": `PageNavigator` tests, plus `pageForField` unchanged. Journey 9.9 step 4.
- [ ] "Keyboard navigation works: arrows move within the rail, Enter/Space activates, focus is
      visible throughout": `PayslipRail` tests. Journey 9.9 step 2.
- [ ] "Usable at 375 px width with no horizontal page scroll": journey 9.9 step 7.
- [ ] "Real-iPhone keyboard verification recorded": M2, the product owner's, not this session's.
- [ ] Task 09 findings 4 (Tab order) and 6 (truncated line-item names) are addressed (D8, D4).
- [ ] History/09 open items 1 (Back loses edits) and 5 (phone preview scrolls away) are closed by D1
      and D5.
- [ ] `npm run validate` and `npm run build` are green, with no new dependency.
- [ ] `ZoomableSourceViewport.tsx`, `SourceOverlay.tsx` and `sourceZoom.ts` are unchanged.
- [ ] The PRD, ROADMAP, CONTEXT and `validate.md` are updated as step 16 lists.
- [ ] `history/10-*.md` is written, and the session stopped without review, validate, browser or
      commit.

---

## COMPLETION CHECKLIST

- [ ] All steps done in order, each step's VALIDATE passed when it ran
- [ ] Full `npm run validate` green; `npm run build` green
- [ ] Lockfile unchanged
- [ ] Docs updated
- [ ] History file written, with open items and a handoff
- [ ] Stopped for the review session (pinned memory; D10)

---

## NOTES

- **Why not a data router?** `useBlocker` needs `createBrowserRouter`. Migrating `main.tsx` and
  `App.tsx` to it would block Back but still lose the edits. D1 keeps them, which is what the DoD
  asks, and closes the Back gap as a side effect.
- **Why hide the action bar?** On a 375 × 667 phone, the keyboard (~300 px with its suggestion row)
  leaves ~360 px. Header 56, bottom nav 64 and action bar ~90 leave ~150 px for the strip, the label,
  the input and its attention note. With D5's hiding, the strip covers the header and ~300 px
  remain.
- **The risk this plan cannot retire** is iOS Safari's keyboard behaviour: whether the fixed strip
  tracks `offsetTop` smoothly, and whether focus scrolling respects `scroll-padding-top`. The code
  is small and isolated in `useSoftKeyboard` and the strip wrapper, so M2's findings can be applied
  there without touching the rest.
- **Confidence: 7/10** for one-pass implementation. The two soft spots:
  - RHF restoring a field array via `setValue` (step 4 gives the fallback);
  - `PdfSource`'s branches keeping the lazy-load host `ref` (step 11).

  Both surface immediately in unit tests or the build.
