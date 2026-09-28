# 14 — UI/UX iteration

**Date:** 2026-09-28
**Plan:** [14-ui-ux-iteration.md](../plans/14-ui-ux-iteration.md)
**Outcome:** every D2–D23 item is implemented and unit-tested. Changes:
- copy: "Payslips" at `/payslips`, "Payslip Scanner", polite Croatian throughout;
- home: two columns at `lg`;
- session page: a loading screen, a first-openable selection, file-name chips, `aria-disabled`
  processing chips, a horizontal rail on top at every width, a 1:1 split and a back link, with
  Save/Confirm in flow;
- viewer: fit width on desktop, in-app pinch, a settled-zoom PDF redraw within a pixel budget,
  the viewer kept mounted across page changes, and `svh` on the phone;
- capture: photos kept up to a 3,000 px long edge.

The zoom-model refactor keeps every pre-Task 14 `sourceZoom` test passing unchanged. D17–D21 are
judged only in a browser and on the product owner's phone, which is the review session's job.

**Status: implemented, reviewed and validated (journey 9.13 in Chromium); not committed.** See
"Review session" at the end.

Following plan 14 D23 and the standing session split, the implementing session did not run
`/code-review`, `/validate` or any browser journey, and did not commit. **Paid runs: 0, $0.** The
review session used two analyses, about $0.10.

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `client/src/capture/downscale.test.ts` | `downscaleTarget` cases (D22) |
| `client/src/review/PdfSource.test.tsx` | The viewer stays mounted while the next page is measured (D20) |
| `.agents/history/14-ui-ux-iteration.md` | This record |

| Modified file | Change |
| --- | --- |
| `client/src/i18n/locales/{en,hr}.json` | D2–D8, D11, D14, D16 copy; the D5 formal sweep; the `historyStatus` group; removed `home.subtitle`, `capture.scanAnother`, `session.position`, `review.inspectPrompt` |
| `client/src/i18n/statusCopy.test.ts` | `historyStatus` in `GROUPS` |
| `client/src/capture/downscale.ts` | `downscaleTarget`; 3,000 px long edge, 4 MB; `DOWNSCALE_MAX_PIXELS` removed (no other importer) |
| `client/src/review/sourceZoom.ts` (+ test) | A content size beside the viewport, `minZoomFor`, centring, `panBy`, `pinchZoom` (D17, D19) |
| `client/src/review/pdfRender.ts` (+ test) | `renderScale(pageWidth, pageHeight, cssWidth, dpr, zoom, budget)`, the two pixel budgets, `needsRedraw`; `MAX_CANVAS_WIDTH` removed (D18) |
| `client/src/App.tsx`, `components/NavItems.tsx`, `components/AppLayout.tsx` (+ tests), `client/index.html` | `/payslips` with `FileText`; sticky sidebar; placeholder title (D2, D3, D15) |
| `client/src/routes/HomePage.tsx` (+ test) | Two columns at `lg`, order by `useWideLayout()`, steps column, the demoted picker (D4) |
| `client/src/routes/HistoryPage.tsx`, `history/PayslipCards.tsx`, `history/PayslipTable.tsx` (+ test) | `historyStatus` copy (D6) |
| `client/src/review/PayslipRail.tsx` (+ test) | Horizontal only, file name and status, `aria-disabled` processing chips, `lg:w-60` (D10) |
| `client/src/routes/SessionPage.tsx` (+ test) | Loading screen, D9 selection, back link, plural heading, file-name panel heading, rail on top, `lg:max-w-none`, no foot link (D7–D12, D14) |
| `client/src/session/MergeSuggestions.tsx`, `MergeDialog.tsx` (+ tests) | File names instead of positions; `shortName` (D11) |
| `client/src/review/PayslipReview.tsx` | 1:1 grid; `--source-height` (D12, D21) |
| `client/src/review/PayslipForm.tsx` (+ test) | The action block in flow, no `data-hide-with-keyboard` (D13) |
| `client/src/review/ZoomableSourceViewport.tsx` (+ test) | `fit`, content-sized layer, wheel pan, Ctrl + wheel zoom, pinch, settled zoom, `overlay`, hint removed (D16, D17, D19, D21) |
| `client/src/review/PdfSource.tsx` | Mounted viewer across page changes; double-buffered settled-zoom redraw (D18, D20) |
| `client/src/review/SourceDocumentPanel.tsx` | `fit` on the image path |
| `client/src/review/PageNavigator.tsx` | The `lg` page rail is as tall as the frame beside it |
| `PRD.md` | §5 story copy, §7.2, §7.6 (Task 14 list), §7.7, §7.10, §11.4 |
| `.agents/ROADMAP.md` | §2 Task 14 line; §5 "Phone layout" row |
| `.claude/commands/validate.md` (git-ignored) | Phase 4 Task 14 table and stale rows; journeys 9.5–9.12 updated; journey 9.13 |

## Decisions

Implemented plan D1–D23 as written, except for the deviations below.

## Deviations and implementation findings

1. **The loading screen yields to any `?payslip=`, not only a valid one (D8).** A merge replaces the
   rows one render before it replaces the URL. For that render the selection was empty and nothing
   was openable, so the loading screen flashed and took the merged tab's focus with it. The existing
   merge test caught it. A stale `?payslip=` with nothing openable now shows the normal page without
   a panel, and D9 still selects the first openable payslip as soon as there is one.
2. **`pinchZoom` takes the starting and the current midpoint** (`from`, `to`), not one midpoint.
   With one, the point under the fingers could not follow them, so a two-finger drag could not pan.
3. **`minZoomFor` returns 1 for an unmeasured (zero) size.** Otherwise `min(1, NaN)` is `NaN` before
   the first measurement.
4. **A page change resets the zoom to 1.** Before D20 the viewer remounted on each page, which reset
   it; kept mounted, it would have carried page 1's zoom and scroll onto page 2.
5. **The reset button returns to the clamped fit**, and is disabled only at that exact state. Fitting
   the width, zoom 1 scrolled down is not "reset", and a page shorter than its frame is centred.
6. **Ctrl + wheel zooms in proportion to the delta**, capped at one 1.5× step per event. A trackpad
   pinch sends many small Ctrl + wheel events, and a fixed 1.5× per event would jump. The phone's
   `fit="page"` wheel is unchanged.
7. **The wide home page demotes the camera picker too** when the tray has items, not only the file
   picker. It matters only on a touchscreen laptop, where Upload would otherwise sit between two
   filled buttons.
8. **The merge dialog's pick step shows the period only when read**, under the file name. The plan's
   literal replacement would have printed the file name twice for a payslip without a period.
9. **The `lg` page rail follows `--source-height`** instead of `65dvh`, so it matches the frame
   beside it. It is a one-class change that D12 made necessary.
10. **`HomePage.test.tsx`'s `matchMedia` stub now answers per query.** It returned the pointer value
    for every query, so a touch device would also have read as wide.
11. **PRD §11.4's "≤3 s to the interactive review screen (skeleton state)"** is now "to the review
    route (a loading screen until the first payslip is read)". Raised in priming: D8 replaces the
    skeleton the target described.
12. **The Bash tool failed to parse a long heredoc** once, as in Task 13. The edits ran as
    scratchpad Python scripts instead.

## D18 sources, and a finding against the phone budget

- **Desktop budget, 33,554,432 px:** confirmed against the installed `pdfjs-dist` 6
  (`node_modules/pdfjs-dist/legacy/web/pdf_viewer.mjs:9691-9692`, `maxCanvasPixels: 2 ** 25`).
- **Phone budget, 16,777,216 px (WebKit's canvas area limit):** not verified from a primary source.
  The web fetch was unavailable in this session.
- **Against it:** the same pdf.js file sets `maxCanvasPixels` to **5,242,880** on iOS and Android
  (`pdf_viewer.mjs:9500-9503`). The phone budget as built is more than three times pdf.js's own
  mobile cap. During a redraw, the visible and the off-screen canvases coexist, which is up to
  about 134 MB of bitmap at 16.7 MP each.
- **Not changed, for the product owner to decide.** At pdf.js's cap, a phone's fit render (at DPR 3,
  a 343 px column is 2,572 px wide, about 9.4 MP) would fall below today's sharpness. Today's
  2,600 px cap never exceeded it on the devices tested. Options:
  - keep 16.7 MP and watch for a blank page at 800% on the Android phone;
  - use about 9.5 MP (today's fit area) as the phone budget;
  - use pdf.js's 5.2 MP.
  **Open item 1.**

## Downscale probe (step 16, $0)

Pillow 12.1 at JPEG quality 82 stands in for the browser's `canvas.toBlob` at 0.82. It is a proxy,
so the review session reads the real upload size from the network panel. EXIF orientation is
applied before measuring, as the browser does. Upload times assume 10 Mbit/s. The scratchpad copies
were deleted afterwards.

| Photo | Displayed size | Bytes | Old rule | Old bytes | New rule | New bytes | Old upload | New upload |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A02.jpg | 1220×2712 | 519 KB | 720×1600 | 130 KB | kept | 519 KB | 0.11 s | 0.43 s |
| A02-exif6.jpg | 880×1956 | 218 KB | kept | 218 KB | kept | 218 KB | 0.18 s | 0.18 s |
| A04.jpg | 1080×2400 | 616 KB | 720×1600 | 181 KB | kept | 616 KB | 0.15 s | 0.51 s |
| B02.jpg | 3024×4032 | 3501 KB | 1200×1600 | 340 KB | 2250×3000 | 1063 KB | 0.28 s | 0.87 s |
| F01.jpg | 1080×2400 | 386 KB | 720×1600 | 118 KB | kept | 386 KB | 0.10 s | 0.32 s |
| G01.png | 1290×2796 | 461 KB | 738×1600 | 210 KB | kept | 461 KB | 0.17 s | 0.38 s |

- **Correction to plan 14's problem statement 3:** the old rule re-encoded **five** of the six golden
  photos, not two. A04, F01 and G01 are 2.6–3.6 MP, over the old 2 MP threshold.
- Under the new rule only B02 is resized, and every other photo uploads as its original bytes, which
  is what accuracy was measured on.
- The worst case adds about 0.6 s per photo at 10 Mbit/s. That is about 6 s for a full ten-photo
  batch, of which only the first photo delays navigation (Task 07's first-`201` hand-off).

## D5: the full read of `hr.json`

Read in full after the edits: every section, including `warnings`, `failureReason`, `upload`,
`auth` and `history`. Every imperative uses the "vi" form. The remaining non-imperatives are
correct as they are: nouns (`Skeniranje`, `Spremanje…`, `Potvrđivanje…`, `Slanje u tijeku…`), the
infinitive question `Obrisati platnu listu?`, and `Ne sada`. No informal form was found beyond the
D5 table.

## Validation

| Check | Result |
| --- | --- |
| Step 1 starting state | Clean apart from the untracked plan 14; last commit `fbdcf4e` |
| Baseline `npm run validate` | 72 files / **1091 tests**, green |
| Red-first (steps 3–5) | `downscale` 5 failed; `sourceZoom` 10 failed of 21; `pdfRender` 8 failed of 13; each green after its change |
| D20 bite-check | `PdfSource.test.tsx` **fails against the pre-Task 14 `PdfSource.tsx`** (stashed) and passes after |
| Stale keys | `tsc --build` flagged every removed key at its call site (the i18n type augmentation), and each was removed |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **74 files / 1146 tests** (+2 files, +55 tests) |
| `npm run build` | Pass. Vite prints its >500 kB chunk warning; not compared with the previous build |
| `npm run check:secrets` | ok: `.env.example` names only; 5 bundle files free of 7 markers and 4 server secret values |
| `git grep react-router-dom client/src` | none |
| `git grep` the four removed keys in `client/src` | none |
| `git diff --check` | Clean |
| `package-lock.json` | Unchanged |
| `npm run test:integration` (hosted, $0) | **Not run.** The session's command permission check returned no verdict on every attempt. No API, shared or migration file changed, so it is a regression check only; the review session's `/validate` Phase 8 runs it |

## Open items

1. **The D18 phone pixel budget** against pdf.js's 5,242,880 px mobile cap (section above). This
   needs the product owner's decision, and the Android check should zoom a PDF to 800% and watch
   for a blank page.
2. **D20 and D21 fix causes inferred from code.** Both are unconfirmed until the review session
   reproduces the jump in Chromium and the product owner checks the jump and the wobble on the
   Android phone. If either cause is wrong, this file must say so rather than claim a fix.
3. **Pinch with `touch-action: pan-y` at fit.** If the first finger starts a vertical scroll before
   the second lands, the browser owns the gesture and sends `pointercancel`, so no pinch happens.
   This needs the phone check.
4. **The desktop wheel scrolls the document first.** With the sticky 1:1 aside, a wheel anywhere
   over the right half moves the document until its edge, and only then the page. This is by
   design (D17); the review session should judge whether it reads as natural.
5. **`--source-height: calc(100dvh - 15rem)`** is the plan's estimate. Tune it at 1366×768 and
   1920×1080 in journey 9.13 step 3.
6. **A stale `?payslip=` with nothing openable** shows the page without a panel instead of the
   loading screen (deviation 1). It is rare, and resolves itself once something is openable.

## Review-session handoff

1. `/code-review` against `fbdcf4e` (the Task 13 docs commit). Run `npm run test:integration`,
   which this session could not.
2. `/validate`, including journey **9.13** (≤ 2 paid analyses, about $0.10), and the updated
   9.5–9.12 assertions where they are run.
3. Decide open item 1.
4. Commit, subtree-push to `payslip-github`, and let CI deploy.
5. The product owner's Android check on the deployed app: the D20 jump, the D21 wobble, D19 pinch
   with the popover at a normal size, and a PDF at 800% (open item 1).
6. Then the Task 13 device sitting (history/13), which plan 14 D1 deferred until after this task.

## Review session (2026-09-28)

`/code-review` against `fbdcf4e` (the Standards and Spec reviews ran in parallel), then `/validate`
including journey 9.13. **Paid: 2 two-pass analyses (B02.jpg, A03.pdf), about $0.10.** Everything
else was seeded at $0 (below).

### Findings and what was done

| # | Finding | Axis | Action |
| --- | --- | --- | --- |
| 1 | `PdfCanvas` freed its off-screen buffer only when a render completed. A render cancelled by a newer settle (a pinch settling several times) kept a full-budget bitmap until garbage collection | Standards | **Fixed**: the buffer is zeroed in a `finally` |
| 2 | `XL` in `useWideLayout.ts` had no importer left, and its comment still described Task 10's `xl` layout (plan D10: "Delete `XL` … if nothing else imports it") | both | **Fixed**: removed, comment rewritten |
| 3 | Open item 1, the phone pixel budget: measured in the browser, a pinch to 550% on a phone drew a **16.0 MP** bitmap, and a redraw holds two canvases | review | **Fixed** (the product owner asked the review session to resolve open concerns): `PHONE_PIXEL_BUDGET` is now 9,560,000 px, an A4 page 2,600 px wide. That is the largest bitmap the pre-Task 14 viewer drew (`MAX_CANVAS_WIDTH`), which the product owner's Android phone already rendered. A phone's fit render stays under it, so it is unchanged. New test in `pdfRender.test.ts`, red first (3,443 px wide against 2,600). Re-measured: 2,599 px at 550% |
| 4 | `/history` 404s with no redirect | Standards | Not changed: plan D2 records it as the product owner's decision |
| 5 | Judgement calls not taken: `historyStatus` named after the old screen; `useWideLayout` living in `history/`; `var(--source-height, 65svh)` repeated, and `PageNavigator`'s fallback still `65dvh` (never used, since the aside always sets the variable); the screen-height `calc` copied into the loading screen; `period()` called twice in `MergeDialog`; `position()` in `MergeSuggestions` used only as an existence check | Standards | Left as they are |
| 6 | After a pinch, the remaining finger does not pan until it is lifted and put back; the page strip still shows a bare spinner while a new page is measured | Spec | Left for the phone check; neither is in plan 14 |

### Validation

| Phase | Result |
| --- | --- |
| 0–5 | `npm install` clean; typecheck, oxlint, Prettier; **74 files / 1,146 tests**, then **1,147** after the fixes; build |
| 6 | `check:secrets` ok; every static check passes (PowerShell mangles the quoted `node -e` checks 6.22, 6.24, 6.26 and the 6.25 `git grep`; run under bash they pass) |
| 7 | `check:golden` pass; `score -- cu` 281/284 (98.9%); `score:extraction` exit 0, figures as recorded (two-pass-sequential 271/273); both analyzers match the code |
| 8 | `npm run test:integration` on the hosted project: 3 + 62 + 4 tests, green (the implementing session could not run it). Orphan query: only the plan 13 D12 kept account (`task04-07e9fb84…`), which stays |
| 9.2–9.4 | Health through the proxy, `404 not_found`, `401 unauthorized` on both prefixes |

**Seeding at $0.** A throwaway account's payslips were built from `.bakeoff/two-pass-sequential/`
recordings through the production `mapAnalyzeResult`, with the real source files in Storage and the
service key writing the rows as `complete_extraction_pass` would. Outlines, pages and zoom then
behave exactly as after a real extraction.

### Journey 9.13

| Step | Result |
| --- | --- |
| 1 Home | `hr` at 375 px (touch): heading, guidance, Skenirajte platnu listu (56 px), Odaberite datoteke (48 px), Kako funkcionira with step 1 "Snimite platne liste ili odaberite datoteke."; no overflow. At 1440 px with two files: tray, "Pošaljite 2 platne liste", then the white file picker; step 1 "Odaberite datoteke." No informal form seen |
| 2 Upload (paid) | Loading screen from 3.8 s to 20.8 s; B02 opened by URL replacement; A03's chip `aria-disabled` "Očitavanje u tijeku" until ready at 39 s. B02.jpg stored at **994,385 bytes** (tray: 0,9 MB, disk 3.4 MB). Scalars 14.9 s / 30.6 s, tables 11.8 s / 18.9 s. **The first `201` took 3,506 ms**, below |
| 3 Layout | Back link 48 px to `/payslips`, plural heading, rail on top, 1:1. The sticky aside fits once stuck (1366×768: top 80, height 670). PDF page CSS width: **1366: 422 px (A01, with its page rail) / 502 px (A03, one page); 1920: 699 / 779 px**, against D12's ~520–600 and ~800, and ~350–390 before. The sidebar stays at top 64 while the page scrolls |
| 4 Sharpness | A01 at 506%: the bitmap grew 1055 → 1424 → 2136 px (= its CSS width at DPR 1) on the same canvas, **0 blank frames in 343 sampled**; text crisp. A02.jpg at 338% is as sharp as its 1220 px source |
| 5 D20 | **Reproduced on the deployed pre-Task 14 app**, same account, 375 px with touch: Next moved `scrollY` 669 → 157 and the pager from y 310 to 822. **Task 14: `scrollY` 653 throughout.** `lg` page rail: 900 throughout |
| 6 Pinch (CDP touch) | 100% → 550% about the midpoint, a moving midpoint pans, `visualViewport.scale` 1, no popover on lift. At fit (`pan-y`), a one-finger drag over the document scrolls the page (412 → 616) |
| 7 Wheel at `lg` | A plain wheel pans the document to its edge (69 px), then the page scrolls; Ctrl + wheel 100 → 150%; zoom-out stops at 88% centred with Zoom out disabled; Fit to view returns to 100% at the top and disables itself |
| 8 Copy | Singular/plural heading; no "Scan more"; Save/Confirm static after the last table, above the phone's bottom navigation; "Your payslips" / "Vaše platne liste", statuses Processing/Needs review/Confirmed/Failed and U obradi/Za pregled/Potvrđena/Neuspješna; delete dialog "E01.pdf will be deleted. You cannot undo this." / "Platna lista E01.pdf bit će obrisana. Ovu radnju ne možete poništiti."; merge banner and pick step name files |
| Also | 9.9: arrows and End move focus without selecting, Enter selects and updates the URL, focus ring 2 px; Tab goes rail → panel → form. The 64 px strip on field focus still works with the new viewer, and hides the bottom navigation |
| 9 Clean-up | Throwaway account and its 11 sources deleted; the storage timing objects removed |

### The review route now misses ≤3 s (accepted)

The first `201` took 3,506 ms against Task 07's 2,270. Measured rather than assumed: the API's
Storage upload of B02 took **1.0–1.3 s at the old size (348 KB) and 2.55–2.64 s at the new size
(1,089 KB)**, three rounds each on this machine. D22 therefore adds about 1.5 s at ~4 Mbit/s, and
any 12 MP camera photo is affected, not only B02. The loading screen is not the cause. **The product
owner chose to keep 3,000 px and record the miss (2026-09-28)**: PRD §11.4 and ROADMAP §5 say so.

### Open items after review

1. **D21 (the wobble)** and the phone half of D19 and D20 are for the product owner's Android check
   after the deploy; Chromium has no dynamic toolbar.
2. Open item 1 is closed (finding 3). Open item 2's D20 cause is **confirmed** by the reproduction
   above. Open items 3–6 stand; items 4 and 5 read as natural at 1366 and 1920, and
   `--source-height` needs no change.
3. ~~Commit and subtree push wait for the product owner's go-ahead.~~ Done, see below.

### Commit and deploy

Committed as `37e3d8e` on the product owner's go-ahead ("at the first sweep it looks fine; changes
go to a future iteration"), subtree-pushed to `payslip-github` (`70251f6..526402c`). CI passed and
Render deployed: the live client's title reads "Payslip Scanner", `/api/health` answers, and
`check:secrets -- --url` on the live bundle is ok (6 files; a referenced `/assets/qcms_bg.js`
answers 404 and is skipped with a note).

Next: the product owner's Android check (D19–D21 on the deployed app), then the Task 13 device
sitting.
