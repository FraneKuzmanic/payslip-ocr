# Feature: Task 01 — Fork, rename and strip

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 01](../ROADMAP.md) · **PRD:** Phase 1, §6.7, §8 ·
**Behaviour rules:** [`AGENTS.md`](../../AGENTS.md) (this project has no `CLAUDE.md`)

## Feature Description

Copy the sibling prototype `prototypes/receipt-ocr` into `prototypes/payslip-ocr` as the
application skeleton. Rename every `@receipt/*` package to `@payslip/*`, remove everything specific
to receipt extraction and the receipt schema, and leave an application that builds, passes
`npm run validate`, serves client + API under `npm run dev`, and lets a user sign in. The app
extracts nothing, stores nothing and has no capture UI until later tasks add them.

The Phase 2 bake-off harness (`scripts/bakeoff/`, `scripts/check-golden-set.py`) and the golden
set (`.agents/fixtures/expected/`) already live here and **must survive the merge unchanged in
behaviour**.

## User Story

As the developer building the payslip prototype
I want a renamed, stripped copy of receipt-ocr that builds and signs in
So that Tasks 02–13 start from receipt-ocr's proven auth, upload, viewport, overlay and PDF modules
instead of rebuilding them and losing their browser-found bug fixes (Locked decision #17)

## Problem Statement

This directory holds docs, a golden set and a throwaway bake-off harness. It has no application.
receipt-ocr has a working application whose infrastructure transfers directly, but it is woven
through with receipt vocabulary (`@receipt/*`, `/api/receipts`, the `receipts` table, VAT, QR,
seller/buyer fields). That vocabulary must not reach payslip code.

## Solution Statement

1. Copy receipt-ocr's **tracked** files, excluding an explicit list of receipt-only files, so
   deleted code never lands.
2. Merge the three files both projects own (`package.json`, `.gitignore`, `.env.example`) by hand.
3. Rename packages, imports and remaining receipt identifiers.
4. Cut the code that depended on the deleted files down to a compiling stub surface.
5. Make the bake-off scripts pass the forked lint and format gates without changing what they
   compute, then prove it with `npm run score -- cu`, which must print 98.9%.

**receipt-ocr stays in the monorepo** at `../receipt-ocr`. Everything deleted here is still
available as reference for the task that rebuilds it (03 repositories/routes, 04 provider and
scoring, 06 warnings, 07 capture UI, 09 review form, 12 export/history). Deleting aggressively is
therefore cheap. Keeping a receipt-shaped module "for later" is not.

## Feature Metadata

**Feature Type**: Refactor (fork and strip)
**Estimated Complexity**: Medium. Mechanically broad (~150 files touched) but conceptually shallow.
**Primary Systems Affected**: all three workspaces, toolchain configs, `supabase/`, `scripts/`
**Dependencies**: none new. Drops `@anthropic-ai/sdk` (nothing imports it; see Notes).

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

Paths prefixed `R:` are in `../receipt-ocr/`. Unprefixed paths are in this project.

- `.agents/ROADMAP.md` §1, §3 Task 01: scope and Definition of Done
- `AGENTS.md`: behavioural rules, to be merged with `R:CLAUDE.md` §7
- `R:package.json`: root scripts and workspaces to adopt
- `package.json` (this project): bake-off scripts and deps to keep
- `.gitignore` (this project): **keep all of it**. Its re-include block for `.agents/` and
  `AGENTS.md` is load-bearing (see the comment inside it).
- `.env.example` (this project) and `R:.env.example`: to merge
- `scripts/bakeoff/common.ts` (lines 6–9): the harness reads `.agents/fixtures/expected`,
  `payslip_examples/` and `.bakeoff/` relative to the project root. Paths must not move.
- `scripts/bakeoff/score.ts` (line 11): `process.argv[2]` is the engine, so `npm run score -- cu`
  is correct as written in the DoD
- `R:api/src/app.ts` (lines 25–49): prefix-guard pattern to keep, renamed
- `R:api/src/app.test.ts` (lines 29–53): the "401 not 404 on a prefix with no route yet" test.
  That becomes exactly this task's state.
- `R:api/src/config.ts`: env validation pattern. Remove Azure DI and extraction entries.
- `R:api/src/providers/document-extraction/types.ts`: the only provider file kept, as a stub
- `R:api/src/auth/auth.integration.ts` (lines 1–64): hosted-project test user setup and teardown
  to reuse
- `R:scripts/run-supabase-integration-tests.mjs` (lines 16–20): integration file list
- `R:client/src/api/client.ts` (lines 1–117): the `request`/`parseResponse` core to keep
- `R:client/src/review/regionSections.ts`: imported by `SourceOverlay` and `RegionPopover`
  (see Design decision D4)
- `R:client/src/components/NavItems.tsx`, `R:client/src/components/AppLayout.test.tsx`
- `R:client/src/i18n/i18n.test.ts`, `uploadErrors.test.ts`: guard tests that stay
- `R:.claude/commands/validate.md` (973 lines): to port selectively (Task 14 below)

### Keep / rename / delete map

This is the core of the task. **Anything not listed under "Delete" is copied.**

**Delete (never copy):**

| Area | Files |
| --- | --- |
| Receipt docs and agent state | `R:.agents/**`, `R:CLAUDE.md`, `R:PRD.md`, `R:README.md`, `R:.claude/**` (the whole folder: commands, skills, template) |
| Merged by hand instead | `R:package.json`, `R:.gitignore`, `R:.env.example` |
| Extraction | `R:api/src/providers/document-extraction/**` **except `types.ts`**: azure, azure-fields, content-markers, croatian, currency, field-aliases, fiscal-qr, merge, receipt-amount, source-regions, tax-signals, vat-tables, all their tests, all of `fixtures/` |
| Receipt persistence and API | `R:api/src/repositories/**`, `R:api/src/routes/receipts*.ts`, `R:api/src/services/**`, `R:api/src/export/**`, `R:api/src/validation/**` |
| Receipt schema | `R:shared/src/receipt.ts`, `R:shared/src/receipt.test.ts`, `R:shared/src/warnings.ts` |
| Receipt DB | `R:supabase/migrations/20260817122048_create_receipts.sql`, `R:supabase/tests/database/receipts.test.sql` |
| Receipt scripts | `R:scripts/score-extraction.ts`, `R:scripts/record-azure-fixture.mjs`, `R:scripts/compare-azure-models.mjs` |
| Receipt client | `R:client/src/routes/{HistoryPage,ProcessingPage,ReviewPage}{,.test}.tsx`, `R:client/src/routes/HomePage.test.tsx`, `R:client/src/review/{ItemRows.tsx,reviewForm.ts,reviewForm.test.ts}`, `R:client/src/history/{ReceiptActions,ReceiptCards,ReceiptTable}.tsx`, `R:client/src/history/{receiptSummary,receiptSummary.test}.ts`, `R:client/src/i18n/{receiptStatuses,warnings}.test.ts` |

**Keep, with renames** (behaviour unchanged):

| Old | New | Why kept |
| --- | --- | --- |
| `api/src/storage/receipt-sources.ts` | `api/src/storage/payslip-sources.ts` (param `receiptId`→`payslipId`, error text `receipt`→`payslip`) | PRD §6.7 names it; Task 03 |
| `api/src/upload/multipart.ts` `receiptSourceUpload` | `sourceFileUpload` | Task 03 |
| `api/src/upload/source-file.ts` fallback filename `"receipt"` | `"payslip"` | Task 03 |
| `client/src/capture/receiptFile{,.test}.ts` | `client/src/capture/sourceFile{,.test}.ts`; `ReceiptFileKind/Error/Classification`→`SourceFile…`, `classifyReceiptFile`→`classifySourceFile`, `analyzeReceiptImage`→`analyzeSourceImage` | Task 07. "Source File" is the CONTEXT.md term |
| `client/src/capture/downscale.ts` `downscaleReceiptImage` | `downscaleSourceImage` | Task 07 |
| `client/src/review/SourceDocumentPanel.tsx` prop `receiptId`, `getReceiptSource` | `payslipId`, `getPayslipSource` | Task 08 |
| `client/src/history/download.ts` | keep `saveBlob` + `exportFilename` (prefix `receipts-`→`payslips-`); **delete** `receiptExportFilename`/`safeFilenamePart` and their tests (depend on `CanonicalReceipt`) | Task 12 |
| `shared/src/api.ts` `RECEIPT_FAILURE_REASONS`, `receiptFailureReasonSchema`, `ReceiptFailureReason` | `EXTRACTION_FAILURE_REASONS`, `extractionFailureReasonSchema`, `ExtractionFailureReason` | PRD §6.3; used by kept `types.ts` |
| `client/src/review/regionSections.ts` section `"receipt"` | `"document"` | See D4 |

**Keep untouched except for the `@receipt/shared` → `@payslip/shared` import and receipt wording in
comments:** `ZoomableSourceViewport`, `sourceZoom`, `SourceOverlay`, `RegionPopover`,
`pdfDocument`, `pdfRender`, `PdfSource` and their tests. Also every `auth/`, `components/`,
`i18n/`, `lib/` and `test/` module, `useCameraCapture`, `useWideLayout`, `api/src/{auth,middleware,logger,index,routes/health}`,
`shared/src/{health,money,datetime,quantity,upload}.ts`, `scripts/provision-storage.mjs`,
`supabase/config.toml`, `supabase/seed.sql`, `supabase/.gitignore`, and every toolchain config.

### New Files to Create

- `.agents/plans/01-fork-rename-strip.md`: this file
- `.agents/history/01-fork-rename-strip.md`: completion record, written at the end
- `supabase/migrations/.gitkeep`: keeps the directory, which `/prime` and Task 03 point at

No new source modules.

### Relevant Documentation

- [npm workspaces](https://docs.npmjs.com/cli/v11/using-npm/workspaces): renaming a workspace
  package requires `npm install` so `node_modules/@payslip/*` symlinks exist. Stale
  `node_modules/@receipt/*` links must be removed.
- [Express 5 `app.use(path[])`](https://expressjs.com/en/5x/api.html#app.use): an array of
  path prefixes is valid, and is used for the auth guard.
- [Prettier ignore](https://prettier.io/docs/ignore): Prettier 3 honours `.gitignore` **and**
  `.prettierignore` by default. That is why vendored `.agents/skills/` and `.bakeoff/` are
  already skipped.
- [Supabase generated types](https://supabase.com/docs/guides/api/rest/generating-types): the
  empty-schema shape is `Tables: { [_ in never]: never }`.

### Patterns to Follow

**Package naming:** `@payslip/client`, `@payslip/api`, `@payslip/shared`; root name
`payslip-ocr-poc`.

**Module resolution:** `api` and `shared` use `nodenext`, so relative imports carry `.js`
(`import { config } from "./config.js"`). `client` uses `bundler`, so no extension. Do not
"normalise" either.

**Prefix auth guard** (`R:api/src/app.ts:37-39`). This is the one intentional route-level change:

```ts
// Guarding the prefixes, not routes, is what makes every session/payslip route Task 03 adds
// protected by default — and what makes a path with no route yet answer 401 rather than 404.
app.use(["/api/sessions", "/api/payslips"], requireAuth(authenticator));
```

With no routers mounted behind it, an authenticated request falls through to the JSON 404
handler, and an unauthenticated one gets 401. That is exactly what `app.test.ts` asserts.

**Response parsing** (`R:client/src/api/client.ts:83-112`): every client call goes through
`request()` + `parseResponse()`. `getPayslipSource` keeps that shape:

```ts
export async function getPayslipSource(id: string): Promise<SourceDocumentResponse> {
  const response = await request(`/api/payslips/${encodeURIComponent(id)}/source`);
  return await parseResponse(sourceDocumentResponseSchema, response, "GET /api/payslips/:id/source");
}
```

**Env validation** (`R:api/src/config.ts`): required values use `readRequired`, and all problems
are reported at once. Keep the style when removing entries.

**Anti-patterns:**

- `react-router-dom`. It is `react-router`.
- ESLint of any kind. oxlint only, because TypeScript 7 has no JS compiler API.
- Money as `number`. `money.ts` stays string/big.js.
- Hardcoded UI strings. Every new string is an `en` + `hr` key pair.

---

## DESIGN DECISIONS

- **D1 — Hosted Supabase project.** DoD says "the existing Supabase project". That is
  receipt-ocr's hosted project (the ref in `R:.mcp.json`). This project's `.env` currently has
  **no** Supabase variables. Copy `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
  `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from `R:.env` into `.env` with a script
  that never prints values. Also set `STORAGE_BUCKET=payslip-sources` and the API block
  (`PORT=3001`, `NODE_ENV=development`, `LOG_LEVEL=info`, `WEB_ORIGIN=http://localhost:5173`).
  **Task 01 touches only `auth`, never the database or storage of that project.** Whether Task 03
  migrates into the same project is an open question for Task 03 (see Notes).
- **D2 — No DB schema in this task.** The receipts migration is deleted, `supabase/migrations/`
  holds only `.gitkeep`, and `api/src/database.types.ts` is hand-edited to the empty-schema shape:
  delete the `receipts:` entry, leaving `Tables: { [_ in never]: never }`. The local stack
  (`db:*`) needs Docker and is not used (user preference). The `db:*` scripts stay for Task 03.
- **D3 — Protected prefixes with no routes.** `/api/receipts` becomes `["/api/sessions",
  "/api/payslips"]` (PRD §9.1). No routers yet.
- **D4 — `regionSections.ts` keeps its receipt-era field map for now.** `SourceOverlay` and
  `RegionPopover` import `Section`, `SECTION_COLOURS`, `sectionOf` and `fieldLabelKey`, and their
  tests assert colours and labels for those fields. Stubbing the map to empty would change what
  those tests prove about modules this task must leave behaviourally untouched. So only the
  section literally named `receipt` becomes `document`. The `seller`/`buyer`/`vat`/`items`
  mapping and its `review.fields.*` locale keys stay until **Task 08** replaces them with the
  payslip legend. Record this in the history file as deliberate carry-over.
- **D5 — HomePage becomes a stub.** The receipt HomePage *is* the single-file capture flow, which
  calls `createReceipt`. Replace it with a heading (`home.title`) and a subtitle (`home.subtitle`),
  both new payslip copy in `en` and `hr`. Task 07 builds multi-upload capture on the kept
  `capture/` modules.
- **D6 — Navigation keeps one destination.** Remove the History item from `NAV_ITEMS` (and the
  `ReceiptText` icon import). Task 12 re-adds it. Rewrite `AppLayout.test.tsx`'s `/receipts`
  cases so they still prove the `end` behaviour on the index link, using some other protected
  path.
- **D7 — Bake-off scripts are brought up to the gates, not excluded from them.** They are the
  reference Task 04 ports from, and `oxlint .` / `prettier --check .` cover them. Apply Prettier.
  Fix the 11 oxlint errors behaviour-neutrally (below). Prove neutrality with the scoring DoD.
- **D8 — Golden fixtures are not reformatted.** Prettier flags all 11
  `.agents/fixtures/expected/*.json`. They are hand-authored with deliberate blank-line grouping
  and are reviewed ground truth, and a formatting diff there would read as a fixture change
  (manual step M4). Add `.agents/fixtures/` and `skills-lock.json` (tool-managed) to
  `.prettierignore`.

---

## STEP-BY-STEP TASKS

Run from `prototypes/payslip-ocr` in **git-bash** (GNU `cp --parents` is needed). `R=../receipt-ocr`.

### 1. CREATE a pre-fork baseline

- **IMPLEMENT**: Record what must not change: `npm run score -- cu` output and
  `npm run check:golden` output, saved to the scratchpad.
- **VALIDATE**: `npm run score -- cu | tail -25` shows **Scalar 281/284 — 98.9%**, and
  `npm run check:golden` exits 0. If either fails *before* the fork, stop and report it.

### 2. COPY receipt-ocr's tracked files, minus the delete list

- **IMPLEMENT**:

  ```bash
  cd ../receipt-ocr
  git ls-files -z \
    | grep -zvE '^(\.agents/|\.claude/|CLAUDE\.md$|PRD\.md$|README\.md$|package\.json$|package-lock\.json$|\.gitignore$|\.env\.example$)' \
    | xargs -0 cp --parents -t ../payslip-ocr
  cd ../payslip-ocr
  ```

  Then `rm` every remaining file in the **Delete** table explicitly (it is short and exact),
  including all of `api/src/providers/document-extraction/` except `types.ts`. `git ls-files`
  never yields `.env`, `node_modules/` or `dist/`. `package-lock.json` is handled in step 4.
- **GOTCHA**: `package.json` exists in both. Never let `cp` overwrite this project's
  `package.json`, `.gitignore`, `.env.example`, `AGENTS.md`, `CONTEXT.md`, `PRD.md`, `docs/`,
  `scripts/bakeoff/` or `scripts/check-golden-set.py`. Run `git status --short` afterwards and
  confirm none of those show as modified.
- **VALIDATE**: `git status --short | grep '^ M'` is empty. `ls client api shared supabase` succeeds.

### 3. MERGE `package.json`, `.gitignore`, `.env.example`, `.prettierignore`

- **`package.json`**: start from `R:package.json`.
  - `name` → `payslip-ocr-poc`, and add this project's `description` reworded for the app.
  - `@receipt/` → `@payslip/` in every script.
  - Remove `score:extraction` (its script is deleted; Task 04 re-adds it).
  - Add the bake-off scripts unchanged: `layout`, `cu`, `llm`, `score`, `check:golden`.
  - Add root `dependencies`: `@azure-rest/ai-document-intelligence` `1.1.0` (used by
    `run-layout.ts`, same pin as api) and `dotenv` `17.4.2`.
  - Add root `devDependencies`: `tsx` `4.23.12` (the harness runs on it; don't rely on hoisting)
    and `@types/node` `24.10.1`.
  - **Drop** `@anthropic-ai/sdk` (nothing imports it; `run-llm.ts` calls Azure OpenAI over
    `fetch`).
  - **Drop** `typescript ^5.9.3` in favour of `7.0.2`.
- **`.gitignore`**: keep this project's file verbatim and add `coverage/`,
  `playwright-report/` and `.DS_Store` from R's. Do **not** add R's `.agents/fixtures/*` rule;
  here the golden sources live in `payslip_examples/`.
- **`.env.example`**: names only, no values. Sections:
  - API: `PORT`, `NODE_ENV`, `LOG_LEVEL`, `WEB_ORIGIN`.
  - Supabase: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
    `STORAGE_BUCKET` (comment "Required value: payslip-sources"), `DATABASE_URL`.
  - Uploads: `MAX_UPLOAD_BYTES`, `MAX_PDF_PAGES`.
  - Client: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_API_BASE_URL`, keeping
    R's explanatory comments.
  - Bake-off harness (`scripts/bakeoff/`): this project's existing `AZURE_DOCUMENT_INTELLIGENCE_*`,
    `AZURE_CONTENT_UNDERSTANDING_*`, `AZURE_CU_*` and `AZURE_OPENAI_*` names, kept with their
    comments.
  - **Drop** `AZURE_DI_MODEL_ID`, `AZURE_DI_SECONDARY_MODEL_ID`, `AZURE_DI_LOCALE` and
    `EXTRACTION_TIMEOUT_MS` (no reader after this task).
- **`.prettierignore`** (copied from R): append `.agents/fixtures/` and `skills-lock.json` (D8).
- **`.env`** (local, git-ignored): apply D1 with a node or sed script that prints only variable
  **names**. Never `cat` either `.env`.
- **VALIDATE**: `node -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"` and
  `git check-ignore -q .env && ! git check-ignore -q .env.example`.

### 4. RENAME `@receipt/*` → `@payslip/*` and reinstall

- **IMPLEMENT**:
  - Rename `name` in `client/`, `api/` and `shared/package.json`, and the `@receipt/shared`
    dependency in client and api.
  - Remove `@azure-rest/ai-document-intelligence` from `api/package.json`; the api no longer
    imports it.
  - Replace `@receipt/shared` in every `.ts`/`.tsx` import:
    `grep -rl '@receipt/' client api shared scripts --include='*.ts' --include='*.tsx' --include='*.mjs' | xargs sed -i 's#@receipt/#@payslip/#g'`.
  - Copy `R:package-lock.json` over this project's lock (it pins the tested versions), delete
    `node_modules/` (this project's, which is bake-off only), then run `npm install`. npm
    reconciles the renamed workspaces and new root deps while keeping R's resolved versions.
- **GOTCHA**: `prepare` runs `tsc --build shared` during install. It will fail until step 5 has
  removed `receipt.ts` exports from `shared/src/index.ts`. Either do step 5's shared edits first
  or use `npm install --ignore-scripts`, then run `npm run prepare` after step 5.
- **VALIDATE**: `ls node_modules/@payslip` lists `api client shared`, and
  `ls node_modules/@receipt 2>/dev/null` prints nothing.

### 5. UPDATE `shared/` to the stub surface

- `shared/src/index.ts`: remove the `receipt.js` and `warnings.js` export blocks. From `api.js`,
  export only `apiErrorResponseSchema`, `ApiErrorResponse`, `EXTRACTION_FAILURE_REASONS`,
  `extractionFailureReasonSchema`, `ExtractionFailureReason`, `sourceDocumentResponseSchema`,
  `SourceDocumentResponse`, `sourceRegionSchema`, `SourceRegion`, `sourceRegionsResponseSchema`
  and `SourceRegionsResponse`. Keep the health, money, quantity, datetime and upload exports.
- `shared/src/api.ts`: delete every receipt DTO (create, detail, list, update, confirm, export,
  `EXPORT_*`) and the import of `receipt.js`. Rename the failure-reason trio. Keep the long
  `.strip()` rationale comment, but reword "receipt response" to "response" and the history
  pointer to "receipt-ocr's `.agents/history/19-stale-bundle-response-contract.md`" (the incident
  is the reason the rule exists).
- `shared/src/api.test.ts`: keep only the cases for surviving schemas.
- `shared/src/{money,datetime,upload}.ts` and tests: reword comments that say "receipt" (money:
  "as it appears on a payslip"; upload: "one-payslip-per-Source-File rule"). **No logic change.**
  `quantity.ts` stays untouched; Task 02 decides its fate.
- **VALIDATE**: `npx tsc --build shared shared/tsconfig.test.json` and
  `npx vitest run --project shared`.

### 6. UPDATE `api/` to the stub surface

- `providers/document-extraction/types.ts`:
  - Import only `ExtractionFailureReason` and `SourceContentType`.
  - `ProviderExtractionResult.fields: Record<string, unknown>`, with a one-line comment that Task
    02's canonical payslip fields replace it.
  - Remove `qr`, the `FiscalQrData` import, `LOW_CONFIDENCE_THRESHOLD`, `secondaryModelId`,
    `fieldModels` and `vatTextPresent`. They are receipt dual-model and QR specifics.
  - Keep `ExtractionInput`, `ExtractionFieldMetadata`, `ExtractionMetadata` (core fields),
    `ExtractionError` and `DocumentExtractionProvider`.
- `app.ts`: drop the provider import and `extractionProvider` option, and drop
  `createReceiptsRouter`. Guard `["/api/sessions", "/api/payslips"]` (D3).
- `app.test.ts`: rename the describe to "the /api/sessions and /api/payslips prefixes without a
  token". Point the cases at `/api/payslips/<uuid>`, `/api/payslips` and `/api/sessions`. Add one
  case using a stub authenticator that **accepts** a token and asserts `404 {error:{code:"not_found"}}`,
  proving auth passes and nothing is routed yet.
- `config.ts`: remove the `AZURE_DI_*`, `AZURE_DOCUMENT_INTELLIGENCE_*` and
  `EXTRACTION_TIMEOUT_MS` fields and readers. Keep `STORAGE_BUCKET` and `MAX_*`, which are read
  by the kept storage and upload code.
- `vitest.config.ts` and `vitest.integration.config.ts`: drop the Azure placeholders and set
  `STORAGE_BUCKET: "payslip-sources"`.
- `database.types.ts`: apply D2.
- `storage/`, `upload/`: renames from the map, plus their tests.
- `auth/authenticator.ts`, `middleware/require-auth.ts`, `logger.ts`: comment wording only
  (`ReceiptRepository` → "the repositories"; `/api/receipts` → the two prefixes;
  "receipt contents" → "payslip contents").
- `auth/auth.integration.ts`: keep user creation, sign-in and `afterAll` deletion, but drop
  `ReceiptRepository` and all seeding. Assert against the real authenticator:
  - no token → 401;
  - a non-JWT → 401;
  - user A's real ES256 token on `/api/payslips/<uuid>` → **404** `not_found`, meaning
    authentication passed.

  Rename the email prefix `task04-` to `task01-`.
- `scripts/run-supabase-integration-tests.mjs`: `integrationFiles` becomes
  `["src/auth/auth.integration.ts"]` only. Set `STORAGE_BUCKET: "payslip-sources"`.
- **VALIDATE**: `npx tsc --build api api/tsconfig.test.json` and `npx vitest run --project api`.

### 7. UPDATE `client/` to the stub surface

- `api/client.ts`: keep `ApiError`, `request`, `ResponseParser`, `parseResponse` and `getHealth`,
  plus `getPayslipSource` (pattern above). Delete every other function and its imports.
  `api/client.test.ts`: keep only cases covering the kept core (401 sign-out, error code parse,
  shape-mismatch logging), re-pointed at kept functions.
- `App.tsx`: routes are `/login`, `/register`, protected index → `HomePage`, protected `*` →
  `NotFoundPage`. No `receipts/*` routes.
- `routes/HomePage.tsx`: D5 stub. Add a small `HomePage.test.tsx` asserting the translated heading
  renders.
- `components/NavItems.tsx` and `AppLayout.test.tsx`: D6. Also scrub comments in `ActionMenu.tsx`
  and `ActionMenu.test.tsx`.
- `review/SourceDocumentPanel.tsx`: renames from the map. `review/regionSections.ts` and test:
  D4. The other review modules: import rename and comment wording only.
- `capture/`, `history/download.ts` and `useWideLayout.ts`: per the map.
- `index.html` `<title>`: `Payslip OCR`.
- `i18n/locales/{en,hr}.json`: prune to the keys the kept code references, and rewrite anything
  mentioning receipts.
  - Find references with `grep -rhoE "t\(\s*[\"'\`][A-Za-z0-9_.]+" client/src`, and remember
    the dynamic ones: `upload.${code}` and `review.fields.*` via `fieldLabelKey`.
  - Delete the `capture`, `processing`, `history` and `warnings` blocks, and the receipt review
    form keys (`backToReceipts`, `seller`, `buyer`, `receipt`, `vat`, `items`, `save*`,
    `confirm*`, `add*`, `remove*`, `itemFieldLabel`, `errors` if unreferenced).
  - Keep `review.fields.*` (D4) and the zoom, inspect, pdf and source keys.
  - Delete `common.navHistory`, `common.download*` and `home.step*`/`apiStatus*` if unreferenced.
  - Set `common.appName` to `Payslip OCR` / `Skener platnih lista`, and write new
    `home.title`/`home.subtitle` in both languages.
  - `hr.json`: also `grep -i "račun"` for Croatian receipt copy.
- `i18n/receiptStatuses.test.ts` and `warnings.test.ts` are deleted (map). `uploadErrors.test.ts`
  and `i18n.test.ts` stay, with the import rename.
- **VALIDATE**: `npx tsc --build client client/tsconfig.node.json` and
  `npx vitest run --project client`.

### 8. UPDATE `supabase/`, `render.yaml`, `.mcp.json`

- `supabase/config.toml`: `project_id = "payslip-ocr"` and bucket `"payslip-sources"`.
  `supabase/migrations/.gitkeep` created. `supabase/tests/database/` is left empty, so remove the
  directory.
- `render.yaml`:
  - Service names become `payslip-ocr-api` and `payslip-ocr-client`, with `WEB_ORIGIN` and
    `VITE_API_BASE_URL` following them. These are placeholder URLs until Task 13 provisions the
    services; add a comment saying so.
  - Remove the `AZURE_DI_*` and `EXTRACTION_TIMEOUT_MS` entries and the
    `AZURE_DOCUMENT_INTELLIGENCE_*` secrets. Nothing reads them now; Task 04/13 add the CU ones.
- `.mcp.json`: copied as-is. It points at the same hosted project (D1).
- **VALIDATE**: `grep -n receipt supabase/config.toml render.yaml` prints nothing.

### 9. UPDATE bake-off scripts to pass the gates (D7)

- Run `npx prettier --write scripts/bakeoff`.
- Fix the oxlint errors without changing behaviour:
  - `common.ts:70`, `score.ts:219`, `test-grounding.ts:68`: `.sort(...)` → `.toSorted(...)`
    **only where the return value is used**. If the code relies on in-place mutation, assign
    the result instead.
  - `score.ts:9`: drop the unused `TABLE_FIELDS` import.
  - `score.ts:52,71,73`: `\/` → `/` inside character classes.
  - `ground.ts:119` `clamp` and `score.ts:95` `cy`: hoist to module scope, unchanged.
- **VALIDATE**: `npx oxlint scripts` is clean, and `npm run score -- cu` output is **identical**
  to the step 1 baseline (`diff` the saved files).

### 10. UPDATE `AGENTS.md` — merge receipt-ocr's `CLAUDE.md`

- §1–6 are already identical, so add only an adapted **§7 Git remotes** (use the
  `writing-for-agents` skill):
  - `origin` is Azure DevOps and is never pushed without an explicit ask.
  - `github` is **receipt-ocr's** mirror (`FraneKuzmanic/receipt-ocr`). Never push payslip
    commits or run `git subtree push --prefix=prototypes/payslip-ocr` to it.
  - Payslip's own mirror and deploy path is Task 13's to define.

  Also add a short **Conventions** list: oxlint not ESLint; `react-router`; `.js` relative imports
  in api/shared; money as decimal strings; no hardcoded UI strings; confidence never suppresses a
  value.
- Keep the Agent skills section (issue tracker, triage, domain) as is.
- **VALIDATE**: `grep -c "^## " AGENTS.md` ≥ 8, and the Agent skills section is still present.

### 11. UPDATE local `.claude/commands/` (git-ignored, local only)

- Rename `create-prd .md` → `create-prd.md` (stray space).
- `create-rules.md` and `plan-feature.md:59`: point at `AGENTS.md` instead of `CLAUDE.md`.
- `prime.md:63`: change the fallback text to `NOT FORKED YET - see ROADMAP Task 01`.
- `prime.md:40` ("This project has no `CLAUDE.md`") is deliberate and stays.
- **VALIDATE**: `grep -n -i "receipt\|@receipt" .claude/commands/*.md` prints nothing, and
  `grep -n "CLAUDE.md" .claude/commands/*.md` prints only `prime.md:40`.

### 12. PORT `validate.md` (review, don't copy)

- Create `.claude/commands/validate.md` from `R:.claude/commands/validate.md`.
- **Take** (adapted to `@payslip`):
  - Phases 0–5;
  - 6.1–6.5 (bundle secrets, `.env.example` names only, ignore rules, translation keys);
  - 6.8 (money never a number);
  - 6.9 (authenticated access centralised);
  - 6.11 (no mojibake);
  - 6.16 (spinner);
  - 6.20 (pdf.js behind one module);
  - 6.21 (no canvas polyfill);
  - 7b (hosted integration, no Docker);
  - 8.1–8.5 and 8.13 (stack start, contract, unknown route, sign-in, shell).
- **Drop**:
  - 6.7 (rewrite later as "never logs payslip data" if trivial);
  - 6.10, 6.12–6.15, 6.17–6.19, 6.22, 6.23 (receipt extraction, QR, VAT, receipt fixtures);
  - 7a (Docker);
  - 8.6–8.12 and 8.14–8.16.
- Add a new **Phase: bake-off harness** running `npm run check:golden` and `npm run score -- cu`
  with the expected 98.9%.
- Keep "Maintaining this file" so later tasks re-add journeys as they land.
- **VALIDATE**: `grep -n -i receipt .claude/commands/validate.md` prints nothing.

### 13. RUN the full DoD sweep (once each; don't re-run passes)

See VALIDATION COMMANDS.

### 14. CREATE `.agents/history/01-fork-rename-strip.md` and UPDATE ROADMAP §2

- The history file records:
  - what was kept, renamed and deleted (summarise the map);
  - D1–D8, especially **D4's carry-over** and **D1's shared hosted project**;
  - the dropped `@anthropic-ai/sdk`;
  - the validate result, the score output and the sign-in verification;
  - anything that deviated from this plan.
- Mark Task 01 ✅ in ROADMAP §2, linking the history file.

---

## TESTING STRATEGY

This task adds almost no behaviour, so testing means **proving the kept behaviour survived**.

- **Unit (Vitest, 3 projects):** every surviving test passes after renames. Tests of deleted
  modules are deleted with them, never skipped. New or rewritten tests:
  - `app.test.ts` prefix cases, plus an authenticated → 404 case;
  - `HomePage.test.tsx` heading;
  - `AppLayout.test.tsx` single-destination nav;
  - `client.test.ts` trimmed to the kept core.
- **Guard tests that must still pass untouched in intent:**
  - `i18n.test.ts` (hr/en key parity);
  - `uploadErrors.test.ts`;
  - the SourceOverlay, RegionPopover, sourceZoom and pdfRender tests.
- **Integration:** `npm run test:integration` runs `auth.integration.ts` against the hosted
  project. It creates two `task01-…@example.test` users and deletes them in `afterAll`.
- **Regression for the harness:** step 1 vs step 9 `score -- cu` diff is empty.

### Edge cases

- A stale `node_modules/@receipt/shared` symlink would let an unrenamed import still resolve.
  Step 4's check catches it.
- `prepare` failing mid-install (step 4 gotcha).
- A `.sort()` in the harness that relied on mutation (step 9).
- An authenticated request to an unrouted prefix path must be **404**, not 401 and not 500.

---

## VALIDATION COMMANDS

### Level 1: Syntax & style

```bash
npm run typecheck
npm run lint
npm run format:check
```

### Level 2: Unit tests

```bash
npm run test          # or the whole of Level 1+2 at once: npm run validate
```

### Level 3: Integration

```bash
npm run test:integration   # hosted project; prints the target host first — confirm it is the expected ref
npm run check:golden
npm run score -- cu        # must report Scalar 281/284 — 98.9%, identical to the step-1 baseline
```

### Level 4: DoD greps

```bash
# No receipt identifier in code or config (docs/prose excluded by the DoD: .agents/, docs/, *.md).
git ls-files -co --exclude-standard | grep -vE '^(\.agents/|docs/)|\.md$' | xargs grep -il receipt
# File names too
git ls-files -co --exclude-standard | grep -i receipt
# Both must print nothing.
grep -rn "react-router-dom" client/src   # nothing
```

### Level 5: Running app, in a real browser

1. `npm run dev`. The API logs `api listening` on 3001, and Vite serves 5173.
2. `curl -s localhost:3001/api/health` returns `{"status":"ok",…}`.
3. `curl -s -o /dev/null -w '%{http_code}' localhost:3001/api/payslips` returns `401`.
4. Drive a real browser with `npx agent-browser`, which is already a devDependency:
   1. Open `http://localhost:5173` and check it redirects to `/login`.
   2. Register a throwaway `task01-browser-<uuid>@example.test` user (email confirmation is
      disabled).
   3. Check you land on the stub home page with translated copy.
   4. Switch the language hr ↔ en.
   5. Sign out, sign back in.
   6. Screenshot each step into the scratchpad.
5. Delete the throwaway browser user with a node one-liner using `SUPABASE_SECRET_KEY`
   (`auth.admin.deleteUser`). Print only the result, never the key.

---

## ACCEPTANCE CRITERIA

These are the ROADMAP Task 01 DoD, made checkable.

- [ ] `npm install && npm run validate` passes: typecheck, lint, format check, unit tests.
- [ ] `npm run dev` serves client and API, and sign-in works against the existing hosted Supabase
      project, verified in a real browser.
- [ ] Both Level 4 greps print nothing.
- [ ] `npm run score -- cu` reproduces **98.9%**, identical to the pre-fork baseline, and
      `npm run check:golden` passes.
- [ ] `/prime` resolves every file and roadmap section it points at (`api/src/app.ts`,
      `api/src/config.ts`, `shared/src/`, `client/src/i18n/`, `supabase/migrations/`), and
      `.claude/commands/` has no `receipt`/`@receipt` reference and no `CLAUDE.md` reference
      except the deliberate `prime.md:40`.
- [ ] `npm run validate` exists as a package script and is green.
- [ ] `npm run test:integration` passes against the hosted project.
- [ ] `AGENTS.md` carries the adapted §7 and the conventions. The history file is written and
      ROADMAP §2 is updated.

## COMPLETION CHECKLIST

- [ ] Steps 1–14 done in order, each step's VALIDATE passed
- [ ] No test skipped or `.only`'d to get green
- [ ] `git status` shows no change to `scripts/bakeoff/` beyond formatting and lint fixes, and no
      change to `.agents/fixtures/`, `PRD.md`, `CONTEXT.md` or `docs/`
- [ ] No secret value printed in any log or committed file

---

## NOTES

**Open items for later tasks. Record in the history file; do not act here.**

1. **Task 03: which Supabase project holds the payslip schema?**
   - Sign-in here reuses receipt-ocr's hosted project.
   - If Task 03 migrates into it, `supabase db push` from this directory will see remote
     migration history (receipt-ocr's `20260817122048`) that is absent locally and refuse. The
     schemas would also share one database with a live demo.
   - The alternative is a new project, which means new keys and users. The Supabase free tier
     allows 2 active projects per org.
   - This is a user decision to raise when planning Task 03.
2. **PRD/stack drift:**
   - PRD §6.1, §8 and §9.2/9.4 describe the challenger as `@anthropic-ai/sdk` + `claude-sonnet-5`
     + `ANTHROPIC_API_KEY`. The bake-off actually ran `gpt-4.1` via Azure OpenAI
     (`run-llm.ts:53`, `AZURE_OPENAI_*`, history/01).
   - This task drops the unused SDK. The PRD text should be corrected by whoever next edits it.
     The same holds for the privacy paragraph, which argues about Anthropic's lack of an EU
     region.
3. **`quantity.ts`** is kept but is receipt-item-shaped. Task 02 decides.
4. **`upload.ts` codes:** `unsupported_media_type` vs PRD §10.3's `unsupported_file_type`, and
   PRD adds `session_full`. That is Task 03's to reconcile, not a rename here.
5. **README.md:** PRD §6.7 lists one. It is not in Task 01's scope, and R's README is entirely
   receipt content, so it is not copied.
6. **Stale spec header:** `.agents/specs/two-pass-extraction.md` says "Owner: Phase 3". The
   roadmap assigns it to Task 05. It is fixed when Task 05 is planned.

**Trade-offs taken:**

- D4 keeps receipt-era *field names* in `regionSections.ts` for one or more tasks rather than
  weakening the overlay and popover tests.
- D6 temporarily drops the History nav item rather than linking to a route that does not exist.
- Both are removed by the tasks that own them (08, 12).

**Confidence: 8/10** for one-pass success. The risk is breadth, not difficulty. The likeliest
snags:

- npm's lockfile reconciliation after the workspace rename (fallback: delete the lock and
  reinstall, then diff major versions against R's lock);
- the i18n prune missing a dynamically built key, which `i18n.test.ts` plus the typecheck will
  surface;
- a harness `.sort()` that depended on mutation, which step 9's score diff will surface.
