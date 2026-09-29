# Feature: Task 16 — Extraction and review polish

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md`](../ROADMAP.md): the third post-roadmap iteration, after Tasks 14
and 15/15b. Locked decisions that apply: **13** (the service returns what is printed; normalisation
is the mapper's job; this task restores it for two fields), **15** (accuracy per field instance,
~0.5% noise band), **16** (grounding stays), **10/11** (Content Understanding + `gpt-4.1`, unchanged)
· **PRD:** §7.5, §7.7, §11.3 · **Risk closed:** ROADMAP §5 "Service source on the wrong text"
(Task 09 D15) · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) (Source Region, Doprinosi na plaću,
Doprinosi iz plaće, Ukupan trošak rada) · **Rules:** [`AGENTS.md`](../../AGENTS.md).

**Starting state:** clean tree at `fd50bc4` (Task 15 + 15b committed and on the mirror). Record the
starting commit in the history file.

**Session split (standing rule):** the implementing session runs the ordinary checks (unit tests,
typecheck, lint, format, the scoring harness, the one paid run below) and **stops before**
`/code-review`, `/validate`, any browser journey and the commit. It also does **not** switch the
production analyzer (D4): that is a Render dashboard change for the product owner.

## Feature Description

Eight observations from the product owner's testing on 2026-09-29 were investigated in the planning
session against the live payslips in the hosted Supabase project (uploaded 2026-09-29 09:13 UTC)
and every recording under `.bakeoff/`. Five become work; four are left as they are (Notes).

1. **Wrong highlights for `period` and `paymentDate`** (B01, C01, D01; C01's payment date too).
2. **A04's creditor "SPH PU VUKOVAR" outlined on "VUKOVARA" in the employer address**, and other
   service sources that land on unrelated text.
3. **A04's deduction rows in a different order** from the document.
4. **Outlines too thick on a phone.**
5. **Form order:** "Total hours" sits under Period; "Contributions on pay (employer)" sits second
   to last in the pay calculation.

## User Story

As someone reviewing an extracted payslip
I want every highlight to sit on the value it names, rows in the order they are printed, thin
outlines on my phone, and the pay calculation in the order the payslip prints it
So that I can trust a highlight at a glance and check the form top to bottom against the page.

## Problem Statement

### 1. `period` / `paymentDate` highlights on the wrong words (root cause found)

`api/src/providers/document-extraction/content-understanding/field-schema.ts:47-57` asks the service
for `period` "u formatu YYYY-MM" (with a month-name table for converting) and `paymentDate` "u
formatu YYYY-MM-DD". This contradicts locked decision 13. When the model returns a string that is
**not printed** on the page (`2025-06-10`), the service's source estimation cannot find it and lands
on unrelated tokens. When it copies the printed text, the source is right. Evidence, same documents
and same analyzer:

| Sample | Field | Value returned | Words under the service's source |
| --- | --- | --- | --- |
| B01 (live, cu, two-pass-sequential, hosted-quads) | period | `2025-06` | `2025 ,` and `30` (from "OD 9 DO **30**") |
| B01 (two-pass-concurrent) | period | `2025, MJESEC 6` | the printed run — **correct** |
| C01 (live, cu, sequential, hosted-quads) | period | `2025-06` | `2025` and `01` (from "OD **01**. DO 30.") |
| C01 (live, cu, sequential, hosted-quads) | paymentDate | `2025-07-01` | `2025.` in section V, not section IV's `01.07.2025.` |
| C01 (two-pass-concurrent) | both | printed forms | **correct** |
| D01 (live, cu, concurrent) | paymentDate | `2025-06-10` | `20 , 10000` in the employer address |
| D01 (sequential, hosted-quads) | paymentDate | `10.06.25` | **correct** |

The mapper already normalises every printed form seen: `shared/src/datetime.test.ts:49-74` covers
`09.06.2025.`, `01.07.2025.`, `10.06.25`, `6.06.2025`, `svibanj 2025.`, `GODINA 2025, MJESEC 6 …`,
`GODINA 2025. MJESEC 6. …`, `GODINA 2025, MJESEC SVIBANJ, …` and `1.05.2025 do 31.05.2025`. So the
normalising instruction buys nothing and costs the outline.

### 2. Service sources on unrelated text (general; nondeterministic)

`regions.ts` passes the service's `source` straight through (Task 08 D5). In the live A04 run the
three "SPH PU VUKOVAR" creditor cells all carried the quad `D(1,166,414,228,428)`, which is the word
"VUKOVARA" in "ULICA GRADA VUKOVARA 33" (employer address). The recordings of A04 had them right, so
no wording can prevent it. The recordings show the same class elsewhere: two-pass-sequential A01
`obustave.0.vjerovnik` "NACIONALNI SP" is outlined on "zaposlenih centralizirani", and two cells
"NSD KUP" on "narodna banka".

### 3. Table rows out of order

Live A04 returned the obustave grouped by creditor (the three SPH PU VUKOVAR rows first); every
recording kept printed order. No table description says "in printed order".

### 4. Thick outlines on a phone

`client/src/review/SourceOverlay.tsx:79` draws `strokeWidth={active ? 2 : 1}` with
`vectorEffect="non-scaling-stroke"`: 1 CSS px is ~3 device px on a phone, around dense table rows
measured at 3.5–4.3 CSS px tall at fit width (history/15 review finding 6).

### 5. Form order

`client/src/review/regionSections.ts:37-63` (`SCALAR_SECTIONS`) is both the section map and the
form's field order (`PayslipForm.tsx:34-43` builds `FIELDS_BY_SECTION` from its entry order).
`ukupnoSati` is in `period`, although the field schema defines it as the hours printed **on the
BRUTO PLAĆA line** (`field-schema.ts:58-60`). `doprinosiNaPlacu` comes after `iznosZaIsplatu`, while
the IP1 layout (A04: "1. BRUTO PLAĆA", "2. DOPRINOSI NA PLAĆU", "3. UKUPAN TROŠAK PLAĆE", "4.
DOPRINOSI IZ PLAĆE" …) prints it right after bruto.

## Solution Statement

- **D1 — Copy period and payment date as printed.** Reword the two descriptions; remove the
  month-name conversion table. Normalisation stays in `parsePeriod` / `parseDate`, unchanged.
- **D2 — Rows in printed order.** One sentence added to each of the three table descriptions.
- **D3 — Do not touch the occlusion rule.** A04 `obustave.0.iznos` (40,00, printed and present in the
  OCR markdown table) was null in 4/4 runs. The hypothesis that SHARED_RULES' "zaklonjena … vrati
  null" over-fires is unproven, and that rule is what makes A04's occluded `iznosZaIsplatu` come back
  null (Task 06 D10). The paid run only **observes** the cell; if D1/D2 do not change it, it is
  recorded and left (product owner, 2026-09-29: "try only if cheap; leave if wording does not fix
  it").
- **D4 — A new analyzer family `hrPayslipV2`, production untouched until accepted.** Schema text is
  part of the analyzer definition, and there is **one** Foundry resource that local and hosted share
  (ROADMAP Task 13). `provision:analyzer --replace` on `hrPayslipV1` would change production
  before any evidence and make every V1 recording's analyzer disappear. Instead: provision
  `hrPayslipV2_scalars` / `hrPayslipV2_tables` from the edited code, record and score against V2
  locally, and hand the switch (Render `AZURE_CU_ANALYZER_ID=hrPayslipV2`, plus the local `.env`) to
  the product owner once accepted. Rollback is setting it back; V1 stays deployed, unmanaged, like
  the single-pass analyzer before it. `score:extraction` filters sets by analyzer family, so V1 and
  V2 sets never mix.
- **D5 — One paid run, ~$0.60.** `GOLDEN_MODE=sequential` (PRD §11.4's single-payslip condition,
  comparable with `two-pass-sequential`), set `task16-sequential`. A second run needs the product
  owner's go-ahead (memory: student credit). Acceptance: scalars within the band of the two-pass
  sets (**≥ 268/273**; recorded two-pass range 268–271, hosted 270), line-item cells ≥ 478/548
  (lowest two-pass set), and the D6 check withholding **no** `period` or `paymentDate` in the new
  set.
- **D6 — An outline must show its value (region/text agreement), in the regions projection.**
  For each field, collect the OCR words of its own pass body whose quad centre lies inside the axis
  aligned box of any of its source segments (page word order, segments in source order). The field
  **agrees** when, for some form `f` of `[printed, ...surfaceForms(printed)]`:
  (a) `groundingKey(f)` is a substring of the concatenated `groundingKey`s of those words, or
  (b) every whitespace token of `f`, keyed, is among the words' keys (line wraps, reordering).
  A field that does not agree gets **no regions at all** (all its segments), exactly like a value
  with no source today. Words and keys reuse `grounding.ts` (`groundingKey`, `surfaceForms`); no new
  normalisation.
  - **Retroactive:** read-time, so every stored payslip benefits on deploy, including the product
    owner's A04 on V1. It does not depend on D1/D4.
  - **A page with no `words`** skips the check (it cannot say anything). Real bodies always carry
    words (measured: both pass bodies carry the same words); synthetic unit-test bodies do not.
  - **The principle is "the whole value is under the outline".** A correct but partial outline of a
    multi-line value is withheld too; measured below, once in 2,856, in the retired single-pass set.
  - **Measured in planning** (Python prototype of exactly this rule over `two-pass-sequential`,
    `two-pass-concurrent`, `hosted-quads`, `cu`: 2,856 outlined values): it withholds the wrong ones
    and one partial one. `currency` hits in the prototype are not region paths (the mapper ignores
    `currency`) and are excluded here.

    | Set | Withheld (field: value → words under the source) | Verdict |
    | --- | --- | --- |
    | two-pass-sequential | A01 `obustave.0.vjerovnik` NACIONALNI SP → zaposlenih centralizirani; `obustave.1.vjerovnik` and `obustave.2.vjerovnik` NSD KUP → narodna banka; B01 `period` → 2025 / 30; C01 `period` → 2025 / 01; C01 `paymentDate` → 2025 | all wrong |
    | two-pass-concurrent | B02 `period` 2025-05 → 2025 / 5; D01 `period` 2025-05 → 2025 / 01.05.25; D01 `paymentDate` → 20 , 10000 | wrong or pieces of a composed period |
    | hosted-quads | B01 and C01 `period`; B02 `period`; C01 `paymentDate` | as above |
    | cu (single-pass, retired) | A01 `obustave.4.naziv` (outline covers only its first line); B01, B02, C01, D01 `period`; C01, D01 `paymentDate` | one partial-but-right outline withheld |

    B02/D01's period pieces ("2025" and "5") are not on the wrong text, but they do not show the
    value either; with D1 the service returns the printed run and outlines it whole (two-pass
    concurrent B01/C01 and sequential D01 already do). The implementation re-measures this table in
    TypeScript (step 6) and must match it; any difference is investigated, not accepted.
- **D7 — Thinner outlines below `lg`.** `SourceOverlay` reads `useWideLayout()` (the `LG` query,
  `client/src/history/useWideLayout.ts`): below `lg` 0.5 px at rest / 1 px active, at `lg` 1 / 2 as
  now. The phone strip draws through the same component. Exported constants so the review session
  can tune them. `OUTLINE_GAP_PX` unchanged.
- **D8 — Form order.** `SCALAR_SECTIONS` becomes: employer (4), employee (4), period (`period`,
  `paymentDate`), reconciliation in IP1 order: `brutoPlaca`, `ukupnoSati`, `doprinosiNaPlacu`,
  `doprinosiIzPlace`, `doprinosMioIStup`, `doprinosMioIiStup`, `dohodak`, `osobniOdbitak`,
  `poreznaOsnovica`, `porezNaDohodak`, `netoPlaca`, `neoporeziviPrimiciUkupno`, `obustaveUkupno`,
  `iznosZaIsplatu`, `ukupanTrosakRada`. `ukupnoSati`'s outline turns the reconciliation colour by
  construction (`sectionOf`). The canonical schema, the export/CSV column order and
  `SCALAR_FIELDS` are **not** changed. Labels already distinguish the two contribution kinds
  ("Contributions on pay (employer)"); no copy change.
- **D9 — No change to the bake-off copy.** `scripts/bakeoff/field-schema.ts` is the Phase 2 record;
  only the production `field-schema.ts` changes.

## Feature Metadata

**Feature Type**: Bug Fix + Enhancement
**Estimated Complexity**: Medium
**Primary Systems Affected**: CU field schema and analyzers; regions projection (`api`); review
overlay and form order (`client`)
**Dependencies**: none new. One paid Azure run (D5).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `api/src/providers/document-extraction/content-understanding/field-schema.ts` (lines 22-62,
  130-170, 172-183) — `period`, `paymentDate`, the three array descriptions, `SHARED_RULES`.
- `api/src/providers/document-extraction/content-understanding/analyzer.ts` (whole, ~80 lines) —
  `ANALYZER_DESCRIPTION`, `passFields`, `analyzerIdFor`; the definition is built from the schema.
- `scripts/provision-analyzer.ts` (lines 1-60 and `ensureAnalyzer`) — creates a missing analyzer,
  reports drift (exit 1), `--replace`.
- `api/src/routes/extraction.integration.ts` (lines 31-70) — the paid golden run: `GOLDEN_SET`
  (refuses an existing set), `GOLDEN_MODE`, recording to `.bakeoff/<set>/`.
- `scripts/run-supabase-integration-tests.mjs` (lines 20-50) — passes `process.env` through to the
  child, so an exported `AZURE_CU_ANALYZER_ID` reaches the app. `node --env-file-if-exists=.env`
  does not override variables already set.
- `scripts/score-extraction.ts` (lines 1-80) — scores every set of the configured analyzer family.
- `api/src/providers/document-extraction/content-understanding/regions.ts` (whole, 161 lines) — the
  projection to extend.
- `api/src/providers/document-extraction/content-understanding/grounding.ts` (whole, 102 lines) —
  `groundingKey`, `surfaceForms`; its header comment says the schema asks for `paymentDate` as
  `YYYY-MM-DD` (update it; keep `surfaceForms`: stored V1 payslips still hold normalised dates).
- `api/src/providers/document-extraction/content-understanding/fields.ts` (lines 100-110, 145-210)
  — how the mapper reads `pages[].words` with zod and grounds values; mirror the `.loose()` style.
- `api/src/providers/document-extraction/content-understanding/regions.test.ts` (whole) and
  `regions.fixture.ts` (whole) — unit tests with synthetic bodies; the local-only recordings test
  (lines 173-232) asserts **every** read path is outlined, which D6 deliberately changes.
- `client/src/review/SourceOverlay.tsx` (whole) and `SourceOverlay.test.tsx` (lines 66-100: the
  `stroke-width` assertions).
- `client/src/history/useWideLayout.ts` — `LG` and `useWideLayout`.
- `client/src/review/LineItemSection.test.tsx` (lines 12-17) — the `stubWide` matchMedia stub to
  mirror.
- `client/src/review/regionSections.ts` (lines 34-63) and `regionSections.test.ts` (lines 25-40).
- `client/src/review/PayslipForm.tsx` (lines 34-43, 222-260) — `SCALAR_SECTION_ORDER`,
  `FIELDS_BY_SECTION`, the section loop.
- `client/src/review/SourceStrip.tsx` (lines 55-80) and `SourceDocumentPanel.tsx` (lines 94-100) —
  where "This value has no highlight on the payslip." (`review.stripNoOutline`) shows for a field
  without a region. At `lg` a field without a region simply has no outline; there is no note.
- `shared/src/datetime.test.ts` (lines 45-75) — the printed forms `parseDate` / `parsePeriod`
  already accept.
- `.agents/history/15-review-flow-iteration.md` — the history format to follow.

### New Files to Create

- `.agents/history/16-extraction-review-polish.md` — the record.
- No new source files.

### Patterns to Follow

- **zod narrow views** in `regions.ts` (`valueSchema`, `pageSchema`, `.loose()`): add
  `words: z.array(z.object({ content: z.string(), source: z.string() }).loose()).optional()` to
  `pageSchema`, parsed with the same `SEGMENT` regex.
- **Per-pass words:** each body is checked against **its own** pages' words, as `fields.ts` grounds
  each pass against its own words (Task 06 D8).
- **Tests:** vitest, `describe`/`it`, synthetic bodies through `regionsPassBody`, `sourced`, `rows`.
  Add a `words` field to `FixturePage` usage via a small `word(content, source)` helper in
  `regions.fixture.ts` (fixture files hold provider vocabulary; the Task 04 guard keeps it out of
  other modules).
- **Comments** cite the task and decision (`(Task 16 D6)`), in the files' existing voice.
- **Imports:** `api/` uses `.js` extensions on relative imports.
- **Doc edits:** LF only. Python on Windows writes CRLF unless `newline=""`; long Bash heredocs have
  failed to parse (history/15 deviation 12). Check `grep -c $'\r'` on every edited `.md`.

---

## IMPLEMENTATION PLAN

- **Phase A ($0, client):** form order (D8), thinner outlines (D7).
- **Phase B ($0, api):** region/text agreement (D6), measured over every recording.
- **Phase C (paid, ~$0.60):** schema wording (D1, D2), V2 analyzers (D4), one sequential run and
  the re-score (D5), observations (D3).
- **Phase D:** docs and history; stop before review.

---

## STEP-BY-STEP TASKS

### 1. Starting state

- **IMPLEMENT:** `git status` (clean at `fd50bc4`, plus this plan untracked); baseline
  `npm run validate` (76 files / 1,200 tests at the end of 15b). Record both.
- **VALIDATE:** `npm run validate`

### 2. UPDATE `client/src/review/regionSections.ts` — form order (D8)

- **IMPLEMENT:** reorder `SCALAR_SECTIONS` exactly as D8; `ukupnoSati: "reconciliation"`. Update the
  doc comment above it to say the reconciliation follows the IP1 print order (Task 16 D8).
  `SCALAR_LABEL_KEYS` order may stay (it is a lookup), but keep it in the same order for reading.
- **ADD tests:** `regionSections.test.ts`: `["ukupnoSati", "reconciliation"]` in the `maps` table.
  `PayslipForm.test.tsx`: the pay-calculation section's inputs, in DOM order, carry the D8 order
  (query the `review-section-reconciliation` body's inputs by their `review-field-…` ids) and the
  period section holds only `period` and `paymentDate`. Red first.
- **GOTCHA:** `FIELDS_BY_SECTION` filters `Object.entries(SCALAR_SECTIONS)`, so entry order is the
  form order; nothing else needs to change. Do not touch `shared/src/payslip.ts` or the export.
- **VALIDATE:** `npx vitest run client/src/review/regionSections.test.ts client/src/review/PayslipForm.test.tsx`

### 3. UPDATE `client/src/review/SourceOverlay.tsx` — thinner outlines below `lg` (D7)

- **IMPLEMENT:** `import { useWideLayout } from "../history/useWideLayout";`. Export
  `STROKE_PX = { wide: { rest: 1, active: 2 }, narrow: { rest: 0.5, active: 1 } }` (or two named
  constants, matching the file's style); `strokeWidth` from `useWideLayout()` and `active`. Doc
  comment: 1 CSS px is ~3 device px on a phone, around rows 3.5–4.3 CSS px tall (history/15 finding
  6); the product owner judges on the phone.
- **UPDATE tests:** `SourceOverlay.test.tsx`: stub `matchMedia` as `LineItemSection.test.tsx:12-17`
  does; the two existing assertions become the wide case (`"1"`, `"2"`); add the narrow case
  (`"0.5"`, `"1"`). Red first for the narrow case.
- **GOTCHA:** without `matchMedia` (jsdom default) `useWideLayout` returns `false`, i.e. narrow.
  `SourceStrip` and `ZoomableSourceViewport` tests that assert stroke widths (grep
  `stroke-width` under `client/src`) must stub it too.
- **VALIDATE:** `npx vitest run client/src/review`

### 4. UPDATE `regions.fixture.ts` — words in fixture pages

- **IMPLEMENT:** `FixturePage` gains an optional `words?: Json[]`; add
  `export function word(content: string, source: string): JsonObject` returning
  `{ content, source, confidence: 0.99, span: { offset: 0, length: content.length } }`.
- **VALIDATE:** `npm run typecheck`

### 5. UPDATE `regions.ts` — region/text agreement (D6)

- **IMPLEMENT:**
  - `pageSchema` gains optional `words` (content + source).
  - `parseBody` also returns, per page number, the page's words as `{ key: groundingKey(content),
    centre: {x, y} }` in body order (centre = mean of the word quad's four corners, in the page's own
    units; skip a word whose source does not parse).
  - `addValue` collects the segments it would push; for each, the words whose centre lies in the
    segment's axis-aligned box. If the value's page has words and `!agrees(value.valueString,
    wordsUnderSegments)`, push nothing. Otherwise push the segments as today.
  - `agrees(printed, keys)` implements D6 (a) and (b) over `[printed, ...surfaceForms(printed)]`,
    ignoring empty keys. Import `groundingKey`, `surfaceForms` from `./grounding.js`.
  - Update the module doc comment: D5's "every region's origin is `model`" stands; add "an outline
    whose words do not show the value is withheld (Task 16 D6)".
- **GOTCHA:**
  - Page units: quads and word sources are in the same units per page (pixels or inches), so compare
    before dividing by the page size.
  - `groundingKey` keeps `-` and `/`; words come split (`SA`, `-`, `SALDA`), so (a) still meets a
    hyphenated value through concatenation.
  - Do not use `isGrounded`: it searches the whole page, which is exactly what let the A04 address
    pass.
  - `deduplicate` still runs after; unchanged.
- **ADD unit tests** (`regions.test.ts`, synthetic, red first):
  - a value whose words are under its quad is outlined;
  - A04's case: `vjerovnik` "SPH PU VUKOVAR" with a quad over a lone "VUKOVARA" word is withheld;
  - D01's case: `paymentDate` "2025-06-10" over "20" "," "10000" withheld; over "10.06.25" outlined
    (surface form);
  - C01's case: "2025-07-01" over a lone "2025." withheld (a fragment is not the value);
  - an amount "1.234,56" split into words "1.234,56" or "1" ".234,56" outlined;
  - a two-line value (two segments, one line each) outlined; one of its lines on the wrong words →
    the whole field withheld;
  - a page without `words` → outlined as today (existing tests keep passing unchanged);
  - an OIB value "12345678901" over "HR12345678901" outlined.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/regions.test.ts`

### 6. UPDATE the local-only recordings test in `regions.test.ts` (D6 measurement)

- **IMPLEMENT:** add `hosted-quads` (two-pass) to `SETS`. Replace "every read path has an outline"
  with: the set of read paths **without** an outline equals an explicit expected map per set and
  sample, copied from D6's table (without `currency`). Keep the page-number, corner-range and page
  count assertions. Name the map `EXPECTED_WITHHELD` with a comment citing Task 16 D6.
- **GOTCHA:** if TypeScript withholds something the prototype did not (or keeps something it
  withheld), print both lists and investigate the difference (centre test, key, token split) before
  touching the table. The table is evidence, not a target to fit.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/regions.test.ts`
  (runs locally because `.bakeoff/cu` exists)

### 7. `npm run validate` checkpoint ($0 work complete)

- **VALIDATE:** `npm run validate`, `npm run build`, `npm run score:extraction` (V1 sets unchanged:
  exit 0; D6 does not touch scoring).

### 8. UPDATE `field-schema.ts` — D1 and D2

- **IMPLEMENT (Croatian, same voice as the file):**
  - `period`: "Obračunsko razdoblje na koje se plaća odnosi. Prepiši ga TOČNO kako je ispisano, bez
    pretvaranja u drugi oblik — npr. 'svibanj 2025.', 'GODINA 2025, MJESEC 6', 'OBRAČUN PLAĆE
    2025-06' ili '1.05.2025 do 31.05.2025'. NIJE isto što i datum isplate, koji je obično sljedeći
    mjesec." (the month-name table is removed).
  - `paymentDate`: "Datum isplate, prepisan TOČNO kako je ispisan (npr. '09.06.2025', '10.06.25').
    Ispisano kao 'Datum isplate', 'Datum određen za isplatu' ili 'DATUM I IZNOS ZA ISPLATU'. NE
    uzimaj datum obračuna ni datum ispisa dokumenta."
  - Append to each of `payComponents`, `obustave`, `neoporeziviPrimici` descriptions: " Retke vrati
    redoslijedom kojim su ispisani na dokumentu, odozgo prema dolje."
  - `SHARED_RULES` unchanged (D3; the amount-format line is noted, not changed — Notes).
- **UPDATE:** `grounding.ts` header: the schema no longer asks for `YYYY-MM-DD`; `surfaceForms` stays
  for stored payslips analysed before Task 16 and for the OIB `HR` prefix.
- **GOTCHA:** tests that snapshot descriptions (grep `YYYY-MM` under `api/src`) need updating; the
  provider vocabulary guard is unaffected.
- **VALIDATE:** `npm run typecheck && npx vitest run api/src/providers`

### 9. Provision the V2 family (free) (D4)

- **IMPLEMENT:** `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run provision:analyzer`. Expected: defaults
  present; `hrPayslipV2_scalars` and `hrPayslipV2_tables` **created**. Run it a second time: both
  match (exit 0).
- **GOTCHA:** never run `--replace`. `npm run provision:analyzer` with the default `.env`
  (`hrPayslipV1`) now reports drift, by design, until the product owner switches; record that. The
  key is never printed.
- **VALIDATE:** the second run exits 0.

### 10. The paid run (D5) — PAID, ~$0.60, once

- **IMPLEMENT:** `AZURE_CU_ANALYZER_ID=hrPayslipV2 GOLDEN_SET=task16-sequential GOLDEN_MODE=sequential npm run test:extraction`.
  Record start time, duration, pass/fail, the harness's cost estimate and a running total.
- **GOTCHA:**
  - Confirm from the run's own log that the V2 analyzers were called (the recording's `analyzerId`
    inside each body must be `hrPayslipV2_*`; check one file before scoring).
  - If it fails for an infrastructure reason (network, Render/Supabase), stop and ask before
    re-running; a second paid run needs the product owner's go-ahead.
- **VALIDATE:** 11 files in `.bakeoff/task16-sequential/`.

### 11. Score and measure (D5, D3, D2)

- **IMPLEMENT:**
  - `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run score:extraction` → scalars, critical, cells, OIB pass
    rate for `task16-sequential`. Compare with the V1 two-pass sets (run `npm run score:extraction`
    under V1 for the reference numbers).
  - Per sample, `period` and `paymentDate`: the value returned (printed or normalised), whether it
    scores, and the words under its source.
  - Add `task16-sequential` (two-pass) to step 6's `SETS` with its own `EXPECTED_WITHHELD`, which must
    hold **no** `period` / `paymentDate` entry (D5 acceptance). Other entries are recorded as found.
  - A04: obustave row order (printed order?) and `obustave.0.iznos` (40,00 or null). Record only (D3).
- **ACCEPTANCE (D5):** scalars ≥ 268/273, cells ≥ 478/548, no period/paymentDate withheld. If any
  fails: record it, revert step 8 (V2 stays deployed but unused), keep steps 2–6, and tell the
  product owner. Do not iterate on wording without the go-ahead.
- **VALIDATE:** `npx vitest run api/src/providers/document-extraction/content-understanding/regions.test.ts`

### 12. Docs

- **UPDATE `PRD.md`:**
  - §7.5 Rules: "Since Task 16: an outline is drawn only when the OCR words under it show the value
    (its printed text or a form of it); otherwise the value has no outline, as when the service
    gives no source. A value printed across lines needs all its lines." Note the Task 08 coverage
    figure (100% of non-null scalars) no longer holds by design.
  - §7.7: "Settled in Task 16" — reconciliation order (D8), `ukupnoSati` in the pay calculation,
    thinner outlines below `lg` (D7).
- **UPDATE `CONTEXT.md`:** Source Region: "An outline is drawn only where the page's words show the
  value."
- **UPDATE `.agents/ROADMAP.md`:** §2 Task 16 line (plan, record, status); §5 "Service source on the
  wrong text" → **Closed (Task 16)** with the measured table's summary; nothing in §1 changes
  (decision 13 is restored, not altered).
- **CREATE `.agents/history/16-extraction-review-polish.md`:** outcome, files, decisions, deviations,
  validation table, the paid run and its cost, the scoring comparison, D6's measured table (TS),
  observations (A04 order / 40,00), open items, review-session handoff (below).
- **VALIDATE:** `npm run format:check`; `grep -c $'\r' PRD.md CONTEXT.md .agents/ROADMAP.md .agents/history/16-extraction-review-polish.md` → all 0.

### 13. Final checks, then stop

- **VALIDATE:** `npm run validate`, `npm run build`, `npm run check:secrets`,
  `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run score:extraction`, `npm run check:golden`,
  `git diff --check`, `package-lock.json` unchanged. Do **not** run `/code-review`, `/validate`,
  browser journeys, commit, push, or change Render.

---

## TESTING STRATEGY

### Unit Tests

- Form order and `ukupnoSati`'s section (step 2).
- Stroke widths wide / narrow (step 3).
- The agreement rule on synthetic bodies (step 5): every case listed there, each red first.

### Recording tests (local-only, $0)

- `regions.test.ts` over `two-pass-sequential`, `two-pass-concurrent`, `hosted-quads`, `cu` and, after
  step 10, `task16-sequential`: withheld paths equal `EXPECTED_WITHHELD` exactly.
- `npm run score:extraction` for V1 (unchanged) and V2 (the new set).

### Integration Tests

- `npm run test:integration` is not required by this change (no route, schema or repository
  change). The paid golden run (step 10) is the only integration run.

### Edge Cases

- A normalised date from an older stored payslip whose source is right (`2025-06-09` over
  `09.06.2025`): outlined through `surfaceForms`.
- A value on page 2 with words only on page 1's list: words are per page; use the segment's page.
- Identical quads for two fields (`deduplicate`): each field is checked on its own first.
- An unreadable value (printed but not normalisable) still outlines when its words agree (Task 08 D6).
- A word straddling the box edge: centre test; documented.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` · `npm run format:check`

### Level 2: Unit Tests

`npm run test` (and the focused `npx vitest run <file>` commands per step)

### Level 3: Scoring and recordings

`npm run score:extraction` · `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run score:extraction` ·
`npm run check:golden`

### Level 4: Paid (once)

`AZURE_CU_ANALYZER_ID=hrPayslipV2 GOLDEN_SET=task16-sequential GOLDEN_MODE=sequential npm run test:extraction`

### Level 5: Review session (not this session)

`/code-review` against `fd50bc4`; `/validate`; a browser pass: B01/C01/D01 outlines (on V2 uploads
after the switch, and on the existing V1 payslips, where D6 withholds the wrong ones), the phone
strokes at 375 px with touch emulation, the form order. Then the product owner switches Render to
`hrPayslipV2`, and judges the strokes on the Android phone.

---

## ACCEPTANCE CRITERIA

- [ ] The pay calculation lists fields in D8's order; `ukupnoSati` is in it, outlined in its colour.
- [ ] Outlines are 0.5 / 1 px below `lg` and 1 / 2 px at `lg`.
- [ ] An outline whose words do not show its value is not drawn; the recordings' withheld sets match
      D6's table, and the synthetic cases in step 5 pass.
- [ ] `task16-sequential` on V2: scalars ≥ 268/273, cells ≥ 478/548, no `period` / `paymentDate`
      outline withheld. Exactly one paid run, cost recorded.
- [ ] `npm run validate`, build, `check:secrets`, both `score:extraction` runs and `check:golden` pass.
- [ ] PRD §7.5/§7.7, CONTEXT, ROADMAP §2/§5 and history/16 updated; LF only.
- [ ] Production still on `hrPayslipV1`; the switch is handed off.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–13 in order, each validation run and recorded
- [ ] Red-first or bite-checked tests recorded per step
- [ ] Paid runs: 1, cost and running total in history/16
- [ ] Stopped before review, `/validate`, browser, commit and the Render switch

---

## NOTES

**Left as they are (investigated in planning, with evidence):**

- **A04 deduction names split across rows** ("KONTROLOM" at the start of row 2, "IZNOSU, BEZ KONTROLE
  SALDA" at the start of row 4). The service's OCR table (`markdown`) already splits the wrapped
  names that way on this screenshot, whose text is ~8 px tall; the model copies it faithfully. Not
  fixable at our layer; a sharper photo is.
- **A04's seventh deduction (6,98, SPH SREDIŠNJICA ČLANARINA)** is on page 2 of the screenshot under
  the app's floating pencil button. Missing is correct.
- **F01 employer name.** The name is cropped under the viewer's "1/1" badge (fixture README). Runs
  return null (3 of 6 recordings), "ZAGREB", "Stipanović Renata" (the employee) or "ESBCHR22" (the
  SWIFT code), always at low confidence, so it is always marked. The description already says to
  return null when there is no employer block. More negative rules for one cropped screenshot are the
  rule creep ADR-0001 warns about.
- **C01 "Saldo" is the remaining debt.** 10/120 instalments of 451,15 leave 110 × 451,15 =
  49.626,50, exactly the printed saldo, so `ostatakSalda` is right.

**Observed, not in scope:**

- `SHARED_RULES` also says "Vrati SVE iznose kao … '1234.56'", which contradicts decision 13 too, but
  amounts come back printed in every recording and their outlines agree, so it is left.
- G01 `period` is null in most runs. Unrelated to highlighting; not investigated here.
- With D6, some composed periods in V1 recordings (B02 "2025" + "5") lose an outline that sat on
  real pieces of the value. Accepted: the rule is "the whole value under the outline", and D1 makes
  the service return the printed run.

**Risks:**

- **D1 may move accuracy.** The mapper parses every printed form in the golden set, so scoring
  should hold; the single run's result is judged against the recorded band, not a single figure.
- **0.5 px strokes on a narrow desktop window at DPR 1** render as a faint antialiased line. The
  product owner judges on the phone; the constants are exported for the review session to tune.
- **One run is one sample** of a nondeterministic service (the A04 order and the address source were
  both run-to-run effects). D6 does not depend on it; D1/D2 are judged on the aggregate.

**Confidence:** 8/10 for one-pass implementation. The agreement rule is measured already; the paid
run is the one step whose outcome is not known in advance.
