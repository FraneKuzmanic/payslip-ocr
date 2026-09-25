# Spec — Two-pass extraction (latency)

**Status:** implemented (Task 05, 2026-09-25). The first-form target is **missed**: p50 12.2 s.
**Owner:** ROADMAP Task 05, because it changes the API shape
**Evidence:** `.agents/history/01-extraction-bakeoff.md`, `.agents/history/05-extraction-latency-two-pass.md`

> **Measured, Task 05.** One payslip at a time on the product path: single-pass p50 20.7 s,
> p90 46.2 s; two-pass first form **p50 12.2 s, p90 15.1 s**, complete p50 14.0 s. The prediction
> below assumed 146 tok/s; on the day the service generated at ~70–100 tok/s, so a ~600-token
> scalars pass took 6–14 s. The design delivered the structural win (A01 66.8 → 15.1 s) but not
> the 10 s line. Cost: $0.045–0.051 per document against $0.031 single-pass, ~1.5×, close to the
> 1.6× estimated below. Scalar accuracy 271 and 268 of 273 against single-pass 270–272; line-item
> cells 478 and 502 against 502–504, the spread driven by `obustave` row order, which varies in
> single-pass runs too. By the plan's test (every two-pass set ≥ lowest single-pass − 1 = 269), R3's
> 268 is one field short.

## Problem

Extraction latency is **~14 s mean, 22 s on the worst document**, against a PRD §11.4 target of
**≤10 s per page**. Measured decomposition:

```
latency ≈ OCR floor (~4 s, constant) + output_tokens ÷ generation_rate (~146 tok/s)
```

The OCR floor was isolated with a probe analyzer carrying a one-field schema: **3.5–4.3 s
regardless of document complexity.** Everything above it is the completion model emitting the
field JSON, and that scales with how much there is to emit:

| doc | table rows | output tokens | latency |
| --- | --- | --- | --- |
| G01 | 3 | 534 | 7.7 s |
| E01 | 4 | 678 | 8.1 s |
| A02 | 18 | 1,921 | 22.5 s |
| A01 | 43 | 4,518 | 22.4 s |

**The three line-item tables are the cost.** A01's 43 rows across `payComponents`, `obustave` and
`neoporeziviPrimici` account for the large majority of its 4,518 output tokens; its ~26 scalars are
a few hundred.

Changing the model does not fix this — that was measured and rejected. `gpt-4.1-mini` emitted an
identical token count (1.00×) and ran 1.7× *slower* on this resource, while losing 2.4 pp of
accuracy. A gpt-5-class model would add reasoning tokens to a task that needs none. **The lever is
emitting fewer tokens in the request the user is waiting on**, not changing who emits them.

## Proposal

Split extraction into two analyzers over the same document, **run concurrently**:

- **Pass A — scalars.** The ~26 scalar fields only. Predicted **~4 s floor + ~600 ÷ 146 ≈ 8 s**.
- **Pass B — tables.** `payComponents`, `obustave`, `neoporeziviPrimici` only. Roughly today's
  latency, because it carries the tokens.

The review screen renders as soon as **Pass A** returns; the three line-item sections show a
skeleton and fill in when **Pass B** lands.

**The number this improves is time-to-first-usable-form, not total time.** Run in parallel, wall
clock to *complete* extraction is unchanged — it is bounded by Pass B. That is the right target:
PRD §11.4 measures when the user can start working, and §7.3 already lands them on the review
screen with per-payslip status rather than a blocking spinner.

## Cost

Two passes means two analyses of the same document, so **OCR and input tokens are paid twice**:

| | today | two-pass (est.) |
| --- | --- | --- |
| Model tokens | $0.0348 | ~$0.055 (input roughly doubles, output splits) |
| CU pages | ~$0.006 | ~$0.012 |
| **Per doc** | **~$0.041** | **~$0.067** |

About **1.6× the cost to halve time-to-form.** At prototype volume that is noise — a hundred demo
documents goes from $4 to $7 — but it should be a conscious choice, not a surprise.

### Cheaper variant worth considering

**Fetch tables on demand.** Run Pass A always; run Pass B only when the user expands a line-item
section, or not at all for a payslip they confirm without opening the tables. Same latency win,
and cost goes *below* today's for any document whose tables are never opened. Costs a visible
loading state inside the section and makes export order-dependent (tables must be fetched before
a JSON export is complete).

## Open questions

Answered in Task 05 (plan D1, D5, D6, D11):

1. **Does CU let one analyzer return partial results?** No. In the `2025-11-01` GA reference the
   operation is `NotStarted | Running | Succeeded | Failed | Canceled`, `result` exists only on
   success, and there is no streaming or partial option. The two-analyzer split was built.
2. **Does splitting the schema change accuracy?** Scalars: 271 and 268 of 273 against single-pass
   270–272. R3 is one field under the plan's floor of 269. Its misses are fields that also flip
   between runs of one design, so no split effect is shown, but the criterion is not met. Tables: one run lost 24 cells, almost all A01
   `obustave` row order, and the next matched single-pass. Once, C01's tables pass took the IP1
   statutory breakdown instead of the employer's pay rows: the tables analyzer no longer sees the
   scalar fields, and that is the one plausibly systematic cost seen.
3. **Which pass owns `ukupnoSati`?** The scalars pass. Task 06 computes
   `pay_components_sum_mismatch` only once `tablesStatus` is `ready`, and recomputes warnings on
   each pass's arrival.
4. **Failure independence.** `tablesStatus` (`pending | ready | failed`) is its own field beside
   the payslip status: `review` + `failed` is usable-but-incomplete, distinct from a failed
   payslip. Confirm is refused while `pending`.

## Definition of done

- Pass A returns in ≤10 s at p50 on the golden set, measured, not estimated.
- Scalar accuracy is within the 0.5% run-to-run noise band of the single-pass baseline (98.9%).
- The review form is interactive before the tables arrive, and the tables cannot cause a layout
  jump when they land.
- Export blocks until both passes have completed, or states explicitly that tables are pending.

## Not doing

- **Changing the completion model.** Measured and rejected; see the bake-off addendum.
- **Trimming the schema to go faster.** `ostatakSalda`, `brojRata` and `koeficijent` could go, but
  they are real data and dropping them to save a second is the wrong trade while a structural fix
  exists.
