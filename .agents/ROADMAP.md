# Implementation Roadmap — Payslip OCR PoC

| | |
| --- | --- |
| **Status** | Active |
| **Created** | 21 September 2026 |
| **Source of truth** | [`PRD.md`](../PRD.md) · [`CONTEXT.md`](../CONTEXT.md) · [`docs/adr/0001`](../docs/adr/0001-payslip-extraction-architecture.md) |
| **Tasks** | 13, numbered 01–13 |

Tasks are sized to be planned, implemented and validated as one unit. Each is a meaningful slice
of product, not a ticket — several touch schema, API and UI together, because splitting them
would produce pieces that cannot be verified on their own.

Plans live in `.agents/plans/NN-*.md`, completion records in `.agents/history/NN-*.md`,
feature specs in `.agents/specs/`.

---

## 1. Locked decisions

Settled during discovery and Phase 2. **Do not reopen without new evidence** — each cost real
investigation and is recorded with its reasoning.

### Product

1. **Pure technology demonstrator.** The downstream consumer of exported data is deliberately
   unspecified; the schema stays general rather than shaped to income verification or accounting.
2. **A Payslip owns Pages.** Pages are never reviewed or exported independently.
3. **One Source File is always exactly one Payslip.** A three-page PDF is one payslip with three
   pages; each image is one payslip. Ten files per upload.
4. **Merge is retained** for a payslip photographed as two files: automatic suggestion on
   employee OIB + period, loosened to employer OIB + period when the employee OIB is missing,
   plus an always-available manual action. **No drag affordance** — a menu action satisfies
   WCAG 2.2 SC 2.5.7 with one implementation.
5. **Merge re-extracts** over a combined PDF rather than stitching two result sets.
6. **Field scope** is the core scalars plus three line-item tables (`payComponents`, `obustave`,
   `neoporeziviPrimici`).
7. **EUR only.** Pre-2023 HRK payslips and the `prirez` line are out of scope.
8. **Sessions and payslips are persisted** with per-user history, mirroring receipt-ocr — not
   held in memory.
9. **Two navigation controls, not one**: a payslip selector and a page pager. Established
   document-review practice splits them, and the two levels are semantically different.

### Technical

10. **Azure AI Content Understanding is the extraction engine** (ADR-0001, confirmed by
    measurement). The DI-layout + LLM challenger stays implemented as the measured fallback.
11. **`gpt-4.1` is the completion model.** `gpt-4.1-mini` was measured: identical output tokens,
    1.7× slower on this resource, −2.4 pp scalar accuracy. A gpt-5-class model would add reasoning
    tokens to a task that needs none.
12. **Submit uses a 5 s budget with resubmit.** The service intermittently stalls ~29 s on
    `:analyzeBinary`; connect is always <0.15 s and it is uncorrelated with payload size. The
    retry takes the mean from 43.5 s to 15.1 s.
13. **CU returns what is printed, not normalised values.** Normalisation to `YYYY-MM` /
    `YYYY-MM-DD` is the mapper's job. `asPeriod`/`asDate` already exist in
    `scripts/bakeoff/score.ts` and get ported, not rewritten.
14. **Field identifiers are Croatian for payroll concepts, English for structure**, and are
    independent of the UI language.
15. **Accuracy is scored per field instance**, not per document, against the 11-sample golden set.
    **The run-to-run noise band is ~0.5%** — both engines move 1–2 fields between identical runs,
    so no smaller difference is signal.
16. **Grounding stays in the product even on CU.** "Could not ground this value" is a
    first-class attention signal: measured at 100% precision as a hallucination detector.
17. **The repository is forked wholesale from receipt-ocr**, not rebuilt. Its viewport, overlay
    and PDF modules encode browser-found bug fixes that a rewrite would lose.

### Deliberately deferred

- **Payslip validation as a product feature.** Arithmetic identities are computed, but only to
  raise review warnings — never to accept or reject a document.
- **Splitting one uploaded file into several payslips.**
- **Page reordering** beyond the swap offered at merge time.
- **Cross-payslip aggregation** ("average net over three months").
- **Password reset, email verification, MFA, SSO** — inherited gaps, documented not fixed.
- **Labelled samples in CU Studio** for layouts that resist zero-shot extraction.

---

## 2. Progress

| Task | Title | Status |
| --- | --- | --- |
| — | Discovery: PRD, CONTEXT, ADR-0001 | ✅ complete |
| — | Golden set: 11 fixtures, verifier, README | ✅ complete |
| — | **Phase 2 bake-off** — engine chosen by measurement | ✅ complete → [`history/01`](./history/01-extraction-bakeoff.md) |
| 01 | Fork, rename and strip | ✅ complete → [`history/01-fork`](./history/01-fork-rename-strip.md) |
| 01b | Mirror, deploy and CI (pulled forward from 13) | ✅ complete → [`history/01b`](./history/01b-mirror-deploy-ci.md) |
| 02 | Canonical payslip domain model & shared contracts | ✅ complete → [`history/02`](./history/02-canonical-payslip-model.md) |
| 03 | Session & payslip persistence, upload API | ✅ complete → [`history/03`](./history/03-session-payslip-persistence-upload.md) |
| 04 | Content Understanding provider, mapper & scoring harness | ✅ complete → [`history/04`](./history/04-content-understanding-provider.md) |
| 05 | Extraction latency: partial results or two-pass | ✅ complete, first-form target missed (p50 12.2 s) → [`history/05`](./history/05-extraction-latency-two-pass.md) |
| 06 | Warnings & validation engine | ✅ complete → [`history/06`](./history/06-warnings-validation-engine.md) |
| 07 | Capture & multi-upload UI | ⬜ not started |
| 08 | Source regions & document preview with highlighting | ⬜ not started |
| 09 | Review form & two-way linking | ⬜ not started |
| 10 | Session navigation & phone layout | ⬜ not started |
| 11 | Merge payslips | ⬜ not started |
| 12 | Export & history | ⬜ not started |
| 13 | Deploy & end-to-end verification | ⬜ not started |

---

## 3. Tasks

### Task 01 — Fork, rename and strip

**Goal:** A running application forked from receipt-ocr, renamed throughout, with every
receipt-specific extraction and schema removed, that builds and passes its own validation while
extracting nothing.

**Depends on:** nothing.

**Scope**

- Copy `prototypes/receipt-ocr` into this directory, preserving `client/`, `api/`, `shared/`,
  `supabase/`, `scripts/`, `.claude/commands/`, `render.yaml` and the toolchain configs.
- Rename `@receipt/*` → `@payslip/*` across all three workspaces and every import.
- Delete receipt-specific extraction: `api/src/providers/document-extraction/*` except the
  provider interface and error types, `vat-tables.ts`, `fiscal-qr.ts`, `receipt-amount.ts`,
  `tax-signals.ts`, `content-markers.ts`, and their tests and fixtures.
- Delete `shared/src/receipt.ts` and the receipt DTOs; leave a compiling stub surface so the app
  still builds. Delete receipt-specific client routes and review components that have no payslip
  equivalent, keeping the viewport/overlay/PDF modules untouched.
- Reconcile the existing `.gitignore`, `package.json` and `.env.example` with the forked ones —
  the bake-off harness and its deps must survive the merge.
- **Do not copy receipt-ocr's `.claude/commands/` over this project's.** A fresh command set is
  already installed here (`commit`, `create-prd`, `create-rules`, `execute`, `init-project`,
  `plan-feature`, `prime`), and `prime.md` in particular has been adapted to this PRD, this
  roadmap's section numbering and this project's conventions. receipt-ocr's copies point at
  `CLAUDE.md`, `@receipt/*` and roadmap sections that do not exist here.
- **`validate.md` is the one worth taking**, and only after review: receipt-ocr's is ~941 lines of
  checks earned from real incidents, many of them receipt-specific. Port the phases that still
  apply rather than copying it. Note `npm run validate` (typecheck → lint → format → test) is a
  package script and comes across with the fork regardless.
- Merge the existing `AGENTS.md` with receipt-ocr's `CLAUDE.md` guidance, keeping this project's
  issue-tracker/triage/domain sections.

**Not in this task:** the payslip schema (02), any extraction (04).

**Definition of done**

- [x] `npm install && npm run validate` passes: typecheck, lint, format check, unit tests.
- [x] `npm run dev` serves the client and API; sign-in works against the existing Supabase project.
- [x] No identifier containing `receipt` remains outside `.agents/`, `docs/` and git history —
      verified by grep.
- [x] `scripts/bakeoff/` still runs: `npm run score -- cu` reproduces 98.9% against the golden set.
- [x] `/prime` resolves every file and roadmap section it points at, and `.claude/commands/`
      contains no reference to `receipt`, `CLAUDE.md` or `@receipt/*`.
- [x] `npm run validate` exists as a package script and is green.

---

### Task 01b — Mirror, deploy and CI

**Goal:** Every later task lands on a private GitHub mirror, is checked by CI, and deploys to
Render automatically once CI passes. Pulled forward from Task 13 on 2026-09-24 so that
deployment problems surface on a stub app rather than at the end.

**Depends on:** 01.

**Scope**

- The private mirror `FraneKuzmanic/payslip-ocr`, and the subtree push path (AGENTS.md §7).
- `render.yaml`: API web service (Frankfurt) plus static client, `npm ci` against the committed
  lockfile, `autoDeployTrigger: checksPass`, and a health check.
- `.github/workflows/ci.yml`: `npm ci`, lint, typecheck, format, test and build on Linux.

**Not in this task:** Azure configuration on Render (Task 04 adds it), preview environments,
rollback.

**Definition of done**

- [x] The mirror is private and holds only the payslip subtree, with no personal data in its history.
- [x] Both services deploy from the Blueprint; `/api/health` answers and CORS admits the client.
- [x] Sign-up, sign-in and the language switch work on the deployed client.
- [x] CI runs on every push to `main`, and Render deploys only after it passes.

---

### Task 02 — Canonical payslip domain model & shared contracts

**Goal:** The payslip domain expressed once, in `shared/`, with every API DTO derived from it and
a guard that stops provider vocabulary leaking in.

**Depends on:** 01.

**Scope**

- `shared/src/payslip.ts` — the canonical schema from PRD §6.4: 26 scalars plus
  `payComponents`, `obustave`, `neoporeziviPrimici`. Money and hours are **decimal strings**;
  every field nullable; Croatian identifiers for payroll concepts, English for structure.
- `shared/src/session.ts` — Session, and the payslip status machine
  (`processing → review → confirmed`, plus `failed` with a retryable reason).
- Port `money.ts` (big.js, `Big.strict = true`) and `datetime.ts`; extend the latter with the
  Croatian month names and `DD.MM.YYYY` / two-digit-year forms, lifted from
  `scripts/bakeoff/ground.ts` and `score.ts` rather than rewritten.
- `shared/src/warnings.ts` — the nine warning codes from PRD §7.9 as a closed taxonomy.
- `shared/src/api.ts` — every request and response DTO, requests `.strict()`.
- Per-field metadata type `{confidence, source}` and the `SourceRegion` wire shape.

**Not in this task:** computing warnings (06), the regions endpoint (08).

**Definition of done**

- [x] A test fails the build if any Azure or Content Understanding identifier appears in `shared/`.
- [x] Round-trip tests: every golden-set fixture parses against the canonical schema unchanged.
- [x] `parseAmount` handles `1.234,56`, `1234,56`, `1 234,56` and `1234.56` identically, and
      rejects values it cannot normalise rather than guessing.
- [x] Croatian period and date parsing covers all seven layouts' printed forms, tested against
      the strings the golden set documents.

---

### Task 03 — Session & payslip persistence, upload API

**Goal:** A user can upload up to ten files in one session and have them persisted, owner-scoped,
with their source documents stored privately.

**Depends on:** 02.

**Scope**

- Supabase migration per PRD Appendix B: `sessions` and `payslips`, `canonical_data` jsonb
  authoritative, generated columns for list and export queries, partial index on
  `(user_id, created_at desc) where deleted_at is null`.
- RLS on both tables and on `storage.objects`, keyed on the owning user. A resource belonging to
  another user returns **404, never 403** — it must fall out of the query, not a separate check.
- Owner-scoped repositories returning canonical objects, never raw rows; soft delete via
  `deleted_at`.
- Endpoints PRD §10.2–10.5, 10.12–10.13: create session, upload one file to a session, read a
  session with its payslips, read a payslip, list, soft delete.
- Upload: byte-sniffed content type (never the filename), PDF encryption and page-count checks,
  storage path `{userId}/{payslipId}/source`, signed URLs with a 300 s TTL.
- Auth guard applied to the **path prefix**, not per route, with the proven user id passed to
  handlers as an argument.

**Not in this task:** extraction (04), the capture UI (07).

**Definition of done**

- [x] Migration applies cleanly to an empty database (transactional dry run) and is recorded
      once in the migration history (Task 03 D6).
- [x] Integration tests against the hosted Supabase project cover insert, read, list, soft delete,
      and that a soft-deleted payslip is excluded from list queries.
- [x] A second user cannot read or delete the first user's session or payslip, and receives 404 in
      every case; cross-user **update** is refused at the repository layer that Task 09's PATCH
      will use (Task 03 D4).
- [x] Uploading eleven files to one session is rejected; ten succeeds.
- [x] An encrypted PDF, an 11-page PDF and a `.txt` renamed to `.pdf` are each rejected with the
      documented error code.

---

### Task 04 — Content Understanding provider, mapper & scoring harness

**Goal:** Uploading a payslip produces canonical fields with per-field confidence and retained
raw geometry, scored against the golden set by a harness that fails loudly when it cannot measure
something.

**Depends on:** 03.

**Scope**

- Port `scripts/bakeoff/run-cu.ts` into `api/src/providers/document-extraction/content-understanding/`:
  analyzer definition, the Croatian field schema from `field-schema.ts`, the 5 s submit budget
  with resubmit, `:analyzeBinary`, polling, and the failure classification into
  `unreadable_document` / `provider_rejected` / `provider_unavailable`.
- Analyzer provisioning as a repeatable script, not a manual portal step — including the
  `PATCH /contentunderstanding/defaults` registration, which is a one-time per-resource action
  that is easy to lose.
- Mapper: CU's `valueString` / `valueArray` → canonical, with **normalisation in the mapper**
  (`asPeriod`, `asDate`, amount parsing). Provider field names live in exactly one module.
- Retain the raw response verbatim for later read-time projection.
- Background extraction orchestration: parallel, capped at 3 concurrent, per-payslip failure
  isolation, structured log line per finish carrying no document contents.
- `ExtractionError.retryable` derives from `isRetryableFailure` (Task 02).
- Parser assignment in the mapper: hours and coefficients via `parseQuantity`, money via
  `parseAmount`, period via `parsePeriod`, dates via `parseDate`; `brojRata` stays text (Task 02
  D1).
- Move the bake-off scoring harness to `scripts/score-extraction.ts`, running against the real
  production mapper offline from recorded responses, honouring `unscorable` and **failing when
  any other expectation goes unscored**.
- Render receives the Content Understanding configuration (Task 04 D1).
- Stale `processing` rows fail lazily on read, so an extraction lost to a redeploy is retryable
  (Task 04 D3).
- Added during execution: `pdf_encrypted` means "needs a password to open". A permissions-only
  PDF (golden-set B01) is accepted. This corrects Task 03, whose check refused any `/Encrypt`.
- Added during execution: the 5 s submit budget runs from the moment the body has been sent, not
  from the start of the request. On a slow uplink the old budget aborted every attempt for B02.

**Not in this task:** warnings (06), regions (08), latency work (05).

**Definition of done**

- [x] All 11 golden-set payslips extract end to end through the real API.
- [x] `npm run score:extraction` reports **≥95% scalar fields** and **≥85% line-item cells**,
      and reports the run-to-run figure alongside so a single run is not mistaken for a ranking.
- [x] Removing a fixture's ground truth makes the harness fail, not skip.
- [x] A payslip that fails extraction leaves its siblings unaffected and records a retryable or
      non-retryable reason.
- [x] Provider vocabulary appears in one module only, enforced by the Task 02 guard (`shared`) and
      the Task 04 guard (`api`).

---

### Task 05 — Extraction latency: partial results or two-pass

**Goal:** Time from upload to a usable pre-filled form is ≤10 s at p50 across the golden set.

**Depends on:** 04.

**Scope**

- **Start from the Task 04 finding** (history/04, "Latency on the product path"): with three
  analyses in flight, each one's service-side time roughly triples (A01 66 s against 22 s alone),
  because they share one `gpt-4.1` deployment's generation throughput. Measure a single-document
  baseline on the product path, and check the deployment's TPM capacity in the portal, before
  choosing a design. `latencyMs` also excludes the time a payslip waits in the queue, which the
  user does wait through.
- **First**, answer the open question in [`specs/two-pass-extraction.md`](./specs/two-pass-extraction.md):
  can a single CU analyzer return partial results or stream? If yes, this task collapses to
  consuming them and the rest of the scope is dropped.
- Otherwise implement the two-pass split: a scalars analyzer and a tables analyzer over the same
  document, run concurrently, with the API shaped so the form can render on the first and fill in
  on the second.
- Decide and record which pass owns `ukupnoSati`, and make warnings recompute when the second
  pass lands rather than being computed once.
- Give a payslip whose tables failed but whose scalars succeeded its own state, distinct from
  `failed`.
- Re-score after the split: schema partitioning changes what each pass sees.

**Not in this task:** the skeleton UI that consumes the two passes (09).

**Definition of done**

- [ ] p50 time to first usable form ≤10 s over the 11 samples, measured, not estimated.
      **Measured and missed: p50 12.2 s** (single-pass 20.7 s), one payslip at a time. The
      service generated at ~70–100 tok/s on the day; mean 13.3 s (11.8 s without B02's slow
      uplink). Accepted **for now** by the product owner on 2026-09-25 (option A), who expects it
      to be improved in a later phase (§5, "Residual latency").
- [x] Scalar accuracy within the 0.5% noise band of the single-pass baseline. **Met by R2 (271);
      R3 is one field under D12's floor (268 against 269; single-pass 270–272).** Every R3 miss is a
      field that also flips between runs of one design (history/05). Accepted by the product owner
      as run-to-run variance on 2026-09-25.
- [x] Cost per document recorded in the history file: $0.045–0.051 two-pass against $0.031
      single-pass, ~1.5×.
- [x] Export blocks until both passes complete: confirm is refused while `tablesStatus` is
      `pending` (PRD §10.7, Task 09), export requires `confirmed`, and every export carries
      `tablesStatus`.

---

### Task 06 — Warnings & validation engine

**Goal:** Every extracted payslip carries the warnings that tell a reviewer which few fields to
check first.

**Depends on:** 04.

**Scope**

- The nine rules from PRD §7.9: `missing_critical_field` over the seven critical fields,
  `unparseable_amount`, `unparseable_date`, `oib_checksum_failed`, and the four payroll identities
  (`dohodak`, `porezna_osnovica`, `neto`, `isplata`) plus `pay_components_sum_mismatch`.
- **Absolute tolerance of 0.01, never relative** — doc-guard's identities were correct but
  compared to nine significant figures, which no OCR'd cent value survives.
- **`poreznaOsnovica` floors at zero.** B01 in the golden set is exactly this case: osobni
  odbitak equals dohodak, so the base is legitimately 0,00.
- `pay_components_sum_mismatch` applies to **amounts only, not hours** — B02's leaf hours total
  266 against a printed 176 and that is not an error.
- OIB checksum: ISO 7064 MOD 11,10, applied to both employer and employee. The scoring harness
  also reports the **OIB checksum pass rate on extracted OIBs**, which PRD §11.3 lists as
  measured and nothing measures yet.
- Low-confidence projection: a provider-neutral `lowConfidenceFields` list, plus `ungroundable`
  as its own signal. Confidence **never suppresses a value**.
- Compute grounding over the retained raw response (`pages[].words`); Task 04 stores per-field
  `{confidence, source}` and leaves both projections to this task (Task 04 D6).
- **Since Task 05, both are per pass:** `extraction_metadata` and `raw_provider_result` are
  `{ scalars?, tables? }`. Both passes OCR the same document, so grounding can read
  `pages[].words` from the scalars body, which exists whenever the payslip is in `review`.
- Recompute on every PATCH **and on each extraction pass's completion** (Task 05 D11).
  `pay_components_sum_mismatch` is evaluated only once `tablesStatus` is `ready`.

**Not in this task:** rendering warnings (09).

Built as a **read-time projection** (Task 06 D1): warnings are computed on every read and the
`warnings` column is dropped, so per-pass and per-PATCH recomputation hold by construction.
Grounding is computed when each pass is mapped and stored as `ungroundableFields` in that pass's
metadata, against its own body's words (D8).

**Definition of done**

- [x] Every golden-set payslip produces the expected warning set, including **zero** arithmetic
      warnings on **all eleven** (G01's empty pay-components table reconciles vacuously, D2).
      Gated in `api/src/validation/warnings.test.ts`.
- [x] B01 raises no `porezna_osnovica_mismatch`; B02 raises no `pay_components_sum_mismatch`.
- [x] Injecting a one-cent error into each identity raises exactly that identity's warning (five
      injections on A02).
- [x] A04's occluded `iznosZaIsplatu`: **reworded (D10)**, because the warnings engine cannot stop
      the engine inventing a value. When it is null, `missing_critical_field` fires (fixture,
      `production-sequential`). When it is invented, it is marked: `isplata_mismatch` fires in
      `cu`, R2 and R3, and `production`'s invented `1801.77` is ungroundable at confidence 0.044.
- [x] No status write consults warnings. Confirm and export gating are Tasks 09 and 12.

---

### Task 07 — Capture & multi-upload UI

**Goal:** A user on a phone can photograph or select up to ten payslips and land on the review
screen within a couple of seconds, with per-payslip progress.

**Depends on:** 03, 06.

**Scope**

- Device-adaptive pickers driven by `(pointer: coarse)`, re-read on change: phone gets a primary
  **Skeniraj** (`capture="environment"`) plus a permanently visible **Odaberi datoteku**; desktop
  gets file choice only.
- **Multiple file selection**, capped at ten, with the cap explained rather than silently enforced.
- Client-side classification and downscale: images over 2 MP or 1.5 MB re-encoded to a 1,600 px
  long edge at quality 0.82, and **the preview built from the exact bytes that upload**.
- Session creation then one POST per file, extraction started immediately, navigate to review as
  soon as the first payslip exists.
- Per-payslip status surfaced while extraction runs; a failure is one bad item with a retry, not
  a dead batch.
- **`POST /api/payslips/:id/retry` (PRD §10.8)**, which that retry needs and no earlier task built:
  `202` for a `failed` payslip with a retryable reason, `409 retry_not_allowed` otherwise. It
  re-runs both extraction passes, so it must reset `tables_status` to `pending` along with
  `status = processing`: the tables pass writes only while pending (Task 05 review).
- Croatian and English copy for everything added, including hr/en copy for every
  `PAYSLIP_STATUSES` and `TABLES_STATUSES` value, guarded by a test mirroring
  `uploadErrors.test.ts` (Task 02 D8, Task 05 D6).

**Not in this task:** the review form (09), the chip rail (10).

**Definition of done**

- [ ] Selecting four files creates one session with four payslips and four independent extractions.
- [ ] The review route is reachable in under 3 s from upload start, before extraction completes.
- [ ] A HEIC photo, a multi-page PDF and a PNG screenshot all upload successfully.
- [ ] Busy state keeps the pressed button in the tab order (`aria-disabled`, not `disabled`) and
      announces via a visually-hidden `role="status"`.
- [ ] Both locales have complete copy; the key-set guard test passes.

---

### Task 08 — Source regions & document preview with highlighting

**Goal:** Every extracted value can be pointed at on the document, on both images and PDFs, or is
honestly not outlined at all.

**Depends on:** 04.

**Scope**

- `GET /api/payslips/:id/regions` as a **read-time projection** over the retained raw response —
  no stored geometry, no migration, retroactive on everything already analysed. Since Task 05 the
  response is `{ scalars?, tables? }`: project regions from both bodies, whose field paths are
  disjoint.
- Parse CU's `D(page,x1,y1,…,x4,y4)` source strings and divide by each page's own dimensions to
  produce **page-relative fractions plus an aspect ratio**. CU reports inches for PDFs and pixels
  for images; this normalisation is what makes them identical to the client.
- Region field paths are canonical dotted paths (`netoPlaca`, `payComponents.2.iznos`), with
  `origin` distinguishing model-sourced from re-grounded.
- Port the client modules unchanged where possible: `ZoomableSourceViewport`, `sourceZoom`,
  `SourceOverlay`, `RegionPopover`, `pdfDocument`, `pdfRender`.
- **The aspect-ratio guard**: outlines are drawn only when the rendered ratio agrees with the
  API's declared ratio within 0.01. A mismatch withholds outlines rather than misplacing them.
- Section colours matching the form legend; an edited field's outline dashed.
- `ungroundableFields` (Task 06) is a different thing from a region's `origin`: it says the
  printed value is not among the OCR words, not where an outline came from.

**Not in this task:** the form that links to regions (09), navigation (10).

**Definition of done**

- [ ] Regions return for all 11 samples, covering **100% of non-null scalar fields** — CU's
      measured coverage.
- [ ] Outlines land on the correct text on a native PDF, a clean scan, and an angled phone photo.
- [ ] An EXIF-rotated image and a `/Rotate 90` PDF withhold outlines rather than misplacing them.
- [ ] The PDF path degrades to `<object>` plus a translated notice if pdf.js fails, rather than
      breaking the panel.
- [ ] **Visual spot-check of all 11 documents recorded** — see §4.

---

### Task 09 — Review form & two-way linking

**Goal:** The screen the product exists for: every field editable, every value traceable to its
place on the page.

**Depends on:** 02, 06, 08. Consumes 05.

**Scope**

- Form sections mirroring the canonical schema — employer, employee, period, the reconciliation
  chain, and the three line-item tables — each with a coloured legend dot matching its outlines.
- Line-item tables: a real `<table>` at `lg`, condensed cards on phone, chosen once by a layout
  hook so both never reach the accessibility tree. Add and remove rows.
- Two-way linking: focusing a field highlights and scrolls the preview to its region; clicking a
  region focuses its input. Every input keeps a stable `review-field-…` id, dense table cells
  included.
- Attention marking: amber border, icon, visible explanation, `aria-describedby`.
  **`aria-invalid` is deliberately never used** — an uncertain extraction is not a validation
  failure. Low confidence and a specific warning share one appearance; never both at once.
- Explicit save, never debounced. Confirm disabled while dirty, idempotent thereafter.
- Skeleton state for the line-item sections while the second extraction pass is outstanding.
- **Task 05 rules:** confirm returns `409 confirm_not_allowed` while `tablesStatus` is `pending`;
  table fields are read-only while `pending`, because the tables pass writes only while pending
  and would otherwise overwrite an edit made before it lands. A tables-only retry and a stored
  tables failure reason were not built; decide whether `review` + `tablesStatus: failed` needs
  them (Task 05 D9).
- hr/en copy for every `WARNING_CODES` value, guarded by a test mirroring
  `uploadErrors.test.ts` (Task 02 D8).
- Decide server-side writes against the direct-write gap: `authenticated` can update its own
  `status` and `canonical_data` directly through PostgREST (Task 03 open item 4, Task 04 D2).
- **Task 06 hand-offs:** warnings, `lowConfidenceFields` and `ungroundableFields` come from the
  detail response and need no computation client-side; PATCH recomputes warnings for free
  (computed on read). Decide: excluding edited fields from `lowConfidenceFields` and
  `ungroundableFields`; positional table paths in `unreadableFields` after a row is added or
  removed (Task 06 D5); and how to render `period`/`paymentDate`, which sit below the 0.5
  confidence threshold on most payslips even when correct (history/06).

**Not in this task:** navigation between payslips (10), export (12).

**Definition of done**

- [ ] Every canonical field is visible and editable, including all three tables.
- [ ] Focusing any field scrolls and highlights its region; clicking any region focuses its input.
- [ ] Editing a value marks it edited and dashes its outline; saving recomputes warnings.
- [ ] A payslip with a missing critical field is still fully usable and confirmable.
- [ ] Line-item validation errors are **visible** — the pre-existing receipt-ocr gap where a bad
      item amount blocked submission with no message must not be inherited.

---

### Task 10 — Session navigation & phone layout

**Goal:** Moving between payslips and between pages is obvious, and the form stays usable with
the software keyboard open.

**Depends on:** 07, 09.

**Scope**

- **Payslip selector**: horizontal scroll-snap chip rail on phone, vertical list at `lg`. Chip =
  letterhead-cropped thumbnail + period + status dot. `tablist` with **manual activation**, since
  the panel swaps a rendered preview and a whole form. Truncated rail shows `+N`; the next chip
  peeks ~24 px.
- **Page navigator**: a pager pill inside the preview opening a thumbnail sheet on phone; a 72 px
  vertical page rail inside the source panel at `lg`. Marked up as `<nav>` with
  `aria-current="page"` — **never a tablist nested inside a tabpanel**.
- Desktop three-zone layout: payslip list, sticky source `<aside>`, scrolling form.
- **The keyboard problem**: `interactive-widget=resizes-content` in the viewport meta, plus a
  `visualViewport.resize` fallback for Chrome on iOS which does not support it. Focusing a field
  collapses the preview to a 44 px source strip showing that field's region.
- Every rail control ≥48 CSS px. Selection never indicated by colour alone.

**Not in this task:** merge (11).

**Definition of done**

- [ ] Switching payslips preserves unsaved edits on the one being left.
- [ ] A two-page payslip navigates and highlights across both pages; single-page payslips show no
      pager.
- [ ] Keyboard navigation works: arrows move within the rail, Enter/Space activates, focus is
      visible throughout.
- [ ] Usable at 375 px width with no horizontal page scroll.
- [ ] **Real-iPhone keyboard verification recorded** — see §4.

---

### Task 11 — Merge payslips

**Goal:** Two photographs of one two-page payslip can become one payslip.

**Depends on:** 09, 10.

**Scope**

- Suggestion after extraction when two payslips in a session share an employee OIB and period, or
  an employer OIB and period when the employee OIB is missing on one side. **Never silent.**
- Always-available manual merge from a payslip's action menu — the path that matters when OCR
  failed to read the key at all, which is precisely the case the suggestion cannot cover.
- `POST /api/sessions/:id/merge`: build a combined PDF from the constituent sources with
  `pdf-lib` (already a dependency), create a new payslip, re-extract, soft-delete the originals.
  **Soft-delete the originals before inserting the merged payslip**: the ten-payslip cap counts
  live payslips only, so in a full session the insert would otherwise be refused (Task 03 D3).
- Merge confirmation shows both documents in upload order with a swap control.

**Not in this task:** page reordering beyond that swap.

**Definition of done**

- [ ] Two images of one payslip merge into one payslip with two pages and a re-extracted form.
- [ ] Merging a PDF with an image produces a valid combined PDF.
- [ ] The suggestion fires on matching OIB + period and never fires otherwise.
- [ ] Manual merge works when both OIBs are unreadable.
- [ ] Source payslips are soft-deleted, not hard-deleted, and disappear from the session.

---

### Task 12 — Export & history

**Goal:** Confirmed data gets out, and past work can be found again.

**Depends on:** 09.

**Scope**

- JSON export: full fidelity including all three line-item tables, carrying a `schemaVersion`.
- CSV export: one row per payslip, line-item tables omitted, **UTF-8 BOM and CRLF** so Excel opens
  Croatian diacritics correctly, formula-injection neutralisation on text columns.
- Both scopes — a single payslip and all confirmed — permitted only once confirmed.
- History: flat paginated payslip list with a status filter, cards on phone and a table at `lg`,
  each row linking back into its session's review screen. Soft delete.

**Not in this task:** deployment (13).

**Definition of done**

- [ ] A JSON export re-imported into the scoring harness reproduces the same values — round trip.
- [ ] CSV opens in Excel with `č ć ž š đ` intact.
- [ ] A cell beginning `=` is neutralised.
- [ ] Export of an unconfirmed payslip is refused with the documented code.
- [ ] History survives a session reload and finds payslips from a previous day.

---

### Task 13 — Deploy & end-to-end verification

**Goal:** The PRD §11.1 journey completed on the deployed app, on a phone.

**Depends on:** all.

**Scope**

- The mirror, the Render Blueprint, CI and the Content Understanding configuration already exist
  (Tasks 01b and 04). There is one Foundry resource, so local and hosted share the analyzer and
  `npm run provision:analyzer` checks it. Render asks for `sync: false` variables only when a
  Blueprint is **created**, so a secret added to `render.yaml` later must also be set by hand in
  the Render dashboard.
- End-to-end journeys against the hosted stack, including the multi-payslip session.
- The README PRD §6.7 lists, open since Task 01 (history/01 open item 5).
- Measure PRD §11.4's "four payslips in parallel ≤25 s" as stated; Task 05 measured eleven at once.

**Not in this task:** preview environments, rollback.

**Definition of done**

- [ ] The §11.1 journey completes on the deployed app from a real phone.
- [ ] Cold-start behaviour documented, with the warming step a demo operator needs.
- [ ] No secret reaches the client bundle — only `VITE_`-prefixed values, publishable key
      allow-listed by name.
- [ ] `.env.example` holds names only.

---

## 4. Manual verification steps

These need a human with a physical device. **They must not appear inside an unattended plan** —
each is run separately and its result recorded in the owning task's history file.

| # | Step | Owning task | Record |
| --- | --- | --- | --- |
| M1 | Visual spot-check that outlines sit on their values, all 11 golden-set documents, image and PDF | 08 | Table in `history/08-*.md`: sample, verdict, notes |
| M2 | Real-iPhone keyboard behaviour — field focused, preview collapsed, value and source visible together; Safari `visualViewport` fallback | 10 | Device, iOS version, screenshots, verdict |
| M3 | Real-phone capture journey — camera denial fallback, retake, rotation, one-handed reach on 44 px controls | 07 | Device, verdict per sub-step |
| M4 | Golden-set ground truth spot-check after any fixture change | any | Confirmation in the history file |

---

## 5. Risks carried forward

| Risk | Status | Where it bites |
| --- | --- | --- |
| **Residual latency** — two-pass first form **p50 12.2 s, mean 13.3 s, p90 15.1 s** against ≤10 s (Task 05). Complete form ≤25 s holds at the median (14.0 s) but not for A01, A04, B02 or E01. Single-pass on the same path p50 20.7 s. Concurrency is **not** the cause (single-pass A01 66.8 s alone against 66.3 s with three in flight); the service's generation rate is: ~70–100 tok/s on 2026-09-24/25 against up to 245 on 2026-09-20, with 500K TPM of quota unused | Open, accepted for now; **the product owner expects it improved in a later phase** | A ~600-token scalars pass cannot beat 10 s at that rate. The levers: split the scalars pass further (history/05 option B), now that concurrent analyses cost nothing measurable; re-measure on a faster day first. Needs its own plan and paid runs |
| **Cost per page above target** — PRD §11.4 says ≈ $0.01–0.02. Measured: bake-off ~$0.021, single-pass R1 $0.026, two-pass $0.038–0.043 (Task 05). Most of the single-pass rise is input tokens that were not cached | Open, found in the Task 05 audit | Any further latency split (option B) adds another analysis per document and makes it worse; weigh the two together |
| **Submit stall** — intermittent ~29 s server-side stall on `:analyzeBinary` | Mitigated, not fixed | Worth an Azure support ticket; the retry costs a duplicate analysis |
| **Small corpus** — 11 payslips, 7 layouts, no more available | Accepted | Every accuracy figure describes these seven vendors and no eighth |
| **Hand-written rule creep** — a Croatian parser growing beneath a generic model | Watch | A growing count of deterministic post-processing rules is the signal to revisit the engine, not progress |
| **Phone layout has no prior art** — every document-AI review UI found is desktop-only | Open | Task 10; first thing to put in front of a real user |
| **Inherited gaps** — no password reset, unverified emails, Render cold starts | Accepted | Documented, not fixed. CI exists since Task 01b |
| **Direct-write gap** — a signed-in user can update their own payslip's `status` or `canonical_data` through PostgREST, bypassing the API | Open | Task 09, where confirm and PATCH land: server-side writes plus `revoke update` |
| **In-memory extraction queue** — upload bytes wait in process memory; a redeploy drops in-flight work | Accepted for a demo | Lost jobs fail on the next read after 15 min and are retryable (Task 04 D3). Worst case 10 × 10 MB per session on a 512 MB instance; Task 07's downscale shrinks images |
| **Background writes use the upload's token** — a token near expiry at upload can fail the completion write | Accepted | The row is failed by the stale reaper and is retryable. Task 07: refresh the session before an upload batch |
