-- The ten-payslip cap also has to hold on update. `authenticated` holds UPDATE on payslips, so a
-- user writing to PostgREST directly could restore a soft-deleted payslip or move a live one into a
-- full session, and an insert-only trigger never saw either. Same function, same lock, same count;
-- it now also fires on those two columns.
create or replace function public.enforce_session_payslip_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Only an insert, a restore or a move adds a live payslip to a session.
  if new.deleted_at is not null
    or (tg_op = 'UPDATE' and old.deleted_at is null and new.session_id = old.session_id) then
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.session_id::text, 0));
  -- 10 = MAX_PAYSLIPS_PER_SESSION in shared/src/upload.ts. Deleted payslips do not count, and the
  -- row being updated is not yet live in this session, so it is not counted either.
  if (
    select count(*) from public.payslips
    where session_id = new.session_id and deleted_at is null
  ) >= 10 then
    raise exception 'session_full' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger payslips_session_cap on public.payslips;

create trigger payslips_session_cap
before insert or update of session_id, deleted_at on public.payslips
for each row execute function public.enforce_session_payslip_cap();
