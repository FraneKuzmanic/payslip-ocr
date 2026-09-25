-- Task 05: extraction is split into two passes over the same document. The scalars pass makes the
-- form usable; the tables pass fills the three line-item tables. They finish in either order.

-- Whether the line-item tables have landed. Independent of `status`, which stays the user-facing
-- lifecycle (Task 05 D6): `review` with `tables_status = 'failed'` is "tables failed, scalars
-- succeeded", distinct from a failed payslip.
alter table public.payslips
  add column tables_status text not null default 'pending'
    constraint payslips_tables_status_valid check (tables_status in ('pending', 'ready', 'failed'));

-- Rows extracted in one pass already hold their tables. Correct on any database, whatever it holds.
update public.payslips
set tables_status = case status
  when 'processing' then 'pending'
  when 'failed' then 'failed'
  else 'ready'
end;

comment on column public.payslips.tables_status is
  'pending until the tables pass lands, then ready, or failed if it failed, was cancelled or was reaped. Confirm is refused while pending (Task 09).';

-- Records one extraction pass atomically. The passes race each other, and from Task 09 on they
-- race the user's edits, so a read-modify-write of canonical_data from Node would lose one side.
-- `jsonb ||` replaces top-level keys only, so each pass must send only its own keys.
--
-- Invoker rights (Task 04 D2): it runs as the uploading user, under their RLS, and writes only
-- columns that user can already update directly. It widens nothing.
--
-- Returns false when the write was discarded: the payslip is gone, deleted, not the caller's, or
-- no longer waiting for this pass. The same contract as the single-pass write it replaces.
create function public.complete_extraction_pass(
  p_payslip_id uuid,
  p_pass text,
  p_fields jsonb,
  p_metadata jsonb,
  p_raw jsonb
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_count integer;
begin
  if p_pass = 'scalars' then
    update public.payslips
    set canonical_data = canonical_data || p_fields,
        extraction_metadata =
          coalesce(extraction_metadata, '{}'::jsonb) || jsonb_build_object(p_pass, p_metadata),
        raw_provider_result =
          coalesce(raw_provider_result, '{}'::jsonb) || jsonb_build_object(p_pass, p_raw),
        status = 'review',
        failure_reason = null,
        updated_at = now()
    where id = p_payslip_id
      and user_id = (select auth.uid())
      and deleted_at is null
      and status = 'processing';
  elsif p_pass = 'tables' then
    -- Only while still pending, so a later user edit to a table is never overwritten.
    update public.payslips
    set canonical_data = canonical_data || p_fields,
        extraction_metadata =
          coalesce(extraction_metadata, '{}'::jsonb) || jsonb_build_object(p_pass, p_metadata),
        raw_provider_result =
          coalesce(raw_provider_result, '{}'::jsonb) || jsonb_build_object(p_pass, p_raw),
        tables_status = 'ready',
        updated_at = now()
    where id = p_payslip_id
      and user_id = (select auth.uid())
      and deleted_at is null
      and tables_status = 'pending'
      and status <> 'failed';
  else
    raise exception 'invalid_pass' using errcode = '22023';
  end if;

  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

revoke execute on function public.complete_extraction_pass(uuid, text, jsonb, jsonb, jsonb)
  from public, anon;
grant execute on function public.complete_extraction_pass(uuid, text, jsonb, jsonb, jsonb)
  to authenticated;
