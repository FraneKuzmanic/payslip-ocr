# Feature: Task 09 — Review form & two-way linking

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 09](../ROADMAP.md), §5 (direct-write gap) · **PRD:** §2
(principles 1, 2, 5), §6.4, §6.6, §7.7, §7.9, §9.1, §10.5–10.7, §11.1, §11.5 · **Previous tasks:**
[`history/08`](../history/08-source-regions-preview.md) (review findings 7–8, D01 open item),
[`history/07`](../history/07-capture-multi-upload.md) (open item 3),
[`history/06`](../history/06-warnings-validation-engine.md) (open items 2–4),
[`history/05`](../history/05-extraction-latency-two-pass.md) (D9),
[`history/04`](../history/04-content-understanding-provider.md) (D2) · **Glossary:**
[`CONTEXT.md`](../../CONTEXT.md) (*Attention signal*, *Warning*, *Unreadable field*, *Critical
field*, *Extraction pass*) · **Behaviour rules:** [`AGENTS.md`](../../AGENTS.md) (no `CLAUDE.md`) ·
**Prior art (sibling, forked from):** `../receipt-ocr/client/src/routes/ReviewPage.tsx`,
`../receipt-ocr/client/src/review/ItemRows.tsx`, `../receipt-ocr/client/src/review/reviewForm.ts`,
`../receipt-ocr/api/src/routes/receipts.ts` lines 133–195 and 388–396.

## Feature Description

The screen the product exists for. Selecting a payslip on the session page opens its **review
form** beside its highlighted source: every canonical field editable, including the three
line-item tables, each section marked with the colour dot its outlines use. Focusing a field
highlights and pans to its outline; clicking an outline focuses its input (at `lg`), or opens the
popover whose **Edit** button does (on a phone). Values that need attention carry an amber border,
icon and visible explanation. Saving is explicit; confirming is refused while the form is dirty or
while the tables pass is still pending, and is idempotent after.

On the server, `PATCH /api/payslips/:id` and `POST /api/payslips/:id/confirm` land, and **every
payslip write moves behind a `security definer` SQL function**, so the user's direct PostgREST
`update` grant can be revoked (the direct-write gap, ROADMAP §5). Edited values are computed
against the original machine extraction, re-mapped from the retained raw response, and they drop
their machine attention signals.

## User Story

As someone checking what the app read from my payslip
I want to correct any value in a form that shows me where each value came from
So that I can confirm a payslip I trust without retyping it (PRD US-03, US-04; §11.1 steps 2 and 4)

## Problem Statement

- There is no form. The session page shows a read-only preview (Task 08); nothing can be edited
  or confirmed, and there is no PATCH or confirm route.
- Any signed-in user can write `status`, `canonical_data` or `confirmed_at` on their own payslip
  directly through PostgREST (ROADMAP §5 "Direct-write gap"), for example confirming while the
  tables are pending, bypassing PRD §10.7.
- `edited_fields` exists (Task 03 column) but nothing writes it, so an outline never dashes.
- Attention signals are positional and machine-only: once a user edits a value or removes a row,
  `lowConfidenceFields`, `ungroundableFields` and `unreadableFields` can describe a value that is
  no longer there, or the wrong row (history/06 open items 3–4).
- `period` and `paymentDate` sit below the 0.5 confidence threshold on most payslips even when
  correct: 49 of the 68 scalar flags measured in Task 06 (history/06 open item 2).
- receipt-ocr's review form, the prior art, let a bad line-item amount block submission with **no
  visible message** (ROADMAP Task 09 DoD). It must not be inherited.

## Solution Statement

- **Database:** migration 1 adds eight `security definer` write functions and makes
  `complete_extraction_pass` `security definer`. It is additive, so the deployed API keeps
  working. Migration 2 (`revoke update` + drop the update policy) is written now and applied only
  after this task is pushed and deployed (D3).
- **API:** the repository writes only through those functions. A PATCH reads the payslip's
  retained responses once, re-maps the original extraction through the content-understanding
  module, merges the patch, computes the edited paths (scalars and positional cells, D5) and
  writes both atomically. Reads drop edited paths from every machine signal (D6) and apply the
  date rule to low confidence (D7).
- **Client:** `PayslipPreview` becomes `PayslipReview`: detail, regions and a react-hook-form
  form. Line-item tables render as a real `<table>` at `lg` and as cards on a phone, chosen once by
  `useWideLayout`. Inputs show locale-formatted values and normalise on save (D12). A sticky
  action bar holds Save and Confirm (D14). The session page stacks the list above a form +
  sticky-preview grid (D11) and asks before discarding unsaved edits (D13).

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: High. It is the largest task so far: a SQL migration with nine functions,
two new routes, a repository rework, and the whole review form.
**Primary Systems Affected**:
- supabase: two migrations (one applied now, one after the push);
- api: repository, payslips router, `validation/` (edited, attention), the content-understanding
  module's public exports, database types, the scoring harness's signal projection;
- shared: `api.ts` comments only;
- client: `review/*`, `routes/SessionPage.tsx`, `api/client.ts`, locales;
- docs: PRD, ROADMAP, CONTEXT, `validate.md`.
**Dependencies**: none new. `react-hook-form` 7.85.0 is already a client dependency, unused until
now. The lockfile must not change.

---

## DESIGN DECISIONS

Settled with the product owner on 2026-09-26 in the planning session. Do not reopen them without
new evidence.

### D1 — One task (product owner)

Server writes and the form stay one task: neither can be verified end to end without the other.

### D2 — Every payslip write goes through a `security definer` function (product owner)

The API has no secret key at runtime (Task 04 D2); it writes with the user's own token. So the
only way to take `update` away from `authenticated` without breaking the API is to make every
write a function that runs with the owner's rights and enforces the rule itself.

| Function | Replaces | Rule it enforces |
| --- | --- | --- |
| `update_payslip_fields(p_payslip_id, p_fields, p_edited_fields)` → `boolean` | new (PATCH) | own, live, `status in (review, confirmed)`, and no table key while `tables_status = 'pending'` |
| `confirm_payslip(p_payslip_id)` → `timestamptz` | new (confirm) | `review` → `confirmed` only when tables are not pending; an already-confirmed payslip returns its existing `confirmed_at` (idempotent); `null` otherwise |
| `begin_payslip_retry(p_payslip_id, p_retryable_reasons)` → `boolean` | `beginRetry` | own, live, `failed` with a retryable reason; the full reset of Task 07 D8 |
| `soft_delete_payslip(p_payslip_id)` → `boolean` | `update({deletedAt})` | own, live |
| `fail_payslip_extraction(p_payslip_id, p_reason)` → `boolean` | `failExtraction` | own, live, `processing` |
| `fail_payslip_tables(p_payslip_id)` → `boolean` | `failTablesExtraction` | own, live, `tables_status = 'pending'` |
| `fail_stale_payslip_extractions(p_cutoff)` → `integer` | `failStaleExtractions` | own, live; both reaper updates of Task 04 D3 / Task 05 D10 |
| `complete_extraction_pass(…)` | unchanged body | `alter … security definer`; its body already filters `user_id = auth.uid()` |

- Every function: `language plpgsql`, `security definer`, `set search_path = ''`, fully qualified
  names, `where user_id = (select auth.uid()) and deleted_at is null`. RLS does not apply inside a
  definer function, so **the `auth.uid()` filter is the ownership check**. Omitting it anywhere is a
  cross-user write.
- `revoke execute … from public, anon; grant execute … to authenticated;` for each.
- A user calling these RPCs directly gets exactly the API's rules, so a direct call is no longer a
  bypass. Two direct calls remain possible and are harmless: `complete_extraction_pass` with
  invented fields (same as a PATCH, on their own data) and `fail_stale_payslip_extractions` with a
  future cutoff (fails their own in-flight payslips, which are retryable).
- `p_retryable_reasons` is passed from `RETRYABLE_FAILURE_REASONS` in Node, so the list keeps one
  source of truth. A direct call with a wider list only resets a payslip to `processing` with no job
  behind it; the reaper fails it again after 15 minutes. No analysis is paid for.
- The update policy's "session not deleted" sub-check is **not** replicated: no route deletes a
  session, and `sessions` has no `update` grant.
- The session-cap trigger keeps firing on `update of deleted_at` from inside the functions.

### D3 — Two migrations, the revoke after the push (product owner)

- **Migration 1** (`server_side_payslip_writes`): the D2 functions. Purely additive, so the deployed
  API, which still writes directly, keeps working. Applied to the hosted project in this session,
  after a transactional dry run.
- **Migration 2** (`revoke_direct_payslip_updates`): `revoke update on public.payslips from
  authenticated;` and `drop policy "Users can update their own payslips"`. **Written now, not
  applied.** It is applied after the product owner commits, the subtree push deploys, and Render
  is live on the new code (post-push step P, below).
- Until migration 2 is applied, the hosted migration list differs from `supabase/migrations/` by
  exactly that one file. The review session's `validate.md` 8.1 must expect this.

### D4 — "Edited" is measured against a re-mapping of the retained response (product owner)

- On each PATCH the route reads the retained responses once, maps them through the real mapper
  (`originalExtraction(raw)`, a new export of the content-understanding module) and compares.
- The result is stored in the existing `edited_fields` column in the same function call as the
  fields. Detail reads stay cheap and never touch the raw column.
- No new column and no backfill. Payslips already stored have `edited_fields = {}`, which is
  correct: none has been edited.
- The comparison is always against the **full merged state**, never incremental, so typing the
  original value back clears the mark.

### D5 — Edited covers scalars and table cells, positionally (product owner)

- **Scalar:** edited when its current value differs from the original.
- **Cell:** edited when it differs from the original cell at the same row index and column.
- **A row added or removed** (the table's length differs from the original): every cell of every
  current row from the first row that differs down counts as edited. Those rows no longer line up
  with the document, and dashing them errs in the honest direction.
- **Comparison:** strings with whitespace runs collapsed to one space and trimmed, so a line break
  joined into a space (D17) is not an edit. `null`, `undefined` and a blank string are equal.
  `"100.50"` against `"100.5"` **is** an edit: the user retyped it. Numeric equality is not used.
- The shared `editedFields` comment ("never includes the line-item tables") is replaced.

### D6 — An edited value drops its machine signals (product owner)

- `lowConfidenceFields`, `ungroundableFields` and `unreadableFields` on the detail response omit
  every edited path, **and every table path whose row no longer exists**. The second rule stops a
  removed trailing row's signal from pointing at nothing.
- The `unreadableFields` fed to `computeWarnings` is filtered the same way, in `mapPayslipRow`, so
  no phantom `unparseable_*` warning points at a shifted or deleted row. Summary `warningCount`
  follows automatically.
- Warnings themselves are still computed from the current values: an edited value that breaks an
  identity still raises it.

### D7 — `period` and `paymentDate`: low confidence counts only when ungrounded (product owner)

- For these two paths, `lowConfidenceFields` includes the path only if it is **also** in that
  pass's `ungroundableFields`. `period` is ungroundable by design (`UNGROUNDABLE_BY_DESIGN`), so in
  practice `period` is never marked for confidence alone; warnings (`missing_critical_field`,
  `unparseable_date`) still mark it.
- **Measured at planning:** the only wrong `period` in any recorded set is `production` B01, which
  `unparseable_date` already marks. No wrong date loses its mark in the recordings.
- Implemented in `api/src/validation/attention.ts`, which the scoring harness already calls, so the
  harness's ATTENTION line measures what the user sees. Step 2 records the figures before; step 5
  records them after.
- This is a per-field rule the product owner chose knowingly. The history file records it as such.

### D8 — Tables failed: a notice and manual rows (product owner)

`review` with `tablesStatus: failed` shows a translated notice in each line-item section ("could not
be read; add rows by hand if you need them"), with Add row enabled. Confirm is allowed. No
tables-only retry is built.

### D9 — Region interaction: popover on a phone, focus at `lg` (product owner)

- `interaction = useWideLayout() ? "focus" : "popover"`. There is one panel mount (Task 08 D1): never
  two panels hidden by CSS.
- **`lg`:** clicking an outline focuses its input (`onSelect`).
- **Phone:** tapping opens `RegionPopover`, which now has **Edit** (`onEdit` is already wired to
  `onSelect` in `ZoomableSourceViewport` lines ~299–306; passing `onSelect` is enough).
- **Escape** closes the popover (history/08 finding 8). The popover still takes no focus when it
  opens (receipt-ocr's browser-found design). If focus was inside the popover when it closes, it
  moves to the viewport element.
- `selectRegion(path)`:
  - sets `activeField`;
  - focuses `#review-field-<path with . → ->`;
  - calls `scrollIntoView({ block: "center" })` on it.
  The input exists for every path the regions can name, since table regions only appear once the
  tables pass has landed (Task 08 D7).
- **Field → region:** `onFocusCapture` on the form sets `activeField`. `PdfSource` already switches
  to that field's page (`pageForField`), and the viewport already pans to and emphasises the
  region. `onBlurCapture` clears it when focus leaves the form.
- The outlines stay `aria-hidden` and pointer-only (history/08 finding 7). The keyboard path to
  every region is field → region.

### D10 — Table keys in a PATCH while pending → `409 tables_pending` (product owner)

- The route refuses the whole PATCH before writing, and `update_payslip_fields` refuses it again
  atomically, in case the tables pass lands in between. The client never sends table keys while
  pending (D17), so only a stale tab or a direct call reaches this.
- The code is new and gets en/hr copy.

### D11 — Layout: the list on top, form + sticky preview below (product owner)

- The page is still `/sessions/:sessionId?payslip=<id>` (Task 08 D1). A payslip is selectable while
  `review` or `confirmed`.
- **`lg`:** the payslip list full width on top, then the review area as
  `lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-start lg:gap-6`: the form on the
  left, the source in an `<aside>` that is `lg:sticky lg:top-20` (clearing the 64 px header) on the
  right. Page width `lg:max-w-6xl` while a payslip is open, as now.
- **Phone:** the list, then the review area: a disclosure for the preview above the form,
  **open by default**. The disclosure button reuses `session.showDocument` / `session.hideDocument`,
  with `aria-expanded` and `aria-controls`. Collapsing hides the panel with `hidden`; it does not
  unmount it, so a PDF is not rendered again. At `lg` the button is `lg:hidden` and the panel is
  always shown (`hidden lg:block` when collapsed).
- Task 10 replaces the list with the chip rail and adds the keyboard strip. On a phone in Task 09 the
  preview scrolls away while the user edits lower fields. Field → region still sets the active
  outline, but it is visible only after scrolling up. The DoD line "focusing any field scrolls and
  highlights its region" is met at `lg`, and fully on a phone only in Task 10 (§ ACCEPTANCE).

### D12 — Inputs show the locale's form and normalise on save (product owner)

| Kind | Fields | `hr` shows | `en` shows | Parsed on save by |
| --- | --- | --- | --- | --- |
| amount | the chain, `doprinosiNaPlacu`, `ukupanTrosakRada`, every `iznos`, `ostatakSalda` | `2298,97` | `2298.97` | `parseAmount` |
| quantity | `ukupnoSati`, `sati`, `koeficijent` | `0,135` | `0.135` | `parseQuantity` |
| date | `paymentDate` | `10.07.2025` | `2025-07-10` | `parseDate` |
| period | `period` | `07/2025` | `2025-07` | `parsePeriod` |
| text | names, addresses, OIBs, IBANs, `naziv`, `vjerovnik`, `brojRata` | as stored, line breaks joined (D17) | same | trim; blank → `null` |

- **No grouping separators.** A value without decimals (`1234`) shown grouped in `hr` (`1.234`)
  would fail `parseAmount`'s ambiguity rule (Task 02 D2) on the next save. The decimal separator is
  swapped, the digits are untouched, and the scale is kept, so `100.50` stays `100,50`.
- The parsers accept both locales' forms whatever the UI language, so switching language mid-edit
  is harmless. Untouched fields re-format on a language switch through RHF's `values` update.
- `<input type="text">`, `inputMode="decimal"` for amounts and quantities, `autoComplete="off"`. No
  native date or month pickers.
- **Round-trip guarantee**, unit-tested over all 11 golden fixtures in both locales:
  `parse(format(v, locale)) === v` for every non-null value.

### D13 — Unsaved edits: ask before discarding (product owner)

- Pressing another row's **Review**, or **Hide review** on the open one, while the form is dirty
  opens the existing `ConfirmDialog`: "Discard unsaved changes?" with Discard / Keep editing.
- A `beforeunload` listener while dirty covers reload and closing the tab.
- **Not covered:** the browser Back button changing `?payslip=`. The app uses `<BrowserRouter>`,
  which has no `useBlocker` (data routers only). Record it as a known gap that Task 10's draft
  preservation closes. Do not migrate the router for this.

### D14 — A sticky action bar (product owner)

- A bar pinned to the bottom of the form column:
  `sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] lg:bottom-0`. It clears the phone
  bottom nav, whose height the toast offset in `Toast.tsx` line 60 uses.
- It holds:
  - the unsaved indicator (`role="status"`);
  - **Save** (`type="submit"`);
  - **Confirm**, or the `Confirmed` status text once confirmed.
- All are 48 px (`min-h-12`) and every control keeps its label text.
- **Confirm's busy state:**
  - It uses `aria-disabled`, never `disabled` (Task 07's busy pattern), so it stays focusable.
  - While the form is dirty or tables are pending, a visible reason sits beside it:
    `review.confirmBlockedDirty` or `review.confirmBlockedPending`.
  - A press while `aria-disabled` does nothing.

### D15 — The D01 inside-region check is a later task (product owner)

Not in Task 09. Add a ROADMAP §5 row: "Service source on the wrong text (D01 `paymentDate`)",
open, needing its own measurement over the recordings.

### D16 — The row button says **Review** (product owner)

`session.review` "Review" / "Pregledaj" and `session.hideReview` "Hide review" / "Sakrij pregled"
replace `session.showDocument` / `session.hideDocument` on the row. The latter two stay in the
locales for the phone preview disclosure (D11). The product owner reads the copy at review.

### D17 — Line breaks join into spaces; PATCH sends only what changed (product owner)

- 17 stored text values in the recordings contain `\n` (wrapped obustave names such as A04's
  `"…SA\nSALDA"`). A single-line input would drop them silently.
- `toFormValues` joins `\s*\n\s*` into one space, as receipt-ocr's `text()` does.
- The PATCH body carries **only the dirty scalars** (RHF `dirtyFields`), so an untouched value keeps
  its stored line breaks.
- A table is sent **whole** when any of its cells or its row count changed, and only when its
  tables are not pending. Its text is then joined. D5's whitespace-collapsed comparison means a
  joined break is never counted as an edit.
- Fully blank rows are dropped on save. An empty table is sent as `[]`, which is what the mapper
  stores for an absent section.

### D18 — One attention appearance, one note

- **Attention** (a warning on the path, `ungroundable`, or `lowConfidence`):
  - amber border and background;
  - a `TriangleAlert` icon;
  - one visible note, linked by `aria-describedby`.
- **Note priority:** warnings (all codes on the path, space-joined), else `review.ungroundable`,
  else `review.lowConfidence`. Never two kinds at once (ROADMAP Task 09 scope).
- **`aria-invalid` is never set for attention** (PRD §7.7): an uncertain extraction is not a
  validation failure.
- **Format errors** (text that will not parse on save) are a validation failure. They get red text
  under the input, `aria-invalid="true"`, and the error's id in `aria-describedby`. This is the
  standard pattern (WCAG 3.3.1) and the PRD's rationale does not cover it; the history file says
  so.
- **Line-item errors are visible** (the DoD's receipt-ocr gap):
  - in cards, under the offending cell;
  - in the table, in a note row under the row, naming the column.
  - On a failed submit, a form-level `role="alert"` says some values need fixing, and RHF focuses
    the first invalid input (`shouldFocusError`, on by default).
- **Section-level warning:** `pay_components_sum_mismatch` has `field: "payComponents"`. It
  renders under that table's legend, as receipt-ocr did for `vatBreakdown`.

### D19 — Confirm and edit rules

- Editable in `review` and `confirmed` (PRD §7.7). An edit keeps a payslip `confirmed` (PRD §6.6,
  `PAYSLIP_STATUS_TRANSITIONS`).
- A missing critical field, or any warning, never blocks Save or Confirm (DoD).
- The line-item sections render only when `tablesStatus` is:
  - **`pending`:** a skeleton (the existing `Skeleton`), read-only, with `tablesStatus.pending` as
    its status text;
  - **`ready`:** editable;
  - **`failed`:** D8's notice with Add row.
- When the tables land while the form is open, the refetched detail updates the form through RHF's
  `values` with `resetOptions: { keepDirtyValues: true }`. A scalar edit in progress survives. The
  tables were not editable, so there is nothing of theirs to lose.

### D20 — Warning copy and its guard

- en/hr copy for all nine `WARNING_CODES` under a top-level `warnings` key (table in step 16).
- `client/src/i18n/statusCopy.test.ts` gains a `["warnings", WARNING_CODES]` group. It is the
  existing mirror of `uploadErrors.test.ts` (ROADMAP Task 09 scope).

### D21 — Paid runs: none in this session (product owner)

- **Implementing session:** $0. PATCH and confirm are tested against rows completed through
  `complete_extraction_pass` with fixture bodies, as Task 08 did.
- **Review session:**
  - It reads the M1 data (sessions 1–3 under `m1-review-08@example.test`) but **must not edit or
    confirm it**, because the product owner's M1 spot-check is still pending.
  - For edit and confirm journeys it uploads at most **two** documents of its own under a
    throwaway account (about $0.10), then deletes them.

### D22 — Session split

This implementing session does **not** run `/code-review`, `/validate` or any browser journey. It
does not apply migration 2 and does not commit. It runs the unit tests, typecheck, lint, format,
build, the harness and the hosted integration suite, records them in `history/09-*.md`, and stops.

### D23 — Hit boxes

Every new control is at least 48 px (PRD §11.5): inputs, Add row, row removal, Save, Confirm, the
disclosure, and the dialog buttons. `ConfirmDialog`'s own buttons are inherited. If they measure 44
px, raise them to `min-h-12` (the product owner's rule from history/07 open item 1).

### Post-push step P — migration 2 (not in this session)

Run by whichever session pushes, after the product owner's go-ahead and once Render reports the new
API live:

1. Dry run migration 2 in a transaction (`execute_sql`: `begin; … rollback;`).
2. `apply_migration`, rename the local file to the recorded version.
3. Add `src/routes/direct-writes.integration.ts` (step 12) to the runner's non-extraction file list
   in `scripts/run-supabase-integration-tests.mjs`.
4. Run `npm run test:integration`.
5. `get_advisors` (security).
6. Record it in `history/09-*.md`, and move ROADMAP §5 "Direct-write gap" to closed.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

**Database**

- `supabase/migrations/20260924100541_create_sessions_and_payslips.sql`:
  - lines 80–83: the grants;
  - lines 119–129: the update policy migration 2 drops;
  - lines 140–171: the definer-free cap trigger and its reasoning.
- `supabase/migrations/20260924102451_enforce_session_cap_on_update.sql`: the trigger fires on
  `update of session_id, deleted_at`, so soft delete through a function still passes it.
- `supabase/migrations/20260924194757_two_pass_extraction.sql` lines 29–88: the
  `complete_extraction_pass` style to mirror exactly:
  - `language plpgsql`, `set search_path = ''`;
  - `get diagnostics v_count = row_count`;
  - revoke/grant execute.

**API**

- `api/src/repositories/payslips.ts`, the whole file (~470 lines):
  - `PAYSLIP_COLUMNS` and `WARNED_STATUSES`;
  - `findDetailState` (signals projection);
  - `findRegionSource` (the one raw read, renamed in step 8);
  - `update`/`softDelete`/`beginRetry`/`#updateProcessing`/`failStaleExtractions`/
    `failTablesExtraction` (all replaced by RPCs);
  - `mapPayslipRow` (warnings input).
- `api/src/repositories/payslips.test.ts`: the row builder (lines 13–41) and the chain-recording
  mock near line 357. Mirror it for `rpc`.
- `api/src/routes/payslips.ts`, the whole file: route shape, the retry route's pre-read/fast
  refusal/authoritative write pattern, `HttpError` codes.
- `api/src/routes/payslips.integration.ts`:
  - lines 40–75: setup and teardown with `admin`;
  - lines 195–212: the two direct-write cap tests, which step 12 loosens;
  - lines 300–312: cross-user `repository.update`, which becomes `softDelete`;
  - lines 455–470 and 720–770: `userA.rpc("complete_extraction_pass", …)` with `regionsPassBody`.
- `api/src/validation/attention.ts` (27 lines) and `api/src/validation/warnings.ts`
  (`computeWarnings`, `valueAt` lines 140–160).
- `api/src/providers/document-extraction/content-understanding/fields.ts` lines 120–175:
  `MappedExtraction`, and `mapAnalyzeResult(operation, pass)`. The `pass` argument matters: the
  tables body mapped as `"tables"` yields only table keys.
- `api/src/providers/document-extraction/content-understanding/regions.ts` lines 1–70: how the
  stored `{ scalars?, tables? }` is narrowed. Mirror it for `originalExtraction`.
- `api/src/providers/document-extraction/content-understanding/index.ts`: the export point.
- `api/src/provider-vocabulary.test.ts`: `valueString`, `valueArray`, `valueObject`, `polygon`
  and `analyzer` are forbidden outside the module, **including in comments**.
- `api/src/database.types.ts`: regenerated in step 4.
- `scripts/score-extraction.ts` lines 140–160: `signals()`, which must pass `ungroundableFields`
  to `lowConfidenceFields` (D7).
- `scripts/run-supabase-integration-tests.mjs` lines 30–34: the integration file list (step P).

**Shared**

- `shared/src/api.ts` lines 120–160: `payslipDetailResponseSchema.editedFields` (comment to
  replace, D5), `updatePayslipRequestSchema`, `confirmPayslipResponseSchema`.
- `shared/src/payslip.ts`: `canonicalPayslipFieldsSchema` and the three row schemas (their
  `.shape` keys are the column lists).
- `shared/src/session.ts`: `EDITABLE_PAYSLIP_STATUSES`, `RETRYABLE_FAILURE_REASONS`.
- `shared/src/money.ts` (`parseAmount`, the ambiguity rule), `shared/src/quantity.ts`,
  `shared/src/datetime.ts` (`parseDate`, `parsePeriod`'s `MONTH_SLASH_YEAR`).

**Client**

- `client/src/routes/SessionPage.tsx`, the whole file: selection, focus, the poll, `refreshKey`,
  `linkClass`.
- `client/src/review/PayslipPreview.tsx` and `PayslipPreview.test.tsx`: become `PayslipReview`;
  keep `fieldValuesOf` and the refetch-without-remount behaviour.
- `client/src/review/regionSections.ts`: `SCALAR_SECTIONS` order, `SECTION_COLOURS`,
  `SCALAR_LABEL_KEYS`, `COLUMN_LABEL_KEYS`, `SECTION_LABEL_KEYS`, `fieldLabel`. The form's section
  and field order comes from here.
- `client/src/review/ZoomableSourceViewport.tsx` lines 29–80 (props), 120–180 (panning,
  `handleRegionClick`), 280–325 (popover wiring).
- `client/src/review/RegionPopover.tsx`: Edit is already conditional on `onEdit`.
- `client/src/review/SourceDocumentPanel.tsx` and `PdfSource.tsx` line 125 (`pageForField`).
- `client/src/history/useWideLayout.ts`: the one layout hook.
- `client/src/components/ConfirmDialog.tsx`, `Toast.tsx` (`useToast().show`, the bottom offset at
  line 60), `Skeleton.tsx`, `ErrorMessage.tsx`, `Spinner.tsx`.
- `client/src/api/client.ts`: the `request`/`parseResponse` pattern and `ApiError.code`.
- `client/src/i18n/index.ts`: typed keys (`CustomTypeOptions`), so an unknown key fails typecheck.
- `client/src/i18n/statusCopy.test.ts`: the guard D20 extends.
- **Prior art to port, not copy:**
  - `../receipt-ocr/client/src/routes/ReviewPage.tsx`: the `ReviewField` `cloneElement` pattern,
    `onFocusCapture`/`onBlurCapture`, `selectRegion`, `SectionLegend`, the save/confirm flow and
    `reset(toFormValues(next))`.
  - `../receipt-ocr/client/src/review/ItemRows.tsx`: cards against the table, one note per row, and
    the `review-field-<table>-<i>-<col>` ids.
  - `../receipt-ocr/client/src/review/reviewForm.ts`: `toFormValues`/`toPatch`.
  - **Its defect not to port:** `ItemRows` registers `validate` but never renders
    `formState.errors`.

### New Files to Create

- `supabase/migrations/<ts>_server_side_payslip_writes.sql`: migration 1 (D2).
- `supabase/migrations/<ts>_revoke_direct_payslip_updates.sql`: migration 2 (D3, **not applied**).
- `api/src/validation/edited.ts` + `edited.test.ts`: `editedFields`, `liveSignals` (D5, D6).
- `api/src/providers/document-extraction/content-understanding/original.ts` + `original.test.ts`:
  `originalExtraction(raw)` (D4).
- `api/src/routes/direct-writes.integration.ts`: the post-migration-2 assertions (step P).
- `client/src/review/reviewForm.ts` + `reviewForm.test.ts`: values, formatting, parsing, patch
  (D12, D17).
- `client/src/review/fieldAttention.ts` + `fieldAttention.test.ts`: which note a path gets (D18).
- `client/src/review/ReviewField.tsx`: label, input, attention note, format error.
- `client/src/review/LineItemSection.tsx` + `LineItemSection.test.tsx`: one table's cards or
  `<table>`, add/remove, pending skeleton, failed notice, visible errors.
- `client/src/review/ReviewForm.tsx` + `ReviewForm.test.tsx`: the form, action bar, save, confirm.
- `client/src/review/PayslipReview.tsx`: `git mv` from `PayslipPreview.tsx`; the loader, layout
  and linking. `PayslipPreview.test.tsx` moves to `PayslipReview.test.tsx`.
- `.agents/history/09-review-form-two-way-linking.md`: at the end.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [PostgreSQL — `CREATE FUNCTION`, "Writing SECURITY DEFINER Functions Safely"](https://www.postgresql.org/docs/current/sql-createfunction.html#SQL-CREATEFUNCTION-SECURITY)
  - Why: `set search_path`, and revoking `public` execute. The reason `set search_path = ''` and
    fully qualified names are mandatory in every D2 function.
- [Supabase — Database functions, security definer](https://supabase.com/docs/guides/database/functions#security-definer-vs-invoker)
  and [Row Level Security, "Use security definer functions"](https://supabase.com/docs/guides/database/postgres/row-level-security#use-security-definer-functions)
  - Why: RLS is bypassed inside a definer function, so the `auth.uid()` filter is the only
    ownership check (D2).
- [Supabase — `auth.uid()` in functions](https://supabase.com/docs/guides/database/postgres/row-level-security#helper-functions)
  - Why: `(select auth.uid())` still resolves inside a definer function, because it reads the JWT
    claim from the request settings, not the role.
- [react-hook-form — `useForm` `values` and `resetOptions`](https://react-hook-form.com/docs/useform#values)
  - Why: D19. `values` updates the form when the detail changes, and `keepDirtyValues` keeps the
    user's edits when the tables land.
- [react-hook-form — `useFieldArray`](https://react-hook-form.com/docs/usefieldarray)
  - Why: `field.id` as the React key (never the index), `append`/`remove`, and `dirtyFields` for
    arrays.
- [react-hook-form — `formState.dirtyFields`](https://react-hook-form.com/docs/useform/formstate)
  - Why: D17's changed-scalars-only PATCH. `dirtyFields` is subscribed only when read during render.
- [WAI-ARIA APG — Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)
  - Why: the phone preview toggle (D11).
- [WCAG 2.2 SC 3.3.1 Error Identification](https://www.w3.org/WAI/WCAG22/Understanding/error-identification.html)
  - Why: visible, programmatically associated format errors (D18).
- [MDN `beforeunload`](https://developer.mozilla.org/docs/Web/API/Window/beforeunload_event)
  - Why: D13. Call `preventDefault()`; custom text is ignored by browsers.

### Patterns to Follow

**A write through a function** (`completeExtractionPass`, `payslips.ts`):

```ts
const { data, error } = await this.#client.rpc("complete_extraction_pass", {
  p_payslip_id: uuidSchema.parse(id),
  p_pass: pass,
  p_fields: result.fields,
  p_metadata: result.metadata,
  p_raw: result.raw,
});
if (error) throw new PayslipRepositoryError("query_failed", error);
return data === true;
```

**A migration function** (`two_pass_extraction.sql`): header comment explaining *why*, `security
…`, `set search_path = ''`, `get diagnostics v_count = row_count; return v_count = 1;`, then
`revoke execute … from public, anon; grant execute … to authenticated;`.

**A route with a fast refusal and an authoritative write** (`/:id/retry`): `idSchema.safeParse` →
400; a pre-read → 404; a state check → 409; the conditional write; `null`/`false` from the write
→ 409.

**Client API** (`retryPayslip` in `client.ts`): `request(path, { method, headers:
{"Content-Type": "application/json"}, body: JSON.stringify(body) })`, then `parseResponse(schema,
response, "PATCH /api/payslips/:id")`.

**Client errors:** `console.error("[review] …", error)` for detail; translated copy for the user
(`error-surfacing-console-vs-ui`). An `ApiError` with `code` maps to a specific key
(`tables_pending`, `edit_not_allowed`, `confirm_not_allowed`), anything else to the generic one.

**Imports:** `api` relative imports end in `.js`; `client` has no extension and imports from
`react-router`; shared types from `@payslip/shared`. Money never becomes a `number` (validate 6.8).

**Tests:** Vitest, `describe`/`it.each`; client tests with Testing Library and `user-event`, as in
`SessionPage.test.tsx`. Hosted integration tests follow `payslips.integration.ts`.

---

## IMPLEMENTATION PLAN

### Phase 1: Foundation

Verify the starting state and record the harness baseline. Write and apply migration 1, write
migration 2, regenerate types.

### Phase 2: Core implementation (API)

The date rule, the edited computation, `originalExtraction`, the repository on RPCs, the PATCH and
confirm routes, the hosted tests.

### Phase 3: Integration (client)

The API client, form model and formatting, attention helper, field and line-item components, the
form, `PayslipReview`, the session page, the popover's Escape, and the copy.

### Phase 4: Testing, docs and validation

Docs, full local validation, the history file, stop.

---

## STEP-BY-STEP TASKS

Execute every step in order. Each ends with its validation.

### 1. VERIFY the starting state

- `git status --short` is clean except this plan file.
- `npm run validate` is green. Record files and tests as the baseline (Task 08 review ended at
  50 files, 743 tests).
- `mcp__supabase__list_migrations` shows the four migrations in `supabase/migrations/`.
- `ls .bakeoff/two-pass-sequential .bakeoff/two-pass-concurrent .bakeoff/cu` shows 11 JSON files
  each.
- **VALIDATE**: `npm run validate`

### 2. RECORD the harness baseline (D7)

- `npm run score:extraction`. For every set, copy the `ATTENTION` line (`wrong scalars flagged
  x/y; N scalar(s) flagged`) into a scratch note for the history file.
- **VALIDATE**: exit code 0.

### 3. CREATE migration 1 and APPLY it (D2, D3)

- File: `supabase/migrations/<UTC yyyymmddHHMMSS>_server_side_payslip_writes.sql`.
- Header comment: Task 09 D2. Why the functions exist (the direct-write gap), why `definer`
  (UPDATE is revoked in migration 2), why every function filters `user_id = (select auth.uid())`.
- `alter function public.complete_extraction_pass(uuid, text, jsonb, jsonb, jsonb) security
  definer;` with a comment that its body already carries the ownership filter.
- `update_payslip_fields`:

```sql
create function public.update_payslip_fields(
  p_payslip_id uuid,
  p_fields jsonb,
  p_edited_fields text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set canonical_data = canonical_data || p_fields,
      edited_fields = p_edited_fields,
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and status in ('review', 'confirmed')
    -- D10: the tables pass writes only while pending, so an edit then would be overwritten.
    and (
      tables_status <> 'pending'
      or not (p_fields ?| array['payComponents', 'obustave', 'neoporeziviPrimici'])
    );
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;
```

- `confirm_payslip`:
  - `update … set status = 'confirmed', confirmed_at = now(), updated_at = now() where …
    status = 'review' and tables_status <> 'pending' returning confirmed_at into v_confirmed_at;`
  - if that is null, `select confirmed_at into v_confirmed_at from public.payslips where … and
    status = 'confirmed';` (idempotent: the original `confirmed_at` is kept);
  - `return v_confirmed_at;`.
- `begin_payslip_retry(p_payslip_id uuid, p_retryable_reasons text[])`:
  - exactly `beginRetry`'s reset: `status 'processing'`, `tables_status 'pending'`,
    `failure_reason null`, `canonical_data '{}'`, `extraction_metadata null`,
    `raw_provider_result null`, `edited_fields '{}'`, `updated_at now()`;
  - `where … status = 'failed' and failure_reason = any (p_retryable_reasons)`.
- `soft_delete_payslip(p_payslip_id uuid)`: `set deleted_at = now(), updated_at = now()`.
- `fail_payslip_extraction(p_payslip_id uuid, p_reason text)`:
  - `set status = 'failed', failure_reason = p_reason, updated_at = now() where … status =
    'processing'`;
  - the table's check constraint validates `p_reason`.
- `fail_payslip_tables(p_payslip_id uuid)`: `set tables_status = 'failed', updated_at = now() where
  … tables_status = 'pending'`.
- `fail_stale_payslip_extractions(p_cutoff timestamptz) returns integer`:
  - both updates of `failStaleExtractions`, same `where` clauses including `updated_at <
    p_cutoff`;
  - `get diagnostics` after each; return the sum;
  - keep the two explanatory comments from `payslips.ts`.
- `revoke execute on function … from public, anon; grant execute on function … to authenticated;`
  for all seven new functions.
- **Dry run:** `mcp__supabase__execute_sql` with `begin; <file contents>; rollback;`.
- **Apply:** `mcp__supabase__apply_migration` named `server_side_payslip_writes`. Rename the local
  file to the version `list_migrations` records (as Task 06 did).
- **VALIDATE**:
  - `list_migrations` shows it once;
  - `get_advisors` (security) shows no new error beyond `auth_leaked_password_protection`. Record
    any `security_definer` notice verbatim; it is expected for these functions.

### 4. REGENERATE `api/src/database.types.ts`

- `mcp__supabase__generate_typescript_types`. Keep the file's existing output style, and change only
  the `Functions` section (eight entries added or changed).
- **VALIDATE**: `npm run typecheck`

### 5. CREATE migration 2 (not applied)

- File: `supabase/migrations/<ts later than step 3>_revoke_direct_payslip_updates.sql`:

```sql
-- Task 09 D3: applied only after the API that writes through the D2 functions is deployed.
-- Before that, the deployed API still updates payslips directly and would break.
revoke update on table public.payslips from authenticated;

-- Nothing can update directly any more, so the policy only misleads a reader.
drop policy "Users can update their own payslips" on public.payslips;
```

- Do **not** dry run or apply it. Step P does.
- **VALIDATE**: `npm run format:check`. Prettier ignores `.sql`, so check the file is in place and
  unapplied with `list_migrations`.

### 6. UPDATE `api/src/validation/attention.ts` and the harness (D7)

- `PassFieldConfidence` gains `readonly ungroundableFields: readonly string[]`.
- `GROUNDING_GATED_FIELDS: readonly string[] = ["period", "paymentDate"]`, with a comment citing D7,
  the 49-of-68 figure and the B01 finding.
- In `lowConfidenceFields`, a gated path counts only when it is in the **same pass's**
  `ungroundableFields`.
- `repositories/payslips.ts` already parses `ungroundableFields` in `passMetadataSchema`. Pass it
  through unchanged.
- `scripts/score-extraction.ts` `signals()`: pass `{ fields: pass.fieldMetadata,
  ungroundableFields: pass.ungroundableFields }`.
- Tests in `attention.test.ts`:
  - a gated path at 0.3 and grounded is not listed;
  - at 0.3 and ungroundable, it is;
  - `period` at 0.1 is never listed;
  - a non-gated path is unchanged.
- **VALIDATE**:
  - `npx vitest run --project api src/validation/attention.test.ts`;
  - `npm run score:extraction`. Record each set's ATTENTION line against step 2. **"wrong scalars
    flagged" must be unchanged in every set**; the total flagged count drops. If a wrong-scalar
    figure drops, stop and report: D7's premise failed.

### 7. CREATE `api/src/validation/edited.ts` (D5, D6)

- `export const TABLE_FIELDS = ["payComponents", "obustave", "neoporeziviPrimici"] as const;` with
  column lists derived from `payComponentSchema.shape`, `obustavaSchema.shape` and
  `neoporeziviPrimitakSchema.shape`. The scalar keys are `canonicalPayslipFieldsSchema.shape` minus
  the tables, so a new field is covered automatically.
- `editedFields(current: CanonicalPayslipFields, original: Partial<CanonicalPayslipFields> | null):
  string[]`:
  - `null` original returns `[]`;
  - scalars in schema order, then each table's cell paths (`obustave.2.iznos`);
  - `same(a, b)`: both normalise to a trimmed string with whitespace runs collapsed, where
    `null`/`undefined`/blank are equal;
  - a table **absent from both** is skipped (tables pass not landed);
  - an absent side counts as `[]`;
  - equal lengths: cell by cell;
  - different lengths: find `k`, the first row index where the rows differ (or the shorter length
    if the common prefix is equal); rows `< k` compare cell by cell (they are equal by
    construction); every column of every current row `≥ k` is edited.
- `liveSignals(paths, edited, fields): string[]`: drops edited paths, and table paths
  (`<table>.<i>.<col>`) whose row `i` is not in `fields[table]`. Scalar paths otherwise pass.
- `edited.test.ts`:
  - an unchanged payslip → `[]`;
  - one scalar changed, then changed back → `[]`;
  - `"SA\nSALDA"` against `"SA SALDA"` → not edited;
  - `"100.50"` against `"100.5"` → edited;
  - one cell changed → only that path;
  - a middle row removed → every cell of that index down;
  - a row appended → only the new row's cells;
  - the tables absent from the original → `[]` for tables;
  - `liveSignals` drops the edited path and a removed row's path, and keeps the rest.
- **VALIDATE**: `npx vitest run --project api src/validation/edited.test.ts`

### 8. CREATE `…/content-understanding/original.ts` and EXPORT it (D4)

- `originalExtraction(raw: unknown): Partial<CanonicalPayslipFields> | null`:
  - narrow `raw` as `{ scalars?: unknown; tables?: unknown }` with a `.loose()` zod object (mirror
    `regions.ts`);
  - `mapAnalyzeResult(scalars, "scalars")?.fields` merged with `mapAnalyzeResult(tables,
    "tables")?.fields`;
  - `null` when neither maps.
- Re-export from `index.ts` beside `projectSourceRegions`.
- `original.test.ts`:
  - a `regionsPassBody` scalars body and a tables body map to the same fields the extraction
    runner stored;
  - a missing tables body gives scalars only;
  - garbage gives `null`;
  - **recordings block** (`describe.skipIf(!existsSync(...))`, as `regions.test.ts` does): for
    every `two-pass-sequential` sample, `editedFields(merged, originalExtraction(stored))` is `[]`.
    This proves an untouched payslip is never marked.
- **VALIDATE**: `npx vitest run --project api src/providers/document-extraction/content-understanding/original.test.ts`

### 9. UPDATE `api/src/repositories/payslips.ts`

- **Rename `findRegionSource` → `findRetainedResponses(id)`.** It returns `{ status, tablesStatus,
  fields: CanonicalPayslipFields, rawProviderResult }` from one select of `status, tables_status,
  canonical_data, raw_provider_result`. `rawProviderResult` is still `null` outside
  `WARNED_STATUSES` (Task 08 D7). The regions route is updated to the new name. It is still the only
  select of `raw_provider_result` (validate 6.23).
- **New writes, each an `rpc`, mirroring `completeExtractionPass`:**
  - `updateFields(id, fields: Partial<CanonicalPayslipFields>, editedFields: string[]):
    Promise<boolean>`;
  - `confirm(id): Promise<string | null>`, the normalised `confirmed_at` or `null`;
  - `beginRetry(id): Promise<boolean>`, passing `[...RETRYABLE_FAILURE_REASONS]`;
  - `softDelete(id): Promise<boolean>`;
  - `failExtraction(id, reason): Promise<boolean>`;
  - `failTablesExtraction(id): Promise<boolean>`;
  - `failStaleExtractions(cutoff): Promise<number>`.
- **REMOVE** `update()`, `UpdatePayslipInput`, `#updateProcessing` and the `PayslipUpdate` type
  alias if unused. This change orphans them. Update every caller: the delete and retry routes, the
  extraction runner (read `services/payslip-extraction.ts` for its calls), and the tests.
- **`findDetailState`:**
  - `edited = data.edited_fields`;
  - `unreadableFields`, `lowConfidenceFields` and `ungroundableFields` pass through
    `liveSignals(paths, edited, fields)`, where `fields` is the parsed canonical data (take it from
    the mapped payslip).
- **`mapPayslipRow`:** warnings get `unreadableFields: liveSignals(…unreadable, row.edited_fields,
  fields)`.
- **Tests** (`payslips.test.ts`):
  - an `rpc` mock recording name and arguments, one case per method, asserting the parameter names
    exactly (`p_payslip_id`, …);
  - `false`/`null`/`0` results;
  - `query_failed` on error;
  - `findDetailState` drops an edited path from all three lists;
  - `mapPayslipRow` raises no `unparseable_amount` for an unreadable path to a removed row;
  - `findRetainedResponses` withholds the raw outside review/confirmed (the old
    `findRegionSource` cases, renamed).
- **VALIDATE**:
  - `npx vitest run --project api`;
  - `npm run typecheck`;
  - `node -e` from validate 6.23, with the method name updated.

### 10. ADD `PATCH /:id` and `POST /:id/confirm` in `api/src/routes/payslips.ts`

- **`PATCH /:id`:**
  1. `idSchema` → 400; `updatePayslipRequestSchema.safeParse(req.body)` → `400 invalid_request`.
  2. `const retained = await repository.findRetainedResponses(id)` → `null` → 404.
  3. `status` not in `EDITABLE_PAYSLIP_STATUSES` → `409 edit_not_allowed`.
  4. `tablesStatus === "pending"` and the body has any `TABLE_FIELDS` key → `409 tables_pending`
     (D10).
  5. `const fields = { ...retained.fields, ...body.data }`; `const edited = editedFields(fields,
     originalExtraction(retained.rawProviderResult))`.
  6. `await repository.updateFields(id, body.data, edited)` → `false` → re-read state and answer
     404 if gone, `409 tables_pending` if the tables are now pending, else `409 edit_not_allowed`.
     Keep this simple: one re-read.
  7. Respond `200` with the detail shape, built as `GET /:id` builds it. **Extract** the
     `PayslipDetailResponse` construction into one local function used by both routes, rather
     than duplicating it.
- **`POST /:id/confirm`:**
  - `idSchema`; `findDetailState` → 404;
  - `const confirmedAt = await repository.confirm(id)`; `null` → `409 confirm_not_allowed`;
  - `200 { id, status: "confirmed", confirmedAt }` typed `ConfirmPayslipResponse`.
- **Docstrings:** PRD §10.6 and §10.7 with the D-references. Place the new routes before `GET
  /:id` for readability. Express matches by method, so order is not load-bearing here.
- Vocabulary: the route imports `originalExtraction` from the module's `index.js` and names nothing
  provider-specific.
- **VALIDATE**:
  - `npm run typecheck`;
  - `npx vitest run --project api` (includes the vocabulary guard);
  - `npm run lint`.

### 11. UPDATE `shared/src/api.ts`

- Replace the `editedFields` comment with D5's rule: scalars and positional cells, and rows from
  the first structural change counted as edited.
- **VALIDATE**: `npx vitest run --project shared`

### 12. UPDATE the hosted integration tests

`api/src/routes/payslips.integration.ts`, new `describe("editing and confirming", …)`. It uses its
own payslips completed through `userA.rpc("complete_extraction_pass", …)` with `regionsPassBody`
bodies that hold a scalar (`netoPlaca`) and a small table (`rows(...)`). Check the mapper maps them
by calling `originalExtraction` in a unit test first.

- PATCH a scalar → `200`:
  - the value is stored;
  - `editedFields` contains it;
  - `warnings` are recomputed (inject a one-cent `dohodak` change → `dohodak_mismatch` appears).
- PATCH the same scalar back to its original → `editedFields` no longer contains it.
- PATCH a table removing row 0 → the remaining row's cells are edited; that table's
  `lowConfidenceFields`/`unreadableFields` paths are gone.
- PATCH with a table key while `tables_status = 'pending'` → `409 tables_pending`, and nothing
  changed.
- PATCH `{ userId: … }` → `400 invalid_request` (strict schema).
- PATCH a `processing` payslip → `409 edit_not_allowed`.
- Confirm while pending → `409 confirm_not_allowed`.
- Confirm once tables are `ready` → `200`. A second confirm → `200` with the **same**
  `confirmedAt`.
- PATCH after confirm → `200`, status still `confirmed`.
- Cross-user:
  - add PATCH and confirm to the existing 404 list;
  - `new PayslipRepository(userB, userBId).softDelete(jpegPayslipId)` replaces the old `update`
    case (it returns `false`).
- **Loosen the two direct-write cap tests** (lines 195–212) to assert the direct write is refused
  (`error` is not null) and the session still has ten payslips. Today the message is
  `session_full`; after migration 2 it is a permission error. Both must pass. Say so in the test
  name's comment.
- **CREATE `api/src/routes/direct-writes.integration.ts`**, not added to the runner (step P adds
  it). As userA through PostgREST:
  - `update({ status: "confirmed" })` on an own `review` payslip;
  - `update({ canonical_data: {} })`;
  - `update({ deleted_at: … })`.
  Each returns an error, and the row is unchanged. Setup and teardown mirror
  `payslips.integration.ts` (admin client, `task09-…@example.test` users).
- **VALIDATE**:
  - `npm run test:integration` (hosted), green;
  - then the `validate.md` Phase 8 orphan query through `execute_sql` shows 0 rows;
  - `npx vitest run api/src/routes/direct-writes.integration.ts --config
    api/vitest.integration.config.ts` is **expected to fail** before migration 2. Do not run it
    here; step P does.

### 13. UPDATE `client/src/api/client.ts`

- `updatePayslip(id, body: UpdatePayslipRequest): Promise<PayslipDetailResponse>`: `PATCH`, JSON
  body, `payslipDetailResponseSchema`.
- `confirmPayslip(id): Promise<ConfirmPayslipResponse>`: `POST …/confirm`,
  `confirmPayslipResponseSchema`.
- `client.test.ts`:
  - both send the method, JSON content type and body, and parse the response;
  - a 409 surfaces `ApiError.code`.
- **VALIDATE**: `npx vitest run --project client src/api/client.test.ts`

### 14. CREATE `client/src/review/reviewForm.ts` (D12, D17)

- `FieldKind = "text" | "amount" | "quantity" | "date" | "period"`.
- `SCALAR_KINDS: Record<ScalarField, FieldKind>`, typed over `ScalarField` from `regionSections`
  so a new scalar is a type error.
- `COLUMN_KINDS` per table, per D12's table.
- `ReviewFormValues`: every scalar as `string`, each table as `Array<Record<column, string>>`.
- `toFormValues(detail: CanonicalPayslipFields, locale: "hr" | "en"): ReviewFormValues`:
  - text fields: `\s*\n\s*` → `" "`, and `null` → `""`;
  - amount and quantity: in `hr`, replace the single `.` with `,`;
  - date: `hr` `DD.MM.YYYY`, `en` as stored;
  - period: `hr` `MM/YYYY`, `en` as stored.
- `parseField(kind, value): { ok: true; value: string | null } | { ok: false }`: blank →
  `{ ok: true, value: null }`; otherwise the kind's shared parser; `null` from the parser →
  `{ ok: false }`.
- `validatorFor(kind)` returns RHF `validate` → `true` or a typed error key:
  - `review.errors.amount`;
  - `review.errors.quantity`;
  - `review.errors.date`;
  - `review.errors.period`.
- `toPatch(values, dirty: DirtyMap, tablesEditable: boolean): UpdatePayslipRequest`:
  - dirty scalars only, parsed;
  - a table whole when `tablesEditable` and any of its entries is dirty (RHF marks array dirt on
    `append`/`remove` too);
  - rows parsed, fully blank rows dropped;
  - text trimmed, blank → `null`.
- `reviewForm.test.ts`:
  - **the round trip**: for each of the 11 `.agents/fixtures/expected/*.json` (read with `fs`,
    parsed by `canonicalPayslipFieldsSchema` after taking the canonical keys; see how
    `shared/src/payslip.test.ts` loads fixtures), in `hr` and in `en`, every non-null value
    survives `parseField(kind, toFormValues(...)[path])`;
  - `toPatch` sends only dirty scalars, and no table while not editable;
  - blank → `null`;
  - `1.234` in an amount → error (ambiguous);
  - `07/2025` → `2025-07`; `10.07.2025` → `2025-07-10`.
- **VALIDATE**: `npx vitest run --project client src/review/reviewForm.test.ts`

### 15. CREATE `client/src/review/fieldAttention.ts` (D18)

- `attentionFor(path, { warnings, lowConfidenceFields, ungroundableFields }): { kind: "warning";
  codes: WarningCode[] } | { kind: "ungroundable" } | { kind: "lowConfidence" } | null`, in D18's
  priority.
- `sectionWarnings(section, warnings)` for the `payComponents` path.
- Tests cover every branch and the priority.
- **VALIDATE**: `npx vitest run --project client src/review/fieldAttention.test.ts`

### 16. UPDATE `client/src/i18n/locales/en.json` and `hr.json`

Every key in both; `statusCopy.test.ts` gains the `warnings` group (D20).

| Key | en | hr |
| --- | --- | --- |
| `session.review` | Review | Pregledaj |
| `session.hideReview` | Hide review | Sakrij pregled |
| `review.save` | Save changes | Spremi promjene |
| `review.saving` | Saving… | Spremanje… |
| `review.saved` | Changes saved. | Promjene su spremljene. |
| `review.unsaved` | Unsaved changes | Nespremljene promjene |
| `review.confirm` | Confirm payslip | Potvrdi platnu listu |
| `review.confirming` | Confirming… | Potvrđivanje… |
| `review.confirmed` | Payslip confirmed. | Platna lista je potvrđena. |
| `review.confirmBlockedDirty` | Save your changes before confirming. | Spremite promjene prije potvrde. |
| `review.confirmBlockedPending` | You can confirm once the line items have been read. | Potvrditi možete kad se stavke učitaju. |
| `review.tablesFailed` | The line items could not be read. Add them by hand if you need them. | Stavke nije bilo moguće očitati. Po potrebi ih dodajte ručno. |
| `review.addRow` | Add row | Dodaj redak |
| `review.removeRow` | Remove row {{row}} | Ukloni redak {{row}} |
| `review.rowLabel` | {{section}} row {{row}} | {{section}}, redak {{row}} |
| `review.invalidForm` | Some values could not be read. Fix the marked fields, then save. | Neke vrijednosti nije moguće pročitati. Ispravite označena polja pa spremite. |
| `review.discardTitle` | Discard unsaved changes? | Odbaciti nespremljene promjene? |
| `review.discardDescription` | Your changes to this payslip will be lost. | Vaše promjene na ovoj platnoj listi bit će izgubljene. |
| `review.discard` | Discard changes | Odbaci promjene |
| `review.keepEditing` | Keep editing | Nastavi uređivati |
| `review.errors.amount` | Enter an amount, such as 1234.56. | Upišite iznos, npr. 1234,56. |
| `review.errors.quantity` | Enter a number, such as 176.5. | Upišite broj, npr. 176,5. |
| `review.errors.date` | Enter a date as YYYY-MM-DD. | Upišite datum kao DD.MM.GGGG. |
| `review.errors.period` | Enter a period as YYYY-MM. | Upišite razdoblje kao MM/GGGG. |
| `review.errors.save` | Your changes could not be saved. Try again. | Promjene nije bilo moguće spremiti. Pokušajte ponovno. |
| `review.errors.confirm` | The payslip could not be confirmed. Try again. | Platnu listu nije bilo moguće potvrditi. Pokušajte ponovno. |
| `review.errors.tablesPending` | The line items are still being read, so they cannot be changed yet. | Stavke se još učitavaju pa ih zasad nije moguće mijenjati. |
| `review.errors.editNotAllowed` | This payslip can no longer be edited. Reload the page. | Ovu platnu listu više nije moguće uređivati. Osvježite stranicu. |
| `review.errors.confirmNotAllowed` | This payslip cannot be confirmed yet. | Ovu platnu listu još nije moguće potvrditi. |
| `warnings.missing_critical_field` | This value is missing. Check whether the payslip prints it. | Ova vrijednost nedostaje. Provjerite je li otisnuta na platnoj listi. |
| `warnings.unparseable_amount` | An amount is printed here, but it could not be read. Enter it by hand. | Iznos je otisnut, ali ga nije bilo moguće pročitati. Upišite ga ručno. |
| `warnings.unparseable_date` | A date is printed here, but it could not be read. Enter it by hand. | Datum je otisnut, ali ga nije bilo moguće pročitati. Upišite ga ručno. |
| `warnings.oib_checksum_failed` | This OIB fails its check digit, so a digit is probably misread. | Kontrolna znamenka ovog OIB-a ne odgovara pa je neka znamenka vjerojatno krivo pročitana. |
| `warnings.dohodak_mismatch` | Gross pay minus contributions from pay does not equal Dohodak. | Bruto plaća umanjena za doprinose iz plaće nije jednaka dohotku. |
| `warnings.porezna_osnovica_mismatch` | Dohodak minus the personal allowance does not equal the taxable base. | Dohodak umanjen za osobni odbitak nije jednak poreznoj osnovici. |
| `warnings.neto_mismatch` | Dohodak minus income tax does not equal net pay. | Dohodak umanjen za porez na dohodak nije jednak neto plaći. |
| `warnings.isplata_mismatch` | Net pay plus non-taxable payments minus obustave does not equal the amount paid out. | Neto plaća uvećana za neoporezive primitke i umanjena za obustave nije jednaka iznosu za isplatu. |
| `warnings.pay_components_sum_mismatch` | The pay components do not add up to gross pay. | Zbroj primitaka nije jednak bruto plaći. |

- English uses the en field labels (Task 08 D9: the *Avoid* lists govern identifiers and prose, not
  en UI copy). The hr terms match `review.fields` and `review.sections` exactly (`Primici` is the
  hr section label for `payComponents`).
- Re-read `CONTEXT.md` before writing hr copy: *obustave* are not deductions; *dohodak* is not
  income.
- Keep `session.showDocument` / `hideDocument` (D11 reuses them).
- **VALIDATE**:
  - `npx vitest run --project client src/i18n`;
  - `validate.md` 6.5 (every `t()` key resolves) and 6.11 (no mojibake).

### 17. CREATE `client/src/review/ReviewField.tsx`

- Props:
  - `path`;
  - `label`;
  - the `input` element (receipt-ocr's `cloneElement` pattern);
  - `attention` (from `attentionFor`);
  - `error` (an error key or undefined).
- **Renders:** a `<label>` wrapping the label text and the input, cloned with:
  - `id="review-field-<path . → ->"`;
  - `className` with the D18 attention or error styles, `min-h-12`;
  - `aria-describedby` = the note id and/or the error id;
  - `aria-invalid="true"` **only** when there is an error.
- The note, with `TriangleAlert`, in amber text. The error in red text with its own id.
- **VALIDATE**: covered by `ReviewForm.test.tsx` (step 20)

### 18. CREATE `client/src/review/LineItemSection.tsx`

- Props:
  - `table: TableField`;
  - `control`/`register` from RHF;
  - `tablesStatus`;
  - the attention inputs;
  - `errors` for that table.
- One `useFieldArray({ control, name: table })`, `field.id` as key.
- **Layout:** `useWideLayout()`, chosen once:
  - **wide:** `<table>` with `<th scope="col">` from `COLUMN_LABEL_KEYS`, an
    `aria-label={t("review.cellLabel", …)}` on each cell input, and a removal column;
  - **narrow:** cards, a `<label>` per cell.
- **Per row:** one note, as `ItemRows.noteFor`, listing attention (D18 priority) and **format
  errors, both visible** (the DoD). A flagged or invalid cell's `aria-describedby` points at it.
- **Pending:** `Skeleton` rows with `role="status"` and the `tablesStatus.pending` text. No inputs
  and no Add row.
- **Failed:** `review.tablesFailed`, then the (empty) editable table and Add row.
- **Add row:** `append` with blank strings. **Remove:**
  `aria-label={t("review.removeRow", { row: i + 1 })}`, 48 × 48.
- A legend with the section dot and the label (`SectionLegend`, as receipt-ocr), and the section
  warning under it (`sectionWarnings`).
- **`LineItemSection.test.tsx`:**
  - wide renders a `table` and no cards; narrow the reverse (mock `matchMedia`, as
    `useWideLayout` expects);
  - pending shows no inputs;
  - failed shows the notice and Add row;
  - an invalid amount shows its message visibly in both layouts;
  - remove has an accessible name.
- **VALIDATE**: `npx vitest run --project client src/review/LineItemSection.test.tsx`

### 19. UPDATE `ZoomableSourceViewport.tsx` / `RegionPopover.tsx` (D9)

- While `inspected !== null`, a `keydown` listener on `document` closes the popover on `Escape`. If
  `document.activeElement` was inside the popover, focus the viewport element (give it
  `tabIndex={-1}` if it has none).
- No other change. `onEdit` already routes to `onSelect`.
- Test in `RegionPopover.test.tsx` or a viewport test: Escape closes; Edit calls `onSelect` with
  the path.
- **VALIDATE**: `npx vitest run --project client src/review`

### 20. CREATE `client/src/review/ReviewForm.tsx`

- Props:
  - `detail: PayslipDetailResponse`;
  - `onSaved(next)`, `onConfirmed(next)`;
  - `onDirtyChange(dirty)`;
  - `onFieldFocus(path | null)`.
- `const language = i18n.language === "hr" ? "hr" : "en"`, and
  `const values = useMemo(() => toFormValues(detail, language), [detail, language])`.
- `useForm<ReviewFormValues>({ values, resetOptions: { keepDirtyValues: true } })` (D19).
- Report `formState.isDirty` through `onDirtyChange` in an effect.
- **Sections** in `SECTION_LABEL_KEYS` order:
  - the four scalar sections, fields in `SCALAR_SECTIONS` order, each a `ReviewField` with
    `register(path, { validate: validatorFor(kind) })`, and `inputMode="decimal"` for amounts and
    quantities;
  - then three `LineItemSection`s.
- `onFocusCapture` / `onBlurCapture` as receipt-ocr: the id → path → `onFieldFocus`.
- **Save:**
  - `handleSubmit(save, onInvalid)`;
  - `save`: `updatePayslip(detail.id, toPatch(values, dirtyFields, detail.tablesStatus !==
    "pending"))`, then `reset(toFormValues(next, language))`, `onSaved(next)` and
    `show(t("review.saved"))`;
  - an error → `console.error("[review] saving failed", error)` and the code-specific or generic
    key in a `role="alert"`;
  - `onInvalid`: set `review.invalidForm` in a `role="alert"` above the bar.
- **Confirm:**
  - `aria-disabled` when dirty, pending or busy, with the visible reason (D14);
  - a press when `aria-disabled` returns early;
  - otherwise `confirmPayslip`, then `onConfirmed`, `show(t("review.confirmed"))`, and errors as
    for Save.
- Hidden once `status === "confirmed"`, replaced by the `payslipStatus.confirmed` text with a
  check icon.
- **The action bar** per D14.
- **`ReviewForm.test.tsx`** (mock `../api/client`):
  - every scalar field and every row cell of a two-row table has a `review-field-…` input;
  - editing one scalar and saving sends **only** that key;
  - a table edit sends the whole table;
  - while pending, Save sends no table key, and the tables show a skeleton;
  - Confirm is `aria-disabled` and explains why while dirty and while pending, and calls the API
    otherwise;
  - an invalid amount in a card shows its message, focuses that input, and does not call the API;
  - a field with a warning has the amber note linked by `aria-describedby`, and no
    `aria-invalid`;
  - a low-confidence field with a warning shows only the warning text;
  - a missing critical field still lets Save and Confirm proceed;
  - `409 tables_pending` shows its specific copy;
  - a new `detail` with tables landed keeps a dirty scalar's typed value.
- **VALIDATE**: `npx vitest run --project client src/review/ReviewForm.test.tsx`

### 21. MOVE `PayslipPreview.tsx` → `PayslipReview.tsx` and extend it

- `git mv client/src/review/PayslipPreview.tsx client/src/review/PayslipReview.tsx` and the test
  file likewise.
- Keep the loader: `Promise.all` detail + regions, refetch on `tablesStatus`, a failed refetch
  keeps the content (Task 08 deviation 5), `fieldValuesOf`.
- **New state:**
  - `activeField`;
  - `previewOpen` (default `true`);
  - `detail`, replaced by `onSaved`/`onConfirmed`. `onConfirmed` merges `status` and
    `confirmedAt`.
- **Layout per D11:**
  - a grid: the form column, and the `<aside>` with the panel;
  - on a phone, the disclosure button above the form;
  - `interaction = wide ? "focus" : "popover"` from `useWideLayout`;
  - `onSelect={selectRegion}` (D9).
- The panel's `editedFields`, signals and `fieldValues` come from the **saved** detail, so the
  dashes follow saves, not keystrokes.
- **New props:** `onDirtyChange`, and `onChanged()` (called after a save or confirm, so the session
  page refreshes its row).
- **Tests** (`PayslipReview.test.tsx`, the old cases kept and renamed):
  - `selectRegion` focuses `#review-field-netoPlaca` (simulate by calling the panel's `onSelect`
    through a mocked `SourceDocumentPanel` that exposes it);
  - focusing an input passes its path as `activeField` to the panel;
  - the phone disclosure toggles `aria-expanded` and hides without unmounting;
  - after a save the panel receives the new `editedFields`.
- **VALIDATE**: `npx vitest run --project client src/review/PayslipReview.test.tsx`

### 22. UPDATE `client/src/routes/SessionPage.tsx`

- **The row button:**
  - `session.review` / `session.hideReview` (D16);
  - still a disclosure with `aria-expanded` and `aria-controls="payslip-preview"` (keep the id,
    so as not to churn tests).
- **Layout (D11):**
  - the list `<ol>` full width;
  - below it the `<section id="payslip-preview">` with its focused `h2` (`scroll-mt-20`,
    unchanged);
  - then `<PayslipReview …>`.
  - Remove the list/preview `lg:grid` wrapper: the grid now lives inside `PayslipReview`.
- **Dirty guard (D13):**
  - `const [dirty, setDirty] = useState(false)` from `onDirtyChange`;
  - `togglePreview(id)` while dirty stores the pending target and opens `ConfirmDialog`
    (`review.discardTitle`, `review.discardDescription`, `review.discard`, `review.keepEditing`);
  - Discard performs the switch and clears `dirty`;
  - a `beforeunload` effect is active only while dirty.
- `onChanged` → `setRefreshKey((k) => k + 1)`, so the row shows `Confirmed`, the new name or the
  new period.
- **Tests** (`SessionPage.test.tsx`):
  - the button copy;
  - a dirty form (mock `PayslipReview` to call `onDirtyChange(true)`) makes another row's Review
    open the dialog, where Keep editing keeps the selection and Discard switches;
  - `beforeunload` calls `preventDefault` only while dirty.
- **VALIDATE**: `npx vitest run --project client src/routes/SessionPage.test.tsx`

### 23. UPDATE the docs

- **`PRD.md`:**
  - **§7.7 Rules:**
    - edited scalars and cells dash their outline (D5);
    - input formats per locale (D12);
    - line breaks joined (D17);
    - tables pending read-only with a skeleton, failed with a notice and manual rows (D8, D19);
    - the discard prompt (D13);
    - a sticky action bar (D14);
    - format errors use `aria-invalid`, attention never does (D18).
  - **§7.9:**
    - edited paths drop their machine signals, and so does a removed row (D6);
    - `period`/`paymentDate` low confidence counts only when ungrounded (D7).
  - **§9.1:** payslip writes go through `security definer` functions; `authenticated` holds no
    `update` once migration 2 is applied (D2, D3).
  - **§10.5:** `editedFields` includes cells (D5).
  - **§10.6:**
    - the body carries the changed keys;
    - a table is replaced whole;
    - `409 tables_pending` (D10);
    - `editedFields` is computed against the re-mapped original (D4).
  - **§10.7:** the idempotent confirm keeps the first `confirmedAt`.
  - **§12 Phase 3:** a status note that Task 09 landed.
- **`CONTEXT.md`:** a new **Edited field** term under Review: a value the user changed from the
  machine extraction, including every cell in rows shifted by an added or removed row; it drops
  the value's machine attention signals. *Avoid*: modified, overridden.
- **`.agents/ROADMAP.md`:**
  - §2: Task 09 → ✅ complete, review pending; migration 2 pending.
  - §3 Task 09:
    - "Added in planning (plan 09)" bullets for D2–D18;
    - tick the DoD lines this session proves (every field visible and editable; the
      missing-critical-field line; line-item errors visible; save recomputes warnings);
    - leave the linking and dashing lines for the review session's browser journey;
    - note the phone half of the focus line waits for Task 10 (D11).
  - §3 Task 10: add "Browser Back while dirty loses edits (Task 09 D13)" to its scope.
  - §5:
    - the Direct-write gap row → "Closing: functions applied (Task 09); revoke pending step P";
    - the new D01 row (D15);
    - the in-memory queue row unchanged.
- **`.claude/commands/validate.md`** (git-ignored; extended by hand per its "Maintaining" section):
  - **Phase 4:** rows for `attention.test.ts` (D7), `edited.test.ts`, `original.test.ts`
    (recordings block), the repository RPC cases, `reviewForm.test.ts` (round trip),
    `fieldAttention.test.ts`, `LineItemSection.test.tsx`, `ReviewForm.test.tsx`,
    `PayslipReview.test.tsx`, the `SessionPage` dirty-guard cases, the `warnings` copy group.
  - **6.23:** the method is now `findRetainedResponses`.
  - **New 6.24:** every function in `supabase/migrations/*server_side_payslip_writes*.sql`
    contains `security definer`, `set search_path = ''` and `(select auth.uid())`. A `node -e`
    check that counts each per `create function` block.
  - **Phase 8:**
    - the new hosted cases;
    - 8.1 expects migration 2 unapplied until step P;
    - the `direct-writes.integration.ts` file and when it runs.
  - **Phase 9: journey 9.8 — review form (Task 09, ≤ 2 documents, about $0.10)**, run under a
    throwaway account and **never on the M1 data** (D21):
    1. Upload `A02.pdf` and `A01.pdf`. While A01's tables are pending, open Review: the tables show
       a skeleton and Confirm explains why it is unavailable.
    2. At 1440 px:
       - focus `netoPlaca`: its outline is emphasised and panned to;
       - click `obustave.1.iznos`'s outline: its input takes focus;
       - on A01, focus a page-2 field: the preview switches to page 2.
    3. At 375 px:
       - tap an outline, and the popover has Edit, which focuses the input;
       - Escape closes the popover;
       - the disclosure collapses and expands the preview without reloading it.
    4. Edit `brutoPlaca` by a cent and save: the toast, `dohodak_mismatch`'s amber note, the dashed
       outline. Type the original back and save: the dash goes.
    5. Remove an obustave row and save: the rows below dash.
    6. Type `abc` into a payComponents amount (table at 1440, card at 375): the message is visible,
       focus lands on it, and nothing is sent.
    7. Dirty the form, press another row's Review: the dialog. Keep editing, then Discard. Reload
       while dirty: the browser prompt.
    8. Confirm: status `Confirmed` on the row. Confirm again (API): same `confirmedAt`. Edit after
       confirming: still `Confirmed`.
    9. `hr` ↔ `en`: amounts switch between `2298,97` and `2298.97` in untouched fields.
    10. Every new control ≥ 48 px, no horizontal scroll at 375 px, and the sticky bar clears the
        bottom nav.
    11. Delete the account's data, then run the orphan query.
  - **Phase 10:** delete the `09` row.
- **VALIDATE**: `npm run format:check`

### 24. RUN the full local validation, then WRITE the history file and STOP

- `npm run validate`: green. Record files and tests against step 1.
- `npm run build`: green, with the known Vite chunk-size advisory.
- `npm run test:integration`: already run in step 12. Re-run only if a later step touched
  `api/src` or the migration.
- `npm run score:extraction`: already run in step 6. Do not re-run.
- `git diff --stat package-lock.json` is empty.
- `grep -rn "react-router-dom" client/src` is empty.
- The vocabulary grep:
  `grep -rnE "polygon|valueString|valueArray|analyzer" api/src --include=*.ts | grep -v content-understanding/`
  shows only `provider-vocabulary.test.ts` (and `config.ts` env names, if any).
- **Not run here** (D22):
  - `/code-review`;
  - `/validate`;
  - journey 9.8;
  - migration 2 and step P;
  - `npm run test:extraction`.
- **CREATE `.agents/history/09-review-form-two-way-linking.md`** in `history/08`'s structure:
  - what was built (a file table), new and extended tests, D1–D23 carried, deviations;
  - the D7 harness table: ATTENTION before and after per set;
  - the migration record: version, dry run, advisors;
  - validation;
  - paid runs ($0);
  - open items: the Back-button gap (D13); migration 2 pending (step P); the D01 check (D15);
  - **"Handoff to the review session"**:
    1. journey 9.8 (≤ $0.10, never on M1 data);
    2. the product owner reads step 16's copy and D16;
    3. `/code-review` and `/validate`;
    4. after commit and push, step P.
- Do **not** commit.
- **VALIDATE**: `npm run validate` (already green above; do not re-run for doc-only edits)

---

## TESTING STRATEGY

### Unit Tests

- **API:**
  - `attention.test.ts`: D7;
  - `edited.test.ts`: D5 and D6, including the positional rule and whitespace;
  - `original.test.ts`: D4, plus a recordings block proving an untouched payslip is never marked
    edited;
  - `payslips.test.ts`: every RPC wrapper's name and parameters, the signal filtering, and
    `findRetainedResponses`.
- **Client:**
  - `reviewForm.test.ts`: the 11-fixture × 2-locale round trip, dirty-only patch, validators;
  - `fieldAttention.test.ts`: priority;
  - `LineItemSection.test.tsx`: layouts, pending, failed, visible errors;
  - `ReviewForm.test.tsx`: save, confirm, attention ARIA, the invalid path, tables landing;
  - `PayslipReview.test.tsx`: linking and the disclosure;
  - `SessionPage.test.tsx`: the dirty guard;
  - `client.test.ts`;
  - `statusCopy.test.ts`: warnings copy.

### Integration Tests

- **Hosted Supabase (`npm run test:integration`):**
  - PATCH: value, edited, warnings, revert;
  - the table removal;
  - `tables_pending`, `edit_not_allowed` and strict-body refusals;
  - confirm: pending refusal, success and idempotency;
  - edit after confirm;
  - cross-user 404s for both routes;
  - the loosened direct-write cap tests.
- **After step P:** `direct-writes.integration.ts`. No Docker anywhere.

### Edge Cases

- A PATCH that sets a value back to the original (edited clears).
- A wrapped `naziv` untouched through a scalar save (its line break kept, not edited).
- A table edit while pending (`409`, from both the route and the function).
- Tables landing between the route's read and the write (the function refuses; the route re-reads
  and answers `409 tables_pending`).
- A removed trailing row with an `unparseable_amount` signal (no phantom warning).
- `period` at 0.1 confidence (no low-confidence mark); `paymentDate` at 0.3 and ungroundable
  (marked).
- A confirmed payslip edited (stays confirmed); confirm twice (same `confirmedAt`).
- Tables failed (notice, manual rows, confirm allowed).
- An amount typed as `1.234` (visible error, no request) or `1.234,56` (saved as `1234.56`).
- A language switch with one dirty field (that field keeps the typed text; the others re-format).
- A region click for a row that an unsaved removal shifted: it focuses the input now at that index.
  This is known and accepted (see NOTES).

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck` · `npm run lint` · `npm run format:check`

### Level 2: Unit Tests

`npm run test` (or `npm run validate` for Levels 1–2)

### Level 3: Integration Tests

- `npm run test:integration` (hosted);
- then the `validate.md` Phase 8 orphan query via `mcp__supabase__execute_sql`;
- `mcp__supabase__list_migrations`;
- `mcp__supabase__get_advisors` (security).

### Level 4: Manual Validation

None in this session. Journey 9.8 and step P belong to later sessions (D22).

### Level 5: Additional Validation

- `npm run score:extraction` (step 6, free, offline);
- `npm run build`;
- the lockfile diff, the vocabulary grep and validate 6.23/6.24 (step 24).

---

## ACCEPTANCE CRITERIA

- [ ] Every canonical field, including all three tables, is visible and editable on the session
      page for a `review` or `confirmed` payslip, with add and remove rows.
- [ ] Focusing any field sets its outline active and pans to it, switching PDF page when needed. At
      `lg`, clicking an outline focuses its input; on a phone, the popover's Edit does. Escape
      closes the popover. (On a phone the preview may be scrolled away; Task 10 adds the strip,
      per D11.)
- [ ] Saving an edit stores it, marks the path (scalar or cell) edited, dashes its outline, drops
      its machine signals, and recomputes warnings. Typing the original back clears the mark.
- [ ] A payslip with a missing critical field saves and confirms.
- [ ] A line-item format error is visible in both layouts, focused, and never silently blocks
      Save.
- [ ] Confirm is refused while dirty (client) and while tables are pending (client, route and
      function), and is idempotent.
- [ ] PATCH with table keys while pending → `409 tables_pending`; outside `review`/`confirmed` →
      `409 edit_not_allowed`; another user's → 404.
- [ ] Every payslip write in `api/src` goes through an RPC. Migration 1 is applied and recorded once.
      Migration 2 is written, unapplied, with step P documented.
- [ ] The harness's "wrong scalars flagged" is unchanged in every set after D7.
- [ ] Attention uses amber, an icon and a visible note, with no `aria-invalid`. Format errors use
      `aria-invalid`. The nine warning codes have hr/en copy, guarded.
- [ ] Unsaved edits prompt before switching payslips and before unload.
- [ ] Every new control ≥ 48 px. No new dependency.
- [ ] `npm run validate`, the build and the hosted integration suite are green. PRD, ROADMAP,
      CONTEXT and `validate.md` are updated; the history file is written; nothing is committed.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–24 completed in order, each validation passing
- [ ] Paid spend $0
- [ ] Migration 1 applied after a dry run; migration 2 not applied
- [ ] Full unit and hosted integration suites green
- [ ] No lint or type errors
- [ ] History file includes the D7 table and the review-session handoff
- [ ] Stopped before `/code-review`, `/validate`, browser work, migration 2 and commit

---

## NOTES

- **Why re-map rather than store an original (D4):** the raw response is already retained verbatim
  for exactly this kind of read-time projection (ADR-0001 consequences). A stored copy would need
  a migration, a change to the pass write, and a backfill for payslips that exist.
- **Why the PATCH reads the raw column:** it reads it once, for one payslip, on an explicit user
  action. The 6.23 rule exists to keep megabytes out of polls, and PATCH is not polled. The read
  stays in the one repository method.
- **Race accepted:** two tabs PATCHing the same payslip concurrently each compute `edited_fields`
  from their own read. Last write wins for both the values and the marks. Disjoint keys are merged
  by `||`. A demo has one user per payslip.
- **Known limitation (edge cases):** while a table has an **unsaved** row removal, the outlines
  still carry saved indices, so clicking one focuses the input now at that index. After Save, the
  shifted rows are edited (D5) and dashed, which tells the user the outlines no longer line up.
- **Risk — `security definer` breadth:** a missing `auth.uid()` filter in any function is a
  cross-user write that RLS will not catch. 6.24 checks the text; the hosted cross-user tests check
  the behaviour. Review both.
- **Risk — RHF `values` + `keepDirtyValues`:** if the tables-landing test (step 20) shows dirty
  scalars lost, fall back to `resetField` on the three table names only. Do not debounce or poll
  the form.
- **Out of scope:**
  - the chip rail, page thumbnails, the keyboard strip and draft preservation (Task 10);
  - merge (11);
  - export (12);
  - the D01 inside-region check (D15);
  - a tables-only retry (D8).

**Confidence: 7/10** for one-pass execution. Each part is well-evidenced, but the task is wide.
The riskiest pieces are the nine-function migration (ownership filters), RHF's merge of landed
tables into a dirty form, and the client plumbing between form, panel and session page.
