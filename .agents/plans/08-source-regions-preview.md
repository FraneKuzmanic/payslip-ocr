# Feature: Task 08 — Source regions & document preview with highlighting

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 08](../ROADMAP.md), §4 M1, §5 · **PRD:** §2 (principle
2), §6.2, §7.5, §7.7, §10.9, §10.10, §11.3, §11.5 · **Previous tasks:**
[`history/07`](../history/07-capture-multi-upload.md) (open items 1 and 6),
[`history/06`](../history/06-warnings-validation-engine.md) (grounding, D8) ·
**Glossary:** [`CONTEXT.md`](../../CONTEXT.md) (*Source Region*, *Attention signal*, *Unreadable
field*) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md) (this project has no `CLAUDE.md`) ·
**Prior art (sibling, forked from):**
`../receipt-ocr/api/src/providers/document-extraction/source-regions.ts`,
`../receipt-ocr/api/src/routes/receipts.ts` lines 294–308,
`../receipt-ocr/.agents/history/15-source-field-highlighting.md`,
`../receipt-ocr/.agents/history/22-pdf-source-field-highlighting.md`

## Feature Description

Every extracted value can now be pointed at on its document. A new read-time projection,
`GET /api/payslips/:id/regions`, turns the geometry Content Understanding already returned (and the
app already retains verbatim) into page-relative outlines. The session page gains a **Show document**
action on each readable payslip. It opens that payslip's source (image or PDF) with every extracted
value outlined in its section's colour. Tapping an outline opens a read-only card with the field's
label, its extracted value and any attention signal.

Nothing is stored and nothing migrates. The projection works on every payslip already analysed.

## User Story

As someone checking what the app read from my payslip
I want to see each extracted value outlined where it sits on the document
So that I can verify it without hunting through a dense payroll table (PRD US-03)

## Problem Statement

- The raw provider responses carry a `source` quad for **100%** of values. That is 2,856 of 2,856
  non-blank values across the four recorded sets, table cells included, measured at planning. Yet
  nothing projects them.
- The forked viewer modules (`client/src/review/*`) are ported but mounted nowhere, and
  `regionSections.ts` still speaks receipt (`seller`, `vat`, `items`).
- `review.fields` in both locales still holds receipt labels (history/07 open item 6).
- There is no screen that shows a payslip's source document.

## Solution Statement

- **API:** `projectSourceRegions(raw)` in the content-understanding module parses CU's
  `D(page,x1,y1,…,x4,y4)` strings from both stored pass bodies. It divides each by its page's own
  width and height, which gives fractions whatever the unit (inch for PDF, pixel for images). It
  emits one region per printed line segment, keyed by canonical dotted path. A repository read
  fetches `raw_provider_result` only for a payslip with a readable form. A route serves the
  projection.
- **Client:**
  - `PayslipPreview` loads the detail and the regions, and mounts the existing
    `SourceDocumentPanel` in `popover` mode.
  - The session page selects a payslip through `?payslip=<id>`, stacked on a phone and side by side
    at `lg`.
  - `regionSections.ts` is rewritten for the seven payslip sections, with hr/en labels for every
    canonical path, enforced by a guard test.
  - A translated note says so when the aspect-ratio guard withholds outlines.
- **Measurement:** one paid run of about $0.06 establishes whether the service applies EXIF
  orientation and PDF `/Rotate`. The DoD is reworded to "outlines correct, or withheld with a note,
  never misplaced".

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium–High. The API projection is small and well-evidenced. The client
touches six ported modules and the session page.
**Primary Systems Affected**:
- api: the content-understanding module (`regions.ts`, `fields.ts` exports), the repository, the
  payslips router;
- client: `review/*`, `routes/SessionPage.tsx`, `api/client.ts`, locales;
- docs: PRD, ROADMAP, CONTEXT, `validate.md`.
**Dependencies**: none new. The lockfile must not change.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-25 in the planning session. Do not reopen them without
new evidence.

### D1 — The preview lives on the session page, selected by `?payslip=` (product owner)

- `/sessions/:sessionId?payslip=<id>`, read and written with `useSearchParams` from
  `react-router`. It survives reload and the back button, and Task 10's chip rail reuses it.
- **Nothing is selected by default.** A param naming a payslip that is not in the session, or not in
  `review`/`confirmed`, is ignored: no preview and no error.
- Each row whose status is `review` or `confirmed` gets a **Show document / Prikaži dokument**
  button. It is a disclosure (`aria-expanded`, `aria-controls="payslip-preview"`), and its text
  changes to **Hide document / Sakrij dokument** while that payslip is selected, so selection is
  never shown by colour alone (PRD §11.5). Pressing it on the selected row clears the param.
- **Layout:**
  - On a phone, the preview renders **below** the list.
  - At `lg`, the list and preview sit side by side:
    `lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6`.
  - This is plain CSS, so both layouts are one DOM and nothing is duplicated in the accessibility
    tree. Do not use `useWideLayout`.
- On opening, focus moves to the preview's heading (`tabIndex={-1}`), and `scrollIntoView` brings
  it on screen. On a phone the preview can be ten rows below the button.
- Task 10 replaces the list with the chip rail and Task 09 adds the form. Build nothing for them.

### D2 — Region click opens a read-only popover (product owner)

- `interaction="popover"` on the existing `ZoomableSourceViewport`. `RegionPopover` shows:
  - the section dot;
  - the field label;
  - the value;
  - notes for low confidence, ungroundable and unreadable.
- **No Edit button** until Task 09 has an input to focus. `onEdit` and `onSelect` become optional,
  and the button renders only when a handler is passed.
- There is no `activeField` in Task 08. Pass `null`.

### D3 — One outline per printed line (product owner)

- CU returns a multi-line value as `D(…);D(…)`: about 3% of values, such as wrapped addresses and
  long `obustave` names. Each segment becomes its own region with the same `fields: [path]`.
- No segment crosses a page in any recording, but the parser handles each segment's page
  independently anyway, because the page number is in the segment.
- `SourceOverlay` already draws every region, and `findRegion` picks the first one on the page for
  panning and the popover. No client change is needed for this.

### D4 — Seven sections, exactly PRD §7.7 (product owner)

| Section id | Fields | Colour |
| --- | --- | --- |
| `employer` | `employerName`, `employerAddress`, `employerOib`, `employerIban` | `#7c3aed` |
| `employee` | `employeeName`, `employeeAddress`, `employeeOib`, `employeeIban` | `#0f766e` |
| `period` | `period`, `paymentDate`, `ukupnoSati` | `#1d4ed8` |
| `reconciliation` | `brutoPlaca` … `iznosZaIsplatu` (the chain), plus `doprinosiNaPlacu`, `ukupanTrosakRada` | `#be185d` |
| `payComponents` | `payComponents.N.*` | `#15803d` |
| `obustave` | `obustave.N.*` | `#9a3412` |
| `neoporeziviPrimici` | `neoporeziviPrimici.N.*` | `#a16207` |

- Section ids are English for structure, except where the section is a Croatian payroll concept
  (the table names), following locked decision 14.
- **Colour choice:**
  - No amber or orange-400 family: amber is the attention colour (PRD §7.7).
  - The existing `NEUTRAL_COLOUR` `#64748b` stays for an unknown path.
  - Every colour must have **≥ 3:1 contrast against white** (WCAG 1.4.11, non-text), enforced by a
    test.
- Task 09's legend dots use `SECTION_COLOURS`, so this table is the legend.

### D5 — Origin is always `model`; no re-grounding fallback (product owner)

- Every non-blank value in every recorded set carries the service's own `source`. A `text`
  fallback would be speculative (AGENTS.md §2).
- The shared enum stays `["model", "text"]`, unchanged.
- A value without a `source` gets no outline.
- `ungroundableFields` (Task 06) stays a separate attention signal. It says the printed text is
  not among the OCR words; it says nothing about where an outline came from.

### D6 — Which values get an outline

- A path gets regions when its raw value has a **non-blank `valueString` and a `source`**. This is
  exactly the mapper's `read()` condition in `fields.ts` lines 160–163.
- An **unreadable** value (printed, not normalisable, stored `null`) is therefore outlined (product
  owner). The popover says "No value was read here" plus the unreadable note.
- Paths are canonical: scalars by name, and cells as `${table}.${index}.${column}`, where `index` is
  the raw `valueArray` index. The mapper maps rows 1:1 (`fields.ts` lines 185–193), so the indices
  agree with `canonical_data`.
- Only canonical keys are projected: `SCALAR_PARSERS` and `TABLE_PARSERS` keys exported from
  `fields.ts`. A stray provider field is never outlined.

### D7 — Partial results: whatever has landed (product owner)

- `GET /regions` always answers `200` for an existing payslip, projected from whichever pass bodies
  are stored.
- While `tablesStatus` is `pending`, that means the scalars only.
- A payslip in `processing` or `failed` answers `{ pages: [], regions: [] }` (PRD §10.10: "empty
  arrays when no raw response is retained"). The repository nulls the raw for any status outside
  `WARNED_STATUSES`, the existing "has a readable form" constant.
- The client refetches the detail and regions when the session poll reports a change in
  `tablesStatus`, keyed by it in the effect's dependencies.
- `pages` comes from the scalars body, or from the tables body when the scalars body is absent,
  which a stored row cannot currently produce. Both passes OCR the same document.

### D8 — Values shown as stored (product owner)

The popover shows the canonical string (`2298.97`, `2025-06`) exactly as it will be exported.
Locale-aware display and input formatting is Task 09's form work.

### D9 — Field labels replace the receipt copy now (product owner)

- `review.fields.<scalar>` holds the 25 scalar labels. `currency` has no label: it is envelope and
  never extracted.
- `review.columns.<table>.<column>` holds the 11 cell labels.
- `review.sections.<section>` holds the 7 section names.
- `review.cellLabel` composes a cell: "{{column}}, {{section}} row {{row}}", with a 1-based row.
- The receipt keys under `review.fields` are **deleted**.
- A guard test fails if any canonical scalar or column lacks a section or a non-empty label in
  either locale.
- The copy is proposed below (step 13). **The product owner reads it in the review session**, as
  Task 07's plurals were read.

The en labels translate the Croatian terms for an English reader, as PRD US-12's "Gross pay" does.
CONTEXT.md's *Avoid* lists govern identifiers and prose, not en UI copy. Where no English word is
safe, the en label keeps the Croatian term (`Dohodak`, `Obustave`).

### D10 — Withheld outlines are explained (product owner)

- When a page has regions **and** its rendered ratio disagrees with the declared one, show
  `review.highlightsWithheld` under the viewport: "Highlights are hidden because the page's
  orientation could not be confirmed."
- The image path must distinguish **pending** (not loaded yet) from **disagrees**, so the note
  never flashes during load. `ImageSource`'s `overlaySafe: boolean` becomes
  `ratio: "pending" | "agrees" | "disagrees"`.
- The PDF path already knows: it computes `overlaySafe` only after `pageViewport` is measured.
- The existing `review.highlightsUnavailablePdf` stays for the pdf.js failure fallback. That is a
  different case.

### D11 — Rotation is measured, and the DoD is reworded (product owner)

- Nobody knows whether Content Understanding applies EXIF orientation or PDF `/Rotate` before
  reporting page size and quads.
- The browser applies both: `<img>` honours EXIF (`image-orientation: from-image`, the default)
  and `naturalWidth`/`naturalHeight` report the oriented size; pdf.js applies `/Rotate` to its
  viewport.
- **Outcomes by case:**

  | Case | Outcome |
  | --- | --- |
  | The service applies the rotation | Ratios agree and quads are in displayed space, so outlines are correct |
  | The service ignores it | For 90°/270° the ratio flips and the guard withholds, with D10's note |
  | 180° | Cannot be told apart by ratio; misplaced only if the service ignores rotation |

- Every sample photo is over 2 MP, so `downscale.ts` redraws it through canvas. That bakes the
  EXIF rotation into the pixels and drops the tag. **Only an image under 2 MP and 1.5 MB reaches
  the service with its EXIF intact.** The fixture must be one (step 2).
- **Measured in the implementing session:**
  - `A02-exif6.jpg`: A02 resized under 2 MP, pixels stored rotated, with EXIF orientation 6 so it
    displays upright.
  - `A03-rotate90.pdf`: single page, `/Rotate 90`.
  - Scalars pass only, about $0.06 in total.
  - EXIF 3 is **not** measured (product owner). If EXIF 6 is honoured, 180° is too; if not, 180°
    is recorded as a known undetectable case.
- **DoD reworded:** "An EXIF-rotated image and a `/Rotate 90` PDF show their outlines on the text,
  or withhold them with a note; never misplaced. The 180° limit is documented."

### D12 — Hit boxes to 48 px in the modules this task touches

Task 07's review recorded the product owner's decision: inherited 44 px controls are raised to
PRD §11.5's 48 px by whichever task next touches them. This task touches:

- `ZoomButton` and `PagerButton` (`size-11` → `size-12`);
- `RegionPopover`'s close button (`size-11` → `size-12`) and Edit button (`min-h-11` →
  `min-h-12`);
- `SourceDocumentPanel`'s "Open in a new tab" links (`min-h-11` → `min-h-12`).

No other 44 px control changes.

### D13 — Paid runs

- **Implementing session:** the D11 measurement only, 2 documents on the scalars pass, about
  **$0.06**, costed with `estimateUsageCost` and logged in the history file.
- **Review session:** M1 needs all 11 golden documents uploaded through the app, about $0.55,
  plus the two rotation fixtures through the browser, about $0.13. Total about **$0.70**.
- The review session keeps that test user's data for the product owner's M1 spot-check rather
  than deleting it (product owner). The cap is 10, so it needs two sessions.

### D14 — Session split

This implementing session does **not**:

- run `/code-review`, `/validate` or any browser journey;
- upload the M1 corpus;
- commit.

It runs the unit tests, typecheck, lint, build, the hosted integration suite and the D11 paid
measurement, records them in `history/08-*.md`, and stops.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**API**

- `api/src/providers/document-extraction/content-understanding/fields.ts`: the whole file (203
  lines). The parser records are what `regions.ts` iterates. The zod narrow-view style (lines
  75–112) is the pattern for the regions schema. `read()` (lines 160–172) is the "has a value"
  rule D6 mirrors.
- `api/src/providers/document-extraction/content-understanding/grounding.ts`: module-comment
  style. Its header already says "regions come from the service's own `source` (Task 08)".
- `api/src/providers/document-extraction/content-understanding/index.ts`: the module's public
  export point.
- `api/src/provider-vocabulary.test.ts`: the guard. `polygon`, `valuestring`, `valuearray`,
  `valueobject` and `analyzer` are **forbidden outside** `providers/document-extraction/content-understanding/`.
  The route, repository and integration test must not contain those words, not even in comments.
  Name things "source", "region" and "quad" outside the module.
- `api/src/providers/document-extraction/content-understanding/fields.test.ts` lines 1–48 and
  233–285: the operation-body helpers and the `describe.skipIf(!existsSync(recordingsDir))`
  recordings pattern (`.bakeoff/` is git-ignored, absent in CI).
- `api/src/repositories/payslips.ts`:
  - lines 24–37: `PayslipReadRow` and `PAYSLIP_COLUMNS`. `raw_provider_result` is deliberately
    excluded. "Only a source-region projection reads the raw column" is this task.
  - `WARNED_STATUSES`.
  - `findSourceById` (lines 189–206): the focused-read pattern to mirror.
- `api/src/repositories/payslips.test.ts` lines 192–230 and 318–327: `singleRow` fake-client chain
  and `payslipRow()`.
- `api/src/routes/payslips.ts`: the whole file. Mirror the `/:id/source` route (lines 46–65).
- `api/src/routes/payslips.integration.ts`:
  - lines 325–405: `processingPayslip`, `completeExtractionPass` usage;
  - lines 269–297: the cross-user 404 list;
  - lines 675–695: soft delete;
  - lines 699–720: helpers.
- `../receipt-ocr/api/src/providers/document-extraction/source-regions.ts`: prior art for
  `addCorners` (clamp, divide by page dims), `deduplicate` (identical quads merge their `fields`)
  and `pageDimensions`. **Port those three ideas. Nothing else in it applies:** DI polygons, text
  regions and a secondary model.
- `shared/src/api.ts` lines 51–72: `sourceRegionSchema` and `sourceRegionsResponseSchema`, used
  as-is. Lines 128–148: `payslipDetailResponseSchema`.
- `shared/src/payslip.ts` lines 19–54 (the table row schemas, whose `.shape` keys are the columns)
  and lines 65–117 (`canonicalPayslipFieldsSchema`).

**Client**

- `client/src/review/SourceDocumentPanel.tsx`: the whole file. The mount point. `ImageSource` gets
  D10's tri-state.
- `client/src/review/PdfSource.tsx`: the whole file. `overlaySafe` at lines 133–135, the pager at
  204–260, and `pageForField` auto-jump at lines 120–122 (a no-op while `activeField` is `null`).
- `client/src/review/ZoomableSourceViewport.tsx`: the whole file. **Read the comments before
  changing anything.** The deferred pointer capture, the non-passive wheel listener, click
  suppression and the `width: min(100%, 65dvh * ratio)` sizing are each a browser-found bug fix
  (receipt-ocr history 15, 16 and 22). Change only props and plumbing.
- `client/src/review/SourceOverlay.tsx`, `RegionPopover.tsx` and `regionSections.ts`, with their
  tests.
- `client/src/review/pdfRender.ts` lines 38–51: `pageForField`.
- `client/src/routes/SessionPage.tsx`: the whole file. `Row` (line 280), the `<ol>` (line 189)
  and the poll (lines 57–95).
- `client/src/routes/SessionPage.test.tsx` lines 1–60: the api-client and upload-batch mocks and
  `summary()`.
- `client/src/api/client.ts` lines 109–160: `request` and `parseResponse` usage.
- `client/src/i18n/statusCopy.test.ts`: the guard-test pattern for D9.
- `client/src/i18n/index.ts` lines 14–17: typed keys. A dynamic key must be typed.
- `client/src/capture/downscale.ts`: why an EXIF fixture must stay under 2 MP (D11).
- `.claude/commands/validate.md`:
  - lines 544–600: journey 9.6's format, the Phase 10 table (row 08) and "Maintaining this file";
  - Phase 4: the table where rows for new tests go;
  - Phase 8: the hosted integration cases.

**Evidence**

- `.bakeoff/two-pass-sequential/*.json` and `two-pass-concurrent/*.json`: two-pass recordings,
  shaped `{ timings, scalars, tables }`, where each pass is the operation body
  `{ id, usage, result: { contents: [ { unit, pages: [ { pageNumber, width, height, angle, words } ], fields } ] }, status }`.
  `unit` is `"inch"` for PDFs and `"pixel"` for images. A01's `netoPlaca`:
  `"source": "D(1,7.5255,9.3990,7.9169,9.3990,7.9169,9.4949,7.5255,9.4897)"` on an
  8.2639 × 11.6944 page.
- `.bakeoff/cu/`, `production/`, `production-sequential/`: single-pass recordings (one body, no
  `scalars`/`tables` keys).
- Stored rows: `raw_provider_result` is `{ scalars?, tables? }`, each the verbatim operation body
  (`provider.ts` line 127 `raw: body`; the `complete_extraction_pass` RPC merges it).

### New Files to Create

- `api/src/providers/document-extraction/content-understanding/regions.ts`: `projectSourceRegions`.
- `api/src/providers/document-extraction/content-understanding/regions.fixture.ts`: one small
  CU-shaped pass body builder shared by the unit test and the hosted integration test. The
  integration test cannot spell `valueString` itself (vocabulary guard);
  `extraction.integration.ts` line 23 already imports from this module.
- `api/src/providers/document-extraction/content-understanding/regions.test.ts`
- `client/src/review/PayslipPreview.tsx`: loads the detail and regions, flattens the values, and
  mounts `SourceDocumentPanel`.
- `client/src/review/PayslipPreview.test.tsx`
- `client/src/review/fieldLabels.test.ts`: D9's locale guard.
- `.agents/history/08-source-regions-preview.md`: at the end.
- Git-ignored and never committed:
  - `payslip_examples/A02-exif6.jpg` and `payslip_examples/A03-rotate90.pdf`;
  - `.bakeoff/orientation/measure.ts` and its `*.json` outputs.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [Content Understanding — document analysis, field grounding](https://learn.microsoft.com/azure/ai-services/content-understanding/document/elements)
  - The `source` format `D(page,x1,y1,…,x4,y4)`: clockwise from top-left, in the page's `unit`,
    with `;` joining the segments of a value that spans lines.
  - Why: the parser. Confirm the corner order against A01 `netoPlaca` above: x1 < x2 and
    y1 < y4, so the order is top-left, top-right, bottom-right, bottom-left, which matches
    `SourceOverlay`'s polygon.
- [MDN `image-orientation`](https://developer.mozilla.org/docs/Web/CSS/image-orientation)
  - `from-image` is the default. `naturalWidth` and `naturalHeight` then report the oriented
    size in current Chromium, Safari and Firefox.
  - Why: D11's reasoning about the image path.
- [pdf.js `PDFPageProxy.getViewport`](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib-PDFPageProxy.html)
  - The viewport includes the page's `/Rotate` (`rotation` defaults to the page's own).
  - Why: D11's reasoning about the PDF path, already relied on by `pdfDocument.ts` line 38.
- [pdf-lib `PDFPage.setRotation`](https://pdf-lib.js.org/docs/api/classes/pdfpage#setrotation)
  with `degrees(90)`. Why: building the `/Rotate 90` fixture (step 2).
- [WCAG 2.2 SC 1.4.11 Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
  - A 3:1 minimum for the graphical objects needed to understand content.
  - Why: D4's colour test.
- [ARIA APG — Disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
  - A button with `aria-expanded` and `aria-controls`.
  - Why: D1's Show document button. It is the standard pattern (not a tablist: that is Task 10's
    chip rail).

### Patterns to Follow

**A focused repository read** (`payslips.ts` `findSourceById`):

```ts
const { data, error } = await this.#client
  .from("payslips")
  .select("content_type, original_filename")
  .eq("id", uuidSchema.parse(id))
  .eq("user_id", this.#userId)
  .is("deleted_at", null)
  .maybeSingle();
if (error) throw new PayslipRepositoryError("query_failed", error);
if (data === null) return null;
```

**A route** (`payslips.ts` `/:id/source`): `idSchema.safeParse` → `400 invalid_request`; the
repository returns `null` → `404 not_found`; a typed `const body: SourceRegionsResponse = …;
res.json(body)`.

**A narrow zod view over a provider body** (`fields.ts` lines 76–112): `.loose()` objects,
`safeParse`, and `null`/empty on failure. Never throw on a malformed stored body. A malformed body
projects `{ pages: [], regions: [] }`.

**Module comments** explain *why*, with task and decision references:
`(Task 08 D6)`, `(ROADMAP locked decision 16)`.

**Client API** (`client.ts`):

```ts
export async function getPayslipSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/source`);
  return await parseResponse(sourceDocumentResponseSchema, response, "GET /api/payslips/:id/source");
}
```

**Errors in the client:** technical detail goes to `console.error("[review] …", error)`, and the
user sees translated copy (`review.errors.load`) with a retry. See `SourceDocumentPanel.load`.

**Imports:**
- `api` uses relative `.js` extensions.
- `client` has no extension and imports from `react-router`.
- Shared types come from `@payslip/shared`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Verify the starting state. Measure rotation behaviour (D11): it is the one finding that could
change the design, so it runs before any code.

### Phase 2: Core implementation (API)

The `fields.ts` key exports, `regions.ts` with the fixture builder and tests, the repository read,
the route, and the hosted integration tests.

### Phase 3: Integration (client)

The API client, sections and labels, locales, `RegionPopover`, the viewport, panel and PDF props,
`PayslipPreview`, and the session page.

### Phase 4: Testing, docs and validation

Docs (PRD, ROADMAP, CONTEXT, `validate.md`), the full local validation, the history file, and
stop.

---

## STEP-BY-STEP TASKS

Execute every step in order. Each ends with its validation.

### 1. VERIFY the starting state

- `git status --short` is clean except this plan file.
- `npm run validate` is green. Record the file and test counts as the baseline (Task 07 ended at
  46 files, 683 tests).
- `ls .bakeoff/two-pass-sequential .bakeoff/two-pass-concurrent` shows 11 JSON files each. The
  recordings tests below need them locally.
- **VALIDATE**: `npm run validate`

### 2. MEASURE rotation handling (D11, PAID ≈ $0.06)

- **CREATE the EXIF fixture** with Python and Pillow (already installed per user, history/07):

  ```python
  from PIL import Image
  im = Image.open("payslip_examples/A02.jpg")          # 1220 × 2712, no EXIF orientation
  im = im.resize((880, 1956), Image.LANCZOS)           # 1.72 MP: under downscale's 2 MP
  stored = im.transpose(Image.Transpose.ROTATE_90)     # pixels stored landscape, 1956 × 880
  exif = Image.Exif(); exif[0x0112] = 6                # "rotate 90° CW to display" → upright
  stored.save("payslip_examples/A02-exif6.jpg", quality=90, exif=exif.tobytes())
  ```

  Verify:
  - `ImageOps.exif_transpose(Image.open(...)).size == (880, 1956)`;
  - the file is under 1.5 MB;
  - `file-type` would sniff `image/jpeg`.

- **CREATE the /Rotate fixture** with a one-off Node script using `pdf-lib` (already a
  dependency): load `payslip_examples/A03.pdf` (1 page, rotation 0, checked at planning), call
  `getPage(0).setRotation(degrees(90))`, and save `payslip_examples/A03-rotate90.pdf`.

- **CREATE `.bakeoff/orientation/measure.ts`** (git-ignored, throwaway):
  - Construct `ContentUnderstandingProvider` directly from `process.env`
    (`AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY`,
    `AZURE_CU_ANALYZER_ID`, `AZURE_CU_API_VERSION`). Importing `config.ts` would demand every
    Supabase variable too.
  - Call `extract({ bytes, contentType, signal, pass: "scalars" })` once per fixture.
  - Write each `raw` to `.bakeoff/orientation/<name>.json`.
  - Print `estimateUsageCost([raw])` for each.
  - Run it with `npx tsx --env-file=.env .bakeoff/orientation/measure.ts`.

- **ANALYSE, for each fixture:**
  - the service's `pages[0].width/height`, `unit` and `angle`;
  - the `employeeName` quad;
  - compared with the upright original's recording (`.bakeoff/two-pass-sequential/A02.json`,
    `A03.json`, scalars body) and with the ratio the browser will render:
    - EXIF: `880/1956 ≈ 0.450` upright; `1956/880 ≈ 2.223` if the service ignores EXIF.
    - PDF: pdf.js with `/Rotate 90` renders landscape, `11.69/8.27 ≈ 1.414`, against portrait
      `≈ 0.707` if the service ignores `/Rotate`.
  - **Classify each case:**
    - **correct**: ratios agree, and the quad's fractions equal the upright recording's under the
      displayed orientation (within ~0.02);
    - **withheld**: the ratios disagree, so the guard fires and D10's note shows;
    - **misplaced**: the ratios agree but the quad is in the other orientation.

- **GOTCHA:** if either case is **misplaced**, STOP and report to the product owner before
  continuing. The guard's premise would be broken and D11's DoD cannot be met by this design.
- Record the table (fixture, service page size and unit, rendered ratio, verdict, cost) for the
  history file. Infer the 180° outcome as D11 states.
- **VALIDATE**: both JSON files exist; the total cost printed is ≤ $0.10.

### 3. UPDATE `api/src/providers/document-extraction/content-understanding/fields.ts`

- **ADD** two exports derived from the existing records, so the projection and the mapper can
  never disagree about which paths exist:

  ```ts
  /** The canonical scalars the mapper reads, in schema order (Task 08 D6). */
  export const SCALAR_FIELDS = Object.keys(SCALAR_PARSERS) as ScalarKey[];
  /** Each line-item table's columns (Task 08 D6). */
  export const TABLE_COLUMNS = Object.fromEntries(
    Object.entries(TABLE_PARSERS).map(([table, columns]) => [table, Object.keys(columns)]),
  ) as Record<TableKey, string[]>;
  ```

- Change nothing else. The mapper's behaviour must not move.
- **VALIDATE**: `npx vitest run api/src/providers/document-extraction/content-understanding/fields.test.ts`

### 4. CREATE `…/content-understanding/regions.fixture.ts`

- **IMPLEMENT** `regionsPassBody(fields, pages = [{ pageNumber: 1, width: 8, height: 10 }])`. It
  returns `{ id: "op", status: "Succeeded", result: { contents: [{ kind: "document", unit: "inch", pages, fields }] } }`.
- Also export two tiny value builders:
  - `sourced(valueString, source)` → `{ type: "string", valueString, source, confidence: 0.9 }`;
  - `rows(...)` → `{ type: "array", valueArray: rows.map((valueObject) => ({ type: "object", valueObject })) }`.
- One-line module comment: it exists because the vocabulary guard keeps these keys out of
  `routes/`.
- **VALIDATE**: `npm run typecheck`

### 5. CREATE `…/content-understanding/regions.ts`

- **IMPLEMENT** `export function projectSourceRegions(raw: unknown): SourceRegionsResponse`.
- **Module comment:**
  - A read-time projection (PRD §6.2, §7.5) over the retained pass bodies.
  - Page-relative fractions make images (pixels) and PDFs (inches) identical to the client.
  - One region per printed line (D3); `origin` is always `model` (D5).
- **Narrow views** in the `fields.ts` style:
  - `pageSchema = z.object({ pageNumber: z.number().int().min(1), width: z.number(), height: z.number() }).loose()`;
  - a value `{ valueString?: string, source?: string }.loose()`;
  - a field extends it with `valueArray?: [{ valueObject?: record }]`;
  - a body `result.contents` (`.min(1)`) whose first entry has `pages?` and `fields?`;
  - `storedSchema = z.object({ scalars: z.unknown().optional(), tables: z.unknown().optional() }).loose()`.
- **Algorithm:**
  1. Parse `raw` with `storedSchema`. On failure, or when `raw` is null, return
     `{ pages: [], regions: [] }`.
  2. For each of `scalars` and `tables`, parse the body. An unparseable body contributes nothing.
  3. Build `dimensions: Map<page, {width, height}>` per body from its pages with `width > 0` and
     `height > 0`. Each body's sources are divided by **its own** pages' dimensions.
  4. The response `pages` is `[{ page, aspectRatio: width / height }]` from the scalars body's
     dimensions, or else the tables body's, in page order.
  5. **Scalars body:** for each name in `SCALAR_FIELDS`, the field with a non-blank `valueString`
     and a string `source` goes to `addSource(regions, path, source, dimensions)`.
  6. **Tables body:** for each `[table, columns]` of `TABLE_COLUMNS`, for each
     `valueArray[index].valueObject[column]` meeting the same condition, the path is
     `${table}.${index}.${column}`.
  7. **`addSource`:**
     - Split on `;`. Each segment must match `/^D\((\d+),([^()]*)\)$/`, and its second group must
       split on `,` into exactly 8 finite numbers.
     - Skip a malformed segment, or one whose page has no dimensions. Never throw.
     - Corners are `[0, 2, 4, 6].map((i) => ({ x: clamp(n[i] / width), y: clamp(n[i + 1] / height) }))`,
       with `clamp` into `[0, 1]`.
     - Push `{ fields: [path], page, corners, origin: "model" }`.
  8. **`deduplicate`**, ported from receipt-ocr: identical page and corners (`toFixed(5)`) merge
     into one region whose `fields` accumulate in insertion order. `SourceOverlay` then draws one
     polygon, and its click goes to the first field.
  9. Return `sourceRegionsResponseSchema.parse({ pages, regions })`.
- **Single-pass bodies:** a stored row is always `{ scalars?, tables? }` since Task 05. The
  recordings test feeds the single-pass sets as `{ scalars: body, tables: body }`. Each branch reads
  only its own keys (D6), so the result is correct.
- **GOTCHA:** keep the words `polygon` and `boundingRegion` out of *other* modules. Inside this
  module they are allowed, but prefer "quad" and "source" for consistency.
- **VALIDATE**: `npm run typecheck`

### 6. CREATE `…/content-understanding/regions.test.ts`

- **Unit cases** (synthetic bodies from `regions.fixture.ts`):
  1. An inch page 8 × 10 with `D(1,2,1,4,1,4,2,2,2)` gives corners
     `[{0.25,0.1},{0.5,0.1},{0.5,0.2},{0.25,0.2}]` and `pages: [{ page: 1, aspectRatio: 0.8 }]`.
  2. A pixel page 1000 × 2000 gives the same fractions for the scaled source. The unit is
     irrelevant.
  3. A two-segment source gives two regions with the same `fields` (D3).
  4. A blank `valueString`, a missing `source`, and a non-canonical field name each give no
     region.
  5. An **unreadable-shaped** value (`valueString: "12,3,4"`, which `parseAmount` rejects) still
     gets a region (D6).
  6. Table cells give `payComponents.0.iznos` and `obustave.1.vjerovnik`. The index is the raw
     row index.
  7. A malformed segment (`D(1,1,2,3)`, `X(1,…)`, `NaN`) is skipped, and its siblings survive.
  8. A segment on a page with no dimensions is skipped.
  9. Out-of-range corners are clamped into `[0, 1]`.
  10. Two fields with an identical quad give one region with both fields.
  11. Scalars and tables bodies together: scalar paths come only from the scalars body and table
      paths only from the tables body. A table field planted in the scalars body is **not**
      projected.
  12. `raw` of `null`, `{}`, `"x"`, or `{ scalars: { nonsense: 1 } }` gives
      `{ pages: [], regions: [] }`.
  13. Only a tables body present: `pages` comes from the tables body.
- **Recordings block** (`describe.skipIf(!existsSync(...))`, mirroring `fields.test.ts` lines
  233–285):
  - The sets are `two-pass-sequential` and `two-pass-concurrent` (two-pass, `{ scalars, tables }`)
    and `cu` (single-pass, fed as `{ scalars: body, tables: body }`).
  - For every sample:
    - **coverage:** every canonical path with a non-blank `valueString` has at least one region;
    - **the DoD form:** every non-null scalar in `mapAnalyzeResult(body, pass).fields` has a region
      (for `cu`, map without a pass). Expect 100%, as measured at planning;
    - every corner lies in `[0, 1]`;
    - every region's page appears in `pages`;
    - `pages.length` equals the body's page count (A01 and D01: 2).
  - Record the region counts and coverage per set in the history file, taken from a
    `console.table` run once by hand, not left in the test.
- **VALIDATE**: `npx vitest run api/src/providers/document-extraction/content-understanding/regions.test.ts`
  (the recordings block must run, not skip, locally)

### 7. UPDATE `…/content-understanding/index.ts`

- **ADD** `export { projectSourceRegions } from "./regions.js";` with a one-line comment: the
  route's only entry into the module.
- **VALIDATE**: `npm run typecheck`

### 8. ADD `PayslipRepository.findRegionSource` in `api/src/repositories/payslips.ts`

- **IMPLEMENT:**

  ```ts
  /**
   * The retained pass bodies for a source-region projection (Task 08 D7): the only read of
   * `raw_provider_result`. A payslip without a readable form projects nothing, so its bodies are
   * withheld here rather than filtered by the caller.
   */
  async findRegionSource(id: string): Promise<{ rawProviderResult: unknown } | null>
  ```

  - Select `"status, raw_provider_result"` with the same `id`/`user_id`/`deleted_at` filters and
    `maybeSingle()`.
  - Return `null` when the row is absent.
  - Return `{ rawProviderResult: null }` when `!WARNED_STATUSES.includes(data.status)`.
  - Otherwise return `{ rawProviderResult: data.raw_provider_result }`.
- Update the `PAYSLIP_COLUMNS` comment only if it now misstates who reads the raw column. It
  already says "Only a source-region projection reads the raw column", so leave it.
- **TEST** in `payslips.test.ts`, using a `singleRow`-style fake whose `maybeSingle` returns
  `{ status, raw_provider_result }`:
  - `review` returns the raw;
  - `processing` and `failed` return `null` raw;
  - a missing row returns `null`.
- **VALIDATE**: `npx vitest run api/src/repositories/payslips.test.ts`

### 9. ADD `GET /:id/regions` in `api/src/routes/payslips.ts`

- **IMPLEMENT** after `/:id/source`, mirroring it:

  ```ts
  /**
   * PRD §10.10. A read-time projection over the retained responses (Task 08): no geometry is
   * stored, so it applies to every payslip already analysed. Empty for a payslip without a
   * readable form (D7).
   */
  router.get("/:id/regions", authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");
    const source = await new PayslipRepository(auth.client, auth.userId).findRegionSource(id.data);
    if (source === null) throw new HttpError(404, "not_found");
    const body: SourceRegionsResponse = projectSourceRegions(source.rawProviderResult);
    res.json(body);
  }));
  ```

- **IMPORTS:** `projectSourceRegions` from `"../providers/document-extraction/content-understanding/index.js"`,
  and `type SourceRegionsResponse` from `@payslip/shared`.
- **GOTCHA:** no forbidden vocabulary in this file (step 5's gotcha). The stale reaper is not run:
  a stale `processing` row projects empty either way.
- **VALIDATE**: `npm run typecheck && npx vitest run api/src/provider-vocabulary.test.ts api/src/app.test.ts`

### 10. UPDATE `api/src/routes/payslips.integration.ts`

- **ADD** a `describe("source regions (Task 08)")` in its **own session**. Earlier sessions are near
  the cap of ten, as Task 06 deviation 4 found.
  1. A `processingPayslip` whose `GET /regions` gives `200 { pages: [], regions: [] }`.
  2. `completeExtractionPass(id, "scalars", { fields: { netoPlaca: "2298.97" }, metadata: {…}, raw: regionsPassBody({ netoPlaca: sourced("2.298,97", "D(1,2,1,4,1,4,2,2,2)") }) })`.
     Then `/regions` parses with `sourceRegionsResponseSchema` and gives exactly one region
     `{ fields: ["netoPlaca"], page: 1, origin: "model" }` with step 6 case 1's corners.
  3. Then a tables pass whose body has one `payComponents` row. `/regions` now also has
     `payComponents.0.iznos` (D7: whatever has landed).
  4. Set that row to `failed` through the `admin` client, which gives `{ pages: [], regions: [] }`.
- **ADD** `request(app).get(\`/api/payslips/${jpegPayslipId}/regions\`)` to the "another user"
  404 list (line ~277).
- **ADD** `/regions` → 404 to the soft-delete case (line ~689).
- **ADD** malformed id → 400 inside the new describe.
- **VALIDATE**: `npm run test:integration`. Hosted: expect 3/3 auth and 33 + 5 payslip cases, all
  passing. Then run the orphan query from `validate.md` Phase 8 (`mcp__supabase__execute_sql`).

### 11. UPDATE `client/src/api/client.ts`

- **ADD** `getPayslipDetail(id, signal?)` → `payslipDetailResponseSchema` and
  `"GET /api/payslips/:id"`.
- **ADD** `getPayslipRegions(id, signal?)` → `sourceRegionsResponseSchema` and
  `"GET /api/payslips/:id/regions"`.
- Mirror `getSessionDetail`'s signature (it takes `signal`).
- **TEST** in `client.test.ts`: the URL is encoded and the schema is parsed, following the
  `getPayslipSource` test's shape.
- **VALIDATE**: `npx vitest run client/src/api/client.test.ts`

### 12. REWRITE `client/src/review/regionSections.ts`

- **IMPLEMENT:**
  - `export type Section = "employer" | "employee" | "period" | "reconciliation" | "payComponents" | "obustave" | "neoporeziviPrimici";`
  - `SECTION_COLOURS` per D4.
  - `sectionOf(path)`:
    - table paths by prefix `payComponents.`, `obustave.` and `neoporeziviPrimici.`;
    - scalars by a `Record<ScalarField, Section>` typed over the shared canonical keys, so a new
      scalar is a type error until it is placed;
    - `null` for anything else.
  - **`fieldLabel(path)`** replaces `fieldLabelKey` and returns
    `{ key, section, row } | null`:
    - `key` is the typed translation key: `review.fields.<scalar>` or
      `review.columns.<table>.<column>`;
    - `row` is 1-based for a cell and `null` for a scalar.
    - Build the key maps as `as const` literal records, as the file does today, so `t(key)` stays
      type-checked.
- **UPDATE** `RegionPopover` (step 14). It is the only caller.
- **TEST** `regionSections.test.ts`, rewritten:
  - the mapping cases for one path per section plus `unknown` → `null`;
  - `payComponents.2.iznos` gives row 3;
  - **every** key of `canonicalPayslipFieldsSchema.shape` except the three tables (and there is no
    `currency` there) has a section and a label;
  - every column of `payComponentSchema.shape`, `obustavaSchema.shape` and
    `neoporeziviPrimitakSchema.shape` has a label under its table;
  - the colours are 7 distinct values, each with **≥ 3:1 contrast against `#ffffff`**, computed
    with the WCAG relative-luminance formula in the test.
- **VALIDATE**: `npx vitest run client/src/review/regionSections.test.ts`

### 13. UPDATE `client/src/i18n/locales/en.json` and `hr.json`

- **REMOVE** every receipt key under `review.fields`.
- **ADD** `review.fields` (25), `review.columns` (11), `review.sections` (7), `review.cellLabel`,
  `review.inspectUnreadable`, `review.ungroundable`, `review.highlightsWithheld`,
  `review.previewTitle`, `session.showDocument` and `session.hideDocument`. Proposed copy, for the
  product owner to read in review:

| Key | en | hr |
| --- | --- | --- |
| fields.employerName | Employer name | Naziv poslodavca |
| fields.employerAddress | Employer address | Adresa poslodavca |
| fields.employerOib | Employer OIB | OIB poslodavca |
| fields.employerIban | Employer IBAN | IBAN poslodavca |
| fields.employeeName | Employee name | Ime i prezime radnika |
| fields.employeeAddress | Employee address | Adresa radnika |
| fields.employeeOib | Employee OIB | OIB radnika |
| fields.employeeIban | Employee IBAN | IBAN radnika |
| fields.period | Pay period | Razdoblje obračuna |
| fields.paymentDate | Payment date | Datum isplate |
| fields.ukupnoSati | Total hours | Ukupno sati |
| fields.brutoPlaca | Gross pay | Bruto plaća |
| fields.doprinosiIzPlace | Contributions from pay | Doprinosi iz plaće |
| fields.doprinosMioIStup | Pension, pillar I | MIO I. stup |
| fields.doprinosMioIiStup | Pension, pillar II | MIO II. stup |
| fields.dohodak | Dohodak | Dohodak |
| fields.osobniOdbitak | Personal allowance | Osobni odbitak |
| fields.poreznaOsnovica | Taxable base | Porezna osnovica |
| fields.porezNaDohodak | Income tax | Porez na dohodak |
| fields.netoPlaca | Net pay | Neto plaća |
| fields.neoporeziviPrimiciUkupno | Non-taxable payments, total | Neoporezivi primici ukupno |
| fields.obustaveUkupno | Obustave, total | Obustave ukupno |
| fields.iznosZaIsplatu | Amount paid out | Iznos za isplatu |
| fields.doprinosiNaPlacu | Contributions on pay (employer) | Doprinosi na plaću |
| fields.ukupanTrosakRada | Total cost of work | Ukupan trošak rada |
| columns.payComponents.naziv | Component | Vrsta primitka |
| columns.payComponents.sati | Hours | Sati |
| columns.payComponents.koeficijent | Coefficient | Koeficijent |
| columns.payComponents.iznos | Amount | Iznos |
| columns.obustave.naziv | Description | Opis |
| columns.obustave.vjerovnik | Creditor | Vjerovnik |
| columns.obustave.iznos | Amount | Iznos |
| columns.obustave.ostatakSalda | Remaining balance | Ostatak duga |
| columns.obustave.brojRata | Instalment | Broj rate |
| columns.neoporeziviPrimici.naziv | Type | Vrsta |
| columns.neoporeziviPrimici.iznos | Amount | Iznos |
| sections.employer | Employer | Poslodavac |
| sections.employee | Employee | Radnik |
| sections.period | Period | Razdoblje |
| sections.reconciliation | Pay calculation | Obračun |
| sections.payComponents | Pay components | Primici |
| sections.obustave | Obustave | Obustave |
| sections.neoporeziviPrimici | Non-taxable payments | Neoporezivi primici |
| cellLabel | {{column}}, {{section}} row {{row}} | {{column}}, {{section}}, red {{row}} |
| inspectUnreadable | Text was found here, but it could not be read as a value. | Ovdje je pronađen tekst, ali nije ga bilo moguće očitati kao vrijednost. |
| ungroundable | This value was not found in the page's text. Check it against the document. | Ova vrijednost nije pronađena u tekstu stranice. Provjerite je na dokumentu. |
| highlightsWithheld | Highlights are hidden because the page's orientation could not be confirmed. | Oznake su skrivene jer nije bilo moguće potvrditi orijentaciju stranice. |
| previewTitle | Document | Dokument |
| session.showDocument | Show document | Prikaži dokument |
| session.hideDocument | Hide document | Sakrij dokument |

- **GOTCHA:** `review.sourceTitle` ("Original payslip") stays as the panel heading. Use
  `previewTitle` only if a second heading is needed. If it is not, do not add it: an unused key is
  dead copy.
- **VALIDATE**: `npx vitest run client/src/i18n` (key parity)

### 14. CREATE `client/src/review/fieldLabels.test.ts` and UPDATE `RegionPopover.tsx`

- **fieldLabels.test.ts** (D9 guard, mirroring `statusCopy.test.ts`): for `en` and `hr`, for every
  canonical scalar and column path, the key `fieldLabel()` returns resolves to a non-empty string
  in that locale object. Every `review.sections.*` key is non-empty, for all 7 sections.
- **RegionPopover:**
  - Props: add `ungroundable: boolean` and `unreadable: boolean`. `onEdit` becomes `onEdit?`.
  - The label is computed from `fieldLabel(field)`:
    - scalar: `t(key)`;
    - cell: `t("review.cellLabel", { column: t(key), section: t(\`review.sections.${section}\`), row })`.
      Type the section key through a literal map rather than a template, so the key stays checked.
    - unknown path: `t("review.sourceTitle")`, as today.
  - **Notes**, each with the existing `TriangleAlert` style and in this order:
    1. low confidence;
    2. ungroundable;
    3. unreadable (`inspectUnreadable`), shown alongside the existing `inspectEmpty` value line.
  - The Edit button renders only when `onEdit` is defined.
  - Sizes per D12: close `size-12`, Edit `min-h-12`.
- **UPDATE** `RegionPopover.test.tsx`:
  - a cell label renders "Amount, Obustave row 2";
  - there is no Edit button without `onEdit`;
  - Edit calls `onEdit` when it is given;
  - the ungroundable and unreadable notes render.
- **VALIDATE**: `npx vitest run client/src/review`

### 15. UPDATE `ZoomableSourceViewport.tsx`

- **Props:**
  - `onSelect` becomes optional;
  - add `ungroundableFields: readonly string[]`, `unreadableFields: readonly string[]` and
    `outlinesWithheld?: boolean`.
- Pass `ungroundable` and `unreadable` to `RegionPopover`. Pass
  `onEdit={onSelect === undefined ? undefined : () => { setInspected(null); onSelect(inspected); }}`.
- `handleRegionClick`: in `focus` mode call `onSelect?.(field)`.
- Render `t("review.highlightsWithheld")` as `<p className="text-sm text-slate-600">` after
  `{footer}` when `outlinesWithheld` is true. Suppress `inspectPrompt` in that case: it is already
  gated on `overlaySafe`.
- `ZoomButton` goes to `size-12` (D12).
- **GOTCHA:** do not touch the pointer, wheel or sizing code (see the read-first note).
- **VALIDATE**: `npm run typecheck`

### 16. UPDATE `SourceDocumentPanel.tsx` and `PdfSource.tsx`

- **SourceDocumentPanel:**
  - Props mirror step 15: `onSelect?`, `ungroundableFields` and `unreadableFields`. Thread them
    through to both sources.
  - Links go to `min-h-12` (D12).
- **ImageSource:**
  - `const [ratio, setRatio] = useState<"pending" | "agrees" | "disagrees">("pending")`, reset to
    `"pending"` when `url` changes.
  - `onLoad` sets `"agrees"` or `"disagrees"` by the existing comparison.
  - `overlaySafe={ratio === "agrees" && page !== undefined}`.
  - `outlinesWithheld={ratio === "disagrees" && (regions?.regions.some((r) => r.page === 1) ?? false)}`.
- **PdfSource:**
  - `outlinesWithheld={!overlaySafe && (regions?.regions.some((r) => r.page === page) ?? false)}`.
    It is only reachable after `pageViewport` is measured.
  - `PagerButton` goes to `size-12` (D12).
- **Tests:**
  - `SourceOverlay.test.tsx` and the existing review tests stay green.
  - Add one `SourceDocumentPanel` image test, mocking `getPayslipSource` and firing `load` on the
    `<img>` with `naturalWidth` and `naturalHeight` defined through `Object.defineProperty`:
    - a mismatched ratio shows the withheld note and no `<polygon>`;
    - a matching ratio shows polygons and no note;
    - before `load`, no note.
  - Use jsdom only, with no canvas polyfill (receipt-ocr history 22: `validate.md` guards this).
- **VALIDATE**: `npx vitest run client/src/review`

### 17. CREATE `client/src/review/PayslipPreview.tsx`

- **IMPLEMENT** `PayslipPreview({ payslipId, tablesStatus })`:
  - An effect keyed on `[payslipId, tablesStatus]` loads `getPayslipDetail` and
    `getPayslipRegions` in parallel with an `AbortController`. It cancels on change and ignores
    aborted results.
  - **Loading:** `Spinner`. **Error:** `console.error("[review] could not load the payslip preview", error)`
    plus `<ErrorMessage message={t("review.errors.load")} onRetry={…} />`.
  - Renders `<SourceDocumentPanel payslipId regions activeField={null} interaction="popover" fieldValues={fieldValuesOf(detail)} lowConfidenceFields editedFields ungroundableFields unreadableFields />`.
    There is no `onSelect` (D2).
  - A `tablesStatus` change must **not** remount `SourceDocumentPanel`, which would refetch the
    source and re-render the PDF. Keep the previous `regions` and `detail` in place while the
    refetch runs, showing the spinner only on first load.
  - **`export function fieldValuesOf(detail)`:**
    - flattens every non-null scalar of `canonicalPayslipFieldsSchema.shape` to `path → value`;
    - flattens each table row cell to `${table}.${i}.${column}`;
    - skips null values, so the popover shows `inspectEmpty`.
- **TEST** `PayslipPreview.test.tsx`, mocking `../api/client` and `./SourceDocumentPanel` (a stub
  that renders its props as JSON):
  - it passes the flattened values and all four signal lists;
  - a `tablesStatus` rerender refetches both, and the panel stub is **not** remounted (a mount
    counter in the stub);
  - an error shows the translated message, and retry reloads;
  - `fieldValuesOf` gets a unit case with scalars, a null and table cells.
- **VALIDATE**: `npx vitest run client/src/review/PayslipPreview.test.tsx`

### 18. UPDATE `client/src/routes/SessionPage.tsx`

- **IMPLEMENT** D1:
  - `const [searchParams, setSearchParams] = useSearchParams(); const selectedId = searchParams.get("payslip");`
  - `selected = detail?.payslips.find((p) => p.id === selectedId && (p.status === "review" || p.status === "confirmed")) ?? null`.
  - Pass each such row a button (inside `Row`'s `children`, next to the retry slot):
    `aria-expanded={selected?.id === payslip.id}`, `aria-controls="payslip-preview"`, text
    `showDocument` or `hideDocument`, and `min-h-12`, reusing `linkClass`.
  - **Toggle:** `setSearchParams(open ? {} : { payslip: id }, { replace: false })`. Preserve no
    other params: there are none.
  - Wrap the `<ol>` and the preview in `<div className="lg:grid lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start lg:gap-6">`.
    The preview goes in `<section id="payslip-preview" aria-labelledby=…>` with an
    `<h2 tabIndex={-1} ref={previewHeading}>` naming the payslip. Reuse `session.position` and the
    filename for the name; add no new copy.
  - Then `<PayslipPreview key={selected.id} payslipId={selected.id} tablesStatus={selected.tablesStatus} />`.
  - When `selected` changes to non-null because the user pressed the button (not on the initial
    load from the URL), focus the heading, then
    `scrollIntoView({ block: "start", behavior: "smooth" })`. Guard `scrollIntoView` for jsdom.
  - Where `selectedId` is set, the row is `review`/`confirmed`, and the session poll has stopped:
    nothing more is needed. The poll's own `tablesStatus` update flows into the preview's prop.
- **GOTCHA:** keep all of Task 07's behaviour intact:
  - the batch rows;
  - retry focus;
  - the polite status region;
  - no control under 48 px;
  - 375 px with no horizontal scroll. The grid is `lg`-only.
- **TEST** in `SessionPage.test.tsx`:
  - a `review` row has Show document and a `processing` row has none;
  - pressing it sets `?payslip=` (assert through a `MemoryRouter` location probe) and renders the
    mocked `PayslipPreview` with that id;
  - pressing again clears it;
  - an initial URL with `?payslip=` for a `review` payslip opens it;
  - one for a `processing`, unknown or `failed` payslip renders no preview;
  - `aria-expanded` follows the selection.
  - Mock `../review/PayslipPreview`.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx`

### 19. UPDATE the docs

- **`PRD.md`:**
  - **§7.5, Rules:**
    - one outline per printed line segment;
    - origin is `model` (a value without a source has no outline);
    - unreadable values are outlined;
    - withheld outlines carry a translated note;
    - the rotation finding from step 2, one sentence.
  - **§10.10:** empty arrays for a payslip not in `review`/`confirmed`; while `tablesStatus` is
    `pending`, regions cover the scalars only.
  - **§12 Phase 3:** a status note that the region projection and overlay landed in Task 08.
- **`CONTEXT.md` *Source Region*:** "A value printed across several lines has one Source Region
  per line."
- **`.agents/ROADMAP.md`:**
  - §2: Task 08 → ✅ complete, reviewed pending.
  - §3 Task 08:
    - add "Added in planning (plan 08)" bullets for D1, D2, D4, D9, D10 and D12, as Task 07 did;
    - reword the rotation DoD line per D11 with the measured verdicts;
    - tick the DoD lines this session proved (regions for all 11 samples at 100% of non-null
      scalars, via the recordings test);
    - leave "outlines land on the correct text", the `<object>` fallback, and M1 for the review
      session and the product owner.
  - §4 M1: note that the review session leaves the 11 documents in place (D13).
- **`.claude/commands/validate.md`** (git-ignored, but extended by hand as its "Maintaining this
  file" section requires):
  - **Phase 4:** rows for `regions.test.ts` (including the recordings block),
    `regionSections.test.ts`, `fieldLabels.test.ts`, `PayslipPreview.test.tsx`, the
    `SessionPage` selection cases and `findRegionSource`.
  - **Phase 6:** a check that `grep -rn "regions" api/src/repositories/payslips.ts` shows
    `raw_provider_result` selected in `findRegionSource` only.
  - **Phase 8:** the five new hosted cases.
  - **Phase 9:** **journey 9.7 — source regions (Task 08, PAID)**:
    - Upload `A01.pdf` (2 pages), `B02.jpg` (angled phone photo) and `A03.pdf` (clean native),
      plus `A02-exif6.jpg` and `A03-rotate90.pdf`.
    - Show document on each: outlines sit on their text; A01's page 2 is reached by the pager
      and outlined.
    - The rotation fixtures behave as step 2 recorded (correct, or withheld with the note).
    - The popover shows label, value and notes, with no Edit button.
    - The switch between `hr` and `en` works.
    - At 375 px there is no horizontal scroll, and no touched control is under 48 px.
    - `?payslip=` survives a reload.
    - A pdf.js failure falls back to `<object>` plus the notice. Force it by blocking the pdf.js
      worker URL in agent-browser if possible; otherwise record it as not exercised.
  - **Phase 10:** delete the `08` row.

### 20. RUN the full local validation, then WRITE the history file and STOP

- `npm run validate`: green. Record the file and test counts against step 1.
- `npm run build`: green, with the known Vite chunk-size advisory.
- `npm run test:integration`: hosted, green; then the orphan query shows 0 rows.
- `git diff --stat package-lock.json` is empty.
- `grep -rn "react-router-dom" client/src` is empty.
- `grep -rnE "polygon|valueString|boundingRegion" api/src --include=*.ts | grep -v content-understanding/`
  shows only `provider-vocabulary.test.ts`.
- **Not run here** (D14): `/code-review`, `/validate`, browser journeys, `npm run test:extraction`,
  and the M1 corpus upload.
- **CREATE `.agents/history/08-source-regions-preview.md`** in the Task 07 history's structure:
  - What was built (a file table), new and extended tests, D1–D14 carried, deviations;
  - the step 2 rotation table with its cost;
  - the recordings coverage table (per set: samples, paths, regions, coverage %);
  - the validation table;
  - the paid runs;
  - open items;
  - a **"Handoff to the review session"** list:
    1. browser journey 9.7;
    2. upload and keep the M1 corpus (D13);
    3. the product owner reads the D9 copy;
    4. then `/code-review` and `/validate`.
- Do **not** commit. Committing waits for the product owner's go-ahead after review.
- **VALIDATE**: `npm run validate` (already run above; do not re-run for doc-only edits)

---

## TESTING STRATEGY

### Unit Tests

- **API:**
  - `regions.test.ts`: the parser, fractions, segments, D6 selection, pass isolation, dedup and
    resilience, plus 100% coverage over three recorded sets (local; skipped in CI where `.bakeoff/`
    is absent).
  - `payslips.test.ts`: `findRegionSource`.
- **Client:**
  - `regionSections.test.ts`: every canonical path placed and labelled, plus colour contrast.
  - `fieldLabels.test.ts`: hr/en label presence.
  - `RegionPopover.test.tsx`, `SourceDocumentPanel` (the ratio tri-state and the withheld note),
    `PayslipPreview.test.tsx`, `SessionPage.test.tsx` (selection) and `client.test.ts`.

### Integration Tests

Hosted Supabase (`npm run test:integration`), five new cases:

- empty while `processing`;
- scalars regions after the scalars pass;
- table regions added after the tables pass;
- empty once `failed`;
- 400 on a malformed id.

`/regions` also joins the cross-user 404 list and the soft-delete case. No Docker.

### Edge Cases

- A multi-line value (two regions, one path).
- A value with no `source` (no region, no error).
- An unreadable value (outlined).
- A malformed or unknown source segment (skipped).
- A page without dimensions (its segments skipped).
- Identical quads for two fields (merged).
- A tables body only (pages from tables).
- A stored raw of `null` or garbage (empty).
- `tablesStatus` flipping to `ready` while the preview is open (refetch without remount).
- `?payslip=` naming a processing, failed or foreign id (no preview).
- An image ratio mismatch (note shown, and never while pending).
- A PDF page without a declared ratio (outlines withheld).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` · `npm run format:check`

### Level 2: Unit Tests

`npm run test` (or `npm run validate` for all of Levels 1–2)

### Level 3: Integration Tests

`npm run test:integration` (hosted), then the `validate.md` Phase 8 orphan query through
`mcp__supabase__execute_sql`.

### Level 4: Manual Validation

- The step 2 paid measurement is the only manual step in this session.
- Browser journey 9.7 and M1 belong to the review session and the product owner (D14).

### Level 5: Additional Validation

`npm run build`; the lockfile diff; the vocabulary grep (step 20).

---

## ACCEPTANCE CRITERIA

- [ ] `GET /api/payslips/:id/regions` returns page-relative regions for every value with a
      non-blank printed value and a source, from both passes, with no stored geometry and no
      migration.
- [ ] The recordings test shows **100%** of non-null scalars (and of all sourced paths) have
      regions, in `two-pass-sequential`, `two-pass-concurrent` and `cu`.
- [ ] Multi-line values give one region per line. Unreadable values are outlined, and `origin` is
      `model`.
- [ ] Processing and failed payslips give empty arrays. Another user's or a deleted payslip gives
      404.
- [ ] The session page opens a payslip's highlighted source through `?payslip=`, stacked on a
      phone and side by side at `lg`. The button is a disclosure with `aria-expanded`.
- [ ] Tapping an outline shows label, value and attention notes, with no Edit button.
- [ ] Section colours cover all seven PRD §7.7 sections at ≥ 3:1 contrast. Every canonical path
      has hr/en labels (guarded), and the receipt labels are gone.
- [ ] A ratio mismatch withholds outlines **with** the translated note, never while loading.
- [ ] The EXIF 6 and `/Rotate 90` behaviour is measured and recorded, and no case is misplaced.
- [ ] Touched controls are ≥ 48 px.
- [ ] `npm run validate`, the build and the hosted integration suite are green. No new dependency.
- [ ] PRD, ROADMAP, CONTEXT and `validate.md` are updated; the history file is written; nothing is
      committed.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–20 completed in order, each step's validation passing
- [ ] Paid spend ≤ $0.10, logged
- [ ] Full unit and hosted integration suites green
- [ ] No lint or type errors
- [ ] History file includes the review-session handoff
- [ ] Stopped before `/code-review`, `/validate`, browser work and commit

---

## NOTES

- **Why the projection lives in the content-understanding module:** it reads `source`, `pages` and
  `valueString`, all provider vocabulary (PRD §6.2). The route sees only
  `SourceRegionsResponse`.
- **Why `fields.ts` exports its keys** rather than `regions.ts` listing them: the mapper and the
  projection must agree on which paths exist. One list makes a disagreement impossible.
- **Why D7 nulls the raw in the repository:** it keeps the "has a readable form" rule in one
  place (`WARNED_STATUSES`) instead of adding a third copy of the status list to the route.
- **Retroactivity:** every hosted payslip already analysed gets regions with no backfill. That is
  the property PRD §6.2 promises. The review session should open one analysed before this task
  (for example from Task 07's retained sessions, if any remain) to confirm it.
- **Risk — colours:** seven categorical colours at ≥ 3:1 on white are necessarily close in hue in
  places (violet/pink, blue/teal). Colour is never the only cue: the popover names the field and
  its section. Task 09's legend adds the section name beside each dot.
- **Risk — 180° rotation:** undetectable by ratio. If step 2 finds the service ignores EXIF, a
  small 180°-tagged photo would be misplaced. That is rare in practice: phone photos over 2 MP are
  redrawn upright by `downscale.ts`. Document it; do not build a heuristic for it
  (no-invented-edge-case-heuristics).
- **Out of scope:** focusing fields (09), a page rail or thumbnail sheet (10: `PdfSource`'s
  existing pager suffices for now), locale value formatting (09), and edited-field dashing beyond
  what `SourceOverlay` already does (it reads `editedFields`, which is empty until 09).

**Confidence: 8/10** for one-pass execution. The API half is small and evidence-backed. The
remaining risk is the client plumbing through the ported viewer, and step 2's measurement, which
could stop the task if a case is misplaced.
