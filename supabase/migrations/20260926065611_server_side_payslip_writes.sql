-- Task 09 D2: every payslip write goes through a function, so `authenticated` can lose its direct
-- UPDATE on payslips (migration `revoke_direct_payslip_updates`, applied once the API that calls
-- these functions is deployed). Until then a signed-in user could set their own payslip's
-- `status`, `canonical_data` or `confirmed_at` through PostgREST, for example confirming while
-- the tables pass is still pending (ROADMAP §5, "Direct-write gap").
--
-- Security definer, because the API writes with the user's own token (Task 04 D2) and that user
-- will hold no UPDATE grant. RLS does not apply inside a definer function, so the
-- `user_id = (select auth.uid())` filter in every statement is the ownership check. `auth.uid()`
-- reads the request's JWT claim, not the role, so it still names the caller here. Omitting the
-- filter anywhere would be a cross-user write.
--
-- Each function enforces exactly the rule the API enforces, so calling one directly is no bypass.
-- The session-cap trigger still fires on `update of deleted_at` from inside them.

-- Its body already filters `user_id = (select auth.uid())`, so definer rights widen nothing; they
-- only keep it working once UPDATE is revoked.
alter function public.complete_extraction_pass(uuid, text, jsonb, jsonb, jsonb) security definer;

-- PRD §10.6: merges the changed top-level keys and records the edited paths computed by the API
-- against the re-mapped original extraction (Task 09 D4). Editable in review and confirmed; an
-- edit keeps a confirmed payslip confirmed.
create function public.update_payslip_fields(
  p_payslip_id uuid,
  p_fields jsonb,
  p_edited_fields text[]
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set canonical_data = canonical_data || p_fields,
      edited_fields = p_edited_fields,
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and status in ('review', 'confirmed')
    -- D10: the tables pass writes only while pending, so a table edit then would be overwritten.
    and (
      tables_status <> 'pending'
      or not (p_fields ?| array['payComponents', 'obustave', 'neoporeziviPrimici'])
    );
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- PRD §10.7: review → confirmed, refused while the tables pass is pending. Idempotent: an already
-- confirmed payslip returns its first confirmed_at. Null means not confirmable now, or not found.
create function public.confirm_payslip(p_payslip_id uuid)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmed_at timestamptz;
begin
  update public.payslips
  set status = 'confirmed',
      confirmed_at = now(),
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and status = 'review'
    and tables_status <> 'pending'
  returning confirmed_at into v_confirmed_at;

  if v_confirmed_at is null then
    select confirmed_at into v_confirmed_at
    from public.payslips
    where id = p_payslip_id
      and user_id = (select auth.uid())
      and deleted_at is null
      and status = 'confirmed';
  end if;

  return v_confirmed_at;
end;
$$;

-- Task 07 D8: resets a retryable failure to a fresh extraction. One conditional update, so of two
-- concurrent retries only one matches, and only one analysis is paid for. The retryable reasons
-- come from RETRYABLE_FAILURE_REASONS in Node, so the list has one source of truth; a direct call
-- with a wider list only leaves a payslip in processing with no job, which the reaper fails again.
create function public.begin_payslip_retry(p_payslip_id uuid, p_retryable_reasons text[])
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set status = 'processing',
      tables_status = 'pending',
      failure_reason = null,
      canonical_data = '{}'::jsonb,
      extraction_metadata = null,
      raw_provider_result = null,
      edited_fields = '{}',
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and status = 'failed'
    and failure_reason = any (p_retryable_reasons);
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- PRD §10.13: deletion is soft.
create function public.soft_delete_payslip(p_payslip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set deleted_at = now(),
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Task 04 D15: the scalars pass failed. Applies only while processing; the table's check
-- constraint validates the reason.
create function public.fail_payslip_extraction(p_payslip_id uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set status = 'failed',
      failure_reason = p_reason,
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and status = 'processing';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Task 05 D9: the tables pass failed or was cancelled. Applies only while its tables are pending.
create function public.fail_payslip_tables(p_payslip_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.payslips
  set tables_status = 'failed',
      updated_at = now()
  where id = p_payslip_id
    and user_id = (select auth.uid())
    and deleted_at is null
    and tables_status = 'pending';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- Task 04 D3 and Task 05 D10: the queue is in memory, so a redeploy strands whatever was in
-- flight. Fails the caller's own payslips last touched before the cutoff; provider_unavailable is
-- retryable. Returns how many rows were failed across both updates.
create function public.fail_stale_payslip_extractions(p_cutoff timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payslips integer;
  v_tables integer;
begin
  update public.payslips
  set status = 'failed',
      failure_reason = 'provider_unavailable',
      -- A lost payslip's tables are lost with it. If its tables pass had already landed, this
      -- turns `ready` into `failed` on a payslip that is failing anyway, which is harmless.
      tables_status = 'failed',
      updated_at = now()
  where user_id = (select auth.uid())
    and deleted_at is null
    and status = 'processing'
    and updated_at < p_cutoff;
  get diagnostics v_payslips = row_count;

  -- A payslip in review whose tables pass was lost. `updated_at`, as above: a user edit during
  -- the pending window only delays the reap, and can never cause one.
  update public.payslips
  set tables_status = 'failed',
      updated_at = now()
  where user_id = (select auth.uid())
    and deleted_at is null
    and tables_status = 'pending'
    and updated_at < p_cutoff;
  get diagnostics v_tables = row_count;

  return v_payslips + v_tables;
end;
$$;

revoke execute on function public.update_payslip_fields(uuid, jsonb, text[]) from public, anon;
grant execute on function public.update_payslip_fields(uuid, jsonb, text[]) to authenticated;

revoke execute on function public.confirm_payslip(uuid) from public, anon;
grant execute on function public.confirm_payslip(uuid) to authenticated;

revoke execute on function public.begin_payslip_retry(uuid, text[]) from public, anon;
grant execute on function public.begin_payslip_retry(uuid, text[]) to authenticated;

revoke execute on function public.soft_delete_payslip(uuid) from public, anon;
grant execute on function public.soft_delete_payslip(uuid) to authenticated;

revoke execute on function public.fail_payslip_extraction(uuid, text) from public, anon;
grant execute on function public.fail_payslip_extraction(uuid, text) to authenticated;

revoke execute on function public.fail_payslip_tables(uuid) from public, anon;
grant execute on function public.fail_payslip_tables(uuid) to authenticated;

revoke execute on function public.fail_stale_payslip_extractions(timestamptz) from public, anon;
grant execute on function public.fail_stale_payslip_extractions(timestamptz) to authenticated;
