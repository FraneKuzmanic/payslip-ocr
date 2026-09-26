# Payslip OCR — Product Requirements Document

| | |
| --- | --- |
| **Status** | Draft for review |
| **Date** | 18 September 2026 |
| **Revision** | v1 |
| **Product stage** | Proof of concept / technology demonstrator |
| **Primary market** | Croatia (Croatian-language payslips, EUR) |
| **Primary extraction platform** | Azure AI Content Understanding (custom analyzer), Sweden Central |
| **Sibling project** | `prototypes/receipt-ocr` — this prototype is forked from it |

**Scope note.** This PRD defines *what* the prototype does and *which* platform it is built on. It deliberately does **not** specify: the final Content Understanding field-schema wording, per-field confidence thresholds, the exact fallback logic between extraction providers, or the outcome of the provider bake-off. Those are owned by the extraction implementation tasks (Phase 2) and by [ADR-0001](./docs/adr/0001-payslip-extraction-architecture.md).

**Vocabulary.** Croatian payroll terms used in this document (`bruto plaća`, `dohodak`, `doprinosi iz plaće` vs `doprinosi na plaću`, `osobni odbitak`, `obustave`, `neoporezivi primici`, `iznos za isplatu`) are defined in [`CONTEXT.md`](./CONTEXT.md) and are used here with exactly those meanings.

---

## 1. Executive Summary

Payslip OCR is a mobile-first web application that turns photographs and PDFs of Croatian payslips into structured, editable data. A user photographs or uploads one or more payslips, the system performs OCR and field extraction, and the user lands on a review screen showing a pre-filled form beside a preview of the original document with every recognised field outlined in place. The user corrects anything the machine got wrong, confirms, and exports to JSON or CSV.

The core value proposition is **the review loop, not the OCR**. Extraction is treated as a draft that a human confirms; the product's job is to make verifying and correcting that draft fast — which is why every extracted value is visually anchored to the pixels it came from, and why a low-confidence value is flagged for attention but never hidden or suppressed.

This prototype is a sibling of `receipt-ocr`, which does the same thing for Croatian receipts and invoices. It reuses that project's architecture, stack, conventions and UI language almost entirely. Two things are genuinely new: **payslips have no prebuilt model anywhere on the market**, so the extraction engine must be schema-driven rather than model-driven; and **the user works with several documents at once**, which introduces a session, a document/page hierarchy, and navigation between them.

**MVP goal.** A user can photograph or upload up to ten Croatian payslips in one session, see each one's fields extracted and highlighted on the document, correct them, and export the confirmed set — with core fields correct at least 95% of the time across a golden set covering seven distinct payroll layouts.

---

## 2. Mission

**Mission statement.** Make the data locked inside a Croatian payslip available in seconds, without the person holding the payslip having to type any of it — and without ever asking them to trust a number they cannot see the source of.

### Core principles

1. **Human-confirmed data.** Extraction produces a draft. Nothing is authoritative until a person has reviewed it. Confidence marks a field for attention; it never suppresses a value or blocks a workflow.
2. **Every value is anchored.** If the system claims a number came from the document, it can point at where. A highlight that cannot be proven to sit on its own text is not drawn at all — an outline in the wrong place is worse than no outline.
3. **Mobile first.** The primary device is a phone held in one hand, photographing a piece of paper. Desktop is the secondary layout, not the design target.
4. **Provider-independent domain model.** The canonical schema is expressed in Croatian payroll terms and knows nothing about Azure, Content Understanding, or any LLM. Swapping the extraction engine must not change a single field name.
5. **Warnings over blocking.** The system says what looks wrong and lets the user proceed. An arithmetic mismatch is information, not a gate.
6. **Proof-of-concept simplicity.** No feature exists because it might be needed later. Where a simpler mechanism does the job, it wins.
7. **Structured for the future.** The seams that would matter in a real product — the extraction provider interface, the canonical schema, the scoring harness — are real from day one, because they are cheap now and expensive to retrofit.

---

## 3. Target Users

### Primary persona — the demo operator

Someone showing the prototype to a prospective client or stakeholder, using real Croatian payslips supplied by that audience.

- **Technical comfort:** high. Comfortable with a browser, a phone camera, and reading a JSON export.
- **Key needs:** the extraction must work on payslips they have never seen before, from employers not in any training set; it must be fast enough that the demo does not stall; and when it gets something wrong, the correction must be obvious and quick, because being *visibly correctable* is part of what is being demonstrated.
- **Primary pain points:** an extraction that silently omits a field looks worse than one that flags it; a spinner longer than about ten seconds kills the room; a highlight drawn in the wrong place destroys confidence in everything else on screen.

### Secondary persona — the payslip holder

An employee in Croatia digitising their own payslips, or supplying them to a third party.

- **Technical comfort:** ordinary. Phone-literate, not document-AI-literate.
- **Key needs:** photograph the paper, see that the app read it correctly, fix the two things it got wrong, get the data out.
- **Primary pain points:** dense payroll tables are hard to check by eye; knowing *which* of forty numbers the app got wrong is the entire problem.

### Explicitly not modelled in this PoC

- Accountants processing payslips in bulk for many employees
- Payroll administrators issuing payslips (this product only ever reads them)
- Any multi-tenant, company or role structure
- Lenders, landlords or agencies as distinct actors with their own workflows

The downstream consumer of the exported data is **deliberately unspecified**. The prototype's job is to prove that accurate structured data can be obtained from a photograph; which system eventually receives it is a later decision, and the schema is kept general rather than shaped to any one use case.

---

## 4. MVP Scope

### 4.1 Core functionality — In Scope

- ✅ Capture a payslip with the phone camera, or choose a file (JPEG, PNG, HEIC/HEIF, PDF)
- ✅ Upload **up to ten payslips in one session**; each uploaded file is one payslip
- ✅ Extract fields from Croatian payslips of any layout, without per-employer configuration
- ✅ Multi-page payslips: a multi-page PDF is one payslip with several pages
- ✅ Review screen: pre-filled form beside a preview of the original document
- ✅ Per-field bounding-box highlights over both images and PDFs, colour-coded by form section
- ✅ Two-way linking: focusing a form field highlights and scrolls to its region; clicking a region focuses its field
- ✅ Switch between payslips in a session, and between pages within a payslip
- ✅ Manual editing of every extracted field, including line-item tables
- ✅ Merge two payslips that turn out to be pages of one (suggested automatically, or triggered manually)
- ✅ Warnings for missing critical fields, failed OIB checksums, and payroll arithmetic that does not reconcile
- ✅ Confirm a payslip; export confirmed payslips as JSON or CSV
- ✅ History of previously processed payslips, with re-open, soft delete and export
- ✅ Retry a failed extraction
- ✅ Croatian and English UI

### 4.2 Data — In Scope

- ✅ Employer and employee identity: name, address, OIB, IBAN
- ✅ Period and payment date
- ✅ The full reconciliation chain: `bruto plaća` → `doprinosi iz plaće` (with MIO I. and II. stup broken out) → `dohodak` → `osobni odbitak` → `porezna osnovica` → `porez na dohodak` → `neto plaća` → `neoporezivi primici` → `obustave` → `iznos za isplatu`
- ✅ Employer-side figures: `doprinosi na plaću`, `ukupan trošak rada`
- ✅ Total hours
- ✅ Three line-item tables: pay components (summing to bruto), obustave, and neoporezivi primici
- ✅ Per-field confidence and provenance metadata (`model` / `text` / `inferred`)
- ✅ EUR only

### 4.3 Technical — In Scope

- ✅ Azure AI Content Understanding custom analyzer as the primary extraction engine
- ✅ A provider abstraction with a second, measured implementation (DI `prebuilt-layout` + LLM + grounding) used to validate the primary choice
- ✅ An offline extraction-scoring harness replaying recorded provider responses against a committed golden set
- ✅ Supabase authentication, Postgres persistence with row-level security, and private file storage
- ✅ Parallel extraction, capped at three concurrent analyses

### 4.4 Integration — In Scope

- ✅ JSON export (full fidelity, including all three line-item tables, with a `schemaVersion`)
- ✅ CSV export (one row per payslip; line-item tables omitted)
- ✅ Both single-payslip and all-confirmed export scopes

### 4.5 Deployment — In Scope

- ✅ Render free tier, from a committed `render.yaml` Blueprint (API web service + static client)
- ✅ Hosted Supabase project
- ✅ One Azure AI Foundry / Content Understanding resource in Sweden Central (Content Understanding GA is not offered in every EU region; Sweden Central was measured working in Phase 2)

### 4.6 Core functionality — Out of Scope

- ❌ Payslip **validation as a product feature** (doc-guard's cross-total checking). Arithmetic identities are computed, but only to raise review warnings — never to accept or reject a document.
- ❌ Splitting one uploaded file into several payslips
- ❌ Reordering pages within a payslip beyond the swap offered at merge time
- ❌ Drag-and-drop as a navigation or merge affordance
- ❌ Cross-payslip aggregation (e.g. "average net over three months")
- ❌ Bulk actions across a session (confirm all, export all as one operation beyond the existing all-confirmed export)
- ❌ Annotating or redrawing a bounding box by hand
- ❌ Password reset, email verification, MFA, SSO

### 4.7 OCR / AI — Out of Scope

- ❌ Pre-2023 **HRK** payslips and the `prirez` line that accompanies them
- ❌ Handwritten payslips (Azure custom models do not support handwritten Croatian)
- ❌ Any language other than Croatian
- ❌ Non-payslip documents (NP1, IO1, NO1, JOPPD forms, employment contracts)
- ❌ Training a custom model on labelled samples
- ❌ Self-hosted OCR or VLM inference

### 4.8 Integration — Out of Scope

- ❌ Pushing data to any accounting, payroll, HR or banking system
- ❌ A public or third-party API
- ❌ Webhooks or scheduled processing
- ❌ PDF or spreadsheet report generation

---

## 5. User Stories

**US-01 — Photograph a payslip.**
As someone holding a paper payslip, I want to photograph it with my phone, so that I do not have to type forty numbers into a form.
*Example:* I open the app on my phone, tap **Skeniraj platnu listu**, the camera opens, I photograph the A4 sheet on my desk, and within about ten seconds I am looking at a filled-in form.

**US-02 — Upload several payslips at once.**
As someone with three months of payslips as PDFs, I want to select all three at once, so that I do not repeat the same upload flow three times.
*Example:* I choose `lipanj.pdf`, `srpanj.pdf` and `kolovoz.pdf` together; the review screen opens immediately with three chips in the rail, each showing its own progress.

**US-03 — See what the machine read, and where.**
As someone checking an extracted value, I want to see the exact spot on the document it was read from, so that I can verify it without hunting through a dense table.
*Example:* I tap the **Neto plaća** field; the preview scrolls and zooms to a blue outline around `2.298,97` on page 1.

**US-04 — Correct a mistake.**
As someone who spotted a wrong value, I want to edit it directly in the form, so that the exported data is right.
*Example:* The employee's surname came out as `KLENKAR DAVQR`; I tap the field, fix the letter, and the field is marked as edited.

**US-05 — Be told what to check.**
As someone reviewing forty fields, I want the app to tell me which ones it is unsure about, so that I check those first instead of reading everything.
*Example:* Three fields have an amber border; one says the payslip's own arithmetic does not add up — `bruto − doprinosi ≠ dohodak` — and I find the app misread a digit in `doprinosi iz plaće`.

**US-06 — Move between payslips.**
As someone reviewing a batch, I want to switch between payslips without losing my corrections, so that I can work through them in any order.
*Example:* I am halfway through March, tap the April chip to check something, come back, and my March edits are still there.

**US-07 — Move between pages.**
As someone reviewing a two-page payslip, I want to move to page 2, so that I can check the fields that live there.
*Example:* The `OBUSTAVE` table is on page 2; I tap **Stranica 2 od 2** and the preview moves, with the obustave rows outlined.

**US-08 — Join two photographs of one payslip.**
As someone who photographed a two-page payslip as two separate images, I want to join them into one payslip, so that I get one complete form instead of two half-empty ones.
*Example:* The app notices both images carry the same employer OIB and period and offers **Spoji u jednu platnu listu**; I accept, and one payslip with two pages replaces the two.

**US-09 — Export the data.**
As someone who has finished reviewing, I want to download the confirmed payslips as JSON or CSV, so that I can use the data elsewhere.
*Example:* I tap **Preuzmi**, choose JSON, and get a file containing all three payslips with their full line-item tables.

**US-10 — Come back later.**
As someone interrupted mid-review, I want to find my session again, so that I do not start over.
*Example:* I close the tab, sign in tomorrow, open **Povijest**, and re-enter the session with my edits intact.

**US-11 — Recover from a failure.**
As someone whose upload failed, I want to know why and try again, so that one bad file does not end the session.
*Example:* One photo was too blurred; its chip shows an error, the other two extracted fine, and I retake just that one.

**US-12 — Work in my own language.**
As a Croatian speaker, I want the interface in Croatian, so that the labels match the words printed on the payslip.
*Example:* The form says **Bruto plaća**, exactly as the document does; switching to English shows **Gross pay** without changing any data.

### Technical user stories

**US-13 — Measure extraction quality.**
As a developer, I want an offline harness that scores extraction against a golden set, so that I can tell whether a change helped or hurt without calling Azure.

**US-14 — Swap the extraction engine.**
As a developer, I want the extraction provider behind an interface, so that a second engine can be measured against the first without touching the schema, the API or the UI.

**US-15 — Debug an extraction after the fact.**
As a developer, I want the raw provider response retained, so that region mapping and field mapping can be re-derived later without re-analysing the document.

---

## 6. Core Architecture & Patterns

### 6.1 High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  CLIENT  (React 19 + Vite, mobile-first)                        │
│                                                                 │
│  Capture ──► Session review ─────────────────────────────────┐  │
│              ├─ Payslip chip rail    (switch payslip)        │  │
│              ├─ Source panel         (preview + highlights)  │  │
│              │   └─ page pager / page sheet                  │  │
│              └─ Review form          (edit, warnings)        │  │
│                                                              │  │
│  History ──► re-open · export · delete ──────────────────────┘  │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS, Bearer <supabase token>
┌───────────────────────────▼─────────────────────────────────────┐
│  API  (Express 5)                                               │
│                                                                 │
│  upload ─► sniff bytes ─► store source ─► extract ─► map ─────┐  │
│                                                              │  │
│  DocumentExtractionProvider (interface)                      │  │
│    ├─ ContentUnderstandingProvider   ◄── primary             │  │
│    └─ LayoutPlusLlmProvider          ◄── challenger          │  │
│                                                              │  │
│  canonical mapping · warnings · source regions · export ◄────┘  │
└───────────┬──────────────────────────────┬──────────────────────┘
            │                              │
┌───────────▼──────────┐      ┌────────────▼─────────────────────┐
│  Supabase            │      │  Azure AI                        │
│  Postgres + RLS      │      │  Content Understanding analyzer  │
│  Auth                │      │  Document Intelligence (layout)  │
│  Private storage     │      │  Azure OpenAI gpt-4.1 (both)     │
└──────────────────────┘      └──────────────────────────────────┘
```

### 6.2 Core pattern — the provider-independent canonical model

Everything the application stores, displays, validates and exports is expressed in the canonical schema. No Azure vocabulary, no Content Understanding field names, and no LLM output shape reaches any layer above the provider adapter.

```
raw provider response          (retained verbatim, never read by the UI)
        │
        ▼
  field mapping        ── the ONLY place provider field names appear
        │
        ▼
 canonical Payslip     ── Croatian payroll terms, decimal strings
        │
        ├──► warnings         (arithmetic identities, OIB checksums)
        ├──► source regions   (read-time projection over the raw response)
        └──► export           (JSON full fidelity · CSV flat)
```

Two rules make this enforceable rather than aspirational:

- **Provider vocabulary lives in exactly one module.** A test in `shared/` fails the build if any Azure or provider-specific identifier appears there — the same guard receipt-ocr uses.
- **Source regions are a read-time projection.** They are derived from the retained raw response on request, not stored. This is what let receipt-ocr add PDF highlighting with no schema change, no migration and retroactive effect on every already-analysed document; the same property applies here.

### 6.3 Extraction provider abstraction

```ts
interface DocumentExtractionProvider {
  extract(input: {
    bytes: Buffer;
    contentType: string;
    signal: AbortSignal;
    pass: "scalars" | "tables";   // Task 05: two passes over the same document
  }): Promise<ExtractionResult>;
}

interface ExtractionResult {
  fields: Partial<CanonicalPayslipFields>;   // only the pass's own keys
  metadata: ExtractionMetadata;   // provider, modelId, apiVersion, latencyMs,
                                  // per-field {confidence, source}, unreadableFields;
                                  // the runner adds queuedMs
  raw: unknown;                   // retained verbatim for later projection
}

class ExtractionError extends Error {
  reason: "unreadable_document" | "provider_rejected" | "provider_unavailable";
  retryable: boolean;
}
```

`ContentUnderstandingProvider` is the one implementation in the API. The DI-layout + LLM challenger answered one question — *is the primary actually good enough?* — in the Phase 2 bake-off, and stays implemented as the measured fallback in `scripts/bakeoff/`, not behind this interface: a selector with one legal value would be speculative (ROADMAP Task 04 D13). Promoting it means porting it behind the interface. See [ADR-0001](./docs/adr/0001-payslip-extraction-architecture.md).

### 6.4 Canonical schema

Conceptual shape. All monetary values are **decimal strings**, never JavaScript numbers, and are parsed from the provider's own text rather than from any numeric field the provider offers — a float round-trip silently corrupts cents.

```ts
interface CanonicalPayslip {
  // --- structure (English) ---
  id: string;
  sessionId: string;
  status: "processing" | "review" | "confirmed" | "failed";
  pageCount: number;
  currency: "EUR";

  // --- parties (English) ---
  employerName: string | null;
  employerAddress: string | null;
  employerOib: string | null;
  employerIban: string | null;
  employeeName: string | null;
  employeeAddress: string | null;
  employeeOib: string | null;
  employeeIban: string | null;

  // --- period (English) ---
  period: string | null;          // "2025-06"
  paymentDate: string | null;     // "2025-07-10"
  ukupnoSati: string | null;      // total hours

  // --- the reconciliation chain (Croatian) ---
  brutoPlaca: string | null;
  doprinosiIzPlace: string | null;
  doprinosMioIStup: string | null;
  doprinosMioIiStup: string | null;
  dohodak: string | null;
  osobniOdbitak: string | null;
  poreznaOsnovica: string | null;
  porezNaDohodak: string | null;
  netoPlaca: string | null;
  neoporeziviPrimiciUkupno: string | null;
  obustaveUkupno: string | null;
  iznosZaIsplatu: string | null;

  // --- employer side (Croatian) ---
  doprinosiNaPlacu: string | null;
  ukupanTrosakRada: string | null;

  // --- line items (Croatian) ---
  payComponents: Array<{
    naziv: string | null;
    sati: string | null;
    koeficijent: string | null;
    iznos: string | null;
  }>;
  obustave: Array<{
    naziv: string | null;
    vjerovnik: string | null;
    iznos: string | null;
    ostatakSalda: string | null;
    brojRata: string | null;
  }>;
  neoporeziviPrimici: Array<{
    naziv: string | null;
    iznos: string | null;
  }>;
}
```

**Schema rules**

- Every field is nullable. A payslip that omits `ukupan trošak rada` is valid; four of the seven sample layouts print it and three do not.
- Money and hours are decimal strings (`"2.298,97"` on the page becomes `"2298.97"` in the model). `big.js` in strict mode is the only arithmetic.
- Field identifiers are **Croatian for payroll concepts that do not survive translation** and **English for generic structure**. `dohodak` is not "income"; `obustave` are not "deductions" in the sense `osobniOdbitak` is. doc-guard named employer-side contributions `benefits` and employee-side `witholdings`, and both names actively mislead.
- Identifiers are fixed regardless of UI language. All user-facing labels are translated separately; a JSON export whose keys changed with the language switcher would be unusable downstream.
- A value that was present but could not be normalised is recorded as **unreadable** rather than stored as a wrong value.

### 6.5 Critical fields

Seven fields drive the `missing_critical_field` warning and the headline accuracy score:

`employerName` · `employeeName` · `employeeOib` · `period` · `brutoPlaca` · `netoPlaca` · `iznosZaIsplatu`

The asymmetry is deliberate. `iznosZaIsplatu` is critical because it is the only figure that matches the employee's bank statement; `doprinosMioIiStup` is not, because a user can reconstruct it and its absence does not make the payslip useless.

### 6.6 State machines

**Payslip**

```
   upload
     │
     ▼
 processing ──── extraction succeeds ───► review ──► confirmed
     │                                      ▲           │
     │                                      └───────────┘
     │                                       (edits still allowed)
     └──── extraction fails ───────► failed
                                       │
                                       └── retry (retryable reasons only) ──► processing
```

**Tables** (Task 05). Extraction runs as two passes over the same document: the scalars pass moves the payslip from `processing` to `review`; the tables pass records the three line-item tables. They land in either order. Whether the tables have landed is its own field, `tablesStatus`, not a payslip status:

```
 pending ──── tables pass recorded ───► ready
    │
    └──── tables pass failed, cancelled or reaped ───► failed
```

`review` with `tablesStatus: failed` is a usable payslip whose tables did not arrive, distinct from a `failed` payslip. Confirm is refused while `tablesStatus` is `pending`.

**Session** has no status of its own. It is a container; its progress is derived from the statuses of the payslips it holds ("3 of 5 confirmed").

### 6.7 Suggested repository structure

Forked from `receipt-ocr`. Three flat npm workspaces at the prototype root.

```
prototypes/payslip-ocr/
├── PRD.md  README.md  CONTEXT.md  AGENTS.md
├── package.json  tsconfig.json  tsconfig.base.json  vitest.config.ts
├── render.yaml  .env.example  .oxlintrc.json  .prettierrc.json
├── docs/
│   ├── adr/0001-payslip-extraction-architecture.md
│   └── agents/{domain,issue-tracker,triage-labels}.md
├── .agents/
│   ├── ROADMAP.md  plans/  history/  specs/
│   └── fixtures/expected/*.json        # golden set (sources git-ignored)
├── scripts/
│   ├── score-extraction.ts             # offline accuracy + latency harness
│   ├── record-provider-fixture.mjs
│   └── compare-providers.mjs           # the bake-off harness
├── supabase/migrations/  tests/
├── shared/src/
│   ├── index.ts  payslip.ts  api.ts  money.ts  datetime.ts
│   ├── warnings.ts  upload.ts  session.ts
├── api/src/
│   ├── routes/{sessions,payslips,health}.ts
│   ├── repositories/{sessions,payslips}.ts
│   ├── services/{payslip-extraction,payslip-merge}.ts
│   ├── storage/payslip-sources.ts
│   ├── upload/{multipart,source-file}.ts
│   ├── validation/warnings.ts
│   ├── export/payslips.ts
│   └── providers/document-extraction/
│       ├── types.ts
│       ├── content-understanding/{provider,fields,regions}.ts
│       ├── layout-llm/{provider,prompt,grounding}.ts
│       ├── croatian.ts        # OIB checksum, number + date normalisation
│       └── fixtures/*.json
└── client/src/
    ├── capture/  auth/  components/  i18n/
    ├── routes/{HomePage,SessionReviewPage,HistoryPage,…}.tsx
    ├── session/{PayslipChipRail,PayslipStatusDot,MergeDialog}.tsx
    └── review/{reviewForm,LineItemRows,SourceDocumentPanel,PdfSource,
                ZoomableSourceViewport,SourceOverlay,RegionPopover,
                PageSheet,sourceZoom,regionSections}.ts(x)
```

---

## 7. Tools / Features

### 7.1 Authentication

**Purpose.** Give each user a private space so history and stored documents have an owner.

**Requirements.** Supabase email/password authentication, mirrored from receipt-ocr. Protected routes; a `401` from any call signs the user out and the route guard redirects. Email confirmation disabled. **Password reset is not built** — an inherited gap, recorded in §14.

### 7.2 Capture

**Purpose.** Get one or more payslips into the system with the fewest taps.

**Requirements.** Device-adaptive pickers driven by `(pointer: coarse)`: on a phone, a primary **Skeniraj** button (`capture="environment"`) plus a permanently visible **Odaberi datoteku**; on desktop, file choice only. The file input accepts **multiple files**, capped at ten per upload. Accepted types are sniffed from the **bytes**, not the filename: JPEG, PNG, HEIC/HEIF, PDF. Images over 2 MP or 1.5 MB are re-encoded to a 1,600 px long edge at quality 0.82, and the preview is built from the exact bytes that upload. Advisory blur and resolution warnings are shown but never block.

Selected files collect in a **tray** before anything uploads (Task 07): each **Skeniraj** press opens the camera once and adds one photo, since `capture` opens a single-shot camera on which `multiple` is ignored or unreliable; **Odaberi datoteku** adds several at once. The tray stops at ten and says how many were left out. An image the browser cannot decode (HEIC outside Safari) is shown as a file card with a note instead of a preview, and its **original bytes** upload: the service decodes HEIC, so it is not refused.

### 7.3 Session and payslip creation

**Purpose.** Establish the scope within which several payslips are reviewed together.

**Expected flow.** The client refreshes its auth session, creates a Session, then POSTs each selected file to it as its own Payslip, **one at a time in tray order**, so upload order is selection order. The refresh gives the background extraction writes, which use the token the upload carried, the full token lifetime. Each POST starts extraction immediately and returns `201` without waiting. The client navigates to the session review screen as soon as the first Payslip exists; the remaining uploads continue in the background.

**Rules.** One Source File is always exactly one Payslip — a three-page PDF is one Payslip with three Pages. Extraction runs in parallel, capped at three concurrent analyses. A payslip is two analyses (the scalars and tables passes, §7.4), and a waiting scalars pass is served before any tables pass, so forms appear before the last tables start. A Payslip that fails does not affect its siblings.

### 7.4 Extraction

**Purpose.** Turn a payslip document into canonical fields with per-field geometry and confidence.

**Requirements.** Primary engine is an Azure Content Understanding custom analyzer with a Croatian-language field schema and `estimateFieldSourceAndConfidence` enabled, so page, bounding quad and confidence arrive per field including for nested table rows. Extraction runs as **two analyzers over the same document** (Task 05), partitioned from one field schema with the descriptions unchanged: `<id>_scalars` returns the scalar fields and makes the form usable; `<id>_tables` returns the three line-item tables. Each pass has its own timeout via `AbortController` and is recorded atomically on its own, in either order. A scalars failure fails the payslip and cancels its tables pass; a tables failure leaves a usable payslip with `tablesStatus: failed`. Failures classified into `unreadable_document` (non-retryable), `provider_rejected` (non-retryable) and `provider_unavailable` (retryable). The raw response is retained verbatim.

**Rules.** Confidence never suppresses a value. Amounts are parsed from text, never from a numeric field. A value that cannot be normalised is recorded as unreadable rather than guessed.

### 7.5 Source regions and highlighting

**Purpose.** Prove that every extracted value came from a specific place on a specific page.

**Requirements.** A read-time projection converts provider polygons into **page-relative fractions** by dividing by that page's own dimensions, and returns them with each page's aspect ratio. This normalisation is what makes images and PDFs identical to the client and is carried over unchanged from receipt-ocr. Regions carry the canonical dotted field path (`netoPlaca`, `payComponents.2.iznos`), a page number, four corners and an origin.

**Rules.** An outline is drawn **only** when the rendered aspect ratio agrees with the API's declared ratio within 0.01. A mismatch — EXIF rotation, an unexpected `/Rotate`, a pdf.js disagreement — withholds outlines rather than misplacing them, and a translated note says so. Colour follows the form's section legend. An edited field's outline is dashed.

Since Task 08: a value printed across several lines has one outline per line. Every region's origin is `model`, the service's own source; a value without one has no outline, and there is no re-grounded fallback. An unreadable value (printed, but not normalisable) is still outlined. Content Understanding applies EXIF orientation and PDF `/Rotate` before reporting page sizes and quads (measured on an EXIF 6 photo and a `/Rotate 90` PDF), so both are outlined correctly. A 180° rotation cannot be detected by aspect ratio; it is correct as long as the service keeps applying the rotation. An image the browser cannot decode (HEIC outside Safari) shows a translated notice and the open-in-new-tab link instead of a broken preview.

### 7.6 Session navigation

**Purpose.** Let the user move between payslips and between pages without losing state.

**Requirements.** Two controls, deliberately not one — established document-review practice splits document selection from page navigation, and the two levels are semantically different (payslips are alternatives to each other; pages are sequential parts of one thing).

- **Payslips:** a horizontal scroll-snap chip rail below `xl`, a vertical list at `xl`. Each chip carries its position, period (or filename), status icon with text, and an unsaved-edits mark when needed. No thumbnails: letterheads within a session look alike. Implemented as a `tablist` with **manual activation**, since the panel swaps a rendered preview and a whole form. A truncated rail shows a `+N` badge on the last visible chip, and the next chip peeks ~24 px.
- **Pages:** a pager pill inside the preview (`‹ Stranica 2 od 3 ›`) that opens a thumbnail sheet on tap; at `lg`, a 72 px vertical page rail inside the source panel. Marked up as a `<nav>` with `aria-current="page"`, never a tablist nested inside a tabpanel.

**Rules.** Every rail control has a hit box of at least 48 CSS px. Selection is never indicated by colour alone. The preview displays one page at a time; every page is reachable from the pager, sheet or rail, none only by horizontal scroll. Single-page payslips show no page navigator.

### 7.7 Review form

**Purpose.** Let the user verify and correct every extracted value.

**Requirements.** Sections mirroring the canonical schema — employer, employee, period, the reconciliation chain, pay components, obustave, neoporezivi primici — each with a coloured legend dot matching its outlines. Every input keeps a stable id so a region click can focus it. Saving is explicit, never debounced: locale-formatted values normalise on save, not mid-typing. Line-item tables render as a real table at `lg` and as condensed cards on phone, chosen once by a layout hook so both never reach the accessibility tree.

**Rules.** A field needing attention gets an amber border, an icon and a visible explanation. `aria-invalid` is deliberately never used for attention — an uncertain but plausible extraction is not a validation failure. Editing is permitted in `review` and `confirmed`; confirming is disabled while the form is dirty and is idempotent thereafter.

Settled in Task 09:

- **Edited values.** A saved change dashes its outline: scalars and table cells, cells by position. Once a row is added or removed, every cell from the first differing row down counts as edited, because those rows no longer line up with the document.
- **Input formats follow the UI language.** `hr` shows `2298,97`, `0,135`, `10.07.2025` and `07/2025`; `en` shows the stored `2298.97`, `0.135`, `2025-07-10` and `2025-07`. No grouping separators, so a value always parses back. Both forms parse in either language.
- **Line breaks** in a stored value are joined into a space in its single-line input. Only changed fields are sent on save, so an untouched value keeps its breaks.
- **Line items by tables status.** While the tables pass is `pending`, the three tables are a read-only skeleton, because that pass would overwrite an earlier edit; once `failed`, each says so and rows can be added by hand.
- **Unsaved edits** are kept per payslip in the tab while the user switches payslips, goes Back or leaves the session; the browser prompts on reload. They are not persisted across reload or sign-out.
- **Phone keyboard layout (Task 10).** While typing on a coarse-pointer device below `lg`, a fixed 64 px source strip shows the active field's first safe region, or an explicit no-outline note. The bottom navigation and action bar hide until focus leaves the input. `interactive-widget=resizes-content` and `visualViewport` offsets support keyboard resizing; real-iPhone verification remains M2.
- **A sticky action bar** holds the unsaved indicator, Save, and Confirm with the visible reason it is unavailable. Controls are at least 48 px.
- **Format errors** (text that will not parse on save) are validation failures: red text under the input, `aria-invalid`, and a form-level alert on a failed save. They are visible in both the table and the card layout.
- **Region interaction.** At `lg`, clicking an outline focuses its input; on a phone it opens the popover, whose Edit does. Escape closes the popover.

### 7.8 Merge

**Purpose.** Recover when one payslip was photographed as two files.

**Expected flow.** After extraction, two Payslips in the same Session that share an employee OIB and period — or, when the employee OIB is missing on one side, an employer OIB and period — raise a non-blocking suggestion. The user can also trigger a merge manually from a payslip's action menu at any time, which is the path that matters when OCR failed to read the key at all.

**Rules.** Never merge silently. The merge confirmation shows both documents in upload order with a swap control. Merging **combines the source files into a single PDF and re-extracts** — stitching two independently extracted results would require reconciling two disagreeing `bruto` values with no principled tiebreak. The two source Payslips are soft-deleted and replaced by one. There is no drag affordance: WCAG 2.2 SC 2.5.7 would require a non-dragging equivalent anyway, so only the menu action is built.

### 7.9 Warnings

**Purpose.** Direct the user's attention to the few fields likely to be wrong.

**Requirements.** Computed on every read, never stored (Task 06 D1): a pure function of the canonical fields, the status, `tablesStatus` and the unreadable paths, so each extraction pass and every save recompute them by construction. Only a payslip in `review` or `confirmed` carries warnings. Codes and field paths only; all copy lives in the client locales.

| Code | Check |
| --- | --- |
| `missing_critical_field` | One of the seven critical fields is absent |
| `unparseable_amount` / `unparseable_date` | Text was present but could not be normalised |
| `oib_checksum_failed` | Employer or employee OIB fails ISO 7064 MOD 11,10 |
| `dohodak_mismatch` | `brutoPlaca − doprinosiIzPlace ≠ dohodak` |
| `porezna_osnovica_mismatch` | `dohodak − osobniOdbitak ≠ poreznaOsnovica` (floored at zero) |
| `neto_mismatch` | `dohodak − porezNaDohodak ≠ netoPlaca` |
| `isplata_mismatch` | `netoPlaca + neoporeziviPrimiciUkupno − obustaveUkupno ≠ iznosZaIsplatu` |
| `pay_components_sum_mismatch` | `Σ payComponents.iznos ≠ brutoPlaca` |

**Rules.** Arithmetic compares absolutely, never relatively: values must **agree to the cent**, so a difference of one cent or more is a mismatch — doc-guard's identities were correct but compared to nine significant figures, which no OCR'd cent value survives. `poreznaOsnovica` floors at zero, because a payslip whose `osobni odbitak` exceeds `dohodak` legitimately prints `0,00`. An identity with a null operand is skipped, except that `isplata_mismatch` takes a null `neoporeziviPrimiciUkupno` or `obustaveUkupno` as zero (an absent section contributes nothing). `pay_components_sum_mismatch` sums amounts only, never hours, and is checked only once `tablesStatus` is `ready` and at least one row has an amount. An unreadable field raises `unparseable_*` instead of `missing_critical_field` while its value is still null. **Warnings never block confirmation or export.**

Two further attention signals ride with the warnings on the detail response: `lowConfidenceFields` (confidence below a global 0.5, measured in Task 06) and `ungroundableFields` (the printed value, or a printed form of its canonical value, is not among the page's OCR words). Like warnings, they mark a value and never suppress it.

Task 09 narrowed both:

- **An edited value drops its machine signals.** A path the user edited leaves `lowConfidenceFields`, `ungroundableFields` and `unreadableFields`, and so does every table path whose row no longer exists, so no `unparseable_*` warning points at a shifted or deleted row. Warnings are still computed from the current values, so an edit that breaks an identity still raises it.
- **`period` and `paymentDate` count as low confidence only when also ungroundable.** The service reports both below 0.5 on most payslips even when correct. The rule dropped about half of all flagged scalars and no wrong one (history/09). `period` is never ungroundable by design, so warnings are what mark it.

### 7.10 History

**Purpose.** Find and re-open past work.

**Requirements.** A flat, paginated list of payslips — mirroring receipt-ocr's existing screen rather than redesigning it — with a status filter, cards on phone and a table at `lg`. Each row links back into its Session's review screen. Soft delete. Per-payslip and all-confirmed export.

### 7.11 Export

**Purpose.** Get the confirmed data out.

**Requirements.** JSON carries full fidelity including all three line-item tables and a `schemaVersion`. CSV is one row per payslip with the line-item tables omitted, UTF-8 BOM and CRLF so Excel opens Croatian diacritics correctly, and formula-injection neutralisation on text columns. Both single-payslip and all-confirmed scopes. Export is permitted only once a payslip is confirmed.

### 7.12 Extraction scoring

**Purpose.** Know whether extraction is getting better or worse.

**Requirements.** An offline harness replaying **recorded provider responses** through the real production mapper, warning pipeline and normalisation — no network call — against committed ground truth. Reports per-critical-field match rates, per-field-instance totals, line-item accuracy, most-corrected fields, recorded provider latency percentiles, and (Task 06) the warnings raised, the OIB checksum pass rate, and how many wrong values carry an attention signal.

**Rules.** The harness **must fail loudly when a golden-set entry is not scored**. receipt-ocr learned this the hard way: eight defective receipts sat outside its corpus while it reported healthy numbers, because a fixture without ground truth was silently skipped.

### 7.13 Internationalisation

**Purpose.** Serve Croatian users in Croatian.

**Requirements.** `i18next` with Croatian and English, detection from `localStorage` then navigator, initialised before first render, keys compile-checked by a type augmentation so an unknown key is a type error. Guard tests assert both languages have identical key sets and that every warning code and payslip status has copy in both. No user-facing string may be hardcoded. The language switcher is always visible.

---

## 8. Technology Stack

### Frontend

| Technology | Version | Notes |
| --- | --- | --- |
| React | 19 | |
| Vite | 8 | |
| TypeScript | 7 | `strict`, `noUncheckedIndexedAccess`, `bundler` resolution |
| Tailwind CSS | 4 | via the Vite plugin; tokens in an `@theme` block, no config file |
| react-router | 8 | **never** `react-router-dom` |
| react-hook-form | 7 | |
| i18next / react-i18next | 26 / 17 | hr + en |
| pdfjs-dist | 6 | **legacy build**, dynamically imported, isolated in one module |
| lucide-react | 1 | icons |
| @supabase/supabase-js | 2 | |

### Backend

| Technology | Version | Notes |
| --- | --- | --- |
| Node.js | ≥ 24 | |
| Express | 5 | |
| multer | 2 | memory storage, one file per request |
| zod | 4 | canonical schema and every DTO |
| big.js | 7 | `Big.strict = true`; all money arithmetic |
| pino / pino-http | 10 | structured logs, never document contents |
| helmet, cors | | |
| file-type | 22 | byte sniffing |
| pdf-lib | 1 | encryption + page-count checks, and building merged PDFs |

### Extraction

| Technology | Version / ID | Notes |
| --- | --- | --- |
| Content Understanding REST API | `2025-11-01` (GA) | **primary**; called over `fetch`, no SDK |
| Content Understanding analyzer | custom, `baseAnalyzerId: prebuilt-document` | Croatian field schema, `estimateFieldSourceAndConfidence: true` |
| `@azure-rest/ai-document-intelligence` | 1.1.0 | challenger path; api-version `2024-11-30`, `prebuilt-layout` |
| Azure OpenAI `gpt-4.1` | deployment on the same Foundry resource | CU's completion model, and the challenger's LLM (strict JSON schema, called over `fetch`) |

### Data platform

| Technology | Notes |
| --- | --- |
| Supabase | Hosted Postgres + auth + private storage bucket |
| Postgres RLS | Owner-scoped policies on tables and on storage objects |

### Testing

| Technology | Version | Notes |
| --- | --- | --- |
| Vitest | 4 | workspace projects: shared (node), api (node), client (jsdom) |
| Testing Library | 16 | |
| supertest | 7 | API integration |
| oxlint | 1 | **not ESLint** — TypeScript 7 is the Go port and no longer exports the JS compiler API, so `typescript-eslint` cannot work |
| Prettier | 3 | `*.md` excluded (hand-aligned tables) |

### Explicitly excluded

- **ESLint / typescript-eslint** — incompatible with TypeScript 7
- **Any state-management library** — React state plus react-hook-form is sufficient
- **Any component library** — Tailwind utilities and `lucide-react` only
- **Tesseract, OCRmyPDF, camelot, Ghostscript** — doc-guard's stack; heavyweight native dependencies that are painful to deploy and, decisively, destroy the geometry this product depends on
- **Self-hosted OCR/VLM inference** — break-even against managed services is on the order of 50–100k pages/month
- **Docker** — used only for the optional local Supabase stack

---

## 9. Security & Configuration

### 9.1 Authentication and authorisation

Supabase email/password. Every `/api/sessions` and `/api/payslips` route sits behind an auth guard applied to the **path prefix**, not to individual routes, so a route added later is protected by construction and an unknown path answers `401` rather than `404`. The proven user id is passed to handlers as an argument, never read off the request object, so a handler is structurally incapable of using an unproven identity. A resource belonging to another user returns **404, never 403** — it falls out of the owner-scoped query rather than a separate check.

Every payslip write goes through a `security definer` SQL function that enforces the API's own rule and filters on `user_id = auth.uid()` (Task 09). `authenticated` can then lose its direct `update` grant, so a signed-in user cannot set their own payslip's `status` or `canonical_data` through PostgREST. The functions are applied; the revoke is applied once the API that uses them is deployed (Task 09 step P).

### 9.2 Secrets and configuration

One `.env` at the prototype root, validated at startup with all problems reported at once. `.env.example` is committed with **names only**.

```
PORT, NODE_ENV, LOG_LEVEL, WEB_ORIGIN
AZURE_CONTENT_UNDERSTANDING_ENDPOINT      # required, server-only
AZURE_CONTENT_UNDERSTANDING_KEY           # required, server-only
AZURE_CU_ANALYZER_ID                      # e.g. hr-payslip
AZURE_CU_API_VERSION                      # 2025-11-01
EXTRACTION_TIMEOUT_MS, EXTRACTION_CONCURRENCY   # per pass; concurrent analyses
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT      # challenger path only
AZURE_DOCUMENT_INTELLIGENCE_KEY           # challenger path only
AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_KEY   # challenger path only
AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_VERSION
EXTRACTION_TIMEOUT_MS, EXTRACTION_CONCURRENCY
MAX_UPLOAD_BYTES, MAX_PDF_PAGES
SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, STORAGE_BUCKET
VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, VITE_API_BASE_URL
```

The ten-payslip cap is not an environment variable. It is `MAX_PAYSLIPS_PER_SESSION` in `shared/`, enforced atomically by a database trigger, because a value enforced in SQL cannot be configured from Node.

**Rules.** Only `VITE_`-prefixed variables may reach the browser bundle; the publishable key is allow-listed by name and any other secret-shaped `VITE_` name is rejected by a validation check. No extraction credential is ever exposed to the client.

### 9.3 File security

Content type is determined by **byte sniffing**, never the filename or the declared type. PDFs are additionally checked for encryption and page count. The storage object path is `{userId}/{payslipId}/source` — an untrusted original filename stays database metadata and never becomes a path. Source URLs are signed with a 300-second TTL.

### 9.4 Privacy

A Croatian payslip contains name, home address, OIB, IBAN, exact salary, and often union membership and loan balances. For this prototype: any processing region is acceptable and a third-party LLM is acceptable, per an explicit product decision recorded in Appendix C. Payslips and their sources **are persisted**, scoped to the uploading user by row-level security.

Worth stating plainly for anyone reading this later: **this posture is appropriate for a demo and not for production.** Content Understanding and `gpt-4.1` share one Azure AI Foundry resource in Sweden Central; Content Understanding keeps data at rest in-region and retains async outputs for at most 24 hours. `:analyzeBinary` processes in the `global` processing location unless `processingLocation=geography|dataZone` is passed, and this prototype does not override it (ROADMAP Task 04 D14). The challenger's Document Intelligence call runs on a separate, older resource whose region has not been recorded. Deployment data-zone settings and Azure OpenAI abuse-monitoring retention have not been reviewed either. Productionising would require a DPIA regardless.

### 9.5 Security out of scope

Roles and permissions, multi-tenancy, MFA, SSO, audit logging, rate limiting, virus scanning of uploads, data-retention policies and deletion workflows, penetration testing.

---

## 10. API Specification

All routes under `/api/sessions` and `/api/payslips` require `Authorization: Bearer <supabase access token>`. Every failure is `{"error": {"code": "…"}}` — a stable machine code, never prose; the client translates codes into Croatian and English.

**10.1** `GET /api/health` → `200 {status, uptimeSeconds}`

**10.2** `POST /api/sessions` → `201 {id, createdAt}`

**10.3** `POST /api/sessions/:id/payslips`
`multipart/form-data`, exactly one part `file`, zero text fields. Starts extraction immediately.
→ `201 {id, sessionId, status, createdAt}` · `413 file_too_large` · `415 unsupported_media_type` · `422 pdf_encrypted | pdf_too_many_pages | pdf_unreadable` · `409 session_full`

**10.4** `GET /api/sessions/:id`
→ `200 {id, createdAt, payslips: [{id, status, tablesStatus, period, employeeName, pageCount, failureReason, warningCount, originalFilename}]}`. `originalFilename` identifies a payslip before extraction has read a name (Task 07).

**10.5** `GET /api/payslips/:id`
→ `200` canonical payslip (including `tablesStatus`) + `lowConfidenceFields`, `unreadableFields`, `ungroundableFields`, `warnings`, `editedFields`, `failureReason`. `editedFields` holds scalars and table cells (`obustave.2.iznos`) (Task 09).

**10.6** `PATCH /api/payslips/:id`
Body is the canonical field schema, partial and strict, carrying only the changed keys; a line-item table is replaced whole. Recomputes warnings. Never changes status. `editedFields` is recomputed over the full merged state against the original extraction, re-mapped from the retained response, so setting a value back clears its mark (Task 09).
→ `200` detail shape · `409 edit_not_allowed` outside `review`/`confirmed` · `409 tables_pending` for a table key while `tablesStatus` is `pending`

**10.7** `POST /api/payslips/:id/confirm` → `200 {id, status, confirmedAt}`; idempotent, keeping the first `confirmedAt` · `409 confirm_not_allowed`, also while `tablesStatus` is `pending` (Task 05), so export waits for both passes

**10.8** `POST /api/payslips/:id/retry` → `202 {id, status}` · `409 retry_not_allowed` if not failed, or the failure is non-retryable
A retry is a full reset to a fresh extraction: status `processing`, `tablesStatus` `pending`, and the canonical data, metadata and raw response cleared, then both passes re-run over the stored source. The reset is one conditional update, so a concurrent second retry gets `409` and only one analysis is paid for (Task 07).

**10.9** `GET /api/payslips/:id/source` → `200 {url, contentType, originalFilename, expiresAt}` — signed, 300 s TTL

**10.10** `GET /api/payslips/:id/regions`
→ `200 {pages: [{page, aspectRatio}], regions: [{fields: string[], page, corners: [{x,y}×4], origin}]}`
Coordinates are page-relative fractions in `[0,1]`. Returns empty arrays when no raw response is retained, and for any payslip not in `review` or `confirmed`. While `tablesStatus` is `pending`, the regions cover the scalars only (Task 08).

**10.11** `POST /api/sessions/:id/merge`
Body `{payslipIds: [string, string], order: [string, string]}`. Builds a combined PDF from the sources, creates a new Payslip, re-extracts, soft-deletes the originals.
→ `202 {id, status}` · `409 merge_not_allowed` if either payslip is not in this session or is already deleted

**10.12** `GET /api/payslips?page&limit&status` → `200 {items, page, limit, total}`

**10.13** `DELETE /api/payslips/:id` → `204` (soft delete)

**10.14** `GET /api/payslips/export?format=csv|json` → `200`, all confirmed and not deleted
**10.15** `GET /api/payslips/:id/export?format=csv|json` → `200` · `409 export_not_allowed` unless confirmed

> Route-order note carried from receipt-ocr: `/export` must be registered before `/:id`.

---

## 11. Success Criteria

### 11.1 MVP success definition

1. A user signs in on a phone, photographs a Croatian payslip, and within about ten seconds sees a filled form.
2. Recognised fields are outlined on the document; tapping a field scrolls the preview to its outline.
3. The user uploads three more payslips at once and moves between all four without losing edits.
4. The user corrects two wrong values, confirms all four, and downloads a JSON export containing the line-item tables.
5. Re-opening the session tomorrow shows the same data.

### 11.2 Functional acceptance

- ✅ All seven sample layouts extract without an unhandled error
- ✅ Every critical field is either extracted, or absent and flagged
- ✅ Highlights land on the correct text on both images and PDFs, or are withheld
- ✅ A two-page payslip navigates and highlights across both pages
- ✅ Merge produces one payslip with the combined pages and a re-extracted form
- ✅ A failed payslip does not prevent its siblings from completing
- ✅ Warnings appear for injected arithmetic errors and never block confirmation
- ✅ Exports round-trip: JSON re-imported into the scoring harness reproduces the same values

### 11.3 Extraction quality — measure, don't guarantee

Scored **per field instance**, not per document. The golden set is 11 payslips across 7 layouts and ~10 employers, giving roughly 165 core-field instances. At this corpus size a single bad document moves a per-document score by nine points, which is too noisy to steer by.

| Metric | Target |
| --- | --- |
| Core scalar fields, exact match after normalisation | **≥ 95%** |
| Line-item rows (count and per-cell values) | **≥ 85%** |
| Payslips needing no correction to any critical field | measured, not targeted |
| OIB checksum pass rate on extracted OIBs | measured by `npm run score:extraction` (100% in every recorded set, Task 06) |
| Highlight correctness (outline sits on its value) | spot-checked visually on every golden-set document |

Ground truth is built from the native-text PDFs and **spot-checked by the product owner** before it is trusted. Where a sample's own arithmetic contradicts the extracted value, the arithmetic wins and the ground truth is corrected — receipt-ocr found three ground-truth errors this way.

### 11.4 Performance targets

| Metric | Target |
| --- | --- |
| Single payslip, upload to **first usable form** | **≤ 10 s** per page, warm |
| Single payslip, upload to complete form incl. line items | ≤ 25 s |
| Four payslips in parallel (cap 3) | ≤ 25 s wall clock |
| Time to interactive review screen after upload starts | ≤ 3 s (skeleton state) |
| Cost per page | ≈ $0.01–0.02 |

Render's free tier adds a 30–50 s cold start that is outside these targets; warm the service before a demo.

Measured at the close of Phase 2: **~14 s mean, 22 s worst** for a complete single-pass
extraction. Latency is `~4 s constant OCR + output tokens ÷ ~146 tok/s`, so it is driven by the
three line-item tables, not by the model — a `gpt-4.1-mini` swap was measured and made it 1.7×
*worse*. Meeting the first-form target is the job of
[`.agents/specs/two-pass-extraction.md`](./.agents/specs/two-pass-extraction.md), which splits
scalars from tables so the form renders at ~8 s while the tables fill in behind. **It changes the
API shape, so it belongs in Phase 3's design rather than a later optimisation pass.**

Measured on the product path in Task 05 (2026-09-24/25, [`history/05`](./.agents/history/05-extraction-latency-two-pass.md)),
one payslip at a time: single-pass **p50 20.7 s, p90 46.2 s, max 66.8 s**; two-pass first form
**p50 12.2 s, p90 15.1 s, max 28.2 s**, complete p50 14.0 s. The ≤10 s first-form target is
**missed** by the service's generation rate on the day (~70–100 tok/s against the Phase 2
decomposition's 146), not by the design: a scalars pass emits ~600 tokens. All eleven at once
(cap 3): first form p50 27.9 s, all complete in 76 s. Cost per document: $0.031 single-pass,
$0.045–0.051 two-pass (~1.5×).

### 11.5 User-experience targets

- Every interactive control has a hit box of at least 48 CSS px
- The focused field and its highlight are visible simultaneously on a phone **with the keyboard open**
- No user-facing string is hardcoded; both languages have complete copy
- Selection and attention states are never conveyed by colour alone
- The review screen is usable at 375 px width

---

## 12. Implementation Phases

### Phase 1 — Fork and foundation

**Goal.** A running app with auth, upload, persistence and history, extracting nothing.

- ✅ Copy `receipt-ocr`, rename `@receipt/*` → `@payslip/*`, strip receipt extraction and schema
- ✅ Canonical payslip schema in `shared/`, with the Azure-vocabulary guard test
- ✅ Session and payslip tables, RLS policies, storage bucket
- ✅ Upload API (one file per request, ten per session); session creation; history list API
- ✅ Croatian and English locales for everything built so far

**Validation.** Sign in, upload four files, see four payslips in `processing`, find them in history tomorrow. Full typecheck, lint, format and unit-test sweep green.

> **Status, 2026-09-25:** this phase is complete at the API only. The capture and history screens
> that the validation journey needs are ROADMAP Tasks 07 and 12.

### Phase 2 — Extraction and the bake-off

**Goal.** Know which engine to build on, with evidence.

- ✅ Golden set: ground truth for all 11 samples, spot-checked
- ✅ Scoring harness, including the guard that fails when an expectation goes unscored
- ✅ `ContentUnderstandingProvider` with the Croatian field schema
- ✅ `LayoutPlusLlmProvider` — `prebuilt-layout` + Azure OpenAI `gpt-4.1` + string-match grounding (bake-off harness in `scripts/bakeoff/`, not ported into `api/`)
- ✅ Run both; record results; confirm or overturn ADR-0001

**Validation.** Both providers score against the same golden set; the winner meets §11.3 or the ADR is amended with what we learned. **This phase gates everything after it** — no UI is built on an engine that has not been measured.

### Phase 3 — Review, highlighting and navigation

**Goal.** The screen the product exists for.

- ✅ Source-region projection; regions endpoint; overlay with the aspect-ratio guard
- ✅ Review form with all sections and the three line-item tables
- ✅ Two-way field ↔ region linking
- ✅ Payslip chip rail and page pager/sheet, with the ARIA patterns in §7.6
- ✅ Warnings, attention marking, save and confirm
- ✅ The phone keyboard layout: `interactive-widget=resizes-content` plus the `visualViewport` fallback

**Validation.** Every golden-set document reviewed end to end in a real browser, including a real iPhone for the keyboard behaviour. Highlights verified visually on all 11.

> **Status, 2026-09-25:** the region projection, the regions endpoint and the overlay with its
> aspect-ratio guard landed in Task 08, shown from the session page. The form, linking and
> navigation are Tasks 09 and 10.
>
> **Status, 2026-09-26:** the review form, two-way linking, PATCH and confirm landed in Task 09,
> pending its review session. Navigation and the phone keyboard strip are Task 10.
>
> **Status, 2026-09-26:** Task 10 navigation, unsaved-edit preservation and the phone keyboard
> strip are implemented; pending review; M2 pending.

### Phase 4 — Merge, export and polish

**Goal.** Close the loop.

- ✅ Merge: suggestion, manual action, PDF combination, re-extraction
- ✅ JSON and CSV export, both scopes
- ✅ Retry, failure copy, empty and error states
- ✅ Deploy to Render; end-to-end journeys on the hosted stack

**Validation.** The §11.1 journey completed on the deployed app, on a phone.

**Planning range.** Phases 1 and 4 are largely mechanical given the fork. Phase 2 is the one with genuine unknowns. Phase 3 is the largest body of new UI. Expect Phase 2 to be short in effort but decisive in outcome, and to re-plan Phase 3 if the bake-off changes the engine.

---

## 13. Future Considerations

**Extraction intelligence.** Labelled samples in Content Understanding Studio for any layout that resists zero-shot extraction. A classifier that identifies the payroll vendor and selects layout-specific hints. Detecting and splitting several payslips inside one PDF.

**Data quality.** Payslip validation as a product feature rather than a review hint — doc-guard's reconciliation approach, surfaced as a verdict. Cross-payslip consistency ("your March net differs from February by 40%"). A JOPPD-shaped export.

**Product model.** Pre-2023 HRK payslips and `prirez`. The other three regulated forms — NP1, IO1, NO1. Bulk upload beyond ten files. Cross-payslip aggregation for income-verification use cases.

**Integrations.** Push to accounting or HR systems. A public API. Webhooks.

**UX.** Drag-to-reorder as a desktop accelerator on top of the menu action. In-document text search. Annotating or redrawing a region by hand to correct a value at source, as Rossum and Affinda do.

**Geography.** Slovenian, Bosnian and Serbian payslips share structural conventions with Croatian ones and would be the natural next market.

---

## 14. Risks & Mitigations

| # | Risk | Impact | Mitigation |
| --- | --- | --- | --- |
| 1 | **Content Understanding's grounding precision on dense Croatian payroll tables is unmeasured.** No vendor publishes accuracy figures and no public benchmark covers payslips outside US paystubs. | High — it is the primary engine and the highlighting feature depends on its per-field geometry | Phase 2 bake-off against a golden set *before* any UI is built on it; a fully implemented challenger path; ADR-0001 names the trigger that flips the decision |
| 2 | **The golden set is small and uneven** — 11 payslips, 7 layouts, and no more available | Medium — a 95% score describes these seven vendors, not the eighth | Score per field instance rather than per document; state the limitation in every reported figure; treat the A family (Croatia's public-sector payroll system, four of eleven samples) as the highest-value layout |
| 3 | **A Croatian payslip parser gets hand-built beneath a generic model.** receipt-ocr's own README records exactly this drift — nineteen defects fixed with six hand-written rules | High — unbounded maintenance, and a prototype that only works on samples it has seen | Treat a growing count of deterministic post-processing rules as the signal to revisit the engine, not as progress; the field schema, not the code, is where Croatian knowledge belongs |
| 4 | **Highlights land in the wrong place** and destroy trust in every value on screen | High | The aspect-ratio guard: an outline that cannot be proven to sit on its text is withheld. Visual spot-check of all 11 golden-set documents is an explicit Phase 3 deliverable |
| 5 | **The phone keyboard covers the preview.** From Chrome 108, Android no longer resizes the layout viewport when the keyboard opens | Medium — it breaks the product's central promise of seeing value and source together | `interactive-widget=resizes-content`, a `visualViewport` fallback for iOS Safari, and a collapsed 44 px source strip while a field is focused. Must be tested on a real iPhone, not an emulator |
| 6 | **The phone layout has no prior art.** Every document-AI review UI found — Rossum, Affinda, Docsumo, Reducto — is desktop-only | Medium | The layout is synthesised from scanner apps, expense apps and desktop IDP tools; it is the first thing to put in front of a real user |
| 7 | **Multi-page payslips break assumptions.** Sections continue across the page break; Azure DI custom neural explicitly cannot read values split across pages | Medium | Extraction runs per payslip with all pages in one call, never per page; A01 is in the golden set specifically to cover this |
| 8 | **Privacy posture is demo-grade.** The challenger path sends payslip text outside the EU; there is no retention policy | Medium — blocks any move beyond demonstration | Recorded explicitly in §9.4 as a product decision with its consequences named; a DPIA is a precondition of productionising |
| 9 | **Inherited gaps from the fork** — no password reset, unverified emails, Render cold starts | Low for a demo | Documented as known gaps rather than silently carried; warm the service before demos. CI was added in ROADMAP Task 01b |
| 10 | **Merge is hard to discover.** It only matters when someone photographs a two-page payslip as two files | Low | Automatic suggestion on a loosened key, plus an always-available manual action; both paths tested |

---

## 15. Appendix

### Appendix A — Canonical field inventory

| Field | Type | Importance | Must exist? | Notes |
| --- | --- | --- | --- | --- |
| `employerName` | string | **critical** | no | Present on all seven layouts |
| `employerAddress` | string | supplemental | no | |
| `employerOib` | string | important | no | ISO 7064 MOD 11,10 validated |
| `employerIban` | string | supplemental | no | |
| `employeeName` | string | **critical** | no | |
| `employeeAddress` | string | supplemental | no | Often wraps across lines |
| `employeeOib` | string | **critical** | no | Merge key; frequently absent on page 2 |
| `employeeIban` | string | important | no | |
| `period` | string | **critical** | no | `YYYY-MM`; printed as `svibanj 2025` or `GODINA 2025, MJESEC 6` |
| `paymentDate` | date | important | no | |
| `ukupnoSati` | decimal | supplemental | no | |
| `currency` | enum | important | yes | `EUR` only in this scope |
| `brutoPlaca` | decimal | **critical** | no | Head of the reconciliation chain |
| `doprinosiIzPlace` | decimal | important | no | Employee side; MIO I + II |
| `doprinosMioIStup` | decimal | supplemental | no | 15%; mandated separately by Art. 3(1)(7) |
| `doprinosMioIiStup` | decimal | supplemental | no | 5%; as above |
| `dohodak` | decimal | important | no | `bruto − doprinosi iz plaće` |
| `osobniOdbitak` | decimal | important | no | €600/month base from 2025 |
| `poreznaOsnovica` | decimal | important | no | Floors at zero |
| `porezNaDohodak` | decimal | important | no | Municipality-set rate since 2024 |
| `netoPlaca` | decimal | **critical** | no | `dohodak − porez` |
| `neoporeziviPrimiciUkupno` | decimal | important | no | |
| `obustaveUkupno` | decimal | important | no | |
| `iznosZaIsplatu` | decimal | **critical** | no | The only figure matching the bank statement |
| `doprinosiNaPlacu` | decimal | supplemental | no | Employer side, 16.5% HZZO |
| `ukupanTrosakRada` | decimal | supplemental | no | Absent on three of seven layouts |
| `payComponents[]` | table | important | no | Sums to `brutoPlaca`; up to ~25 rows (A01) |
| `obustave[]` | table | important | no | Creditor, remaining balance, instalment count |
| `neoporeziviPrimici[]` | table | supplemental | no | Prehrana, prijevoz, putni nalozi |

### Appendix B — Minimal conceptual database model

```
users                    (Supabase auth)
  └── sessions
        id, user_id, created_at, deleted_at
        └── payslips
              id, session_id, user_id
              status, tables_status, failure_reason, canonical_data jsonb,
              extraction_metadata jsonb   -- { scalars?, tables? }, one entry per pass
              -- no warnings column: computed on read (Task 06 D1)
              raw_provider_result jsonb   -- { scalars?, tables? }, verbatim per pass
              edited_fields text[],
              original_filename, content_type, page_count,
              merged_from uuid[], confirmed_at, created_at,
              updated_at, deleted_at

              generated columns for list/export queries:
                employee_name, employer_name, period,
                neto_placa numeric, iznos_za_isplatu numeric

storage: payslip-sources/{user_id}/{payslip_id}/source
```

RLS on `sessions`, `payslips` and `storage.objects`, all keyed on the owning user. A partial index on `(user_id, created_at desc) where deleted_at is null`.

### Appendix C — Architectural decisions captured from discovery

1. **Pure technology demonstrator.** The downstream consumer of exported data is deliberately unspecified; the schema stays general rather than shaped to income verification or accounting import.
2. **A Payslip owns Pages.** Pages are never reviewed or exported independently.
3. **One Source File is always one Payslip.** A multi-page PDF is one payslip; each image is one payslip.
4. **Merge is retained** as the escape hatch for a payslip photographed as two files, with a loosened key and an always-available manual path.
5. **Merge re-extracts** over a combined PDF rather than stitching two results.
6. **Field scope is core scalars plus three line-item tables**, extensible later.
7. **EUR only**; pre-2023 HRK and `prirez` are out of scope.
8. **Any processing region is acceptable** for the prototype, and a third-party LLM is acceptable.
9. **Payslips are persisted** with per-user history, mirroring receipt-ocr, not held in memory.
10. **Content Understanding is primary, with a measured challenger** — see ADR-0001.
11. **Template-based extraction is rejected on legal grounds**: *Pravilnik* NN 68/2023 Art. 10(1) makes the IP1 form optional, so it prescribes content, not layout, and every vendor renders its own.
12. **doc-guard is a domain-knowledge donor, not a dependency.** Its payroll identities, OIB/IBAN/date regexes and label vocabulary are reused; its pipeline is not.
13. **The repository is forked wholesale from receipt-ocr**, not rebuilt — the viewport, overlay and PDF modules encode browser-found bug fixes that would be lost in a rewrite.
14. **Two navigation controls, not one**: a payslip selector and a page pager, because established practice splits them and the two levels are semantically different.
15. **No drag affordance**; a menu action instead, satisfying WCAG 2.2 SC 2.5.7 with one implementation.
16. **Field identifiers are Croatian for payroll concepts, English for structure**, and are independent of the UI language.
17. **Accuracy is scored per field instance**, not per document, because the corpus is too small for per-document scoring to be stable.
18. **The bake-off gates the UI.** No review interface is built on an engine that has not been measured.

### Appendix D — Technology baseline

Verified **18 September 2026**.

| Item | Value | Reference |
| --- | --- | --- |
| Azure Content Understanding API | `2025-11-01` (GA) | https://learn.microsoft.com/azure/ai-services/content-understanding/ |
| Content Understanding field source + confidence | `estimateFieldSourceAndConfidence` | https://learn.microsoft.com/azure/ai-services/content-understanding/concepts/analyzer-reference |
| Croatian OCR + `hr-HR` value normalisation | supported | https://learn.microsoft.com/azure/ai-services/content-understanding/language-region-support |
| Azure Document Intelligence API | v4.0 `2024-11-30` | https://learn.microsoft.com/azure/ai-services/document-intelligence/ |
| Completion model (CU and challenger) | Azure OpenAI `gpt-4.1` | see `.agents/history/01-extraction-bakeoff.md` |
| Croatian payslip regulation | *Pravilnik* NN 68/2023, Art. 2, 3(1), 10(1) | https://narodne-novine.nn.hr/clanci/sluzbeni/2023_06_68_1118.html |
| Prirez abolition | NN 114/23, from 1 Jan 2024 | https://narodne-novine.nn.hr/ |
| Osobni odbitak 2025 | €600/month | https://porezna-uprava.gov.hr/hr/porezne-izmjene-2025/8231 |
| WCAG target size | 2.5.8 (24 px, AA) · 2.5.5 (44 px, AAA) | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html |
| WCAG dragging movements | 2.5.7 (AA) | https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html |
| Chrome keyboard viewport behaviour | `interactive-widget`, Chrome 108+ | https://developer.chrome.com/blog/viewport-resize-behavior |
| ARIA tabs pattern | manual activation for non-instant panels | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ |

### Appendix E — PRD assumptions

1. The seven sample layouts are representative enough to steer engineering decisions, while not being sufficient to claim general accuracy.
2. No further payslip samples will become available during the prototype.
3. All payslips presented will be Croatian, printed (not handwritten), and for periods from 2023 onward.
4. A user will not exceed ten payslips in one session.
5. Content Understanding's zero-shot extraction generalises across Croatian payroll vendors without labelled samples — **the central technical assumption, and the one Phase 2 exists to test.**
6. Content Understanding's per-field bounding quads are precise enough to highlight individual table cells.
7. receipt-ocr's viewport, overlay and PDF modules port with only a coordinate-parser change.
8. Render's free tier is adequate for demonstration, cold starts accepted.
9. Ground truth derived from native-text PDFs is accurate enough to score against after a human spot-check.
10. The product owner is available to spot-check the golden set and to verify the phone layout on a real device.

---

## PRD Completion Checklist

- ✅ Executive summary, mission and principles
- ✅ Target users, including who is explicitly not modelled
- ✅ MVP scope, in and out, across functionality, data, technical, integration and deployment
- ✅ User stories with concrete examples, including technical stories
- ✅ Architecture diagram, core pattern, provider abstraction, canonical schema, state machines, repository layout
- ✅ Feature specifications with purpose, requirements and rules
- ✅ Technology stack with versions and explicit exclusions
- ✅ Security and configuration, including an honest privacy statement
- ✅ API specification for every endpoint
- ✅ Measurable success criteria with an honest denominator
- ✅ Four implementation phases with validation gates
- ✅ Future considerations
- ✅ Risks with specific mitigations
- ✅ Field inventory, database model, decisions, verified technology baseline, assumptions
- ⬜ Reviewed and approved by the product owner
