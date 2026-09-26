-- Task 09 D3: applied only after the API that writes through the D2 functions is deployed.
-- Before that, the deployed API still updates payslips directly and would break.
revoke update on table public.payslips from authenticated;

-- Nothing can update directly any more, so the policy only misleads a reader.
drop policy "Users can update their own payslips" on public.payslips;

-- An insert of every column would reopen the gap: a user could create a row already `confirmed`,
-- with any canonical data, while its tables are pending. The upload inserts only these columns;
-- every other one takes its default (`processing`, `pending`, empty data).
revoke insert on table public.payslips from authenticated;
grant insert (id, session_id, user_id, original_filename, content_type, page_count)
  on table public.payslips to authenticated;
