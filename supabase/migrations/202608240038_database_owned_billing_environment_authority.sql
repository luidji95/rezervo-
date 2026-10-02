begin;

create schema if not exists private authorization postgres;
alter schema private owner to postgres;
revoke all on schema private from public, anon, authenticated, service_role;

create table private.billing_runtime_config (
  singleton boolean primary key,
  environment text not null,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint billing_runtime_config_singleton_check check (singleton = true),
  constraint billing_runtime_config_environment_check check (environment in ('test', 'live'))
);

alter table private.billing_runtime_config owner to postgres;
alter table private.billing_runtime_config enable row level security;
revoke all on table private.billing_runtime_config from public, anon, authenticated, service_role;

comment on table private.billing_runtime_config is
  'Postgres-admin-owned singleton identifying this Supabase project billing environment. Application roles have no direct access.';
comment on column private.billing_runtime_config.environment is
  'Project bootstrap value only: test or live. The universal migration intentionally inserts no row.';

create or replace function public.resolve_salon_access_v1(
  p_salon_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  has_full_access boolean,
  access_mode text,
  access_reason text,
  access_source text,
  effective_plan_id uuid,
  effective_plan_slug text,
  subscription_status text,
  access_ends_at timestamptz,
  is_legacy_active boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_override record;
  v_subscription record;
  v_runtime_environment text;
  v_runtime_config_count integer;
  v_provider_free_trial boolean;
begin
  select o.plan_id, o.ends_at, p.slug
    into v_override
  from public.billing_access_overrides o
  join public.plans p on p.id = o.plan_id
  where o.salon_id = p_salon_id
    and o.enabled = true
    and o.starts_at <= p_now
    and (o.ends_at is null or o.ends_at > p_now)
  limit 1;

  select s.status, s.billing_provider, s.billing_environment,
         s.provider_customer_id, s.provider_subscription_id,
         s.trial_ends_at, s.current_period_ends_at,
         p.id as plan_id, p.slug
    into v_subscription
  from public.subscriptions s
  left join public.plans p on p.id = s.plan_id
  where s.salon_id = p_salon_id
  limit 1;

  if v_override.plan_id is not null then
    return query select true, 'full'::text, 'billing_override'::text,
      'billing_override'::text, v_override.plan_id, v_override.slug::text,
      v_subscription.status::text, v_override.ends_at, false;
    return;
  end if;

  if v_subscription.status is null then
    return query select false, 'read_only'::text, 'subscription_missing'::text,
      'subscription'::text, null::uuid, null::text, null::text,
      null::timestamptz, false;
    return;
  end if;

  if v_subscription.plan_id is null then
    return query select false, 'read_only'::text, 'plan_missing'::text,
      'subscription'::text, null::uuid, null::text, v_subscription.status::text,
      null::timestamptz, false;
    return;
  end if;

  v_provider_free_trial :=
    v_subscription.status = 'trialing'::public.subscription_status
    and v_subscription.billing_provider is null
    and v_subscription.billing_environment is null
    and v_subscription.provider_customer_id is null
    and v_subscription.provider_subscription_id is null;

  if not v_provider_free_trial then
    select pg_catalog.count(*), pg_catalog.min(c.environment)
      into v_runtime_config_count, v_runtime_environment
    from private.billing_runtime_config c;

    if v_runtime_config_count <> 1
       or v_runtime_environment not in ('test', 'live')
       or v_subscription.billing_provider is distinct from 'lemonsqueezy'
       or v_subscription.billing_environment is distinct from v_runtime_environment
       or v_subscription.provider_customer_id is null
       or not (v_subscription.provider_customer_id ~ '[^[:space:]]')
       or v_subscription.provider_subscription_id is null
       or not (v_subscription.provider_subscription_id ~ '[^[:space:]]') then
      return query select false, 'read_only'::text,
        'billing_environment_mismatch'::text, 'subscription'::text,
        v_subscription.plan_id, v_subscription.slug::text,
        v_subscription.status::text,
        case
          when v_subscription.status = 'trialing' then v_subscription.trial_ends_at
          else v_subscription.current_period_ends_at
        end,
        false;
      return;
    end if;
  end if;

  if v_subscription.status = 'trialing'::public.subscription_status then
    return query select
      v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at > p_now,
      case when v_subscription.trial_ends_at is not null and v_subscription.trial_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.trial_ends_at is null then 'invalid_trial_period'
           when v_subscription.trial_ends_at > p_now then 'active_trial'
           else 'trial_expired' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.trial_ends_at, false;
  elsif v_subscription.status = 'active'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is null or v_subscription.current_period_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.current_period_ends_at is null then 'legacy_active_no_period'
           when v_subscription.current_period_ends_at > p_now then 'active_period'
           else 'period_expired' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at,
      v_subscription.current_period_ends_at is null;
  elsif v_subscription.status = 'cancelled'::public.subscription_status then
    return query select
      v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now,
      case when v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now then 'full' else 'read_only' end,
      case when v_subscription.current_period_ends_at is not null and v_subscription.current_period_ends_at > p_now then 'cancelled_until_period_end' else 'cancelled' end,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at, false;
  else
    return query select false, 'read_only'::text, v_subscription.status::text,
      'subscription'::text, v_subscription.plan_id, v_subscription.slug::text,
      v_subscription.status::text, v_subscription.current_period_ends_at, false;
  end if;
end;
$$;

create or replace function public.resolve_employee_capacity_v1(
  p_salon_id uuid,
  p_now timestamptz default pg_catalog.now()
)
returns table (
  has_full_access boolean,
  access_reason text,
  effective_plan_id uuid,
  effective_plan_slug text,
  max_employees integer,
  access_source text,
  is_legacy_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select a.has_full_access, a.access_reason, a.effective_plan_id,
    a.effective_plan_slug, p.max_employees, a.access_source,
    a.is_legacy_active
  from public.resolve_salon_access_v1(p_salon_id, p_now) a
  left join public.plans p on p.id = a.effective_plan_id;
$$;

alter function public.resolve_salon_access_v1(uuid, timestamptz) owner to postgres;
alter function public.resolve_employee_capacity_v1(uuid, timestamptz) owner to postgres;

revoke all on function public.resolve_salon_access_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_salon_access_v1(uuid, timestamptz)
  to service_role;
grant execute on function public.resolve_employee_capacity_v1(uuid, timestamptz)
  to service_role;

comment on function public.resolve_salon_access_v1(uuid, timestamptz) is
  'Canonical entitlement resolver. Provider-backed access requires the postgres-owned project billing environment; provider-free local trials and explicit admin overrides retain their documented authority.';
comment on function public.resolve_employee_capacity_v1(uuid, timestamptz) is
  'Canonical employee capacity projection over the environment-aware salon access resolver.';

commit;
