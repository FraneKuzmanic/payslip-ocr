# 08 — Source regions & document preview with highlighting

**Date:** 2026-09-25
**Plan:** [`plans/08-source-regions-preview.md`](../plans/08-source-regions-preview.md)
**Outcome:** every extracted value can be pointed at on its document.

- `GET /api/payslips/:id/regions` projects outlines from the retained responses. Nothing is stored
  and nothing migrates, so every payslip already analysed gets regions.
- The session page gains **Show document** on each readable payslip. It opens that payslip's source
  (image or PDF) with every value outlined in its section's colour.
- Tapping an outline opens a read-only card with the label, the stored value and any attention
  note.

**Status: implemented, reviewed and validated; M1 spot-check pending.** The implementing session
did not run `/code-review`, `/validate` or any browser journey, and did not commit (D14). It spent
**$0.053** on the D11 measurement. The review session is recorded at the end of this file.

## What was built

| File | Contents |
| --- | --- |
| `api/.../content-understanding/fields.ts` | `SCALAR_FIELDS`, `TABLE_COLUMNS`, derived from the parser records so the mapper and the projection cannot disagree (D6) |
| `api/.../content-understanding/regions.ts` | `projectSourceRegions`: narrow zod views, `D(page,…)` parsing per segment, division by each body's own page size, clamp, dedup |
| `api/.../content-understanding/regions.fixture.ts` | `regionsPassBody`, `sourced`, `rows`, typed as `Json`, shared by the unit and hosted tests |
| `api/.../content-understanding/index.ts` | re-exports `projectSourceRegions` for the route |
| `api/src/repositories/payslips.ts` | `findRegionSource`: the only read of `raw_provider_result`, withheld outside `review`/`confirmed` (D7) |
| `api/src/routes/payslips.ts` | `GET /:id/regions` |
| `client/src/api/client.ts` | `getPayslipDetail`, `getPayslipRegions` |
| `client/src/review/regionSections.ts` | rewritten: seven sections, colours (D4), `fieldLabel()` returning a typed key, section and 1-based row |
| `client/src/review/RegionPopover.tsx` | cell labels, ungroundable and unreadable notes, optional Edit (D2), 48 px (D12) |
| `client/src/review/ZoomableSourceViewport.tsx` | optional `onSelect`, the two signal lists, `outlinesWithheld` and its note (D10), 48 px zoom buttons |
| `client/src/review/SourceDocumentPanel.tsx` | props threaded; the image ratio as pending/agrees/disagrees (D10); the HEIC notice; the retry loop fix; `showTitle`; 48 px links |
| `client/src/review/PdfSource.tsx` | props threaded; `outlinesWithheld` once measured; 48 px pager |
| `client/src/review/PayslipPreview.tsx` | loads detail and regions, keeps them through a refetch, mounts the panel in popover mode; `fieldValuesOf` |
| `client/src/routes/SessionPage.tsx` | `?payslip=` selection, the Show/Hide document disclosure, the preview section, `lg` grid (D1) |
| `client/src/i18n/locales/*.json` | receipt labels deleted; `review.fields` (25), `columns` (11), `sections` (7), `cellLabel`, `inspectUnreadable`, `ungroundable`, `highlightsWithheld`, `imageUnavailable`; `session.showDocument`/`hideDocument` |
| `PRD.md` | §7.5 rules and the rotation finding; §10.10 empty outside review/confirmed, scalars only while pending; §12 Phase 3 status |
| `CONTEXT.md` | *Source Region*: one per printed line |
| `.agents/ROADMAP.md` | §2 row; §3 Task 08 additions and DoD; §4 M1 note |
| `.claude/commands/validate.md` | Phase 4 rows; 6.23; Phase 8 regions cases; journey 9.7; Phase 10 row 08 removed (git-ignored) |

New tests:

- `regions.test.ts` (19: 16 unit, plus 3 that run over the recordings locally);
- `regionSections.test.ts`, rewritten (15);
- `fieldLabels.test.ts` (4);
- `PayslipPreview.test.tsx` (4);
- `SourceDocumentPanel.test.tsx` (4).

Extended tests:

- `RegionPopover.test.tsx`, rewritten for payslip paths (9);
- `SessionPage.test.tsx` (+8);
- `client.test.ts` (+2);
- `payslips.test.ts` (+5);
- the hosted `payslips.integration.ts` (+5, plus `/regions` in the cross-user 404 list and the
  soft-delete case).

## Decisions

D1–D14 as the plan states them. Three more were settled with the product owner at the start of
execution, from concerns raised at priming:

- **HEIC preview.** Chromium cannot decode the HEIC that Task 07 uploads as original bytes. When an
  image still fails after one fresh URL, the panel shows `review.imageUnavailable` beside the
  existing open-in-new-tab link instead of a broken image.
- **One heading.** The preview section's `h2` names the payslip ("Payslip 2 · A01.pdf", from
  `session.position` and the filename; no new copy) and takes focus. The panel's own "Original
  payslip" heading is omitted in this mount (`showTitle={false}`). `review.previewTitle` was not
  added.
- **180°.** Documented only, as D11 says; no heuristic.

## Rotation measurement (D11, step 2)

The fixtures are git-ignored in `payslip_examples/`:

- `A02-exif6.jpg`: A02 resized to 880 × 1956 (1.72 MP), pixels stored rotated (1956 × 880) with
  EXIF orientation 6, 224 KB;
- `A03-rotate90.pdf`: A03 with `setRotation(degrees(90))` through pdf-lib.

Each went through the scalars pass once, via `.bakeoff/orientation/measure.ts`.

| Fixture | Service page | Unit | `angle` | Declared ratio | Browser ratio | `employeeName` quad vs upright | Verdict | Cost |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `A02-exif6.jpg` | 880 × 1956 | pixel | 0 | 0.450 | 0.450 (EXIF applied) | (0.110, 0.134) vs (0.111, 0.134): same | **correct** | $0.0325 |
| `A03-rotate90.pdf` | 11.6944 × 8.2639 | inch | 90 | 1.415 | 1.414 (pdf.js applies `/Rotate`) | (0.851, 0.111) vs upright (0.110, 0.150) → displayed (1−y, x) = (0.850, 0.110): same | **correct** | $0.0209 |

- **The service applies both rotations** before reporting page sizes and quads, so both arrive in
  displayed space. Neither case is withheld; neither is misplaced.
- For the rotated PDF, the quad's first corner is the displayed top-right rather than top-left. The
  polygon draws the same shape, so this changes nothing.
- **180° (EXIF 3), not measured:** since EXIF 6 is honoured, 180° is presumed honoured too, and
  would be outlined correctly. If the service ever stopped applying rotation, a 180° photo is the
  one case the aspect-ratio guard cannot catch. Phone photos over 2 MP never reach the service with
  their tag, because `downscale.ts` redraws them upright.

## Recordings coverage (step 6)

Two-pass sets are fed as stored (`{ scalars, tables }`); `cu` is single-pass, fed as
`{ scalars: body, tables: body }`.

| Set | Samples | Sourced paths | Outlined | Regions | Paths on several lines | Non-null scalars | Scalar coverage |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `two-pass-sequential` | 11 | 701 | 701 | 722 | 22 | 254 | 100% |
| `two-pass-concurrent` | 11 | 704 | 704 | 721 | 26 | 255 | 100% |
| `cu` | 11 | 705 | 705 | 722 | 25 | 255 | 100% |

## Deviations from the plan

1. **The image retry looped forever, and is fixed.** `SourceDocumentPanel.load()` reset
   `retriedImage` after every fetch, so an image the browser can never decode fetched a new signed
   URL on every error, indefinitely. The flag now resets only when the payslip changes. This was
   found while building the HEIC notice, which depends on the retry ending.
2. **`regions.fixture.ts` is typed as `Json`.** `completeExtractionPass` takes a `Json` raw, and a
   `readonly` array or `Record<string, unknown>` does not satisfy it.
3. **The hosted regions describe inserts its own `processing` row.** `processingPayslip` is scoped
   to the extraction-passes describe.
4. **The page widens to `lg:max-w-6xl` only while a preview is open.** Otherwise the list keeps
   Task 07's `max-w-xl`, rather than one list spanning a desktop screen.
5. **A failed refetch keeps the preview in place.** An error replaces it only on a first load, when
   there is nothing to keep. Replacing it would unmount the panel, the thing D7 avoids.
6. **`fieldLabel` uses `Object.hasOwn`, not `in`.** `in` would have labelled `toString` and
   `obustave.0.constructor` as fields. A test covers it.
7. **`SECTION_LABEL_KEYS` is exported** for the popover and the label guard test. It is a typed
   literal map, so section keys stay compile-checked.
8. **The measurement script imports `provider.ts`, which imports `logger.ts` and so `config.ts`.**
   With the full `.env` that loads fine; the plan's worry about the Supabase variables did not bite.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` (baseline) | green, 46 files, 683 tests |
| `npm run validate` (final) | green: typecheck, oxlint, Prettier, **50 files, 741 tests** |
| `regions.test.ts` recordings block | ran locally (not skipped), 3/3 sets |
| `npm run build` | green; the known Vite chunk-size advisory |
| `npm run test:integration` | hosted: 3/3 auth + **38/38** payslips (33 before) |
| Orphans (`execute_sql`) | 0 `task0%` users; 0 payslips, sessions or Storage objects without an owner |
| Lockfile | `git diff --stat package-lock.json` empty: no new dependency |
| `grep react-router-dom client/src` | empty |
| Vocabulary grep outside the module | only `provider-vocabulary.test.ts` |
| 6.23 (raw column read once) | ok |

Not run in this session, by the session split (D14):

- `/code-review`;
- `/validate`;
- any browser journey, including 9.7;
- the M1 corpus upload;
- `npm run test:extraction`, which is paid.

## Paid Azure runs

| Run | Documents | Cost |
| --- | --- | --- |
| D11 rotation measurement, scalars pass only | 2 | **$0.0534** |

Costed with `estimateUsageCost`, under the plan's $0.10 cap.

## Open items for later tasks

1. **`ErrorMessage`'s retry button is 44 px** (`min-h-11`), and the preview's first-load error
   shows it. D12 limited the 48 px change to the listed controls, so it was left. The next task to
   touch `ErrorMessage` should raise it.
2. **`aria-controls="payslip-preview"` names an element that exists only while open.** This is
   common for a disclosure whose content mounts on demand, and screen readers tolerate it. Task 10's
   chip rail replaces the button.
3. **`PdfSource`'s comment about the panel being mounted twice** describes receipt-ocr's review
   page. The session page mounts it once. The comment was left, since the `IntersectionObserver`
   deferral it explains is still correct.
4. **Retroactivity:** the plan asks the review session to open a payslip analysed before this task
   to confirm the projection applies to it with no backfill.

## Handoff to the review session

1. Browser journey **9.7** in `validate.md` (5 documents, about $0.25), including the two rotation
   fixtures and the HEIC notice.
2. Upload and **keep** the M1 corpus: all 11 golden documents in two sessions (the cap is 10),
   about $0.55. Leave the data for the product owner's M1 spot-check (D13).
3. The product owner reads the D9 copy (plan step 13), plus `review.imageUnavailable`:
   - en: "This browser cannot show this image. Open it in a new tab or view it on another device."
   - hr: "Ovaj preglednik ne može prikazati ovu sliku. Otvorite je u novoj kartici ili na drugom
     uređaju."
4. Then `/code-review` and `/validate`. Committing waits for the product owner's go-ahead.

## Review session (2026-09-25)

Run in a separate session, as the project's session split requires: `/code-review` (standards and
spec, as two parallel reviewers), then fixes, then `/validate` including the paid journey 9.7,
which doubled as the M1 upload.

### Findings and what was done

| # | Finding | Axis | Outcome |
| --- | --- | --- | --- |
| 1 | Inactive outlines drew at `strokeOpacity 0.55`. In Task 08 every outline is inactive, and at 0.55 the seven section colours fall to **2.2–2.7:1** against white, under D4's 3:1. The palette test checked the colours, not what is drawn | standards | **Fixed**: inactive outlines at full opacity; the active one is still told apart by its 2.5 px stroke and fill. Test added in `SourceOverlay.test.tsx` |
| 2 | A failed refetch after `tablesStatus` changed was logged to the console only. The session poll has stopped by then, so the table outlines could stay missing with nothing to say so and nothing to retry | spec | **Fixed**: the preview stays mounted and shows `review.errors.refresh` with a retry above it. New en/hr copy, for the product owner to read. Test added |
| 3 | Found in the browser: the focused preview heading was scrolled under the 64 px sticky header (top 0–24 px), so the focus target was hidden (WCAG 2.4.11) | journey 9.7 | **Fixed**: `scroll-mt-20` on the heading; measured at 80 px after the fix |
| 4 | `ErrorMessage`'s retry button was 44 px (open item 1), and the preview now shows it in two places | standards | **Fixed**: `min-h-12`, per the product owner's rule that the next task to show an inherited control raises it |
| 5 | `raw === null` in `projectSourceRegions` duplicated what `storedSchema` already rejects | standards (smell) | **Fixed**: removed |
| 6 | The en field labels ("Gross pay", "Net pay", "Taxable base", …) use terms CONTEXT.md lists under *Avoid*; "Highlights" and "Show document" likewise | standards | **Kept**: D9 records the product owner's decision that the *Avoid* lists govern identifiers and prose, not en UI copy. The copy is in the product owner's reading list below |
| 7 | The region polygons are `aria-hidden` and not keyboard-reachable, and their hit box is the printed line rather than 48 px | standards | **Left for Task 09**: inherited, and Task 09's field → region linking is the keyboard path to every region |
| 8 | The popover does not close on Escape, and opening it leaves focus on the body | journey 9.7 | **Left for Task 09**: inherited; the component deliberately takes no focus (receipt-ocr's browser-found design), and Task 09 reworks this interaction when it adds Edit |
| 9 | ROADMAP ticked the rotation DoD on API evidence alone | spec | **Resolved** by running journey 9.7 below |
| 10 | One malformed entry in a pass body drops every region from that pass | spec | **Left**: this is the plan's rule ("an unparseable body contributes nothing"), and no recording triggers it |
| 11 | Smells: the table-name list in three places, two parallel scalar records in `regionSections.ts`, the four attention lists travelling through five components, `WARNED_STATUSES` naming "has a readable form", `linkClass` on a button, `sectionOf` returning `null` for an unknown column, `lg:max-w-6xl` only while open | standards / spec | **Left**: judgement calls. Task 09's form reshapes the prop flow, and D7 chose `WARNED_STATUSES` |

### Validation

| Phase | Result |
| --- | --- |
| 0 `npm install` | clean, no overrides |
| 1–3 lint, typecheck, format | oxlint exit 0, `tsc --build` exit 0, Prettier clean |
| 4 unit tests | **50 files, 743 tests** (shared 264, api 291, client 188) |
| 5 build | green; the known Vite chunk-size advisory; `pdf-*.js` reached only by `import()` |
| 6 security and configuration | all pass; 6.1 still catches a planted `VITE_…_KEY` |
| 7 golden set and harness | `check:golden` all pass; `score -- cu` **281/284 (98.9%)**; `score:extraction` exit 0, unchanged from Task 07; both analyzers match the code |
| 8 hosted integration | host `hxksulbgluvfxfoxrhse`: **3/3** auth, **38/38** payslips; no orphan users |
| 8.1 hosted schema | four migrations, matching `supabase/migrations/`; only the known `auth_leaked_password_protection` |
| 9.2–9.5 | health direct and proxied; `404 not_found`; `401` on both prefixes; sign-out, a failed sign-in in translated copy, sign-in; the not-found page; the shell at 375 px (no overflow, header controls 44 px) and at 1440 px; the account disclosure closes on Escape with focus restored |
| 9.6 | **Skipped**: Task 07's paid journey, validated in its own review; the capture code has not changed since |
| 9.7 | below, all nine steps |

After fix 3, only the checks it could affect were re-run: typecheck, oxlint, Prettier and
`SessionPage.test.tsx` (21).

### Journey 9.7 (agent-browser, Chromium, dev server)

Uploaded as the M1 corpus (D13), under `m1-review-08@example.test`, and **kept**:

- session 1: A01, A02, A03, A04, B01, B02;
- session 2: C01, D01, E01, F01, G01;
- session 3: `A02-exif6.jpg`, `A03-rotate90.pdf`, `A02.heic`.

All 14 reached "Ready to review" with line items ready. Placement was judged from 3× screenshots
cut into tiles.

1. **Native PDF** (A01 both pages, A03), **scan** (`A02-exif6.jpg`, A02's scan), **angled photo**
   (B02) and a **phone screenshot** (G01): every outline sits on its text in its section colour, and
   B02's quads follow the skew. A01's page 2 is reached by the pager and outlined there. Wrapped
   obustave names have one outline per line (D3).
2. **Rotation:** `A02-exif6.jpg` displays upright (`naturalWidth` × `naturalHeight` 880 × 1956) and
   `A03-rotate90.pdf` displays rotated; both are outlined on their text, with no withheld note. The
   service still applies both rotations.
3. **D7 live:** A02 opened while its tables were pending showed 25 scalar outlines in four section
   colours and no table outline yet.
4. **Popover:** "Description, Obustave row 2" with the section dot and the stored value; G01's
   `netoPlaca` shows "No value was read here." with the low-confidence and unreadable notes; no Edit
   button; close 48 × 48.
5. **hr ↔ en:** the popover label, pager and Show/Hide follow the language; values do not change.
6. **375 px**, en and hr: `scrollWidth` 360, and no preview or row control under 48 px. At 1440 px the
   list and preview sit side by side.
7. **`?payslip=`:** a reload reopens the preview without taking focus; Back closes it and drops the
   param.
8. **HEIC:** the "cannot show this image" notice and the link, and the requests stop. The dev server
   made three `/source` fetches rather than two: `StrictMode` runs the load effect twice on mount and
   it has no abort. That is inherited and dev-only.
9. **pdf.js failure**, forced by blocking the signed PDF URL: the `<object>` fallback and "Field
   highlighting is not available", with the rest of the page intact. Blocking the worker does not
   work in dev (`validate.md` 9.7 now says why).

A01's page 2 leaves some obustave cells unoutlined (the `POSMRTNA` row's 1,00, the `ULOG KASE` row's
name). Those are values the tables pass did not read into that row, the known obustave accuracy
(72–83% of cells), not a placement fault.

`validate.md` gained Phase 4 rows for fixes 1 and 2, and four lessons in 9.7: absolute upload paths,
the heading check, 3× tiles for judging placement, and how to force the pdf.js fallback.

### Paid Azure runs

| Run | Documents | Estimated cost |
| --- | --- | --- |
| Journey 9.7 + M1 upload, two passes each | 14 | **$0.7072** |

Estimated from each stored response's `usage` with `estimateUsageCost`. Per document: A01 $0.110
(two pages), A04 $0.064, A02.heic $0.058, D01 $0.056, A02 $0.054, A02-exif6 $0.050, B02 $0.049,
B01 $0.045, C01 $0.044, A03 $0.041, F01 $0.037, G01 $0.034, A03-rotate90 $0.034, E01 $0.031. Task 08
in all: **$0.76**.

### Left for the product owner

1. **M1:** sign in as `m1-review-08@example.test` (password given in the review session) and
   spot-check all 11 golden documents in sessions 1 and 2; record the table in this file.
2. **Copy:** plan 08 step 13's table, plus `review.imageUnavailable` (above) and
   `review.errors.refresh`:
   - en: "The highlights could not be updated, so some may be missing. Try again."
   - hr: "Oznake nije bilo moguće osvježiti pa neke možda nedostaju. Pokušajte ponovno."
3. Committing waits for the product owner's go-ahead.

## Production check by agent (2026-09-25, after commit `2e3a92f`)

Run by `agent-browser` against `payslip-ocr-client.onrender.com`, signed in as the M1 account, over
every page of all 14 documents at 3×. No upload, so no Azure cost. This is a pre-check, **not** M1:
M1 stays the product owner's own spot-check.

| Sample | Verdict | Notes |
| --- | --- | --- |
| A01 (2 pages) | pass | 121 + 60 outlines, identical to the dev run; all 23 pay components on their rows |
| A02 | pass | |
| A03 | pass | |
| A04 | pass, with a service reading gap | Row 1's obustave name was read as "…SA\nSALDA", missing "KONTROLOM", so its second-line quad covers "SALDA" only. The 20-pixel quads on this low-resolution screenshot overlap their neighbours' strokes and look crossed |
| B01 | pass | |
| B02 | pass | Quads follow the skew |
| C01 | pass | `period`'s second segment is on the day "01", not the month "6": the service's own source choice |
| D01 (2 pages) | **one misplaced outline** | `paymentDate` (2025-06-10, correct; printed "10.06.25") carries a service source on "20, 10000" inside the employer address. It is drawn there, faithfully. Confidence 0.315 puts it in `lowConfidenceFields`; grounding does not flag it, because "10.06.25" is printed on the page |
| E01 | pass | |
| F01 | pass | |
| G01 | pass | |
| `A02-exif6.jpg` | pass | |
| `A03-rotate90.pdf` | pass | |
| `A02.heic` | pass | The notice and link; **exactly two** `/source` requests in production (the dev server's third is `StrictMode`) |

Also in production: the focused preview heading at 80 px; the popover ("Amount, Obustave row 1",
200.00, no Edit) in en and hr; Back closes the preview; at 375 px in en and hr `scrollWidth` 360
with no control under 48 px in the preview or rows.

**Open, for the product owner:** D01 shows the projection cannot tell a wrong service source from a
right one. PRD §2 principle 2 says an outline that cannot be proven to sit on its own text is not
drawn. A check that the OCR words **inside** a region contain the printed value would prove it,
where grounding only checks the whole page.
