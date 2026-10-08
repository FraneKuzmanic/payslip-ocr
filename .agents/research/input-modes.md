# OCR text or the document itself: what should the model be given?

**Date:** 2026-10-08
**Question (product owner's manager):** does OCR first, then an LLM over the text, give better or
worse results than handing the original file to a multimodal LLM?
**Harness:** `npm run input-modes` (`scripts/bakeoff/run-input-modes.ts`), scored with
`npm run score -- input-modes/<arm>-r<rep>`. Records in `.bakeoff/input-modes/` (git-ignored).

## Method

The 11 golden-set payslips, three times each, through one `gpt-4.1` deployment (chat completions
`2024-10-21`, temperature 0, strict JSON schema), with the production field schema and
`SHARED_RULES`. Only the user message differs:

| Arm | The document is sent as |
| --- | --- |
| `ocr` | DI `prebuilt-layout` markdown (the responses recorded on 2026-09-20 in `.bakeoff/layout/`) |
| `images` | one image per page, `detail: high`; PDF pages rendered at 150 DPI with pdf.js |
| `files` | the source file: a PDF as a `file` part, an image as an image |
| `crops` | every page as overlapping horizontal bands, twice as wide as tall (4 for an A4 page rendered at 200 DPI, 3–5 for a photo), with one sentence saying so |

The first three arms ran interleaved, sample by sample, sequentially; `crops` ran alone a few
hours later the same day. For the five image sources `images` and
`files` are the same request, so they are two samples of one condition. For the six PDFs they
differ: the service reads a PDF file part as its text layer plus a picture of each page.

132 calls, none failed, none throttled.

## Results

Ranges are over the three runs.

| | `ocr` | `images` | `files` | `crops` |
| --- | --- | --- | --- | --- |
| Scalar fields (of 273) | **272–273** | 235–238 | 247–248 | 266–268 |
| Critical fields (of 77) | **76–77** | 66 | 71 | 75–76 |
| Pay-component cells (of 180) | **179** | 64–84 | 112–114 | 157–169 |
| Obustave + neoporezivi cells (of 188) | 165–167 | 117–120 | 132–133 | **177–180** |
| Input tokens, median per document | 6,417 | 5,449 | 5,449 | 9,592 |
| Output tokens, median per document | 762 | 707 | 691 | 761 |
| Latency p50 / p90 | 9.6 / 19.1 s | 10.4 / 17.1 s | 10.0 / 20.7 s | 11.3 / 24.2 s |
| Cost per document, as billed (cached input) | $0.026 | $0.012 | $0.012 | $0.017 |

By source:

| | `ocr` | `images` | `files` | `crops` |
| --- | --- | --- | --- | --- |
| Six native PDFs: scalars (of 150) | 150 | 135–138 | 149 | 147 |
| Six native PDFs: pay-component cells (of 86) | 85 | 39–54 | 85 | 79–83 |
| Six native PDFs: other table cells (of 115) | 98–100 | 73–75 | 89 | 106–109 |
| Five images: scalars (of 123) | 122–123 | 99–100 | 98–99 | 119–121 |
| Five images: pay-component cells (of 94) | 94 | 25–30 | 27–29 | 78–86 |
| Five images: other table cells (of 73) | 67 | 44–45 | 43–44 | 71 |

Reference, Content Understanding on the same documents: 281/284 scalars and 170/180 pay-component
cells in the bake-off (2026-09-20, a schema that still had `currency`); 269–272 of 273 scalars in
the Task 17 sets.

## What it shows

- **Resolution was most of the gap.** With each page sent as bands, direct input is within about
  five scalar fields of OCR (266–268 against 272–273), behind on pay components (157–169 against
  179: rows dropped or repeated, the row count exact on 6–8 of 10 documents against 10) and
  ahead on the other two tables (177–180 against 165–167). It costs 1.5 times the tokens of the
  OCR arm, is a second or two slower, and is still cheaper ($0.017 against $0.026).
- **Accuracy with the page sent whole: OCR first wins, by a wide margin wherever the model has
  to read pixels.** On the image sources the whole-page arms lose about 19 points of scalars and two thirds of the
  pay-component cells. The errors are misreadings and inventions, not formatting: B01's employee
  OIB `48005353134` read as `80005353134`, `praznik` as `prazan`, B02's bruto plaća `1348.76` as
  `1799.05`, rows dropped (A01 21 of 23, B02 4 of 6).
- **A PDF sent as a file is close to OCR, because it is text.** On the six native PDFs `files`
  matches `ocr` on scalars and pay components and is lower on the other tables (89 against
  98–100 of 115). The same PDFs as pictures fall to the image-source level. So the result for a
  PDF depends on its text layer, not on the model's eyes.
- **Input tokens: a whole page is lower, not higher.** About 4,400 tokens of every request are the
  schema and rules. A page costs roughly 700–1,000 tokens as an image and 1,200–5,000 as markdown.
- **Latency: no difference for a whole page.** The model answers a text request in 4.2 s (p50) and an image or
  file request in about 10 s: first token after 1.7 s against 0.7 s, and 10 ms a token against 4.
  The OCR call (4.7 s, recorded on 2026-09-20) fills the gap exactly.
- **Cost: a whole page is about half**, since the $0.01 per page OCR charge is the largest single item.

## Limits

- 11 documents, 7 layouts, one model. A newer or larger multimodal model may read better.
- In `images` and `files` an image is sent whole. At about 1,000 tokens the model sees an A4
  page at roughly 768 px across, where a payslip's table print is a few pixels tall. `crops` is
  the arm that removes this; one band shape was tried, not tuned.
- The `ocr` arm's OCR time and price are the recorded call's and DI's list price, not re-measured.
- Direct input returns no confidence, and its positions are not usable (below), so it cannot
  draw outlines or mark an ungroundable value (ROADMAP §1, decision 16), whatever its accuracy.

## Can the model say where a value is?

`npm run boxes` (`scripts/bakeoff/run-boxes.ts`): every page as an image, as in `images`, and for
each scalar field the value, its page and a box in thousandths of the page. Each box is judged
against the place the OCR words put that same value; a value printed several times is judged
against the nearest. 11 calls, one run.

| | Boxes judged | Centre on the value's text | Any overlap | IoU ≥ 0.5 | Median miss |
| --- | --- | --- | --- | --- | --- |
| All | 232 | 4 (2%) | 16 (7%) | 0 | 6.6 text heights down, 19% of the page across |
| Native PDFs | 133 | 4 (3%) | 10 (8%) | 0 | 6.7 text heights, 20% |
| Images | 99 | 0 | 6 (6%) | 0 | 7.9 text heights, 15% |

22 further values are not among the page's words and could not be judged; 3 boxes named another
page than the value is on. Drawn on E01, the boxes sit in blank areas of the page. `gpt-4.1`
returns a box when asked and the box is not where the value is. The test was not repeated on the
bands or on another model.

## Spend

Azure OpenAI only, estimated from the recorded `usage` at list price: $1.27 for the first three
arms (99 calls), $0.58 for `crops` (33) and $0.13 for the boxes (11): **about $1.98**, plus
three probe calls under $0.01. No Content Understanding or Document Intelligence call.

## Harness changes

- `scripts/bakeoff/run-input-modes.ts` (`npm run input-modes`), `run-boxes.ts` (`npm run boxes`)
  and what they share, `model-input.ts`. It imports `@napi-rs/canvas`, which pdfjs-dist installs.
- `scripts/bakeoff/score.ts`: `--only=<samples>`; a separate line for obustave and
  neoporeziviPrimici cells; `currency` is not scored for a set whose schema did not ask for it;
  a period printed after its label is read with the production `parsePeriod`. The recorded `cu`
  and `llm` sets score as before (281/284 each; 170 and 174 of 180).
