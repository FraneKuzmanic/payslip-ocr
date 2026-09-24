# Golden set — expected extraction results

Ground truth for the 11 payslips in `payslip_examples/`. Every candidate extraction engine is
scored against these files by `scripts/score-extraction.ts`.

The source documents are **not** committed — they contain real names, addresses, OIBs, IBANs and
salaries. These expectation files contain the same data and are committed only because the
prototype's repository is private. Treat them as personal data.

## How this was built

Each document was read **visually**, page by page, from a rendered image — not from its PDF text
layer. That matters: `pdftotext -layout` misaligns the A-family pay tables by one row, which
silently pairs every amount with the wrong label, and it swapped the two `neoporezivi primici`
amounts on A01. Five of the eleven are phone screenshots or photos with no reliable text layer at
all.

Every figure was then checked against the document's own arithmetic. `scripts/check-golden-set.py`
re-runs those checks:

- `dohodak = brutoPlaca − doprinosiIzPlace`
- `doprinosiIzPlace = doprinosMioIStup + doprinosMioIiStup`
- `poreznaOsnovica = max(0, dohodak − osobniOdbitak)`
- `netoPlaca = dohodak − porezNaDohodak`
- `iznosZaIsplatu = netoPlaca + neoporeziviPrimiciUkupno − obustaveUkupno`
- `ukupanTrosakRada = brutoPlaca + doprinosiNaPlacu + neoporeziviPrimiciUkupno`
- each table sums to its stated total
- both OIBs pass the ISO 7064 MOD 11,10 check digit

All eleven pass all applicable checks. Tolerance is an absolute 0.01, never relative.

## Corpus

11 payslips, 7 layout families, ~10 distinct employers. The letter prefix is the **layout**, not
the employer — A01 is the Ministry of the Interior, A02 a state rehabilitation centre, A03 a
university faculty, all on the same public-sector system (COP).

| Sample | Layout | Source | Pages | Notes |
| --- | --- | --- | --- | --- |
| A01 | A | native PDF | 2 | Richest document: 23 pay components, 18 obustave, genuinely multi-page |
| A02 | A | clean scan | 1 | |
| A03 | A | native PDF | 1 | Empty tables printed as 0,00 |
| A04 | A | phone screenshot | 1 | Browser chrome in frame; a UI button occludes a critical field |
| B01 | B | native PDF | 1 | Zero-floor case: osobni odbitak == dohodak |
| B02 | B | phone photo | 1 | Hardest image: angled, skewed, uneven light |
| C01 | C | native PDF | 1 | Non-IBAN in an IBAN field |
| D01 | D | native PDF | 2 | Party blocks reversed (employee left, employer right) |
| E01 | E | native PDF | 1 | No employer block at all |
| F01 | F | phone screenshot | 1 | Employer name cropped; no obustave section |
| G01 | G | phone screenshot | 1 | Scrolled past the entire identity header |

Four of the eleven are A-family. That is not over-sampling: A is Croatia's public-sector payroll
system and covers a large share of all employees in the country, so it is the highest-value layout
to get right — and the hardest.

## Field reference

Money and hours are **decimal strings** with a `.` separator (`"2298.97"`), normalised from the
documents' `1.234,56` convention. `null` means the value is not obtainable from this source file.
`period` is `YYYY-MM`; `paymentDate` is `YYYY-MM-DD`.

`null` and `"0.00"` are different and the distinction is deliberate. A03 prints its obustave total
as `0,00` with an empty table — that is `"0.00"`. F01 has no obustave section anywhere on the page
— that is `null`. An engine that conflates them is wrong.

## The `unscorable` key

Only G01 has one. It lists fields that are genuinely unreadable from the source, with a reason:

```json
"unscorable": [
  { "field": "payComponents", "reason": "Section VI is scrolled off the top of the screenshot." }
]
```

The harness must **skip these explicitly and say so in its report**. It must also **fail loudly if
any other expectation goes unscored**. receipt-ocr learned this the expensive way: a fixture
without ground truth was silently skipped, and eight defective receipts — including every known
defect — sat outside the corpus while the harness reported healthy numbers. A harness that quietly
drops what it cannot measure reports the health of the corpus it kept, not of the product.

## Scoring

Score **per field instance**, not per document. Eleven documents × ~15 core scalars ≈ 165
instances; at 11 documents a single bad one moves a per-document score by nine points, which is too
noisy to steer by. Targets are in `PRD.md` §11.3.

Note what this set can and cannot tell you. It covers seven vendors. It says nothing about an
eighth, and there are no more samples available.

## Open questions for the product owner

Five judgement calls are recorded in the fixtures' own `notes`. They are listed in full in the
session hand-off; the two that would change a score were **E01's `employerName`** (the only
candidate is sidebar software branding) and **G01's `period`** (inferable only from a date range in
the naknade table, since section V is off-screen). Both were settled to `null` during the bake-off
(`.agents/history/01-extraction-bakeoff.md`).
