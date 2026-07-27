begin;

create table public.billing_provider_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans(id) on delete restrict,
  provider text not null,
  environment text not null,
  billing_interval text not null,
  currency text not null,
  amount numeric not null,
  provider_product_id text,
  provider_variant_id text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_provider_prices_provider_check
    check (provider in ('lemonsqueezy')),
  constraint billing_provider_prices_environment_check
    check (environment in ('test', 'live')),
  constraint billing_provider_prices_interval_check
    check (billing_interval = 'monthly'),
  constraint billing_provider_prices_currency_check
    check (currency = upper(currency) and currency ~ '^[A-Z]{3}$'),
  constraint billing_provider_prices_amount_check check (amount > 0),
  constraint billing_provider_prices_product_id_check
    check (provider_product_id is null or btrim(provider_product_id) <> ''),
  constraint billing_provider_prices_variant_id_check
    check (btrim(provider_variant_id) <> ''),
  constraint billing_provider_prices_mapping_unique
    unique (provider, environment, plan_id, billing_interval, currency),
  constraint billing_provider_prices_variant_unique
    unique (provider, environment, provider_variant_id)
);

create or replace function public.validate_billing_provider_price_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan record;
begin
  select p.slug, p.monthly_price, p.currency, p.is_active
    into v_plan
  from public.plans p
  where p.id = new.plan_id;

  if v_plan.slug not in ('starter', 'pro') or not coalesce(v_plan.is_active, false) then
    raise exception using errcode = '23514', message = 'BILLING_PLAN_NOT_AVAILABLE';
  end if;
  if new.billing_interval <> 'monthly'
     or new.currency <> v_plan.currency
     or new.amount <> v_plan.monthly_price then
    raise exception using errcode = '23514', message = 'BILLING_PRICE_MISMATCH';
  end if;
  return new;
end;
$$;

revoke all on function public.validate_billing_provider_price_v1()
  from public, anon, authenticated;
grant execute on function public.validate_billing_provider_price_v1()
  to service_role;

create trigger billing_provider_prices_validate
before insert or update on public.billing_provider_prices
for each row execute function public.validate_billing_provider_price_v1();

create trigger billing_provider_prices_set_updated_at
before update on public.billing_provider_prices
for each row execute function public.set_updated_at();

create table public.billing_checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  actor_profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_plan_id uuid not null references public.plans(id) on delete restrict,
  provider text not null,
  environment text not null,
  provider_session_id text,
  idempotency_key uuid not null,
  status text not null default 'creating',
  checkout_url_hash text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  constraint billing_checkout_sessions_provider_check
    check (provider in ('lemonsqueezy')),
  constraint billing_checkout_sessions_environment_check
    check (environment in ('test', 'live')),
  constraint billing_checkout_sessions_status_check
    check (status in ('creating', 'open', 'completed', 'expired', 'failed', 'cancelled')),
  constraint billing_checkout_sessions_hash_check
    check (checkout_url_hash is null or checkout_url_hash ~ '^[0-9a-f]{64}$'),
  constraint billing_checkout_sessions_provider_id_check
    check (provider_session_id is null or btrim(provider_session_id) <> ''),
  constraint billing_checkout_sessions_state_timestamps_check check (
    (completed_at is null or status = 'completed')
    and (failed_at is null or status = 'failed')
  ),
  constraint billing_checkout_sessions_idempotency_unique
    unique (provider, environment, idempotency_key)
);

create unique index billing_checkout_sessions_provider_session_unique
  on public.billing_checkout_sessions(provider, environment, provider_session_id)
  where provider_session_id is not null;
create index billing_checkout_sessions_salon_plan_recent_idx
  on public.billing_checkout_sessions(salon_id, requested_plan_id, created_at desc);

create trigger billing_checkout_sessions_set_updated_at
before update on public.billing_checkout_sessions
for each row execute function public.set_updated_at();

alter table public.billing_provider_prices enable row level security;
alter table public.billing_checkout_sessions enable row level security;

revoke all on table public.billing_provider_prices from public, anon, authenticated;
revoke all on table public.billing_checkout_sessions from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_provider_prices to service_role;
grant select, insert, update, delete on table public.billing_checkout_sessions to service_role;

comment on table public.billing_provider_prices is
  'Server-only provider variant mappings. No live or Premium mapping is seeded.';
comment on table public.billing_checkout_sessions is
  'Server-only checkout attempt ledger. It is not payment or subscription authority.';
comment on column public.billing_checkout_sessions.checkout_url_hash is
  'SHA-256 audit hash only; the provider checkout URL is never persisted.';
comment on column public.billing_checkout_sessions.status is
  'Completed is informational until a later verified webhook lifecycle phase.';

commit;
