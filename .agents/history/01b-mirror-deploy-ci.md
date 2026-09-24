# 01b — Mirror, deploy and CI

**Date:** 2026-09-24
**Plan:** none. It was agreed in conversation and pulled forward from Task 13.
**Outcome:** the payslip subtree lives on a private GitHub mirror. A GitHub Actions workflow
validates every push. Render deploys the API and client from a Blueprint, and only after CI passes.

## Why now

The product owner wanted the same push-and-deploy loop receipt-ocr has, and wanted it before
Task 02 rather than at Task 13. Doing it early surfaces deployment problems on a stub app. It also
means Task 01 no longer exists only on one disk.

## What was done

**Mirror.**
- `FraneKuzmanic/payslip-ocr` is a **private** repository. An unauthenticated
  `api.github.com/repos/...` returned 200 at first, so the push was held back until the owner
  switched the repo to private and the same call returned 404.
- It was pushed with `git subtree push --prefix=prototypes/payslip-ocr payslip-github main` through
  the `github-FraneKuzmanic` SSH alias, which authenticates as the personal account, never the
  student account `FraneKuzmanicFER`.
- The pushed history was checked: 4 commits, all authored by FraneKuzmanic, and no `.env`,
  `payslip_examples/`, `.bakeoff/` or image/PDF path anywhere in it.
- The remote and push path are recorded in AGENTS.md §7.

**The lockfile, fixed at the root cause.**
- receipt-ocr's Render build runs `rm -rf node_modules package-lock.json` before installing. Its
  commit `72ec6f3` explains why: the Linux build could not find `@tailwindcss/oxide-linux-x64-gnu`.
- This lockfile had the same defect. `@tailwindcss/oxide` declares twelve platform binaries, but
  only `oxide-win32-x64-msvc` was recorded.
- In isolation, npm records all of them. The loss happens when npm rewrites the lockfile from an
  existing Windows `node_modules`, even with `--package-lock-only` (npm/cli#4828).
- The fix was to regenerate the lockfile from a directory holding only the four `package.json`
  files. It now has all 18 oxide entries.
- This moved 64 transitive packages within their ranges. The direct pins are unchanged. A clean
  `npm ci` followed by `validate`, build and `score -- cu` all stayed green: 256 tests, 281/284 =
  98.9%.
- Deleting the lockfile at build time would have meant production installed versions CI never
  tested. validate.md check 6.22 now fails if any optional dependency is missing from the lockfile.
  It catches the old lockfile (11 missing entries) and passes the new one.

**`render.yaml`**, checked against Render's Blueprint reference:
- `runtime: node`, which replaces the deprecated `env`.
- The API is in `region: frankfurt`, next to the Supabase project. Static sites take no region.
- `npm ci --include=dev` against the committed lockfile. `--include=dev` is still needed because
  `NODE_ENV=production` would otherwise skip the build tools (receipt-ocr commit `b331d15`).
- `healthCheckPath: /api/health` on the API.
- `autoDeployTrigger: checksPass` on both services.

**CI.** `.github/workflows/ci.yml` runs on pushes to `main` and on pull requests: `npm ci`, lint,
typecheck, format, test and build, on `ubuntu-latest` with the Node version from `.nvmrc`
(`actions/checkout@v7`, `actions/setup-node@v7`). It cannot run the golden-set check or the score,
which need git-ignored personal data, or the hosted integration test, which needs secrets. Those
stay in `/validate`.

**Render.** The owner created the Blueprint from the dashboard, in the same Render account as
receipt-ocr, and entered the five `sync: false` values. `SUPABASE_SECRET_KEY` and every Azure key
were deliberately left off Render, because nothing in the running API reads them yet. Both services
got their requested names with no suffix:
- `https://payslip-ocr-api.onrender.com`
- `https://payslip-ocr-client.onrender.com`

## Verification

| Check | Result |
| --- | --- |
| `GET /api/health` on the deployed API | `200 {"status":"ok",…}` |
| `GET /api/payslips` without a token | `401 {"error":{"code":"unauthorized"}}` |
| CORS preflight from the client origin with `authorization` | `204`, `access-control-allow-origin: https://payslip-ocr-client.onrender.com` |
| Deep link `/some/deep/route` on the client | `200` via the SPA rewrite |
| Client bundle scanned for `SUPABASE_SECRET_KEY`, `service_role`, `AZURE_`, JWTs | none. The single `sb_secret` hit is supabase-js's own key-prefix check (`startsWith("sb_secret_")`), not a key |
| Browser, deployed client, 375 px | signed-out `/` redirects to `/login`. Register lands on the home page and stays signed in across a reload. HR persists across a reload (`lang="hr"`, translated title). No horizontal overflow. The header link is 44 px (the Task 01 fix is live) |
| Throwaway `task01-prod-…` user | deleted. The owner's own account was left in place |

The owner had also signed up, signed in and switched language on the deployed client
independently.

## Gaps left open

1. **The client-to-API connection is not exercised yet.** Only `SourceDocumentPanel` imports the
   API client, and no route renders it, so the production bundle contains no API call and
   `VITE_API_BASE_URL` is compiled out. The first route that calls the API (Task 03 or 07) must be
   checked on the deployed client, not only locally. receipt-ocr once had a wrong base URL that
   the SPA rewrite silently answered with `200` HTML (commit `345a99d`).
2. **The first CI result was not read by the agent.** The mirror is private and `gh` had just been
   installed (`~/tools/gh/bin/gh.exe`, 2.101.0, checksum verified) but was not signed in. Signing
   in as FraneKuzmanic lets later sessions read CI runs directly.
3. **Render's `sync: false` is prompted only when a Blueprint is created.** When Task 04 adds the
   Azure variables to `render.yaml`, they must also be entered by hand in the Render dashboard.
   Task 13's scope now says so.
4. **Free-tier sleep.** The two free API services, receipt-ocr's and this one, share the
   workspace's instance-hours. Each sleeps after roughly 15 minutes idle, and the first request
   after that takes 30–50 s.
