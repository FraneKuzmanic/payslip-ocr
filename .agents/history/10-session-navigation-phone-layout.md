# 10 — Session navigation & phone layout

**Date:** 2026-09-26
**Plan:** [10-session-navigation-phone-layout.md](../plans/10-session-navigation-phone-layout.md)
**Outcome:** session tabs, page navigation and the phone source strip are implemented. Unsaved
edits survive payslip switches, Back/Forward and leaving/returning to the session in the same tab.
**Status: implemented, reviewed and browser-validated; M2 pending; not committed.**

Following D10, this session did not run `/code-review`, `/validate`, browser journeys, paid
extraction, migrations or deployment, and did not commit. Local `npm run validate` is distinct
from the deferred `/validate` review command. Paid runs: **0 documents, $0**.

## What was built

Paths below are relative to this project root; paired tests are listed explicitly.

| Created file | Contents |
| --- | --- |
| `client/src/review/unsaved/UnsavedEditsContext.ts` | Snapshot and context contract |
| `client/src/review/unsaved/UnsavedEditsProvider.tsx` | Tab-memory snapshots, unsaved membership and reload guard |
| `client/src/review/unsaved/useUnsavedEdits.ts` | Provider-bound hook |
| `client/src/review/unsaved/UnsavedEditsProvider.test.tsx` | Membership, snapshot lifecycle, guard and missing-provider tests |
| `client/src/review/PayslipRail.tsx` | Manual-activation tabs, status/unsaved marks, selected scrolling and overflow badge |
| `client/src/review/PayslipRail.test.tsx` | Both orientations, labels, keyboard activation and overflow |
| `client/src/review/PageNavigator.tsx` | Desktop page rail, phone pager/sheet and lazy cancellable thumbnails |
| `client/src/review/PageNavigator.test.tsx` | Single-page absence, selection, focus return and render cancellation |
| `client/src/review/stripGeometry.ts` | Bounded crop geometry, obscuration and rail overflow helpers |
| `client/src/review/stripGeometry.test.ts` | Seven pure geometry/visibility cases |
| `client/src/review/SourceStrip.tsx` | Inert 64 px active-region crop or no-outline note |
| `client/src/review/SourceStrip.test.tsx` | Crop, single outline, inertness and withheld/missing-region cases |
| `client/src/review/useSoftKeyboard.ts` | Coarse-pointer focus gate, viewport offsets and one-shot focus scrolling |
| `client/src/review/useSoftKeyboard.test.ts` | Pointer gate, viewport changes and cleanup |
| `.agents/history/10-session-navigation-phone-layout.md` | This implementation record and review handoff |

| Modified file | Change |
| --- | --- |
| `client/src/App.tsx` | Unsaved-edits layout provider inside the protected upload branch |
| `client/src/history/useWideLayout.ts` | Optional media query; exported LG and XL breakpoints |
| `client/src/routes/SessionPage.tsx` | Selected tabpanel for readable, processing and failed payslips; URL replacement/push; retained polling/retry/upload progress |
| `client/src/routes/SessionPage.test.tsx` | Updated navigation contract while retaining polling, retry and failure coverage |
| `client/src/review/PayslipForm.tsx` | Dirty-key restoration and unmount snapshots; keyboard-hidden action bar |
| `client/src/review/PayslipForm.test.tsx` | Scalar/removed-row restoration, pending tables, clean/save snapshots and StrictMode |
| `client/src/review/PayslipReview.tsx` | Form-first DOM, responsive 3:2 layout, snapshot lifecycle and keyboard strip wiring |
| `client/src/review/PayslipReview.test.tsx` | Real form navigation journey in StrictMode, DOM order and keyboard layout gate |
| `client/src/review/PdfSource.tsx` | Reuse loaded PDF in strip mode; page navigator; page-specific measured viewport |
| `client/src/review/SourceDocumentPanel.tsx` | Fixed strip wrapper and image/PDF integration retaining the ratio guard |
| `client/src/review/SourceDocumentPanel.test.tsx` | Initially unopened image measurement, withheld outlines and no refetch on strip toggle |
| `client/src/review/LineItemSection.tsx` | Fixed numeric/removal columns and remaining-width text columns |
| `client/src/review/LineItemSection.test.tsx` | Column-group contract |
| `client/src/components/BottomNav.tsx` | Keyboard visibility marker |
| `client/index.html` | `interactive-widget=resizes-content` |
| `client/src/index.css` | Keyboard focus clearance and bottom-control hiding |
| `client/src/i18n/locales/en.json`, `client/src/i18n/locales/hr.json` | New navigation/strip copy; removed discard and old row-toggle keys |
| `PRD.md`, `.agents/ROADMAP.md`, `CONTEXT.md` | Implemented behaviour, explicit review/M2 status and Unsaved edits vocabulary |
| `.claude/commands/validate.md` | New unit-test rows, updated navigation expectations, journey 9.9, removed Task 10 future-journey row |

## Decisions

- Implemented plan D1–D8: tab-memory edits, thumbnail-free payslip tabs, one source page at a
  time, xl payslip list, 64 px phone strip, pure crop geometry, URL-driven selection and
  rail → form → source DOM order.
- First selection replaces the URL; choosing another tab pushes history. Processing and failed
  payslips remain selectable. No discard dialog is needed for in-app navigation.
- Only dirty top-level keys restore over fresh server values. A dirty table restores as a whole;
  untouched tables can still arrive while the user is away.
- The original zoom viewport, overlay and zoom geometry modules remain untouched. Unsafe or
  missing source regions never produce a crop. Strip mode does not refetch the source file.
- Domain-modeling kept the new glossary entry about the user concept, not its implementation.
  Writing-for-agents guided the explicit test-versus-browser checks in the review command.

## Deviations and implementation findings

1. **Non-destructive snapshot read.** Added `peek` for the review's state initializer, then
   consume with `take` only after its form can mount. A destructive initializer can run twice
   under StrictMode; a failed initial load must not discard the kept edits.
2. **RHF restoration fallback.** The planned `setValue` path failed the removed-row test.
   Used the plan's `reset(..., { keepDefaultValues: true })` fallback, merging only dirty keys
   over current values; tests prove field-array length and dirty-only saves.
3. **Unmount ordering.** Report the mounted form clean before keeping its snapshot. Reversing
   that order clears the closed payslip's unsaved membership and reload protection.
4. **Windows filename collision.** Renamed planned `sourceStrip.ts`/test to
   `stripGeometry.ts`/test. `sourceStrip.ts` and `SourceStrip.tsx` share a case-insensitive
   module stem and resolved incorrectly on Windows. Keep component/helper module stems distinct,
   not merely differently capitalised (also encountered in Task 09).
5. **Peek width.** Two full chips plus two 8 px gaps need `calc((100% - 2.5rem) / 2)` for a
   24 px third-chip peek; the plan's 2rem subtraction leaves only 16 px.
6. **Wide touch devices.** Gate the focus path before calling the keyboard hook. Gating only
   its returned boolean would still hide global controls on a wide coarse-pointer device.
7. **CSS cascade.** The keyboard `display: none` rule is outside CSS layers so Tailwind display
   utilities cannot override it. Scroll padding remains in the base layer.
8. **Image measurement and PDF page safety.** An initially unopened image strip first measures
   a hidden image before allowing a crop. PDF viewport measurements are tagged with their page
   so a newly selected page never uses the previous page's ratio.
9. **Strip inertness.** Added `inert` as well as `aria-hidden` and pointer-events suppression;
   the existing overlay's polygons explicitly enable pointer events.
10. **Lint verification.** Full validation found five consistent-function-scoping errors.
    Moved the pure centring helper and navigation-test helpers to module scope; rerun passed.

## Validation

| Check | Result |
| --- | --- |
| Baseline `npm run validate` | 57 files, 887 tests passed |
| Targeted form, review, rail, navigator, strip, keyboard, session, layout and locale tests | Passed during implementation |
| `npx vitest run client` | 36 files, 329 tests passed |
| Final `npm run validate` | Typecheck, oxlint, Prettier and **63 files / 922 tests passed**; +6 files / +35 tests net |
| `npm run build` | Passed; existing Vite large-chunk advisory only |
| Lockfile/API/shared/protected source-module diffs | Empty |
| `react-router-dom` in client; `draft` in unsaved module | No matches |
| `git diff --check` | Passed |

Only changed client files were formatted. No dependency, API, shared, database or extraction
changes. No integration run was required for this client-only implementation. The supplied plan
and pre-existing `.claude/` files remain untracked; no staging or commits were performed.

## Open items

1. **M2: real iPhone.** Record device, iOS version, screenshots and verdict. Verify fixed-strip
   tracking, focus clearance and simultaneous input/source visibility with the actual keyboard.
2. **Android back-dismiss limitation.** Dismissing the keyboard without blurring leaves strip
   mode active until focus leaves the input; focus is intentionally the keyboard signal.
3. **Zoom reset.** Leaving keyboard mode remounts the normal viewport at fit; field focus
   recentres it. This is the plan's accepted limitation, not persistent zoom.
4. **Browser review pending.** Unit tests cannot prove 375 px overflow, the visible focus ring,
   actual PDF crop alignment, smooth viewport tracking or readable text columns at 1440 px.
   Task 09 findings 4/6 have implementation changes, not yet visual verification.
5. **Task 09 finding 5 remains:** equal-length remove/add table edits can leave positional
   machine signals on a shifted cell whose text equals the old value at that index.
6. **Task 09 finding 7 remains:** Croatian `redak` versus `red` terminology awaits the owner's
   copy read. Task 10 does not silently broaden into either Task 09 follow-up.

## Review-session handoff

- Run journey **9.9** in `.claude/commands/validate.md`, with **at most two paid documents**.
  Navigation may use M1 data read-only; all edits use a throwaway account. Log cost and clean
  up only the throwaway data, then run the orphan check.
- Read new `hr`/`en` labels with the product owner, including the unsaved and no-outline notes.
- Run `/code-review` and `/validate` in the separate review session. M2 remains a human device
  check, not a result inferred from touch emulation.
- Investigate review findings before closing browser-dependent acceptance criteria. Implementation
  is ready for review; nothing has been committed or deployed.

## Review session (2026-09-26, partial)

Run on a tight session budget, so this was a focused review rather than the full `/code-review`
and `/validate` sweep.

- **Checks:** `npm run validate` green: 63 files, **922 tests**, oxlint 0, typecheck and Prettier
  clean. `npm run build` green, with the known chunk-size advisory. `package-lock.json` unchanged.
  `ZoomableSourceViewport.tsx`, `SourceOverlay.tsx` and `sourceZoom.ts` unchanged (locked decision
  17).
- **Code read** (the paths most likely to be wrong):
  - `PayslipForm` snapshot and restore;
  - the peek-then-take handling in `PayslipReview`;
  - `UnsavedEditsProvider`;
  - `useSoftKeyboard`;
  - arrival selection in `SessionPage`.

  **No defects found.** Three behaviours were confirmed along the way:
  - `reset(…, { keepDefaultValues: true })` recomputes `dirtyFields` against the defaults, so a
    save after restoring sends only the restored keys.
  - `isObscured` compares layout-viewport rects with `offsetTop`-based bounds, which is correct for
    iOS.
  - Arrival selection uses `replace`, and chip presses push.
- **Not run in this session:**
  - journey 9.9 in a browser;
  - the full `/code-review` (Standards and Spec sub-agents);
  - `/validate` Phases 6–8, which are unchanged by a client-only task.

  Journey 9.9 remains the evidence for the 375 px overflow, the focus ring, the rail's snap and
  `+N`, and the strip. **Paid runs: none, $0.**

## Full review and browser validation (2026-09-26)

`/code-review` reviewed the Task 10 work against the plan and repository standards in separate
Standards and Spec agents. Both reported **zero findings** in the static diff. The browser pass
then found two defects and both were fixed:

1. Picking a PDF page in the phone sheet returned focus to the document body. The source loading
   state had unmounted the pager while measuring the new page. Keep the pager mounted through
   measurement and restore focus after the sheet closes. Chromium now focuses the Page 2 pill after
   selection and after Escape.
2. At 1440 px, long line-item names were still cut off in fixed-height inputs. Desktop text cells
   now grow as wrapped textareas; the actual A01 rows display their full names. Phone text cells
   remain inputs. The line-item tests cover the element choice.

`npm run validate` passed after the fixes (typecheck, oxlint, Prettier, 63 files / 922 tests), as
did `npm run build` (existing chunk-size advisory). Hosted integration passed: auth 3, payslips
45, direct writes 4. The analyzer drift check matched both scalars and tables. Golden set 11/11,
CU scoring 281/284 (98.9%), and extraction scoring passed. Secret, environment, import-isolation,
lockfile and `git diff --check` checks passed; the scripted PDF import grep needed a manual `rg`
equivalent because Git's safe-directory setting and Windows shell syntax prevented that particular
one-liner from running as written.

The browser journey used a throwaway account and **two paid documents** (A01 and A02_OCR), an
estimated **$0.09–$0.10** in extraction cost. At 375 px there was no horizontal overflow; controls
measured at least 48 px. Manual tab activation, visible focus, URL replace on arrival, browser
Back/Forward, per-payslip unsaved edits, save, page sheet, page-2 field following and desktop page
rail passed. At 1440 px the vertical payslip list, form/source DOM order, sticky source and full
line-item names passed. The 64 px source strip, hidden bottom controls, no-outline note and blur
restoration passed with a simulated coarse pointer; switching to Croatian kept the phone layout
free of overflow. The throwaway user, both storage sources, both payslips and its session were
deleted; the orphan query returned zero rows and storage objects.

Remaining browser evidence: two documents cannot expose the `+N` badge, and the reload-while-dirty
prompt was not exercised. The actual iPhone keyboard behavior remains M2, owned by the product
owner; browser touch emulation is not evidence for it. No Task 10 change was committed or deployed.

### Pre-commit check (2026-09-26)

The browser pass's line-item textarea (fix 2) had two gaps, both now fixed in
`LineItemSection.tsx` with tests:

1. `field-sizing: content` is Chromium-only (and Safari 26+). Elsewhere the one-row, `overflow-hidden`
   textarea hid the wrapped second line, which is worse than an input's horizontal scroll. The
   textarea is now used only where `CSS.supports("field-sizing", "content")`; other browsers keep
   the input.
2. Enter inserted a line break into a single-line value (Task 09 D17) and no longer saved the form.
   Enter now calls `requestSubmit()`, as in every input.
