# 16 — Extraction and review polish

**Date:** 2026-09-29
**Plan:** [16-extraction-review-polish.md](../plans/16-extraction-review-polish.md)
**Starting state:** clean at `fd50bc4` (Tasks 15 and 15b), plus the untracked plan 16.
**Outcome:** the five observations from the product owner's testing that the plan took on are
implemented:
- highlights: an outline is withheld unless the OCR words under it show the value (D6);
- extraction: `period` and `paymentDate` are copied as printed, and table rows come back in printed
  order, on a new analyzer family `hrPayslipV2` (D1, D2, D4);
- viewer: outlines are 0.5 / 1 px below `lg` (D7);
- form: the pay calculation follows the IP1 print order, with `ukupnoSati` in it (D8).

**Status: implemented, then reviewed and validated (below); committed as `69e1f0b`.** The implementing
session ran the ordinary checks, the scoring harness and the one paid run; at the product owner's
request the same session then ran `/code-review`, `/validate` and journey 9.15 (below). **Paid
runs: 1, $0.55 (estimate). Production is still on `hrPayslipV1`.**

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `.agents/history/16-extraction-review-polish.md` | This record |
| `.bakeoff/task16-sequential/` (git-ignored) | The first V2 recording set, 11 samples |
| Azure: `hrPayslipV2_scalars`, `hrPayslipV2_tables` | Provisioned from the edited field schema (D4) |

| Modified file | Change |
| --- | --- |
| `client/src/review/regionSections.ts` (+ test) | `SCALAR_SECTIONS` in D8's order, `ukupnoSati` in `reconciliation`; `SCALAR_LABEL_KEYS` in the same order |
| `client/src/review/PayslipForm.test.tsx` | The pay calculation's inputs in DOM order, and Period holding only the two dates |
| `client/src/review/SourceOverlay.tsx` (+ test) | `STROKE_PX` (wide 1 / 2, narrow 0.5 / 1) chosen by `useWideLayout()` (D7) |
| `api/src/providers/document-extraction/content-understanding/regions.ts` | Pages keep their words (key and quad centre); `agrees` withholds a value's outline when the words under it do not show it (D6) |
| `…/content-understanding/regions.fixture.ts` | `word(content, source)` |
| `…/content-understanding/regions.test.ts` | Ten synthetic D6 cases (eleven tests); the recordings test over five sets against `EXPECTED_WITHHELD` |
| `…/content-understanding/field-schema.ts` | `period` and `paymentDate` "copied as printed", with no month table; "rows in printed order" on the three tables (D1, D2) |
| `…/content-understanding/grounding.ts` | Header comments: the schema no longer asks for `YYYY-MM-DD`; `surfaceForms` stays for payslips analysed before |
| `shared/src/datetime.ts` (+ test) | `parsePeriod` finds an ISO `YYYY-MM` inside its label text, last (deviation 1) |
| `PRD.md` | §7.5 (the agreement rule and its measured effect), §7.7 "Settled in Task 16" (D8, D7) |
| `CONTEXT.md` | Source Region: drawn only where the page's words show the value |
| `.agents/ROADMAP.md` | §2 the Task 16 line; §5 "Service source on the wrong text" closed |

## Decisions

Implemented plan D1–D9 as written, except for the deviations below.

## Deviations and implementation findings

1. **D1 broke E01's period, and the mapper fix is in `shared/`, outside the plan's file list.** With
   the new wording, V2 returned E01's period as `OBRAČUN PLAĆE 2025-06`, its label included, which
   is the plan's own example text. `parsePeriod` accepted `2025-06` only as a whole string, so the
   critical field came back unreadable (`unparseable_date`, `missing_critical_field`). The plan's
   premise that "the mapper already normalises every printed form seen" had a gap, which
   `datetime.test.ts` itself recorded: "E01's printed period is not isolated anywhere in its
   recorded output". Every other rule in `parsePeriod` searches, as its doc comment says ("the
   provider returns the printed text with its surrounding label"); the ISO form was the one
   anchored rule. It now also searches, last, for a `YYYY-MM` that is not part of a date, so a span
   such as `01.06.2025-30.06.2025` still goes through `DATE_SPAN` first. It is a normalisation of a
   printed form, which is the mapper's job under locked decision 13, not a new rule for one
   document, and it costs $0 and applies to stored payslips on read.
   - Tests: E01's string added red first; `DATUM 2025-06-09` and `OBRAČUN PLAĆE 2025-13` rejected.
   - Effect on V2: E01 went from 24/25 to 25/25, and the set from 270 to **271/273** scalars and 74
     to **75/77** critical. V1 scores are unchanged.
   The D5 acceptance had already passed before the fix (270 ≥ 268), so the plan's "revert step 8"
   branch did not apply. Leaving a critical-field regression that this task introduced would
   still have been wrong.
2. **`score:extraction` reads `@payslip/shared` from `shared/dist/`**, the package's `exports`. The
   first re-score after the `parsePeriod` change still printed E01 unreadable, although the unit
   test passed. `npm run typecheck` (`tsc --build`) rebuilt `dist/`, and the next score showed the
   fix. **Rule: after changing `shared/`, run `npm run typecheck` (or `build`) before
   `score:extraction`**, or the harness scores the old code.
3. **The recordings test's separate "every non-null scalar is outlined" check was removed.** It was
   Task 08's DoD form. Non-null scalars are a subset of the read paths, which the remaining
   assertion compares against `EXPECTED_WITHHELD`, so it would have needed a second copy of the
   same map.
4. **D6's rule is implemented exactly as the plan's prototype:** words keyed by `groundingKey`, a
   word under a segment by its quad centre in the segment's axis-aligned box, (a) the run's
   substring or (b) every whitespace token present, over `[printed, ...surfaceForms(printed)]`. A
   value is checked only when every one of its segments is on a page that carries `words`;
   otherwise it is outlined as before (every real body carries them). Segments are parsed once, so
   the drawing loop and the check share them (`parseSegment`, `axes`).
5. **The recordings test runs over five sets**, two more than before: `hosted-quads` (plan step 6)
   and `task16-sequential` (step 11).
6. **D8 keeps `ukupanTrosakRada` last**, as written. The planning's A04 citation prints "3. UKUPAN
   TROŠAK PLAĆE" right after doprinosi na plaću, so strict IP1 order would put it third. The
   plan's order was kept because ukupan trošak rada includes neoporezivi primici (CONTEXT), which
   come later. Raised when priming; the product owner should confirm in the review session.
7. As in Tasks 13–15, long Bash heredocs failed to parse, and one double-quoted `python -c` ran the
   backticks in its text as commands (the edit it carried did not apply and was redone with
   Edit). The edits ran as scratchpad Python scripts writing with `newline=""`.

## The paid run (D5)

`AZURE_CU_ANALYZER_ID=hrPayslipV2 GOLDEN_SET=task16-sequential GOLDEN_MODE=sequential npm run test:extraction`,
2026-09-29 20:57:35–21:02:00 UTC (263 s), **passed**. Every recording's `analyzerId` is
`hrPayslipV2_scalars` / `hrPayslipV2_tables`. No pass was resubmitted.

| Measure | Value |
| --- | --- |
| Estimated cost | **$0.55** (26 pages, 103,047 uncached + 94,464 cached input, 17,477 output tokens) |
| Running total, Task 16 | **$0.55**, one run |
| First form | p50 13.7 s, p90 16.1 s, max 29.7 s (B02: 16.6 s submit on the uplink, as before) |
| Complete | p50 13.7 s, max 58.3 s (A01's tables pass, 57.3 s) |

## Scoring (D5)

| Set | Family | Scalars | Critical | Cells | OIB checksum |
| --- | --- | --- | --- | --- | --- |
| **task16-sequential** | V2 | **271/273** (270 before deviation 1) | **75/77** | **509/548** | 19/19 |
| two-pass-sequential | V1 | 271/273 | 75/77 | 478/548 | — |
| two-pass-concurrent | V1 | 268/273 | 73/77 | 502/548 | — |
| hosted-quads | V1 | 270/273 | 74/77 | 518/548 | — |

**Acceptance:** scalars ≥ 268 ✅, cells ≥ 478 ✅, no `period` / `paymentDate` withheld ✅. One set
is one sample of a nondeterministic service (plan notes).

The remaining misses are A04's occluded `iznosZaIsplatu` (invented as `1.801,77`, flagged) and two
G01 criticals on the screenshot's off-screen sections, as in the V1 sets.

### Period and payment date, as returned by V2

| Sample | `period` returned | `paymentDate` returned | Outlined |
| --- | --- | --- | --- |
| A01, A02, A04 | `svibanj 2025.` | `09.06.2025` | both |
| A03 | `lipanj 2025.` | `11.07.2025` | both |
| B01 | `GODINA 2025, MJESEC 6 DANI U MJESECU OD 9 DO 30` | `10.07.2025` | both |
| B02 | `GODINA 2025, MJESEC 5 DANI U MJESECU OD 1 DO 31` | `02.06.2025` | both |
| C01 | `GODINA 2025. MJESEC 6. DANI U MJESECU OD 01. DO 30.` | `01.07.2025.` | both |
| D01 | `GODINA 2025, MJESEC SVIBANJ, DANI U MJESECU OD 01.05.25 DO 31.05.25` | `10.06.25` | both |
| E01 | `OBRAČUN PLAĆE 2025-06` (deviation 1) | `8.7.2025.` | both |
| F01 | `1.05.2025 do 31.05.2025` | `6.06.2025` | both |
| G01 | null | null (unscorable) | — |

Every value is printed text, and none is normalised. B01, C01 and D01, the three samples whose
highlights started this task, are outlined on their printed runs.

## D6 measured (TypeScript)

The withheld read paths in every set equal the plan's prototype table exactly, with no difference to
investigate. There are 2,814 read paths in the four V1 sets; the prototype's 2,856 included 42
`currency` hits, which are not region paths.

| Set | Withheld |
| --- | --- |
| two-pass-sequential | A01 `obustave.0/1/2.vjerovnik`; B01 `period`; C01 `period`, `paymentDate` |
| two-pass-concurrent | B02 `period`; D01 `period`, `paymentDate` |
| hosted-quads | B01 `period`; B02 `period`; C01 `period`, `paymentDate` |
| cu | A01 `obustave.4.naziv` (partial but right); B01, B02 `period`; C01, D01 `period`, `paymentDate` |
| task16-sequential (V2) | A04 `iznosZaIsplatu`, the invented payout |

## Observations (D3, D2)

- **A04's obustave row order** is the printed order in this run (SPH PU VUKOVAR, KREDITNA UNIJA,
  SPH PU VUKOVAR, CROATIA ×2, SPH PU VUKOVAR). One run cannot show that D2 fixed a run-to-run
  effect.
- **A04's `obustave.0.iznos` (40,00)** is still null, now 5/5 runs. Recorded and left, as D3 says.
- A04's wrapped deduction names are split as the service's OCR splits them (plan notes), unchanged.

## Validation

| Check | Result |
| --- | --- |
| Step 1 baseline `npm run validate` | 76 files / **1,200 tests**, green |
| Red first | D8: 2 failed; D7: 2 failed; D6 synthetic: 5 failed (the positive cases passed before and after, as they should); `parsePeriod` E01: 1 failed; each green after its change |
| `npm run provision:analyzer` (V2) | First run created both analyzers; second run: both match, exit 0 |
| `npm run provision:analyzer` (V1, `.env`) | **Drift, exit 1**: `hrPayslipV1_scalars` (paymentDate, period), `_tables` (the three tables). By design until the switch; do not `--replace` |
| `npm run score:extraction` (V1) | Exit 0; every V1 set unchanged |
| `AZURE_CU_ANALYZER_ID=hrPayslipV2 npm run score:extraction` | Exit 0; table above |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **76 files / 1,220 tests** (+20) |
| `npm run build` | Pass |
| `npm run check:secrets` | ok: 5 bundle files free of 7 markers and 4 server secret values |
| `npm run check:golden` | All identities and checksums pass |
| `git diff --check` | Clean |
| `package-lock.json` | Unchanged |
| CRLF in the edited `.md` files | 0 |

`npm run test:integration` was not run: no route, schema or repository change (plan).

## Open items

1. **Production is on V1.** Switching is the product owner's step: Render
   `AZURE_CU_ANALYZER_ID=hrPayslipV2`, and `.env` locally. Rollback is setting it back; V1 stays
   deployed and unmanaged. Until then, `/validate`'s analyzer check reports V1 drift **by design**.
   Deploy the code before or with the switch: V2 returns printed periods, which need deviation 1's
   parser on E01-like layouts.
2. **D7's 0.5 px** at rest is a phone judgement; `STROKE_PX` is exported for tuning.
3. **D8's `ukupanTrosakRada` position** (deviation 6) is for the product owner to confirm.
4. **A withheld value has no outline and no note at `lg`**, as with any value without a source. On a
   phone the strip says "This value has no highlight on the payslip."
5. Open items of history/15 (the sidebar's look, three-way grouping through the API, the 1.5 px gap)
   are unchanged. history/15 and ROADMAP §2 still describe 15b as awaiting review, although
   `fd50bc4` committed it; the review session should record which is true.

## Review-session handoff

1. `/code-review` against `fd50bc4`.
2. `/validate`, expecting V1 drift (open item 1). A browser pass:
   - B01, C01 and D01 outlines on the existing V1 payslips, where D6 withholds the wrong ones;
   - A04's creditors: no outline on "VUKOVARA";
   - strokes at 375 px with touch emulation, and 1 / 2 px at `lg`;
   - the pay calculation order, with `ukupnoSati` in its colour.
3. Commit, subtree push and deploy on the product owner's go-ahead; then the product owner switches
   Render to `hrPayslipV2` and judges the strokes on the Android phone.

## Review session (2026-09-29)

At the product owner's request, run in the implementing session: `/code-review` against `fd50bc4`
(the Standards and Spec reviews ran in parallel), then `/validate` with a new journey 9.15.
**Paid: 0 analyses, $0.** The browser pass used an API started with an invalid extraction key and
payslips seeded from the recordings through the production mapper, with their real sources.

### Findings and what was done

| # | Finding | Axis | Action |
| --- | --- | --- | --- |
| 1 | PRD §7.6 still said outlines are 1 / 2 px, with no "at `lg`", contradicting the new §7.7 bullet that points to it | Spec | **Fixed**: "at `lg` (half that below `lg` since Task 16, §7.7)" |
| 2 | `parsePeriod`'s new ISO search took the first of two months: `2025-05 do 2025-06` read as `2025-05`, although the function rejects a cross-month dotted span rather than guess | Spec | **Fixed**: exactly one ISO month in the text, else null. Test red first. V1 and V2 scores unchanged |
| 3 | `agrees` calls `surfaceForms(printed)`, whose contract is a canonical value; and it sits beside `isGrounded` with a different notion of "shows the value" | Standards | **Documented** on `agrees`: the returned string is canonical for the two kinds `surfaceForms` expands (an OIB without `HR`, a pre-Task 16 date); unlike `isGrounded` it looks only under the outline. Kept in `regions.ts`, its only caller |
| 4 | Stale comments: `EDITED_DASH` ("`strokeWidth={2}`"), `addValue` (no mention of the check), `parsePeriod`'s list of printed forms; `grounding.ts`'s header past its wrap width | Standards | **Fixed** |
| 5 | `STROKE_PX` is exported but imported nowhere | Standards | **Kept**: plan D7 asked for exported constants for the review session to tune. Judgement call |
| 6 | The whole-string `PERIOD_PATTERN` check is nearly covered by the new search | Standards | Kept as the fast path, as before |
| 7 | ADR-0001 says Croatian knowledge belongs in the schema; D1 moved the month-name table out of it | Standards | Noted: no new code rule, since `parsePeriod`'s month table predates the task (Task 02) and now carries it alone |
| 8 | `parsePeriod` change (deviation 1) is outside the plan's file list | Spec | Accepted by both reviews as a justified fix |
| 9 | D8 keeps `ukupanTrosakRada` last although A04 prints it third | Spec | Not a defect against the plan; for the product owner (open item 3) |

### Validation

| Phase | Result |
| --- | --- |
| 0 | `npm install`: no `ERESOLVE`; lockfile unchanged |
| 1–4 | Typecheck, oxlint, Prettier; **76 files / 1,221 tests** after the fixes |
| 5 | Build: main chunk, CSS, lazy `pdf-*.js` and the worker |
| 6 | `check:secrets` ok; 6.3, 6.4, 6.4b, 6.5, 6.8, 6.9, 6.11, 6.16, 6.20–6.26 pass |
| 7 | `check:golden` pass; `score -- cu` 281/284 (98.9%); `score:extraction` V1 exit 0, every set unchanged; V2 271/273, 75/77, 509/548. `provision:analyzer`: **V1 drifts (exit 1) by design**, V2 matches both analyzers |
| 8 | `npm run test:integration` on the hosted project: 3 + 65 + 4, green. 8 migrations match the local files; advisors only the 9 by-design definer findings and leaked-password protection. Orphan query: only the plan 13 D12 account |
| 9.1–9.4 | **Two stale dev servers were holding 3001 and 5173** and were killed first (9.1's warning). Health through the proxy, `404 not_found`, `401 unauthorized` on both prefixes |

### Journey 9.15

Seeded: A01, B01, C01 (V1, `two-pass-sequential`), D01 (V1, `two-pass-concurrent`), C01 and A04
(V2, `task16-sequential`).

| Step | Result |
| --- | --- |
| 1 Regions (API, as the page fetches them) | A01 V1: no `obustave.0/1/2.vjerovnik`; B01 V1: no `period`; C01 V1 and D01: no `period` or `paymentDate`; C01 V2: both present; A04 V2: no `iznosZaIsplatu`, its creditors present |
| 2 Outlines at 1440 px | C01 V2: payment date on `01.07.2025.` in section IV, period on the whole printed run in section V. C01 V1: neither section IV nor V outlined, everything else as before. Strokes 1 px at rest |
| 3 Form order | Pay calculation `brutoPlaca, ukupnoSati, doprinosiNaPlacu, doprinosiIzPlace, …, iznosZaIsplatu, ukupanTrosakRada`; Period holds `period, paymentDate`; `ukupnoSati`'s outline ("212" on A01's bruto line, "168,00" on C01) in the pay calculation's pink |
| 4 Phone (375 px, touch) | `pointer: coarse`, no horizontal scroll. Outlines 0.5 px at rest; the strip draws the active field at 1 px; focusing C01 V1's withheld `period` shows "This value has no highlight on the payslip."; A01's `period` shows its outline. Dense pay-component rows still sit close (history/15 finding 6); the product owner's phone is the judge |
| 5 Cleanup | 6 Storage objects and the user deleted; orphan query lists only the plan 13 D12 account |

The A04 "VUKOVARA" case from the product owner's live payslip is not in the recordings; its rule is
covered by the synthetic A04 test and by A01's creditors above. The other journeys were not
re-run: Task 16 changes no upload, merge, export or navigation code.

### Still open

- Commit, subtree push and deploy on the product owner's go-ahead; then the Render switch to
  `hrPayslipV2` (open item 1) and the Android check of the strokes (open item 2).
- Open items 3–5 above are unchanged.
