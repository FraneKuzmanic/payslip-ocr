# Feature: Task 15 — Review-flow iteration

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md`](../ROADMAP.md): the second iteration after the 13-task roadmap,
from the product owner's own testing (2026-09-28 grilling session, questions Q1–Q19). Locked
decisions 4 (merge is a non-dragging action; a visible button satisfies it as a menu did) and 9 (two
navigation controls) still hold · **PRD:** §7.6, §7.7, §7.8, §7.10, §11.5 · **Previous tasks:**
[`history/07`](../history/07-capture-multi-upload.md) (upload batch),
[`history/09`](../history/09-review-form-two-way-linking.md) (form, edited fields),
[`history/10`](../history/10-session-navigation-phone-layout.md) (rail, `+N`, strip),
[`history/11`](../history/11-merge-payslips.md) (merge),
[`history/12`](../history/12-export-history.md) (history links),
[`history/14`](../history/14-ui-ux-iteration.md) (wheel D17, loading screen, sidebar) ·
**Reference implementation:** `../receipt-ocr/client/src/review/ItemRows.tsx:114-118` (the text
"Add item" action) · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) (Upload batch, Session, Edited
field, Unsaved edits) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md).

## Feature Description

Fifteen issues from the product owner's testing of the review flow, on desktop and an Android
phone, settled in one grilling session:

- **Two bugs**: after a merge, the two originals reappear below the form as "Processing" forever;
  after a delete, the header counts a payslip that no longer exists ("8 of 9 ready for review").
- **Navigation**: a collapsible desktop sidebar; no `+N` badge on the rail; a payslip opened from
  the Payslips list shows only that payslip (no rail, no merge), while the upload view keeps the
  rail and merge.
- **Merge**: a visible Merge button instead of an item hidden in `⋮`; no warning paragraph in the
  dialog.
- **Document viewer**: a plain mouse wheel zooms again; outlines no longer cover the text.
- **Form**: collapsible sections with the line-item tables collapsed by default; an "Edited" badge
  and one "Discard changes" action; a text "+ Add row" action; stacked full-width Save and Confirm
  on the phone; a lighter "Show document" disclosure.

## User Story

As someone reviewing scanned payslips on a laptop or a phone
I want a shorter form, obvious merge and undo actions, a document I can zoom with the wheel and read
under its outlines, and counts that match what exists
So that checking a payslip is quick and nothing on screen misleads me.

## Problem Statement

Causes established in planning (file references are to the code at `dab77c2`):

1. **Phantom "Processing" rows and a wrong total (issues 8, 10).** The rows under the form are the
   tab's upload batch, not server data (`SessionPage.tsx:464-497`). An `uploaded` item is hidden
   only while its payslip is in the latest session read (`SessionPage.tsx:265-269`). After a merge
   soft-deletes the originals, or a delete from the Payslips list, the payslip leaves the read for
   good, so the item reappears with the `payslipStatus.processing` text and a spinner
   (`SessionPage.tsx:481`, `:545-546`). Nothing removes it: the batch lives in a layout route above
   every signed-in page (`App.tsx:24-29`) and only `dismiss` shrinks it, offered for rejected items
   only (`:484`). The header's `total` adds these items (`:341`), hence "8 of 9". **No extraction is
   running**: merge requires both originals settled (`shared/src/session.ts:86-89`,
   `api/src/routes/sessions.ts:138-144`), the queue drops writes to deleted rows
   (`api/src/services/payslip-extraction.ts:90-93`), and polling stops once server rows settle
   (`SessionPage.tsx:126`). It is a render artifact that a reload clears.
2. **The rail follows a History link (issue 9).** Every History link is
   `/sessions/:sid?payslip=:id` (`history/historyRow.ts:33-35`). `?payslip=` only selects; the rail
   always shows every live payslip of the session (`SessionPage.tsx:393`).
3. **Merge is hidden (issue 4).** It is the first item of the `⋮` `ActionMenu`
   (`SessionPage.tsx:308-321`, `:411-418`).
4. **The merge dialog carries a paragraph (issue 7):** `merge.consequence`
   (`MergeDialog.tsx:178`).
5. **The wheel pans (issue 3).** Task 14 D17 made a plain wheel scroll the fit-width document and
   Ctrl + wheel zoom (`ZoomableSourceViewport.tsx:231-254`). Before Task 14, and in receipt-ocr, a
   plain wheel zoomed about the cursor. The phone (`fit="page"`) still zooms (`:225-230`).
6. **Outlines cover text (issue 13).** `SourceOverlay.tsx:40-51` strokes each region at 1.25 CSS px
   at rest and 2.5 px active, with `vector-effect: non-scaling-stroke`, **centred on the quad
   edge**, and the service's quads hug the glyphs. At a phone's fit width an A4 text line is about
   5–6 CSS px tall, so the stroke sits on the letters. The product owner saw it on **unselected**
   outlines. Stroke opacity stays 1: `SourceOverlay.test.tsx:61` guards the 3:1 contrast
   (WCAG 1.4.11).
7. **The form is long (issues 5, 14).** Seven sections always open (`PayslipForm.tsx:208-266`); the
   three tables can hold many rows, and on `lg` the text column is a wrapping textarea
   (`LineItemSection.tsx:137-155`).
8. **No way to undo (issue 6).** Nothing resets the form. Saved edits are shown only as dashed
   outlines on the document (`editedFields`, `shared/src/api.ts:143-149`); the form shows no edited
   state. The chip pencil means unsaved changes (`PayslipRail.tsx:110-117`).
9. **Heavy controls on the phone (issues 11, 12, 15).** "Show document" is an outlined button
   (`PayslipReview.tsx:134-145`); Save and Confirm sit side by side in a wrapping row
   (`PayslipForm.tsx:231-275`); "Add row" is an outlined button (`LineItemSection.tsx:171-180`).
10. **The sidebar is fixed at 240 px (issue 1)** (`AppLayout.tsx:45-53`). The `+N` badge (issue 2)
    is `overflowAfter` plus an IntersectionObserver in `PayslipRail.tsx:26-50`, `:123-130`.

## Solution Statement

Client only. **No API, shared, migration or dependency change; $0 to implement.**

- The upload batch marks an item **listed** the first time its payslip appears in a session read;
  a listed item is never rendered or counted again.
- History links carry `&view=single`; the session page then shows only that payslip.
- A shared `DisclosureButton` (chevron and text) drives both the section headers and "Show
  document". Section open state lives in `sessionStorage` for the tab.
- The badge and "Discard changes" sit above the review grid; discard is a native `type="reset"`
  button targeting the form by id, and the form's `onReset` calls react-hook-form's `reset`.
- The wheel handler's fit-width branch zooms proportionally; `panBy` loses its only caller and goes.
- Outlines are padded outward by a constant screen gap and thinned.

## Feature Metadata

**Feature Type**: Enhancement + Bug Fix
**Estimated Complexity**: Medium (many small, independent client changes; no server work)
**Primary Systems Affected**: `client/src/routes/SessionPage.tsx`, `client/src/upload/`,
`client/src/review/` (form, sections, viewer, overlay, rail), `client/src/components/AppLayout.tsx`,
`client/src/history/historyRow.ts`, `session/MergeDialog.tsx`, locales
**Dependencies**: none new. `react-hook-form` 7.85.0, `lucide-react` ^1.32, React 19
(`flushSync` from `react-dom`)

---

## DESIGN DECISIONS

Each is the product owner's answer in the grilling session unless marked "planner".

### D1 — One task, the standing session split (PO, Q1)

All fifteen issues are Task 15. The implementing session does **not** run `/code-review`,
`/validate` or any browser journey and does not commit; it runs the ordinary checks (tests,
typecheck, lint, format, build, `check:secrets`, `test:integration`) and writes history/15, then
stops. **Paid runs in this session: none.**

### D2 — The batch hands an item over once listed (PO, Q8; fixes issues 8 and 10)

- `BatchItem` gains `listed?: true`. The provider gains
  `markListed(sessionId: string, payslipIds: ReadonlySet<string>): void`, which sets `listed` on
  every `uploaded` item whose `payslipId` is in the set, and **returns the previous map unchanged
  when nothing changed** (no re-render loop).
- `SessionPage` calls it in an effect whenever `detail` changes, with the ids of `detail.payslips`.
- `pending` excludes listed items. Everything built on `pending` (`inFlight`, `total`, the rows)
  is then correct by construction.
- A flag, not removal: `uploadedCount` (`SessionPage.tsx:109`), which restarts the poll when an
  upload lands, must not drop when an item is handed over, or every hand-over would restart the
  poll once more.
- Not added (PO): a delete on the session page.

### D3 — The single-payslip view (PO, Q9, Q10, Q16, Q17)

- `rowRoute` becomes `/sessions/:sid?payslip=:id&view=single`. It survives reload and Back.
- `single = searchParams.get("view") === "single"`. In the single view:
  - no rail, no merge suggestions, no Merge button, no batch rows;
  - the header is the back link, then a row with the file name as `h1` and the `⋮` menu (downloads
    once confirmed), then that payslip's status as `historyStatus.*` (the list's words: "Needs
    review", "Confirmed"…) in the `role="status"` line;
  - the panel is a plain `div` (no `role="tabpanel"`: there is no tab);
  - the D9 default-selection effect (`SessionPage.tsx:258-262`) does not run, so the URL is never
    rewritten out of the single view;
  - a `?payslip=` that is not in the session (deleted, merged away) shows
    `session.payslipNotFound` with a link back to `/payslips`.
- The upload view (`/sessions/:sid`, with or without `?payslip=`) is unchanged: rail, suggestions,
  Merge. No link from the single view to the upload view (PO rejected "Open whole upload").
- Merge is offered in the upload view only; nothing is added to the Payslips list (PO, Q16).

### D4 — A visible Merge button (PO, Q4)

- An outlined secondary button with the `Combine` icon in the payslip heading row, shown when
  `canMerge(selected, payslips)` and not `single`. Label: `merge.mergeWith` ("Merge with another
  payslip…") at `lg`, `merge.mergeShort` ("Merge…" / "Spojite…") below it, by two spans with
  `lg:hidden` / `hidden lg:inline` so only one is in the accessible name.
- It opens the dialog's pick step exactly as the menu item did (`openMerge(null)`).
- The `⋮` menu keeps only the downloads. It renders only when it has items.

### D5 — No merge warning (PO, Q7)

Remove the `merge.consequence` paragraph and key. The confirm step keeps both documents and the
swap. PRD §7.8's "the dialog says in words…" is reworded.

### D6 — Collapsible sidebar (PO, Q2)

- At `lg` only (the phone has the bottom bar). Expanded: today's `w-60`. Collapsed: `w-18`
  (72 px), icons only.
- A toggle at the top of the sidebar: `ChevronsLeft` / `ChevronsRight`, a 48 px square,
  `aria-expanded`, `aria-controls` on the list, label `common.collapseMenu` /
  `common.expandMenu`.
- Collapsed links keep their accessible name through an `sr-only` label and show it as a native
  `title` tooltip. `NavItems` gains a `collapsed?: boolean` prop.
- Remembered in `localStorage` under `payslip-ocr:sidebar-collapsed` (`"1"`), read and written in
  try/catch; default expanded.

### D7 — No `+N` badge (PO, issue 2)

Remove the badge, the `visible` state, the IntersectionObserver and `rail` ref from
`PayslipRail.tsx`, `overflowAfter` from `stripGeometry.ts` (no other caller), and their tests. The
next chip still peeks (the chip widths, unchanged).

### D8 — A plain wheel zooms (PO, Q3)

- Fit width (`lg`): every wheel event is consumed and zooms about the cursor, proportionally to
  its delta and capped at one `ZOOM_STEP` per event, which is today's Ctrl branch
  (`ZoomableSourceViewport.tsx:235-243`) without the `ctrlKey` condition. Zoom-out stops at
  `minZoomFor` (the whole page). The page never scrolls from a wheel over the preview.
- Panning is drag, which already works whenever the page overflows its frame (`overflows`,
  `:327-330`), including zoom 1 at fit width.
- The phone's `fit="page"` branch is unchanged.
- `panBy` (`sourceZoom.ts`) loses its only caller: remove it and its tests.
- A trackpad's two-finger scroll over the preview now zooms. Accepted (PO).

### D9 — Collapsible form sections (PO, Q5; issues 5, 14)

- All seven sections become disclosures. Scalar sections (employer, employee, period,
  reconciliation) start **open**; the three tables start **closed**.
- The header is the section's legend: a `DisclosureButton` holding the colour dot, the label and a
  summary:
  - tables: the row count (`review.rowCount`), or `tablesStatus.pending` while pending;
  - every section: an amber `TriangleAlert` and `review.toCheck` ("2 to check") when anything
    inside carries an attention signal. The count is the section's paths whose `attentionFor` is
    non-null, plus, for a table, its `sectionWarnings`.
- A closed section's body stays **mounted** with the `hidden` attribute, so react-hook-form keeps
  its registrations and ids exist for region linking.
- Auto-open (planner, from Q5's "when the form moves focus into it"):
  - a region click, or the popover's Edit, opens the field's section **before** focusing
    (`flushSync`), since a hidden input cannot take focus;
  - a failed save opens every section holding an error inside react-hook-form's `onInvalid`, which
    runs before its own `_focusError` (`node_modules/react-hook-form/dist/index.esm.mjs:3164-3168`),
    so the first error is focused as today.
- State per section for the tab, in `sessionStorage` under `payslip-ocr:open-sections`, so
  switching payslips and leaving the page keep the layout. try/catch; defaults on failure.
- Long descriptions keep wrapping (PO): collapsing removes most of the length without hiding data.

### D10 — One disclosure pattern (PO, Q11)

`client/src/components/DisclosureButton.tsx`: a borderless `button` with a `ChevronDown` that
points right while closed (`-rotate-90`), `aria-expanded`, `aria-controls`, `min-h-12`. Used by the
D9 headers and by "Show document" / "Hide document" (`PayslipReview.tsx:134-145`), which keeps its
`lg:hidden` and keyboard-strip rules. Not receipt-ocr's native `<details>`: this panel must open in
keyboard-strip mode and stay mounted at `lg`, which a `<details>` cannot express.

### D11 — "Edited" and "Discard changes" (PO, Q15, Q18, Q19)

- One row directly above the review grid, under the payslip heading (planner: the heading row is
  owned by `SessionPage`, which has neither the form's dirty state nor `editedFields`; this row is
  the same place on screen and needs no plumbing):
  - an "Edited" badge (`PencilLine` + `review.edited`) when the form is dirty **or**
    `detail.editedFields` is non-empty;
  - "Discard changes" (`review.discard`), an underlined text button, **only while the form is
    dirty**. It returns the form to the last save, without a prompt.
- Discard is `<button type="reset" form="review-form">`; the form gets `id="review-form"` and
  `onReset={(event) => { event.preventDefault(); reset(values); }}`. `reset(values)` is how save
  already clears dirtiness (`PayslipForm.tsx:170`), and it restores field-array length. It then
  reports clean through `onDirtyChange`, so the chip pencil goes too.
- **Not built (PO):** restoring the extracted values, per-field markers or actions, any API change.
  Saved edits keep their dashed outlines.

### D12 — Save and Confirm on the phone (PO, Q12)

Below `lg`: a column, full width, Save above Confirm, `gap-3`; the confirmed badge also full width.
At `lg`: today's row. Classes only: `flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center
lg:gap-2` on the row and `w-full justify-center lg:w-auto` on each button.

### D13 — Outlines beside the text (PO, Q13)

- Pad every quad outward by `OUTLINE_GAP_PX = 1.5` **screen** pixels, so the stroke sits in the
  space around the glyphs. The overlay is inside the zoom transform, so the gap in page fractions
  is `1.5 / renderedWidth` horizontally and `1.5 / renderedHeight` vertically, where the rendered
  size is `content × zoom`. A pure `padCorners(corners, padX, padY)` moves each corner away from
  the quad's centroid on each axis (text quads are near axis-aligned; a rotated quad still grows).
- Stroke 1 px at rest, 2 px active; active fill 0.1 (was 1.25 / 2.5 / 0.15). Stroke opacity stays
  1 (the contrast test).
- Every width: desktop barely changes. `SourceStrip` passes its own rendered size.
- The review session judges it on the phone and may tune the constant.

### D14 — "+ Add row" as a text action (PO, Q14)

receipt-ocr's pattern at **all** widths: `min-h-12 self-start inline-flex items-center gap-1
font-semibold text-accent underline underline-offset-4 hover:text-accent-hover`, a `Plus` icon and
`review.addRow`. No border.

### D15 — Copy

New keys, `en` / `hr` (formal "vi" imperatives, Task 14 D5):

| Key | en | hr |
| --- | --- | --- |
| `common.collapseMenu` | Collapse menu | Sažmite izbornik |
| `common.expandMenu` | Expand menu | Proširite izbornik |
| `merge.mergeShort` | Merge… | Spojite… |
| `review.edited` | Edited | Izmijenjeno |
| `review.discard` | Discard changes | Odbacite promjene |
| `review.rowCount_one` / `_few` / `_other` | {{count}} row / — / {{count}} rows | {{count}} redak / {{count}} retka / {{count}} redaka |
| `review.toCheck_one` / `_few` / `_other` | {{count}} to check / — / {{count}} to check | {{count}} za provjeru (all three) |
| `session.payslipNotFound` | This payslip does not exist. | Ova platna lista ne postoji. |

`en` has only `_one` / `_other`, `hr` `_one` / `_few` / `_other` (`i18n.test.ts` checks the CLDR
categories). Removed: `merge.consequence`.

### D16 — Docs

PRD §7.6 (rail without `+N`; wheel; single view), §7.7 (sections, discard, add row, phone buttons),
§7.8 (Merge button, no consequence text), §7.10 (single view); ROADMAP §2 Task 15 line;
`.claude/commands/validate.md` journey 9.14 and the stale 9.9/9.10/9.13 assertions (`+N`, merge
menu, wheel pan). While editing §7.6, correct its stale phone pixel budget (`16,777,216` →
`9,560,000`, history/14 review finding 3).

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `client/src/upload/UploadBatchContext.ts` (all) — `BatchItem`, the context interface to extend.
- `client/src/upload/UploadBatchProvider.tsx` (lines 21-37 `updateItem`, 120-129 `dismiss`, 148-151
  the context value) — the patterns `markListed` mirrors; D2.
- `client/src/upload/UploadBatchProvider.test.tsx` — how the provider is rendered and asserted.
- `client/src/routes/SessionPage.tsx` (all, 554 lines) — D2, D3, D4. Key spots: 98-109 URL and
  batch, 111-147 poll, 213-251 merge, 253-262 default selection, 264-279 `pending`/`inFlight`,
  307-345 actions and counts, 354-367 header, 382-462 suggestions/rail/panel, 464-497 batch rows.
- `client/src/routes/SessionPage.test.tsx` (lines 60-110 mocks and `renderPage`; 216-252 batch
  rows; 379-420 counts; 650-815 merge and export menus) — tests to extend and rewrite.
- `client/src/history/historyRow.ts` (33-35) and `historyRow.test.ts` — D3 route.
- `client/src/history/PayslipTable.tsx` (62, 72), `PayslipCards.tsx` (28) — consumers of `rowRoute`
  (no change expected; confirm).
- `client/src/components/AppLayout.tsx` (all) and `AppLayout.test.tsx` — D6.
- `client/src/components/NavItems.tsx` (all) — D6.
- `client/src/components/ActionMenu.tsx` — unchanged, still used for downloads.
- `client/src/session/MergeDialog.tsx` (33-37 doc comment, 178) and `MergeDialog.test.tsx`
  (114-122) — D5.
- `client/src/review/PayslipRail.tsx` (all) and `PayslipRail.test.tsx` (103-133) — D7.
- `client/src/review/stripGeometry.ts` (33-42) and `stripGeometry.test.ts` (36-43) — D7.
- `client/src/review/ZoomableSourceViewport.tsx` (213-257 wheel; 322-330 `overflows`; 455-465
  overlay) and `ZoomableSourceViewport.test.tsx` (95-120 wheel tests) — D8, D13.
- `client/src/review/sourceZoom.ts` (`panBy`, `zoomAbout`, `minZoomFor`) and `sourceZoom.test.ts`
  (205-217) — D8.
- `client/src/review/SourceOverlay.tsx` (all) and `SourceOverlay.test.tsx` — D13.
- `client/src/review/SourceStrip.tsx` (around 60-80, its `SourceOverlay` use) — D13.
- `client/src/review/PayslipForm.tsx` (all) and `PayslipForm.test.tsx` — D9, D11, D12.
- `client/src/review/LineItemSection.tsx` (all) and `LineItemSection.test.tsx` — D9, D14.
- `client/src/review/SectionLegend.tsx` — becomes the disclosure header; D9.
- `client/src/review/regionSections.ts` (`Section`, `SECTION_LABEL_KEYS`, `sectionOf` at 145) — the
  section of a path.
- `client/src/review/fieldAttention.ts` (`attentionFor` 20, `sectionWarnings` 34) — D9 counts.
- `client/src/review/PayslipReview.tsx` (all) and `PayslipReview.test.tsx` — D9 auto-open, D10,
  D11.
- `client/src/review/ReviewField.tsx` (`fieldId`, `pathOfFieldId`) — ids for linking.
- `client/src/history/useWideLayout.ts` — the `lg` hook.
- `client/src/i18n/locales/{en,hr}.json`, `client/src/i18n/i18n.test.ts` — D15.
- `../receipt-ocr/client/src/review/ItemRows.tsx` (114-118) — the text action D14 mirrors.
- `PRD.md` §7.6 (519-538), §7.7 (539-557), §7.8 (559-574), §7.10 (602-606) — D16.

### New Files to Create

- `client/src/components/DisclosureButton.tsx` — D10.
- `client/src/components/DisclosureButton.test.tsx` — `aria-expanded`, `aria-controls`, toggle.
- `client/src/review/openSections.ts` — D9 defaults and the `sessionStorage` hook.
- `client/src/review/openSections.test.ts` — defaults, persistence, storage failure.
- `.agents/history/15-review-flow-iteration.md` — the record (step 20).

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [react-hook-form `reset`](https://react-hook-form.com/docs/useform/reset) — resetting to given
  values clears `isDirty` and field arrays.
- [react-hook-form `handleSubmit`](https://react-hook-form.com/docs/useform/handlesubmit) — the
  `onInvalid` callback; its ordering before the error focus is confirmed in the installed source
  (`index.esm.mjs:3164-3168`).
- [React `flushSync`](https://react.dev/reference/react-dom/flushSync) — open a section, then focus
  inside it synchronously.
- [HTML `form` attribute](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/button#form) and
  [the `reset` event](https://developer.mozilla.org/en-US/docs/Web/API/HTMLFormElement/reset_event)
  — a reset button outside its form.
- [WAI-ARIA APG Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/) — button with
  `aria-expanded` controlling a region.
- [MDN `hidden`](https://developer.mozilla.org/en-US/docs/Web/HTML/Global_attributes/hidden) — a
  hidden element's descendants cannot be focused.

### Patterns to Follow

**Provider state updates return the previous map when nothing changes** (avoid renders):

```ts
setBatches((previous) => {
  const items = previous.get(sessionId);
  if (items === undefined) return previous;
  return new Map(previous).set(sessionId, items.map(...));
});
```
(`UploadBatchProvider.tsx:23-33`). `markListed` must additionally return `previous` when no item
changes, since it runs after every poll.

**Storage access is wrapped** (house rule for browser storage; no existing helper to reuse):

```ts
function read(): Record<string, boolean> | null {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
```

**Target size**: every new control is `min-h-12` (48 px, PRD §11.5).

**Copy**: every string is an `en` + `hr` pair; `hr` imperatives use "vi".

**Busy and disabled states** use `aria-disabled`, not `disabled`, where focus must stay (Task 07);
the zoom buttons' `disabled` is the existing exception.

**Comments** cite the decision: `// Task 15 D2: …`, matching `// Task 14 D12: …`.

**Tests** use Testing Library queries by role and name; the i18n instance is the real one (see
`client/src/test/setup.ts`). `fireEvent.wheel` for the viewport (`ZoomableSourceViewport.test.tsx:95`).

---

## IMPLEMENTATION PLAN

### Phase 1: Bugs and routing (steps 2–4)

The batch hand-over, the single view and the History route.

### Phase 2: Shell, rail and merge (steps 5–8)

Sidebar, `+N`, Merge button, merge copy.

### Phase 3: Viewer (steps 9–10)

Wheel and outlines.

### Phase 4: Form (steps 11–16)

Disclosure component, section state, sections, discard, add row, phone buttons.

### Phase 5: Docs and validation (steps 17–20)

---

## STEP-BY-STEP TASKS

Execute every step in order. Each ends with a validation command.

### 1. VERIFY the starting state

- `git status --short` is clean apart from this plan; `git log -1 --oneline` is `dab77c2` or later.
- `npm run validate` is green; record the file and test counts (Task 14 ended at 74 / 1,147).
- **VALIDATE**: `npm run validate`

### 2. TDD the hand-over in the upload batch (D2)

- **ADD** to `UploadBatchContext.ts`: `readonly listed?: true` on `BatchItem` (doc: "its payslip
  has appeared in a session read; from then on the session read represents it"), and
  `markListed(sessionId: string, payslipIds: ReadonlySet<string>): void` on the context.
- **RED** in `UploadBatchProvider.test.tsx`: after an upload resolves, `markListed` with its id
  sets `listed`; a second call with the same ids does not change the `itemsFor` array identity; an
  id not in the batch changes nothing; `waiting`/`rejected` items are never marked.
- **IMPLEMENT** in `UploadBatchProvider.tsx`, `useCallback`, added to the context value and its
  `useMemo` deps.
- **UPDATE** `SessionPage.tsx`:
  - take `markListed` from `useUploadBatch()`;
  - `useEffect(() => { if (detail) markListed(sessionId, new Set(detail.payslips.map((p) => p.id))); }, [detail, sessionId, markListed]);`
  - `pending = items.filter((item) => !item.listed && (item.state !== "uploaded" || !listed.has(item.payslipId ?? "")))`;
    rewrite the comment at 266 to say why (a merged or deleted payslip leaves the read for good).
- **UPDATE** the `useUploadBatch` mock in `SessionPage.test.tsx:67` to include `markListed`, and
  make it apply `listed` to `batchItems` so the page re-renders as in the app.
- **RED → GREEN** in `SessionPage.test.tsx`:
  - "a merge leaves no Processing row and counts one payslip": two uploaded, listed items; merge;
    no `listitem` with "Processing"; the heading and progress say one payslip.
  - "a payslip deleted elsewhere is not counted": batch item uploaded and listed, the server read no
    longer has it; progress reads "1 of 1", not "1 of 2"; no batch row.
  - The existing "appends unsent and rejected batch items… each uploaded one once" (216) still
    passes.
- **GOTCHA**: do not remove items (see D2 on `uploadedCount`).
- **VALIDATE**: `npx vitest run client/src/upload client/src/routes/SessionPage.test.tsx`

### 3. UPDATE the History route (D3)

- **UPDATE** `historyRow.ts` `rowRoute`: append `&view=single`; doc comment: "opens the single
  view (Task 15 D3); the upload view is the session URL without it".
- **UPDATE** `historyRow.test.ts` and any `HistoryPage.test.tsx` / cards / table assertion on the
  href.
- **VALIDATE**: `npx vitest run client/src/history client/src/routes/HistoryPage.test.tsx`

### 4. ADD the single view to `SessionPage` (D3)

- `const single = searchParams.get("view") === "single";`
- Default-selection effect: `if (single || selected !== null || detail === null) return;`
- Not found: when `single && loadState === "ready" && selected === null`, render the not-found
  block with `session.payslipNotFound` and a `Link` to `/payslips` (`review.backToPayslips`),
  styled like the existing 404 block (`SessionPage.tsx:294-305`).
- Header in single view: the back link; a row `flex items-start justify-between gap-2` with
  `h1 className="text-2xl font-semibold break-all"` = `selected.originalFilename` and the `⋮` menu;
  the status line `t(\`historyStatus.${selected.status}\`)`.
- Hide in single view: `MergeSuggestions`, `PayslipRail`, the batch `<ol>`, the Merge button
  (step 7), and the in-panel `h2` row (the menu moved to the header).
- The panel: in single view a `div` without `role`, `tabIndex`, `aria-labelledby`; the upload view
  is unchanged.
- **ADD** `session.payslipNotFound` (D15) to both locales.
- **RED → GREEN** in a new `describe("SessionPage single view (Task 15 D3)")`:
  - `?payslip=b&view=single` with three payslips: no `tablist`, no suggestion, no Merge button; `h1`
    is b's file name; the status line is "Needs review";
  - the URL keeps `view=single` (no replacement) and a confirmed payslip offers the downloads;
  - a missing id shows "This payslip does not exist." with a link to `/payslips`;
  - without `view`, the rail is present (regression).
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx`

### 5. UPDATE the sidebar (D6)

- **UPDATE** `NavItems.tsx`: `collapsed?: boolean`. Collapsed: the link is
  `justify-center px-0`, `title={t(labelKey)}`, and the label is `<span className="sr-only">`.
- **UPDATE** `AppLayout.tsx`: `collapsed` state initialised from `localStorage` (try/catch, key
  `payslip-ocr:sidebar-collapsed`), written on toggle (try/catch). Nav class `w-60` ↔ `w-18`
  (keep every other class). A toggle `button` as the nav's first child, `aria-expanded={!collapsed}`,
  `aria-controls="sidebar-nav-list"`, `aria-label` per D6, the `ul` gets that id. Pass
  `collapsed` to `NavItems`.
- **ADD** the two `common.*` keys.
- **RED → GREEN** in `AppLayout.test.tsx`: collapsing keeps both links reachable by name; the
  state survives a remount through `localStorage`; a throwing `localStorage` still renders
  expanded (stub `Storage.prototype.getItem` to throw).
- **VALIDATE**: `npx vitest run client/src/components`

### 6. REMOVE the `+N` badge (D7)

- **REMOVE** from `PayslipRail.tsx`: `overflowAfter` import, `rail` ref, `visible` state, the
  IntersectionObserver effect, the badge; `useState` import if unused. Keep the scroll-into-view
  effect and roving tabs.
- **REMOVE** `overflowAfter` from `stripGeometry.ts` and its test (36-43), and the rail test
  "puts the overflow count on the last fully visible chip" (103-133).
- **VALIDATE**: `npx vitest run client/src/review/PayslipRail.test.tsx client/src/review/stripGeometry.test.ts`

### 7. ADD the Merge button (D4)

- **UPDATE** `SessionPage.tsx`: remove the `merge` item from `actions`; render, in the upload
  view's heading row between the `h2` and the `⋮` menu, when `canMerge(selected, payslips)`:

  ```tsx
  <button type="button" onClick={() => openMerge(null)} className="inline-flex min-h-12 shrink-0 items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 font-semibold text-slate-700 hover:bg-slate-100">
    <Combine aria-hidden="true" className="size-5" />
    <span className="lg:hidden">{t("merge.mergeShort")}</span>
    <span className="hidden lg:inline">{t("merge.mergeWith")}</span>
  </button>
  ```
  Wrap the two controls in `flex shrink-0 items-center gap-2`.
- **ADD** `merge.mergeShort`.
- **REWRITE** the menu tests (`SessionPage.test.tsx:681-815`): "offers Merge…" → the button by
  role and name; "offers only Merge…" → a button and no menu; "all three" → a button plus a menu
  with the two downloads. jsdom does not apply `lg:hidden`, so query the name with a regex that
  accepts either label or assert on `getByRole("button", { name: /merge/i })`.
- `MergeDialog` returns focus to whatever opened it (`MergeDialog.tsx:69`), so the button needs no
  change there; add one assertion that closing the dialog refocuses the Merge button.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx client/src/session`

### 8. REMOVE the merge warning (D5)

- **REMOVE** `MergeDialog.tsx:178` and `merge.consequence` in both locales; update the component's
  doc comment (33-37) to drop the consequence sentence.
- **REMOVE** the test "states the consequence in words" (`MergeDialog.test.tsx:114-122`).
- **VALIDATE**: `npx vitest run client/src/session client/src/i18n`

### 9. TDD the wheel (D8)

- **RED** in `ZoomableSourceViewport.test.tsx`: replace "scrolls the document with a plain
  wheel…" (95-110) with "zooms with a plain wheel about the cursor, and never lets the page
  scroll" at `fit="width"`: `deltaY: -100` zooms in (the percentage rises), the returned event is
  `defaultPrevented`; at the minimum zoom a zoom-out wheel is still prevented. Keep "zooms with
  Ctrl + wheel" (111) passing: Ctrl changes nothing now.
- **UPDATE** the fit-width branch: drop the `if (event.ctrlKey)` condition and the `panBy`
  fall-through; comment: "Task 15 D8: a plain wheel zooms again, proportionally so a trackpad's
  many small events stay smooth; drag pans."
- **REMOVE** `panBy` from `sourceZoom.ts` and its import and tests (205-217) if `git grep -n panBy
  client/src` then shows no caller.
- **VALIDATE**: `npx vitest run client/src/review/ZoomableSourceViewport.test.tsx client/src/review/sourceZoom.test.ts`

### 10. TDD the outlines (D13)

- **ADD** to `SourceOverlay.tsx`: exported `OUTLINE_GAP_PX = 1.5` and pure
  `padCorners(corners, padX, padY)`: centroid by the mean of the corners; each corner moves by
  `±padX` / `±padY` by the sign of its offset from the centroid (0 offset → no move).
- **ADD** prop `rendered?: { width: number; height: number }` (the page's on-screen CSS size); when
  present and positive, polygons use `padCorners(region.corners, OUTLINE_GAP_PX / width,
  OUTLINE_GAP_PX / height)`. Absent → unpadded.
- Stroke `active ? 2 : 1`; `fillOpacity={active ? 0.1 : 0}`. Update the `EDITED_DASH` comment's
  stroke width.
- **PASS** `rendered={{ width: content.width * view.zoom, height: content.height * view.zoom }}` from
  `ZoomableSourceViewport.tsx:457`, and from `SourceStrip.tsx:70` `rendered={{ width:
  view.surfaceWidth, height: view.surfaceWidth / ratio }}` (the strip's surface is unscaled).
- **RED → GREEN** in `SourceOverlay.test.tsx`: `padCorners` on a unit-free rectangle grows each
  side by the pad; a polygon with `rendered` is outside the quad; stroke widths 1 and 2; the
  full-opacity test (61) unchanged.
- **VALIDATE**: `npx vitest run client/src/review/SourceOverlay.test.tsx client/src/review/SourceStrip.test.tsx client/src/review/ZoomableSourceViewport.test.tsx`

### 11. CREATE `DisclosureButton` (D10)

```tsx
interface DisclosureButtonProps {
  expanded: boolean;
  controls: string;
  onToggle: () => void;
  children: ReactNode;
  className?: string;
}
```
Renders `<button type="button" aria-expanded aria-controls onClick className="inline-flex
min-h-12 items-center gap-2 text-left font-semibold text-slate-700 hover:text-slate-900 …">` with
`<ChevronDown aria-hidden="true" className={\`size-5 shrink-0 transition-transform ${expanded ? "" :
"-rotate-90"}\`} />` then `children`.
- **TEST**: role button, `aria-expanded` follows the prop, click calls `onToggle`.
- **VALIDATE**: `npx vitest run client/src/components/DisclosureButton.test.tsx`

### 12. UPDATE "Show document" (D10)

- **REPLACE** the button at `PayslipReview.tsx:134-145` with `DisclosureButton` (`controls=
  "payslip-source"`, `className="self-start lg:hidden"`), same labels and `keyboard` rule.
- **UPDATE** any `PayslipReview.test.tsx` assertion on the old button (name unchanged).
- **VALIDATE**: `npx vitest run client/src/review/PayslipReview.test.tsx`

### 13. CREATE the section state (D9)

`client/src/review/openSections.ts`:
- `DEFAULT_OPEN: Record<Section, boolean>`: the four scalar sections `true`, the three tables
  `false`.
- `useOpenSections()` → `{ open: Record<Section, boolean>; setOpen(section, open): void;
  openAll(sections: Iterable<Section>): void }`. Initial state: `DEFAULT_OPEN` merged with the
  `sessionStorage` value under `payslip-ocr:open-sections` (only known sections, only booleans);
  written on every change. All storage access in try/catch.
- **TEST**: defaults; a change survives a remount; a corrupt or throwing storage yields defaults.
- **VALIDATE**: `npx vitest run client/src/review/openSections.test.ts`

### 14. UPDATE the sections (D9, D14)

- **ADD** to `fieldAttention.ts`: `attentionCount(paths: readonly string[], signals, warnings:
  readonly unknown[] = [])` = paths with a non-null `attentionFor` plus `warnings.length`; unit
  test in `fieldAttention.test.ts`.
- **UPDATE** `SectionLegend.tsx`: optional `expanded`, `controls`, `onToggle`, `summary`
  (`ReactNode`). With `onToggle`, the `legend` holds a `DisclosureButton` containing the dot, the
  label and the summary (`text-sm font-normal text-slate-600`); without it, today's output.
- **UPDATE** `PayslipForm.tsx`: new props `open: Record<Section, boolean>` and
  `onToggleSection(section)`. Each scalar `fieldset`: header with summary = the amber count when
  non-zero; body `<div id={\`review-section-${section}\`} hidden={!open[section]} className="flex
  flex-col gap-3">`. Pass `open`/`onToggle` to each `LineItemSection`.
- **UPDATE** `LineItemSection.tsx`: props `expanded`, `onToggle`; header summary = row count
  (`review.rowCount`, from `rows.fields.length`) or `tablesStatus.pending`, plus the amber count
  over every cell path and `sectionWarnings`. The existing body (pending skeleton, failed notice,
  cards or table, add action) goes inside `<div id={\`review-section-${table}\`} hidden={!expanded}>`.
  Keep the section warning paragraph inside the body.
- **UPDATE** the add action (D14): the class list in D14 and `<Plus aria-hidden="true"
  className="size-4" />`.
- **UPDATE** `PayslipReview.tsx`: `const sections = useOpenSections();` pass down.
  `selectRegion(path)`: `const section = sectionOf(path); if (section && !sections.open[section])
  flushSync(() => sections.setOpen(section, true));` before the existing focus and scroll.
- **UPDATE** `PayslipForm.tsx` `handleSubmit(save, (errors) => { flushSync(() => onOpenSections(
  Object.keys(errors).map(sectionOf).filter(isSection))); setError(...) })` — a new prop
  `onOpenSections` mapped to `sections.openAll`. Error keys are top-level: a scalar name or a table
  name. `sectionOf` (`regionSections.ts:145`) returns `null` for a bare table name (it knows only
  scalars and dotted cell paths), so map each key as `TABLE_FIELDS.includes(key) ? key :
  sectionOf(key)`.
- **ADD** `review.rowCount_*`, `review.toCheck_*`.
- **RED → GREEN**:
  - `PayslipForm.test.tsx`: tables start collapsed (their `aria-expanded="false"`, rows hidden);
    toggling shows the rows; a table summary reads "2 rows"; an attention cell shows "1 to check";
    a failed save with a bad amount in a collapsed table opens it and focuses the input.
  - `PayslipReview.test.tsx`: a region click on `obustave.0.iznos` with the table collapsed opens
    it and focuses `review-field-obustave-0-iznos`.
  - `LineItemSection.test.tsx`: the add action is a button named "Add row" without a border class;
    existing tests expand the section first (update the render helper to pass `expanded`).
- **GOTCHA**: `hidden` on a `div` inside a `fieldset` is fine; do not use `display` toggles that
  unmount. The pending skeleton `role="status"` inside a hidden body is not announced; the header
  summary carries the pending text.
- **VALIDATE**: `npx vitest run client/src/review`

### 15. ADD "Edited" and "Discard changes" (D11)

- **UPDATE** `PayslipForm.tsx`: `id="review-form"` on the `<form>`;
  `onReset={(event) => { event.preventDefault(); reset(values); }}` where `values` is the memoised
  saved values (`:94`).
- **UPDATE** `PayslipReview.tsx`: `const [dirty, setDirty] = useState(false)`, set inside the
  existing `onDirtyChange` handler alongside `edits.markUnsaved`. Wrap the return in
  `<div className="flex flex-col gap-3">`, with first child, when `dirty ||
  detail.editedFields.length > 0`:

  ```tsx
  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-1 font-medium text-slate-700">
      <PencilLine aria-hidden="true" className="size-4" />
      {t("review.edited")}
    </span>
    {dirty ? (
      <button type="reset" form="review-form" className="min-h-12 font-semibold text-accent underline underline-offset-4 hover:text-accent-hover">
        {t("review.discard")}
      </button>
    ) : null}
  </div>
  ```
- **ADD** `review.edited`, `review.discard`.
- **RED → GREEN** in `PayslipReview.test.tsx` / `PayslipForm.test.tsx`:
  - no badge on an untouched payslip without `editedFields`;
  - typing shows the badge and "Discard changes"; clicking it restores the saved value, hides the
    action, and reports clean (`markUnsaved(id, false)`);
  - an added row is removed by discard;
  - a payslip with saved `editedFields` shows the badge without the action.
- **GOTCHA**: jsdom implements the `form` attribute and dispatches `reset` for a `type="reset"`
  button; if the test shows otherwise, fall back to an `onClick` that calls
  `document.getElementById("review-form")?.dispatchEvent(new Event("reset", { cancelable: true }))`
  — do not add a ref-forwarding API.
- **VALIDATE**: `npx vitest run client/src/review`

### 16. UPDATE Save and Confirm on the phone (D12)

- `PayslipForm.tsx:231`: `flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:gap-2`;
  each button adds `w-full justify-center lg:w-auto`; the confirmed `p` adds `justify-center
  lg:justify-start`.
- No test (classes only); covered by the review session's journey.
- **VALIDATE**: `npx vitest run client/src/review/PayslipForm.test.tsx`

### 17. RUN the whole suite and the static checks

- **VALIDATE**:
  - `npm run validate`
  - `npm run build`
  - `npm run check:secrets`
  - `git grep -n "overflowAfter\|merge.consequence\|panBy" client/src` returns nothing
  - `git grep -n "react-router-dom" client/src` returns nothing
  - `git diff --check`; `package-lock.json` unchanged

### 18. UPDATE the docs (D16)

- **PRD §7.6**: the rail sentence without `+N`; the wheel sentence ("A plain wheel zooms about the
  cursor, proportionally; drag pans; the page never scrolls from the preview", Task 15); the phone
  budget `9,560,000`; a "Settled in Task 15" list: the single view (D3) and the batch hand-over
  (D2).
- **PRD §7.7**: sections as disclosures with defaults, summary and auto-open (D9); Edited and
  Discard (D11); add row (D14); stacked buttons below `lg` (D12).
- **PRD §7.8**: "manually from the payslip's Merge button in the upload view"; replace "the dialog
  says in words that edits…" with "a merge replaces both payslips, their edits and confirmation
  with a fresh extraction; the dialog shows the pages and a swap, without a warning (Task 15)".
- **PRD §7.10**: "each row opens that payslip alone (`view=single`): no rail and no merge".
- **ROADMAP §2**: a Task 15 line after Task 14's, pointing at this plan and history/15.
- **`.claude/commands/validate.md`** (git-ignored): journey **9.14** (below); in 9.9 drop the `+N`
  check; in 9.10 open merge by the button; in 9.13 step 7 replace "a plain wheel pans" with the
  D8 behaviour.

Journey 9.14 — review-flow iteration (Task 15, PAID ≤ 2 analyses, ~$0.05; seed everything else at
$0 as the Task 14 review did):
1. Upload two photos of one payslip (A01 split in two, or A02 twice): the rail shows both; merge by
   the **button**; the dialog has no warning text; after the merge **no** row below the form, the
   header counts 1.
2. From Payslips, open the merged payslip: `view=single`, no rail, no Merge button, `h1` = file
   name, status line. A deleted payslip's link shows the not-found message.
3. Delete one payslip of a seeded three-payslip session in Payslips, go Back to the session: the
   header counts 2, no phantom row.
4. Sidebar: collapse, reload (stays collapsed), every link reachable by Tab with a tooltip.
5. Preview at 1366×768: a plain wheel zooms about the cursor, the page does not scroll; drag pans
   at 100%; zoom-out stops at the whole page.
6. Outlines at 375 px (touch emulation) on A01.pdf and A02.jpg: text readable at fit; screenshot.
7. Form: tables collapsed with row counts and "N to check"; a region click in a collapsed table
   opens it and focuses the cell; the open state survives switching payslips.
8. Edit a value: "Edited" and "Discard changes" appear, discard restores it and the chip pencil
   goes; after a save the badge stays and discard is absent.
9. At 375 px: "Show document" is a chevron text disclosure; "+ Add row" is a text action; Save and
   Confirm are full width and stacked.
- **VALIDATE**: `npx prettier --check PRD.md .agents/ROADMAP.md` is not applicable (Prettier skips
  `*.md`); re-read each edited section instead.

### 19. RUN the hosted integration tests ($0)

- No API, shared or migration change, so a regression check only.
- **VALIDATE**: `npm run test:integration`

### 20. WRITE history/15 and STOP (D1)

- **CREATE** `.agents/history/15-review-flow-iteration.md` in the history/14 shape: outcome, what
  was built (created/modified tables), deviations, validation table (baseline and final counts),
  open items, review-session handoff:
  1. `/code-review` against the last commit before Task 15.
  2. `/validate` with journey 9.14 (≤ 2 paid analyses) and the updated 9.9, 9.10, 9.13.
  3. Judge D13's gap on the phone emulation; tune `OUTLINE_GAP_PX` if outlines overlap on dense
     tables.
  4. Commit, subtree-push, CI deploy on the product owner's go-ahead.
  5. Then the product owner's Android check (Task 14 D19–D21 plus this task) and the Task 13
     device sitting.
- Do not run `/code-review`, `/validate`, browser journeys, or commit.
- **VALIDATE**: `git status --short` lists only the intended files.

---

## TESTING STRATEGY

### Unit Tests

- **Pure**: `padCorners` (step 10), `attentionCount` (14), `openSections` defaults and storage
  (13), `rowRoute` (3).
- **Provider**: `markListed` identity and scope (2).
- **Components**:
  - `SessionPage`: hand-over after merge and delete (2); single view (4); Merge button (7);
  - `AppLayout`: collapse, persistence, failing storage (5);
  - `PayslipRail`: no badge (6);
  - `MergeDialog`: no consequence (8);
  - `ZoomableSourceViewport`: plain wheel zoom, prevented at the minimum (9);
  - `SourceOverlay`: padding and widths (10);
  - `DisclosureButton` (11); `PayslipReview`: disclosure, auto-open, badge, discard (12, 14, 15);
  - `PayslipForm` and `LineItemSection`: collapsed tables, summaries, invalid-save auto-open, text
    add action (14).
- **Guards**: `i18n.test.ts` parity and plural categories for the new keys.

### Integration Tests

`npm run test:integration` against hosted Supabase ($0). Regression only.

### Edge Cases

- Upload three, merge two while the third is still uploading: the third stays as a batch row until
  listed; the merged originals never come back.
- Two tabs: a delete in tab B; tab A's batch still holds the item listed, so it stays hidden.
- A batch item rejected: never listed; its row and dismiss button stay.
- Single view on a payslip still `processing`: the processing text, polling continues, no rail.
- Single view with the payslip merged away later: not-found message, not a redirect.
- Single view reload: `view=single` survives.
- Collapsed sidebar with `localStorage` blocked (private window): renders expanded, toggles in
  memory.
- Wheel at max zoom: prevented, no page scroll, zoom stays at `MAX_ZOOM`.
- A region click on a field in a collapsed section while the phone popover is used: Edit opens the
  section and focuses.
- A failed save with errors in two collapsed tables: both open, the first error is focused.
- A pending tables pass: the table header says pending; opening it shows the skeleton.
- Discard after adding and removing rows: the row count returns to the saved one.
- Discard while no change remains (typed then deleted back): `isDirty` false, action absent.
- A quad of zero height (degenerate): `padCorners` still returns four corners (grows by the pad).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run validate` (typecheck → oxlint → Prettier check → Vitest)

### Level 2: Unit Tests

`npx vitest run client/src`

### Level 3: Integration Tests

`npm run test:integration` (hosted Supabase, $0)

### Level 4: Manual Validation

Journey 9.14 and the phone check belong to the **review session** (D1).

### Level 5: Additional Validation

`npm run build`; `npm run check:secrets`; `git diff --check`;
`git grep -n "overflowAfter\|merge.consequence\|panBy\|react-router-dom" client/src` returns nothing.

---

## ACCEPTANCE CRITERIA

- [ ] After a merge or a delete, no batch row reappears and the header counts only live payslips
      plus unsent files (tests).
- [ ] History links open `view=single`: no rail, suggestions, batch rows or Merge; file-name
      heading and status; a missing payslip shows the not-found message.
- [ ] The desktop sidebar collapses to a 72 px icon rail, keeps accessible names, and remembers the
      state.
- [ ] No `+N` badge; `overflowAfter` removed.
- [ ] Merge is a visible button in the upload view, and the `⋮` menu holds only downloads.
- [ ] The merge dialog has no warning text; `merge.consequence` removed.
- [ ] A plain wheel over the desktop preview zooms and never scrolls the page; `panBy` removed if
      orphaned.
- [ ] Outlines are padded by 1.5 screen px, 1 px at rest and 2 px active.
- [ ] All seven sections are disclosures (scalars open, tables closed) with summaries, auto-open on
      region click and failed save, and state kept in `sessionStorage`.
- [ ] "Show document" uses the shared disclosure.
- [ ] "Edited" appears for saved or unsaved changes; "Discard changes" only for unsaved, and it
      restores the last save.
- [ ] "+ Add row" is a text action at every width; Save and Confirm stack full width below `lg`.
- [ ] Every new string exists in `en` and `hr`; the parity test passes.
- [ ] `npm run validate`, `npm run build`, `npm run check:secrets`, `npm run test:integration`
      pass; PRD, ROADMAP, `validate.md` updated; history/15 written; nothing committed; $0.

---

## COMPLETION CHECKLIST

- [ ] All steps completed in order
- [ ] Each step's validation passed
- [ ] Full test suite passes (unit + integration)
- [ ] No lint, format or type errors
- [ ] Acceptance criteria met, or each gap stated in history/15
- [ ] Stopped before review, `/validate`, browser journeys and commit (D1)

---

## NOTES

- **Why a flag, not a store of deleted ids (D2).** The batch's job ends when the server knows a
  payslip; after that the session read is the truth. "Listed once" encodes exactly that, and makes
  merge, delete and any future removal correct without each one having to notify the batch.
- **Why `view=single` in the URL (D3)** rather than inferring it from the batch: a reload during an
  upload would otherwise drop the rail, and a reload of a History link would gain it.
- **Why the badge sits above the grid, not in the heading row (D11).** The heading row belongs to
  `SessionPage`, which knows neither the form's dirty state nor `editedFields`; moving either up
  would mean new plumbing for the same pixels.
- **Why `type="reset"` (D11).** It lets a control outside the form act on it with no ref or
  imperative API, and `reset(values)` is the same call save already relies on.
- **Superseded:** Task 14 D17's wheel (plan 14), Task 10's `+N` badge, plan 11 D11's merge menu
  item and consequence text, plan 12 D5's merge-in-menu. Record them in history/15; the ROADMAP's
  Task 10–14 blocks stay as the historical record.
- **Deliberately not built:** restoring extracted values; per-field edit markers; a session-page
  delete; merge from the Payslips list; a link from the single view to the upload view; changes to
  receipt-ocr.
- **Confidence: 7/10** for one-pass success. Most steps are local and mechanical. The risks:
  - step 14 touches every form section and many existing tests must first expand a section;
  - auto-open relies on `flushSync` before focus and on react-hook-form's `onInvalid` ordering
    (verified in the installed source, not yet exercised);
  - D13's 1.5 px gap is a judgement only a phone-sized screen can confirm.
