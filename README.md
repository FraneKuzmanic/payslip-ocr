# Payslip OCR

A mobile-first prototype that scans Croatian payslips. A user photographs or uploads up to ten
payslips, Azure AI Content Understanding extracts each into a pre-filled form, every value is
outlined on the source document, and the user corrects, confirms and exports the result.

It is a technology demonstrator, not a product. The documents that govern it:

- [`PRD.md`](./PRD.md): what it does, and what is deliberately out of scope.
- [`CONTEXT.md`](./CONTEXT.md): the glossary. Croatian payroll terms are code identifiers and mean
  specific things; read it before touching the domain.
- [`docs/adr/0001`](./docs/adr/0001-payslip-extraction-architecture.md): why Content Understanding.
- [`.agents/ROADMAP.md`](./.agents/ROADMAP.md): the plan of record, locked decisions, and the risks
  that stay open.

Live: client <https://payslip-ocr-client.onrender.com>, API
<https://payslip-ocr-api.onrender.com/api/health>.

## Prerequisites

- Node, the version in [`.nvmrc`](./.nvmrc), and npm.
- Access to the Supabase project, and to the Azure AI Foundry resource that hosts the Content
  Understanding analyzers.
- Python 3, for `npm run check:golden` only.

## Setup

```
npm install
cp .env.example .env
```

Fill in `.env`. [`.env.example`](./.env.example) groups the variables and says what each is for:
the API, Supabase (a publishable key for the browser and a secret key for server-side tests and
scripts), upload limits, the Content Understanding endpoint, key and analyzer id, the `VITE_`
client values, and the bake-off challenger's keys. Only `VITE_`-prefixed variables reach the
browser.

Two idempotent provisioning scripts:

- `npm run provision:analyzer` checks the two analyzers (`<id>_scalars`, `<id>_tables`) against
  the committed schema and reports drift. There is one Foundry resource, so local and hosted share
  the analyzers.
- `npm run db:provision-storage` creates the private `payslip-sources` bucket if it is missing.

The database schema is `supabase/migrations/*.sql`. There is no ORM; row-level security enforces
ownership.

## Running

```
npm run dev
```

This starts the API and the Vite client together. The API listens on `PORT` from `.env` (3001 by
default), and Vite proxies `/api` to `localhost:3001` (`client/vite.config.ts`), so the browser
sees one origin locally. Vite prints the client's URL when it starts.

## Scripts

| Script | What it does |
| --- | --- |
| `dev` | API and client in watch mode |
| `build` | Typecheck-build every workspace and bundle the client into `client/dist` |
| `validate` | Typecheck, oxlint, Prettier check and unit tests, in that order |
| `check:secrets` | No secret in `.env.example` or the built bundle; `-- --url <origin>` scans a deployed client |
| `test:integration` | Integration tests against the hosted Supabase project ($0, needs `.env`) |
| `test:extraction` | **PAID.** Every golden-set payslip through the real API and Content Understanding, about $0.45–0.70 a run (Task 13's quads run: $0.68) |
| `score:extraction` | Scores every recorded run in `.bakeoff/` against the golden set, offline, $0 |
| `check:golden` | Re-verifies every golden-set fixture's payroll identities and OIB checksums |
| `provision:analyzer` | Analyzer drift check, see Setup |
| `db:provision-storage` | Creates the private source bucket if it is missing, see Setup |
| `cu`, `layout`, `llm` | **PAID.** The Phase 2 bake-off runners, kept as the measured fallback |
| `score` | Scores the bake-off runs |

## Testing

- CI runs the same checks as `npm run validate` (as separate steps, lint first), followed by
  `npm run build` and `npm run check:secrets`.
- `npm run test:integration` runs against the hosted Supabase project, creating and deleting its
  own users. It costs nothing.
- `npm run score:extraction` measures accuracy from recordings, never from inspection. Two runs of
  the same design differ by about 0.5%, one or two fields, so a smaller difference is not a result.
- `npm run check:golden` after any change to `.agents/fixtures/expected/`.
- The golden set's source documents (`payslip_examples/`) are real personal data and are
  git-ignored. A fresh clone has the expected values but not the documents, so the golden checks and
  the paid runs need a copy from the product owner.

## Deployment

The private GitHub mirror `FraneKuzmanic/payslip-ocr` holds only this directory. Its `main` runs
CI ([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)), and Render deploys both services
from [`render.yaml`](./render.yaml) only after CI passes (`autoDeployTrigger: checksPass`). Push from
the monorepo root:

```
git subtree push --prefix=prototypes/payslip-ocr payslip-github main
```

Render prompts for `sync: false` variables only when a Blueprint is **created**. Any added later
must be set by hand in the dashboard before the deploy that needs them. On `payslip-ocr-api` that
is the four `AZURE_CONTENT_UNDERSTANDING_ENDPOINT`, `AZURE_CONTENT_UNDERSTANDING_KEY`,
`AZURE_CU_ANALYZER_ID` and `AZURE_CU_API_VERSION`. The API refuses to start without them, and a
failed health check keeps the previous instance live.

`SUPABASE_SECRET_KEY` is **not** a Render variable: the API acts with each user's own token, and
only the integration tests and provisioning scripts use the secret key.

Migrations are applied through the Supabase CLI or MCP, never by a deploy.

## Before a demo

- **Warm the API.** The free Render instance spins down after 15 minutes without a request
  ([Render docs](https://render.com/docs/free#spinning-down-on-idle)). Open
  <https://payslip-ocr-api.onrender.com/api/health> and wait for `{"status":"ok",…}`.
  Measured three times on 2026-09-26 after 20+ minutes idle: **22.3–22.4 s** to the first `200`
  (`uptimeSeconds` 9–14, a real restart). A warm health check then answered in 0.11–0.13 s.
  Any request restarts the 15-minute idle timer, so warm it within 15 minutes of starting. The
  client is a static site and does not sleep.
- **Expect these times** on the deployed stack (Task 13, history/13):
  - a usable form (the scalars pass) at **p50 11.9 s**, max 22.7 s, against a ≤ 10 s target;
  - the line-item tables complete at p50 17.9 s. The heaviest payslip, A01 (two pages, 23 pay
    components), takes about a minute, because its tables pass alone runs 50–55 s;
  - four payslips uploaded together settle in **32–73 s**, against a ≤ 25 s target. The slowest
    payslip in the group sets the time, and a group containing A01 takes about 73 s.

  So: open the form while the tables fill in behind it, and demo a light payslip first.
- One file is always one payslip. Ten files per session, ten pages per PDF, 10 MB per file.
- EUR payslips only: periods before 2023, in HRK, and the `prirez` line are out of scope.

## Known limitations

The full list, each with its status, is [ROADMAP §5](./.agents/ROADMAP.md#5-risks-carried-forward).
In short:

- **Latency** misses the ≤ 10 s first-form target at today's service generation rate. It is
  accepted for now, and improving it is a later phase.
- **Cost** is about $0.045 a page, two to four times the PRD's $0.01–0.02, largely because each
  payslip runs two analyses.
- **Accuracy** is measured on 11 payslips from 7 payroll vendors. A layout from an eighth vendor is
  unmeasured.
- **iOS keyboard behaviour is unverified.** The `visualViewport` fallback for Safari and Chrome on
  iOS has never run on a device; only Android Chrome is checked.
- **An outline can sit on the wrong text** when the service's own source for a value does (D01's
  payment date is outlined inside the employer address).
- **Merge** ignores mirrored EXIF orientations, which phone cameras do not write, and suggests
  three pairs for a payslip photographed as three files.
- **Extraction work lives in process memory.** A redeploy drops in-flight extractions; they fail
  on the next read after 15 minutes and can be retried.
- **Inherited gaps:** no password reset, no email verification, no MFA.

## Privacy

A payslip holds a name, address, OIB, IBAN, salary and often loan balances. This prototype
persists them, scoped to their owner by row-level security, and sends them to Azure in Sweden
Central under the default `global` processing location. That posture is for a demo, not for
production: see [PRD §9.4](./PRD.md#94-privacy).
