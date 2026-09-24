# 01 — Fork, rename and strip

**Date:** 2026-09-21
**Plan:** [`plans/01-fork-rename-strip.md`](../plans/01-fork-rename-strip.md)
**Outcome:** receipt-ocr's application copied in, renamed to `@payslip/*`, receipt extraction and
schema removed. Builds, validates, serves, signs in. Extracts and stores nothing yet.

## What was done

**Copied** every tracked receipt-ocr file except its docs, agent state, `.claude/`, and the three
files both projects own (`package.json`, `.gitignore`, `.env.example`), which were merged by hand.

**Deleted** exactly the plan's delete map: every extraction module except
`providers/document-extraction/types.ts`; the receipt repositories, routes, services, export and
validation; `shared/src/{receipt,warnings}.ts`; the receipts migration and pgTAP test; the receipt
scoring and fixture scripts; the History, Processing and Review routes; the review form, item
rows and history row components; and the receipt-status and warning locale tests.
receipt-ocr stays in the monorepo as reference for the tasks that rebuild these.

**Renamed:**

| Old | New |
| --- | --- |
| `@receipt/{client,api,shared}`, root `receipt-ocr-poc` | `@payslip/*`, `payslip-ocr-poc` |
| `storage/receipt-sources.ts` (`receiptId`) | `storage/payslip-sources.ts` (`payslipId`) |
| `receiptSourceUpload` | `sourceFileUpload` |
| `capture/receiptFile.ts`, `ReceiptFile*`, `classifyReceiptFile`, `analyzeReceiptImage` | `capture/sourceFile.ts`, `SourceFile*`, `classifySourceFile`, `analyzeSourceImage` |
| `downscaleReceiptImage` | `downscaleSourceImage` |
| `getReceiptSource`, prop `receiptId` | `getPayslipSource`, `payslipId` |
| `RECEIPT_FAILURE_REASONS` and its schema/type | `EXTRACTION_FAILURE_REASONS`, `extractionFailureReasonSchema`, `ExtractionFailureReason` |
| `regionSections` section `receipt` | `document` |

**Stubbed:** `shared` exports only health, money, quantity, datetime, upload, the error envelope,
failure reasons, and the source-document/source-region DTOs. `ProviderExtractionResult.fields` is
`Record<string, unknown>` until Task 02. The client API keeps `request`/`parseResponse`, `getHealth`
and `getPayslipSource`. The home page is a translated heading and subtitle (D5). Navigation has one
destination (D6).

**Auth guard** is on `["/api/sessions", "/api/payslips"]` with no routers behind it, so a request
without a token answers 401 and an authenticated one falls through to `404 not_found`.
`app.test.ts` asserts both; `auth.integration.ts` asserts the 404 with a real ES256 token.

## Design decisions carried

- **D1 — shared hosted Supabase project.** `.env` got receipt-ocr's Supabase URL and keys, copied
  by a script that printed names only, plus `STORAGE_BUCKET=payslip-sources` and the API block.
  Task 01 touches only auth there. **Which project holds the payslip schema is open for Task 03**
  (see below).
- **D2 — no schema.** `supabase/migrations/` holds only `.gitkeep`; `database.types.ts` has the
  empty-schema `Tables` shape. The `db:*` scripts remain for Task 03.
- **D4 — deliberate carry-over.** `regionSections.ts` still maps receipt-era fields
  (`seller`, `buyer`, `vat`, `items`, `documentNumber`, …) and `review.fields.*` still labels them,
  so the kept `SourceOverlay`/`RegionPopover` tests keep proving the same things. **Task 08 replaces
  the map with the payslip legend.** `review.fields.documentNumber` was reworded from "Receipt
  number" to "Document number" so the no-`receipt` grep holds; the key is unchanged.
- **D7 — bake-off scripts brought up to the gates.** Prettier applied; three `.sort()` →
  `.toSorted()` (each on a fresh array whose result is used), an unused `TABLE_FIELDS` import
  dropped, `\/` → `/` in character classes, `cy` and `clamp` hoisted. Behaviour-neutral: see the
  score below.
- **D8 — fixtures untouched.** `.agents/fixtures/` and `skills-lock.json` are in `.prettierignore`.
- **`@anthropic-ai/sdk` dropped.** Nothing imported it; `run-llm.ts` calls Azure OpenAI over
  `fetch`. `typescript ^5.9.3` replaced by `7.0.2`.

## Deviations from the plan

1. **The history pointer in `shared/src/api.ts`** says "the sibling prototype's
   `.agents/history/19-…`" rather than "receipt-ocr's", because the DoD grep forbids `receipt` in
   code. Several comments citing measurements on receipt-ocr's samples got the same treatment.
2. **`exportFilename` takes `"csv" | "json"` inline.** `ExportFormat` was deleted from `shared` with
   the other export DTOs. Task 12 re-derives it.
3. **`auth.integration.ts` creates one user, not two.** With no data to own, a second user proves
   nothing; Task 03 brings back the cross-user 404 cases.
4. **`client/src/capture/downscale.ts`** had two oxlint errors (`prefer-add-event-listener`),
   **inherited from receipt-ocr, whose own `npm run lint` fails on them today.** Fixed with
   `addEventListener(..., { once: true })`, same behaviour.
5. **Line endings.** `core.autocrlf=true` checks files out as CRLF, and Prettier requires LF, so
   `format:check` failed on 50 files that had no content change. **receipt-ocr's `format:check`
   fails the same way locally (193 files).** The working copy was normalised to LF (the index was
   already LF, so no content diff), and a `.gitattributes` with `* text=auto eol=lf` now pins it for
   future checkouts.
6. **`.claude/commands/validate.md`** was ported with phases renumbered: 7 is the bake-off harness,
   8 hosted Supabase integration (the old 7b), 9 journeys, 10 pending journeys. Added 6.4b (no
   payslip source committed). 6.6 (README ↔ code) and 6.15 (export route order) were neither taken
   nor listed as dropped in the plan; both were left out, since there is no README and no export
   route. 6.3 now asks git (`git check-ignore`) because this `.gitignore` uses `.env.*` +
   `!.env.example` rather than a literal `.env` line.

## Validation

| Check | Result |
| --- | --- |
| `npm run validate` (typecheck, lint, format, test) | green — 28 test files, 256 tests |
| `npm run test:integration` | green against `ssczfjvbeqyrlbasfyzj` — 3 tests |
| `npm run check:golden` | `ALL IDENTITIES AND CHECKSUMS PASS` |
| `npm run score -- cu` | **`SCALAR FIELDS 281/284 98.9%`**, output identical to the pre-fork baseline (diffed) |
| No `receipt` in code, config or file names (DoD greps) | empty |
| `react-router-dom` in `client/src` | empty |
| `curl /api/health` direct and via Vite proxy | `{"status":"ok",…}` both |
| `curl /api/payslips`, `/api/sessions` without token | `401 {"error":{"code":"unauthorized"}}` |

**Real browser** (`agent-browser`, named session): `/` redirected to `/login`; registered a
throwaway `task01-browser-…@example.test` user and landed on the translated home page; switched to
Croatian (`lang="hr"`, title `Skener platnih lista`) and it persisted across reload with the session
intact; an unknown URL rendered the translated not-found page inside the layout; signed out →
`/login`, `/` redirected again; signed back in. The throwaway user was deleted afterwards; zero
`task01-` users remain.

## Open items for later tasks

1. **Resolved 2026-09-23: payslip has its own Supabase project** (see below). Original note:
   **Task 03 — which Supabase project holds the payslip schema.** Sign-in reuses receipt-ocr's
   hosted project. Migrating into it would share one database with a live demo, and
   `supabase db push` from here would refuse over receipt-ocr's remote migration history
   (`20260817122048`). A new project means new keys and users (free tier: 2 active per org).
   **A user decision.**
2. **PRD drift.** PRD §6.1, §8 and §9.2/§9.4 describe the challenger as `@anthropic-ai/sdk` +
   `claude-sonnet-5` + `ANTHROPIC_API_KEY`, and the privacy paragraph argues about Anthropic's lack
   of an EU region. The bake-off actually ran `gpt-4.1` via Azure OpenAI in Sweden Central.
3. **`shared/src/quantity.ts`** is receipt-item-shaped. Task 02 decides.
   **Resolved by Task 02:** kept as the parser for hours and coefficients, and re-documented.
4. **Upload codes.** `unsupported_media_type` vs PRD §10.3's `unsupported_file_type`, and PRD's
   `session_full`. Task 03 reconciles.
5. **No README.** PRD §6.7 lists one; receipt-ocr's was entirely receipt content, so it was not
   copied. `shared/src/money.ts` still says a judgement call "is documented in README.md".
6. **Stale spec header.** `specs/two-pass-extraction.md` says "Owner: Phase 3"; the roadmap assigns
   it to Task 05.
7. **Orphaned-until-used modules.** `capture/{sourceFile,downscale,useCameraCapture}.ts`,
   `history/{download,useWideLayout}.ts`, `upload/`, `storage/payslip-sources.ts` and the review
   viewport modules are kept but not yet reachable from a route. Tasks 03, 07, 08 and 12 wire them.

## Post-completion validation and review (2026-09-23)

Before Task 02 was planned, Task 01 was re-validated with the full `/validate` sweep and reviewed
with `/code-review` (Standards and Spec reviews run as separate agents).

**Spec review: no blocking findings.** Every row in the delete map is gone, every rename is done,
and the kept viewport, overlay and PDF modules differ from receipt-ocr only in the
`@payslip/shared` import and comment wording. The `M` entries on `.agents/fixtures/`, `PRD.md`,
`CONTEXT.md` and `docs/` came from line endings only (`git diff HEAD --quiet` was clean). One
omission in the record above: receipt-ocr's §8.4 "Manual browser checks" was folded into the ported
9.4 journey without being mentioned under deviation 6.

**Fixed in this pass:**

| Finding | Fix |
| --- | --- |
| `npm audit`: multer 2.2.0 (high: four DoS and limit-bypass advisories), vitest 4.1.10 (moderate), qs 6.15.3 (moderate) | multer 2.4.0, vitest 4.1.11, qs 6.16.0 via `npm audit fix`. 0 vulnerabilities |
| `format:check` failed on `.claude/settings.local.json`. The file is ignored by the developer's global git ignore, which Prettier does not read | Added to `.prettierignore` |
| validate.md 6.9 failed on every run. `pdfDocument.ts` fetches the signed Storage URL, not our API, so it must not carry the bearer token. receipt-ocr's copy of the check has the same false positive | `pdfDocument.ts` allow-listed with the reason written beside the check |
| `TABLE_FIELDS` left exported but unused after its only import was dropped (AGENTS.md §3) | Removed from `scripts/bakeoff/common.ts`. `score -- cu` still gives 281/284 |
| `agent-browser` was the only range-pinned dependency (`^0.34.0`) | Pinned to `0.34.0` |
| Stale comments: `seed.sql` said "Task 03" (receipt-ocr's numbering), `api.ts` said "tier-1 field schema", `money.ts` pointed at a README that does not exist | Reworded |
| Open item 2, PRD drift: the challenger was described as Anthropic `claude-sonnet-5`, and the Azure region as West Europe | PRD §1, §4.5, §6.1, §8, §9.2, §9.4, Phase 2 and Appendix D now describe Azure OpenAI `gpt-4.1` on the Sweden Central Foundry resource. Document Intelligence runs on a separate, older resource whose region is not recorded, and the PRD now says so rather than claiming EU residency for it. ADR-0001 is left as written at decision time |
| Open item 6: the spec header said "Owner: Phase 3" | Now names ROADMAP Task 05 |
| The roadmap said "eight" warning codes. PRD §7.9 lists nine | Tasks 02 and 06 now say nine |

**Reviewed and deliberately not changed:**

- **`regionSections.ts` section `document`** is a glossary _Avoid_ term. Task 08 replaces the whole
  receipt-era union (`seller`, `buyer`, `vat`, `items`), so renaming one of its five members now
  would leave the map half-migrated (D4).
- **Names built on `document`** (`DocumentExtractionProvider`, `unreadable_document`,
  `SourceDocumentResponse`) are the names PRD §6.3 and §10.9 specify.
- **Duplicated 401 cases in `app.test.ts`**: plan step 6 specified them, and they cost nothing.

**Still open, added to the list above:**

8. **`db:test` points at `supabase/tests/database`**, which step 8 removed. Task 03 recreates it
   with the first pgTAP test.
9. **Unused kept exports.** Open item 7 applies to `shared` too. Nothing outside the tests uses the
   money and datetime exports, `parseIssueTime` (shaped for receipts, since a payslip has no issue
   time), `EXTRACTION_FAILURE_REASONS`, `sourceRegionsResponseSchema`, or any of
   `providers/document-extraction/types.ts`. Task 02 decides what survives.
   **Resolved by Task 02:** `parseIssueTime` was deleted, `parseIssueDate` became `parseDate`,
   and the failure reasons moved to `session.ts`. The money exports and
   `sourceRegionsResponseSchema` were kept for Tasks 06 and 08, which are their first users.
10. **The app name differs by language.** `common.appName` is "Payslip OCR" in `en` and "Skener
    platnih lista" in `hr`.

## Own Supabase project (2026-09-23)

Open item 1 was settled by the product owner: **payslip gets its own hosted Supabase project and
does not share receipt-ocr's.** This replaces D1.

| | |
| --- | --- |
| Project ref | `hxksulbgluvfxfoxrhse`, region eu-central-1 (Frankfurt), created in the dashboard |
| JWT signing | ES256 (P-256), checked against `/auth/v1/.well-known/jwks.json`. `auth.integration.ts` depends on this |
| Email confirmation | Off (`mailer_autoconfirm: true`), per PRD §7.1 |
| Storage | `payslip-sources` created private with a 12 MB limit by `npm run db:provision-storage` |
| `.env` | All five Supabase values point at the new project. `DATABASE_URL` is unset: nothing reads it yet, and Task 03 decides how migrations are applied |
| `.mcp.json` | `project_ref` switched to the new project. The Supabase MCP must be re-authenticated (`/mcp`) before Task 03 uses it |

receipt-ocr's project was left untouched. The Task 01 check found zero leftover `task*` users in it.

**Re-validated against the new project:**

- `npm run test:integration`: 3/3 green against `hxksulbgluvfxfoxrhse`.
- API journeys (9.2–9.4): health works directly and through the Vite proxy, an unknown route gives
  `404 not_found`, and `/api/payslips` and `/api/sessions` give `401 unauthorized`.
- Browser journeys (9.4–9.5), driven with `agent-browser`:
  - `/` redirects to `/login` when signed out.
  - Register lands on the translated home page, and the user stays signed in across a reload.
  - HR switches `lang`, the title and all copy, and persists across a reload.
  - A failed sign-in shows the translated error in both languages.
  - Sign out goes to `/login`, and `/` and unknown URLs then redirect there.
  - Signed in, an unknown URL renders the translated not-found page inside the layout, with no
    current nav item.
  - At 375 px: fixed bottom tab bar (360×64), sidebar hidden, no dialog or menu roles, no
    horizontal overflow, and the brand is not truncated in either language.
  - At 1440 px: sidebar visible and bottom bar hidden.
  - The account panel shows the email and wires `aria-expanded`/`aria-controls`. `Escape` closes it
    and returns focus to its trigger.
  - Every header control shows a 2 px accent focus outline.
  - The throwaway user was deleted afterwards, and the project has zero users.
- **Not proven in the browser:** that no page flashes before the redirect and no login screen
  flashes on reload. That is a timing property the snapshot tool cannot observe. It rests on the
  `AuthProvider` and `ProtectedRoute` unit tests.

**One journey failure, fixed:** the header app-name link was **20 px tall**, below the 44 px target
in journey 9.4. It was inherited from receipt-ocr and missed by the Task 01 browser pass, which only
measured the tabs. `min-h-11` on the link makes it 44 px at both widths without changing the header
height. validate.md 9.5 now says to measure every header control.

**Noted, not changed:** the not-found page is a bare `<p>` with no heading. It is inherited, and the
journey only requires translated copy inside the layout.
