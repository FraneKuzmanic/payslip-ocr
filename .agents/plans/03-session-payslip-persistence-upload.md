# Feature: Task 03 — Session & payslip persistence, upload API

The following plan should be complete, but validate documentation, codebase patterns and task
sanity before you start implementing. Pay special attention to the names of existing utils, types
and models, and import from the right files.

**Roadmap:** [`.agents/ROADMAP.md` §3 Task 03](../ROADMAP.md) · **PRD:** §6.6, §7.3, §9.1, §9.3,
§10.2–10.5, §10.9, §10.12–10.13, Appendix B · **Glossary:** [`CONTEXT.md`](../../CONTEXT.md) ·
**Behaviour rules:** [`AGENTS.md`](../../AGENTS.md) (this project has no `CLAUDE.md`)

## Feature Description

Persist the Task 02 domain model. A signed-in user creates a **Session**, then uploads up to ten
**Source Files** into it, one `POST` each. Every upload becomes one **Payslip** row in `processing`,
owner-scoped by row-level security, with its bytes stored privately at
`{userId}/{payslipId}/source`. The user can read a session with its payslip summaries, read one
payslip, list their payslips with paging and a status filter, fetch a signed source URL, and soft
delete a payslip. Another user's session or payslip is **404 everywhere**, because it falls out of
the owner-scoped query rather than a separate check.

No extraction runs yet (Task 04), and no UI changes (Task 07). A payslip uploaded by this task stays
in `processing` until Task 04 wires the provider in.

## User Story

As a payslip holder with several months of payslips
I want to upload them together into one session and find them again later
So that I review them side by side, and nobody else can ever see them (PRD US-02, US-10)

## Problem Statement

`supabase/migrations/` is empty and the hosted project `hxksulbgluvfxfoxrhse` has no tables. Only
the private `payslip-sources` bucket exists, and it has no Storage policies. The API has an auth guard
on `/api/sessions` and `/api/payslips`, but no routes behind it. Upload validation (`multipart.ts`,
`source-file.ts`) and the storage helpers (`payslip-sources.ts`) exist, but nothing calls them.
`api/src/database.types.ts` describes an empty schema.

## Solution Statement

- **One migration** creates `sessions` and `payslips` (PRD Appendix B plus two DTO-driven columns),
  explicit grants, RLS, the partial history index, three Storage policies, and a `before insert`
  trigger that enforces the ten-payslip cap atomically.
- **The migration is applied to the hosted project through the Supabase MCP**, not Docker, after a
  transactional dry run. The local file is then named after the version the MCP records.
- **Two owner-scoped repositories** (`sessions`, `payslips`) return canonical `Session` and
  `Payslip` objects, never rows, mirroring receipt-ocr's `ReceiptRepository`.
- **Two routers** (`sessions`, `payslips`) implement PRD §10.2–10.5, §10.9 and §10.12–10.13,
  mounted behind the existing prefix guard.
- **One hosted integration file** proves the DoD with two real users.

## Feature Metadata

**Feature Type**: New Capability
**Estimated Complexity**: Medium-High (schema, RLS, a concurrency guard, 7 endpoints, hosted tests)
**Primary Systems Affected**: `supabase/migrations`, `api/src/{repositories,routes,upload,app.ts}`,
`shared/src/upload.ts`, client locales (one key pair), hosted Supabase project
**Dependencies**: none new. `@supabase/supabase-js` 2.112.3, `pdf-lib`, `file-type`, `multer`,
`supertest` are already installed

---

## DESIGN DECISIONS

These settle the nine concerns raised at priming. Each one is a recommendation the product owner
delegated. Record them in the history file as D1–D10, and do not reopen them during execution
without new evidence.

### D1 — Error codes: keep `unsupported_media_type` (415), add `session_full` (409)

PRD §10.3 says `422 unsupported_file_type`. The code already says `415 unsupported_media_type`, in
`api/src/upload/source-file.ts:25`, `shared/src/upload.ts`, both locales, `client/src/api/client.test.ts:112`
and `client/src/capture/sourceFile.ts:14`. 415 is also the correct HTTP status for an unsupported
media type. **The PRD is the outlier, so fix the PRD**, not five files of working code.

`session_full` joins `UPLOAD_ERROR_CODES` with hr/en copy. The user sees it when an upload is
refused, and `uploadErrors.test.ts` then enforces its translation automatically. This closes
Task 02 D6.

### D2 — The ten-payslip cap is enforced by the database, atomically

The client POSTs files in parallel (PRD §7.3). A "count, then insert" check in the route lets
two concurrent requests both see 9 and both insert. The authoritative check is therefore a
`before insert` trigger on `payslips` that:

1. takes `pg_advisory_xact_lock(hashtextextended(new.session_id::text, 0))`, which serializes
   inserts into one session until each transaction commits;
2. counts the session's **non-deleted** payslips;
3. raises `session_full` (SQLSTATE `P0001`) at 10 or more.

**Why an advisory lock, not `select … for update` on the session row:** `FOR UPDATE` needs the
`UPDATE` privilege on `sessions`, and this task grants `authenticated` no update on `sessions`
(no endpoint modifies a session). The advisory lock needs no privilege, so the trigger runs as
**invoker**, with no `security definer` and no RLS bypass. A hash collision between two sessions
costs only extra serialization, never correctness.

The trigger's count runs under the caller's RLS. It sees only the caller's rows, which is every
row in a session the caller owns. An insert into another user's session counts 0 and is then
rejected by the insert policy (D5).

Two PostgreSQL guarantees make this correct, and the migration's comment on the function must name
both, so nobody later "simplifies" the trigger into a policy:

- **BEFORE ROW triggers fire before RLS `WITH CHECK`**, so the cap runs on every insert, including
  one the policy will reject.
- **A plpgsql query in a volatile function takes a fresh snapshot** under READ COMMITTED, so the
  count that runs after the lock is granted sees the row the previous holder just committed. A
  policy expression has no lock to wait on, so it cannot serialize concurrent inserts.

A side effect, accepted: another user can hash onto a session's lock and delay its inserts for the
length of one transaction. It cannot change the count.

The route **does not pre-check** the count. The trigger is the only copy of the rule. On
`session_full` the route removes the already-uploaded source object (the existing cleanup pattern)
and answers `409 session_full`.

The cap is `MAX_PAYSLIPS_PER_SESSION = 10` in `shared/src/upload.ts`, and the literal `10` in the
SQL carries a comment naming that constant. The integration test drives the SQL cap with the shared
constant, so the two cannot drift silently. **No `MAX_FILES_PER_UPLOAD` env var**, although PRD
§9.2 lists one: a value enforced in SQL cannot be configured from Node, and a configurable
Node-side copy would be a second rule that disagrees with the first.

### D3 — Soft-deleted payslips do not count toward the ten

The trigger counts `where deleted_at is null`. Otherwise a user who deletes a bad upload can never
replace it. A merge (Task 11) would also fail in any full session, because it adds one payslip and
soft-deletes two.

**Recorded for Task 11:** at exactly ten payslips, inserting the merged payslip before soft-deleting
the originals would still hit the cap. Task 11 must soft-delete the originals first, in the same
request.

### D4 — PATCH stays in Task 09; its ownership is proven at the repository layer

The Task 03 DoD says a second user "cannot read, **patch** or delete". PATCH (§10.6) is not in
this task's endpoint list. It needs the warnings engine (06) to "recompute on every PATCH" and
belongs to the review form (09). Building it here would mean building it twice.

What "cannot patch" really asks is whether RLS stops a cross-user update, and that **is** in this
task: `PayslipRepository.update` is the method Task 09's PATCH will call. The integration test
calls `update` as user B on user A's payslip and asserts it returns `null` with A's row unchanged.
The ROADMAP DoD line is reworded to say this (step 14).

### D5 — The row model

`sessions`:

- `id`, `user_id`, `created_at`, `deleted_at`
- grants to `authenticated`: `select`, `insert` only. Nothing is granted to `anon`.
- no update grant, because no endpoint modifies a session in this task. `deleted_at` exists per
  Appendix B and stays unused until a task needs it.

`payslips`: Appendix B's columns, plus:

- `warnings jsonb not null default '[]'`. `payslipSchema.warnings` and `warningCount` read it.
  Appendix B omits it; receipt-ocr stored it the same way.
- `failure_reason text null`, checked against the three `EXTRACTION_FAILURE_REASONS`.
  `payslipSummarySchema.failureReason` and `payslipDetailResponseSchema.failureReason` need a
  source. A typed column beats a key buried in `extraction_metadata`, and adding it now avoids
  a Task 04 migration.

No `source_object_path` column: the path is derived by `sourceObjectPath(userId, payslipId)`.
No `currency` column: it is always `"EUR"` (locked decision 7), set by the row mapper.

`payslips` grants to `authenticated`: `select`, `insert`, `update`. There is **no `delete`**:
deletion is soft, by `update`.

Policies (all `to authenticated`, all `(select auth.uid())`, receipt-ocr's form):

- `sessions`: select own, insert own.
- `payslips`: select own. Insert with check own **and** the session is owned and not deleted.
  Update using own, with check own **and** session owned.

The `exists` sub-check matters because a foreign key is checked **without RLS**. Without it, user
B could attach a row to user A's session id and it would show up in A's session detail.

`on delete cascade` from `auth.users` to both tables, and from `sessions` to `payslips`, so the
integration teardown's `deleteUser` removes every row.

### D6 — "The migration is idempotent" means the migration history, not re-runnable DDL

Supabase records each applied migration version and never re-applies it. That is the idempotency
the platform provides, and receipt-ocr relied on it. Making the DDL itself re-runnable (`drop policy
if exists`, `do $$` blocks, `create … if not exists`) roughly doubles the SQL for a case that never
happens.

"Applies cleanly to an empty database" is proven by a **transactional dry run on the hosted
project before the real apply**: `begin; <migration>; rollback;` through `execute_sql`, while the
project is still empty. The ROADMAP DoD line is reworded accordingly (step 14).

### D7 — The hosted project is dedicated and empty, so the migration goes there, via MCP

Verified during planning:

- `.env` points at `hxksulbgluvfxfoxrhse`, while receipt-ocr uses `ssczfjvbeqyrlbasfyzj`.
- `list_tables` on `public` returned `[]` and `list_migrations` returned `[]`.
- `storage.buckets` holds only `payslip-sources` (private, 12 MB).
- No table names can collide.

The local Docker stack is avoided (the owner's standing preference). The Supabase CLI is not
linked (`supabase/.temp` is absent) and `db push` would need the database password.

So: dry run, then `mcp__supabase__apply_migration`, then rename the local file to the version
`list_migrations` reports. That keeps local and remote history identical, so a later `db push` or
`migration list` sees no drift.

Types are regenerated with `mcp__supabase__generate_typescript_types`, since `npm run db:types`
uses `--local`. **Do not** use `execute_sql` for DDL: receipt-ocr's Task 03 history (decision 5)
records that migration history must not be bypassed.

### D8 — Payslips stay in `processing` until Task 04

PRD §10.3 says the upload "starts extraction immediately". That is Task 04. Task 03 creates the
row in `processing`, returns 201, and does nothing else. That matches PRD Phase 1's validation
("see four payslips in `processing`").

No stub provider, no injected extraction seam, no `setTimeout`. A comment at the insert names
Task 04 as the place extraction starts.

`GET /api/payslips/:id` returns `lowConfidenceFields: []` and `unreadableFields: []`. They are
projections over `extraction_metadata`, which is always null until Task 04, and the comment says so.
`editedFields` comes from the `edited_fields` column. `failureReason` comes from `failure_reason`.

### D9 — The generated `numeric` columns cannot fail an insert

`neto_placa` and `iznos_za_isplatu` cast only when the text matches the same regex as
`AMOUNT_PATTERN`, otherwise they are `null`. This is receipt-ocr's `total` column, verbatim:

```sql
case when canonical_data ->> 'netoPlaca' ~ '^-?[0-9]+(\.[0-9]+)?$'
  then (canonical_data ->> 'netoPlaca')::numeric else null end
```

The zod parse in the repository is still the real gate, but a malformed string can never turn an
insert into a 500. **Canonical money is never read back from these columns.** They exist for list
and export queries only. Text projections use `nullif(btrim(...), '')`.

### D10 — `pageCount` is measured at upload, from the bytes

`payslips.page_count` is `not null check (page_count >= 1)`. `validateSourceFile` already loads
PDFs with `pdf-lib` to count pages, so it returns the count it computed. Images are `1`.
`SourceFile` gains `pageCount`, and `validatePdf` returns the number instead of `void`.

---

## CONTEXT REFERENCES

### Relevant Codebase Files — READ BEFORE IMPLEMENTING

- `../receipt-ocr/supabase/migrations/20260817122048_create_receipts.sql`: the migration to
  mirror. Its grant/RLS/policy form, generated columns, partial index and Storage policies are all
  reused. Differences: the bucket id is `payslip-sources`, there is no `update` Storage policy
  (nothing upserts), and payslips has the session sub-check (D5).
- `../receipt-ocr/api/src/repositories/receipts.ts`: the repository to mirror: class with `#client`
  and `#userId`, `uuidSchema.parse`, every query `.eq("user_id", …).is("deleted_at", null)`, the
  `…RepositoryError` with `invalid_data | query_failed`, the `PGRST103` out-of-range handling in
  `listPage`, `mapReceiptRow`, `normalizeTimestamp` and `toJson`.
- `../receipt-ocr/api/src/routes/receipts.ts` (lines 35–60, 104–128, 196–240, 272–291): the
  route idioms: `idSchema.safeParse(req.params["id"])` → `400 invalid_request`, `null` → `404
  not_found`, upload → `uploadSource` → create → on failure `removeSource` best-effort then
  rethrow, `SOURCE_URL_TTL_SECONDS` for `expiresAt`.
- `../receipt-ocr/api/src/routes/receipts.integration.ts` (lines 1–120): the two-user hosted
  integration shape: per-run ids, a greppable email prefix, admin cleanup in `afterAll`, `pdf()`
  built with `pdf-lib`, and the minimal JPEG byte literal.
- `api/src/app.ts`: add two routers after `requireAuth` and before the 404 fallthrough.
- `api/src/app.test.ts` (lines 60–75): the "valid token falls through to 404" test uses a `{}`
  client. It breaks once `GET /api/payslips/:id` is routed (step 12).
- `api/src/auth/auth.integration.ts` (lines 55–63, 66–95): its 404 test description becomes
  stale. Reuse `createAndSignIn`, `createServerClient` and `requiredEnv` as a pattern (copy them;
  receipt-ocr also duplicated them per file).
- `api/src/auth/authenticator.ts`: `AuthContext.client` is already a user-scoped client, so every
  repository query runs under RLS. **Never** use the secret key on a request path.
- `api/src/middleware/require-auth.ts`: `authenticated(handler)` passes `auth` as an argument.
- `api/src/middleware/error-handler.ts`: `HttpError(status, code)`.
- `api/src/upload/multipart.ts`: `sourceFileUpload` (renamed from receipt-ocr's
  `receiptSourceUpload`).
- `api/src/upload/source-file.ts`: `validateSourceFile`, `validatePdf` (gains the page count, D10).
- `api/src/upload/source-file.test.ts`: extend it for `pageCount`.
- `api/src/storage/payslip-sources.ts`: `sourceObjectPath`, `uploadSource`,
  `createSourceSignedUrl`, `removeSource`, `SOURCE_URL_TTL_SECONDS`. Already correct; do not change.
- `shared/src/api.ts`: the DTOs. Build every response to satisfy them:
  - `createSessionResponseSchema`, `createPayslipResponseSchema`
  - `payslipSummarySchema`, `sessionDetailResponseSchema`, `payslipDetailResponseSchema`
  - `listPayslipsQuerySchema`, `listPayslipsResponseSchema`, `sourceDocumentResponseSchema`
- `shared/src/payslip.ts`: `canonicalPayslipFieldsSchema` (tier 1, strict), `payslipSchema`
  (envelope), `Payslip`.
- `shared/src/session.ts`: `sessionSchema`, `payslipStatusSchema`,
  `extractionFailureReasonSchema`, `EXTRACTION_FAILURE_REASONS`.
- `shared/src/warnings.ts`: `payslipWarningSchema`.
- `shared/src/upload.ts`: gains `session_full` and `MAX_PAYSLIPS_PER_SESSION` (D1, D2).
- `client/src/i18n/locales/{en,hr}.json` (`"upload"` block, around line 87):
  `uploadErrors.test.ts` enforces the new key.
- `scripts/run-supabase-integration-tests.mjs` (line 16): the `integrationFiles` list. Add the
  new file.
- `.claude/commands/validate.md`: Phase 4 table, Phase 8 (add the schema checks), Phase 10 row 03.
  Extend it by hand; **never regenerate it**.

### New Files to Create

- `supabase/migrations/<version>_create_sessions_and_payslips.sql`: the schema (step 2).
- `api/src/repositories/sessions.ts`: `SessionRepository`.
- `api/src/repositories/payslips.ts`: `PayslipRepository`, `mapPayslipRow`, `PayslipRepositoryError`.
- `api/src/repositories/payslips.test.ts`: unit tests for the row mapper and the error mapping.
- `api/src/routes/sessions.ts`: `createSessionsRouter()`: §10.2, §10.3, §10.4.
- `api/src/routes/payslips.ts`: `createPayslipsRouter()`: §10.5, §10.9, §10.12, §10.13.
- `api/src/routes/payslips.integration.ts`: the hosted two-user DoD suite.
- `.agents/history/03-session-payslip-persistence-upload.md`: the completion record.

### Relevant Documentation

- [Supabase — Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security#rls-performance-recommendations):
  wrap `auth.uid()` in `(select …)` so it is evaluated once per statement. Also: policies need
  table grants.
- [Supabase — Storage access control](https://supabase.com/docs/guides/storage/security/access-control):
  `storage.foldername(name)[1]` as the owner segment. `createSignedUrl` needs a `select` policy,
  and `remove` needs `delete`.
- [PostgREST — errors raised from SQL](https://docs.postgrest.org/en/stable/references/errors.html#raise-errors-with-http-status-codes):
  a plain `raise exception … using errcode = 'P0001'` reaches supabase-js as
  `error.code === "P0001"` with `error.message` equal to the raised text. That is what the
  repository matches.
- [PostgreSQL — advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS):
  `pg_advisory_xact_lock` is released at transaction end. Each PostgREST request is one
  transaction.
- [PostgreSQL — CREATE TRIGGER](https://www.postgresql.org/docs/current/sql-createtrigger.html):
  EXECUTE on the trigger function is checked when the trigger is created, not when it fires.
  An invoker-rights function needs no grant to `authenticated`.

### Patterns to Follow

**Repository query shape** (receipt-ocr `receipts.ts`, `findById`):

```ts
const { data, error } = await this.#client
  .from("payslips")
  .select("*")
  .eq("id", uuidSchema.parse(id))
  .eq("user_id", this.#userId)
  .is("deleted_at", null)
  .maybeSingle();
if (error) throw new PayslipRepositoryError("query_failed", error);
return data === null ? null : mapPayslipRow(data);
```

Keep the explicit `.eq("user_id", …)` even though RLS enforces the same thing. receipt-ocr does
this so the query is correct under a client that bypasses RLS, and the index matches it.

**Route shape** (receipt-ocr `receipts.ts`):

```ts
router.get(
  "/:id",
  authenticated(async (req, res, auth) => {
    const id = idSchema.safeParse(req.params["id"]);
    if (!id.success) throw new HttpError(400, "invalid_request");
    const payslip = await new PayslipRepository(auth.client, auth.userId).findById(id.data);
    if (payslip === null) throw new HttpError(404, "not_found");
    res.json(/* the DTO */);
  }),
);
```

**Comment density:** one short doc comment per route naming its PRD section, and a comment wherever
a rule is enforced elsewhere (for example: "no ownership check here: the query and RLS are the
check"). Match `app.ts` and `require-auth.ts`.

**Imports:** `api/` uses `nodenext`, so relative imports end in `.js`. Shared symbols come from
`@payslip/shared`.

**Money:** never read `neto_placa` or `iznos_za_isplatu` in TypeScript (D9). Canonical values come
from `canonical_data` only.

---

## IMPLEMENTATION PLAN

1. **Foundation:** the shared constant and error code, then the migration, applied to the hosted
   project through the dry run then apply sequence, then regenerated types.
2. **Core:** `validateSourceFile` gains `pageCount`, then the two repositories with their unit tests.
3. **Integration:** the two routers, wired into `createApp`, and the existing tests updated.
4. **Testing & records:** the hosted integration suite, `validate.md` extended, then the ROADMAP,
   PRD and history.

---

## STEP-BY-STEP TASKS

Execute in order. Run each step's VALIDATE once. Do not re-run a check that already passed.

### 1. UPDATE `shared/src/upload.ts` + both locales — `session_full` and the cap (D1, D2)

- **IMPLEMENT**:
  - Append `"session_full"` to `UPLOAD_ERROR_CODES`.
  - Update the doc comment's count ("These seven codes…") and say the cap is enforced by the
    database.
  - Add `export const MAX_PAYSLIPS_PER_SESSION = 10;` with a doc comment: PRD §4.1, enforced by
    the `payslips` insert trigger, which is the only enforcement point. The SQL literal names this
    constant.
- **UPDATE** the `"upload"` blocks in `client/src/i18n/locales/en.json` and `hr.json`:
  - The literal "10" is deliberate, not an interpolation. The cap is a fixed product rule enforced in
    SQL, not configurable, and the sibling strings already print "10 MB" and "10 pages" literally.
    No component renders upload errors yet (Task 07), so there is no call site to pass a value.
  - en: `"session_full": "This session already holds 10 payslips. Start a new session to add more."`
  - hr: `"session_full": "Ova sesija već sadrži 10 platnih lista. Započnite novu sesiju za dodatne."`
- **UPDATE** `shared/src/index.ts`: it names every export explicitly, so add
  `MAX_PAYSLIPS_PER_SESSION` to the `./upload.js` block, alphabetically before
  `SOURCE_CONTENT_TYPES`.
- **VALIDATE**:
  `npx vitest run --project shared && npx vitest run --project client src/i18n`

### 2. CREATE `supabase/migrations/20260924120000_create_sessions_and_payslips.sql`

Use this provisional name. Step 3 renames it to the recorded version.

- **IMPLEMENT**, in this order:
  1. **`public.sessions`**:
     - `id uuid primary key default gen_random_uuid()`
     - `user_id uuid not null references auth.users (id) on delete cascade`
     - `created_at timestamptz not null default now()`
     - `deleted_at timestamptz`
     - `comment on table`.
  2. **`public.payslips`**:
     - `id uuid pk default gen_random_uuid()`
     - `session_id uuid not null references public.sessions (id) on delete cascade`
     - `user_id uuid not null references auth.users (id) on delete cascade`
     - `status text not null default 'processing'` with a check `in ('processing','review','confirmed','failed')`
     - `failure_reason text` with a check `failure_reason is null or failure_reason in ('unreadable_document','provider_rejected','provider_unavailable')`
     - `canonical_data jsonb not null default '{}'` with a check `jsonb_typeof = 'object'`
     - `extraction_metadata jsonb`
     - `raw_provider_result jsonb`
     - `warnings jsonb not null default '[]'` with a check `jsonb_typeof = 'array'`
     - `edited_fields text[] not null default '{}'`
     - `original_filename text not null` with a not-blank check
     - `content_type text not null` with a check `in ('image/jpeg','image/png','image/heic','image/heif','application/pdf')`
     - `page_count integer not null` with a check `>= 1`
     - `merged_from uuid[]`
     - `confirmed_at timestamptz`
     - `created_at` and `updated_at timestamptz not null default now()`
     - `deleted_at timestamptz`
     - **generated stored columns**: `employee_name`, `employer_name`, `period` (text, via
       `nullif(btrim(canonical_data ->> '…'), '')`), plus `neto_placa numeric` and
       `iznos_za_isplatu numeric` (regex-guarded cast, D9).
  3. **Grants**:
     - `revoke all on table public.sessions, public.payslips from anon, authenticated;`
     - `grant select, insert on table public.sessions to authenticated;`
     - `grant select, insert, update on table public.payslips to authenticated;`
  4. **RLS enabled on both tables**, with the policies in D5. The payslips insert `with check` and
     update `with check` both carry:
     ```sql
     (select auth.uid()) = user_id
     and exists (
       select 1 from public.sessions s
       where s.id = session_id and s.user_id = (select auth.uid()) and s.deleted_at is null
     )
     ```
     Update `using` is `(select auth.uid()) = user_id` only.
  5. **Indexes**:
     - `create index payslips_active_user_created_at_idx on public.payslips (user_id, created_at desc) where deleted_at is null;` (ROADMAP scope)
     - `create index payslips_active_session_idx on public.payslips (session_id) where deleted_at is null;`
       This serves the session detail read and the cap trigger's count.
  6. **The cap trigger** (D2). The function is `language plpgsql`, invoker rights,
     `set search_path = ''`, and schema-qualifies `public.payslips`:
     ```sql
     perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.session_id::text, 0));
     if (select count(*) from public.payslips
         where session_id = new.session_id and deleted_at is null) >= 10 then
       -- 10 = MAX_PAYSLIPS_PER_SESSION in shared/src/upload.ts. Deleted payslips do not count.
       raise exception 'session_full' using errcode = 'P0001';
     end if;
     return new;
     ```
     Name it `public.enforce_session_payslip_cap()`, then add
     `revoke execute on function public.enforce_session_payslip_cap() from public, anon, authenticated;`
     and `create trigger payslips_session_cap before insert on public.payslips for each row execute function public.enforce_session_payslip_cap();`
  7. **Storage policies** on `storage.objects` for `bucket_id = 'payslip-sources'` and
     `(storage.foldername(name))[1] = (select auth.uid())::text`: `select`, `insert` and `delete`
     only. Mirror receipt-ocr's wording with "payslip sources".
- **GOTCHA**: `hashtextextended` needs PostgreSQL 11 or later. Hosted runs 15 or later.
- **GOTCHA**: the Storage policy names must be unique across `storage.objects`. The project is
  dedicated, so there is no collision, but keep "payslip" in every name.
- **GOTCHA**: do not add `security definer`. The advisory lock is why invoker rights suffice (D2).
- **VALIDATE**: step 3's dry run.

### 3. APPLY the migration to the hosted project (D6, D7)

1. **Re-check the project is still empty**: `mcp__supabase__list_tables` (`public`) → `[]`, and
   `mcp__supabase__list_migrations` → `[]`. If either is not empty, **stop and report**; do not
   apply over unknown state.
2. **Dry run**: `mcp__supabase__execute_sql` with `begin;` + the file's exact contents +
   `rollback;`.
   - It must succeed.
   - Afterwards `list_tables` must still be `[]`.
   - If the tool refuses explicit transaction control, record that in the history file and rely on
     step 3.3 as the clean-apply proof, since the project is verifiably empty.
3. **Apply**: `mcp__supabase__apply_migration` with `name: "create_sessions_and_payslips"` and the
   file's contents.
4. **`mcp__supabase__list_migrations`**: note the `version` it recorded. **Rename** the local file
   to `<that version>_create_sessions_and_payslips.sql` with `git mv` if already staged, otherwise
   a plain rename.
5. **Verify the result**:
   - `list_tables` (verbose) shows both tables with RLS enabled.
   - `mcp__supabase__execute_sql`:
     `select policyname, tablename from pg_policies where schemaname in ('public','storage') order by 2,1;`
     returns 2 session, 3 payslip and 3 storage policies.
   - `select grantee, table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') order by 1,2,3;`
     returns exactly the D5 grants.
6. **`mcp__supabase__get_advisors`** (`security`): no new finding. Any finding about these tables
   or this function is fixed in the migration, which means a **second** migration, because the
   first is already recorded. Record it.
- **GOTCHA**: this is the one outward-facing step. It is authorized by the ROADMAP ("Integration
  tests against the hosted Supabase project"), and the project is the prototype's own dev project.
  Do not touch any other project ref.

### 4. REGENERATE `api/src/database.types.ts`

- **IMPLEMENT**: call `mcp__supabase__generate_typescript_types` and write its output **verbatim**
  over `api/src/database.types.ts`.
- **GOTCHA**: the file is in `.prettierignore`, so do not format it.
- **GOTCHA**: generated columns appear in `Insert`/`Update` types. The repositories must never set
  them. The database rejects a write to a generated column anyway.
- **VALIDATE**: `npm run typecheck`

### 5. UPDATE `api/src/upload/source-file.ts` + `source-file.test.ts` — `pageCount` (D10)

- **IMPLEMENT**:
  - `SourceFile` gains `readonly pageCount: number`.
  - `validatePdf` returns `document.getPageCount()` after its checks.
  - Images return `1`.
- **TESTS**: a 3-page `pdf-lib` document reports `3`; a PNG or JPEG reports `1`. The existing
  cases stay unchanged.
- **VALIDATE**: `npx vitest run --project api src/upload`

### 6. CREATE `api/src/repositories/sessions.ts`

- **IMPLEMENT** `SessionRepository(client, userId)`, mirroring the receipt-ocr class shape:
  - `create(): Promise<Session>` inserts `{ user_id }` and returns `.select("*").single()`.
  - `findById(id): Promise<Session | null>` filters `user_id` and `deleted_at is null`.
  - `mapSessionRow(row)` builds `sessionSchema.parse({ id, userId, createdAt, deletedAt })` with
    normalized ISO timestamps. A parse failure becomes `SessionRepositoryError("invalid_data")`.
- **GOTCHA**: `normalizeTimestamp` is needed because PostgREST returns
  `2026-09-24T10:00:00.123456+00:00`, which `z.iso.datetime()` rejects. Copy receipt-ocr's helper.
  Do not create a shared util module for two callers; each repository file keeps its own private
  copy, as receipt-ocr did.
- **VALIDATE**: `npm run typecheck`

### 7. CREATE `api/src/repositories/payslips.ts`

- **IMPLEMENT** `PayslipRepository(client, userId)`:
  - `create({ id, sessionId, originalFilename, contentType, pageCount })`:
    - `status` defaults to `processing`, and `canonical_data` to `{}`.
    - If `error.code === "P0001" && error.message === "session_full"`, throw
      `PayslipRepositoryError("session_full")`. Any other error is `query_failed`.
  - `findById(id)`.
  - `findDetailState(id)` → `{ payslip, editedFields, failureReason } | null`: one `select("*")`,
    for the detail route.
  - `listBySession(sessionId)` → `Payslip[]`, `order("created_at", asc).order("id", asc)`. This is
    **upload order**, which Task 11's merge dialog relies on.
  - `findSourceById(id)` → `{ contentType, originalFilename } | null`.
  - `listPage({ page, limit, status })` → `{ items, total }`. Mirror receipt-ocr exactly,
    including the `PGRST103` out-of-range branch.
  - `update(id, input)` sets `updated_at`. For this task the input is `{ deletedAt?: string }`
    only; Tasks 04/09 extend it. Returns `Payslip | null`.
  - `softDelete(id)` → `update(id, { deletedAt: now })`.
- **`mapPayslipRow(row)`** (exported for unit tests) builds `payslipSchema.parse` from:
  - `...canonicalPayslipFieldsSchema.parse(row.canonical_data)`
  - `id`, `sessionId`, `userId`, `status`, `pageCount`
  - `currency: "EUR"`
  - `warnings: z.array(payslipWarningSchema).parse(row.warnings)`
  - the timestamps

  Any throw becomes `PayslipRepositoryError("invalid_data")`.
- **Error codes**: `PayslipRepositoryErrorCode = "invalid_data" | "query_failed" | "session_full"`.
- **GOTCHA**: `update` filters `deleted_at is null`, so soft-deleting twice returns `null` the
  second time, and the route answers 404. That is intended.
- **VALIDATE**: `npm run typecheck`

### 8. CREATE `api/src/repositories/payslips.test.ts`

- **TESTS** (pure; no Supabase):
  - A complete row maps to a `Payslip` that satisfies `payslipSchema`, with `currency === "EUR"`.
  - Timestamps with microseconds and `+00:00` normalize to `…Z`.
  - `canonical_data` holding an unknown key, or a printed amount (`"2.298,97"`), throws
    `PayslipRepositoryError` with code `invalid_data`.
  - A row whose `neto_placa` is `2298.97` (a number) but whose `canonical_data.netoPlaca` is
    `"2298.970"` maps to `"2298.970"`, which proves money comes from the canonical JSON (D9).
  - `create` maps a `{ code: "P0001", message: "session_full" }` error to `session_full`, and any
    other error to `query_failed`. Use a minimal fake: an object whose
    `from().insert().select().single()` resolves `{ data: null, error }`. Keep it inline in the
    test; do not add a mocking library.
- **VALIDATE**: `npx vitest run --project api src/repositories`

### 9. CREATE `api/src/routes/sessions.ts` — §10.2, §10.3, §10.4

- **`POST /`** → `201 createSessionResponse { id, createdAt }`.
- **`POST /:id/payslips`**, with `sourceFileUpload` before `authenticated`, as receipt-ocr does:
  1. Validate `id`, else `400 invalid_request`.
  2. `SessionRepository.findById` → null → `404 not_found`. This runs **before** file
     validation, so a foreign session id never learns anything about the file.
  3. `validateSourceFile(req.file)`.
  4. `payslipId = randomUUID()`, `path = sourceObjectPath(auth.userId, payslipId)`, then
     `uploadSource`.
  5. `PayslipRepository.create(...)`.
     - On `session_full`: `removeSource` (best-effort), then `409 session_full`.
     - On any other error: `removeSource` (best-effort), then rethrow.
  6. `201 { id, sessionId, status, createdAt }`, plus a comment: "Extraction starts here in Task 04
     (D8)."
- **`GET /:id`**:
  1. `findById` → null → 404.
  2. `listBySession`.
  3. Map each payslip to `payslipSummarySchema`:
     `{ id, status, period: p.period ?? null, employeeName: p.employeeName ?? null, pageCount, failureReason, warningCount: p.warnings.length }`.
     `failureReason` comes from the row, so `listBySession` must carry it. Either return
     `{ payslip, failureReason }[]`, or add `failureReason` to the returned object only in this
     projection. Pick the first; do not widen `Payslip`.
  4. `200 { id, createdAt, payslips }`.
- **GOTCHA**: type each response body as its shared DTO type (`CreateSessionResponse`,
  `CreatePayslipResponse`, `SessionDetailResponse`) so a contract drift is a compile error.
- **VALIDATE**: `npm run typecheck`

### 10. CREATE `api/src/routes/payslips.ts` — §10.5, §10.9, §10.12, §10.13

Register routes in this order: `GET /`, `GET /:id/source`, `GET /:id`, `DELETE /:id`.

- **`GET /`**:
  - `listPayslipsQuerySchema.safeParse(req.query)` → 400 on failure.
  - Respond `{ items, total, page, limit }`, typed `ListPayslipsResponse`.
- **`GET /:id/source`**:
  - `findSourceById` → null → 404.
  - Respond `{ url: createSourceSignedUrl(...), contentType, originalFilename, expiresAt }`, with
    `expiresAt = now + SOURCE_URL_TTL_SECONDS`.
- **`GET /:id`**:
  - `findDetailState` → null → 404.
  - Respond `{ ...payslip, lowConfidenceFields: [], unreadableFields: [], editedFields, failureReason }`,
    typed `PayslipDetailResponse`. The comment on the two empty arrays: "projections over
    `extraction_metadata`, which Task 04 populates (D8)".
- **`DELETE /:id`**:
  - `softDelete` → null → 404.
  - Otherwise `res.status(204).end()`.
  - The source object is **kept**: soft delete is reversible by design, as in receipt-ocr.
- **Doc comment**: on `GET /:id`, carry receipt-ocr's comment: 404 never 403, and no ownership
  check because the query and RLS are the check.
- **VALIDATE**: `npm run typecheck`

### 11. UPDATE `api/src/app.ts` — mount the routers

- **IMPLEMENT**: after the `requireAuth` line add
  `app.use("/api/sessions", createSessionsRouter());` and
  `app.use("/api/payslips", createPayslipsRouter());`.
  Update the guard comment's "every session/payslip route Task 03 adds" to present tense.
- **GOTCHA**: they must come after `requireAuth` and before the 404 middleware. `authenticated()`
  throws loudly if the order is wrong.

### 12. UPDATE `api/src/app.test.ts` and `api/src/auth/auth.integration.ts`

- **`app.test.ts`** (lines 60–75): the `{}` client would now be called by `GET /api/payslips/:id`.
  Change the request to a path the routers do not define, such as
  `GET /api/sessions/${randomUUID()}/not-a-route`, and reword the test to "passes authentication
  and reaches the router, which answers 404 for an unknown path". It still proves the guard lets
  a valid token through without touching the client.
- **`auth.integration.ts`** (line 55): reword the description to "…and answers 404 for a payslip
  that does not exist". The assertion is unchanged, because an unknown id is still 404.
- **VALIDATE**: `npx vitest run --project api`

### 13. CREATE `api/src/routes/payslips.integration.ts` + register it

- **Setup**:
  - Users A and B with the `task03-a-…` / `task03-b-…` email prefix. Copy `createAndSignIn`,
    `createServerClient` and `requiredEnv` from `auth.integration.ts`.
  - `createApp()` with the real authenticator.
  - `afterAll`: `admin.storage.from(config.STORAGE_BUCKET).remove(sourcePaths)`, then delete both
    users. The rows cascade.
  - Fixtures: the minimal JPEG byte literal from receipt-ocr, and `pdf(pages)` built with `pdf-lib`.
- **Cases** (each maps to a DoD line):
  1. A creates a session: 201, and the body parses with `createSessionResponseSchema`.
  2. A uploads a JPEG and a 2-page PDF: 201 each, `status` is `processing`, and the stored bytes
     download identical through A's client. `GET /api/payslips/:id` shows `pageCount` 1 and 2.
  3. `GET /api/sessions/:id` parses with `sessionDetailResponseSchema` and lists both in upload
     order. The summary shows `period: null`, `employeeName: null`, `warningCount: 0`,
     `failureReason: null`.
  4. **Cap (D2)**: in a fresh session, fire `MAX_PAYSLIPS_PER_SESSION + 1` uploads **concurrently**
     (`Promise.all`). Exactly 10 are 201 and exactly one is `409 session_full`, and the session
     then lists exactly 10 payslips. The rejected upload's storage object does not exist.
     - Find it by listing A's Storage folder with the admin client. Every object there must map to
       a live payslip id.
  5. **D3**: soft-delete one of those ten → 204. A further upload to that session → 201.
  6. **Rejections** (each creates no row, and the session's count is unchanged):
     - An encrypted PDF → `422 pdf_encrypted`. `pdf-lib` cannot encrypt, so reuse
       `source-file.test.ts:42–47`'s trick: take a `pdf(1)` buffer, convert it to latin1, and
       replace `/trailer\s*\n?<</` with `"trailer\n<< /Encrypt 1 0 R "`.
     - A `config.MAX_PDF_PAGES + 1`-page PDF (11 at the default) → `422 pdf_too_many_pages`.
       Derive the count from `config`, never a literal: the limit is an environment variable.
     - `.txt` bytes named `payslip.pdf` → `415 unsupported_media_type`.
  7. **List** `GET /api/payslips?limit=2`: `total` counts only A's non-deleted payslips.
     `?status=review` → `total` 0. `?page=999` → `items` `[]`, the `PGRST103` path.
  8. **Source** `GET /api/payslips/:id/source`: 200, parses with `sourceDocumentResponseSchema`,
     and fetching `url` returns the exact bytes. `expiresAt` is about 300 s ahead (within 10 s).
  9. **Isolation, 404 everywhere**. As B:
     - `GET /api/sessions/:aSession`, `POST /api/sessions/:aSession/payslips`,
       `GET /api/payslips/:aPayslip`, `GET /api/payslips/:aPayslip/source` and
       `DELETE /api/payslips/:aPayslip` → **404 `not_found`** each, never 403.
     - B's `GET /api/payslips` → `total` 0.
     - A's rows are unchanged afterwards.
  10. **Cross-user update (D4)**: `new PayslipRepository(userBClient, userBId).update(aPayslipId, { deletedAt: now })`
      returns `null`, and A still reads the payslip.
  11. **FK bypass (D5)**: B inserts directly through PostgREST
      (`userB.from("payslips").insert({ session_id: aSession, user_id: userBId, … })`). It must
      fail with an RLS error, and A's session detail must not gain a row.
  12. **Soft delete**: after `DELETE`, the payslip is gone from `GET /api/payslips`,
      `GET /api/sessions/:id` and `GET /api/payslips/:id` (404). A second `DELETE` → 404.
- **UPDATE** `scripts/run-supabase-integration-tests.mjs`: append
  `"src/routes/payslips.integration.ts"` to `integrationFiles`.
- **GOTCHA**: each case uploads real bytes to hosted Storage. Push every created path into
  `sourcePaths` immediately after the 201, so a failed assertion still cleans up.
- **GOTCHA**: the concurrent case sends 11 × ~20-byte JPEGs. Keep `testTimeout` at 30 s. If the
  free tier is slow, raise it for this one test, not globally.
- **VALIDATE**: `npm run test:integration` (it must print the **hosted** host), then the orphan
  check from validate.md Phase 8, which must print `[]`.

### 14. UPDATE docs — `validate.md`, ROADMAP, PRD, history

- **`.claude/commands/validate.md`**:
  - Phase 4 table: add rows for `repositories/payslips.test.ts` (row mapping, money from JSON,
    `session_full` mapping) and extend the `source-file.test.ts` row with `pageCount`.
  - Phase 8: add `payslips.integration.ts` to the description, with a one-line list of what it
    proves: owner scope, 404 everywhere, the atomic cap, soft delete, signed source. Add a
    **schema sub-phase without Docker**:
    - `mcp__supabase__list_migrations` matches `ls supabase/migrations`.
    - `mcp__supabase__get_advisors` (`security`) reports no finding on `sessions`, `payslips` or
      `enforce_session_payslip_cap`.
  - Phase 10: delete row 03. Add a sentence to Phase 8 that Task 03's journey is the hosted
    integration suite, because Task 03 has no UI. The first **browser** journey against the API
    arrives with Task 07.
- **`.agents/ROADMAP.md`**:
  - §2: Task 03 → ✅ complete, linking the history file.
  - §3 Task 03 DoD: tick the boxes, and reword two lines to what was actually proven:
    - "Migration applies cleanly to an empty database (transactional dry run) and is recorded
      once in the migration history (D6)".
    - "…cannot read or delete… and receives 404 in every case; cross-user **update** is refused at
      the repository layer that Task 09's PATCH will use (D4)".
  - §3 Task 11 scope: add "soft-delete the originals before inserting the merged payslip; the
    ten-payslip cap counts live payslips only (Task 03 D3)".
- **`PRD.md`**:
  - §10.3: `415 unsupported_media_type` replaces `422 … unsupported_file_type`, and
    `409 session_full` stays.
  - §9.2: remove `MAX_FILES_PER_UPLOAD` and add a note that the cap is `MAX_PAYSLIPS_PER_SESSION`,
    enforced in the database (D2).
  - Appendix B: add `warnings jsonb` and `failure_reason` (D5).
- **CREATE `.agents/history/03-session-payslip-persistence-upload.md`**, in the Task 02 history
  file's shape: what was built, D1–D10, deviations, the validation table, the hosted migration
  version, the advisor result, and open items. The open items are at least:
  - Task 04 starts extraction at the marked line and populates the three detail projections.
  - Task 07 must check the first client-to-API call on the **deployed** client (01b gap 1).
  - Task 11: D3's ordering.
  - Direct PostgREST writes by a signed-in user to their own rows are possible, because the
    grants allow `update` on `payslips`. This is inherited from receipt-ocr's model and
    acceptable for a demo. Record it, do not fix it. Name Tasks 06 and 09 in it: once warnings and
    confirm treat `status` and `canonical_data` as trustworthy, a direct write can set `confirmed`
    or skip the warning recompute. Revoking `update` in favour of a narrower path is their call.

### 15. RUN the gates once each

`npm run validate` → `npm run build` → the validate.md Phase 6 checks. Then run
`npm run test:integration` if steps 13–14 changed code after its last green run.

---

## TESTING STRATEGY

### Unit Tests

- `repositories/payslips.test.ts`: the row mapper and error mapping (step 8). Pure, with no
  network.
- `upload/source-file.test.ts`: `pageCount` (step 5).
- `app.test.ts`: the guard still passes a valid token through (step 12).
- `client/src/i18n/uploadErrors.test.ts` and `i18n.test.ts`: already cover `session_full` once the
  locale keys exist.

The routes get **no mocked-Supabase unit tests**. Their behaviour is owner scoping, RLS and a
database trigger, which a mock would only restate. The hosted suite is where they are proven.

### Integration Tests

`api/src/routes/payslips.integration.ts` (step 13): real Express app, real ES256 tokens, real
hosted Postgres and Storage, two users. This is the DoD's proof.

### Edge Cases

- 11 concurrent uploads into one session: exactly one `409` (D2).
- A cap reached, then one payslip soft-deleted: an upload succeeds again (D3).
- Uploading into a foreign session is 404 before the file is even inspected.
- An FK-only attach to a foreign session is refused by RLS (D5).
- Soft-deleting twice → 404 the second time.
- `?page` beyond the last page → empty items, correct total (`PGRST103`).
- The rejected cap upload leaves no orphan Storage object.
- A Croatian filename (`platna-lista-ožujak.pdf`) survives into `originalFilename`, because
  multer's `defParamCharset: "utf8"` handles it. Assert it in case 8.

---

## VALIDATION COMMANDS

### Level 1: Syntax & Style

`npm run typecheck && npm run lint && npm run format:check`

### Level 2: Unit Tests

`npm test` (all three projects)

### Level 3: Integration Tests

`npm run test:integration`, then the Phase 8 orphan check (it must print `[]`).

### Level 4: Hosted schema (Supabase MCP, no Docker)

- `mcp__supabase__list_migrations`: exactly one entry, whose version equals the local filename
  prefix.
- `mcp__supabase__get_advisors` with `type: security`: no finding on the new objects.
- Policy and grant queries (step 3.5): match D5.

### Level 5: Build and security

`npm run build`, plus the validate.md Phase 6 checks (6.1–6.22).

---

## ACCEPTANCE CRITERIA

- [ ] Migration dry-run clean on the empty hosted project, applied once, and local and remote
      versions identical (D6, D7).
- [ ] Hosted integration covers insert, read, list and soft delete, and a soft-deleted payslip is
      excluded from every list and read.
- [ ] A second user gets **404** on every session and payslip endpoint, and a cross-user repository
      `update` returns `null` (D4).
- [ ] 11 concurrent uploads → exactly 10 × 201 and 1 × `409 session_full`, with no orphan object
      (D2).
- [ ] An encrypted PDF, an 11-page PDF and a renamed `.txt` are rejected with `pdf_encrypted`,
      `pdf_too_many_pages` and `unsupported_media_type`.
- [ ] Storage path is `{userId}/{payslipId}/source`, and signed URLs carry a 300 s TTL.
- [ ] Every response is typed as its shared DTO, and hosted responses parse with the shared schemas.
- [ ] `npm run validate` and `npm run build` are green. The security advisor is clean.
- [ ] `validate.md`, ROADMAP, PRD and the history file are updated as step 14 lists.

---

## COMPLETION CHECKLIST

- [ ] Steps 1–15 done in order, each VALIDATE run once.
- [ ] No Docker used; no `execute_sql` DDL outside the rolled-back dry run.
- [ ] No money read from a `numeric` column.
- [ ] No secret key on a request path.
- [ ] No hand-redeclared DTO shape; responses typed as `@payslip/shared` types.
- [ ] Throwaway `task03-*` users gone.

---

## NOTES

- **Confidence: 8/10.** The main risks:
  - the MCP's handling of `begin … rollback` in `execute_sql`. There is a stated fallback.
  - Storage denial status codes varying across versions. Case 9 asserts on **our** API's 404,
    not Storage's raw status, so it is insensitive to that.
  - The free tier being slow under 11 concurrent uploads.
- **Deliberately not in this task:**
  - PATCH (09), confirm (09), retry (04), merge (11), export (12), regions (08).
  - A session soft-delete endpoint: PRD §10 has none.
  - Any UI.
- **What would make me revisit D2:** if the trigger ever needs to see rows the caller cannot see,
  for example a shared session. That is not in the product (PRD §3), so invoker rights plus an
  advisory lock is the whole answer.
