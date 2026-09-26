# 13 — Deploy & end-to-end verification

**Date:** 2026-09-26
**Plan:** [13-deploy-end-to-end.md](../plans/13-deploy-end-to-end.md)
**Outcome:** the deployed stack is measured and documented. CI now refuses a secret in the client
bundle, and the live bundle scans clean. Two cold starts took 22.4 s. PRD §11.4's four-in-parallel
target is **missed** on the deployed API (73.3 / 32.4 / 73.2 s against ≤ 25 s), while accuracy there
is within the noise band. The session header counts confirmed payslips separately. The README
exists, and the device sitting's checklist is ready.
**Status: implemented, reviewed, validated, committed (`5ef0325`) and deployed; journey 9.12 passed
on the deployed stack. The device sitting is pending.**

Following plan 13 D11 and the standing session split, this session did not run `/code-review`,
`/validate` or any browser journey, and did not commit. Paid runs: **one hosted quads run, 12 two-pass analyses plus the blank page, about $0.68** (plan 13 D2 budget ~$0.65). No re-run.

## What was built

Paths are relative to this project root.

| Created file | Contents |
| --- | --- |
| `scripts/check-client-secrets.mjs` | The D3 guard: `.env.example` names and allow-list, bundle markers, local secret values, and `--url` for a deployed client |
| `README.md` | The D8 operator README |
| `.agents/history/13-deploy-end-to-end.md` | This record, with the device-sitting checklist |

| Modified file | Change |
| --- | --- |
| `package.json` | `check:secrets` script |
| `.github/workflows/ci.yml` | `npm run check:secrets` after the build; header comment |
| `client/src/routes/SessionPage.tsx` (+ test) | Two counts in the progress line (D6); three tests |
| `client/src/i18n/locales/{en,hr}.json` | `session.confirmedCount_*`; the hr `history.errors.export` fix (D7) |
| `api/src/routes/extraction.integration.ts` | `GOLDEN_API_URL`, `quads` mode, `GOLDEN_KEEP` (D2, D12); the retained-response read and timing line factored into helpers the repeat A01 reuses |
| `PRD.md` | §6.7 real tree, §9.1 revoke applied, §9.2 duplicate line removed, §11.4 hosted measurements and cold start, §12 Phase 3/4 status |
| `.agents/ROADMAP.md` | Header, §2 rows 10 and 13, Task 13 D-list and DoD, §4 M1/M2/M5, §5 rows |
| `.agents/history/07`, `08`, `10`, `11`, `12` | Dated notes: committed and deployed, copy approved (D7), M-steps moved to the sitting |
| `.claude/commands/validate.md` (git-ignored) | 6.1/6.1b/6.2 replaced by `npm run check:secrets`; journey 9.12; Phase 10 emptied |

## Decisions

Implemented plan D1–D12 as written, except for the deviations below.

## Deviations and implementation findings

1. **D3 rule 4 would have failed on the public key.** It searched the bundle for the value of every
   non-`VITE_` variable ending in `KEY`, and `SUPABASE_PUBLISHABLE_KEY` holds the same value as
   `VITE_SUPABASE_PUBLISHABLE_KEY`, which is in the bundle by design (checked: 1 bundle file
   contains it). Raised in priming and fixed: a value equal to a `VITE_` value is not searched
   for, and the script prints a note naming the variable. **Narrowed in review** to values of the
   allow-listed `VITE_` names only (review finding S3).
2. **The URL mode follows references inside chunks, not only `index.html`'s.** The live
   `index.html` names only the entry JS and the CSS. The pdf.js worker is referenced as
   `/assets/…mjs` inside the entry chunk, and the pdf.js library as a lazy `./pdf-….js`, relative
   to it. Scanning only `index.html`'s assets would have skipped both. The script now follows
   `/assets/…`, `assets/…` and quoted `./…` references transitively.
3. **A referenced file that answers `404` is skipped with a note.** pdf.js contains the string
   `./qcms_bg.js`, a module the build never emits. The files `index.html` names must still answer
   `200`.
4. **The first cold start happened in step 1.** The step 1 health check found the API asleep:
   22.4 s, `uptimeSeconds` 14. It is recorded as cold start 1, and a second idle period gave
   cold start 2.
5. **Quads report the upload time separately.** The quad wall clock runs from the first upload
   request to the settled session, so it includes four uploads from this machine to Render, which
   the per-payslip server timings do not. Each quad line prints both.
6. **"Cap 3" counts analyses, not payslips.** PRD §11.4's "four payslips in parallel (cap 3)" was
   written for single-pass. With two passes, four payslips are eight analyses under
   `EXTRACTION_CONCURRENCY=3`. Measured as stated; the harness report and PRD §11.4 say so.
7. **The cold start figure replaces the PRD's.** §11.4's "30–50 s cold start" was not a measurement;
   it now gives this task's.
8. **The README says `SUPABASE_SECRET_KEY` is not a Render variable.** The API never reads it
   (`api/src/config.ts`); only integration tests and provisioning scripts do.
9. **The shell's `python - <<'EOF'` heredoc failed to parse** in the Bash tool once, before
   changing anything. The multi-line doc edits ran as scratchpad Python scripts instead.

## Validation

| Check | Result |
| --- | --- |
| Step 1 starting state | Clean apart from the untracked plan 13; last commit `9e66da4` (Task 12) |
| Baseline `npm run validate` | 72 files / **1089 tests**, green |
| `npm run build; npm run check:secrets` | `ok`; 4 bundle files, 7 markers, 4 server secret values searched; the publishable key noted and skipped |
| Bite-checks (step 2), scratch copies | (1) `VITE_AZURE_CONTENT_UNDERSTANDING_KEY=` → exit 1, named; (2) `AZURE_CU_API_VERSION=2025-11-01` → exit 1; (3) `SUPABASE_SECRET_KEY` literal in a copied asset → exit 1; (4) the real `AZURE_CONTENT_UNDERSTANDING_KEY` value in a copied asset → exit 1, naming it and `AZURE_OPENAI_KEY` (the same resource key); **the value is absent from the output**. Copies deleted |
| CI order check (step 3) | `ok`: `check:secrets` follows `build` |
| Progress tests (step 4) | The mixed and all-confirmed tests **failed against the old code** (2 failed, 3 passed); after the change, 6 files / 87 tests with i18n and History green |
| `npm run typecheck; npm run lint; npm run format:check` | Pass (one oxlint `consistent-function-scoping` finding in the new script, fixed) |
| Step 13 greps | One `EXTRACTION_TIMEOUT_MS, EXTRACTION_CONCURRENCY` line in PRD.md; no `layout-llm`, `compare-providers` or `record-provider-fixture` |
| `npm run test:integration` (hosted, $0) | auth 3, payslips 62, direct writes 4, unchanged |
| `npm run check:golden` | ALL IDENTITIES AND CHECKSUMS PASS |
| Final `npm run validate` | Typecheck, oxlint, Prettier, **72 files / 1091 tests** (+2: one renamed, two added) |
| Final `npm run build`, `npm run check:secrets` | Pass |
| README check | `ok 148` lines, required headings present (157 after the review session's fixes) |
| `git diff --check` | Clean |
| `package-lock.json` | Unchanged |

## Measurements

### Cold start (D4, $0)

| # | When (UTC) | Idle before | First `200` | `uptimeSeconds` | Notes |
| --- | --- | --- | --- | --- | --- |
| 1 | 2026-09-26 20:47:29 | since the planning session | **22.4 s** | 14 | The step 1 health check found it asleep |
| 2 | 2026-09-26 21:09:30 | 21.5 min, no request | **22.4 s** | 14 | Timed from a background `sleep 1290; curl` |
| 3 | 2026-09-26, review session | since the quads run | **22.3 s** | 9 | Unplanned; the next three warm checks answered in 0.11–0.13 s |

No `502`/`503` came back during either spin-up: the request was held until the instance answered.
The static client answered in **0.46 s** at the same moment. Render documents "about a minute";
this instance takes 22 s. The README's warming step cites it, and PRD §11.4's unmeasured "30–50 s"
is replaced.

### Live bundle (D3, $0)

`npm run check:secrets -- --url https://payslip-ocr-client.onrender.com` (the Task 12 deploy):
exit 0, **5 files scanned**: the entry chunk, the CSS, the pdf.js lazy chunk (`pdf-….js`), the
pdf.js worker (`pdf.worker.min-….mjs`), and `/assets/pdf.worker.mjs`. The last is pdf.js's default
worker name, which the build never emits. Render's SPA rewrite answers it with `index.html` (200,
538 bytes), so what got scanned is the page again, which is harmless. `/assets/qcms_bg.js`, also
named inside pdf.js, answers `404` and was skipped with a note (deviation 3). The check is
recorded again after this task's deploy by journey 9.12.

### Hosted quads (D2, PAID)

`GOLDEN_SET=hosted-quads GOLDEN_MODE=quads GOLDEN_API_URL=https://payslip-ocr-api.onrender.com
GOLDEN_KEEP=1 npm run test:extraction`, started 21:10:10 UTC, 190.7 s, **passed**. All eleven and
the repeat reached `review`/`ready`, and the blank page `failed` with `unreadable_document`. The API
was warm (uptime 34 s after cold start 2). No pass was resubmitted.

| Payslip | First form | Complete | Scalars: queued / analysis | Tables: queued / analysis |
| --- | --- | --- | --- | --- |
| A01 | 14.2 s | 56.6 s | 0.0 / 13.3 s | 0.0 / 55.1 s |
| A02 | 12.0 s | 39.2 s | 0.0 / 11.6 s | 19.2 / 19.5 s |
| A03 | 18.3 s | 33.8 s | 11.8 / 6.3 s | 24.7 / 8.7 s |
| A04 | 22.7 s | 65.5 s | 10.7 / 11.7 s | 32.1 / 33.0 s |
| B01 | 10.9 s | 10.9 s | 0.0 / 10.5 s | 0.0 / 6.2 s |
| B02 | 9.3 s | 11.8 s | 0.0 / 8.6 s | 0.0 / 10.9 s |
| C01 | 7.0 s | 17.7 s | 0.9 / 5.7 s | 8.3 / 9.2 s |
| D01 | 17.9 s | 17.9 s | 5.7 / 11.6 s | 9.4 / 6.2 s |
| E01 | 10.7 s | 10.7 s | 0.0 / 10.4 s | 0.0 / 5.7 s |
| F01 | 11.9 s | 22.2 s | 0.0 / 11.2 s | 12.0 / 10.0 s |
| G01 | 10.5 s | 17.8 s | 3.2 / 6.9 s | 10.6 / 6.8 s |
| A01 (repeat, not recorded) | 21.3 s | 68.0 s | 7.4 / 13.7 s | 17.3 / 50.5 s |

Submit times were 0.2–1.5 s throughout. Over the twelve: **first form p50 11.9 s, p90 21.3 s, max
22.7 s; complete p50 17.9 s, p90 65.5 s, max 68.0 s.**

| Quad | Samples | Wall clock | ≤ 25 s | Of which uploads |
| --- | --- | --- | --- | --- |
| 1 | A01, A02, A03, A04 | **73.3 s** | over | 5.7 s |
| 2 | B01, B02, C01, D01 | **32.4 s** | over | 14.3 s |
| 3 | E01, F01, G01, A01 | **73.2 s** | over | 3.8 s |

The wall clock runs from the first upload request to the settled session, polled every 2 s.

- **What sets the time:** the slowest payslip. A01's tables pass is 50–55 s of analysis by itself,
  with nothing queued ahead of it the first time, so no scheduling change brings a quad holding A01
  under 25 s. That is the generation rate, as in Task 05, not the concurrency cap.
- **The cap still costs something:** eight analyses at three at a time put up to 32 s of queueing in
  front of A04's tables pass.
- **Quad 2** settled about 18 s after its last upload. Its 14.3 s of uploads is the test machine's
  uplink carrying original bytes; B02 was the slow upload in Task 05 too. The client would have
  downscaled the photos first (Task 07), so a phone on a good connection would likely land near
  25 s. That is an inference, not a measurement.
- **Against Task 05:** one-at-a-time first form was p50 12.2 s. Here, four at a time on the deployed
  API, it was 11.9 s. The difference is noise. Complete p50 rose from 14.0 s to 17.9 s, which is the
  queueing.

Cost: the harness estimate is **$0.68** (30 analysis pages; 140,406 uncached + 82,688 cached input
tokens, 22,006 output; list prices), excluding the blank page's two analyses (one page each, a few
cents at most). That is about $0.045 per document page, in line with Task 05's two-pass figure.

### Accuracy on the deployed stack (step 10, $0)

`npm run score:extraction` scored `hosted-quads` as a two-pass set, exit 0.

| Set | Scalars | Critical | Line-item cells | OIB checksum |
| --- | --- | --- | --- | --- |
| `hosted-quads` | **270/273, 98.9%** | 74/77, 96.1% | **518/548, 94.5%** | 19/19, 100% |
| `two-pass-sequential` (Task 05) | 271/273, 99.3% | 75/77, 97.4% | 478/548, 87.2% | 19/19 |
| `two-pass-concurrent` (Task 05) | 268/273 | | 502/548 | |

The single-pass range is 270–272, and `hosted-quads` sits inside it, one field from
`two-pass-sequential`: that is what "within the noise band" means in the Outcome, PRD §11.4 and the
ROADMAP. Across all three two-pass sets the spread is 3 fields (1.1%), wider than the documented
~0.5%, because `two-pass-concurrent` (268) was already the low outlier in Task 05. No difference
here is larger than 1–3 fields, so none of it ranks anything.

- **F01's `employerName`** is null in the fixture (the name is covered by a page badge), and this
  run returned a value for it. It is the A04 occlusion case again: an invented value. The harness
  reports "wrong scalars flagged 3/3", so it carries an attention signal.
- **The line-item cells** are the best recorded (obustave 123/150 against 97/150 in
  `two-pass-sequential`). That is one run, and it says nothing more than that.

### Kept account (D12)

`task04-07e9fb84-7a1a-452a-81f2-3079a44d7fb9@example.test`. The password is the constant in
`api/src/routes/extraction.integration.ts`; it is not written here. It holds four sessions: the
three quads (all 11 golden documents, plus A01 twice) and the blank page, extracted by the
**deployed** code. M1 uses it. Delete it, and its storage objects, after the sitting (D12).

## Review session (2026-09-26)

`/code-review` against `9e66da4` (Standards and Spec axes in parallel), then `/validate`. $0: no
paid analysis was run.

### Findings and what was done

| # | Axis | Finding | Disposition |
| --- | --- | --- | --- |
| S1 | Standards | `check:secrets` local mode read only the top level of `dist/assets`, so `index.html` (where `%VITE_…%` lands) was never scanned | **Fixed**: every file under `--dist`, recursively; bite-checked with a marker in `index.html` |
| S2 | Standards | `--url` mode fetched `index.html` but never scanned it | **Fixed**: the page is scanned too (6 files on the live client, was 5) |
| S3 | Spec | Deviation 1 exempted a server value equal to *any* `VITE_` value, so a secret given a `VITE_` twin was silently not searched for | **Fixed**: only values of `ALLOWED` names are exempt; bite-checked both ways with a scratch `.env` of fake values |
| S4 | Standards | `GOLDEN_API_URL` with a trailing slash gave `//api/…`; the health error hard-coded "90 s" | **Fixed**: trailing slashes stripped; the message derives from `HEALTH_CAP_MS` |
| D1 | Spec | ROADMAP §2 row 13 omitted the pending review; §4 M3 still said 44 px and did not point at the sitting; §5 residual-latency row missed a sentence break; §5 inherited gaps lacked the measured cold start | **Fixed** |
| D2 | Spec | README: `test:extraction` cost below this task's $0.68; "warm health well under a second" unmeasured; `db:provision-storage` missing from Scripts; "`validate` is what CI runs" loose | **Fixed**; warm health measured (0.11–0.13 s, cold start 3 above) |
| D3 | Spec | This file: README line count, "kept account below", and the noise-band sentence contradicting the Outcome | **Fixed** |
| — | Standards | `.env.example` parser ignores `export X=` and spaced forms; short secrets skipped without a note; a missing `.env.example` throws a stack trace | Not changed: `.env.example` is this repo's own file in `NAME=` form, and a crash still exits non-zero |
| — | Standards | Quads test timeout (20 min) below the worst-case sum of poll caps (24 min); the A01 repeat duplicates the per-fixture tally; `quads` branches in four places | Not changed: the harness is paid and ran once green; judgement calls, left for whoever next touches it |
| — | Spec | The URL crawler's "scanned" count includes SPA-rewritten `index.html` answers for unemitted names | Not changed: harmless, already noted under Live bundle |
| — | Both | D6 hides "0 ready" whenever something is confirmed, not only when all are | As planned (plan 13 D6); journey 9.12 read it in both languages |

### Validation

| Phase | Result |
| --- | --- |
| 0 `npm install` | OK, no `ERESOLVE`; lockfile unchanged |
| 1–3 lint, typecheck, format | Pass (the two edited files re-formatted and re-checked) |
| 4 `npm test` | **72 files / 1091 tests**; per project shared 299, api 385, client 407 |
| 5 `npm run build` | Pass: `index.html`, entry JS, CSS, pdf.js chunk and worker |
| 6.1 `check:secrets` | Local: 5 files (index.html now included), 4 secret values; bite-checks 1–4, `index.html` and both twin cases exit as expected, the real key's value absent from output. `--url` live client: 6 files, ok |
| 6.3–6.26 | All pass (6.22, 6.24, 6.26 re-run under bash: PowerShell 5.1 mangles their embedded quotes) |
| 7 | `check:golden` pass; `score -- cu` 281/284 98.9%; `score:extraction` exit 0, six sets 268–272/273; analyzer drift check matches both analyzers |
| 8 `test:integration` | Hosted: auth 3, payslips 62, direct writes 4. Orphans: only the D12 kept account and `m1-review-08` |
| 8.1 | Migrations match the 7 local files; advisors only lint 0029 on the definer functions (by design) and leaked-password protection (known gap) |
| 9.2–9.4 | Health direct and through the Vite proxy; `404 not_found`; `401 unauthorized` on both prefixes; signed-out `/` → `/login`; sign-in lands on `/`; reload stays signed in. The sign-out click was not exercised (the menu's ref changed); `AppLayout.test.tsx` covers it |
| 9.5 | 375 px: bottom bar only, no dialog, no horizontal scroll, every header control ≥ 44 px; 1440 px: sidebar only; one current link per navigation |
| 9.6–9.11 | **Not re-run.** Paid journeys for Tasks 07–12, each passed in its own review session; this diff touches none of their flows except the session header, which 9.12 covers |
| 9.12 local | Seeded review + confirmed. "1 of 2 ready to review · 1 of 2 confirmed" / "1 od 2 spremno za pregled · 1 od 2 potvrđena" at 375 px; after Confirm "2 od 2 potvrđene" / "2 of 2 confirmed"; `hr` History with the export aborted: "Izvoz nije moguće izraditi. Pokušajte ponovno.", detail in the console. Account deleted, orphan query clean |

### Commit, deploy and journey 9.12 (deployed)

Committed as `5ef0325` and subtree-pushed to `payslip-github` (`main` → `e69fe3f`). CI passed, including
`check:secrets`: Render deploys only after it, and the client's entry chunk changed from
`index-BNfLvqi2.js` to `index-Ch9rshF-.js` 80 s after the push (`gh` is not installed here, so the
new bundle is the evidence).

| Step | Result |
| --- | --- |
| 1 `check:secrets -- --url` | ok: 6 files, 7 markers, 4 secret values; the live chunk carries the `confirmedCount` copy |
| 2 Seed | Throwaway account, one `review` and one `confirmed` payslip, no sources |
| 3 Header at 375 px | "1 of 2 ready to review · 1 of 2 confirmed" / "1 od 2 spremno za pregled · 1 od 2 potvrđena" |
| 4 After Confirm | "2 od 2 potvrđene" / "2 of 2 confirmed" |
| 5 `hr` History, export aborted | "Izvoz nije moguće izraditi. Pokušajte ponovno." |
| 6 Clean-up | Account deleted; orphan query lists only the D12 kept account |

## Device sitting (product owner, after the deploy)

Run **after** the Task 13 commit is deployed. First check that the session header shows two counts
("… ready to review · … confirmed") once a payslip is confirmed; if it does not, the deploy has
not landed.

| | |
| --- | --- |
| Device model | |
| Android version | |
| Chrome version | |
| Date | |

### M5 — PRD §11.1 on the deployed app

| # | Step | Verdict | Notes |
| --- | --- | --- | --- |
| 1 | Sign in on the phone, photograph a payslip, note the clock time the form appears | | |
| 2 | Outlines present; tapping a field scrolls the preview to it | | |
| 3 | Upload three more at once; move between all four, editing one before switching; the edit survives | | |
| 4 | Correct two values, confirm all four, download JSON; it has the line-item tables | | |
| 5 | Re-open the session on a later day (or record that it was the same day and cite Task 12's API-level proof) | | |

Timings, filled in afterwards by the agent from each payslip's `extraction_metadata` (D1):

| Payslip | First form (s) | Complete (s) | Notes |
| --- | --- | --- | --- |
| | | | |

### M2 — keyboard on Android Chrome

| Check | Verdict | Notes |
| --- | --- | --- |
| Focus a scalar field: the preview collapses to the 64 px strip showing that field's region; value, region and keyboard visible together | | |
| Focus a line-item table cell: the same | | |
| Dismiss the keyboard with Back: strip mode stays until focus leaves the input (the known Android limitation, history/10 open item 2) | | |
| iOS Safari / Chrome on iOS | **not run, no device** | ROADMAP §5 "iOS keyboard fallback unverified" |

### M3 — capture sub-steps

| Sub-step | Verdict | Notes |
| --- | --- | --- |
| Camera denial: deny the permission; "Odaberi datoteku" still works | | |
| Retake | | |
| Rotation: photograph at 90°; outlines sit on the text, or are withheld with a note | | |
| One-handed reach on the 48 px controls | | |

### M1 — outline spot-check, desktop

Signed in as the kept account above ("Kept account (D12)"). Verdict: pass / misplaced / withheld.

| Sample | Verdict | Notes |
| --- | --- | --- |
| A01 | | |
| A02 | | |
| A03 | | |
| A04 | | |
| B01 | | |
| B02 | | |
| C01 | | |
| D01 | | Known: `paymentDate` carries a service source inside the employer address (history/08) |
| E01 | | |
| F01 | | |
| G01 | | |

### Defects found

| Step | What | Evidence | Product owner's decision (fix in Task 13 / limitation) |
| --- | --- | --- | --- |
| | | | |

## Open items

1. **Four in parallel is missed** (73.3 / 32.4 / 73.2 s). It is recorded under ROADMAP §5 "Residual
   latency". The lever is A01-class tables passes (50–55 s), which is the service's generation
   rate, and it needs its own plan and paid runs.
2. **F01's invented `employerName`** on this run. It was flagged, but it confirms again that an
   occluded field can come back filled in. It is the same class as A04, and is a known limitation,
   not new.
3. **The device sitting:** M5, M2 on Android, M3's four sub-steps and M1. All pending, and all after
   the deploy.
4. **Journey 9.12** is new in `validate.md`, which is git-ignored. Its local variant belongs to the
   review session, and its deployed variant runs after the deploy.
5. **The quad harness uploads original bytes**, unlike the client, which downscales large images
   first. Quad 2's upload share would be smaller from the app. It is noted rather than changed,
   because the harness measures the server as it receives a file.

## Review-session handoff

1. ~~`/code-review` over the uncommitted diff against `9e66da4`, and `/validate`, including journey
   **9.12's local variant**~~ — done, see "Review session" above.
2. ~~Commit and subtree push~~ — `5ef0325`, plan 13 included.
3. ~~CI passes and Render deploys~~ — done.
4. ~~Journey 9.12 against the deployed stack~~ — passed, see "Commit, deploy and journey 9.12".
5. The device sitting above.
6. D12 clean-up, each deletion approved by the product owner: the kept account below and its
   storage objects, and `m1-review-08@example.test` if it still exists. The M5 phone data only if
   asked.
7. D10: ROADMAP §2 row 13 → complete, header `Status` → Complete.
