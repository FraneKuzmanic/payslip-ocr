-- Task 11 (plan 11 D8): a merge replaces two payslips with one in a single transaction. The
-- originals are soft-deleted before the insert, because the session cap counts live payslips only
-- and a full session must still be able to merge. `authenticated` may insert only the six upload
-- columns (migration `revoke_direct_payslip_updates`), so `merged_from` and `created_at` are
-- written here. Security definer: RLS does not apply inside, so every statement filters
-- `user_id = (select auth.uid())`, which is the ownership check.
--
-- Mergeable means not still extracting: not `processing`, and not `review` while the tables pass
-- is pending (plan 11 D3, `isMergeable` in shared/src/session.ts). The merged row takes the
-- earlier original's `created_at`, keeping its place in upload order (D7).
create function public.merge_payslips(
  p_session_id uuid,
  p_new_id uuid,
  p_order uuid[],
  p_original_filename text,
  p_page_count integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_created_at timestamptz;
begin
  if cardinality(p_order) <> 2 or p_order[1] = p_order[2] then
    return false;
  end if;

  -- In id order, so two merges sharing a payslip cannot deadlock. The second waits, then finds
  -- the row deleted.
  perform 1
  from public.payslips
  where id = any (p_order)
    and user_id = (select auth.uid())
  order by id
  for update;

  select count(*), min(created_at)
  into v_count, v_created_at
  from public.payslips
  where id = any (p_order)
    and user_id = (select auth.uid())
    and session_id = p_session_id
    and deleted_at is null
    and status <> 'processing'
    and not (status = 'review' and tables_status = 'pending');

  if v_count <> 2 then
    return false;
  end if;

  update public.payslips
  set deleted_at = now(),
      updated_at = now()
  where id = any (p_order)
    and user_id = (select auth.uid());

  insert into public.payslips (
    id, session_id, user_id, original_filename, content_type, page_count, merged_from, created_at
  )
  values (
    p_new_id, p_session_id, (select auth.uid()), p_original_filename, 'application/pdf',
    p_page_count, p_order, v_created_at
  );

  return true;
end;
$$;

revoke execute on function public.merge_payslips(uuid, uuid, uuid[], text, integer)
  from public, anon;
grant execute on function public.merge_payslips(uuid, uuid, uuid[], text, integer)
  to authenticated;
