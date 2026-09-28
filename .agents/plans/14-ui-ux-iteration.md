# Feature: Task 14 — UI/UX iteration

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md`](../ROADMAP.md): the first iteration after the 13-task roadmap
(its header: "later work is planned as new iterations from the product owner's own testing").
Locked decisions 4 (merge by menu), 9 (two navigation controls) still hold · **PRD:** §3 (phone
first), §7.2, §7.6, §7.7, §7.10, §7.13, §11.5 · **Previous tasks:**
[`history/07`](../history/07-capture-multi-upload.md) (tray, downscale),
[`history/08`](../history/08-source-regions-preview.md) (viewport, overlay, ratio guard),
[`history/09`](../history/09-review-form-two-way-linking.md) (form, popover, action bar D14),
[`history/10`](../history/10-session-navigation-phone-layout.md) (rail, pager, strip, D4 layout),
[`history/11`](../history/11-merge-payslips.md) (merge banner and dialog),
[`history/12`](../history/12-export-history.md) (history page) · **Reference implementation:**
`../receipt-ocr/client/src/routes/{HomePage,ReviewPage,ProcessingPage}.tsx` (the sibling this was
forked from; the product owner likes its home page, back link, buttons and loading screen) ·
**Glossary:** [`CONTEXT.md`](../../CONTEXT.md) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md).

## Feature Description

A pass over every signed-in screen, from the product owner's own testing on desktop and an Android
phone (2026-09-28 planning session, questions Q1–Q27):

- **Copy**: "History" becomes "Payslips"; the English app name becomes "Payslip Scanner"; every
  Croatian string uses the polite "vi" form (skenirajte, odaberite); the home page copy follows
  receipt-ocr; list statuses, the list title, the delete dialog and the review heading are
  reworded.
- **Home page**: receipt-ocr's two-column layout at `lg` (tray and buttons on the left, "How it
  works" on the right). The phone keeps today's button order.
- **Review screen**:
  - a full-screen spinner until the first payslip is readable;
  - chips that cannot open yet are marked unavailable;
  - chips show the file name and status only;
  - the rail sits on top at every width;
  - form and document split 1:1, with the document fitting its column's width on desktop;
  - a "Back to payslips" link;
  - Save and Confirm are ordinary buttons at the end of the form;
  - no "Scan more payslips" button.
- **Document viewer**:
  - sharp at high zoom (PDF redrawn once zooming stops);
  - photos upload at up to 3,000 px;
  - two-finger pinch zooms the document, not the page;
  - the next-page arrow no longer jumps the page to the top;
  - the phone document no longer wobbles while scrolling;
  - the "Tap a highlighted value…" hint is gone.
- **Shell**: the desktop sidebar stays in place while the content scrolls.

## User Story

As someone reviewing scanned payslips on a laptop or a phone
I want a readable document beside the form, obvious navigation and professional, polite copy
So that I can check every value against its source without fighting the layout.

## Problem Statement

Found by the product owner, with causes established in planning:

1. **The desktop document is small on laptops.** `ZoomableSourceViewport.tsx:236-239` sizes the box
   so the whole page fits (`max-h-[65dvh]`, `width: min(100%, 65dvh * ratio)`), so a portrait page is
   height-bound. The xl vertical rail (`SessionPage.tsx:348`, `13rem`) and the 3:2 split
   (`PayslipReview.tsx:98`) narrow it further. Estimated A4 width today: ~350 px at 1366×768, ~390 px
   at 1536×864, ~380 px at 1920×1080.
2. **Zoomed PDFs are blurry.** `pdfRender.ts` rasterises once at 2.5× the fitted width, capped at
   `MAX_CANVAS_WIDTH = 2600`, and `MAX_ZOOM = 8`. The code comment itself says text "softens" past
   ~250%. The product owner has to zoom to ~500% to read A01.pdf on desktop.
3. **Photos are blurry when zoomed.** `capture/downscale.ts` re-encodes any image over 2 MP or 1.5 MB
   to a 1,600 px long edge. A02.jpg (1220×2712, 3.3 MP) is stored at 720×1600. Of the six golden-set
   photos only A02.jpg and B02.jpg are over the threshold. Accuracy was measured on original bytes
   (the extraction harness uploads originals), so keeping more pixels moves the product toward what
   was measured.
4. **There is no in-app pinch.** The viewer zooms by buttons and wheel only; nothing handles
   two-finger touch. On a phone the user pinches the **browser page**, which magnifies everything,
   including the region popover (`RegionPopover.tsx`, which already sits outside the zoom layer).
5. **The next-page arrow jumps the phone page to the top.** Likely cause: while the next page's size
   is measured, `PdfSource.tsx:143-158` replaces the whole viewer with a `Spinner`, so the page's
   content height collapses and the browser scrolls up. At `lg` the source is sticky, which fits the
   bug not appearing there. **To be confirmed** in the review session before and after the fix.
6. **The phone document wobbles while scrolling.** Likely cause: the box width follows `65dvh`
   (`ZoomableSourceViewport.tsx:239`). On a 375×667 phone `65dvh × 0.707 ≈ 306 px` is less than the
   343 px column, so the width is height-bound. `dvh` changes as the address bar hides, and each
   change re-renders the canvas (`PdfSource.tsx:255`). **To be confirmed** on the product owner's
   Android phone.
7. **Copy and layout** that the product owner rejected:
   - "History" as a destination; "Payslip OCR" as the English name;
   - informal Croatian imperatives (`Skeniraj`, `Odaberi`, `Pokušaj`…);
   - "Odaberi datoteku" (singular) against "Choose files";
   - the long home copy; "Scan another";
   - "Payslip history";
   - the list statuses "Očitavanje u tijeku" and "Spremno za pregled";
   - a delete body naming "history, session and exports";
   - "Your payslips" as the review heading;
   - numbered chips with periods;
   - no back link;
   - "Scan more payslips";
   - a sticky action bar;
   - a sidebar that scrolls away;
   - a small in-panel status line while everything is processing.

## Solution Statement

- **Copy** (`client/src/i18n/locales/{en,hr}.json`): the D1–D10 strings, a formal-"vi" sweep,
  and a new `historyStatus` group guarded by `statusCopy.test.ts`.
- **Shell**:
  - `/history` becomes `/payslips` with the `FileText` icon;
  - the desktop sidebar is sticky;
  - the `index.html` placeholder title changes.
- **Home**: two columns at `lg`, with the element order chosen by `useWideLayout()`, so DOM order
  equals visual order.
- **Review page** (`SessionPage`, `PayslipRail`, `PayslipReview`, `PayslipForm`, merge copy):
  - a loading screen;
  - a first-openable selection rule;
  - `aria-disabled` chips showing the file name and status;
  - a horizontal rail at every width;
  - a back link and plural heading;
  - a 1:1 grid over the full main width;
  - a non-sticky action block;
  - file names in the merge copy.
- **Viewer** (`sourceZoom.ts`, `ZoomableSourceViewport.tsx`, `PdfSource.tsx`, `pdfRender.ts`):
  - the zoom model gains a content size separate from the viewport, so desktop fits the column's
    **width** inside a screen-height frame (D17);
  - pinch zoom from pointer events (D19);
  - the PDF is redrawn at the settled zoom within a pixel budget, double-buffered (D18);
  - the viewer stays mounted while a page changes (D20);
  - `svh` replaces `dvh` on the phone (D21).
- **Capture**: `downscale.ts` resizes only above a 3,000 px long edge (D22).
- **Docs**:
  - PRD §7.2, §7.6, §7.7;
  - a ROADMAP §2 line;
  - `validate.md` journey 9.13;
  - history/14.

## Feature Metadata

**Feature Type**: Enhancement + Bug Fix
**Estimated Complexity**: High. Most items are copy and layout, but D17–D19 change the zoom model
the viewer's hard-won fixes sit on (`ZoomableSourceViewport.tsx:59-66`).
**Primary Systems Affected**:
- `client/src/i18n/locales/*` and `client/src/i18n/statusCopy.test.ts`;
- `client/src/{App.tsx, components/{AppLayout,NavItems}.tsx}` and `client/index.html`;
- `client/src/routes/{HomePage,HistoryPage,SessionPage}.tsx`;
- `client/src/history/{PayslipCards,PayslipTable}.tsx`;
- `client/src/review/{PayslipRail,PayslipReview,PayslipForm,ZoomableSourceViewport,PdfSource,SourceDocumentPanel,sourceZoom,pdfRender}.ts(x)`;
- `client/src/session/{MergeSuggestions,MergeDialog}.tsx`;
- `client/src/capture/downscale.ts`;
- docs.
**Dependencies**: none new. No API, shared, migration or lockfile change. If the lockfile changes,
stop and explain why.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-28 (Q1–Q27). Do not reopen them without new evidence.
"PO" marks a product-owner decision; "planner" marks one made in planning within an agreed direction.

### D1 — Task framing (PO, Q1)

One task, numbered 14, in `plans/` and `history/`. ROADMAP §2 gets one line under the table. The
Task 13 device sitting is deferred until after Task 14 ships; do not touch history/13's checklist.

### D2 — Navigation (PO, Q2)

- The label is "Payslips" / "Platne liste", with lucide `FileText`.
- The route `/history` becomes `/payslips`, with no redirect.
- Keys (`common.navHistory`, `history.*`) and component names (`HistoryPage`, `client/src/history/`)
  stay as they are: renaming them is churn the product owner did not ask for.

### D3 — App name (PO, Q5)

`common.appName` in `en` becomes "Payslip Scanner"; `hr` stays "Skener platnih lista". The
`index.html` placeholder `<title>` becomes "Payslip Scanner". PRD, README and the repository keep
"Payslip OCR".

### D4 — Home page (PO, Q3, Q4, Q6)

- **Copy**, mirroring receipt-ocr's `capture.title` / `capture.guidance` / `home.step*`:

  | Key | en | hr |
  | --- | --- | --- |
  | `home.title` | Add payslips | Dodajte platne liste |
  | `capture.guidance` | Keep the whole payslip in view, make the text readable and avoid glare. | Neka cijela platna lista bude u kadru, tekst čitljiv, a odsjaj što manji. |
  | `home.stepsTitle` (new) | How it works | Kako funkcionira |
  | `home.step1` (new) | Capture payslips or choose files. | Snimite platne liste ili odaberite datoteke. |
  | `home.step1NoCamera` (new) | Choose files. | Odaberite datoteke. |
  | `home.step2` (new) | The payslips are read automatically. | Platne liste automatski se očitavaju. |
  | `home.step3` (new) | Check the values and confirm each payslip. | Provjerite vrijednosti i potvrdite svaku platnu listu. |
  | `capture.chooseFiles` | Choose files | Odaberite datoteke |
  | `capture.scan` | Scan payslip | Skenirajte platnu listu |

- **Removed keys**: `home.subtitle` and `capture.scanAnother`. The camera button always says
  `capture.scan`.
- **"Up to 10 at a time" leaves the guidance.** The cap is still explained when reached
  (`capture.cap`, `capture.overCap`), which keeps Task 07's "explained, not silently enforced".
- **Layout at `lg`**, mirroring receipt-ocr `HomePage.tsx:136-266`:
  - `grid lg:max-w-5xl lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)] lg:gap-16`;
  - the left column holds the heading and guidance, then notices, tray, the Upload button and the
    pickers **below** it, then the error;
  - the right column holds `home.stepsTitle` and the three numbered steps, bordered left as in
    receipt-ocr.
- **Below `lg`** the order is today's: pickers, cap note, notices, tray, Upload, error. The steps
  column shows below, as receipt-ocr does at phone width.
- **The order is chosen in JSX by `useWideLayout()`**, never by CSS `order`, so Tab order matches
  what is seen (WCAG 2.4.3).
- **Picker styling on wide screens.** Once the tray has items, the file picker uses
  `secondaryPicker`, because Upload is the primary action (receipt-ocr's selected state). On a phone
  it stays exactly as today (Q "On mobile, I actually like the current button layout").

### D5 — Formal "vi" sweep (PO, Q7)

Every Croatian string, buttons and aria-labels included, uses the "vi" imperative. The complete
list found by a scan of `hr.json` (262 strings) on 2026-09-28:

| Key | Now | Becomes |
| --- | --- | --- |
| `common.retry` | Pokušaj ponovno | Pokušajte ponovno |
| `common.dismiss` | Zatvori | Zatvorite |
| `review.closePages` | Zatvori | Zatvorite |
| `review.save` | Spremi promjene | Spremite promjene |
| `review.confirm` | Potvrdi platnu listu | Potvrdite platnu listu |
| `review.addRow` | Dodaj redak | Dodajte redak |
| `review.removeRow` | Ukloni redak {{row}} | Uklonite redak {{row}} |
| `capture.remove` | Ukloni {{name}} | Uklonite {{name}} |
| `capture.upload_one/_few/_other` | Pošalji … | Pošaljite {{count}} platnu listu / platne liste / platnih lista |
| `session.dismiss` | Odbaci {{name}} | Odbacite {{name}} |
| `session.retry` | Pokušaj ponovno | Pokušajte ponovno |
| `session.showDocument` / `hideDocument` | Prikaži / Sakrij dokument | Prikažite / Sakrijte dokument |
| `merge.mergeWith` | Spoji s drugom platnom listom… | Spojite s drugom platnom listom… |
| `merge.pickTitle` | Spoji s drugom platnom listom | Spojite s drugom platnom listom |
| `merge.continue` | Nastavi | Nastavite |
| `merge.swap` | Zamijeni redoslijed | Zamijenite redoslijed |
| `merge.confirm` | Spoji | Spojite |
| `merge.cancel` | Odustani | Odustanite |
| `merge.reviewSuggestion` | Pregledaj spajanje | Pregledajte spajanje |
| `history.downloadCsv` / `downloadJson` | Preuzmi CSV / JSON | Preuzmite CSV / JSON |
| `history.delete` | Obriši | Obrišite |
| `history.confirmDelete` | Obriši platnu listu | Obrišite platnu listu |
| `history.cancelDelete` | Zadrži je | Zadržite je |
| `history.emptyAction` | Skeniraj platnu listu | Skenirajte platnu listu |

`capture.scan`, `capture.chooseFiles` and `session.scanMore` are covered by D4 and D14. After the
edits, **read the whole of `hr.json` once**, including `warnings`, `failureReason` and `upload`,
because the scan matched a verb list, not a grammar. Record the check in history/14. There is no
automated guard: a word list would be a heuristic that misses forms and flags nouns.

### D6 — List page (PO, Q8, Q9, Q20)

- `history.title`: "Your payslips" / "Vaše platne liste".
- **A new top-level group `historyStatus`**, keyed by `PAYSLIP_STATUSES`, used by the list's
  filter, cards and table:

  | Code | en | hr |
  | --- | --- | --- |
  | processing | Processing | U obradi |
  | review | Needs review | Za pregled |
  | confirmed | Confirmed | Potvrđena |
  | failed | Failed | Neuspješna |

  The Croatian adjectives agree with *platna lista*.
- **`payslipStatus` is unchanged.** It stays as the rail's, the merge dialog's and the form's
  wording (PO: "I would keep the statuses there as they are currently"). The session progress line
  keeps "ready to review".
- **`history.deleteBody`**:
  - en: "{{name}} will be deleted. You cannot undo this."
  - hr: "Platna lista {{name}} bit će obrisana. Ovu radnju ne možete poništiti."

### D7 — Review heading and back link (PO, Q10, Q17)

- **Heading**: `session.title` becomes plural keys, counted by `total` (the same count as the
  progress line):
  - `session.title_one` / `_other` (en): "Review payslip" / "Review payslips";
  - hr `_one` / `_few` / `_other`: "Pregledajte platnu listu" / "Pregledajte platne liste" /
    "Pregledajte platne liste".
- **Back link**: `review.backToPayslips` (new, "Back to payslips" / "Natrag na platne liste")
  above the heading, linking to `/payslips`. Mirror receipt-ocr `ReviewPage.tsx:282-289`
  (`ChevronLeft`), but with `min-h-12` for the 48 px rule (PRD §11.5).
- The progress line stays under the heading.

### D8 — Loading screen (PO, Q11, planner on "processed")

`SessionPage` shows a full-screen state like receipt-ocr `ProcessingPage.tsx:97-107`: `Spinner`,
`session.preparingTitle` ("Preparing your payslips" / "Pripremamo vaše platne liste") and
`session.preparingDescription` ("This can take a moment." / "Ovo može potrajati trenutak."),
inside an `aria-live="polite"` section. It shows **while**:

- `loadState === "loading"`, **or**
- no server payslip is *openable* (`review`, `confirmed` or `failed`) **and** something is still in
  flight: a payslip is `processing`, or an upload item is `waiting` or `uploading`.

"Processed" counts `failed` (planner): a failure is a finished result the user can act on (retry,
remove), and hiding it behind a spinner until a sibling finishes would strand it. When every
payslip failed or every upload was rejected, the normal page shows at once. `review` means the
scalars pass landed, the "main part" the PO named (tables may still be pending).

### D9 — Default selection (PO, Q11)

When `?payslip=` is absent, or names a payslip that no longer exists, select the **first openable
payslip in list order**, preferring readable (`review`/`confirmed`) over `failed`. Do not select
anything while nothing is openable; the loading screen covers that. With one poll every 2 s,
"first in list order among those ready" is "whichever finished first" in practice. An explicit
`?payslip=` naming a `processing` payslip (a history row, or the merged placeholder) is respected
and shows today's processing panel.

### D10 — Chips (PO, Q12, Q13, Q14)

- **Content**: the file name (`originalFilename`, truncated with `truncate`), the unsaved-edits
  mark, and the status icon with `payslipStatus` text. Remove the position number and the period,
  along with `formatField` and the `i18n` destructure if unused.
- **A `processing` chip is `aria-disabled="true"`.** It stays focusable in the roving tablist, so
  arrow keys still reach it and it is announced as unavailable. Click and Enter/Space do nothing.
  It gets a visual treatment that is not colour alone: reduced opacity **and** the spinner icon and
  "Reading the payslip" text it already carries. `failed`, `review` and `confirmed` chips open. A
  selected chip that becomes `processing` (retry) stays selected.
- **Always horizontal.** Remove the `vertical` orientation from `SessionPage` (the `xl` grid and
  `useWideLayout(XL)`) and from `PayslipRail`, which keeps only its horizontal branch. Delete the
  `orientation` prop and the `ArrowUp`/`ArrowDown` handling. Delete `XL` from `useWideLayout.ts`
  if nothing else imports it.
- **Width.** Chips keep today's phone widths. At `lg` they are a fixed `lg:w-60` (15 rem), so a
  desktop rail shows several at once and the `+N` badge and peek still work.
- **Uploads still in flight** keep their rows below the rail (`Row`), without the position label.

### D11 — Merge copy without positions (PO, Q26)

- `merge.suggestion`: "{{a}} and {{b}} look like pages of one payslip." / "{{a}} i {{b}} izgledaju
  kao stranice jedne platne liste.". `a` and `b` are file names, shortened to at most 40 characters
  by a small `shortName` helper in `MergeSuggestions.tsx` that keeps the extension:
  `very_long_…_scan.jpg`.
- `merge.swapped`: "Order swapped. {{name}} is now first." / "Redoslijed je zamijenjen. {{name}} je
  sada na prvom mjestu.".
- `MergeDialog.tsx:166` and `:199`: drop the `session.position` line. The file name is already
  shown below it at `:167`; in the pick step (`:199`), show `payslip.originalFilename` in its place.
- The panel heading (`SessionPage.tsx:369-372`) becomes the file name only.
- `session.position` is then unused: remove it from both locales.

### D12 — Desktop review layout (PO, Q14, Q27)

- **Rail on top**, then the selected panel: its file-name heading and `⋮` menu, then
  `PayslipReview`.
- **Full main width at `lg`.** The section is `lg:max-w-none` instead of
  `lg:max-w-6xl xl:max-w-7xl`, so the document column gains width on 1080p screens.
- **1:1 split**: `PayslipReview`'s grid becomes `lg:grid-cols-2`. The source `<aside>` stays
  `lg:sticky lg:top-20`.
- **The document fits the column's width (D17)** inside a frame whose height fills the screen
  below the header: `--source-height: calc(100dvh - 15rem)` at `lg`. The 15 rem is the sticky top
  offset (5 rem), the zoom toolbar (3.5 rem), the "Open in a new tab" row (3.75 rem), the panel
  padding (1.5 rem) and a 1 rem bottom margin. Tune it in the review session at 1366×768 and
  1920×1080, so the whole aside is visible without page scrolling.
- **Estimated effect** (to be measured in review): ~520–600 px page width at 1366–1536 px, and
  ~800 px at 1920 px, against ~350–390 today.

### D13 — Save and Confirm (PO, Q18)

The action block in `PayslipForm.tsx:228-275` loses `sticky`, its bottom offsets, `-mx-4` and
`data-hide-with-keyboard`. It sits in flow after the last table, with the same content: error,
unsaved note, Save, Confirm and the confirm-blocked reason. Keep `border-t` and `pt-4` as a
separator.

`data-hide-with-keyboard` goes because hiding an in-flow block while typing would shift the form
under the user's finger. The keyboard strip (Task 10 D5) never covered it once it is not pinned.
`BottomNav` keeps the attribute. The Toast offset (`Toast.tsx:60`) is about the bottom navigation
and is unchanged; update the comment at `PayslipForm.tsx:228` since it is being deleted.

### D14 — "Scan more payslips" (PO, Q17)

Removed from the session page's foot (`SessionPage.tsx:462-464`). Kept only on the not-found state
(`:260`), with `session.scanMore` reworded "Scan payslips" / "Skenirajte platne liste", because that
page otherwise has no way out. The bottom navigation and sidebar "Scan" remain the way to start a
new scan.

### D15 — Sticky sidebar (PO, Q19)

In `AppLayout.tsx`, the desktop `<nav>` gains
`lg:sticky lg:top-16 lg:h-[calc(100dvh-4rem)] lg:self-start lg:overflow-y-auto`. The page keeps
window scrolling; only the content moves. The header is already `sticky top-0` (`h-16` at `lg`).
Every page benefits.

### D16 — The "tap a highlighted value" hint (PO)

Delete `ZoomableSourceViewport.tsx:338-340` and `review.inspectPrompt` from both locales.

### D17 — Fit width on desktop, fit page on the phone (PO, Q27)

The zoom model gains a **content size** distinct from the **viewport** (the clipping frame):

- **`fit="page"`** (below `lg`, and in the keyboard strip's absence of zoom): the frame has the
  page's ratio, content = frame, and `MIN_ZOOM = 1`. This is **today's behaviour, unchanged.** The
  frame's height budget is `65svh` (D21).
- **`fit="width"`** (at `lg`, chosen by `useWideLayout()` in `PdfSource` and `ImageSource`):
  - the frame is the column's width by `--source-height`;
  - the content is the column's width by `width / ratio`, usually taller than the frame;
  - zoom 1 means page width, anchored at the top (`y = 0`);
  - the minimum zoom is `min(1, frameHeight / contentHeight)`, the whole page;
  - the reset button returns to zoom 1 at the top.
  - **Plain wheel pans** (`deltaY` vertical, `deltaX` or Shift horizontal). It calls
    `preventDefault` only when the pan actually moved, so at the top or bottom edge the page scrolls
    on, as nested scrolling does.
  - **Ctrl + wheel zooms** about the cursor; trackpad pinch arrives as Ctrl + wheel in Chromium and
    Firefox.
  - A focused field's outline is brought into view whenever it is outside the frame, **at any
    zoom**. Today `ZoomableSourceViewport.tsx:155` skips this at `MIN_ZOOM`, where it was always
    visible; under fit width it may not be.
- **Clamping**: in each axis, when the scaled content is smaller than the frame it is **centred**;
  when it is larger it must cover the frame (today's rule).
- The overlay, region maths (`centreOn`, `isRegionVisible`, `popoverTop`) and the painted surface
  use the **content** size. Today they use the viewport size, because the two were equal.
- The transformed layer gets an explicit content `width`/`height` instead of `absolute inset-0`.
  `children` receives the content size.

### D18 — Sharp PDFs at any zoom (PO, Q21)

- The PDF bitmap is redrawn after zooming **settles**: 200 ms after the last change to `view.zoom`.
  During a gesture the current bitmap is CSS-scaled.
- **Target bitmap width** = `contentWidth × dpr × max(settledZoom, RENDER_QUALITY)`, reduced
  proportionally until `width × height ≤ budget`. The budget is **16,777,216 px** where
  `(pointer: coarse)` matches (Safari's canvas area limit) and **33,554,432 px** otherwise (pdf.js's
  default `maxCanvasPixels`).
- At fit (`settledZoom ≤ RENDER_QUALITY`) the target equals today's formula, so no extra render
  happens until zoom passes 2.5×. `MAX_CANVAS_WIDTH` is replaced by the budget.
- **Double buffering**: render into an off-screen `<canvas>`. On completion, size the visible canvas
  and `drawImage` the off-screen one in the same task, then drop it. Nothing blanks, and there is no
  flicker (the reason receipt-ocr avoided re-rendering). A newer settle cancels an in-flight render.
- Redraw only when the target differs from the current bitmap width by more than 1%. Zooming back
  to fit redraws at the fit size, freeing memory.
- **Images are unchanged**: the browser resamples an `<img>` from its full source on every frame.
- **Acceptance** (review session): A01.pdf at 500% on desktop reads crisply after the settle, and no
  blank frame appears while zooming.

### D19 — Pinch zoom (PO, Q25)

- Two pointers on the frame zoom the document about their midpoint, using
  `zoomAbout(start, …, startZoom × distance / startDistance, midpoint)` relative to the state when
  the second finger landed.
- **One pointer** pans when the content overflows the frame, which is today's drag logic.
- **`touch-action`**: `pan-y` on the frame when the content does not overflow, so a one-finger
  vertical swipe scrolls the page and the browser's own pinch is disabled on the frame; `none` when
  it overflows (today's `touch-none` when zoomed).
- **Suppression**: a pinch sets `suppressClick` like a drag, so lifting fingers never activates an
  outline.
- The browser can still zoom the page from anywhere outside the frame; that is accepted.
- The popover needs no change. It already renders outside the zoom layer at a fixed size, and it
  stays readable once the page itself is no longer magnified.

### D20 — The page jump (PO, Q24)

In `PdfSource`, while the next page's size is measured, **keep the viewer mounted** with the
previous page's `pageViewport`, and overlay the `Spinner` inside the frame. Never replace the frame
with a bare spinner (`:143-158`). The frame keeps its box, so the page height does not collapse. The
first load (no `pageViewport` yet) still shows the spinner in place.

The review session reproduces the jump **before** checking out the fix, at 375 px in Chromium (touch
emulation, pager scrolled into view, `window.scrollY` before and after Next), and checks `lg` too. If
it does not reproduce there, the product owner's phone check after the deploy is the evidence.

### D21 — The wobble (planner, confirmed cause pending)

The phone budget uses `svh` (small viewport height), which does not change as the address bar
shows and hides: `max-h-[var(--source-height,65svh)]` and
`width: min(100%, var(--source-height,65svh) * ratio)`. The frame then stops resizing on scroll, and
the canvas stops redrawing. The desktop budget uses `dvh`, which is stable where there is no dynamic
toolbar. Chromium emulation has no dynamic toolbar, so this is checked on the product owner's
Android phone after the deploy.

### D22 — Photo upload size (PO, Q22)

`downscale.ts` resizes only when the **long edge exceeds 3,000 px**, to a 3,000 px long edge.
Otherwise a file over `DOWNSCALE_MAX_BYTES`, raised to 4 MB, is re-encoded at its own size. JPEG
quality stays 0.82. The pixel-count rule is removed, because the long edge is what matters for
legibility.

Extract the decision as a pure, exported `downscaleTarget(width, height, bytes)` returning
`{ width, height } | null`, so it can be unit-tested; jsdom cannot decode an image. The effect on
the golden photos (A02.jpg 1220×2712 keeps its pixels; B02.jpg 3024×4032 becomes 2250×3000) is
measured by the step 16 probe, $0.

The server limits are unchanged: 10 MB per upload, 10 MB for a merged PDF. A 3,000 px JPEG at 0.82
is well under both.

### D23 — Paid runs and the session split (standing rules)

- **$0 in this session.** No extraction, no Azure call.
- The **review session's** journey 9.13 uses at most **two** paid two-pass analyses (about $0.10),
  one to watch the loading screen hand over to the first payslip and one behind it. Everything else
  is seeded at $0, as journeys 9.10–9.12 did.
- The implementing session stops before `/code-review`, `/validate`, browser journeys and commit.
  The pinned memory requires that; this plan does not ask for a browser. A browser **is** needed to
  judge D17–D21, and that is the review session's job.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `client/src/review/ZoomableSourceViewport.tsx` (all). Read the whole file before touching it:
  - `:59-66`: why it is one component;
  - `:103-124`: measuring and re-clamping;
  - `:148-158`: auto-pan to a focused region;
  - `:160-182`: the non-passive wheel listener;
  - `:236-296`: the frame, deferred capture and click suppression;
  - `:338-340`: the hint to delete;
  - `:354-358`: `popoverTop`.
- `client/src/review/sourceZoom.ts` (all) and `sourceZoom.test.ts`: the zoom maths D17 extends. The
  `ZoomState` comment at `:6-18` explains the transform composition.
- `client/src/review/PdfSource.tsx` (all): the page-change branch `:143-158` (D20), `PdfCanvas`
  `:238-260` (D18), and the strip use `:164-186`, which must keep working.
- `client/src/review/pdfRender.ts` and `pdfRender.test.ts`: `RENDER_QUALITY`, `MAX_CANVAS_WIDTH` and
  `renderScale`.
- `client/src/review/pdfDocument.ts:74-99`: `render()` sizes the canvas bitmap itself. The
  off-screen buffer (D18) goes through the same function.
- `client/src/review/SourceDocumentPanel.tsx:197-298`: `ImageSource`, the image path through the
  viewport.
- `client/src/review/RegionPopover.tsx`: rendered outside the zoom layer (`:61-66`). It stays.
- `client/src/review/PayslipReview.tsx:97-167`: the grid, the aside and the phone disclosure.
- `client/src/review/PayslipForm.tsx:228-275`: the action block (D13).
- `client/src/review/PayslipRail.tsx` (all) and `PayslipRail.test.tsx`: D10.
- `client/src/routes/SessionPage.tsx` (all) and `SessionPage.test.tsx`: D7–D11, D14.
- `client/src/routes/HomePage.tsx` (all) and `HomePage.test.tsx`: D4.
- `../receipt-ocr/client/src/routes/HomePage.tsx:132-270`: the two-column layout to mirror.
- `../receipt-ocr/client/src/routes/ReviewPage.tsx:282-289`: the back link to mirror.
- `../receipt-ocr/client/src/routes/ProcessingPage.tsx:97-107`: the loading screen to mirror.
- `client/src/routes/HistoryPage.tsx:134, 155-160, 284-286`; `history/PayslipCards.tsx:39`;
  `history/PayslipTable.tsx:84`: status copy (D6).
- `client/src/session/MergeSuggestions.tsx:36` and `MergeDialog.tsx:150-205`: D11.
- `client/src/components/AppLayout.tsx:43-53` (D15) and `NavItems.tsx:1-11` (D2).
- `client/src/App.tsx:29`: the `history` route.
- `client/src/capture/downscale.ts`: D22.
- `client/src/history/useWideLayout.ts`: `LG`, `XL`, and the hook used for every layout choice.
- `client/src/i18n/statusCopy.test.ts`: add `["historyStatus", PAYSLIP_STATUSES]` to `GROUPS`.
- `client/src/i18n/i18n.test.ts`: key parity and CLDR plural categories. hr needs `_one`, `_few`
  and `_other`.
- `.claude/commands/validate.md` (git-ignored): Phase 9 journeys, to update in step 17.

### New Files to Create

- `client/src/capture/downscale.test.ts`: `downscaleTarget` cases.
- `.agents/history/14-ui-ux-iteration.md`: the completion record.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [MDN: Pinch zoom gestures with pointer events](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_events/Pinch_zoom_gestures)
  - The pointer-cache pattern for two-pointer distance. Why: D19.
- [MDN: `touch-action`](https://developer.mozilla.org/en-US/docs/Web/CSS/touch-action)
  - `pan-y` and `none`, and that `pan-y` disables browser pinch on the element. Why: D19.
- [MDN: viewport-percentage lengths (`svh`, `dvh`)](https://developer.mozilla.org/en-US/docs/Web/CSS/length#viewport-percentage_lengths)
  - Small against dynamic viewport. Why: D21.
- [MDN: `WheelEvent.ctrlKey`](https://developer.mozilla.org/en-US/docs/Web/API/MouseEvent/ctrlKey)
  and [MDN: `wheel` event](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event)
  - Trackpad pinch arrives as a Ctrl + wheel. Why: D17.
- [pdf.js `maxCanvasPixels`](https://github.com/mozilla/pdf.js/blob/master/web/app_options.js)
  - Default 2^25 (33,554,432). Why: the D18 desktop budget.
- [WebKit canvas area limit](https://developer.apple.com/documentation/webkitjs/canvasrenderingcontext2d)
  - 16,777,216 px per canvas on iOS. Why: the D18 phone budget. If the link has moved, the value is
    also stated in pdf.js issues on iOS canvas limits. Record in history/14 which source was read.
- [WAI-ARIA APG: Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)
  - Manual activation, and `aria-disabled` tabs staying focusable. Why: D10.

### Patterns to Follow

**Choose layout in JSX, not CSS order** (Task 09, `useWideLayout.ts:15-19`):

```tsx
const wide = useWideLayout(); // LG
// ...
{wide ? (<>{tray}{uploadButton}{pickers}</>) : (<>{pickers}{notices}{tray}{uploadButton}</>)}
```

**Non-passive native listener** for gestures React cannot `preventDefault`
(`ZoomableSourceViewport.tsx:160-182`). A pinch uses pointer events, which React handles, but the
wheel stays native.

**Busy controls keep focus**: `aria-disabled`, never `disabled`, for actions (`HomePage.tsx:333-337`).
Chips follow the same rule (D10).

**Pure maths with tests beside it** (`sourceZoom.ts` and `sourceZoom.test.ts`, `pdfRender.ts` and
`pdfRender.test.ts`). D17's content-size clamp, D18's target width, D19's pinch and D22's target are
all pure functions, tested first (`/tdd` at these seams).

**Copy** is always an `en` + `hr` pair. Plural keys use the CLDR categories (`en`: one, other; `hr`:
one, few, other), as in `session.confirmedCount_*`.

**Comments** explain *why*, in full sentences, and cite the task and decision (`D17`), as the
existing files do. Keep the existing comments that still hold; rewrite the ones this task
falsifies:
- the `65dvh` comment at `ZoomableSourceViewport.tsx:230-235`;
- the `RENDER_QUALITY` comment in `pdfRender.ts`;
- the "sticky action bar" comment in `PayslipForm.tsx`;
- the xl comments in `SessionPage.tsx` and `useWideLayout.ts`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation ($0, no UI change visible yet)

Copy (D2–D11, D14, D16), the status guard, and the pure functions for D17, D18, D19 and D22, each
test-first.

### Phase 2: Shell, home and list

Route, nav, sticky sidebar, app name, home layout, list copy.

### Phase 3: Review page

Loading screen, selection, chips, rail, heading, back link, 1:1 grid, action block, merge copy.

### Phase 4: Viewer

Content-size model and fit width, pinch, settled-zoom redraw, page-change mount, `svh`.

### Phase 5: Probe, docs, validation

The $0 downscale probe, PRD, ROADMAP, `validate.md`, history/14. Stop before review.

---

## STEP-BY-STEP TASKS

IMPORTANT: Execute every task in order, top to bottom. Each task is atomic and independently
testable.

### 1. VERIFY the starting state

- `git status --short`: clean except this plan. The last commit is `fbdcf4e` or later.
- `npm run validate`. Record the file and test counts (history/13 ended at 72 files / 1091 tests).
  If a test fails, rerun it alone and in two more full runs before blaming this task.
- **VALIDATE**: `npm run validate`

### 2. UPDATE the locales (D2–D7, D11, D14, D16)

- **IMPLEMENT**: in both `en.json` and `hr.json`:
  - `common.appName` (en only, D3); `common.navHistory` → Payslips / Platne liste;
  - `home.*` and `capture.*` per D4, removing `home.subtitle` and `capture.scanAnother`;
  - every D5 row;
  - `history.title`, `history.deleteBody` and the new `historyStatus` group (D6);
  - `session.title` → `session.title_one/_other` (en) and `_one/_few/_other` (hr) (D7);
  - `review.backToPayslips` (D7);
  - `session.preparingTitle` and `session.preparingDescription` (D8);
  - `merge.suggestion` and `merge.swapped` with their new parameters (D11); remove
    `session.position` (D11);
  - `session.scanMore` (D14); remove `review.inspectPrompt` (D16).
- **UPDATE** `client/src/i18n/statusCopy.test.ts`: add `["historyStatus", PAYSLIP_STATUSES]` to
  `GROUPS`.
- **GOTCHA**: removing keys before their call sites are changed breaks nothing at type level
  (`t()` takes strings). The component tests in later steps catch stale keys, so run the full suite
  at step 15, not only here.
- **VALIDATE**: `npx vitest run client/src/i18n`

### 3. TDD `downscaleTarget` (D22)

- **CREATE** `client/src/capture/downscale.test.ts` first, with these cases:
  - 1220×2712 at 531 KB → `null`, kept;
  - 3024×4032 at 3.5 MB → `{ width: 2250, height: 3000 }`;
  - 3000×2000 at 1 MB → `null`;
  - 2000×1500 at 5 MB → `{ width: 2000, height: 1500 }`, re-encoded at its own size;
  - 4000×100 → long edge 3000, height rounded, never below 1.
- **UPDATE** `downscale.ts`:
  - `DOWNSCALE_LONG_EDGE = 3_000` and `DOWNSCALE_MAX_BYTES = 4 * 1024 * 1024`;
  - remove `DOWNSCALE_MAX_PIXELS` if nothing else imports it (grep);
  - export `downscaleTarget`, and use it in `downscaleSourceImage`;
  - update the module's comments.
- **GOTCHA**: `sourceFile.ts` or its test may import the old constants. Grep for `DOWNSCALE_`
  across `client/src`.
- **VALIDATE**: `npx vitest run client/src/capture`

### 4. TDD the zoom model (D17, D19) in `sourceZoom.ts`

- **IMPLEMENT**, tests first in `sourceZoom.test.ts`:
  - The functions take the frame (`viewport`) and a `content: Viewport` (zoom-1 content size);
    `content` defaults to `viewport`, so every existing call and test keeps its meaning.
  - `minZoomFor(viewport, content)` = `min(1, viewport.height / content.height, viewport.width / content.width)`.
  - `clampPan(state, viewport, content)`: per axis, if `content × zoom ≤ frame` then **centre**,
    otherwise clamp to cover. The zoom is clamped to `[minZoomFor, MAX_ZOOM]`.
  - `zoomAbout`, `centreOn` and `isRegionVisible` measure region fractions against `content`.
  - `panBy(state, viewport, content, dx, dy)` returns the clamped state (for the D17 wheel), and
    the caller compares it to the old state to decide `preventDefault`.
  - `pinchZoom(start, viewport, content, startDistance, distance, midpoint)` =
    `zoomAbout(start, …, start.zoom × distance / startDistance, midpoint)`.
- **KEEP** every existing test passing unchanged; that is the proof `fit="page"` is untouched.
- **Add tests**:
  - fit width, where content 600×849 in a frame 600×500 allows `y` from 0 to −349 at zoom 1;
  - the minimum zoom shows the whole page, centred horizontally;
  - `centreOn` a region at `y = 0.9` scrolls down at zoom 1;
  - `pinchZoom` doubling the distance doubles the zoom and holds the midpoint still;
  - `panBy` at the bottom edge returns an equal state.
- **VALIDATE**: `npx vitest run client/src/review/sourceZoom.test.ts`

### 5. TDD the render target (D18) in `pdfRender.ts`

- **IMPLEMENT**, tests first:
  - `renderScale(pageWidth, pageHeight, cssWidth, dpr, zoom = 1, budget = DESKTOP_BUDGET)`, where
    the target width is `cssWidth × dpr × max(zoom, RENDER_QUALITY)`, reduced so that
    `width × width × pageHeight / pageWidth ≤ budget`, divided by `pageWidth`;
  - export `PHONE_PIXEL_BUDGET = 16_777_216` and `DESKTOP_PIXEL_BUDGET = 33_554_432`;
  - remove `MAX_CANVAS_WIDTH`;
  - `needsRedraw(currentWidth, targetWidth)` = the difference is over 1%.
- **Tests**:
  - zoom 1 equals today's scale when under budget;
  - zoom 5 at 800 px, dpr 1, on A4 → 4,000 px wide (about 22.6 MP, under the desktop budget);
  - zoom 8 is capped by the budget, and the area is ≤ budget;
  - the phone budget caps sooner;
  - 0-width inputs return 0, as today;
  - `needsRedraw` within 1% is false.
- **UPDATE** the existing `pdfRender.test.ts` cases for the new signature. The
  `MAX_CANVAS_WIDTH` case becomes a budget case.
- **VALIDATE**: `npx vitest run client/src/review/pdfRender.test.ts`

### 6. UPDATE the route, navigation, shell and title (D2, D3, D15)

- `App.tsx`: `path="payslips"` instead of `history`.
- `NavItems.tsx`: `{ to: "/payslips", labelKey: "common.navHistory", Icon: FileText }`, importing
  `FileText` in place of `History`.
- `AppLayout.tsx`: the D15 classes on the desktop `<nav>`.
- `client/index.html`: `<title>Payslip Scanner</title>`.
- **UPDATE** `AppLayout.test.tsx`, `HistoryPage.test.tsx` and any test using `/history` (grep
  `client/src` for `"/history"` and `'history'`).
- **VALIDATE**: `npx vitest run client/src/components client/src/routes/HistoryPage.test.tsx`

### 7. UPDATE the home page (D4)

- `HomePage.tsx`:
  - the D4 grid;
  - `useWideLayout()` for the left column's order;
  - the steps column with the numbered markers from receipt-ocr (`bg-accent-soft text-accent`;
    check that both tokens exist in `client/src/index.css`, and use the nearest existing ones if not);
  - `step1` or `step1NoCamera` by `cameraCapture`;
  - `capture.scan` always for the camera label;
  - `secondaryPicker` for the file picker when `wide && count > 0`;
  - remove `home.subtitle`'s paragraph.
- **UPDATE** `HomePage.test.tsx`:
  - the heading;
  - the plural/formal copy;
  - the camera label after a photo ("Scan payslip", not "Scan another");
  - the steps;
  - with `matchMedia` mocked wide, the pickers come **after** the Upload button in DOM order;
  - without it, before.
- **VALIDATE**: `npx vitest run client/src/routes/HomePage.test.tsx`

### 8. UPDATE the list page (D6)

- `HistoryPage.tsx:158`, `PayslipCards.tsx:39` and `PayslipTable.tsx:84`: `historyStatus.*` instead
  of `payslipStatus.*`.
- **UPDATE** `HistoryPage.test.tsx`: the title, the filter options, the status text and the
  delete body.
- **VALIDATE**: `npx vitest run client/src/routes/HistoryPage.test.tsx client/src/history`

### 9. UPDATE the rail (D10)

- `PayslipRail.tsx`:
  - horizontal only;
  - the file name, unsaved mark and status;
  - `aria-disabled={payslip.status === "processing"}`;
  - `onClick` and `onKeyDown` activation (Enter/Space) ignore a disabled chip, while arrow, Home
    and End movement still reach it;
  - `aria-disabled:opacity-60`;
  - `lg:w-60`.
- **UPDATE** `PayslipRail.test.tsx`:
  - no position number and no period;
  - the file name shown;
  - a processing chip is `aria-disabled`, focusable by arrow, and clicking it does not call
    `onSelect`;
  - a failed chip calls `onSelect`;
  - the vertical-orientation tests removed.
- **VALIDATE**: `npx vitest run client/src/review/PayslipRail.test.tsx`

### 10. UPDATE the session page (D7–D12, D14)

- `SessionPage.tsx`:
  - the D8 loading state (a helper `isOpenable(payslip)` for `review`, `confirmed` and `failed`);
  - the D9 selection effect, replacing `:241-244`;
  - the back link and plural heading (D7);
  - the panel heading as the file name (D11);
  - the rail without `orientation` and without the `xl` grid, so the rail sits above the panel;
  - `lg:max-w-none` (D12);
  - remove `Row`'s position line and `position` prop;
  - remove the foot link (D14);
  - remove the `useWideLayout`, `XL` and `ReactNode` imports if they become unused.
- **UPDATE** `SessionPage.test.tsx`:
  - the loading screen shows while all payslips are processing, and while the only item is
    uploading;
  - it hands over to the first `review` payslip, selected without `?payslip=`;
  - with one `failed` and one `processing`, the page shows the failed one;
  - with all failed, the page shows at once;
  - an explicit `?payslip=` for a processing payslip shows the processing panel;
  - the back link's `href` is `/payslips`;
  - heading singular and plural in both languages;
  - no "Scan more" link unless not found.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx`

### 11. UPDATE the merge copy (D11)

- `MergeSuggestions.tsx`: `shortName` (≤ 40 characters, extension kept; export it for the test),
  and `merge.suggestion` with file names looked up from `payslips`. `position()` is still used by
  the stale-pair filter, so keep it.
- `MergeDialog.tsx`: drop both `session.position` lines; `merge.swapped` gets
  `{ name: ordered[0].originalFilename }`.
- **UPDATE** `MergeSuggestions.test.tsx` and `MergeDialog.test.tsx`.
- **VALIDATE**: `npx vitest run client/src/session`

### 12. UPDATE the review grid and action block (D12, D13)

- `PayslipReview.tsx:98`: `lg:grid-cols-2`. Set `--source-height` on the aside:
  `[--source-height:65svh] lg:[--source-height:calc(100dvh-15rem)]`.
- `PayslipForm.tsx:228-275`: the D13 block.
- **UPDATE** `PayslipForm.test.tsx` or `PayslipReview.test.tsx` if either asserts the sticky class or
  `data-hide-with-keyboard` on the form. Check `useSoftKeyboard.test.ts` for a count of hidden
  elements.
- **VALIDATE**: `npx vitest run client/src/review/PayslipForm.test.tsx client/src/review/PayslipReview.test.tsx client/src/review/useSoftKeyboard.test.ts`

### 13. UPDATE the viewer (D16, D17, D19, D21)

- `ZoomableSourceViewport.tsx`:
  - a `fit: "page" | "width"` prop;
  - the frame:
    - `page`: today's ratio box with `var(--source-height,65svh)` in place of `65dvh` (D21);
    - `width`: `width: 100%; height: var(--source-height)`;
  - `content` measured from the frame and `fit` (page: the frame; width: `frame.width × frame.width / ratio`);
  - the transformed layer sized to `content` explicitly;
  - `children(content)`;
  - every `sourceZoom` call passing `content`;
  - `minZoom` from `minZoomFor`, and the zoom-out button disabled at it;
  - reset returns to `FIT`;
  - the auto-pan effect runs at any zoom when the region is not visible (D17);
  - the wheel: `width` mode pans via `panBy` unless `ctrlKey`, and `preventDefault` only when the
    state moved; `page` mode is unchanged;
  - pinch (D19): a `Map<pointerId, {x, y}>` cache in a ref;
    - on the second `pointerdown`, record the start state, distance and midpoint, and cancel any
      single-pointer drag;
    - on `pointermove` with two pointers, `setView(pinchZoom(...))`;
    - on `pointerup` or `cancel`, remove the pointer, and set `suppressClick` if a pinch happened;
  - `touch-action` per D19. Overflow means `content × zoom` exceeds the frame in either axis, which
    at fit width is true at zoom 1 whenever the page is taller than the frame, so vertical page
    swipes over the document pan the document then. That is intended: the document frame is its own
    scroller at `lg`, and the phone uses `fit="page"`;
  - `popoverTop` against `content`;
  - delete the D16 hint.
  - Expose the **settled zoom** to `children` as a second argument: `useState` updated by a 200 ms
    timeout after `view.zoom` changes (clear it on unmount).
- `PdfSource.tsx` and `SourceDocumentPanel.tsx` (`ImageSource`): pass `fit={wide ? "width" : "page"}`
  (`useWideLayout()` is already in `PdfSource`; add it to `ImageSource`).
- **GOTCHA**: `setPointerCapture` is deferred to the first real move (`:242-247`). Keep that. A
  pinch must not capture either finger, or the outline click logic breaks.
- **GOTCHA**: `touch-none` is applied only when zoomed today because a phone page must scroll at
  fit. In `page` mode with `pan-y` at fit, a one-finger swipe still scrolls, and two fingers now
  reach the pointer handlers.
- **UPDATE** `ZoomableSourceViewport.test.tsx`:
  - no hint text;
  - `fit="width"` sizes the layer to content (check the inline style);
  - plain wheel in width mode changes `y`, not zoom;
  - Ctrl + wheel zooms;
  - two synthetic pointers moving apart increase the zoom label, and no region click fires after;
  - the zoom-out button disabled at the whole-page zoom.
- **VALIDATE**: `npx vitest run client/src/review/ZoomableSourceViewport.test.tsx client/src/review/SourceDocumentPanel.test.tsx`

### 14. UPDATE the PDF path (D18, D20)

- `PdfSource.tsx`:
  - **D20**: when `pageViewport !== null && pageViewport.page !== page`, render the full viewer
    with the previous `pageViewport` (ratio and width) and a centred `Spinner` overlay inside the
    frame, not the bare branch. Keep the first-load branch.
  - **D18**: `PdfCanvas` takes `zoom` (default 1) and `budget` (by
    `matchMedia("(pointer: coarse)")`, read once per mount);
    - compute `renderScale`;
    - skip when `!needsRedraw(element.width, targetWidth)`;
    - render into `document.createElement("canvas")`;
    - on completion set `element.width`/`height` and `getContext("2d").drawImage(offscreen, 0, 0)`;
    - cancel the task on cleanup.
  - The strip's `PdfCanvas` passes no zoom.
- **GOTCHA**: the `canvas.width = …` assignment in `pdfDocument.ts:88-89` runs on the off-screen
  canvas now, so the visible one never blanks.
- **GOTCHA**: the overlay's ratio guard (`RATIO_TOLERANCE`) compares page ratios, not bitmap
  sizes, so a redraw cannot trip it. Leave it alone.
- **UPDATE** the PdfSource tests if present (grep for `PdfCanvas`). Add a test with a mocked
  `LoadedPdf` whose `viewportOf(2)` never resolves: after Next, the viewer frame is still in the DOM
  (query by its zoom buttons) and a status spinner is shown.
- **VALIDATE**: `npx vitest run client/src/review`

### 15. RUN lint, format, typecheck and the full suite

- `npm run validate`. Fix every finding.
- **VALIDATE**: `npm run validate`

### 16. PROBE the downscale sizes ($0)

- With Python and Pillow on the scratchpad copies of `payslip_examples/A02.jpg` and `B02.jpg`:
  resize per `downscaleTarget`, save as JPEG at quality 82, and record the before and after
  dimensions and bytes, against the old 1,600 px rule. Pillow's encoder is a proxy for the
  browser's, so say so in history/14; the review session reads the real upload size from the
  network panel when it uploads.
- Estimate the upload time at 10 Mbit/s for the old and new sizes.
- **VALIDATE**: the table exists in history/14.

### 17. UPDATE the docs

- `PRD.md`:
  - §7.2: the 3,000 px rule, and the button names (Skenirajte / Odaberite datoteke);
  - §7.6: rail on top at every width; chips show the file name and status; unopenable chips
    `aria-disabled`; the loading screen; fit width on desktop; pinch;
  - §7.7: the action block at the end of the form instead of a sticky bar;
  - §7.10: the list title and route `/payslips`.
  - Keep "Payslip OCR" as the document title (D3).
- `.agents/ROADMAP.md`: under the §2 table, one line, "Task 14 — UI/UX iteration (first
  post-roadmap iteration): plan → `plans/14-ui-ux-iteration.md`, record → `history/14-ui-ux-iteration.md`;
  the Task 13 device sitting follows it." Add to §5's "Phone layout has no prior art" row that
  pinch and fit width changed in Task 14.
- `.claude/commands/validate.md` (git-ignored):
  - grep for `/history`, `History`, `Scan more`, `Payslip OCR`, `position`, `inspectPrompt`,
    `sticky`, `vertical list` and `xl`, and update the journeys that assert them (9.5, 9.9, 9.11,
    9.12);
  - add **9.13**, the Task 14 journey, ≤ 2 paid analyses (D23), covering:
    1. home at 375 px and 1440 px in `hr`: copy, steps, order of controls;
    2. upload two files: the loading screen, then the first payslip opens and the other chip is
       `aria-disabled` until it is read;
    3. review at 1366×768 and 1920×1080: rail on top, 1:1, the page width measured (record it
       against D12's estimate), the aside fully visible, the sidebar fixed while scrolling;
    4. A01.pdf at 500%: crisp after the settle, no blank frame; a photo at 300%;
    5. the D20 page jump reproduced on the committed code (`git stash` or the previous deploy) and
       gone after, at 375 px with touch emulation; `lg` checked;
    6. pinch via CDP `Input.dispatchTouchEvent` with two touch points: document zoom changes and
       the page does not;
    7. Ctrl + wheel zooms, and plain wheel scrolls the document then the page;
    8. back link, heading singular and plural, no "Scan more", non-sticky Save/Confirm, the delete
       dialog body, the list statuses in both languages;
    9. clean-up and the orphan query.
- **VALIDATE**: `git diff --check`

### 18. RUN the full local validation, WRITE the history file, STOP (D23)

- `npm run validate`, `npm run build`, `npm run check:secrets`, `npm run test:integration` ($0; the
  client-only change should not move it), `git grep -n "react-router-dom" client/src` (none),
  `git diff --check`.
- Write `.agents/history/14-ui-ux-iteration.md` in the history/13 shape:
  - what was built;
  - decisions and deviations;
  - the validation table with counts;
  - the step 16 probe;
  - the D5 full read of `hr.json`;
  - open items;
  - the review-session handoff: `/code-review` against the Task 13 docs commit, `/validate` with
    journey 9.13, the product owner's phone check after the deploy (D20 jump, D21 wobble, D19
    pinch and popover size, on the Android phone), then the Task 13 device sitting;
  - "Paid runs: 0, $0".
- Do **not** run `/code-review`, `/validate` or a browser journey. Do **not** commit. Stop and
  report.

---

## TESTING STRATEGY

### Unit Tests

- **Pure, test-first**:
  - `downscaleTarget` (step 3);
  - `sourceZoom` content-size, centring, `panBy` and `pinchZoom` (step 4);
  - `renderScale` with budget and zoom, `needsRedraw` (step 5).
- **Components**:
  - `HomePage` (order by width, copy);
  - `HistoryPage` (statuses, title, delete body);
  - `PayslipRail` (content, `aria-disabled`, keyboard);
  - `SessionPage` (loading, selection, heading, back link);
  - `MergeSuggestions` and `MergeDialog` (file names, `shortName`);
  - `ZoomableSourceViewport` (fit width, wheel, Ctrl + wheel, pinch, no hint);
  - `PdfSource` (viewer stays mounted on page change);
  - `AppLayout` (route).
- **Guards**: `i18n.test.ts` (parity, plurals), `statusCopy.test.ts` with `historyStatus`.

### Integration Tests

`npm run test:integration` against hosted Supabase ($0). No API change, so it is a regression
check only.

### Edge Cases

- A session whose only upload is still sending (no server row): loading screen, not an empty page.
- Every upload rejected: the normal page with the rejected rows, no spinner forever.
- One payslip `failed`, one `processing`: the page opens on the failed one (D8).
- Retry on the selected payslip: its chip becomes `aria-disabled` and stays selected; the panel shows
  the processing text.
- The merged placeholder is `processing` and selected by `?payslip=`: the processing panel.
- A single-page image at fit width that is wider than tall (A02-exif6, 1956×880): the content is
  shorter than the frame, so it is centred vertically and there is nothing to pan.
- A page shorter than the frame at zoom 1: the minimum zoom is 1, and zoom-out is disabled.
- A focused field at the bottom of a fit-width page: the frame scrolls to it at zoom 1.
- Wheel at the bottom edge of the document: the page scrolls.
- Pinch that starts on the document and ends outside it: the pointers are cancelled and the state
  clamped.
- A phone in landscape: `65svh × ratio` is narrow. That is the unchanged `fit="page"` behaviour.
- PDF redraw requested while a previous one renders: the older task is cancelled, and the newer
  result wins.
- HEIC outside Safari (file card): `downscaleTarget` is never reached, since decode fails and the
  original uploads (Task 07 D10).
- A file name of 200 characters in the merge banner: shortened with the extension kept.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style
`npm run validate` (typecheck → oxlint → Prettier check → Vitest)

### Level 2: Unit Tests
`npx vitest run client/src`

### Level 3: Integration Tests
`npm run test:integration` (hosted Supabase, $0)

### Level 4: Manual Validation
The step 16 probe. Journey 9.13 and the phone check are the **review session's** (D23).

### Level 5: Additional Validation
`npm run build`; `npm run check:secrets`; `git diff --check`;
`git grep -n "react-router-dom" client/src` returns nothing;
`git grep -n "review.inspectPrompt\|session.position\|capture.scanAnother\|home.subtitle" client/src`
returns nothing.

---

## ACCEPTANCE CRITERIA

- [ ] Every D2–D7, D11 and D14 string is in place in both languages. No Croatian string uses the
      informal imperative, and the full read is recorded.
- [ ] `/payslips` is the list route, labelled Payslips / Platne liste with `FileText`; the desktop
      sidebar stays in place while content scrolls.
- [ ] Home: two columns at `lg` with the pickers after Upload in DOM order; the phone order is
      unchanged.
- [ ] The list title, statuses and delete body match D6. The rail keeps `payslipStatus`.
- [ ] The session page shows the loading screen per D8 and selects per D9. Processing chips are
      `aria-disabled` and do not open. Chips show the file name and status only. The rail is
      horizontal at every width.
- [ ] Back link, plural heading, no foot "Scan more", Save/Confirm in flow.
- [ ] The merge banner, dialog and swap message use file names.
- [ ] At `lg` the document fits its column's width in a screen-height frame; wheel pans, Ctrl +
      wheel zooms, reset returns to page width, zoom-out reaches the whole page.
- [ ] Pinch zooms the document only. A PDF is redrawn at the settled zoom within the pixel budget
      without blanking. The viewer stays mounted across a page change. The phone budget uses `svh`.
- [ ] Photos resize only above a 3,000 px long edge, and the probe is recorded.
- [ ] `npm run validate`, `npm run build`, `npm run check:secrets` and `npm run test:integration`
      pass.
- [ ] PRD, ROADMAP and `validate.md` are updated; history/14 is written; nothing is committed; $0.

---

## COMPLETION CHECKLIST

- [ ] All tasks completed in order
- [ ] Each task's validation passed immediately
- [ ] Full test suite passes (unit + integration)
- [ ] No lint, format or type errors
- [ ] Step 16 probe recorded
- [ ] Acceptance criteria met, or each gap stated in history/14
- [ ] Stopped before review, `/validate`, browser journeys and commit (D23)

---

## NOTES

- **Why fit width only on desktop (Q27).** On a laptop the page is height-bound, so moving the rail
  and splitting 1:1 would have gained 6–13%. Fit width is what Adobe Reader, Chrome's PDF viewer and
  Google Drive default to beside a form. The phone keeps whole-page at 100%, which the product
  owner likes.
- **Why D17 extends `sourceZoom` rather than adding a second viewer.** The viewport's comment
  (`:59-66`) records why there is one shell: deferred capture, the non-passive wheel and click
  suppression were each found in a browser. A content size defaulting to the viewport keeps every
  existing test meaningful as the proof that `fit="page"` is unchanged.
- **Why the popover needs no code (Q23 → Q25).** It was never inside the zoom layer; the browser's
  page zoom magnified it. In-app pinch removes the cause.
- **Why `failed` ends the loading screen (D8).** "Processed" in the product owner's words; a failure
  is actionable and must not wait behind a sibling.
- **Superseded:** Task 10 D4 (vertical list at `xl`, 3:2 split) and Task 09 D14 (sticky action bar).
  Record both in history/14. The ROADMAP's Task 09/10 blocks stay as the historical record.
- **Deliberately not built:**
  - a redirect from `/history`;
  - key and component renames;
  - an automated informal-Croatian guard;
  - tile rendering (a full-page redraw within budget is pdf.js's own approach);
  - pinch on the keyboard strip;
  - changes to receipt-ocr, which shares the scrolling-sidebar bug.
- **Confidence: 6/10** for one-pass success. The copy, routing, home, list, rail and session work
  is mechanical. The risk concentrates in steps 13–14:
  - the content-size refactor touches maths every outline depends on;
  - pinch through pointer events with `touch-action: pan-y` behaves differently across mobile
    browsers;
  - D20 and D21 fix causes inferred from code, which only the review session and the product
    owner's phone can confirm. If either cause turns out wrong, the history file must say so
    rather than claim a fix.
