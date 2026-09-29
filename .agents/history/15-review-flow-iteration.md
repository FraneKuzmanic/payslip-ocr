# 15 — Review-flow iteration

**Date:** 2026-09-28
**Plan:** [15-review-flow-iteration.md](../plans/15-review-flow-iteration.md)
**Outcome:** all fifteen issues from the product owner's testing are implemented and unit-tested,
client only:
- bugs: after a merge or a delete, no upload row comes back as "Processing" and the header counts
  only what exists (D2);
- navigation: Payslips links open a single view (D3); the desktop sidebar collapses (D6); no `+N`
  badge (D7);
- merge: a visible Merge button (D4), no warning paragraph (D5);
- viewer: a plain wheel zooms (D8); outlines sit 1.5 screen px outside the text and are thinner (D13);
- form: collapsible sections with the tables closed (D9, D10), "Edited" and "Discard changes"
  (D11), a text "+ Add row" (D14), stacked Save and Confirm on the phone (D12).

**Status: implemented, then reviewed and validated in a separate session (below); not committed.** Following plan 15 D1 and the
standing session split, this session did not run `/code-review`, `/validate` or any browser
journey, and did not commit. **Paid runs: 0, $0.** No API, shared, migration or dependency change.

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `client/src/components/DisclosureButton.tsx` (+ test) | The one disclosure: chevron, `aria-expanded`, `aria-controls`, 48 px (D10) |
| `client/src/review/openSections.ts` (+ test) | `DEFAULT_OPEN` and `useOpenSections`, kept in `sessionStorage` under `payslip-ocr:open-sections` (D9) |
| `.agents/history/15-review-flow-iteration.md` | This record |

| Modified file | Change |
| --- | --- |
| `client/src/upload/UploadBatchContext.ts`, `UploadBatchProvider.tsx` (+ test) | `listed` on `BatchItem`; `markListed`, which returns the previous map when nothing changes (D2) |
| `client/src/routes/SessionPage.tsx` (+ test) | `markListed` after every read and listed items excluded from `pending` (D2); the single view (D3); the Merge button, and a `⋮` menu of downloads only (D4) |
| `client/src/history/historyRow.ts` (+ test), `routes/HistoryPage.test.tsx` | `rowRoute` appends `&view=single` (D3) |
| `client/src/components/AppLayout.tsx`, `NavItems.tsx` (+ test) | Collapsible sidebar, `w-60` ↔ `w-18`, remembered in `localStorage` under `payslip-ocr:sidebar-collapsed`; `NavItems` `collapsed` prop (D6) |
| `client/src/review/PayslipRail.tsx` (+ test), `stripGeometry.ts` (+ test) | Badge, IntersectionObserver, `visible` state and `overflowAfter` removed (D7) |
| `client/src/session/MergeDialog.tsx` (+ test) | `merge.consequence` paragraph and its test removed; doc comment updated (D5) |
| `client/src/review/ZoomableSourceViewport.tsx` (+ test), `sourceZoom.ts` (+ test) | A plain wheel zooms at fit width; `panBy` and its tests removed, having lost their only caller (D8); `rendered` passed to the overlay (D13) |
| `client/src/review/SourceOverlay.tsx` (+ test), `SourceStrip.tsx` | `OUTLINE_GAP_PX = 1.5`, `padCorners`, the `rendered` prop; strokes 1 / 2 px, active fill 0.1 (D13) |
| `client/src/review/SectionLegend.tsx` | A disclosure header when given `onToggle`; `ToCheck`, the amber count (D9) |
| `client/src/review/fieldAttention.ts` (+ test) | `attentionCount` (D9) |
| `client/src/review/PayslipForm.tsx` (+ test) | Section bodies hidden when closed; failed-save auto-open in `onInvalid`; `id="review-form"` and `onReset` (D11); stacked buttons (D12) |
| `client/src/review/LineItemSection.tsx` (+ test) | One fieldset with a header and a hidden body for all three states; row count, pending and "N to check" in the header; the text add action (D9, D14) |
| `client/src/review/PayslipReview.tsx` (+ test) | `useOpenSections`; a region click opens its section first (`flushSync`); "Show document" as `DisclosureButton` (D10); the Edited / Discard row (D11) |
| `client/src/i18n/locales/{en,hr}.json` | The D15 keys; `merge.consequence` removed |
| `PRD.md` | §7.6 (no `+N`, the wheel, the phone budget corrected to 9,560,000, a Task 15 list), §7.7, §7.8, §7.10 |
| `.agents/ROADMAP.md` | §2 Task 15 line |
| `.claude/commands/validate.md` (git-ignored) | Phase 4 Task 15 table and the two superseded Task 14 rows; 9.9 step 2, 9.10 steps 3–4, 9.13 step 7; journey 9.14 |

Superseded, as plan 15's notes list: Task 14 D17's wheel pan, Task 10's `+N` badge, plan 11 D11's
merge menu item and consequence text, plan 12 D5's merge in the menu. The ROADMAP's Task 10–14
blocks stay as the historical record.

## Decisions

Implemented plan D1–D16 as written, except for the deviations below.

## Deviations and implementation findings

1. **Discard needs `reset(values, { keepDirtyValues: false })`, not `reset(values)` (D11).**
   react-hook-form 7.85 merges the form's `resetOptions` into every explicit `reset` call
   (`node_modules/react-hook-form/dist/index.esm.mjs:3342-3344`). The form sets
   `keepDirtyValues: true` so typing survives a language switch and the tables landing, so the
   plan's call kept the typed text. The test caught it: the handler ran and `getValues` still read
   the typed value. The option is now overridden for discard only; save's own `reset` is untouched.
2. **No unit assertion that closing the merge dialog refocuses the Merge button (step 7).** Focus
   return is the native `<dialog>`'s `close()`, which jsdom does not implement, and `SessionPage`'s
   tests mock the dialog. Journey 9.10 step 3 checks it in the browser ("focus returns to the Merge
   button").
3. **Steps 4 and 7 were written together**, because both rewrite the same heading row and action
   list. Their tests were added afterwards rather than red first. Step 2's two hand-over tests were
   bite-checked instead: both fail against the old `pending` filter and pass with the fix.
4. **Discard's tests live in `PayslipReview.test.tsx`**, not `PayslipForm.test.tsx`, because the
   button is rendered by `PayslipReview`. They cover the typed value, the added row, the chip's
   unsaved state and the saved-edits badge.
5. **`PayslipForm.test.tsx`'s harness opens every section by default**, so the earlier tests reach
   every cell unchanged. The new section tests start from `DEFAULT_OPEN`. `LineItemSection.test.tsx`
   likewise defaults its harness to expanded.
6. **`ToCheck` lives in `SectionLegend.tsx`**, shared by the scalar sections and the tables.
7. **A section's group name now includes its summary** ("Pay components 2 rows"), since the summary
   is inside the legend's button. Tests query headers with `/^Pay components/`.
8. **`padCorners` does not move a corner that is level with the centroid on an axis**, as the plan's
   function spec says. A zero-height quad therefore grows sideways only. The edge-case list's "grows
   by the pad" is read that way.
9. **The single view also skips mounting `MergeDialog`**, since nothing there can open it. The
   `relative` class left the rail chips with the badge it positioned.
10. **D14's classes are the plan's own.** receipt-ocr's "Add item" (`ItemRows.tsx:114-118`) is a plain
    `min-h-11 text-left underline` button; the accent colour, `Plus` icon and 48 px come from D14.
11. **Some plan line references had drifted** (for example `overflows` in `ZoomableSourceViewport.tsx`
    is at about line 295, not 322–330). Each spot was found by name.
12. **PRD.md was briefly written with CRLF.** A Python text-mode write on Windows converts `\n` to
    `\r\n`. Git flagged it, the file was rewritten with LF, and every changed file was checked for
    CRLF bytes afterwards (none). Later doc edits wrote with `newline=""`. As in Tasks 13 and 14,
    long Bash heredocs failed to parse, so the edits ran as scratchpad Python scripts.

## Validation

| Check | Result |
| --- | --- |
| Step 1 starting state | Clean apart from the untracked plan 15; last commit `dab77c2` |
| Baseline `npm run validate` | 74 files / **1,147 tests**, green |
| Red first | `markListed` 3 failed; sidebar 3 failed; wheel 1 failed; outlines 5 failed; each green after its change |
| Bite checks | Step 2's two hand-over tests fail against the old `pending` filter. The two auto-open tests (failed save, region click) fail with the auto-open code disabled |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **76 files / 1,176 tests** (+2 files, +29 tests) |
| `npm run build` | Pass |
| `npm run check:secrets` | ok: `.env.example` names only; 5 bundle files free of 7 markers and 4 server secret values |
| `git grep "overflowAfter\|merge.consequence\|panBy\|react-router-dom" client/src` | none |
| `git diff --check` | Clean |
| `package-lock.json` | Unchanged |
| `npm run test:integration` (hosted, $0) | 3 + 62 + 4 tests, green |

## Open items

1. **D13's 1.5 px gap** is a judgement only a phone-sized screen can confirm, on dense tables above
   all. Journey 9.14 step 6.
2. **The wheel over the preview never scrolls the page at `lg`.** With the sticky 1:1 aside, that is
   the right half of the screen. The product owner chose it (plan 15 D8, Q3), and a trackpad's
   two-finger scroll there now zooms. Journey 9.14 step 5 should say whether it reads naturally.
3. **The single view's status line for a payslip whose tables are still pending** reads "Needs
   review", like the list. No test covers that case.
4. **A closed table's pending skeleton is not announced**, because its `role="status"` is inside the
   hidden body. The header carries the pending text instead (plan 15 step 14 gotcha).
5. Open items 3–6 of history/14 are unchanged. Open item 4 there (the wheel scrolling the document
   first) is superseded by D8.

## Review-session handoff

1. `/code-review` against `dab77c2` (the last commit before Task 15).
2. `/validate`, with journey **9.14** (≤ 2 paid analyses, about $0.05) and the updated 9.9, 9.10 and
   9.13 assertions.
3. Judge D13's gap in phone emulation, and tune `OUTLINE_GAP_PX` if outlines overlap on dense tables.
4. Commit, subtree-push and let CI deploy, on the product owner's go-ahead.
5. Then the product owner's Android check (Task 14 D19–D21, plus this task), and the Task 13 device
   sitting.

## Review session (2026-09-28)

`/code-review` against `dab77c2` (the Standards and Spec reviews ran in parallel), then `/validate`
including journey 9.14 and the updated 9.9, 9.10 and 9.13 assertions. **Paid: 0 analyses, $0.**
Journey 9.14's uploads and merge ran against a local API started with an invalid extraction key,
so they failed at once as `provider_unavailable`, and failed payslips merge (plan 11 D3). The
viewer payslips (A01.pdf, A02.jpg, D01.pdf) were seeded from `.bakeoff/two-pass-sequential/`
through the production `mapAnalyzeResult` and `complete_extraction_pass`, with the real sources.

### Findings and what was done

| # | Finding | Axis | Action |
| --- | --- | --- | --- |
| 1 | Discard left a failed save's "Some values could not be read" alert on screen: `onReset` reset the values but not the form's `error` state | Standards | **Fixed**: `setError(null)` in `onReset`. New test in `PayslipReview.test.tsx`, red first (the value was restored, the alert stayed); confirmed in the browser |
| 2 | The collapsed sidebar's toggle and links were **47 px** wide: `w-18` (72 px) less the 1 px border and `p-3` | browser | **Fixed**: `px-2.5` while collapsed; measured 48 px toggle, 51 px links, rail still 72 px. jsdom computes no layout, so journey 9.14 step 4 now measures it |
| 3 | `SectionLegend`'s static branch had no caller left once every section became a disclosure | both | **Fixed**: the disclosure props are required and the branch is gone |
| 4 | The single view's status for a payslip whose tables are pending was untested (open item 3) | priming | **Test added**: it reads "Needs review", the list's word for `review` |
| 5 | `CONTEXT.md`'s Upload batch still said the batch "ends once every file has been sent" | priming | **Fixed**: the glossary describes the D2 hand-over |
| 6 | Open item 1, D13's gap on dense tables. Measured on A01 at a phone's fit width (a 317 × 449 px page): pay-component rows are 3.5–4.3 px tall with a median **0.4 px** between rows, so no `OUTLINE_GAP_PX`, zero included, keeps a 1 px stroke off the next row there, and 3.5 px text is unreadable at fit anyway. Sparse values (header, reconciliation chain) read cleanly at fit; at 3.4× the dense rows read with the outlines beside the glyphs | review | **Kept at 1.5 px**. The product owner's phone check is the final judge |
| 7 | Judgement calls not taken: the `review-section-${x}` id built in three places and the section shell written twice; two storage wrappers; `attentionCount`'s `warnings` parameter used only for its length; `SessionPage` switching on `single` in about eight places; `read`/`KEY` names in `openSections.ts`; an inline `onDirtyChange` (pre-existing) | Standards | Left as they are |
| 8 | The popover's Edit auto-opening a closed section has no unit test (the same path as a region click) | Spec | Checked in the browser instead (step 7 below) |

### Validation

| Phase | Result |
| --- | --- |
| 0–5 | `npm install` clean; typecheck, oxlint, Prettier; **76 files / 1,176 tests**, then **1,178** after the fixes; build |
| 6 | `check:secrets` ok; every static check passes (6.22 and 6.24 run under bash) |
| 7 | `check:golden` pass; `score -- cu` 281/284 (98.9%); `score:extraction` exit 0, two-pass-sequential 271/273; both analyzers match the code |
| 8 | `npm run test:integration` on the hosted project: 3 + 62 + 4 tests, green. Migrations match the 7 local files; advisors show only the 9 by-design definer findings and leaked-password protection |
| 9.2–9.4 | Health through the proxy, `404 not_found`, `401 unauthorized` on both prefixes |

### Journey 9.14

| Step | Result |
| --- | --- |
| 1 Merge | A01 split into two one-page PDFs and uploaded in this tab. The panel's **Merge with another payslip…** button, the pick step, and the confirm step with **no warning text** and focus on Cancel; Escape returns focus to the Merge button. After the merge: one chip "A01-p1.pdf + A01-p2.pdf", header "0 of 1 ready to review", **no row below the form**, and still none after several polls |
| 2 Single view | From Payslips the URL carries `&view=single`; no rail and no Merge button; the `h1` is the file name with the status under it. A merged-away original's link: "This payslip does not exist." with Back to payslips (`hr`: "Ova platna lista ne postoji.") |
| 3 Delete | Three files uploaded in this tab; E01 deleted from Payslips; back in the session: "0 of 2 ready to review", two chips, no phantom row |
| 4 Sidebar | Collapses to 72 px and stays collapsed across a reload; Tab goes toggle → Scan → Payslips with a visible outline; links keep their names and `title` tooltips. The 47 px width was found and fixed here (finding 2) |
| 5 Wheel (1366×768) | CDP wheel over the document: one notch zooms about the cursor and `scrollY` stays 0 throughout; zoom-out stops at the whole page; the wheel over the form scrolls the page; drag pans at 100% and when zoomed |
| 6 Outlines (375 px, touch) | A01.pdf and A02.jpg: header fields and the reconciliation chain readable at fit, with outlines beside the text; dense tables as finding 6 |
| 7 Sections | Scalar sections open; tables closed with "23 rows", "18 rows 3 to check", "2 rows". A pay-component outline click at `lg` opened the closed table and focused `payComponents.10.naziv`; the open state carried into A02. On a phone, a tap on an obustave outline, then the popover's **Edit this field**, opened the closed Obustave and focused `obustave.1.naziv` |
| 8 Edited / Discard | Typing shows "Edited", a 48 px "Discard changes" and the chip's unsaved mark; Discard restores the value and clears the mark; a failed save's alert clears on Discard (finding 1); after a save the badge stays and Discard is absent; saving the original back removes the badge |
| 9 Phone controls | "Hide document" a borderless 48 px chevron disclosure; "Add row" an underlined 48 px text action; Save and Confirm 343 px wide and stacked; no horizontal scroll at 375 px. `hr`: Primici 15 redaka, Obustave 2 retka, Neoporezivi primici 1 redak, Izmijenjeno, Odbacite promjene, Spojite…, Proširite izbornik |
| 10 Cleanup | 9 Storage objects, 9 payslips, 3 sessions and the user deleted; the orphan query lists only the plan 13 D12 account |

Journey 9.14 steps 1 and 5 cover the updated 9.10 steps 3–4 and 9.13 step 7; 9.9 step 2's missing
`+N` badge and the third chip's peek were seen at 375 px. The other paid journeys (9.6–9.8, 9.11)
were not re-run: Task 15 changes no upload, extraction, region or export code.

### Still open

- The product owner's Android check (Tasks 14 and 15, including D13's gap on a real phone) and the
  Task 13 device sitting.
- Commit, subtree push and deploy wait for the product owner's go-ahead.

## Follow-up 15b (2026-09-29)

**Plan:** [15b-review-flow-follow-up.md](../plans/15b-review-flow-follow-up.md), four points from
the product owner's check of Task 15:
- **Sidebar toggle:** the panel icon, fixed in the nav icons' column (D2). After the product owner's
  second look, it follows shadcn/ui's Sidebar: a top-bar trigger and an animated width (deviation 11).
- **Merge button:** "Merge" with a tooltip (D3).
- **Merging:** two or more payslips in one merge, with grouped suggestions (D4–D7).
- **Sections:** every payslip opens at the default sections (D8).

**Status: implemented; not reviewed, validated in a browser, or committed.** Following plan 15b D1
and the standing session split, this session ran the ordinary checks only. **Paid runs: 0, $0.**
One migration was applied to the hosted project (backward compatible).

**Starting state:** Task 15 uncommitted on `dab77c2` plus the untracked plan 15b; baseline
`npm run validate` green at **76 files / 1,178 tests**.

### What was built

| Created file | Contents |
| --- | --- |
| `supabase/migrations/20260929074440_merge_several_payslips.sql` | `create or replace` of `merge_payslips`, same signature: two or more distinct ids, `v_count` against `cardinality(p_order)` (D5) |

| Modified file | Change |
| --- | --- |
| `client/src/components/AppLayout.tsx` (+ test), `NavItems.tsx` | The trigger moves to the top bar: a `PanelLeft` ghost button before the app name, then a vertical separator, `lg` only. The nav animates `transition-[width] duration-200 ease-linear` between `w-60` and `w-19`, with constant `p-3` padding. The links keep `px-4` in both states, and the label is a `truncate` span that fades to `opacity-0`. `title` equals the `aria-label` (D2, deviation 11) |
| `client/src/routes/SessionPage.tsx` (+ test) | One "Merge" label with `title={t("merge.mergeWith")}` (D3); `merge.group`, `lastMerge.originals` and `merged()` over N originals; `groups` to `MergeSuggestions`, `group` to `MergeDialog` (D6, D7); **the merge's list, URL and focus updates in one `startTransition`** (deviation 1) |
| `client/src/review/openSections.ts` (+ test), `PayslipReview.test.tsx` | `useState(DEFAULT_OPEN)`: no `sessionStorage`, `KEY`, `read` or effect; the storage tests removed, a remount test and a two-payslip test added (D8) |
| `shared/src/session.ts` (+ test) | `mergeSuggestions` returns groups by D7's three steps; `mergedFilename(names)` (D4, D7) |
| `shared/src/api.ts` (+ test) | Request `payslipIds` / `order`: 2–`MAX_PAYSLIPS_PER_SESSION` distinct ids, `order` the same set; `mergeSuggestions` groups of two or more (D4, D7) |
| `api/src/repositories/payslips.ts` | `order: readonly string[]`; doc comment (D4) |
| `api/src/routes/sessions.ts` | `originals = order.map(find)`, every one listed and mergeable (a type-guard `every`), names of all in `order` (D4) |
| `api/src/routes/payslips.integration.ts` | Three-way merge, a group with a processing member, direct RPC with one / repeated / null ids, a one-id body is 400 |
| `client/src/session/MergeDialog.tsx` (+ test) | Checkbox pick step; Move up / Move down per card with ids `merge-move-{up,down}-${id}`, focus restored after a move, `merge.moved` announced; cumulative page positions; `Pair`, the swap and `ArrowUpDown` removed (D6) |
| `client/src/session/MergeSuggestions.tsx` (+ test), `dismissedSuggestions.ts` (+ test) | One banner per group, `{{names, list}}`; `suggestionKey(ids)` joins by `:` (D7) |
| `client/src/i18n/locales/{en,hr}.json` | `mergeShort` "Merge" / "Spojite", `mergeWith` without the ellipsis, `pickTitle`, `pickLegend`, `suggestion`; new `moveUp`, `moveDown`, `moved`; `swap`, `swapped` removed |
| `PRD.md` | §4.6, §7.6 (sidebar toggle), §7.7 (sections), §7.8 (groups, checkboxes, Move up / Move down, the filename rule), §10.11 |
| `CONTEXT.md` | Merge and Merge suggestion: two or more, one prompt per group |
| `.agents/ROADMAP.md` | §1 locked decision 4 and the deferred reordering line; §2 the 15b line; §5 "Three suggestion pairs" closed |
| `.claude/commands/validate.md` (git-ignored) | Phase 4 Task 15b table; the Task 11 and Task 15 dialog / sections rows; 9.10 steps 2–3; 9.14 steps 1, 4 and 7 |

### Decisions

Implemented plan D1–D9 as written, except for the deviations below.

### Deviations and implementation findings

1. **A merge could hand the selection to another payslip: fixed in `merged()`.** The new
   three-way `SessionPage` test failed with `?payslip=x`, the untouched payslip, instead of the
   merged one. The router applies a navigation in a React transition, so `setDetail` (urgent)
   rendered first: the originals were gone, `?payslip=` still named one of them, and the Task 14 D9
   first-payslip effect replaced the URL with the first readable payslip. The Task 11 test did not
   catch it, because no readable payslip was left outside the pair, so the effect had nothing to
   pick. It would have happened in Task 11 too whenever another readable payslip stayed in the
   session. The fix puts the list update, `setSearchParams` and `setLastMerge` in one
   `startTransition`, so they commit in one render; the focus effect runs in that commit too. The
   test fails without the transition and passes with it. The comment above `preparing`, which
   described this gap, was updated.
2. **ROADMAP §1 locked decision 4 reworded** ("two files" → "two or more files … since Task 15b").
   D9 updated only the deferred line, which would have left the roadmap contradicting itself. The
   decision is unchanged: a non-dragging action, a suggestion and a manual path.
3. **The grouping key separator is a space, not `\u0000`.** An edit script wrote a literal NUL
   byte into `session.ts`. A space is safe: periods are `YYYY-MM` and OIBs are trimmed, so neither
   contains one.
4. **The plan's dry-run check could not tell the old function from the new.**
   `cardinality(p_order) <>` is in both bodies. The dry run ran the file, then called the function
   with a null array and with one id (both `false`), and rolled back. Afterwards
   `position('count(distinct id)' in pg_get_functiondef(…))` read `false` (rolled back), and after
   `apply_migration` `true`; `anon` cannot execute it, `authenticated` can.
5. **Red first, and bite checks where tests came after the code.**
   - Written red first: the sidebar `title` test; the section tests (`openSections.test.ts`); the
     three-way `SessionPage` test, which exposed deviation 1.
   - Bite-checked:
     - the two-payslip section test fails against a tab-storage version of the hook;
     - both focus-after-move tests fail with the focus effect disabled.
   - The shared grouping and schema tests were written alongside the implementation, with no bite
     check.
6. **The API route narrows with a type-guard `every`**
   (`(original): original is NonNullable<…>`), so the filename needs no `?? ""` fallback.
7. **`PayslipReview.test.tsx`'s `review()` harness now keys the review by payslip**, as
   `SessionPage` mounts it, and takes an optional `payslipId`. Its `sessionStorage.clear()` was
   removed: nothing in the client reads `sessionStorage` any more (the dismissed suggestions are
   module state).
8. **After the integration run**, lint's `no-shadow` renamed one test variable (`rows` →
   `storedRows`) and Prettier reformatted `sessions.ts`. No behaviour changed, so the integration
   run was not repeated.
9. **Tooltip wording**, as the plan asked the record to note: "Merge with another payslip" is
   singular, while the pick step reads "Merge with other payslips". Kept as the product owner wrote
   it.
11. **The sidebar was redone after the product owner's second look (D2 superseded).** The panel icon
    inside the nav list read as another nav item, and the collapse snapped. The product owner asked
    for one established example to be copied as a whole, with no colour or other aggressive changes.
    The example is shadcn/ui's Sidebar (`ui/sidebar.tsx` and the `sidebar-07` block, read from
    GitHub on 2026-09-29):
    - **Trigger:** a ghost icon button in the page header, followed by a vertical separator.
      Ours is `PanelLeft` at the left of the top bar, at the bar's own control size (`min-h-11
      min-w-11`, 44 px, like the language and account controls; shadcn's is 28 px).
    - **Motion:** only the width animates, `transition-[width] duration-200 ease-linear`.
      `motion-reduce:transition-none` is ours.
    - **Icons stay put:** the menu button's padding is the same in both states. Its labels are
      clipped by `overflow-hidden`; ours also fade, because a 51 px link would otherwise show a
      sliver of the first letter.
    - **Geometry:** the top bar's `px-4` plus half of the 44 px trigger puts its icon centre 38 px
      from the edge. The nav's `p-3`, the links' `px-4` and half of the 20 px icon put theirs at
      38 px too, so the trigger sits directly above the nav icons. Collapsed is `w-19` (76 px),
      not 72: the links are 51 px wide and the icons centred to within half a pixel.
    - **Not taken:** shadcn's edge rail, a hidden hover strip that toggles on click, and its
      Ctrl+B shortcut, which conflicts with the browser's bookmarks shortcut on some platforms.
    - **Tests:** `AppLayout.test.tsx` finds the trigger in the header, before the app name; no
      button remains in the nav; and a signed-out visitor gets no trigger.
    - **Unverified:** no browser check was run in this session (the standing session split), so
      the look and the animation still need the review session's eyes.
12. Long Bash heredocs again failed to parse. The edits ran as scratchpad Python scripts writing
    with `newline=""`, and `grep -c $'\r'` found no CRLF in `PRD.md`, `CONTEXT.md`, `ROADMAP.md` or
    `validate.md`.

### Validation

| Check | Result |
| --- | --- |
| Baseline `npm run validate` | 76 files / **1,178 tests**, green |
| Migration dry run (`begin; …; rollback;` via `execute_sql`) | Compiled; null array and one id → `false`; rolled back (deviation 4) |
| `apply_migration merge_several_payslips` | Recorded once as **`20260929074440`**; local file renamed to match; `list_migrations` lists the 8 local files |
| `get_advisors` (security) | Only the 9 by-design definer findings and leaked-password protection |
| `npm run test:integration` (hosted, $0) | **3 + 65 (+3) + 4**, green |
| `npm run typecheck` | Pass |
| `npm run lint` (oxlint) | Pass, after `toSorted` / `toReversed` and one `no-shadow` rename |
| `npm run format:check` | Pass, after Prettier on six files |
| `npm run test` | **76 files / 1,200 tests** (+22: storage and swap tests removed, the new ones added) |
| `npm run build` | Pass |
| `npm run check:secrets` | ok: `.env.example` names only; 5 bundle files free of 7 markers and 4 server secret values |
| `grep -rn "ChevronsLeft\|ChevronsRight\|merge.swap\|open-sections\|ArrowUpDown" client/src` | none |
| `grep -rn "\[string, string\]" shared/src api/src client/src` | one unrelated hit: the full-session test's `ids as [string, string]` |
| `git diff --check` | Clean |
| `package-lock.json` | Unchanged |

### Open items

1. **The sidebar's look, its animation, the alignment and the native tooltips** cannot be seen in
   jsdom. Journey 9.14 step 4 checks them in the browser.
2. **Deviation 1 changes Task 11 behaviour.** It fixes a selection bug that was already there, and
   journey 9.14 step 1's four-file merge checks it in the browser.
3. **The three-way grouping has only unit tests.** The hosted suite still asserts only the pair
   case through the API, which now returns `[[a, b]]`.
4. Open items 1, 2 and 4 of the Task 15 record are unchanged. Its open item 3 became a test in the
   review session.

### Review-session handoff

1. `/code-review` against `dab77c2`. The product owner chose (2026-09-29) to commit Task 15 and
   15b together, and Task 15 was already reviewed (above), so the review should concentrate on
   the 15b changes in the file table above.
2. `/validate`, with journey 9.14 as updated:
   - the sidebar icon's x in both states;
   - the Merge tooltip;
   - a three-file merge with a move, a fourth payslip staying (deviation 1);
   - one grouped banner;
   - A01 → A02 opening at the default sections.

   $0 as in Task 15 (an invalid extraction key; failed payslips merge).
3. Commit, subtree push and deploy on the product owner's go-ahead. The migration is already live
   and backward compatible, so the deploy order does not matter.
4. Then the product owner's Android check (Tasks 14, 15 and 15b) and the Task 13 device sitting.
