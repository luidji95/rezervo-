-- Server-only billing access overrides. This migration is schema-only and
-- intentionally creates no override rows or subscription/plan mutations.

create table public.billing_access_overrides (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.salons(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete restrict,
  override_type text not null,
  reason text not null,
  enabled boolean not null default true,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by_profile_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_access_overrides_type_check
    check (override_type in ('internal', 'pilot', 'complimentary', 'support')),
  constraint billing_access_overrides_reason_check
    check (reason = btrim(reason) and length(reason) between 1 and 500),
  constraint billing_access_overrides_period_check
    check (ends_at is null or ends_at > starts_at)
);

create index billing_access_overrides_active_lookup_idx
  on public.billing_access_overrides (enabled, starts_at, ends_at)
  where enabled = true;

comment on table public.billing_access_overrides is
  'Server-only explicit free-access grants. Never exposed directly to browser roles.';
comment on column public.billing_access_overrides.reason is
  'Internal audit reason. Must not be returned by salon-facing APIs.';
comment on column public.billing_access_overrides.created_by_profile_id is
  'Optional internal operator attribution. Must not be returned by salon-facing APIs.';

drop trigger if exists billing_access_overrides_updated_at
  on public.billing_access_overrides;
create trigger billing_access_overrides_updated_at
before update on public.billing_access_overrides
for each row execute function public.set_updated_at();

alter table public.billing_access_overrides enable row level security;

revoke all on table public.billing_access_overrides from public, anon, authenticated;
grant all on table public.billing_access_overrides to service_role;
