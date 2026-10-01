# Research — Extraction latency: can first usable form reach ≤10 s?

**Date:** 2026-09-30
**Question:** where the ~12 s from upload to first usable form goes, every realistic option to get
it under PRD §11.4's ≤10 s, and whether that is reachable on this engine.
**Method:** offline only. Recorded responses under `.bakeoff/` (four two-pass sets, 44 scalars
passes and 44 tables passes, plus the bake-off's `cu`, `cu-mini`, `layout`, `llm` sets), the code,
the project's history, and Microsoft Learn primary sources. **No Azure call was made; $0 spent.**

Labels used throughout: **measured** (from a recording or a history file), **documented** (a
Microsoft Learn page), **inference** (my reasoning from those), **estimate** (a number I derived,
not measured). Latency on this service moves day to day (70–245 tok/s effective has been seen,
`history/05` "Finding"), and accuracy differences under ~0.5% are noise (ROADMAP §1 decision 15).

## 0. Update — the §7 experiment was run (2026-09-30), and it overturns §1 on option D

Approved by the product owner and run on 2026-09-30, 16:30–16:45 UTC. **Paid: one run, $1.17**
(55 analyses, priced with `usage.ts`). This is slightly above §7's $0.90 estimate, because both halves
were run, not one. The run was sequential per document from the development machine, polled every
250 ms, and the variant order rotated per document. Script and recordings:
`.bakeoff/latexp/` (git-ignored). The experimental analyzers were deleted afterwards.

Variants, all on `hrPayslipV2`'s scalar descriptions with `gpt-4.1`:
- **control:** `hrPayslipV2_scalars` as deployed;
- **v3:** control minus `currency`, with `enableFormula` and `enableBarcode` off (options A + B);
- **probe:** v3 config with only `employerOib`;
- **halves:** v3 config split into A (the 8 party fields, period, payment date; 10 fields) and B (the
  15 pay-calculation fields), submitted concurrently (option D).

Analysis time is measured from `202 Accepted` to the `succeeded` poll, so it excludes the upload:

| Analysis time (s) | p10 | p50 | p90 | mean |
| --- | --- | --- | --- | --- |
| control | 9.1 | **11.1** | 13.4 | 11.2 |
| v3 (trims) | 10.4 | 11.5 | 14.2 | 12.7 |
| probe (1 field) | 3.3 | 6.0 | 8.4 | 6.6 |
| **halves, slower of the two** | 4.9 | **7.0** | 8.6 | 6.9 |

Paired per document (same minute, same document):
- **halves − control: faster on 11 of 11 documents**, by 2.5–6.5 s, median **−4.4 s**;
- v3 − control: median +0.6 s, which is noise. B02's v3 run stalled at 27.0 s in analysis, not in
  submit.

Accuracy through the real mapper (tables taken from `task16-sequential` so `scoreSet` runs):
- control 269/273 scalars, 73/77 critical;
- v3 269/273, 73/77;
- **halves 270/273, 75/77**.

All three are inside the noise band. Splitting cost no accuracy on this sample.

Cost per document, scalars only:
- control $0.0244;
- halves $0.0413, **+$0.017**;
- probe $0.018, which is roughly the per-analysis fixed cost of pages, contextualisation and
  document input.

**What this changes:**
- **Option D works.** §3's weak token-to-time correlation across *different days and documents*
  hid a strong effect *within* a day. At ~300–400 output tokens per half, both halves finish in
  about the time of a 1-field probe plus ~1 s. On the D2 metric, a projected p50 of **~7.5 s**
  (7.0 s analysis + ~0.3–0.8 s Render→CU upload + ~0.1 s at 250 ms polling), p90 ~9.5 s, on a day
  when the single scalars pass ran p50 11.1 s. This is an estimate for one day; a slow service day
  moves both.
- **Options A + B give nothing measurable.** Drop them, or fold them in only for tidiness.
- **The floor is ~4–6 s and noisy.** The probe took 3.2–8.4 s, with one outlier at 18.5 s on A01.
  Splitting into three would approach it, with diminishing return (inference), and adds another
  ~$0.018 per document.
- **Cost:** a payslip goes from ~$0.048 to ~$0.065 (estimate: two scalars halves plus the tables
  pass), further above PRD §11.4's $0.01–0.02 per page.
- **Queue:** the cap of 3 counts analyses. One payslip becomes 3 analyses, so the cap needs to
  rise (for example to 4) for a single payslip's form not to wait on its own tables pass. A
  multi-payslip session queues more (ROADMAP §5, the four-in-parallel row).

---

## 1. Verdict

**≤10 s cannot be promised reliably on this engine, this schema and a pay-as-you-go `gpt-4.1`
deployment.** It is reached on fast service days and missed on slow ones, and nothing cheap moves
the median by more than ~1–2 s. In detail:

1. **The scalars pass is dominated by Content Understanding's own service time, and that time is
   noisy, not driven by our content.** Across all 44 recorded scalars passes the analysis took
   **p10 6.3 s, p50 11.0 s, p90 13.3 s**. Its output was a near-constant ~600 tokens (422–716), and
   analysis time correlates only weakly with output tokens (r = 0.32), input tokens (0.42) or cached
   tokens (−0.02) (measured, §3). The "~4 s floor + tokens ÷ rate" model explains the average,
   but not the spread.
2. **The metric we have been quoting is narrower than the PRD's wording.** Task 05 D2 defines first
   form as scalars `queuedMs + latencyMs`, which excludes the client upload, the API's Storage
   upload, the result write, the client's 2 s poll and the review's own fetches. Those add an
   estimated **~2–6 s** on top (§2). On the PRD's literal "upload to first usable form", today's
   p50 is ~14–19 s (estimate), not 12 s.
3. **The in-engine levers are small or conflict with locked decisions.** Analyzer config trims
   and faster polling are cheap and safe but worth well under a second each (estimate). Splitting the
   scalars pass further (history/05 option B) is the only structural lever inside the current
   design, but the weak token-latency correlation makes its gain **uncertain**, and a max over two or
   three noisy passes makes the tail worse. Dropping CU's source and confidence estimation would
   cut output tokens by an estimated ~30–50%, but that removes the native geometry that decided
   ADR-0001.
4. **Buying capacity does not guarantee it either.** Microsoft's own latency targets for `gpt-4.1`
   are "99% > 80 tokens/s" for both Provisioned Throughput and priority processing (documented,
   §6). At 80 tok/s a single 600-token stream is 7.5 s of generation on top of a ~3–4 s OCR stage, which
   is over 10 s before any upload or polling. PTU also starts at 15 units (documented), which is
   out of reach on student credit.
5. **The completion model is not the lever.** Azure's documented per-model targets put
   `gpt-4.1-mini` at > 90 and `gpt-4.1-nano` at > 100 tok/s against `gpt-4.1`'s > 80, so they are
   barely faster on paper. `gpt-4.1-mini` was measured 1.7× *slower* here. Locked decision 11
   stands, and the new documentation supports it.

**What would get there, in order of plausibility:**

| Rank | Combination | Expected first form (D2 metric) | Why it is not free |
| --- | --- | --- | --- |
| 1 | Config trims + 250 ms provider polling + split scalars into two ~300-token passes | p50 ~8–10 s on a normal day (estimate; **needs a paid run**) | +~$0.02/doc; cap-3 queueing worsens for batches; small accuracy risk from split context |
| 2 | (1) + priority processing on a Global Standard deployment | caps the slow-day tail (estimate) | premium token rate; eligibility of a student subscription unverified; data leaves the EU data zone |
| 3 | Drop source/confidence estimation on scalars; ground values ourselves from OCR words | p50 ~7–9 s (estimate) | reopens ADR-0001 and decisions 10 and 16; loses native confidence |

**Perception can be fixed today without touching the metric.** The user currently stares at a
text-only "still being read" panel (`client/src/routes/SessionPage.tsx:483–486`). Showing the
source document at once, and cutting the client poll and fetch overhead, helps what the user
experiences. Neither changes the measured number. §5.H says which is which.

---

## 2. Where the time goes (single payslip, scalars pass)

Stages run in order. "In D2?" says whether the stage is inside the quoted first-form metric
(`history/05` D2: `queuedMs + latencyMs`).

| # | Stage | Time | Kind | In D2? | Evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Phone → API upload (POST `/sessions/:id/payslips`) | ~1–3.5 s; first `201` measured 3.5 s at 1 MB | measured | no | `history/14` "The review route now misses ≤3 s" |
| 2 | API → Supabase Storage upload + row insert, **before** enqueue | 1.0–2.6 s on the dev machine; unmeasured on Render | measured (dev) | no | `api/src/routes/sessions.ts:65–99`; `history/14` same section |
| 3 | Queue wait (one payslip, two passes, cap 3) | ~0 ms | measured | yes | `hosted-quads` A01 `queuedMs` 1 |
| 4 | API → CU body upload + `202` (`uploadMs`) | Render p50 **0.43 s** (0.28–0.86); dev machine p50 1.8 s, B02 16 s (uplink) | measured | yes | `.bakeoff/*/timings.scalars.uploadMs`; `provider.ts:85–91` |
| 5a | CU OCR + layout | ~2–4 s | measured (DI) / inference | yes | DI `prebuilt-layout` service time 2–4 s (`.bakeoff/layout/*` `createdDateTime`→`lastUpdatedDateTime`); 1-field probe 3.5–4.3 s (`history/01` addendum) |
| 5b | CU → `gpt-4.1`: prompt + ~600 output tokens | ~3–9 s (remainder of 5) | inference | yes | output 422–716 tokens (§3) |
| 5c | Unexplained CU service variance | the 6.3 → 13.3 s p10–p90 spread | measured spread | yes | §3 |
| 5d | Provider poll quantisation (1 s interval) | mean ~0.5 s, max 1 s | inference | yes | `provider.ts:73`, `:230–231` |
| 6 | Result recorded (`complete_extraction_pass` RPC) | unmeasured; est. 0.1–0.3 s | estimate | no | `api/src/services/payslip-extraction.ts:90` |
| 7 | Client poll wait (`POLL_INTERVAL_MS` 2 s) | mean ~1 s, max 2 s, + one GET | inference | no | `client/src/routes/SessionPage.tsx:35`, `:118–129` |
| 8 | Review mount: GET detail + GET regions in parallel | unmeasured; est. 0.2–0.8 s | estimate | no | `client/src/review/PayslipReview.tsx:70–71` |

Stage 5, CU analysis (`analyzeMs`), is **p50 11.0 s**, which is ~85–90% of the D2 figure. Stages
1, 2, 6, 7 and 8 sit outside D2 and add an estimated **~2.5–6 s** at p50. One real observation:
in journey 9.13 the loading screen ran to 20.8 s for a payslip whose scalars pass took 14.9 s. So
~6 s sat outside the pass, including a 3.5 s first `201` (`history/14`, journey 9.13 step 2). That
was two files in one batch, so it is one data point, not a p50.

**Reported first-form figures (D2 metric):** Task 05 p50 12.2 s, p90 15.1 s; deployed Task 13 p50
11.9 s, p90 21.3 s; Task 16 V2 p50 13.7 s, p90 16.1 s (`history/05`, `history/13`, `history/16`).
Recomputed from the recordings: 12.2, 11.9 and 13.7 s, which matches.

---

## 3. What the recordings show (offline analysis, $0)

### Scalars pass, per document (`task16-sequential`, V2, 2026-09-29, sequential, dev machine)

| Doc | Pages | Input tok | Cached | Output tok | Upload s | Analysis s | Out ÷ (analysis − 4 s) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A01 | 2 | 14,130 | 0 | 652 | 1.0 | 12.7 | 75 tok/s |
| A02 | 1 | 10,227 | 6,400 | 619 | 2.3 | 12.2 | 75 |
| A03 | 1 | 9,854 | 6,400 | 610 | 0.4 | 11.9 | 77 |
| A04 | 1 | 12,135 | 6,272 | 634 | 2.8 | 13.3 | 68 |
| B01 | 1 | 8,899 | 6,272 | 657 | 0.5 | 11.0 | 94 |
| B02 | 1 | 9,582 | 2,816 | 601 | 16.6 | 13.0 | 67 |
| C01 | 1 | 9,221 | 6,272 | 678 | 0.7 | 12.1 | 84 |
| D01 | 2 | 10,523 | 6,272 | 630 | 1.8 | 11.8 | 80 |
| E01 | 1 | 8,399 | 6,272 | 497 | 0.3 | 8.5 | 111 |
| F01 | 1 | 9,180 | 6,272 | 598 | 2.0 | 12.0 | 75 |
| G01 | 1 | 9,217 | 6,272 | 422 | 2.2 | 8.3 | 98 |

The last column assumes the whole ~4 s floor is non-generation, which is itself uncertain.

### Across all four two-pass sets (44 scalars passes)

| Set | When (UTC) | Analysis p50 | Upload p50 | Output p50 | Cached share of input |
| --- | --- | --- | --- | --- | --- |
| `two-pass-sequential` | 09-24 20:08 | 10.7 s | 1.7 s | 619 | 67% |
| `two-pass-concurrent` | 09-25 07:38 | 7.5 s | 1.2 s | 627 | 49% |
| `hosted-quads` (Render) | 09-26 21:10 | 10.5 s | 0.43 s | 618 | 28% |
| `task16-sequential` | 09-29 20:57 | 12.0 s | 1.8 s | 619 | 53% |

All 44 scalars analysis times, sorted (s): 5.5 5.7 6.2 6.3 6.3 6.9 7.2 7.2 7.3 7.3 7.5 · 8.3 8.5
8.6 9.5 9.6 · 10.4–14.7 (28 values). Eleven of 44 finished in ≤7.5 s. **The fast path exists.** It
is not predicted by the document or the tokens.

**Findings (measured unless labelled):**

1. **Output is fixed at ~600 tokens whatever the document.** G01, with 14 non-null scalars, still
   emitted 422–632. Output correlates with the count of non-null values at r = 0.66, and with
   analysis time at only r = 0.32.
2. **The effective rate is sometimes higher than one `gpt-4.1` stream can generate.** Eleven passes
   finished in 5.5–7.5 s for ~600 tokens: 180–400 tok/s after a 4 s floor. A direct streamed call
   on this deployment measured **11 ms/token (~91 tok/s)** on 2026-09-20 (`.bakeoff/llm/*`
   `latency_checkpoint.engine_tbt_ms`) and **99 tok/s** on 2026-09-24 (`history/05`).
   *Inference:* either CU generates field groups in parallel internally, or the ~4 s floor is
   smaller or overlapped on fast runs. Either way, **"latency = 4 s + tokens ÷ rate" is an average,
   not a mechanism**, and predictions built on it (option B's "~7–8 s") are soft.
3. **CU emits far more output tokens per value than a plain JSON call.** The scalars key and value
   characters are ~1.26 per output token. Plain JSON usually runs at several characters per token
   (inference). On the same 11 documents and fields, CU single-pass emitted
   **1.1–1.9× (median ~1.45×)** the challenger's strict-JSON output: E01 678 vs 380, B01 823 vs
   428, C01 1,056 vs 555, A01 4,518 vs 3,371 (`.bakeoff/cu`, `.bakeoff/llm`). Microsoft documents
   the cause. Output tokens include "Confidence scores and source grounding", and "with source
   estimation + confidence enabled, the token usage is ~2x more per page" (pricing explainer,
   documented).
4. **Input is roughly half fixed prompt and half document.** A least-squares fit over 44 passes per
   pass gives scalars input ≈ **6,436 + 0.577 × markdown characters** and tables ≈ 4,059 +
   0.577 × chars. The fixed ~6.4k is CU's prompt plus our scalars descriptions, which are longer than
   the tables' (estimate). Caching hits only that shared prefix, at 2,816–6,400 cached tokens, and
   never the document. It varies by run (28–67%) and has no latency effect (r = −0.02). Prompt
   caches clear after 5–10 min idle (documented), so the first document of a demo is uncached.
   **Input size and caching are not latency levers here.**
5. **Upload to CU is small on Render.** 0.28–0.86 s (`hosted-quads`). The multi-second uploads in
   the sequential sets are the development machine's uplink. B02's 16 s is its known ~8 s uplink,
   doubled because **both passes upload the same bytes concurrently** (`history/05`).
6. **No submit stall in the recent sets.** `submitAttempts` is 1 in all 88 passes of the four
   two-pass sets, so the 5 s resubmit (decision 12) costs nothing today.

---

## 4. Options at a glance

"Gain" is on the D2 metric unless marked *perceived*. Every gain is an **estimate** unless it
cites a measurement. "Paid run" means it cannot be confirmed without one.

| # | Option | Expected gain | Cost impact | Accuracy risk | Effort | Feasible? |
| --- | --- | --- | --- | --- | --- | --- |
| A | Analyzer config trims: `enableFormula: false`, `enableBarcode: false` | 0–0.5 s, unknown; paid run | none | very low | XS | yes |
| B | Drop `currency` from the scalars schema | ~0.2 s (≈20 tokens) | tiny saving | none | XS | yes |
| C | Provider poll 1 s → 250 ms | ~0.4 s mean | none (ops limit 3,000/min) | none | XS | yes |
| D | Split scalars into 2–3 passes (history/05 option B) | 0 to ~3 s, **uncertain**; paid run | +~$0.02/doc per extra pass | low–moderate (split context) | M | yes |
| E | Source/confidence off for scalars + own grounding | ~2–4 s | −~$0.002/doc | loses native geometry and confidence | M–L | conflicts with ADR-0001 and decisions 10, 16 |
| F | Global Standard deployment via per-request `modelDeployments` | unknown, 0–? s; paid run | same list rate | none | S | yes |
| G | Priority processing (Global Standard) | tail only: ≥80 tok/s floor | premium rate (unverified) | none | S | unverified for a student subscription |
| H | Provisioned throughput (PTU) | tail only: ≥80 tok/s floor | ≥15 PTU; ~$3.9k/month at the doc's example rate | none | S | **no**, credit and quota |
| I | Smaller or other completion model | ≤~20% on paper; −1.7× measured for mini | cheaper | −2.4 pp measured for mini | S | not worth it (decision 11) |
| J | DI layout + direct `gpt-4.1` for scalars (challenger path) | ~0–2 s, not reliable | ~same | loses native geometry and confidence | L | conflicts with ADR-0001 |
| K | Upload once (`:analyze` by signed URL) or stagger passes | ~0.2–0.4 s on Render | none | none | S | yes; privacy trade-off |
| L | Start extraction before the Storage upload | *perceived* ~0.5–2.5 s | none | none | M | yes |
| M | Client poll 2 s → 0.5 s, or push (Realtime) | *perceived* ~0.75 s mean | none | none | XS–M | yes |
| N | Show the source image at once; fields fill in when ready | *perceived only*; metric unchanged | none | none | S–M | yes |
| O | Re-measure on another day | none; sets expectations | ~$0.25–0.55 | none | XS | yes |

---

## 5. Options in detail

### A. Analyzer config trims

`buildAnalyzerDefinition` sets `returnDetails`, `estimateFieldSourceAndConfidence`, `enableLayout`
and `enableOcr` to `true`, and leaves everything else at its default
(`api/src/providers/document-extraction/content-understanding/analyzer.ts:340–345`).

- **Documented defaults:** `enableFormula` defaults to **true**: "Disable for general business
  documents to improve performance." `enableBarcode` defaults to **true**: "Disable when barcodes
  aren't present to improve performance." `enableFigureDescription` and `enableFigureAnalysis`
  default to false, so they already cost nothing. Source: analyzer reference.
- **Measured:** barcode detection is running. A01's page 1 carries a `barcodes` array, and its
  markdown opens with a `Code39` barcode image tag (`.bakeoff/task16-sequential/A01.json`). The
  barcode is noise for a payslip and is also fed into the model's input.
- **Keep:** `returnDetails` (words, lines and pages feed the regions agreement check from Task 16
  D6), `enableOcr` (photos need it), `enableLayout` (tables and reading order).
- **Gain:** unknown. Layout is 2–4 s of the floor, and formula and barcode detection are a slice of
  it. It could be nothing. Estimate 0–0.5 s. **Needs a paid run** (§7).
- **How:** a new analyzer family (`hrPayslipV3`), per the derived-ID convention, so V2 stays
  comparable.
- **Accuracy risk:** very low. Payslips carry no formulas.

### B. Drop `currency` from the scalars schema

`currency` is in the scalars pass (`analyzer.ts:317` comment, `field-schema.ts:63`), but the mapper
ignores it: "the envelope is always EUR" (`fields.ts:28`, locked decision 7). It is one of 26 scalars.
At ~23 output tokens per field that is ~20 tokens, or ~0.2 s at ~90 tok/s (estimate). It is free
and harmless, but small. Removing a field changes the schema, so it goes in the same new family as A.

### C. Provider poll interval 1 s → 250 ms

The provider sleeps 1 s between status GETs (`provider.ts:73`, `:230–231`), which wastes a mean of
~0.5 s per pass. The `2025-11-01` reference documents no `Retry-After` header and no recommended
interval for `analyzerResults`. It lists only `Operation-Location` (analyze-binary reference,
documented). The resource limit is **3,000 operations per minute** (service limits, documented).
Polling at 250 ms, or at 250 ms only after the first ~3 s, keeps the waste to ~0.125 s, a saving of
~0.4 s mean (estimate) for a handful of extra GETs per pass. This is the only plumbing change that
moves the D2 metric itself.

### D. Split the scalars pass further (history/05 option B)

This is the open lever named in ROADMAP §5 "Residual latency". Two or three analyzers carry
~300 or ~200 output tokens each.

- **For:** the pass would emit roughly half the tokens. Concurrent analyses showed no measurable
  per-request penalty (`history/05` "Finding").
- **Against, measured:** analysis time correlates only weakly with output tokens (r = 0.32, §3).
  Halving tokens is not shown to halve the variable part. The pass takes the slowest of the two
  or three sub-passes, so with p10–p90 at 6.3–13.3 s the maximum of two draws sits *above* the
  median of one. The tail could get worse.
- **Cost (from recorded usage):** a scalars analysis is **$0.022–0.024 per document**
  (`task16-sequential`, `two-pass-sequential`, priced with `usage.ts`). The pages, contextualisation
  and the markdown half of the input are paid again per extra pass. Estimate **+$0.015–0.02 per
  document per extra pass**, pushing cost per page further over PRD §11.4's $0.01–0.02 (ROADMAP §5
  "Cost per page").
- **Batch cost:** the cap counts analyses (PRD §7.3). Three or four analyses per payslip deepen the
  queue in the four-at-once case, already missed at 73 s (`history/13`). The cap would need raising.
- **Accuracy risk:** the tables pass lost context once when split (C01 IP1 rows, `history/05`
  open question 2). A scalars split could do the same, for example `ukupnoSati` against the
  pay-calculation fields. Group fields by page region to limit that.
- **Effort:** M. `passFields` partition, the pass enum, `complete_extraction_pass` and
  `tablesStatus` semantics, provisioning, and the golden harness.
- **Verdict:** feasible, gain unproven. Try it only after the §7 experiment shows that output
  tokens do drive this pass's time.

### E. Turn off source and confidence estimation for scalars

This is **documented as the latency lever**. The GA notes (Nov 2025) say that enabling
source and confidence "only for the fields where you need validation and traceability … reduces
response payload sizes and lowers processing costs and latency" (What's new, documented). Output
includes "confidence scores and source grounding", ~2× tokens (pricing explainer, documented).
Measured: CU emits ~1.45× the challenger's tokens (§3).

- **The catch:** `method: "extract"` *requires* `estimateSourceAndConfidence: true` (analyzer
  reference, documented). Turning it off means `generate` fields with **no native quad and no
  confidence**. ADR-0001 chose CU for exactly that geometry and confidence, and locked decisions
  10 and 16 rest on it.
- **The workaround:** ground values ourselves against OCR words. `grounding.ts` and Task 16's
  word-agreement check already exist, but the challenger's grounding tops out at 98.4% and cannot
  place `period` on three of seven layouts (`history/01`). Confidence would be lost outright.
- **Gain:** if output drops ~30–50%, ~2–4 s at ~90 tok/s (estimate). Needs a paid run.
- **Verdict:** technically feasible, but it **reopens a locked decision**. It needs new evidence and
  the product owner. It is the largest in-engine lever, and it costs the feature that won the
  bake-off.

### F. Global Standard deployment, switched per request

Documented facts:

- CU maps model names to deployments through resource defaults, and **an analyze request may carry
  its own `modelDeployments` that overrides them** (models-deployments).
- Cross-resource and cross-region deployments are supported via connected resources
  (`{Connection}/{Deployment}`) (BYOC how-to; What's new, March 2026).
- Microsoft's cost tips say "Use global deployments when data residency and compliance allows"
  (pricing explainer).

So a second `gpt-4.1` deployment can be A/B-tested **without re-provisioning analyzers**.

- **Not known:** our deployment's SKU. `history/05` D4 read only `x-ms-region: Sweden Central`,
  500K TPM and `x-ms-is-spilled-over: false`. If it is regional Standard, Global Standard is the
  prerequisite for G.
- **Latency effect:** undocumented. Needs a paid run.
- **Privacy:** CU already processes `global` by default (`processingLocation`, analyze-binary
  reference; plan 04 D14), so a Global deployment does not change the posture much (inference).

### G. Priority processing

Documented facts (priority-processing page):

- A pay-as-you-go tier on **Global Standard or Data Zone Standard (US only)** deployments. EU Data
  Zone and regional Standard are **not** supported.
- `gpt-4.1` (2025-04-14): latency target **"99% > 80 TPS"**. Sweden Central is listed for Global.
- It is enabled at deployment level (`service_tier: priority`). Since CU calls the deployment, a
  deployment-level setting should apply to CU's calls. *Inference, unverified.*
- It may be downgraded under ramp limits (>50% TPM growth in <15 min) or at peak.
- **Inconsistency on the page:** its prerequisites say "Model versions `2025-12-01` or later", yet
  the latency table lists `gpt-4.1` 2025-04-14. Verify in the portal before planning around it.

What it means here:

- The target is a **floor**, not a speed-up. Our slow days ran at ~70–100 tok/s. Priority would
  clip the worst tail (the 57–70 tok/s-equivalent passes) but not move a normal day much.
- 600 tokens at 80 tok/s is still 7.5 s of generation.
- The price premium could not be read: the Azure pricing page rendered no figures. Treat it as
  unverified.
- Student-subscription eligibility is unknown.

### H. Provisioned throughput (PTU)

Documented facts:

- `gpt-4.1`: minimum **15 PTU** (Global or Data Zone), 50 regional; target **99% > 80 TPS**
  (PTU sizing).
- Billed per PTU-hour whether used or not (provisioned throughput). The doc's illustrative rate,
  $260 per PTU-month, makes 15 PTU ≈ **$3.9k/month**.

Same floor as G, so it does not guarantee ≤10 s for a ~600-token pass. It is **infeasible** on
student credit and very likely has no quota.

### I. A different completion model

- **Supported by CU:** gpt-5.5, 5.4, 5.4-mini, 5.2, 5.1, 5, 5-mini, 5-nano, gpt-4.1, 4.1-mini,
  4.1-nano, gpt-4o, gpt-4o-mini (service limits, documented). GPT-5.2 is Microsoft's recommended
  CU model (models-deployments).
- **Documented speed floors (PTU sizing):** gpt-4.1 > 80, gpt-4.1-mini > 90, gpt-4.1-nano > 100,
  gpt-5.x and gpt-5 > 50, gpt-5.4-mini > 100, gpt-5-mini > 80 TPS. The GPT-5 family also emits
  reasoning tokens, and CU's GA reference exposes no reasoning-effort knob (analyzer reference;
  inference from its absence).
- **Measured here:** `gpt-4.1-mini` emitted the same tokens (1.00×), ran 1.7× slower, and lost
  2.4 pp of scalar accuracy (`history/01` addendum).
- **Verdict:** at most ~20% on paper for nano, a quality risk, and contradicted by our one
  measurement. **Decision 11 stands. The new documentation is consistent with it.**

### J. DI layout + direct `gpt-4.1` for the scalars (challenger path)

Measured in the bake-off: DI layout took 4.3–6.0 s client-side and 2–4 s on the service
(`.bakeoff/layout/*`). The direct call ran at ~1 s service time to first token and 11 ms/token
(`.bakeoff/llm/*`).

- A scalars-only strict-JSON call would emit an estimated ~300–350 tokens, about half of CU's for
  the same values (§3 finding 3). That gives ~4.5 + 1 + 3.5 ≈ **9 s** plus upload (estimate). The
  gain over CU is not reliable.
- It gives up native geometry and confidence (ADR-0001, decisions 10 and 16).
- **Its one real advantage is streaming** (latency guide, documented). Fields could appear one by
  one, which is a perception gain.
- **Verdict:** not recommended while ADR-0001 holds.

### K. One upload per payslip

Both passes POST the same bytes to `:analyzeBinary` concurrently (`provider.ts:140`), so on a thin
link each gets half the bandwidth (B02, `history/05`). Two fixes:

- `:analyze` with a short-lived Supabase signed URL, so the service fetches it. `history/01`
  item 5 rejected publishing sources. A short-lived signed URL is a narrower exposure, and the
  product owner should decide.
- Submit the tables pass only after the scalars pass has its `202`.

On Render the uploads are already 0.28–0.86 s, so the gain is ~0.2–0.4 s (estimate).

### L. Start extraction before the Storage upload finishes

The upload route awaits `uploadSource` to Supabase Storage and the row insert before `enqueue`
(`api/src/routes/sessions.ts:65–99`). Measured: 1.0–2.6 s on the dev machine (`history/14`). The
queue already holds the bytes in memory (plan 04 D16).

Enqueueing right after the row insert, with Storage in parallel, would take that time off the
user's wait. It does not change the D2 metric, which starts at enqueue. The work is ordering and
failure semantics: a Storage failure after extraction has started. Effort M.

### M. Client polling

`POLL_INTERVAL_MS = 2_000` (`client/src/routes/SessionPage.tsx:35`) adds a mean of ~1 s after the
scalars write. Uploads trigger an immediate fetch (`:109–110`), but result arrival does not. Two
fixes:

- A 500 ms interval while any payslip is `processing`, a mean saving of ~0.75 s. Each session GET
  also runs the stale reaper (`sessions.ts:222`), so the added load should be checked.
- Push via Supabase Realtime on the payslip row. Larger effort.

*Perceived*, not D2.

### N. Legitimate perceived-latency moves (do not change the metric)

- PRD §7.3 already lands the user on the review screen with per-payslip status.
- The processing panel today is one line of text (`SessionPage.tsx:483–486`). The source image is
  already in the browser (it was just captured or selected), so it can render at once. The fields
  and outlines then fill in when the scalars pass lands, the same pattern as the tables skeleton
  (spec DoD, `.agents/specs/two-pass-extraction.md`).
- Label this honestly. The PRD's target is "first **usable form**" (§11.4). Showing the image
  earlier does not make the form usable earlier.

### O. Re-measure on another day

`history/05` open item 1 already asks for this: the 2026-09-20 rate would have put a scalars pass
near 7 s. The data agree that fast runs exist (11 of 44 ≤7.5 s). It costs ~$0.25 (scalars only) to
~$0.55 (both passes) per 11-document run. It tells us how often we are fast, and changes nothing.

---

## 6. External facts, verified (2026-09-30)

- **No streaming, partial results or webhooks in CU GA.** The `2025-11-01` analyze-binary
  reference lists `202` + `Operation-Location` and states `NotStarted | Running | Succeeded |
  Failed | Canceled`. There is no callback, streaming or `Retry-After`. The `2026-06-01-preview`
  adds **synchronous "inline" analysis for `prebuilt-read` and `prebuilt-layout` only**, not for
  field-extraction analyzers (What's new, July 2026). This confirms the spec's D1 answer.
- **Speed-related config:** `enableFormula` and `enableBarcode` default to true, with "disable …
  to improve performance". `enableOcr`: "Disable for native digital PDFs to improve performance",
  which doesn't apply to photos. `enableSegment` "increases processing time". Per-field
  `estimateSourceAndConfidence` "lowers processing costs and latency". Nesting deeper than 2–3
  levels "can reduce performance". There is **no "fast" or "lite" mode for field extraction**.
  `extractionMode` ("faster text-only extraction … for RAG") is mentioned in the GA notes but is
  absent from the analyzer reference's config list, so it is unverified for custom field analyzers.
- **Agentic workflow** (`2026-06-01-preview`) "can … take longer". Avoid.
- **`gpt-4.1` latency targets:** PTU and priority both "99% > 80 TPS". The latency guide says output
  tokens dominate ("each prompt token adds little time compared to each incremental token
  generated") and that mixing workloads on one deployment hurts latency. Content filtering adds
  latency; modifying it needs approval.
- **Region:** no source says Sweden Central is slow for `gpt-4.1`. Priority processing lists Sweden
  Central for Global Standard. CU may use deployments in other resources and regions (BYOC).
- **Microsoft Q&A threads** report `gpt-4.1` and `gpt-4o-mini` slowdowns, including in Sweden
  Central. They are anecdotal, not primary, and cited only to show the variance is not unique to
  us.

---

## 7. Recommended next step: one paid experiment

**One interleaved, same-session A/B over the 11 golden documents, scalars pass only.** Its purpose
is to separate the service's variance from what we control, before building option D or asking
about E.

For each document in turn, submit back to back (sequential, from Render or a Frankfurt shell, not
the development machine's uplink):

1. `hrPayslipV2_scalars` as-is (control);
2. a **V3 scalars** analyzer: `enableFormula: false`, `enableBarcode: false`, no `currency` (A + B);
3. a **one-field probe** analyzer with the V3 config (the floor on the same day);
4. optionally, a **half-schema** scalars analyzer (~13 fields) as a proxy for option D.

Poll every 250 ms in the harness (option C), and record submit, analysis and poll timestamps. Add
one direct streamed `gpt-4.1` call per document for the day's TBT (~$0.006 total, as in
`history/05`).

**Cost estimate from recorded usage:** ~$0.022–0.024 per scalars analysis (§5.D), and the probe is
cheaper (pages, contextualisation and input only). Variants 1–3 ≈ **$0.65**; with variant 4 ≈
**$0.90**. That is within the "~$0.55 per 11-doc run" order the product owner has approved before.
It needs his approval (paid).

**What it settles:**

- (a) the true floor on the day;
- (b) whether A + B move anything (a paired difference per document, which beats comparing
  set medians under this variance);
- (c) whether halving scalars cuts analysis time proportionally, which decides option D;
- (d) whether the fast path correlates with anything we control.

If (c) shows ~proportional gains, option D plus C gets a normal-day p50 near or under 10 s on the
D2 metric. If not, the honest conclusion is that ≤10 s is a service property. The remaining levers
are then E (a product-owner decision against ADR-0001) or accepting the target as missed, with
perception fixes N, L and M.

**Free and zero-risk now, needs no approval:** C (poll 250 ms) and M (client poll 500 ms). They save
a mean of ~1 s of user-perceived wait between them (estimate). Only C shows up in the D2 metric.

---

## 8. Open questions

1. **What SKU is the `gpt-4.1` deployment:** Standard (regional), Data Zone or Global Standard? This
   is a free portal check, and it decides whether priority processing (G) is even possible.
2. **Is priority processing available for `gpt-4.1` 2025-04-14 and a student subscription?** The
   doc contradicts itself on model versions. What is the premium?
3. **Does CU generate field groups in parallel?** That would explain the >200 tok/s effective rates
   (§3 finding 2) and would bear on whether option D helps.
4. **Should the PRD metric be restated?** Task 05 D2 excludes the client upload; the PRD says
   "upload to first usable form". This is not a relitigation, but readers should know the
   difference, which is ~2.5–6 s (§2).
5. **Is `extractionMode` settable on custom field analyzers in `2025-11-01`**, and does text-only
   extraction keep word quads? If it does, it may cut the OCR/layout stage.

---

## Sources

Project evidence (paths relative to the project root):

- `.agents/ROADMAP.md` §1 decisions 10–12, 15, 16; §5 "Residual latency", "Cost per page"
- `.agents/specs/two-pass-extraction.md`
- `.agents/history/01-extraction-bakeoff.md` (latency diagnosis, completion-model addendum)
- `.agents/history/05-extraction-latency-two-pass.md` (D2, D4 finding, R1–R3 tables, option B, cost)
- `.agents/history/13-deploy-end-to-end.md` (deployed first form, quads)
- `.agents/history/14-ui-ux-iteration.md` (journey 9.13, Storage upload timings)
- `.agents/history/16-extraction-review-polish.md` (V2 paid run)
- `.agents/plans/04-content-understanding-provider.md` D14 (`processingLocation`)
- `.agents/plans/05-extraction-latency-two-pass.md` D4 (rate-limit headers)
- `PRD.md` §7.3, §7.4, §11.4; `docs/adr/0001-payslip-extraction-architecture.md`
- `api/src/providers/document-extraction/content-understanding/analyzer.ts`, `provider.ts`,
  `usage.ts`, `field-schema.ts`, `fields.ts`; `api/src/services/payslip-extraction.ts`;
  `api/src/routes/sessions.ts`; `client/src/routes/SessionPage.tsx`;
  `client/src/review/PayslipReview.tsx`; `scripts/bakeoff/run-layout.ts`, `run-llm.ts`, `run-cu.ts`
- Recordings (git-ignored): `.bakeoff/{two-pass-sequential,two-pass-concurrent,hosted-quads,
  task16-sequential,cu,cu-mini,layout,llm,production-sequential}/*.json`

Microsoft Learn (read 2026-09-30):

- Analyzer reference: https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/analyzer-reference
- Service limits and supported models: https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/service-limits
- Model deployments and per-request override: https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/concepts/models-deployments
- Cross-resource capacity (BYOC): https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/how-to/bring-your-own-cross-resource-capacity
- Pricing explainer (token drivers, ~2× with source and confidence): https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/pricing-explainer
- What's new (GA notes, sync inline preview, GPT-5 support): https://learn.microsoft.com/en-us/azure/ai-services/content-understanding/whats-new
- Analyze Binary REST `2025-11-01`: https://learn.microsoft.com/en-us/rest/api/contentunderstanding/content-analyzers/analyze-binary?view=rest-contentunderstanding-2025-11-01
- Azure OpenAI latency guide: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/latency
- Priority processing: https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/priority-processing
- Provisioned throughput: https://learn.microsoft.com/en-us/azure/foundry/openai/concepts/provisioned-throughput
- PTU sizing and per-model latency targets: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/provisioned-throughput-sizing
- Prompt caching: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/prompt-caching
- Anecdotal only (Microsoft Q&A): https://learn.microsoft.com/en-us/answers/questions/5901503/gpt-4o-mini-unexplained-latency-degradation-since
