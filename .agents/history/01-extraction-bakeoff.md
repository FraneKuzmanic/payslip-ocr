# 01 — Extraction bake-off (PRD Phase 2)

**Date:** 2026-09-20
**Outcome:** ADR-0001 confirmed. Azure AI Content Understanding is the primary engine; the
DI-layout + LLM challenger stays implemented as the measured fallback.

## What was run

Both engines over the same 11 golden-set payslips (7 layouts, ~10 employers), same Croatian
field schema, same shared rules — so the comparison is of engines, not of prompts.

- **Primary** — Content Understanding custom analyzer `hrPayslipV1`, api-version `2025-11-01`,
  base `prebuilt-document`, `estimateFieldSourceAndConfidence: true`, backed by a `gpt-4.1`
  deployment on the same Azure AI Foundry resource (Sweden Central).
- **Challenger** — DI `prebuilt-layout` (`2024-11-30`) → markdown → `gpt-4.1` with a strict JSON
  schema → values re-grounded against OCR word polygons by string matching.

## Results

Final figures, after the golden set's two open judgement calls were settled (E01 `employerName`
and G01 `period` both → `null`) and after the submit-stall mitigation below.

| | Content Understanding | Layout + gpt-4.1 |
| --- | --- | --- |
| Scalar fields | **281/284 — 98.9%** | **281/284 — 98.9%** |
| Critical fields | 75/77 — 97.4% | 75/77 — 97.4% |
| Line-item cells | 170/180 — 94.4% | 174/180 — 96.7% |
| Row count exact | 9/10 docs | 9/10 docs |
| **Per-field geometry** | **native, 100% of returned values** | reconstructed, 98.4% ceiling |
| **Per-field confidence** | **native** | none |
| Latency (mean) | **15.1 s** (median 13.4 s) | **13.9 s** |
| Cost per doc | CU pages + gpt-4.1 tokens | ~$0.032 ($0.010 + $0.022) |
| Value format | as printed (`svibanj 2025.`) | canonical (`2025-05`) |

Both clear the PRD §11.3 targets (≥95% scalars, ≥85% line items), and on accuracy they are a
**dead tie**.

**Both engines are non-deterministic across identical runs.** CU scored 98.9% → 99.3% → 98.9% on
three runs of the same inputs against the same analyzer; the challenger moved its line-item cells
99.4% → 96.7% when only a field *description* changed. The run-to-run swing is 1–2 fields, about
0.5%. **Any gap smaller than that on this corpus is noise**, and no single run should be quoted as
a ranking. Accuracy did not decide this.

## What decided it

**Geometry.** CU returns `source: "D(page,x1,y1,…,x4,y4)"` plus `confidence` on every non-null
field, including nested table rows — 100% coverage, no grounding code. The challenger has to
reconstruct boxes by matching values back to OCR words, which tops out at **98.4%** even when fed
the golden set's known-correct values, and cannot ground `currency` (never a page token) or
`period` on three of seven layouts (year and month are not adjacent: `GODINA 2025, MJESEC 6`).
Per-field highlighting is a hard requirement, so an engine that supplies it natively wins.

**Confidence.** CU gives a per-field number that drives the review form's "check this" marking
directly. The challenger has no equivalent signal.

## Findings worth keeping

**CU returns what is printed; it does not normalise.** It answers `svibanj 2025.` and
`09.06.2025`, not `2025-05` / `2025-06-09`, despite explicit instructions. This is *correct*
behaviour for an extractor — and useful, because the returned string matches the page and
therefore matches its own bounding box — but **normalisation is the mapper's job**, not the
engine's. Scoring raw strings initially penalised CU for a formatting choice and understated it
by ~4 points.

**Grounding is a hallucination detector, not a correctness checker.** On A04 — the screenshot
where a floating UI button clips the last obustava — the challenger guessed `3.98` for the
clipped `…98` (true 6.98), summed its own rows to `228.57`, then *computed*
`iznosZaIsplatu = 2033.32 − 228.57 = 1804.75` despite being told never to derive an unprinted
value. Both invented figures were **ungrounded**, and they were the only ungrounded fields on that
document. Excluding `currency` and `period` (non-groundable by design), grounding scored
**100% precision, 50% recall**: it catches values the model invented, and cannot catch a value
that is genuinely on the page but the wrong one.

**Each engine hallucinates differently.** The challenger invents values it cannot read. CU
misattributes: on F01, where the employer name is cropped away, it answered `Tomislav Janžek` —
the *signatory* from the bottom of the page. Both failures are on identity/total fields, both are
detectable (ungrounded / low confidence), and neither engine returns `null` as readily as it
should.

**An ambiguous field description costs more than a weak model.** Two of the challenger's four
initial errors were `ukupnoSati`, whose description listed both "hours beside the gross total"
and "monthly fond sati" as targets — and the documents print both. Tightening the description to
one definition fixed both. The schema's wording is the highest-leverage thing in this pipeline.

## Undocumented setup steps (cost ~6 failed attempts)

1. Analyzer IDs **cannot contain `-`** (`hr-payslip-v1` → `hrPayslipV1`).
2. Base analyzer is **`prebuilt-document`**; `prebuilt-documentAnalyzer` does not exist.
3. A resource needs `PATCH /contentunderstanding/defaults` **once** before any custom analyzer
   can be built, and `modelDeployments` is a map of **model name → deployment name**. The
   analyzer's own `models.completion` must reference a key registered there.
4. CU needs **two** deployments: a completion model *and* an embedding model
   (`text-embedding-3-large`), the latter demanded as `prebuilt-analyzer-embedding`.
5. `:analyze` accepts JSON (`{url}`) only. Raw bytes go to **`:analyzeBinary`** — which is what
   local files that must not be published anywhere require.
6. Content Understanding GA is **not available in Italy North**; Sweden Central works.

## The latency problem — diagnosed and mitigated

The first batch measured **43.5 s mean, 72 s max**, which badly missed the ≤10 s target. It was
not the model, the payload, or the network.

Splitting submit from analysis isolated it:

```
submit : median  1.9 s   but intermittently 29–55 s
analyse: median  7.9 s   <- the actual work, already within target
```

Evidence that the stall is **server-side**:

- **TCP connect is always 0.07–0.14 s**, even on a request whose 202 takes 29 s. The connection is
  instant; the service sits on the request.
- **Uncorrelated with payload size** (r = −0.18): a 3.5 MB file submitted in 1.9 s while a 72 KB
  one took 35 s.
- **Not IPv6 Happy-Eyeballs**: forcing IPv4 (`curl -4`) reproduced the stalls identically.
- **Always clears on retry**, and always lands near ~29 s or ~55 s, which looks like a fixed
  internal timeout rather than work.

**Mitigation, implemented in `run-cu.ts`:** give the submit a 5 s budget, abandon it and
resubmit. That took the batch from **43.5 s mean / 72 s max to 15.1 s mean / 13.4 s median /
26.3 s max**; a single-document probe over six runs averaged 10.9 s. The trade-off is that an
abandoned submit may still be queued server-side, so a stall can cost one duplicate analysis —
cheap against the latency won, but it means billing is slightly above document count.

This removed latency as a differentiator: CU at 15.1 s against the challenger's 13.9 s.

## Open risk

**Residual latency.** 15.1 s mean still exceeds the ≤10 s target, and the mitigation converts a
stall into a retry rather than removing it. Before Phase 3 commits to the review-screen UX:
re-measure on a provisioned (non-student) deployment, and tune the 5 s submit budget — a shorter
budget retries sooner at the cost of more duplicate jobs. The PRD's design already masks much of
this by landing the user on the review screen immediately with per-payslip status, so the number
to protect is *time to first usable form*, not time to last.

## Follow-ups

- Re-measure CU latency on a provisioned deployment; tune `SUBMIT_TIMEOUT_MS`.
- Report the submit stall to Azure support — connect-fast/respond-slow with size independence is
  a service-side defect, not a client one.
- Port `asPeriod`/`asDate` normalisation from `score.ts` into the production mapper.
- Keep grounding in the product even on CU: "could not ground" is a first-class attention signal.
- Settle the two golden-set judgement calls still outstanding (E01 `employerName`, G01 `period`);
  G01's `period` is the one field CU and the golden set disagree on, and CU's `null` may be right.

---

## Addendum, 2026-09-21 — completion-model comparison

Question asked: is the completion model the latency bottleneck, and would a different one help?

**Where the time goes.** A floor probe (same analyzer config, but a field schema of one trivial
field) isolates OCR from field extraction:

| doc | table rows | OCR floor (1 field) | full (29 fields) | model's share |
| --- | --- | --- | --- | --- |
| E01 | 4 | 3.5 s | 5.8 s | 2.3 s — 40% |
| A02 | 18 | 3.8 s | 9.7 s | 5.8 s — 60% |
| A01 | 43 | 4.3 s | 21.0 s | **16.8 s — 80%** |

OCR is a near-constant **~4 s** regardless of content. Everything above it is the completion
model, and it scales with output volume: correlation of latency with CU's own output tokens is
0.54, with table rows 0.56. The challenger reports this directly — `engine_tbt_ms: 11`, i.e. 11 ms
per output token, so A01's 3,371 completion tokens take ~37 s of its ~40 s.

**So the model is the bottleneck, and there is a hard ~4 s floor no matter which model runs.**

### gpt-4.1 vs gpt-4.1-mini, measured over the same 11 samples

| | gpt-4.1 | gpt-4.1-mini |
| --- | --- | --- |
| Scalar fields | **98.9%** | 96.5% |
| Critical fields | **97.4%** | 94.3% |
| Line-item cells | **94.4%** | 91.7% |
| Latency (mean) | **14.0 s** | 23.6 s |
| Output tokens (11 docs) | 15,510 | 15,575 — **1.00×** |
| Model cost per doc | $0.0348 | **$0.0071** — 4.9× cheaper |
| Documents completed | 11/11 | 10/11 (B02 failed submit 4× on two separate runs) |

**Conclusion: keep `gpt-4.1`. A model swap is not the latency lever.**

- **Smaller did not mean faster.** mini emitted an identical number of output tokens (1.00×) yet
  took 1.7× the wall-clock. Same work, slower delivery, which points at the **deployment's
  throughput quota**, not the model — a freshly created deployment on a student subscription, and
  the same deployment that failed submit repeatedly. This is a property of *this resource*, not a
  general statement about gpt-4.1-mini.
- **It also cost accuracy**: −2.4 pp on scalars, −3.1 pp on critical fields, and one document it
  could not complete at all.
- **Bigger would be worse.** gpt-5-class models are reasoning models: they emit reasoning tokens
  that you wait for and pay for, on a task that is transcription rather than reasoning, where we
  are already at 98.9% and the remaining errors are a hallucination on a physically occluded field
  and a misattribution — failure modes confident inference makes *more* likely, not less.
- **Cost is not a live constraint.** At $0.035/doc, a hundred demo documents is $3.50. The 4.9×
  saving mini offers is real but buys nothing we need, and pays for it in accuracy.

The lever is **emitting fewer tokens**, not changing who emits them. See
`.agents/specs/two-pass-extraction.md`.
