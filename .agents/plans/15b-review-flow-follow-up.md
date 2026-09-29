# Feature: Task 15b — Review-flow follow-up

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md`](../ROADMAP.md): a follow-up **within Task 15** (the product
owner: "no new task, an iteration on Task 15"), numbered 15b after the 01b precedent. Its record is
a new section appended to [`history/15`](../history/15-review-flow-iteration.md). Locked decisions
4 (merge is a non-dragging action with an automatic suggestion and a manual path) and 5 (merge
re-extracts over a combined PDF) still hold: this changes how many payslips one merge takes, not
what a merge is · **PRD:** §4.6, §7.6, §7.7, §7.8, §10.11 · **Previous plan:**
[`plans/15`](./15-review-flow-iteration.md) D4 (Merge button), D6 (sidebar), D9 (sections) ·
**Merge origin:** [`plans/11`](./11-merge-payslips.md), [`history/11`](../history/11-merge-payslips.md)
· **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) (Merge, Merge suggestion) · **Rules:**
[`AGENTS.md`](../../AGENTS.md).

**Starting state:** Task 15 is implemented, reviewed and validated but **not committed**. This
work lands on top of that uncommitted diff (last commit `dab77c2`); do not commit or stash it.

## Feature Description

Four points from the product owner's check of Task 15 (2026-09-29):

1. **The sidebar toggle does not look standard.** Replace the `«`/`»` chevrons with the
   panel icon used by shadcn/ui's Sidebar, VS Code, ChatGPT and Claude, fixed in the icon column.
2. **The Merge button's label is long.** "Merge" at every width, with the tooltip "Merge with
   another payslip".
3. **Merging is pairwise.** A three-page payslip photographed as three files needs two merges, and
   the second has to wait for the first merged payslip to finish extracting. Allow two or more
   payslips in one merge, and suggest them as one group.
4. **Section open state follows the user between payslips.** Opening another payslip must start
   from the defaults: scalar sections open, the three tables closed.

## User Story

As someone reviewing a session of scanned payslips
I want a familiar sidebar toggle, a short Merge button, one merge for all the photos of one payslip,
and every payslip opening in the same default layout
So that the screen reads as standard and multi-page payslips take one step, not several.

## Problem Statement

File references are to the working tree (Task 15 uncommitted on `dab77c2`).

1. **Sidebar toggle** (`client/src/components/AppLayout.tsx:80-95`): `ChevronsLeft`/`ChevronsRight`
   in a 48 px square, right-aligned while expanded and centred while collapsed, so it **jumps**
   between states and does not line up with the nav icons below it. Neither shadcn/ui nor
   Material 3 uses double chevrons: shadcn/ui's `SidebarTrigger` is a `PanelLeftIcon`, and
   Material 3's expanded rail opens from a menu icon that changes when expanded.
2. **Merge label** (`client/src/routes/SessionPage.tsx:452-462`): two spans, `merge.mergeShort`
   ("Merge…") below `lg` and `merge.mergeWith` ("Merge with another payslip…") at `lg`.
3. **Merge takes exactly two**, at every layer:
   - `shared/src/api.ts:185-202`: `payslipIds` and `order` are `z.tuple([uuid, uuid])`;
   - `shared/src/session.ts:103-116`: `mergeSuggestions` returns pairs; `:134-136`
     `mergedFilename(first, second)`;
   - `shared/src/api.ts:122`: `mergeSuggestions: z.array(z.tuple([uuid, uuid]))`;
   - `api/src/routes/sessions.ts:136-190`: destructures `[first, second]`;
   - `api/src/repositories/payslips.ts:111-118`: `order: readonly [string, string]`;
   - `supabase/migrations/20260926140159_merge_payslips.sql`: `cardinality(p_order) <> 2` and
     `v_count <> 2` both return false;
   - `client/src/session/MergeDialog.tsx`: radio pick step, a single Swap button, `Pair` type;
   - `client/src/session/MergeSuggestions.tsx`, `dismissedSuggestions.ts`: one banner per pair,
     keys `${a}:${b}`;
   - `client/src/routes/SessionPage.tsx:88`, `:93-96`, `:206-243`: pair-typed state and handler.

   `combineSources` (`api/src/services/payslip-merge.ts:46-57`) already takes any number of
   sources. The cost of pairwise for three files: the first merged payslip is `processing`, which
   `isMergeable` refuses, so the second merge waits one full extraction (15–55 s measured), and that
   intermediate extraction is paid and discarded (~$0.04–0.05, history/05). With pair suggestions,
   three files of one payslip raise three banners (ROADMAP §5, "Three suggestion pairs").
4. **Sections** (`client/src/review/openSections.ts`): `useOpenSections` reads and writes
   `sessionStorage` under `payslip-ocr:open-sections`, so one payslip's toggles carry into the
   next. This was plan 15 D9's deliberate choice; the product owner has now reversed it.
   `PayslipReview` is mounted with `key={selected.id}` (`SessionPage.tsx:472-477`), so plain
   component state already starts fresh for each payslip opened and survives the tables pass
   landing (the key does not change then).

## Solution Statement

- Sidebar: `PanelLeftClose` / `PanelLeftOpen`, sized and padded like a nav link so its icon sits
  exactly above the nav icons in both states, with a `title` tooltip.
- Merge button: one label, `merge.mergeShort` = "Merge", and `title={t("merge.mergeWith")}`.
- Multi-merge end to end: arrays in the request, a grouped suggestion, a `create or replace` of
  `merge_payslips` that accepts two or more ids, a checkbox pick step and Move up / Move down in the
  confirm step.
- Sections: `useOpenSections` becomes in-memory state starting at `DEFAULT_OPEN`.

## Feature Metadata

**Feature Type**: Enhancement (+ a behaviour reversal for sections)
**Estimated Complexity**: Medium. Items 1, 2 and 4 are small; item 3 touches shared, API, one
migration and the client dialog.
**Primary Systems Affected**: `shared/src/{api,session}.ts`, `api/src/routes/sessions.ts`,
`api/src/repositories/payslips.ts`, one new migration, `client/src/session/*`,
`client/src/routes/SessionPage.tsx`, `client/src/components/AppLayout.tsx`,
`client/src/review/openSections.ts`, locales, docs
**Dependencies**: none new. `lucide-react` ^1.32 (`PanelLeftClose`, `PanelLeftOpen`, `ArrowUp`,
`ArrowDown` all exported, checked), i18next 26 (built-in `list` formatter, checked in
`node_modules/i18next/dist/esm/i18next.js:1392`), Supabase MCP for the migration.

---

## DESIGN DECISIONS

"PO" marks the product owner's answer (message and questions of 2026-09-29); "planner" marks a
planning choice.

### D1 — Same session split, $0 (standing rule)

The implementing session runs the ordinary checks (tests, typecheck, lint, format, build,
`check:secrets`, `test:integration`, the migration dry run) and appends its record to history/15,
then **stops**: no `/code-review`, no `/validate`, no browser journey, no commit. **Paid runs: none**
(the integration suite records extraction jobs instead of running them, `payslips.integration.ts:951`).

### D2 — The panel-icon sidebar toggle (PO)

- Icons: `PanelLeftClose` while expanded, `PanelLeftOpen` while collapsed (lucide). Researched
  standard: shadcn/ui `SidebarTrigger` (`PanelLeftIcon`), used the same way in VS Code, ChatGPT and
  Claude. The product owner chose it over a header hamburger and an Atlassian-style edge button.
- **Position never moves**: the toggle is a nav-link-shaped button, so its icon is in the same
  column as the Scan and Payslips icons in both states:
  - expanded: `w-12 px-3` (48 px), left-aligned. With the nav's `p-3`, the icon's centre is 34 px
    from the nav's left edge, the same as a link's (`p-3` + `px-3` + half of `size-5`);
  - collapsed: `w-full justify-center` (51 px inside `w-18 px-2.5`), the same centring as a
    collapsed link.
  - Wrapper: `mb-1 flex` with no `justify-*` switch (today's `justify-end` / `justify-center`
    is what makes it jump).
- Classes otherwise as today: `min-h-12 rounded-lg text-slate-600 hover:bg-slate-100
  hover:text-slate-900`, `inline-flex items-center`.
- `title` equal to the `aria-label` (`common.collapseMenu` / `common.expandMenu`), the same native
  tooltip the collapsed links use (`NavItems.tsx:34`). `aria-expanded`, `aria-controls`,
  `localStorage` persistence and widths unchanged.
- Not added: a keyboard shortcut (shadcn's Ctrl+B), a hover rail. Not asked for.

### D3 — "Merge", with a tooltip (PO)

- One label at every width: `merge.mergeShort`, changed to **"Merge"** / **"Spojite"** (no
  ellipsis, as the PO wrote it). The two spans become one text node.
- `title={t("merge.mergeWith")}`, changed to **"Merge with another payslip"** / **"Spojite s drugom
  platnom listom"** (no ellipsis). The accessible name is "Merge"; the title becomes its
  description.
- `merge.pickTitle` keeps its own key (D6 changes its text).
- Planner note, not acted on: with multi-merge, "Merge with other payslips" would be more exact.
  The PO's wording is kept; the implementing session mentions it in the record.

### D4 — Two or more payslips per merge (PO)

- **Contract** (`shared/src/api.ts`): `payslipIds` and `order` become
  `z.array(z.uuid()).min(2).max(MAX_PAYSLIPS_PER_SESSION)` (import from `./upload.js`; 10). Refines:
  `payslipIds` distinct (message kept: "A payslip cannot be merged with itself"); `order` has the
  same length, is distinct, and names only ids in `payslipIds` (message: "order must list the
  payslips being merged"). The request stays `.strict()`. The JSON of a two-payslip request is
  unchanged, so the deployed client keeps working against the new API and vice versa.
- **`mergedFilename(names: readonly string[])`**: `names.join(" + ").slice(0, 255)`.
- **Route** (`api/src/routes/sessions.ts:136-190`): `originals = order.map(find)`; `409
  merge_not_allowed` if any is missing or not `isMergeable`; download every source in `order`;
  `mergedFilename(originals.map((o) => o.originalFilename))`; log `mergedFrom: order`. The caps
  (`MAX_PDF_PAGES` 10, `MAX_UPLOAD_BYTES` 10 MB) already apply to the combined PDF and so bound the
  group.
- **Repository**: `MergePayslipsInput.order: readonly string[]`; doc comment "both originals" →
  "the originals".
- **Migration** (D5).
- **No client-side page-count check**: the server's `422 pdf_too_many_pages` and its existing
  copy ("Together these documents have more than 10 pages…") already cover it.

### D5 — `merge_payslips` accepts two or more (planner)

A new migration, `create or replace function public.merge_payslips(...)` with the **same
signature** (so `api/src/database.types.ts` does not change, and `create or replace` keeps the
existing `revoke`/`grant`; restate them anyway, idempotently, as the Task 11 file does). Changes
from `20260926140159_merge_payslips.sql`:

```sql
  if coalesce(cardinality(p_order), 0) < 2
     or cardinality(p_order) <> (select count(distinct id) from unnest(p_order) as id) then
    return false;
  end if;
  ...
  if v_count <> cardinality(p_order) then
    return false;
  end if;
```

- `coalesce`: `cardinality(null)` is null, and a null condition would fall through to the insert.
- `count(distinct …)` ignores nulls, so a null element also returns false.
- Everything else verbatim: the id-ordered `for update`, the soft delete, the insert with
  `merged_from = p_order` and `min(created_at)`.
- Header comment: Task 15b; "a merge replaces two or more payslips"; the rest of the Task 11
  comment kept.
- **Backward compatible**: a two-id call behaves exactly as before, so applying it to the hosted
  project before this API deploys is safe. Apply it in this session, as Task 11 did: a
  transactional dry run through `execute_sql` (`begin; …; rollback;`), then `apply_migration`, then
  rename the local file to the recorded version (history/11 lines 115-116).

### D6 — The dialog: checkboxes, then an ordered list (planner, from PO "select and merge multiple")

- Props: `pair` → `group: readonly string[] | null` (`null` = pick step); `onMerged(id,
  originals: readonly string[])`. The `Pair` type goes.
- **Pick step**: checkboxes (`type="checkbox"`, `name="merge-with"`) over the same candidates
  (every other mergeable payslip), state `chosen: ReadonlySet<string>`. Continue is
  `aria-disabled` until at least one is checked, and then sets `order` to `[selectedId, ...chosen]`
  in list order. Copy: `merge.pickTitle` "Merge with other payslips" / "Spojite s drugim platnim
  listama"; `merge.pickLegend` "Which payslips hold the other pages of this one?" / "Koje platne
  liste sadrže ostale stranice ove?".
- **Confirm step**: the ordered list as today (thumbnail, page position, filename, page count),
  starting in list (upload) order. **Swap is replaced by Move up / Move down** on each card: two
  48 px icon buttons (`ArrowUp`, `ArrowDown`), `aria-label` `merge.moveUp` / `merge.moveDown` with
  `{{name}}`, `aria-disabled` at the ends and while busy. WCAG 2.2 SC 2.5.7's single-pointer
  alternative to drag, as locked decision 4 requires. For two documents they do what Swap did.
- **Page positions**: `pagesOf` becomes cumulative over the preceding documents' `pageCount`.
- **Focus after a move**: React moves the card's DOM node, which can blur the pressed button. After
  each move, focus the same button of the moved card again (by id: `merge-move-{up|down}-${id}`),
  even when it has just become `aria-disabled` at an end (it stays focusable).
- **Announcement**: the `role="status"` line says `merge.moved` "{{name}} is now at position
  {{position}}." / "{{name}} je sada na mjestu {{position}}." `merge.swap` and `merge.swapped` are
  removed.
- `merge()` sends `payslipIds` in list order and `order` as shown.

### D7 — Grouped suggestions (PO)

`mergeSuggestions` returns `string[][]`: groups of two or more ids that look like pages of one
payslip, members in list order, groups ordered by their first member. The pair rule (same period;
same employee OIB, or the same employer OIB when an employee OIB is unread) is not transitive, so
groups are **not** connected components: a payslip with no employee OIB can bridge two employees
of one employer. The rule, among the same candidates as today (`review`/`confirmed` and settled),
with a known period:

1. Payslips with a known employee OIB group by `(period, employeeOib)`.
2. A payslip with an unread employee OIB and a known employer OIB joins the group from step 1, of
   the same period, that has a member with the same employer OIB, **when there is exactly one**
   such group. With none, it groups with the other unattached payslips of the same `(period,
   employerOib)`. With more than one, it is ambiguous and joins no group (the manual Merge still
   covers it).
3. Groups of one are dropped.

This keeps every existing truth-table answer for two payslips (`session.test.ts:111-187`), and for
three it gives `[["a","b","c"]]` instead of three pairs.

- **Schema**: `mergeSuggestions: z.array(z.array(z.uuid()).min(2)).default([])`.
- **Dismissal keys**: `suggestionKey(ids: readonly string[])` = `ids.join(":")`. A group that grows
  (a third payslip finishes extracting) has a new key, so its banner returns with the new member;
  that is intended.
- **Banner**: `merge.suggestion` becomes `"{{names, list}} look like pages of one payslip."` /
  `"{{names, list}} izgledaju kao stranice jedne platne liste."`, with `names` the `shortName`s.
  i18next's built-in `list` formatter uses `Intl.ListFormat` in the UI language ("a.jpg, b.jpg,
  and c.jpg"; "a.jpg, b.jpg i c.jpg"; two names: "a.jpg and b.jpg", "a.jpg i b.jpg").
- A group is shown only when every member is still listed (today's stale-pair rule, per member).
- Review merge opens the dialog at its confirm step with the whole group.

### D8 — Section state is per payslip opening (PO, reverses plan 15 D9's tab storage)

- `useOpenSections` keeps `DEFAULT_OPEN` and the `setOpen` / `openAll` API, with plain
  `useState(DEFAULT_OPEN)`: no `sessionStorage`, no `read`, no `KEY`, no effect.
- Every payslip opened (a chip, a suggestion's merged result, a History link, a reload) starts at
  the defaults: employer, employee, period and reconciliation open; `payComponents`, `obustave`,
  `neoporeziviPrimici` closed. The PO's "everything expanded except the larger sections" is exactly
  `DEFAULT_OPEN`; the defaults do not change.
- Toggles last while that payslip stays open, including when its tables pass lands (same mount).
  Leaving and returning resets them.
- The auto-open rules (region click, popover Edit, failed save) are unchanged.
- A stale `payslip-ocr:open-sections` entry in a tab's `sessionStorage` is simply never read again;
  no cleanup code.

### D9 — Docs (planner)

- **PRD**: §4.6 (line 131) "beyond the swap offered at merge time" → "beyond the order chosen at
  merge time"; §7.6 sidebar bullet (line 543): the panel toggle; §7.7 (line 568): replace "The open
  state is kept for the browser tab." with "Every payslip opens with these defaults."; §7.8: two or
  more payslips, groups, the pick checkboxes, Move up / Move down, the filename rule "all filenames
  in page order"; §10.11: body `{payslipIds: string[], order: string[]}` (2–10 distinct ids) and
  "if any payslip…".
- **CONTEXT.md**: Merge "Replacing two Payslips…" → "two or more Payslips"; Merge suggestion
  "…that two Payslips…" → "…that several Payslips…".
- **ROADMAP**: §1 Deliberately deferred "Page reordering beyond the swap offered at merge time" →
  "…beyond the order chosen at merge time"; §2 Task 15 line gains "follow-up 15b: plan →
  `plans/15b-…`"; §5 "Three suggestion pairs" row → **Closed (Task 15b)**, one group and one banner.
- **`.claude/commands/validate.md`** (git-ignored): journey 9.14 step 1 (the Merge label and
  tooltip; a three-way merge), step 4 (the panel icon stays in the icon column), step 7 ("the open
  state carried into A02" becomes "A02 opens at the defaults"); 9.10's swap wording → Move up /
  Move down.
- **history/15**: a `## Follow-up 15b (2026-09-29)` section, same shape as the Task 15 record.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ THESE BEFORE IMPLEMENTING

- `AGENTS.md` §8 — conventions (`.js` extensions in `api`/`shared`, en + hr pairs, oxlint).
- `client/src/components/AppLayout.tsx` (lines 72-99) — the sidebar and toggle to change.
- `client/src/components/NavItems.tsx` (lines 26-47) — the link classes the toggle must line up
  with (`px-3` expanded, `justify-center px-0` collapsed) and the `title` tooltip pattern.
- `client/src/components/AppLayout.test.tsx` — existing sidebar tests (names by `aria-label`).
- `client/src/routes/SessionPage.tsx` (lines 86-96 state, 206-253 `openMerge` / `merged` /
  `lastMerge`, 413-419 `MergeSuggestions`, 450-463 Merge button, 547-558 `MergeDialog`).
- `client/src/routes/SessionPage.test.tsx` (lines 40-60 the dialog mock, 147 `mergeButton`, 705-800
  merge tests, 831 single-view suggestion fixture).
- `client/src/session/MergeDialog.tsx` (all) and `MergeDialog.test.tsx` (lines 44-92 harness, 94-195
  tests).
- `client/src/session/MergeSuggestions.tsx`, `MergeSuggestions.test.tsx`,
  `dismissedSuggestions.ts`, `dismissedSuggestions.test.ts`.
- `client/src/review/openSections.ts`, `openSections.test.ts`; `PayslipReview.tsx` (line 58, 86-97
  the only consumer); `PayslipReview.test.tsx` (line 119 `sessionStorage.clear()`).
- `client/src/i18n/locales/en.json` (lines 256-283 `merge`), `hr.json` (lines 262-290);
  `client/src/i18n/i18n.test.ts` (key parity, plural categories); `mergeErrors.test.ts`.
- `shared/src/api.ts` (lines 120-123 session detail, 180-222 merge); `shared/src/api.test.ts`
  (lines 165-195).
- `shared/src/session.ts` (lines 80-137); `shared/src/session.test.ts` (lines 111-197).
- `shared/src/upload.ts:41` — `MAX_PAYSLIPS_PER_SESSION`.
- `api/src/routes/sessions.ts` (lines 114-205 merge route, 239 suggestions).
- `api/src/repositories/payslips.ts` (lines 111-118, 377-392).
- `api/src/routes/payslips.integration.ts` (lines 950-1110 the merge block; `merge()` helper at
  1012 already takes `string[]`).
- `api/src/routes/direct-writes.integration.ts` — the pattern for calling an RPC as the signed-in
  user.
- `api/src/services/payslip-merge.test.ts` — `combineSources` tests (already N-ary).
- `supabase/migrations/20260926140159_merge_payslips.sql` — copy it into the new migration.
- `.agents/history/11-merge-payslips.md` (lines 110-120) — the dry run and `apply_migration`
  procedure, and renaming the local file to the recorded version.

### New Files to Create

- `supabase/migrations/<version>_merge_several_payslips.sql` — D5. Name it with a provisional UTC
  timestamp; rename to the version `apply_migration` records.

### Relevant Documentation

- [shadcn/ui Sidebar](https://ui.shadcn.com/docs/components/sidebar) — `SidebarTrigger` uses
  `PanelLeftIcon`; `collapsible="icon"` collapses to icons. Why: the standard D2 follows.
- [Material 3 navigation rail](https://m3.material.io/components/navigation-rail/guidelines) — an
  expanded rail opens from a menu icon that changes to show it can collapse. Why: corroborates a
  state-changing icon in a fixed spot.
- [i18next formatting: list](https://www.i18next.com/translation-function/formatting#list) —
  `{{val, list}}` over `Intl.ListFormat`. Why: D7's banner copy.
- [WCAG 2.2 SC 2.5.7 Dragging Movements](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)
  — Why: Move up / Move down is the single-pointer alternative to reordering by drag.
- [PostgreSQL array functions](https://www.postgresql.org/docs/current/functions-array.html) —
  `cardinality` returns null for a null array; `unnest`. Why: D5's guards.

### Patterns to Follow

- **Native tooltip**: `title={collapsed ? t(labelKey) : undefined}` (`NavItems.tsx:34`).
- **Busy controls stay focusable**: `aria-disabled={busy}` plus an early `return` in the handler,
  never `disabled` (`MergeDialog.tsx:148-160`, Task 07).
- **Screen-reader status**: `<p role="status" className="sr-only">` (`MergeDialog.tsx:175-177`).
- **i18n**: formal "vi" imperatives in `hr` (Task 14 D5); no hardcoded strings; `en`/`hr` parity is
  tested.
- **Definer functions**: `security definer`, `set search_path = ''`, every statement filtered by
  `user_id = (select auth.uid())`, `revoke … from public, anon; grant … to authenticated`.
- **Comments cite the decision**: `// Task 15b D7: …`, matching the codebase's `Task NN Dn` style.
- **Tests**: Vitest + Testing Library; queries by role and accessible name; red first, or a
  bite-check noted in the record when written after.

---

## IMPLEMENTATION PLAN

- **Phase 1 — Client-only items** (D2, D3, D8): independent, smallest first.
- **Phase 2 — Shared contract** (D4, D7): schema, `mergedFilename`, grouped `mergeSuggestions`.
- **Phase 3 — Database and API** (D5, D4): migration dry run and apply, repository, route,
  integration tests.
- **Phase 4 — Client merge** (D6, D7): dialog, suggestions, dismissal keys, `SessionPage` wiring,
  copy.
- **Phase 5 — Docs and record** (D9).

---

## STEP-BY-STEP TASKS

Execute in order. After each step, run its VALIDATE command.

### 1. CHECK the starting state

- **IMPLEMENT**: `git status --short` shows Task 15's uncommitted diff plus this plan. `npm run
  validate` is green at the baseline (history/15: 76 files / 1,178 tests). Record both.
- **VALIDATE**: `npm run validate`

### 2. UPDATE `client/src/components/AppLayout.tsx` — D2

- **IMPLEMENT**: import `PanelLeftClose, PanelLeftOpen` instead of `ChevronsLeft, ChevronsRight`.
  Wrapper `<div className="mb-1 flex">`. Button classes:
  `` `inline-flex min-h-12 items-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 ${collapsed ? "w-full justify-center" : "w-12 px-3"}` ``.
  Add `title={label}` with `const label = t(collapsed ? "common.expandMenu" : "common.collapseMenu")`
  used for both `aria-label` and `title`. Update the comment to cite Task 15b D2 (the icon stays in
  the nav icons' column).
- **TEST** (`AppLayout.test.tsx`): the toggle's `title` equals its accessible name in both states.
  jsdom has no layout, so the alignment is checked in the browser (journey 9.14 step 4).
- **GOTCHA**: keep `aria-expanded`, `aria-controls="sidebar-nav-list"` and the storage code as is.
- **VALIDATE**: `npx vitest run client/src/components/AppLayout.test.tsx`

### 3. UPDATE the Merge button — D3

- **IMPLEMENT**: `SessionPage.tsx:452-462`: one text node `{t("merge.mergeShort")}` and
  `title={t("merge.mergeWith")}`. Locales: `merge.mergeShort` "Merge" / "Spojite";
  `merge.mergeWith` "Merge with another payslip" / "Spojite s drugom platnom listom".
- **TEST** (`SessionPage.test.tsx`): `mergeButton` queries `{ name: "Merge" }`; assert its `title`
  is "Merge with another payslip". Existing Task 15 D4 tests keep passing.
- **GOTCHA**: `grep -rn "mergeWith\|mergeShort" client/src` first; every use must still make sense.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx client/src/i18n`

### 4. UPDATE `client/src/review/openSections.ts` — D8

- **IMPLEMENT**: `useOpenSections` = `useState<Record<Section, boolean>>(() => ({ ...DEFAULT_OPEN }))`
  with the same `setOpen` / `openAll`. Remove `KEY`, `read`, the effect and the `useEffect` import.
  Doc comment: per payslip opening (Task 15b D8, reversing Task 15 D9's tab storage).
- **TEST** (`openSections.test.ts`): replace "keeps a change across a remount" with "starts from
  the defaults on every mount" (toggle, unmount, remount → `DEFAULT_OPEN`); remove the storage
  tests ("ignores unknown sections…", "falls back… on corrupt or throwing storage") and the
  `sessionStorage.clear()` / `vi` setup they needed. Add to `PayslipReview.test.tsx`: open
  `obustave` on one payslip, re-render with a different `payslipId` **and key** (as `SessionPage`
  mounts it), and the Obustave header reads `aria-expanded="false"`. Remove
  `PayslipReview.test.tsx`'s `sessionStorage.clear()` only if nothing else there needs it.
- **VALIDATE**: `npx vitest run client/src/review`

### 5. UPDATE `shared/src/session.ts` + test — D7, D4

- **IMPLEMENT**: `mergeSuggestions(payslips): string[][]` by D7's three steps (a `Map` keyed
  `${period}\u0000${oib}`; the unread-employee pass after all known groups exist). Keep `known()`
  and the candidate filter. Doc comment states the rule and why it is not transitive closure.
  `mergedFilename(names: readonly string[]): string`.
- **TEST** (`session.test.ts`): the two-payslip cases now expect `[["a","b"]]` or `[]` as before;
  "returns every matching pair" → `[["a","b","c"]]`; new: two employees of one employer in one
  period with a third unread-OIB payslip → `[]` (ambiguous, a and b different employees); one
  employee's two payslips plus an unread-OIB payslip of the same employer → `[["a","b","c"]]`; two
  unread-OIB payslips of one employer with no known group → one group; two periods → two groups,
  ordered by first member; `mergedFilename(["a","b","c"])` → "a + b + c", 255 cap with three long
  names.
- **VALIDATE**: `npx vitest run shared/src/session.test.ts`

### 6. UPDATE `shared/src/api.ts` + test — D4, D7

- **IMPLEMENT**: D4's request schema; `mergeSuggestions: z.array(z.array(z.uuid()).min(2)).default([])`.
  Update the doc comment (`order` is the page order; two or more of the session's payslips).
- **TEST** (`api.test.ts:165-195`): accept three ids in any order; reject one id, eleven ids, a
  repeated id in either array, an `order` shorter or longer than `payslipIds`, an `order` naming
  another id, an extra key. `sessionDetailResponseSchema` accepts a group of three and rejects a
  group of one.
- **VALIDATE**: `npx vitest run shared && npm run typecheck` (the typecheck lists every pair-typed
  caller in `api` and `client`; fix them in steps 8–12).

### 7. CREATE the migration and apply it — D5

- **IMPLEMENT**: `supabase/migrations/<UTC timestamp>_merge_several_payslips.sql` per D5.
- **Dry run** (Supabase MCP `execute_sql`): `begin;` + the file + a check that
  `pg_get_functiondef('public.merge_payslips(uuid,uuid,uuid[],text,integer)'::regprocedure)`
  contains `cardinality(p_order) <>` + `rollback;`. Then `apply_migration` with name
  `merge_several_payslips`; `list_migrations` shows it once; rename the local file to the recorded
  version; `get_advisors` (security) shows nothing new beyond the known definer findings.
- **GOTCHA**: MCP `execute_sql` may not return the rolled-back check's rows; if so, run the check
  after `apply_migration` instead. Never leave the function half-replaced.
- **VALIDATE**: `npx supabase db lint --local` is optional (needs Docker; skip, per the standing
  no-Docker preference). The integration run in step 9 is the proof.

### 8. UPDATE `api/src/repositories/payslips.ts` and `api/src/routes/sessions.ts` — D4

- **IMPLEMENT**: `order: readonly string[]`; the route as D4 describes. Keep the order of checks:
  schema → session → listed and mergeable → download → combine → caps → upload → RPC.
- **VALIDATE**: `npm run typecheck`

### 9. ADD integration tests — `api/src/routes/payslips.integration.ts`

- **IMPLEMENT** in the merge `describe`, mirroring the existing two-payslip test:
  - three payslips (PDF, PNG, PDF) merge in a chosen order: `202`; the recorded job's PDF has the
    summed page count; the session lists one payslip in the earliest original's place;
    `merged_from` equals the order; its filename is the three names joined by " + ";
  - a group containing a still-`processing` payslip is `409 merge_not_allowed` and nothing changes;
  - `rpc("merge_payslips")` as user A (the `direct-writes.integration.ts` pattern) with one id, with
    a repeated id, and with a null array returns `false` and inserts nothing.
- **VALIDATE**: `npm run test:integration` (hosted, $0)

### 10. UPDATE `client/src/session/dismissedSuggestions.ts` and `MergeSuggestions.tsx` — D7

- **IMPLEMENT**: `suggestionKey(ids: readonly string[])`; props `groups: readonly (readonly
  string[])[]`, `onReview(group)`; copy `t("merge.suggestion", { names: group.map(name) })`; the
  staleness check per member. Doc comments: one banner per group (Task 15b D7).
- **TEST**: a three-member group reads "a.jpg, b.jpg, and c.jpg look like pages of one payslip."
  in `en` and "a.jpg, b.jpg i c.jpg izgledaju…" in `hr`; a two-member group reads "a.jpg and
  b.jpg…"; a dismissed group stays hidden after a remount; a group with one unlisted member is
  hidden; `suggestionKey(["a","b","c"])` is `"a:b:c"`.
- **VALIDATE**: `npx vitest run client/src/session`

### 11. UPDATE `client/src/session/MergeDialog.tsx` + locales — D6

- **IMPLEMENT**: D6 in full. Remove `Pair`, `swapped`, the Swap button and `ArrowUpDown`. New keys:
  `merge.moveUp` "Move {{name}} up" / "Pomaknite {{name}} gore"; `merge.moveDown` "Move {{name}}
  down" / "Pomaknite {{name}} dolje"; `merge.moved` (D6). Changed: `merge.pickTitle`,
  `merge.pickLegend`, `merge.suggestion`. Removed: `merge.swap`, `merge.swapped`. Update the doc
  comment (two or more documents, Move up / Move down).
- **TEST** (`MergeDialog.test.tsx`, rewrite the swap test, keep the busy/cancel/Escape tests):
  - pick step: checkboxes over the mergeable others only; Continue `aria-disabled` with none
    checked; checking `b` and `c` shows the confirm list `a, b, c` in list order;
  - Move down on `a` gives `b, a, c`, announces "a.jpg is now at position 2.", and focus stays on
    `a`'s Move down button; Move up on the first card is `aria-disabled` and does nothing;
  - page positions: with `b` at 2 pages second, the cards read Page 1, Pages 2–3, Page 4;
  - Merge sends `payslipIds` in list order and `order` as shown, and calls `onMerged(id, order)`;
  - a `group` prop opens straight at the confirm step with all members.
- **GOTCHA**: `candidates` excludes `selectedId`; with a `group` from a suggestion, `selectedId`
  may not be in the group, and the pick step is never shown then.
- **VALIDATE**: `npx vitest run client/src/session client/src/i18n`

### 12. UPDATE `client/src/routes/SessionPage.tsx` + test — D6, D7

- **IMPLEMENT**: `merge` state `{ group: readonly string[] | null }`; `openMerge(group)`;
  `lastMerge.originals: readonly string[]`; `merged(id, originals)` builds the placeholder with
  `mergedFilename(originals.map(named))` and the summed page count (already generic);
  `<MergeSuggestions groups={detail?.mergeSuggestions ?? []} …>`; `<MergeDialog group={…}>`.
  Update the comments that say "pair".
- **TEST** (`SessionPage.test.tsx`): the dialog mock takes `group`; a three-member suggestion opens
  the dialog with `a,b,c`; `onMerged("merged", ["c","a","b"])` removes all three and selects
  `merged` in the earliest original's position; the unsaved edits of all three originals are
  cleared (`keep(id, null)` for each).
- **VALIDATE**: `npx vitest run client/src/routes`

### 13. UPDATE the docs — D9

- **IMPLEMENT**: PRD, CONTEXT, ROADMAP and `validate.md` as D9 lists.
- **GOTCHA**: history/15 notes that a Python text-mode write on Windows turned `PRD.md` into CRLF;
  write with `newline=""` or use the Edit tool, then check.
- **VALIDATE**: `git diff --check` and `grep -c $'\r' PRD.md CONTEXT.md .agents/ROADMAP.md` → 0.

### 14. RUN the full checks and write the record

- **IMPLEMENT**: the Validation Commands below, once each. Append `## Follow-up 15b (2026-09-29)`
  to `.agents/history/15-review-flow-iteration.md`: what was built (file tables), decisions
  D1–D9 as implemented, deviations, the migration's recorded version, the validation table, open
  items, and the review-session handoff (step list below). Then stop (D1).

---

## TESTING STRATEGY

### Unit Tests

- `shared`: grouping truth table (D7) and the request schema (D4) carry the logic; test them
  exhaustively, since the route and the UI trust them.
- `client`: behaviour by role and name, as in the existing files. The sidebar alignment and native
  tooltips are not testable in jsdom; the `title` attribute is.

### Integration Tests

- The hosted suite (`npm run test:integration`), $0: three-way merge, refusal, and the function's
  own guards called directly (step 9).

### Edge Cases

- A merge request with 1, 11, or repeated ids → `400 invalid_request`.
- The same guards at the SQL layer for a direct RPC call, including a null array.
- One member of a group already merged or deleted by another tab → `409 merge_not_allowed`, the
  list re-reads (`onRefused`), no orphaned storage object (`removeOrphan`, unchanged).
- A combined group over 10 pages → `422 pdf_too_many_pages` with the existing copy.
- An unread-employee-OIB payslip matching two employees' groups → no suggestion; the manual path
  remains.
- A group growing after a dismissal → shown again with its new member.
- Moving the first card up / the last card down → no change, button stays focusable.
- Tables pass landing while a section is toggled → the toggle stays (same mount).

---

## VALIDATION COMMANDS

Run each once, with purpose; do not re-run a passed check.

### Level 1: Syntax & Style

- `npm run typecheck`
- `npm run lint`
- `npm run format:check`

### Level 2: Unit Tests

- `npm run test` (expect the baseline 1,178 minus the removed storage and swap tests plus the new
  ones; record the numbers)

### Level 3: Integration Tests

- `npm run test:integration` (hosted Supabase, $0)

### Level 4: Build and static checks

- `npm run build`
- `npm run check:secrets`
- `git grep -n "ChevronsLeft\|ChevronsRight\|merge.swap\|open-sections\|ArrowUpDown" client/src` →
  none
- `git grep -n "\[string, string\]" shared/src api/src client/src` → only unrelated uses (review
  each hit)
- `git diff --check`; `package-lock.json` unchanged

### Level 5: Database (Supabase MCP)

- `list_migrations`: the eight local files match, the new one recorded once.
- `get_advisors` (security): only the known definer findings and leaked-password protection.

**Not in this session (D1):** `/code-review`, `/validate`, browser journeys, commit.

---

## ACCEPTANCE CRITERIA

- [ ] The sidebar toggle is `PanelLeftClose` / `PanelLeftOpen`, has a tooltip, and its icon sits in
      the nav icons' column in both states (browser-checked in the review session).
- [ ] The Merge button reads "Merge" at every width and has the tooltip "Merge with another
      payslip"; `hr` "Spojite" / "Spojite s drugom platnom listom".
- [ ] Two or more payslips merge in one request, in a user-chosen order, into one payslip with all
      pages, one re-extraction, and every original soft-deleted.
- [ ] A payslip photographed as three files raises one suggestion naming all three.
- [ ] The pick step allows several choices; the confirm step reorders with Move up / Move down, no
      drag.
- [ ] Opening any payslip shows the scalar sections open and the three tables closed, whatever was
      toggled on the previous one.
- [ ] A two-payslip merge request is byte-identical to before, and the migration is backward
      compatible with the deployed API.
- [ ] Typecheck, lint, format, unit and integration tests, build and `check:secrets` pass.
- [ ] PRD, CONTEXT, ROADMAP and `validate.md` match the behaviour; history/15 has the 15b section.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–14 done in order, each VALIDATE passed
- [ ] Migration applied once, local file renamed to its recorded version
- [ ] No `/code-review`, `/validate`, browser journey or commit in this session
- [ ] history/15 records the paid-run count (0) and the review handoff

---

## NOTES

**Review-session handoff** (for the history record):

1. `/code-review` against `dab77c2` (it now covers Task 15 and 15b together, as neither is
   committed), or against a scratch commit of Task 15 if the product owner wants 15b reviewed
   alone.
2. `/validate` with journey 9.14 as updated: the sidebar toggle's position in both states
   (measure the icon's x against the nav icons), the Merge tooltip, a three-file merge with a Move,
   one grouped banner, and A01 → A02 opening at the default sections. $0 is possible as in Task 15
   (an invalid extraction key; failed payslips merge).
3. Commit, subtree push and deploy on the product owner's go-ahead. The migration is already live
   and backward compatible, so the order of deploy against migration does not matter.

**Trade-offs taken:**

- **Groups are not transitive closure** (D7): a closure would chain two employees through one
  payslip with an unread OIB. The rule only ever joins payslips of one employee, and leaves an
  ambiguous one to the manual Merge.
- **Move buttons over drag**: locked decision 4 and SC 2.5.7; a drag handle could be added later
  on top, never instead.
- **`payslipIds` kept alongside `order`**: redundant with `order` once both are sets, but dropping
  it would change the two-payslip wire format for no user gain.
- **Section state is not remembered per payslip** (A → B → A resets A): the PO asked for "the
  default state reset for that payslip" on opening; remembering per payslip would be new state
  nobody asked for.
- The tooltip text follows the PO's wording, "another payslip", though a merge can now take
  several (D3).

**Confidence for one-pass success: 8/10.** The risks are the grouping rule's edge cases (covered by
the truth table), the focus-after-move behaviour in the dialog (tested), and the MCP dry run's
reporting (step 7's gotcha).
