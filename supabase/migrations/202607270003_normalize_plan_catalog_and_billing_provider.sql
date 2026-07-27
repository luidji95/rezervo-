begin;

do $$
declare
  v_required_count integer;
  v_duplicate_count integer;
  v_canonical_policy_count integer;
begin
  select count(*) into v_required_count
  from public.plans p
  where p.slug in ('starter', 'pro', 'premium');
  if v_required_count <> 3 then
    raise exception 'PLAN_CATALOG_PRECONDITION_FAILED: expected starter, pro and premium';
  end if;

  select count(*) into v_duplicate_count
  from (select p.slug from public.plans p group by p.slug having count(*) > 1) duplicates;
  if v_duplicate_count <> 0 then
    raise exception 'PLAN_CATALOG_PRECONDITION_FAILED: duplicate plan slug';
  end if;

  if exists (
    select 1 from public.subscriptions s
    where s.billing_provider is null
      and (s.provider_customer_id is not null or s.provider_subscription_id is not null)
  ) then
    raise exception 'BILLING_PROVIDER_PRECONDITION_FAILED: null provider has provider identifiers';
  end if;

  if exists (
    select 1 from public.subscriptions s
    where lower(btrim(s.billing_provider)) = 'stripe'
      and (s.provider_customer_id is not null or s.provider_subscription_id is not null)
  ) then
    raise exception 'BILLING_PROVIDER_PRECONDITION_FAILED: Stripe identifiers require manual provider review';
  end if;

  if exists (
    select 1 from public.subscriptions s
    where s.billing_provider is not null
      and btrim(s.billing_provider) = ''
  ) then
    raise exception 'BILLING_PROVIDER_PRECONDITION_FAILED: blank provider value';
  end if;

  select count(*) into v_canonical_policy_count
  from pg_policies pol
  where pol.schemaname = 'public'
    and pol.tablename = 'subscriptions'
    and pol.policyname = 'subscriptions_owner_manager_read'
    and pol.cmd = 'SELECT'
    and 'authenticated' = any(pol.roles);
  if v_canonical_policy_count <> 1 then
    raise exception 'SUBSCRIPTION_POLICY_PRECONDITION_FAILED: canonical read policy missing';
  end if;
end $$;

update public.plans set
  name = 'Starter', monthly_price = 2990, yearly_price = null, currency = 'RSD',
  max_employees = 3, analytics_enabled = false, sms_reminders_enabled = false,
  max_monthly_reminders = 0, ai_receptionist_enabled = false,
  whatsapp_enabled = false, instagram_enabled = false, marketing_enabled = false,
  max_ai_messages = 0, is_active = true
where slug = 'starter';

update public.plans set
  name = 'Pro', monthly_price = 5990, yearly_price = null, currency = 'RSD',
  max_employees = 10, analytics_enabled = true, sms_reminders_enabled = true,
  ai_receptionist_enabled = false, whatsapp_enabled = false,
  instagram_enabled = false, marketing_enabled = false,
  max_ai_messages = 0, is_active = true
where slug = 'pro';

update public.plans set
  name = 'Premium', monthly_price = 17990, yearly_price = null, currency = 'RSD',
  max_employees = 25, analytics_enabled = true, sms_reminders_enabled = true,
  ai_receptionist_enabled = true, whatsapp_enabled = true,
  instagram_enabled = true, marketing_enabled = true,
  max_ai_messages = 5000, is_active = false
where slug = 'premium';

alter table public.subscriptions
  alter column billing_provider drop default,
  alter column billing_provider drop not null;

update public.subscriptions
set billing_provider = null
where lower(btrim(billing_provider)) = 'stripe'
  and provider_customer_id is null
  and provider_subscription_id is null;

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_metadata_consistent;
alter table public.subscriptions
  add constraint subscriptions_provider_metadata_consistent check (
    billing_provider is not null
    or (provider_customer_id is null and provider_subscription_id is null)
  );

create or replace function public.create_trial_subscription_for_new_salon()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pro_plan_id uuid;
begin
  select p.id into v_pro_plan_id
  from public.plans p
  where p.slug = 'pro'
  limit 1;

  if v_pro_plan_id is null then
    raise exception 'PRO_PLAN_NOT_CONFIGURED';
  end if;

  insert into public.subscriptions (
    salon_id, plan_id, status, trial_starts_at, trial_ends_at
  ) values (
    new.id, v_pro_plan_id, 'trialing', now(), now() + interval '14 days'
  )
  on conflict (salon_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_trial_subscription_for_new_salon()
  from public, anon, authenticated;
grant execute on function public.create_trial_subscription_for_new_salon()
  to service_role;

drop policy if exists subscriptions_select_owner_or_manager
  on public.subscriptions;

do $$
begin
  if (select count(*) from pg_policies pol
      where pol.schemaname = 'public'
        and pol.tablename = 'subscriptions'
        and pol.policyname = 'subscriptions_owner_manager_read'
        and pol.cmd = 'SELECT') <> 1 then
    raise exception 'SUBSCRIPTION_POLICY_POSTCONDITION_FAILED';
  end if;
end $$;

commit;
