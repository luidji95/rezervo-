-- Run transactionally on a disposable database after all post-cutover migrations.
begin;

do $$
declare
  v_count integer;
begin
  select count(*) into v_count from public.plans;
  if v_count <> 3 then raise exception 'PLAN_SLUG_COUNT_FAILED'; end if;

  if not exists (select 1 from public.plans where slug='starter' and monthly_price=2990 and yearly_price is null and currency='RSD' and max_employees=3 and not analytics_enabled and not sms_reminders_enabled and max_monthly_reminders=0 and not ai_receptionist_enabled and not whatsapp_enabled and not instagram_enabled and not marketing_enabled and max_ai_messages=0 and is_active)
  then raise exception 'STARTER_CONTRACT_FAILED'; end if;

  if not exists (select 1 from public.plans where slug='pro' and monthly_price=5990 and yearly_price is null and currency='RSD' and max_employees=10 and analytics_enabled and sms_reminders_enabled and max_monthly_reminders is null and not ai_receptionist_enabled and not whatsapp_enabled and not instagram_enabled and not marketing_enabled and max_ai_messages=0 and is_active)
  then raise exception 'PRO_CONTRACT_FAILED'; end if;

  if not exists (select 1 from public.plans where slug='premium' and monthly_price=17990 and yearly_price is null and currency='RSD' and max_employees=25 and analytics_enabled and sms_reminders_enabled and max_monthly_reminders is null and ai_receptionist_enabled and whatsapp_enabled and instagram_enabled and marketing_enabled and max_ai_messages=5000 and not is_active)
  then raise exception 'PREMIUM_CONTRACT_FAILED'; end if;

  if exists (select 1 from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='subscriptions_select_owner_or_manager')
  then raise exception 'REDUNDANT_SUBSCRIPTION_POLICY_REMAINS'; end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='subscriptions' and policyname='subscriptions_owner_manager_read' and cmd='SELECT') <> 1
  then raise exception 'CANONICAL_SUBSCRIPTION_POLICY_FAILED'; end if;
end $$;

insert into auth.users (id,email,raw_app_meta_data,raw_user_meta_data)
values
  ('91000000-0000-4000-8000-000000000001','provider-owner@example.invalid','{}','{}'),
  ('91000000-0000-4000-8000-000000000002','provider-manager@example.invalid','{}','{}');
insert into public.salons (id,owner_id,name,slug)
values ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Provider Test Salon','provider-test-salon');
insert into public.salon_members (salon_id,profile_id,role,status)
values ('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000002','manager','active');

do $$ begin
  if not exists (
    select 1 from public.subscriptions s join public.plans p on p.id=s.plan_id
    where s.salon_id='92000000-0000-4000-8000-000000000001'
      and p.slug='pro' and s.status='trialing'
      and s.billing_provider is null
      and s.billing_environment is null
      and s.provider_customer_id is null and s.provider_subscription_id is null
  ) then raise exception 'NEW_TRIAL_PROVIDER_CONTRACT_FAILED'; end if;
end $$;

do $$
declare rejected boolean;
begin
  rejected := false;
  begin update public.subscriptions set billing_provider=null, provider_customer_id='customer-test' where salon_id='92000000-0000-4000-8000-000000000001'; exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'NULL_PROVIDER_CUSTOMER_ID_ALLOWED'; end if;

  rejected := false;
  begin update public.subscriptions set billing_provider=null, provider_subscription_id='subscription-test' where salon_id='92000000-0000-4000-8000-000000000001'; exception when check_violation then rejected := true; end;
  if not rejected then raise exception 'NULL_PROVIDER_SUBSCRIPTION_ID_ALLOWED'; end if;
end $$;

update public.subscriptions set billing_provider='future_provider', billing_environment='test', provider_customer_id='customer-test', provider_subscription_id=null where salon_id='92000000-0000-4000-8000-000000000001';
update public.subscriptions set provider_subscription_id='subscription-test' where salon_id='92000000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000001',true);
do $$
declare
  v_changed integer;
begin
  if not exists (select 1 from public.subscriptions where salon_id='92000000-0000-4000-8000-000000000001') then raise exception 'OWNER_SUBSCRIPTION_SELECT_FAILED'; end if;
  update public.subscriptions set status='expired' where salon_id='92000000-0000-4000-8000-000000000001';
  get diagnostics v_changed = row_count;
  if v_changed <> 0 then raise exception 'AUTHENTICATED_SUBSCRIPTION_WRITE_ALLOWED'; end if;
end $$;

select set_config('request.jwt.claim.sub','91000000-0000-4000-8000-000000000002',true);
do $$ begin
  if not exists (select 1 from public.subscriptions where salon_id='92000000-0000-4000-8000-000000000001') then raise exception 'MANAGER_SUBSCRIPTION_SELECT_FAILED'; end if;
end $$;
reset role;

rollback;
