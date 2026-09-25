-- Task 06 D1: warnings are a pure function of canonical_data, status, tables_status and
-- extraction_metadata, computed on every read. A stored copy would race between the two
-- extraction passes and could only ever go stale.
alter table public.payslips drop constraint payslips_warnings_array;
alter table public.payslips drop column warnings;
