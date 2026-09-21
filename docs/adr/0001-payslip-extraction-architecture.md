---
status: accepted
date: 2026-09-18
decided: 2026-09-20
evidence: .agents/history/01-extraction-bakeoff.md
---

> **Confirmed by measurement, 2026-09-20.** Both engines were run over the 11-document golden set.
> They finished in a **dead tie**: 98.9% of scalar fields and 97.4% of critical fields each, both
> comfortably past the ≥95% target. Repeated runs move 1–2 fields either way, so nothing smaller
> than ~0.5% is signal here.
>
> The decision therefore rested on **geometry**, exactly as this ADR anticipated: Content
> Understanding returns a bounding quad **and** a per-field confidence for **100%** of the values
> it returns, including nested table rows, while the challenger's string-match grounding tops out
> at 98.4% even when fed known-correct values and cannot ground `period` on three of seven layouts
> at all.
>
> Latency was initially a serious objection (43.5 s mean) but was diagnosed as an intermittent
> **server-side stall on submit** — connect is always <0.15 s, the delay is uncorrelated with
> payload size, and it survives forcing IPv4. A 5 s submit budget with resubmit brings the mean to
> 15.1 s, against the challenger's 13.9 s, removing it as a differentiator. A residual risk stays
> open: 15.1 s still exceeds the ≤10 s target. See the linked record.

# Schema-driven extraction via Azure Content Understanding, validated by a bake-off

Croatian payslips have no prebuilt model on any platform, and no fixed layout to build a template against, so we extract them by **handing a Croatian field schema to Azure AI Content Understanding** (custom analyzer, api-version `2025-11-01`, West Europe) and letting it return values, per-field bounding quads and confidence zero-shot. Because nobody — including Microsoft — publishes accuracy figures for this on dense non-English financial tables, the decision is **provisional until measured**: a second provider is implemented behind the same interface and both are scored against the golden set in Phase 2 before any UI is built on either.

## Why there is no template to match

The obvious approach — one template per payroll vendor, matching Croatian labels — is what the sibling project `doc-guard` built, and it is architecturally wrong here.

*Pravilnik o sadržaju obračuna plaće…* (NN 68/2023) annexes the **IP1** form, but **Article 10(1) says IP1 "može se koristiti"** — it *may* be used. Only NP1 and NO1 are mandatory forms. The regulation therefore prescribes **content, not layout**. This is visible directly in our samples: all eleven declare themselves "Obrazac IP1", and no two share a geometry. One family numbers its sections `1.`–`12.`, three use roman numerals with different orderings and wordings, and one is a multi-panel grid that resembles none of the others. Every payroll vendor — PANTHEON, Synesis, Minimax, Luceed, and a long tail of accounting-bureau tools — renders its own.

Any approach requiring per-layout work is therefore an unbounded treadmill, and this rules out two otherwise reasonable options at once.

## Considered options

**Azure Content Understanding custom analyzer — chosen.** Zero-shot against a declared field schema, so a new employer costs nothing. `estimateFieldSourceAndConfidence: true` returns page, bounding quad and confidence **per field, including nested table rows**, which is the single hardest requirement to satisfy and the reason the geometry layer needs no code of our own. Croatian OCR (`hr`) plus `hr-HR` field-value normalisation handles the `1.234,56` decimal convention natively. West Europe region. Roughly $0.015 per page. It also keeps the Azure resource pattern the sibling `receipt-ocr` prototype already uses.

**DI `prebuilt-layout` + an LLM + our own grounding — implemented as the challenger.** Layout supplies words and polygons, an LLM reads the markdown and emits the schema, and each value is re-grounded by matching it back to OCR tokens. More code and roughly twice the cost, but it has one property the primary lacks: a value that *fails* to ground is a free hallucination signal. It exists to answer whether Content Understanding is actually good enough, and to be the fallback if it is not.

**DI custom neural — rejected.** It needs at least five labelled samples *per layout variation*, which is precisely the per-employer work we are trying to avoid, and it explicitly "doesn't recognize values split across page boundaries" — which sample A01, a two-page payslip whose sections continue across the break, does.

**DI custom template — rejected** on the legal reasoning above.

**`prebuilt-payStub.us` and Google's `PAYSTUB_PROCESSOR` — rejected.** Both are US/English-only and model American constructs; they would hunt for Federal and State withholding fields that do not exist on a Croatian payslip.

**doc-guard's pipeline — rejected, but harvested.** OCRmyPDF + Tesseract + camelot + fuzzy label anchors is a heavyweight native-dependency stack that is painful to deploy and, decisively, **discards all geometry**: its extraction runs through camelot DataFrames that carry no coordinates, so it has no field-to-bounding-box link anywhere. Its payroll reconciliation identities, OIB/IBAN/date regexes and Croatian label vocabulary are reused; its pipeline is not.

**An LLM alone, returning its own coordinates — rejected for the primary path.** Current models can return approximate pixel boxes, but the vendor documentation is explicit that PDF pages are rasterised server-side at dimensions the caller does not control, making returned coordinates unmappable, and that localisation output is approximate and should be spot-checked. Acceptable for a cosmetic highlight; not for one the product's credibility rests on.

**Self-hosted OCR/VLM — rejected.** Break-even against managed services is on the order of 50–100k pages per month, and it would add GPU operations and Croatian-diacritic validation to a project whose stated focus is extraction quality.

## Consequences

- **The central technical assumption is unproven.** Content Understanding's grounding precision on a dense Croatian payroll table is not documented by anyone. Phase 2 exists to measure it and **gates all downstream UI work** — nothing is built on an engine that has not been scored.
- **The decision flips if** the primary fails to reach 95% on core scalar field instances, or if its bounding quads prove too coarse to outline individual table cells. In that case the challenger becomes primary and this ADR is superseded.
- **A growing count of hand-written Croatian post-processing rules is a signal, not progress.** `receipt-ocr`'s own README records this drift — nineteen defects fixed with six deterministic rules, and the honest conclusion that "a Croatian receipt parser is being hand-built beneath a generic invoice model." Croatian knowledge belongs in the field schema's descriptions, not in code.
- **Both providers stay behind `DocumentExtractionProvider`,** selected by configuration and never per request. Provider vocabulary lives in exactly one module, guarded by a test that fails the build if it leaks into `shared/`.
- **The raw provider response is retained verbatim,** so source regions are a read-time projection rather than stored data — which is what let the sibling project add PDF highlighting with no migration and retroactive effect on already-analysed documents.
- **Privacy posture is demo-grade and deliberately so.** The challenger path sends document text to an API with no EU inference region. This is acceptable for a prototype by explicit product decision, and is a precondition to revisit before any production use.
