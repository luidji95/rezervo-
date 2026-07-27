-- Transactional acceptance test for the Rezervo reconstructive baseline.
-- Run only against a disposable Supabase database after schema.sql and
-- reference_seed.sql. All fixture data is rolled back.

begin;

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data)
values
  ('71000000-0000-4000-8000-000000000001', 'baseline-owner-a@example.invalid', '{}'::jsonb, '{"full_name":"Baseline Owner A"}'::jsonb),
  ('71000000-0000-4000-8000-000000000002', 'baseline-owner-b@example.invalid', '{}'::jsonb, '{"full_name":"Baseline Owner B"}'::jsonb);

do $$
begin
  if (select count(*) from public.profiles where id in (
    '71000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000002'
  )) <> 2 then
    raise exception 'AUTH_PROFILE_TRIGGER_FAILED';
  end if;
end;
$$;

insert into public.salons (id, owner_id, name, slug, onboarding_completed)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Baseline Salon A', 'baseline-salon-a', true),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'Baseline Salon B', 'baseline-salon-b', true);

insert into public.salon_members (salon_id, profile_id, role, status, joined_at)
values
  ('72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'owner', 'active', now()),
  ('72000000-0000-4000-8000-000000000002', '71000000-0000-4000-8000-000000000002', 'owner', 'active', now());

do $$
begin
  if (select count(*)
      from public.subscriptions sub
      join public.plans p on p.id = sub.plan_id
      where sub.salon_id in (
        '72000000-0000-4000-8000-000000000001',
        '72000000-0000-4000-8000-000000000002'
      )
        and sub.status = 'trialing'
        and p.slug = 'pro'
        and sub.trial_ends_at > sub.trial_starts_at + interval '13 days 23 hours') <> 2 then
    raise exception 'PRO_TRIAL_TRIGGER_FAILED';
  end if;
end;
$$;

insert into public.services (id, salon_id, name, duration_minutes, price)
values ('73000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Baseline Service', 30, 20);

insert into public.employees (id, salon_id, profile_id, full_name)
values ('74000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', '71000000-0000-4000-8000-000000000001', 'Baseline Employee');

insert into public.clients (id, salon_id, full_name, phone)
values ('75000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'Baseline Client', '+381600000001');

insert into public.appointments (
  id, salon_id, client_id, employee_id, primary_service_id,
  start_time, end_time, duration_minutes, price
) values (
  '76000000-0000-4000-8000-000000000001',
  '72000000-0000-4000-8000-000000000001',
  '75000000-0000-4000-8000-000000000001',
  '74000000-0000-4000-8000-000000000001',
  '73000000-0000-4000-8000-000000000001',
  '2030-01-02 09:00:00+00', '2030-01-02 09:30:00+00', 30, 20
);

do $$
begin
  begin
    insert into public.appointments (
      salon_id, client_id, employee_id, primary_service_id,
      start_time, end_time, duration_minutes, price
    ) values (
      '72000000-0000-4000-8000-000000000001',
      '75000000-0000-4000-8000-000000000001',
      '74000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      '2030-01-02 09:15:00+00', '2030-01-02 09:45:00+00', 30, 20
    );
    raise exception 'APPOINTMENT_OVERLAP_WAS_ALLOWED';
  exception
    when exclusion_violation then null;
  end;
end;
$$;

insert into public.notifications (id, salon_id, type, title, message)
values ('77000000-0000-4000-8000-000000000001', '72000000-0000-4000-8000-000000000001', 'baseline_test', 'Baseline', 'Routing test');

do $$
begin
  if not exists (
    select 1 from public.notification_recipients
    where notification_id = '77000000-0000-4000-8000-000000000001'
      and profile_id = '71000000-0000-4000-8000-000000000001'
  ) then raise exception 'NOTIFICATION_ROUTING_FAILED'; end if;

  if to_regprocedure('public.create_public_booking_atomic(text,uuid,uuid,timestamp with time zone,text,text,text,uuid)') is null then
    raise exception 'PUBLIC_BOOKING_RPC_MISSING';
  end if;

  if to_regclass('public.appointment_reminder_deliveries') is null
     or to_regprocedure('public.claim_due_appointment_reminders(integer,timestamp with time zone,integer)') is null
     or to_regprocedure('public.apply_infobip_sms_delivery_report(text,integer,text,text,text,text,boolean,timestamp with time zone,timestamp with time zone)') is null then
    raise exception 'REMINDER_CONTRACT_MISSING';
  end if;

  if exists (
    select 1 from (values
      ('salons'), ('salon_members'), ('services'), ('employees'), ('clients'),
      ('appointments'), ('subscriptions'), ('salon_reminder_settings'),
      ('appointment_reminder_deliveries')
    ) expected(table_name)
    where not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = expected.table_name and c.relrowsecurity
    )
  ) then raise exception 'TENANT_TABLE_RLS_NOT_ENABLED'; end if;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
do $$
begin
  if not exists (select 1 from public.clients where salon_id = '72000000-0000-4000-8000-000000000001')
     or exists (select 1 from public.salons where id = '72000000-0000-4000-8000-000000000002') then
    raise exception 'AUTHENTICATED_TENANT_ISOLATION_FAILED';
  end if;
end;
$$;
reset role;

set local role anon;
do $$
begin
  if (select count(*) from public.salons where id in (
      '72000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000002'
    )) <> 2 then raise exception 'ANON_PUBLIC_SALON_READ_FAILED'; end if;
  if has_table_privilege('anon', 'public.clients', 'select') then
    raise exception 'ANON_PRIVATE_CLIENT_READ_ALLOWED';
  end if;
end;
$$;
reset role;

rollback;
