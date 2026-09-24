create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);

comment on table public.sessions is
  'A set of payslips uploaded together. No status of its own: progress is read from its payslips.';

create table public.payslips (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,

  status text not null default 'processing'
    constraint payslips_status_valid check (
      status in ('processing', 'review', 'confirmed', 'failed')
    ),
  failure_reason text
    constraint payslips_failure_reason_valid check (
      failure_reason is null
      or failure_reason in ('unreadable_document', 'provider_rejected', 'provider_unavailable')
    ),

  canonical_data jsonb not null default '{}'::jsonb
    constraint payslips_canonical_data_object check (jsonb_typeof(canonical_data) = 'object'),
  extraction_metadata jsonb,
  raw_provider_result jsonb,
  warnings jsonb not null default '[]'::jsonb
    constraint payslips_warnings_array check (jsonb_typeof(warnings) = 'array'),
  edited_fields text[] not null default '{}',

  original_filename text not null
    constraint payslips_original_filename_not_blank check (btrim(original_filename) <> ''),
  content_type text not null
    constraint payslips_content_type_valid check (
      content_type in ('image/jpeg', 'image/png', 'image/heic', 'image/heif', 'application/pdf')
    ),
  page_count integer not null
    constraint payslips_page_count_positive check (page_count >= 1),
  merged_from uuid[],

  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,

  -- For list and export queries only. canonical_data is authoritative, and money is never read
  -- back from the numeric columns. The regex guard means a malformed string yields null rather
  -- than failing the insert.
  employee_name text generated always as (
    nullif(btrim(canonical_data ->> 'employeeName'), '')
  ) stored,
  employer_name text generated always as (
    nullif(btrim(canonical_data ->> 'employerName'), '')
  ) stored,
  period text generated always as (
    nullif(btrim(canonical_data ->> 'period'), '')
  ) stored,
  neto_placa numeric generated always as (
    case
      when canonical_data ->> 'netoPlaca' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (canonical_data ->> 'netoPlaca')::numeric
      else null
    end
  ) stored,
  iznos_za_isplatu numeric generated always as (
    case
      when canonical_data ->> 'iznosZaIsplatu' ~ '^-?[0-9]+(\.[0-9]+)?$'
        then (canonical_data ->> 'iznosZaIsplatu')::numeric
      else null
    end
  ) stored
);

comment on table public.payslips is
  'User-owned payslips. canonical_data is authoritative; generated columns support list and export queries.';

revoke all on table public.sessions, public.payslips from anon, authenticated;
-- No update on sessions: no endpoint modifies one. No delete on payslips: deletion is soft.
grant select, insert on table public.sessions to authenticated;
grant select, insert, update on table public.payslips to authenticated;

alter table public.sessions enable row level security;
alter table public.payslips enable row level security;

create policy "Users can read their own sessions"
on public.sessions
for select
to authenticated
using ((select auth.uid()) = user_id);

create policy "Users can create their own sessions"
on public.sessions
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create policy "Users can read their own payslips"
on public.payslips
for select
to authenticated
using ((select auth.uid()) = user_id);

-- The session sub-check matters because a foreign key is checked without RLS: without it, a user
-- could attach a row to another user's session id and it would appear in that session's detail.
create policy "Users can create payslips in their own sessions"
on public.payslips
for insert
to authenticated
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sessions s
    where s.id = session_id and s.user_id = (select auth.uid()) and s.deleted_at is null
  )
);

create policy "Users can update their own payslips"
on public.payslips
for update
to authenticated
using ((select auth.uid()) = user_id)
with check (
  (select auth.uid()) = user_id
  and exists (
    select 1 from public.sessions s
    where s.id = session_id and s.user_id = (select auth.uid()) and s.deleted_at is null
  )
);

create index payslips_active_user_created_at_idx
on public.payslips (user_id, created_at desc)
where deleted_at is null;

-- Serves the session detail read and the cap trigger's count.
create index payslips_active_session_idx
on public.payslips (session_id)
where deleted_at is null;

-- The ten-payslip cap, enforced atomically. Parallel uploads race any count made in Node, so this
-- is the only copy of the rule. It is a trigger, not a policy, and must stay one:
--   * BEFORE ROW triggers fire before RLS WITH CHECK, so the cap runs on every insert, including
--     one the insert policy then rejects.
--   * The advisory lock serializes inserts into one session until each transaction commits, and a
--     plpgsql query in a volatile function takes a fresh snapshot under READ COMMITTED, so the
--     count run after the lock is granted sees the row the previous holder just committed. A
--     policy expression has no lock to wait on.
-- Invoker rights suffice: the advisory lock needs no privilege, where SELECT ... FOR UPDATE on the
-- session would need an UPDATE grant that sessions deliberately lacks. The count runs under the
-- caller's RLS, which sees every row of a session the caller owns.
create function public.enforce_session_payslip_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.session_id::text, 0));
  -- 10 = MAX_PAYSLIPS_PER_SESSION in shared/src/upload.ts. Deleted payslips do not count.
  if (
    select count(*) from public.payslips
    where session_id = new.session_id and deleted_at is null
  ) >= 10 then
    raise exception 'session_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.enforce_session_payslip_cap() from public, anon, authenticated;

create trigger payslips_session_cap
before insert on public.payslips
for each row execute function public.enforce_session_payslip_cap();

create policy "Users can read their own payslip sources"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'payslip-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can upload their own payslip sources"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'payslip-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);

create policy "Users can delete their own payslip sources"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'payslip-sources'
  and (storage.foldername(name))[1] = (select auth.uid())::text
);
