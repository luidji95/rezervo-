\set ON_ERROR_STOP on
begin;

-- Internal Pro trial length contract (migration 202610280050). Disposable database only
-- (scripts/test-internal-trial-length.mjs). Expects the fixture rows that the runner created
-- before applying the migration (table pre_050_fixture).

create function pg_temp.eq(p_actual text, p_expected text, p_label text) returns void
language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'TRIAL_ASSERT % expected=% actual=%', p_label, p_expected, p_actual;
  end if;
end $$;

-- 1. calendar months, month end and year change (UTC calendar, clamped)
do $$
begin
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2026-01-31T10:00:00Z')::text, '2026-04-30 10:00:00+00', 'jan31');
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2026-11-30T10:00:00Z')::text, '2027-02-28 10:00:00+00', 'nov30 year change');
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2027-11-30T10:00:00Z')::text, '2028-02-29 10:00:00+00', 'leap year');
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2026-12-15T10:00:00Z')::text, '2027-03-15 10:00:00+00', 'dec15 year change');
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2026-03-31T23:30:00Z')::text, '2026-06-30 23:30:00+00', 'mar31 late utc');
  perform pg_temp.eq(private.billing_internal_trial_ends_at_v1('2026-10-28T08:15:42.123456Z')::text, '2027-01-28 08:15:42.123456+00', 'precision kept');
  perform pg_temp.eq((private.billing_internal_trial_ends_at_v1(null) is null)::text, 'true', 'strict');
  -- independent of the session time zone
  set local timezone = 'Europe/Belgrade';
  perform pg_temp.eq((private.billing_internal_trial_ends_at_v1('2026-01-31T23:30:00Z') = '2026-04-30T23:30:00Z'::timestamptz)::text, 'true', 'session tz ignored');
  reset timezone;
  -- not exposed to any API role
  if has_function_privilege('service_role','private.billing_internal_trial_ends_at_v1(timestamptz)','execute')
     or has_function_privilege('authenticated','private.billing_internal_trial_ends_at_v1(timestamptz)','execute')
     or has_function_privilege('anon','private.billing_internal_trial_ends_at_v1(timestamptz)','execute')
     or has_function_privilege('authenticated','public.create_trial_subscription_for_new_salon()','execute') then
    raise exception 'TRIAL_FUNCTION_EXPOSED';
  end if;
end $$;

-- 2. new salon through the real bootstrap RPC: Pro, trialing, provider-free, start + 3 months; retry keeps it
create temp table new_salon as select gen_random_uuid() owner_id;
insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
select owner_id, owner_id||'@example.invalid','{}','{}' from new_salon;
select set_config('request.jwt.claim.sub',(select owner_id::text from new_salon),true),
       set_config('request.jwt.claims',json_build_object('sub',(select owner_id from new_salon),'role','authenticated')::text,true);
set local role authenticated;
create temp table first_call as
  select * from public.create_primary_salon_once_v1('Tri meseca','tri-meseca','barbershop',null,null,null,null,null,null);
create temp table second_call as
  select * from public.create_primary_salon_once_v1('Tri meseca drugi put','tri-meseca-2','barbershop',null,null,null,null,null,null);
reset role;
do $$
declare s public.subscriptions; f record; r record;
begin
  select * into f from first_call;
  select * into r from second_call;
  select * into s from public.subscriptions where salon_id = f.salon_id;
  perform pg_temp.eq(s.status::text||':'||(select slug from public.plans where id=s.plan_id)||':'||coalesce(s.billing_provider,'-')||':'||coalesce(s.provider_subscription_id,'-'),
    'trialing:pro:-:-', 'new salon pro trial');
  perform pg_temp.eq((s.trial_ends_at = ((s.trial_starts_at at time zone 'UTC') + interval '3 months') at time zone 'UTC')::text, 'true', 'three calendar months');
  perform pg_temp.eq((s.trial_ends_at - s.trial_starts_at between interval '89 days' and interval '92 days')::text, 'true', 'about 3 months');
  perform pg_temp.eq((f.trial_ends_at = s.trial_ends_at)::text, 'true', 'bootstrap returns stored end');
  perform pg_temp.eq(r.salon_id::text||':'||r.was_created::text, f.salon_id::text||':false', 'retry returns existing salon');
  perform pg_temp.eq((r.trial_ends_at = s.trial_ends_at)::text, 'true', 'retry keeps first end');
  perform pg_temp.eq((select count(*)::text from public.subscriptions where salon_id = f.salon_id), '1', 'one subscription');
  -- canonical access during and after the trial
  perform pg_temp.eq((select has_full_access||':'||access_reason||':'||effective_plan_slug from public.resolve_salon_access_v1(f.salon_id, s.trial_ends_at - interval '1 second')),
    'true:active_trial:pro', 'full before end');
  perform pg_temp.eq((select has_full_access||':'||access_mode||':'||access_reason from public.resolve_salon_access_v1(f.salon_id, s.trial_ends_at)),
    'false:read_only:trial_expired', 'read-only at end');
  perform pg_temp.eq((select max_employees::text from public.resolve_employee_capacity_v2(f.salon_id, s.trial_ends_at - interval '1 second')),
    '10', 'pro employee limit during trial');
end $$;

-- 3. rows that existed before migration 050 are unchanged (14-day trial, paid subscription, override)
do $$
declare v record;
begin
  for v in select * from pre_050_fixture loop
    perform pg_temp.eq(
      (select md5(row(s.plan_id, s.status, s.trial_starts_at, s.trial_ends_at, s.current_period_starts_at,
        s.current_period_ends_at, s.billing_provider, s.billing_environment, s.provider_customer_id,
        s.provider_subscription_id, s.cancel_at_period_end, s.cancelled_at, s.provider_state_updated_at)::text)
       from public.subscriptions s where s.salon_id = v.salon_id), v.subscription_md5, 'pre-050 subscription ' || v.label);
    perform pg_temp.eq(
      (select coalesce(md5(string_agg(row(o.plan_id, o.enabled, o.starts_at, o.ends_at, o.override_type)::text, ',' order by o.id)), '-')
       from public.billing_access_overrides o where o.salon_id = v.salon_id), v.override_md5, 'pre-050 override ' || v.label);
  end loop;
  perform pg_temp.eq((select (trial_ends_at - trial_starts_at)::text from public.subscriptions s join pre_050_fixture f on f.salon_id = s.salon_id where f.label = 'old_trial'),
    '14 days', 'old trial still 14 days');
  perform pg_temp.eq((select count(*)::text from pre_050_fixture), '3', 'fixture present');
end $$;

rollback;
