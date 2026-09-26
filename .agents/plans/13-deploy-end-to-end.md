# Feature: Task 13 — Deploy & end-to-end verification

The following plan should be complete, but validate documentation and codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utilities,
types and scripts, and import from the right files.

This is the **last roadmap task**. It is mostly measurement, verification and documentation. It
has three small code changes: a committed secret guard in CI, the session progress copy, and a
hosted mode for the existing paid extraction harness.

## Feature Description

Every product feature is built, reviewed, validated and deployed. The mirror
`FraneKuzmanic/payslip-ocr` `main` is at Task 12, and Render serves it:
`https://payslip-ocr-api.onrender.com/api/health` → `200`, and
`https://payslip-ocr-client.onrender.com` → `200`, both checked on 2026-09-26. What is missing is
**evidence that the deployed product does what PRD §11 promises**, and **a clean handoff**.

1. PRD §11.1's journey on the deployed app from a real phone, with its timings recorded.
2. PRD §11.4's "four payslips in parallel ≤25 s", measured as stated on the hosted stack. It has
   never been measured as stated.
3. Cold-start behaviour measured, and the warming step a demo operator needs written down.
4. The rule that no secret reaches the client bundle, enforced in CI rather than only in a
   git-ignored command file, and checked against the live bundle.
5. The README that PRD §6.7 lists, open since Task 01.
6. Closing out: stale docs corrected, the session progress copy fixed, the open manual steps (M1,
   M2, M3) run in one device sitting where a device exists for them, and every leftover gap
   collected into one Known limitations list.

## User Story

As a **demo operator** showing the prototype to a stakeholder
I want to **know that the deployed app works end to end on a phone, how fast it is, and how to
warm it before I start**
So that **the demo does not stall, and every limitation is one I already know about**.

## Problem Statement

- Nothing has verified the §11.1 journey on the **deployed** stack from a **real phone**. The
  Task 07–12 journeys ran locally or in desktop Chromium.
- PRD §11.4's four-in-parallel target has no measurement. Task 05 measured one payslip at a time
  and eleven at once, locally.
- The no-secret checks (validate.md 6.1, 6.1b, 6.2) live in `.claude/commands/validate.md`, which is
  **git-ignored**. CI never runs them, and a fresh clone does not have them.
- There is no README. PRD §6.7's repository tree names files that were never built.
- History 10, 11 and 12 still say "Not committed", and PRD §9.1 and the Phase 3 status are stale.
- The session header says "1 of 1 ready to review" for a **confirmed** payslip (history/12,
  "Observed, not changed").
- M1 (Task 08), M2 (Task 10) and the M3 sub-steps (Task 07) are open. **The product owner has no
  iPhone**, so M2 as written cannot be run.

## Solution Statement

- **Code (small, all unit-tested):**
  - `scripts/check-client-secrets.mjs`, run by CI after the build, able to scan the live bundle;
  - a two-count session progress line;
  - one Croatian wording fix;
  - a hosted target and a `quads` mode for `api/src/routes/extraction.integration.ts`.
- **Measurement (paid, logged):** all 11 golden-set payslips through the **deployed API**, in
  three sessions of four uploaded as the client does. This gives the four-in-parallel wall clock
  three times, the per-payslip first-form and complete times, and a recording set that
  `npm run score:extraction` scores **at $0**, so accuracy on the deployed stack is also measured.
  The run's account is **kept** as the corpus for the device sitting and M1.
- **Measurement ($0):** a real cold start of the API, and a scan of the live client bundle for
  the local `.env`'s server-only secret values.
- **Docs:** a concise operator README, the stale-doc fixes, and ROADMAP §4 and §5 rewritten into a
  closing state.
- **Human:** one device sitting **after the deploy** of this task's commit. It covers M5 (the new
  §11.1-on-a-phone step), M2 rescoped to Android Chrome, M3's four sub-steps and M1 on desktop. It
  is recorded in `history/13` against a checklist this session writes. This session does **not**
  run it.

## Feature Metadata

**Feature Type**: Enhancement (verification, documentation, CI hardening, one copy fix)
**Estimated Complexity**: Medium. The code is low; the measurements and docs carry the risk.
**Primary Systems Affected**: CI (`.github/workflows/ci.yml`), `scripts/`, `client/src/routes/SessionPage.tsx`, i18n
locales, `api/src/routes/extraction.integration.ts`, README, PRD, ROADMAP, history files
**Dependencies**: none new. `supertest` accepts a URL string as well as an app; global `fetch`
(Node ≥ 18) serves the live-bundle scan.

---

## DESIGN DECISIONS

Settled with the product owner in the planning session, 2026-09-26. Do not reopen.

### D1 — §11.1 step 1 ("within about ten seconds") is recorded, not gated (product owner)

The first-form time on the deployed journey is **measured and recorded** against the accepted
Task 05 miss (p50 12.2 s, accepted 2026-09-25). The journey passes if the form arrives and is
usable. The ROADMAP §5 "Residual latency" risk stays open for a later phase. Timings come from
the database (`extraction_metadata.<pass>.queuedMs + latencyMs`, Task 05 D2), not a stopwatch.

### D2 — Four in parallel: measured on the hosted stack, all 11 samples, three times (product owner, planner)

The product owner lifted the usual cap for this task: "spend how much is necessary … so we can
test what we need the proper way". Design:

- **Target:** the deployed API `https://payslip-ocr-api.onrender.com`, warmed first. It uses the same
  Supabase project and the same Azure analyzers as local.
- **Harness:** the existing paid golden run, `api/src/routes/extraction.integration.ts`, gains:
  - `GOLDEN_API_URL`: when set, every request goes to that URL instead of the in-process app;
  - `GOLDEN_MODE=quads`: three sessions of four payslips. Each session's files upload
    **sequentially, as the client does** (Task 07 D3) and settle before the next session starts;
  - `GOLDEN_KEEP=1`: skip the `afterAll` clean-up and print the account's email (see D12).
- **Grouping** (fixtures sorted by sample):
  - quad 1: A01, A02, A03, A04;
  - quad 2: B01, B02, C01, D01;
  - quad 3: E01, F01, G01, plus **A01 again**, the heaviest document (two pages, 23 pay
    components), so the third quad also has four. The repeat is timed but **not recorded**, so the
    recording set stays one file per sample.
  - The blank-page sibling-isolation check runs last, in its own session, as in `sequential` mode.
- **Reported per quad:** the client wall clock from the first upload request to the settled
  session (poll resolution 2 s, stated), and for each payslip the first form
  (`scalars.queuedMs + latencyMs`) and complete (max of both passes) times. Reported overall: first
  form and complete p50/p90/max over the 12, the three quad wall clocks against **≤25 s**, and the
  estimated cost.
- **Accuracy for free:** the run records `.bakeoff/hosted-quads/`, and `npm run score:extraction`
  scores it with the other two-pass sets. Accuracy on the deployed stack is then measured at $0.
  Accuracy is reported, never gated (PRD §11.3). The noise band is ~0.5%.
- **Budget:** 12 two-pass analyses plus the blank page, about **$0.65**, logged in history/13.
  One re-run is allowed if a run is invalidated by something other than the product (for
  example a Render redeploy mid-run, or the machine sleeping), and the log must say why. The
  result is recorded **whatever it is**. A miss is expected at today's generation rate and goes
  under §5 "Residual latency". It is not a reason to change code in this task.

### D3 — The secret guard becomes a committed script run in CI (product owner)

`scripts/check-client-secrets.mjs`, plain Node ESM with no dependencies, run as `npm run check:secrets`.

1. **`.env.example` allow-list** (validate.md 6.1): a `VITE_` name ending in
   `KEY|SECRET|TOKEN|PASSWORD` fails unless it is in `ALLOWED = {VITE_SUPABASE_PUBLISHABLE_KEY}`.
   The publishable key is public by design (the `.env.example` comment explains why).
2. **Names only** (validate.md 6.1b): any variable outside `{PORT, NODE_ENV, LOG_LEVEL,
   WEB_ORIGIN}` with a non-empty value fails.
3. **Bundle markers** (validate.md 6.2): every file in `client/dist/assets` is scanned for
   `SERVICE_ROLE`, `service_role`, `SUPABASE_SECRET_KEY`, `AZURE_CONTENT_UNDERSTANDING_KEY`,
   `AZURE_DOCUMENT_INTELLIGENCE_KEY`, `AZURE_OPENAI_KEY` and `eyJhbGciOi`.
4. **Real values, locally only:** when a `.env` exists, the **values** of every non-`VITE_`
   variable whose name ends in `KEY|SECRET|TOKEN|PASSWORD`, plus `DATABASE_URL`, must not appear in
   any scanned file. CI has no `.env`, so this is skipped there with a printed note. Never print a
   value, only the variable's name.
5. **`--url <client origin>`:** instead of `client/dist`, fetch the live `index.html`, collect
   every `<script src>` and `<link href>` under `/assets/`, and scan those files the same way.
   This is how the DoD is checked against what Render actually serves.

Flags: `--env-example <path>` and `--dist <dir>` exist only so the "does it still bite" checks
can point at a scratch copy. Exit 1 lists every problem at once, as `api/src/config.ts` does. CI
runs it **after** `npm run build`. The validate.md 6.1, 6.1b and 6.2 blocks are replaced by one
call to the script.

### D4 — Cold start: measured and documented, no code (product owner)

Measure a real cold start of `payslip-ocr-api`, the free tier spinning down after 15 minutes idle:

- let it idle ≥ 20 minutes;
- time `GET /api/health`;
- confirm the restart by a small `uptimeSeconds`.

Do this **twice**, on separate idle periods, and also time the client's static `index.html`, which
does not sleep. Document the warming step in the README: open `/api/health` and wait for
`{"status":"ok"}` before the demo. Also say that the idle timer restarts on any request, so warm it
within 15 minutes of starting. No warm-up ping and no script.

### D5 — One device sitting, after the deploy, only for what a real device can prove (product owner)

The product owner's rule for this task: **drop what cannot be tested or validated**. The product
owner has an **Android phone only** (a Samsung with Chrome, per history/07 M3) and no iPhone.

| Step | What | Where it is recorded |
| --- | --- | --- |
| **M5** (new) | PRD §11.1 on the deployed app from the Android phone | `history/13` |
| **M2** (rescoped) | Keyboard behaviour on **Android Chrome**, which honours `interactive-widget=resizes-content`: focused field, collapsed 64 px strip showing that field's region, value and keyboard visible together. **iOS Safari and Chrome on iOS are not run**; their `visualViewport` fallback goes to Known limitations as unverified | `history/10` |
| **M3** | The four sub-steps not yet run: camera denial falls back to file choice, retake, rotation, one-handed reach on the 48 px controls | `history/07` |
| **M1** | Outline spot-check of all 11 golden documents on desktop, in the D12 account | `history/08` |

- **No speculative code** for anything a device in the sitting cannot confirm.
- A defect **found** in the sitting is reported to the product owner with evidence. It is not
  fixed silently. Whether it is fixed in Task 13 or listed as a limitation is the product owner's
  call.
- **The sitting happens after this task's commit is deployed**, because it must see the new
  progress copy. This session writes the checklist (step 14) and **does not run it**.

### D6 — Session progress: two counts (product owner, planner refinement)

- `ready` counts **only** `review`. A new `confirmed` count counts `confirmed`.
- Shown:
  - `"{ready} of {total} ready to review"`, **unless** `ready === 0 && confirmed > 0`;
  - then, when `confirmed > 0`, `"{confirmed} of {total} confirmed"`;
  - joined by ` · ` inside the same `role="status"` element.
- Examples:
  - 2 review, 1 confirmed, 1 processing → "2 of 4 ready to review · 1 of 4 confirmed";
  - all 4 confirmed → "4 of 4 confirmed";
  - nothing ready yet → "0 of 4 ready to review" (unchanged).
- The ` · ` separator is language-neutral punctuation. Putting it in code is acceptable, because
  the same character sits between two translated strings in both languages.
- The planner refinement: when nothing is waiting for review, the "0 of N ready to review" part is
  hidden. The product owner's choice ("confirmed part shown only when > 0") did not say this; it is
  the planner's.
- New key `session.confirmedCount`, plural on `count`, with `total` interpolated:
  - en `_one` / `_other`: `"{{count}} of {{total}} confirmed"`;
  - hr `_one`: `"{{count}} od {{total}} potvrđena"`;
  - hr `_few`: `"{{count}} od {{total}} potvrđene"`;
  - hr `_other`: `"{{count}} od {{total}} potvrđenih"`.

  `i18n.test.ts` already requires CLDR categories: en has one/other, hr has one/few/other.
  `session.progress` keeps its text; only its count changes meaning.

### D7 — Copy read-through: approved, one hr fix (product owner)

- The `merge.*` and `history.*` copy is **approved** as it stands, in both languages.
- One change: `history.errors.export` hr, `"Izvoz nije bilo moguće stvoriti. Pokušajte ponovno."`
  → `"Izvoz nije moguće izraditi. Pokušajte ponovno."`, matching the other errors' "nije moguće".
- Record the approval in history/11 and history/12, whose "Still open" lines list the read-through.

### D8 — README: concise operator README (product owner)

About 150–250 lines at the project root, `README.md`. Link to the PRD, CONTEXT, the ADR and the
ROADMAP rather than restating them. Contents in step 12.

### D9 — Stale docs corrected; PRD §6.7 shows the real tree (product owner)

Listed in full in step 13. PRD §6.7's "Suggested repository structure" is **replaced by the real
tree**, generated from `git ls-files` and trimmed to directories and key files, with a one-line
note that the original suggestion is in git history.

### D10 — Close out the roadmap (product owner)

- ROADMAP §5 becomes the single list of what stays open, each row with a status.
- The README's "Known limitations" section summarises it and links to it.
- ROADMAP §2 Task 13 reads **"implemented; device sitting pending"** until the sitting is
  recorded, then **"complete"**, and the header `Status` becomes **Complete**.
- The product owner then plans the next iteration from their own testing. The ROADMAP header
  gains a line saying that later work is planned as new iterations, not new rows in this table.

### D11 — Session split (standing rule)

This implementing session:

- runs the ordinary checks: unit tests, typecheck, lint, format, build, the new script, the $0
  integration suite;
- runs the paid hosted measurement (D2) and the cold-start and live-bundle measurements (D4, D3),
  which **are** this task's work;
- writes history/13;
- **stops.**

It does **not** run `/code-review`, `/validate` or a browser journey, and it does **not** commit.
Order after it:

1. the review session;
2. commit and subtree push, on the product owner's go-ahead;
3. CI passes, including the new step, and Render deploys;
4. the device sitting (D5), recorded in history/13;
5. the D12 clean-up;
6. the ROADMAP close (D10).

### D12 — The hosted run's account is the corpus for the sitting (planner)

- `GOLDEN_KEEP=1` leaves the D2 run's account with all 11 golden documents extracted by the
  **deployed** code, plus the failed blank page, in four sessions. M1 uses it, and M5 may use it
  to find payslips from "a previous day".
- The account is `task04-<uuid>@example.test`, with the password constant in
  `extraction.integration.ts`.
- **Record the email in history/13. Never write a password into a committed file**: the password is
  already in the committed harness, so refer to it by its location only.
- Clean-up after the sitting:
  - delete this account and its storage objects;
  - delete the Task 08 M1 account `m1-review-08@example.test` if it still exists, since M1 no
    longer needs it;
  - delete the product owner's M5 phone data only if they ask.

  All clean-up uses the admin key, and the product owner approves each deletion.
- The harness's own `afterAll` clean-up stays the default.

---

## CONTEXT REFERENCES

### Relevant Codebase Files IMPORTANT: YOU MUST READ THESE FILES BEFORE IMPLEMENTING!

- `AGENTS.md`: conventions and §7 git remotes. The mirror is pushed with `git subtree push`.
- `.agents/ROADMAP.md` §1 (locked decisions), §3 Task 13, §4 (manual steps table), §5 (risks).
- `.agents/history/12-export-history.md`: the most recent record. Mirror its structure for
  history/13, and read its "Observed, not changed" section (the progress copy).
- `.agents/history/05-extraction-latency-two-pass.md` lines 40–60 and 125–140: how first form and
  complete are defined (D2) and the R3 eleven-at-once figures to compare with.
- `.agents/history/08-source-regions-preview.md` lines 286–320: the agent's production pre-check
  table that M1's table mirrors, and the D01 `paymentDate` finding.
- `.agents/history/07-capture-multi-upload.md` lines 280–295: the M3 table with four "not run" rows.
- `.agents/history/10-session-navigation-phone-layout.md` lines 116–140 and 200–208: M2's open
  items.
- `api/src/routes/extraction.integration.ts` (whole file, ~330 lines): the paid golden run to
  extend.
  - Lines 41–60: env vars and recording.
  - Line 93: `const app = createApp()`.
  - Lines 116–121: `afterAll`.
  - Lines 127–166: the modes.
  - Lines 183–230: recording and timings.
  - Lines 246–285: `createSession`, `upload`, `settle`.
- `scripts/run-supabase-integration-tests.mjs` lines 8–45: `--extraction` runs only that file, and
  the child inherits `process.env`, so the `GOLDEN_*` variables pass through.
- `scripts/score-extraction.ts` lines 1–20: it discovers every `.bakeoff/<set>/`, so a new two-pass
  set is scored with no change.
- `client/src/routes/SessionPage.tsx` lines 300–320: the progress computation and render.
- `client/src/routes/SessionPage.test.tsx` lines 375–388: the progress test to update.
- `client/src/i18n/locales/en.json` and `hr.json`: `session` block, around lines 190–208 in hr;
  `history.errors.export`.
- `client/src/i18n/i18n.test.ts`: key parity and CLDR plural categories. The new plural key must
  satisfy it.
- `.github/workflows/ci.yml`: add the step after `npm run build`, and update the header comment.
- `.env.example`: the variable names the guard reads, and its comment on the publishable key.
- `api/src/config.ts` around line 74: the "report every problem at once" pattern to mirror.
- `.claude/commands/validate.md` §6.1, §6.1b, §6.2 (lines 237–275): the checks to port, verbatim
  in logic. Also §9.11 (lines 830–868) as the shape of a journey, and Phase 10 (line 869).
- `render.yaml`: the manual Render env vars the README must list.
- `PRD.md` §6.7 (lines 419–465), §9.1 (lines 685–689), §9.2 (lines 691–714), §11.1, §11.4
  (lines 815–841), §12 Phase 3/4 status blocks (lines 882–921).
- `../receipt-ocr/README.md` sections "Deployment" (line 144) and "Known limitations" (line 185)
  only, as a tone reference. Do **not** copy its length.

### New Files to Create

- `scripts/check-client-secrets.mjs`: the D3 guard.
- `README.md`: the D8 README.
- `.agents/history/13-deploy-end-to-end.md`: the completion record, including the device-sitting
  checklist.

### Relevant Documentation YOU SHOULD READ THESE BEFORE IMPLEMENTING!

- [supertest README: "You may pass an http.Server, or a Function to request() … or a URL string"](https://github.com/forwardemail/supertest#example).
  This is why `request(target)` works with `GOLDEN_API_URL`.
- [Render: free instance spin-down](https://render.com/docs/free#spinning-down-on-idle). Spins
  down after 15 minutes without inbound traffic; spin-up takes about a minute. Cite this in the
  README next to the measured figure.
- [Vite env variables and modes: only `VITE_`-prefixed variables are exposed](https://vite.dev/guide/env-and-mode.html#env-variables).
  This is the basis of the D3 rule.
- [MDN `interactive-widget`](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/meta/name/viewport#interactive-widget).
  Chrome for Android supports it (since 108); Safari does not. This is why M2 on Android proves
  only the primary path.

### Patterns to Follow

**Script style.** Plain Node ESM in `scripts/*.mjs`, such as `scripts/provision-storage.mjs` and
`scripts/run-supabase-integration-tests.mjs`. Use `node:` imports, a leading doc comment on
purpose and exit codes, `console.error` for problems, and `process.exit(1)`.

**Collect every problem, then fail once** (`api/src/config.ts`):

```ts
problems.push(`${name} is required`);
// … after the loop:
if (problems.length > 0) throw new Error(problems.join("; "));
```

**Harness report lines** (`extraction.integration.ts`): `report()` writes past Vitest's console
capture, and `secs()` formats milliseconds. Reuse both, and reuse `percentiles` from
`../scoring/score.js` for p50/p90/max.

**Plural keys:** see `upload_one` / `upload_few` / `upload_other` in `hr.json` around line 182.

**Status line:** the progress `<p role="status">` stays one element. Build its text from the two
translated parts.

**History file tables:** `| Check | Result |` and `| Sample | Verdict | Notes |`, as in
history/08 and history/12.

---

## IMPLEMENTATION PLAN

### Phase 1: Guard and copy (code, $0)

Steps 1–5: the starting state, the secret script and CI, the progress copy, the hr fix.

### Phase 2: Hosted harness and measurements

Steps 6–10: the harness modes, then the cold start, the live-bundle scan, the paid hosted run and
its scoring.

### Phase 3: Docs and handoff

Steps 11–16: validate.md, README, stale docs, the device checklist, the ROADMAP, the final checks
and history/13, then STOP.

---

## STEP-BY-STEP TASKS

Execute in order. Run each step's VALIDATE before moving on.

### 1. VERIFY the starting state

- `git status --short` is clean on `prototype/payslip-ocr`.
- `git log -1 --format=%s` is `feat(payslip-ocr): export and history (Task 12)`, or a later
  docs-only commit that adds this plan.
- Deployed health: `curl -s https://payslip-ocr-api.onrender.com/api/health` gives `{"status":"ok",…}`.
  Note `uptimeSeconds`, because it tells you when the last restart was.
- Baseline `npm run validate`: expect 72 files / 1089 tests, green. Record the count.
- **VALIDATE**: `npm run validate`

### 2. CREATE `scripts/check-client-secrets.mjs` and ADD `check:secrets` (D3)

- **IMPLEMENT**:
  - The five behaviours in D3. Structure: `parseArgs` (from `node:util`) for `--env-example`,
    `--dist` and `--url`; `checkEnvExample(text)` → problems; `collectBundle()` → `[{name, text}]`
    from disk or from `--url`; `scanBundle(files, markers, secretValues)` → problems.
  - Parse `.env` with a simple `NAME=value` line split. **Do not** add `dotenv`; `node:util`'s
    `parseEnv` exists in Node ≥ 20.12 (check `.nvmrc` and use it if available).
  - Skip empty secret values and values shorter than 8 characters, so a blank or a trivial value
    never matches everything.
  - Report names only, never values.
  - Print `ok: …` lines per check on success, as validate.md's checks do.
  - With no `client/dist` and no `--url`, exit 1 with "run npm run build first", as 6.2 does.
- **ADD** to root `package.json` scripts:
  `"check:secrets": "node scripts/check-client-secrets.mjs"`.
- **GOTCHA**: the URL mode must resolve asset paths against the origin (`new URL(src, origin)`).
  Vite emits absolute `/assets/…` paths.
- **GOTCHA**: `.env` values may be quoted. Strip one pair of matching quotes.
- **VALIDATE**:
  - `npm run build; npm run check:secrets` → all `ok`, and the local-values check runs, because
    `.env` exists here.
  - **It still bites**, using scratch copies and leaving the tracked files alone:
    1. copy `.env.example` to the scratchpad and append `VITE_AZURE_CONTENT_UNDERSTANDING_KEY=`,
       then run `node scripts/check-client-secrets.mjs --env-example <copy>` → exit 1, naming it;
    2. append `AZURE_CU_API_VERSION=2025-11-01` to a copy → exit 1 (names only);
    3. copy `client/dist` to the scratchpad, append the literal `SUPABASE_SECRET_KEY` to one asset,
       then `--dist <copy>` → exit 1;
    4. append the **real** `AZURE_CONTENT_UNDERSTANDING_KEY` value to a copied asset →
       exit 1, and the output contains the variable **name** but not the value (check with
       `Select-String` for the value in the output: no match).

    Delete the scratch copies afterwards.

### 3. UPDATE `.github/workflows/ci.yml` (D3)

- **ADD** after `- run: npm run build`: `- run: npm run check:secrets`.
- **UPDATE** the header comment: CI now also enforces the client-secret rule. The golden set, the
  score and the hosted integration still stay in `/validate`.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('.github/workflows/ci.yml','utf8'); if(!/npm run build\s*\n\s*- run: npm run check:secrets/.test(s)) throw new Error('check:secrets must follow build'); console.log('ok')"`

### 4. UPDATE the session progress (D6)

- **UPDATE** `client/src/routes/SessionPage.tsx` around lines 305–319:
  - `ready` filters `status === "review"` only;
  - add `confirmed` for `status === "confirmed"`;
  - render the parts per D6 into the existing `<p role="status">`.
- **ADD** `session.confirmedCount_*` to both locales (D6 strings). Do not change
  `session.progress`.
- **UPDATE** `client/src/routes/SessionPage.test.tsx`:
  - rename the test at line 375 to "counts review as ready and confirmed separately";
  - with the same fixture (a review, b confirmed, c processing, d failed), expect
    `"1 of 4 ready to review · 1 of 4 confirmed"`;
  - **ADD** a test where every payslip is confirmed, expecting exactly `"2 of 2 confirmed"`, with
    no "ready to review";
  - **ADD** a test where none is confirmed, expecting no "confirmed" text.
- **ADD** an hr rendering check in the same file if the file already renders in hr anywhere;
  otherwise leave hr to `i18n.test.ts` and the review session's journey.
- **GOTCHA**: `total` already includes pending upload items. Keep it as is.
- **VALIDATE**: `npx vitest run client/src/routes/SessionPage.test.tsx client/src/i18n` → green.
  Run the new "all confirmed" test against the old code first, and confirm it fails.

### 5. UPDATE `history.errors.export` hr (D7)

- `"Izvoz nije moguće izraditi. Pokušajte ponovno."`.
- **VALIDATE**: `npx vitest run client/src/i18n client/src/routes/HistoryPage.test.tsx` → green.
  If any test asserts the old hr string, update it.

### 6. ADD the hosted target, `quads` mode and `GOLDEN_KEEP` to `api/src/routes/extraction.integration.ts` (D2, D12)

- **IMPLEMENT**:
  - `const GOLDEN_API_URL = process.env.GOLDEN_API_URL ?? "";` and
    `const target = GOLDEN_API_URL === "" ? createApp() : GOLDEN_API_URL;`. Replace every
    `request(app)` with `request(target)`. Validate the URL shape in `beforeAll`, which must be
    `https://`, and refuse otherwise.
  - In hosted mode, `beforeAll` first does `GET /api/health`. It must be `200` within 90 s; retry
    each 5 s, because a cold start is allowed to finish. Report its `uptimeSeconds`, then continue.
  - Accept `quads` in the `GOLDEN_MODE` check, and give it the sequential-mode test timeout (20 min).
  - The quads branch:
    - build `[[A01..A04],[B01,B02,C01,D01],[E01,F01,G01,A01]]` from `fixtures` by index
      (`[0..3]`, `[4..7]`, `[8,9,10,0]`);
    - for each quad: `createSession()`; `t0 = Date.now()`; upload the four **sequentially**;
      `settle()`; `wall = Date.now() - t0`;
    - keep the repeat's id under the key `A01#2`, and exclude it from `ids`, so the recording loop
      stays one per sample;
    - collect `{quad, wall, payslipIds}`;
    - then the blank in its own session, settled.
  - After the existing per-fixture recording and report loop: for quads, report each quad's wall
    clock against `25 s` (`secs(wall)` and `within`/`over`), the repeat's timings, and a line saying
    the poll resolution is 2 s. The repeat's timings come from the same admin read of
    `extraction_metadata`.
  - `GOLDEN_KEEP === "1"`: `afterAll` skips the storage remove and the user delete, and reports
    `kept account <email>; password: see extraction.integration.ts`.
  - Update the file's doc comment to describe `GOLDEN_API_URL`, `quads` and `GOLDEN_KEEP`.
- **GOTCHA**: `sourcePaths` and the admin reads are unchanged. The hosted API writes to the same
  Supabase project and bucket.
- **GOTCHA**: the repeat A01 must still be asserted `review`/`ready` along with the others.
- **GOTCHA**: `app` is referenced nowhere else after the change, so remove the variable, not the
  `createApp` import.
- **VALIDATE**: `npm run typecheck; npm run lint; npx prettier --check api/src/routes/extraction.integration.ts`.
  Do **not** run the paid suite here.

### 7. MEASURE the cold start ($0, D4)

- Run `curl -s -o /dev/null -w "%{http_code} %{time_total}\n" https://payslip-ocr-client.onrender.com/`
  as the static baseline.
- Wait until the API has had **no traffic for ≥ 20 minutes**. Use a background
  `sleep 1260; curl …` rather than a foreground sleep, and do steps 11–13 meanwhile.
- Then `curl -s -w "\n%{http_code} %{time_total}s\n" --max-time 180 https://payslip-ocr-api.onrender.com/api/health`.
  Record the HTTP status, `time_total` and `uptimeSeconds`. A small value confirms a real spin-up.
- Repeat on a second idle period. If a 502/503 comes back while it spins up, record it, retry, and
  record the total to the first `200`.
- **Record** both runs in history/13, and the date and UTC time.
- **VALIDATE**: two cold-start rows, each with `uptimeSeconds` < 120 at the first `200`.

### 8. SCAN the live bundle ($0, D3)

- `npm run check:secrets -- --url https://payslip-ocr-client.onrender.com` → all `ok`, with the
  local-values check run against the live assets.
- **VALIDATE**: exit 0. Record the asset count scanned.

### 9. RUN the hosted quads measurement (PAID, ~$0.65, D2, D12)

- Warm the API first (step 7's second cold start can serve).
- Run in PowerShell, from the project root:

```
$env:GOLDEN_SET='hosted-quads'; $env:GOLDEN_MODE='quads'; $env:GOLDEN_API_URL='https://payslip-ocr-api.onrender.com'; $env:GOLDEN_KEEP='1'; npm run test:extraction
```

- Capture the full report: per payslip, per quad, the summary and the estimated cost.
- **If a run is invalidated** by something outside the product (for example a Render deploy
  during the run, a local network drop or machine sleep), re-run **once** with
  `GOLDEN_SET=hosted-quads-2`. Delete the first run's kept account via the admin key only after
  the product owner approves. Log both.
- **GOTCHA**: a submit stall (`submitAttempts > 1`) is product behaviour, not an invalid run.
  Report it.
- **VALIDATE**: the suite passes: all 11 plus the repeat are `review`/`ready`, and the blank is
  `failed`. `.bakeoff/hosted-quads/` holds 11 files.

### 10. SCORE the hosted recording ($0)

- `npm run score:extraction`. It scores every set, `hosted-quads` included.
- Record `hosted-quads` scalar %, line-item %, critical %, and OIB checksum pass rate next to
  `two-pass-sequential` and `two-pass-concurrent`, with the ~0.5% noise band stated. Do not rank
  on differences within 1–2 fields.
- **VALIDATE**: exit 0, with `hosted-quads` listed as a two-pass set.

### 11. UPDATE `.claude/commands/validate.md` (git-ignored)

- Replace the bodies of 6.1, 6.1b and 6.2 with `npm run check:secrets`, run after Phase 5. Keep
  the "why the publishable key is allow-listed" paragraph and the rotate-on-leak advice. The
  bite-check becomes step 2's scratch-copy procedure.
- **ADD** journey **9.12 — Deployed stack and progress copy (Task 13, $0)**:
  - against the **deployed** client, after this task is deployed;
  - `npm run check:secrets -- --url …`;
  - with the admin key, seed one session with one `review` and one `confirmed` payslip, no
    source, as journey 9.11 did;
  - at 375 px in `en` and `hr`, the header reads "1 of 2 ready to review · 1 of 2 confirmed" and
    "1 od 2 spremno za pregled · 1 od 2 potvrđena";
  - confirm the review one, and it reads "2 of 2 confirmed" / "2 od 2 potvrđene";
  - clean up.

  Also a **local** variant for the review session, which runs before the deploy: the same checks
  against `npm run dev`.
- Update Phase 10, "journeys to add": nothing left on the roadmap.
- **VALIDATE**: `Select-String -Path .claude/commands/validate.md -Pattern "check:secrets","9.12"`
  finds both.

### 12. CREATE `README.md` (D8)

Sections, about 150–250 lines:

1. **What this is:** two sentences, then links to `PRD.md`, `CONTEXT.md`, the ADR and
   `.agents/ROADMAP.md`. The live URLs.
2. **Prerequisites:** Node from `.nvmrc`, npm, access to the Supabase project and the Azure
   Foundry resource, and Python for `check:golden`.
3. **Setup:** `npm install`, copy `.env.example` to `.env`, what each group of variables is. Point
   at `.env.example`'s comments rather than duplicating them. `npm run provision:analyzer`
   (idempotent drift check) and `npm run db:provision-storage`.
4. **Running:** `npm run dev`. Ports come from `.env`: say where to look, don't invent numbers.
   Check `client/vite.config.ts` for the dev proxy.
5. **Scripts:** a table of the root `package.json` scripts that an operator uses. Mark paid ones
   **PAID**: `test:extraction`, `cu`, `layout`, `llm`.
6. **Testing:**
   - `npm run validate` is what CI runs, plus build and `check:secrets`;
   - `test:integration` is hosted, $0;
   - `score:extraction` is offline;
   - `check:golden`;
   - the golden set's sources are git-ignored personal data.
7. **Deployment:**
   - mirror → CI → Render (`autoDeployTrigger: checksPass`);
   - the subtree push command from AGENTS.md §7;
   - the Render env vars that must be set by hand (the four `AZURE_*` ones, and any `sync: false`
     var added after the Blueprint);
   - migrations are applied through the Supabase CLI or MCP, never by a deploy.
8. **Before a demo:** the D4 warming step with the measured cold-start figure; the measured
   latency (first form, complete, four in parallel) from step 9; one payslip per file, ten per
   session; EUR only.
9. **Known limitations:** a bullet summary of ROADMAP §5 and the unverified iOS keyboard fallback,
   linking to §5.
10. **Privacy:** one paragraph pointing at PRD §9.4. A demo posture, not production.

- **GOTCHA**: Prettier does not format `*.md` (`.prettierignore`). Wrap by hand at 100 columns, as
  the other docs are.
- **GOTCHA**: never put a real URL key, email or password in it. The live origins are public.
- **VALIDATE**: `node -e "const s=require('fs').readFileSync('README.md','utf8'); const n=s.split('\n').length; if(n<120||n>300) throw new Error('README length '+n); for (const h of ['Before a demo','Known limitations','Deployment']) if(!s.includes(h)) throw new Error('missing '+h); console.log('ok',n)"`

### 13. UPDATE the stale docs (D7, D9)

- `PRD.md`:
  - §6.7: replace the suggested tree with the real one, as D9 describes;
  - §9.1: the revoke **is** applied (Task 09 step P, 2026-09-26);
  - §9.2: remove the duplicate `EXTRACTION_TIMEOUT_MS, EXTRACTION_CONCURRENCY` line;
  - §11.4: append the hosted measurement (step 9) under the Task 05 paragraph, and the cold start
    (step 7);
  - §12 Phase 3 status: Task 10 reviewed, with M2 rescoped to Android per D5;
  - §12 Phase 4 status: Task 13 implemented, device sitting pending.
- `.agents/history/10-*.md`, `11-*.md`, `12-*.md`: the lines that say "Not committed" or "Nothing
  committed or deployed" get a dated note appended rather than being rewritten:
  "*Committed and deployed: see `git log` (`f32836b` / `785dbda` / `9e66da4`).*" In history/11
  and history/12, append to "Still open" that the copy was **approved on 2026-09-26** (D7), with
  the one hr change.
- `.agents/history/07-*.md`, `08-*.md`, `10-*.md`: add a one-line pointer under their M-sections:
  "*Run in the Task 13 device sitting; see below / history/13.*" The sitting fills the tables
  later.
- **VALIDATE**:
  - `git grep -n "EXTRACTION_TIMEOUT_MS, EXTRACTION_CONCURRENCY" PRD.md` → exactly one match;
  - `git grep -n "layout-llm\|compare-providers\|record-provider-fixture" PRD.md` → none in §6.7.
    Matches elsewhere are acceptable only if they describe history.

### 14. WRITE the device-sitting checklist into `.agents/history/13-deploy-end-to-end.md` (D5)

A section **"Device sitting (product owner, after the deploy)"** with empty tables for the product
owner, each with a Verdict column and a Notes column:

- **Header:** device model, Android version, Chrome version, date. It is written **after** the
  Task 13 commit is deployed; check the progress copy shows two counts.
- **M5, §11.1 on the deployed app:**
  1. sign in on the phone, photograph a payslip, note the time the form appears;
  2. outlines present; tapping a field scrolls the preview to it;
  3. upload three more at once and move between all four, editing one before switching and
     checking the edit survives;
  4. correct two values, confirm all four, download JSON and check it has the line-item tables;
  5. re-open the session **on a later day**, or record that it was the same day and cite Task 12's
     API-level proof.

  The agent then reads each payslip's `extraction_metadata` for the first-form and complete times
  (D1) and fills in a timings table.
- **M2, Android Chrome:**
  - focus a field in the scalars section, and in a line-item table: the strip collapses to 64 px,
    shows that field's region, and the value and region are visible with the keyboard open;
  - dismiss the keyboard with Back, and note the Android back-dismiss limitation from history/10;
  - **iOS: not run, no device.**
- **M3:** camera denial (deny the permission, and check that "Odaberi datoteku" still works);
  retake; rotation (photograph at 90°, and check the outlines sit on the text or are withheld with
  a note); one-handed reach on the 48 px controls.
- **M1, desktop:** 11 rows (A01…G01) in the D12 account. For each: verdict (pass / misplaced /
  withheld) and notes. Carry the D01 `paymentDate` finding forward as the known case.
- **Defects found:** a table with columns Step, What, Evidence, Product owner's decision (fix in
  Task 13 / limitation).

### 15. UPDATE `.agents/ROADMAP.md` (D2, D5, D10)

- §2 row 13: "implemented; device sitting pending → [history/13](...)". Row 10: add the history
  link `→ [history/10](./history/10-session-navigation-phone-layout.md)`.
- §3 Task 13: an "Added in planning (plan 13)" list with D1–D12, one line each. Tick the DoD with
  evidence, in the style of Task 12:
  - **real phone:** pending the sitting;
  - **cold start:** step 7;
  - **no secret:** steps 2, 3 and 8;
  - **names only:** step 2.
  - Add a DoD line: "Four in parallel ≤25 s measured on the hosted stack (D2): <result>".
- §4:
  - M2's row reworded to "Android Chrome (D5); iOS unverified, no device";
  - add **M5**, "PRD §11.1 on the deployed app from a real phone", owned by 13;
  - M1's note: "in the Task 13 sitting, D12 account".
- §5:
  - update "Residual latency" with the hosted figures;
  - close "Phone layout has no prior art" once M2 passes, or keep it open with the iOS gap named;
  - add a row **"iOS keyboard fallback unverified"** (Open, no device);
  - add a row **"Region on the wrong text"**, if not already clear from the D01 row;
  - add a row **"Mirrored EXIF orientations"** and **"Three suggestion pairs for a three-page
    payslip"** from history/11 open items 2–3.
- Header: add a line saying that, once Task 13's sitting is recorded, later work is planned as new
  iterations. Do not change `Status` to Complete yet (D10).
- **VALIDATE**: `Select-String -Path .agents/ROADMAP.md -Pattern "\| M5 \|","iOS keyboard fallback"` finds both.

### 16. RUN the final local checks, WRITE history/13, STOP (D11)

- `npm run validate`, then `npm run build`, then `npm run check:secrets`.
- `npm run test:integration` (hosted, $0). Expect auth 3, payslips 62, direct writes 4, unchanged.
- `npm run check:golden` (the golden set is unchanged, so this is a sanity check).
- `git diff --check`, and `git status` includes the new files.
- `package-lock.json` unchanged.
- Write the rest of `.agents/history/13-deploy-end-to-end.md`, following history/12's structure:
  - Outcome and Status;
  - What was built (created and modified tables);
  - Decisions: "Implemented D1–D12 except the deviations below";
  - Deviations;
  - Validation table;
  - Measurements: cold start, live bundle, hosted quads with every per-payslip line, score, and
    **cost**;
  - the kept account's email (D12);
  - the device-sitting checklist (step 14);
  - Open items;
  - Review-session handoff: `/code-review`, `/validate` including journey 9.12's local variant,
    then commit and push on go-ahead, then journey 9.12 on the deployed stack, then the sitting,
    then D12 clean-up, then D10 close.
- **STOP.** Do not run `/code-review`, `/validate` or browser journeys, and do not commit.

---

## TESTING STRATEGY

### Unit Tests

- `SessionPage.test.tsx`: three progress cases (mixed, all confirmed, none confirmed), each
  checked failing against the old code where the behaviour changes.
- `i18n.test.ts` (existing) proves the new plural key's categories and hr/en parity.
- No unit test for `check-client-secrets.mjs`. Like the validate.md checks it replaces, it is
  proven by running against the real files and by the scratch-copy bite-checks in step 2, and
  those are recorded. Adding a Vitest project for `scripts/` would be new infrastructure for one
  script.

### Integration Tests

- `npm run test:integration` (hosted, $0) must be unchanged: no API code changes.
- The paid `test:extraction` in `quads` + hosted mode **is** the Task 13 measurement (step 9). The
  default mode (in-process, `concurrent`) must remain as it was. Typecheck proves the shape; the
  paid default run is **not** re-run.

### Edge Cases

- Progress with pending uploads: `total` includes them; `ready` and `confirmed` do not.
- Progress with every payslip failed: "0 of N ready to review", no confirmed part.
- `.env` absent (CI): the local-values check is skipped with a note and not failed.
- A `.env` value that is empty or shorter than 8 characters is never used as a needle.
- A live bundle with a `<link rel="modulepreload">` as well as a `<script>`: both are scanned.
- The hosted health check during a cold start: `502`/`503` retried until `200` or 90 s.
- The quads repeat A01 must not overwrite `.bakeoff/hosted-quads/A01.json`.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck`, `npm run lint`, `npm run format:check`.

### Level 2: Unit Tests

`npm test`; targeted `npx vitest run client/src/routes/SessionPage.test.tsx client/src/i18n`.

### Level 3: Integration Tests

`npm run test:integration` ($0). The paid hosted run is step 9, once.

### Level 4: Manual Validation

- `npm run build; npm run check:secrets`, and the step 2 bite-checks.
- `npm run check:secrets -- --url https://payslip-ocr-client.onrender.com`.
- Two cold-start curls (step 7).
- The device sitting is **not** run in this session (D5, D11).

### Level 5: Additional Validation

`npm run score:extraction` after the hosted run; `npm run check:golden`.

---

## ACCEPTANCE CRITERIA

- [ ] CI runs `npm run check:secrets` after the build. The script fails on a secret-shaped
      `VITE_` name, on a populated `.env.example` value, on a secret marker in the bundle, and
      (locally) on a real server-secret value in the bundle, and it prints no value.
- [ ] The live client bundle scans clean.
- [ ] Two measured cold starts, with the README's warming step citing them.
- [ ] The hosted quads run: three four-payslip wall clocks against ≤25 s, per-payslip first form
      and complete, cost, and an accuracy score for `hosted-quads`, all in history/13. The result
      is recorded whether or not it meets the target.
- [ ] The session header reads per D6 in en and hr. Tests cover the mixed, all-confirmed and
      none-confirmed cases.
- [ ] The `history.errors.export` hr copy is changed, and the copy approval is recorded.
- [ ] `README.md` exists, is 120–300 lines, and covers setup, running, scripts, testing,
      deployment, before-a-demo and known limitations.
- [ ] The PRD §6.7 tree matches the repository. §9.1, §9.2 and the Phase 3/4 statuses are current.
- [ ] ROADMAP §2 through §5 updated: M5 added, M2 rescoped, all limitations in §5.
- [ ] history/13 holds every measurement, the kept account's email, and the device-sitting
      checklist.
- [ ] `npm run validate`, the build, `check:secrets` and `test:integration` are green;
      `package-lock.json` is unchanged.
- [ ] After the deploy (not this session): the device sitting recorded; D12 clean-up; ROADMAP
      Status Complete.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–16 done in order, each VALIDATE run once
- [ ] Paid runs logged with cost (expected ~$0.65, one re-run allowed with a stated reason)
- [ ] No value of any secret written to a file, a log or history/13
- [ ] Nothing committed. The review session is next.

---

## NOTES

- **Why the harness rather than a browser for D2:** the harness is the proven measurement path.
  It records timings per pass, and its recordings score offline. Pointing it at the deployed
  API measures the deployed server, and the sequential per-session upload is the client's own
  upload order (Task 07 D3). The browser journeys prove UI, not latency.
- **Why the quad run is only 11 + 1:** three four-payslip measurements are enough to see whether
  the ≤25 s target holds or misses, and together they score the whole golden set on the deployed
  stack. More runs would buy variance data the §5 latency work should gather on its own plan.
- **Expectation, not a gate:** at Task 05's measured generation rate, one payslip completes at
  p50 14.0 s, and three analyses share the cap. A four-payslip wall clock over 25 s is likely.
  Record it; do not tune anything here.
- **What this task cannot prove:** iOS keyboard behaviour (no device); a stranger's payslip layout
  (a corpus of seven vendors, §5 "Small corpus"). Both are stated in the README.

**Confidence for one-pass implementation: 8/10.** The code is small and well patterned. The risks
are operational: waiting out cold starts, a Render deploy or a submit stall during the paid run,
and keeping secret values out of every output.
