-- Transactional multi-tenant regression test for
-- salon_reminder_settings_owner_manager_read.
-- Run against a disposable/local Supabase database after migrations.
-- Every fixture is rolled back.

begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('10000000-0000-4000-8000-000000000001', 'rls-owner-a@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000002', 'rls-manager-a@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000003', 'rls-employee-a@example.invalid', '{}'::jsonb, '{}'::jsonb),
  ('10000000-0000-4000-8000-000000000004', 'rls-owner-b@example.invalid', '{}'::jsonb, '{}'::jsonb);

insert into public.profiles (id, full_name, email)
values
  ('10000000-0000-4000-8000-000000000001', 'RLS Owner A', 'rls-owner-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000002', 'RLS Manager A', 'rls-manager-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000003', 'RLS Employee A', 'rls-employee-a@example.invalid'),
  ('10000000-0000-4000-8000-000000000004', 'RLS Owner B', 'rls-owner-b@example.invalid')
on conflict (id) do update
set full_name = excluded.full_name,
    email = excluded.email;

insert into public.salons (id, owner_id, name, slug)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', 'RLS Salon A', 'rls-salon-a'),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000004', 'RLS Salon B', 'rls-salon-b');

insert into public.salon_members (salon_id, profile_id, role, status)
values
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', 'manager', 'active'),
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003', 'employee', 'active');

insert into public.salon_reminder_settings (salon_id, enabled, channel, hours_before)
values
  ('20000000-0000-4000-8000-000000000001', false, 'sms', 24),
  ('20000000-0000-4000-8000-000000000002', false, 'sms', 24);

set local role authenticated;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000001', true);
do $$ begin
  if (select count(*) from public.salon_reminder_settings) <> 1
    or not exists (select 1 from public.salon_reminder_settings where salon_id = '20000000-0000-4000-8000-000000000001')
  then raise exception 'RLS_OWNER_A_SCOPE_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000002', true);
do $$ begin
  if (select count(*) from public.salon_reminder_settings) <> 1
    or not exists (select 1 from public.salon_reminder_settings where salon_id = '20000000-0000-4000-8000-000000000001')
  then raise exception 'RLS_MANAGER_A_SCOPE_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub', '10000000-0000-4000-8000-000000000003', true);
do $$ begin
  if exists (select 1 from public.salon_reminder_settings)
  then raise exception 'RLS_EMPLOYEE_A_SCOPE_FAILED'; end if;
end $$;

reset role;

set local role anon;
do $$
declare
  select_was_denied boolean := false;
begin
  begin
    perform count(*) from public.salon_reminder_settings;
  exception
    when insufficient_privilege then
      select_was_denied := true;
  end;

  if not select_was_denied then
    raise exception 'RLS_ANON_SELECT_WAS_NOT_DENIED';
  end if;
end $$;

reset role;

set local role service_role;
do $$ begin
  if (select count(*) from public.salon_reminder_settings where salon_id in (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002'
  )) <> 2
  then raise exception 'RLS_SERVICE_ROLE_ACCESS_FAILED'; end if;
end $$;

reset role;
rollback;
