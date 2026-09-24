# 03 — Session & payslip persistence, upload API

**Date:** 2026-09-24
**Plan:** [`plans/03-session-payslip-persistence-upload.md`](../plans/03-session-payslip-persistence-upload.md)
**Outcome:** a signed-in user can create a Session, upload up to ten Source Files into it, read the
session and each payslip, list their payslips, fetch a signed source URL, and soft delete. Every
row is owner-scoped by RLS, every source is stored privately at `{userId}/{payslipId}/source`, and
another user gets 404 everywhere. No extraction runs yet: uploads stay in `processing` until
Task 04.

## What was built

| File | Contents |
| --- | --- |
| `supabase/migrations/20260924100541_create_sessions_and_payslips.sql` | `sessions`, `payslips` (Appendix B plus `warnings` and `failure_reason`), grants, RLS, two partial indexes, the cap trigger, three Storage policies |
| `supabase/migrations/20260924102451_enforce_session_cap_on_update.sql` | The cap trigger also fires on `update of session_id, deleted_at` (added by the post-completion review, below) |
| `api/src/repositories/sessions.ts` | `SessionRepository` (`create`, `findById`), `mapSessionRow` |
| `api/src/repositories/payslips.ts` | `PayslipRepository` (`create`, `findDetailState`, `listBySession`, `findSourceById`, `listPage`, `update`, `softDelete`), `mapPayslipRow`, `PayslipRepositoryError` |
| `api/src/routes/sessions.ts` | PRD §10.2, §10.3, §10.4 |
| `api/src/routes/payslips.ts` | PRD §10.5, §10.9, §10.12, §10.13 |
| `api/src/upload/source-file.ts` | `SourceFile.pageCount`, measured from the bytes |
| `shared/src/upload.ts` | `session_full`; `MAX_PAYSLIPS_PER_SESSION = 10` |
| `api/src/database.types.ts` | Regenerated from the hosted schema through the MCP |

Tests: `repositories/payslips.test.ts` (new), `routes/payslips.integration.ts` (new, hosted, two
users), `source-file.test.ts` extended for `pageCount`, and `app.test.ts` and
`auth.integration.ts` reworded now that paths are routed.

## Design decisions carried

D1–D10 as the plan states them, delegated by the product owner and accepted. In brief:

- **D1:** `415 unsupported_media_type` stays. PRD §10.3 was the outlier and is corrected.
  `session_full` joins the upload codes with hr/en copy, which closes Task 02 D6.
- **D2:** the ten-payslip cap is a `before insert` trigger. It takes an advisory lock per session,
  runs with invoker rights, and is the only copy of the rule. The route does not pre-check.
- **D3:** soft-deleted payslips do not count toward the cap.
- **D4:** PATCH stays in Task 09. Cross-user update is proven at the repository layer it will use.
- **D5:** the row model and policies. The insert and update policies check that the session is
  owned and live, because a foreign key is checked without RLS.
- **D6:** "idempotent" means the migration history. It was proven by a rolled-back dry run.
- **D7:** applied to the dedicated hosted project through the MCP, with no Docker.
- **D8:** payslips stay in `processing`. The detail projections return `[]` until Task 04.
- **D9:** the generated `numeric` columns use a regex-guarded cast and are never read in TypeScript.
- **D10:** `pageCount` is measured at upload.

## Concerns resolved before execution

Raised at priming and settled before step 1. The plan was amended and committed as `81ebef7`.

1. **The cap's correctness rests on two PostgreSQL guarantees:**
   - BEFORE ROW triggers fire before RLS `WITH CHECK`.
   - A plpgsql query takes a fresh snapshot after the lock is granted.

   Both are now stated in D2 and in the migration's comment, so nobody later turns the trigger into
   a policy. The side effect is accepted: another user can hash onto a session's lock and delay its
   inserts for one transaction.
2. **`MAX_PDF_PAGES` is an environment variable.** The integration test builds
   `config.MAX_PDF_PAGES + 1` pages rather than a literal 11.
3. **The literal "10" in the `session_full` copy was kept deliberately.** The cap is a fixed product
   rule enforced in SQL, not configurable. The sibling strings print "10 MB" and "10 pages" the same
   way, and no component renders upload errors yet.
4. **The direct-write gap names Tasks 06 and 09.** See open item 4.

## Deviations from the plan

1. **`PayslipRepository.findById` was not built.** No route calls it: the detail route uses
   `findDetailState`, and the source route uses `findSourceById`. It would have been dead code.
2. **The client resolves `@payslip/shared` from its compiled output.** After step 1, the client
   i18n test failed until `tsc --build shared` ran. The locale files were right; the shared build
   was stale. `npm run typecheck` rebuilds it, so the full gate is unaffected. Only a focused client
   run straight after a `shared` edit can see stale exports.
3. **The dry run's transaction control worked.** The plan's fallback was not needed. `begin; …
   rollback;` succeeded through `execute_sql`. Afterwards `list_tables` returned `[]` and no
   payslip Storage policy existed.

## Hosted schema

| Check | Result |
| --- | --- |
| Pre-apply | `list_tables` `[]`, `list_migrations` `[]`, one private bucket `payslip-sources` (12 MB, no MIME filter), PostgreSQL 17.6 |
| Dry run (`begin` … `rollback`) | succeeded; still `[]` afterwards |
| `apply_migration` | recorded version **`20260924100541`**; local file renamed to match |
| Policies | 2 on `sessions`, 3 on `payslips`, 3 on `storage.objects` |
| Grants | `authenticated`: `sessions` select/insert, `payslips` select/insert/update. Nothing to `anon` |
| RLS | enabled on both tables |
| `get_advisors` (security) | **no finding on the new objects.** The one finding is project-level: `auth_leaked_password_protection` (Leaked Password Protection Disabled), part of the deferred auth hardening (ROADMAP §1). Not a schema fix, so no second migration |

## Validation

| Check | Result |
| --- | --- |
| Per-step focused runs | green at every step (the client i18n run once red, see deviation 2) |
| `npm run validate` (typecheck, lint, format, test) | green: 32 files, **406 tests** (395 before) |
| `npm run build` | green; the known Vite chunk-size advisory |
| Phase 6 (6.1–6.22, 6.3, 6.4, 6.4b) | all pass |
| `npm run test:integration` | printed the **hosted** host `hxksulbgluvfxfoxrhse`; 3/3 auth + **14/14** payslips, first run |
| Orphan check | `[]`; `sessions`, `payslips` and `payslip-sources` objects all 0 afterwards |

What the hosted suite proved, case by case:

| DoD / plan case | Result |
| --- | --- |
| Create, upload JPEG + 2-page PDF, bytes identical, `pageCount` 1 and 2 | pass |
| Session detail in upload order, null summary fields, `warningCount` 0 | pass |
| **11 concurrent uploads → exactly 10 × 201, 1 × `409 session_full`**; every Storage folder maps to a live payslip | pass |
| A soft-deleted payslip frees its slot (D3) | pass |
| Encrypted PDF `422 pdf_encrypted`, 11-page `422 pdf_too_many_pages`, renamed text `415 unsupported_media_type`, no row created | pass |
| List paging and total, `?status=review` → 0, `?page=999` → empty with the correct total | pass |
| Signed URL: TTL ≈ 300 s, serves the exact bytes, Croatian `originalFilename` intact | pass |
| User B: 404 `not_found` on all five endpoints; B's list total 0; A unchanged | pass |
| Cross-user repository `update` returns `null` (D4) | pass |
| Direct PostgREST insert into A's session refused with `42501` (D5) | pass |
| Soft delete removed from list, session and detail; a second DELETE is 404 | pass |

**Not run, deliberately:**

- Phase 7 (golden set and score): no fixture or extraction code changed.
- Phase 9 browser journeys: no UI changed.
- The deployed client: no route in it calls the API yet (01b gap 1 stays open, see below).

## Open items for later tasks

1. **Task 04:** start extraction at the line marked in `routes/sessions.ts`. Populate
   `extraction_metadata` and derive `lowConfidenceFields` and `unreadableFields` from it. Set
   `failure_reason` on failure. Extend `UpdatePayslipInput`.
2. **Task 07:** the first client-to-API call must be checked on the **deployed** client, not only
   locally (01b gap 1).
3. **Task 11:** soft-delete the originals **before** inserting the merged payslip, or a full session
   refuses the insert (D3). This is now in the ROADMAP scope.
4. **Direct PostgREST writes to a user's own rows are possible.** `authenticated` holds `update` on
   `payslips`, so a signed-in user can set their own `status` or `canonical_data` without going
   through the API. This is inherited from receipt-ocr's model and acceptable for a demo. It
   matters for **Tasks 06 and 09**: once warnings and confirm treat those columns as trustworthy, a
   direct write can set `confirmed` or skip the warning recompute. Revoking `update` in favour of a
   narrower path is their call.
5. **Security advisor:** enabling leaked-password protection is a dashboard setting, not a migration.
   It belongs with the deferred auth hardening.

## Post-completion review and validation (2026-09-24)

Before commit, the uncommitted work was reviewed with `/code-review`, with Standards and Spec run as
separate agents. **Spec: no blocking gaps**, and the claims above checked out against the code.
**Standards: no hard violation** of a documented convention.

**Fixed in this pass:**

| Finding | Fix |
| --- | --- |
| **The ten-payslip cap could be bypassed by a direct PostgREST update.** `authenticated` holds `update` on `payslips` and the trigger fired on insert only, so a user could restore a soft-deleted payslip (`deleted_at = null`) or move a live one (`session_id`) into a full session. Reproduced first: both hosted writes succeeded and left 11 live payslips | Migration `20260924102451`: the same function, lock and count, now also firing on `update of session_id, deleted_at`, and checking only a write that adds a live payslip to a session. Dry-run in a rolled-back transaction, then applied through the MCP. Two new hosted tests prove both writes now fail with `session_full` |
| The upload's cleanup `try` also wrapped mapping the inserted row and writing the response, so an `invalid_data` after a committed insert would delete the source of a live row | The `try` covers the insert only, and cleanup is skipped on `invalid_data` |
| `removeSource` ignored the `{ error }` supabase-js returns, so a refused cleanup left an orphan silently | It throws like its siblings, and the route logs `orphaned payslip source` at `warn` |
| `listPage`'s `PGRST103` fallback rebuilt the whole filtered query twice | One builder, called for the page and for the count |
| `validate.md` §9.4 still said the guarded paths had no route | Reworded for routed paths |

**Reviewed and deliberately not changed:**

- Direct writes to `status`, `canonical_data` and the other columns stay open item 4. The API writes
  with the user's own token, so column grants cannot tell the API from the user. Closing it means
  server-side writes, which is Task 06's and 09's call.
- The Storage policies name `payslip-sources` literally. SQL cannot read `STORAGE_BUCKET`, and
  `.env.example` already requires that value.
- `findById`, the generic `update` behind `softDelete`, and the exported `mapSessionRow` follow the
  plan (D4 needs `update` at the repository layer).
- The repeated route id parsing, the repository-level `uuidSchema.parse` and the `normalizeTimestamp`
  copy in each repository are judgement calls, left as they are.

**Validation:**

| Check | Result |
| --- | --- |
| `npm run validate` | green: 32 files, 406 tests |
| `npm run test:integration` | hosted `hxksulbgluvfxfoxrhse`: 3/3 auth + **16/16** payslips (14 + the two direct-write cases) |
| Orphan check | 0 `task03-` users, 0 sessions, 0 payslips, 0 source objects |
| `list_migrations` | `20260924100541`, `20260924102451`, matching `supabase/migrations/` |
| `get_advisors` (security) | only the known project-level `auth_leaked_password_protection` |

Not re-run: `npm run build` (`tsc --build` inside `validate` compiled every changed file, and no
client code changed) and the browser journeys (no UI changed).
