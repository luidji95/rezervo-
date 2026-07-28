begin;

create table public.billing_webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null,
  event_name text not null,
  provider_object_type text not null,
  provider_object_id text not null,
  payload_hash text not null,
  processing_status text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error_code text,
  salon_id uuid references public.salons(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint billing_webhook_events_provider_check
    check (provider = 'lemonsqueezy'),
  constraint billing_webhook_events_environment_check
    check (environment in ('test', 'live')),
  constraint billing_webhook_events_status_check
    check (processing_status in ('received', 'ignored', 'processed', 'failed')),
  constraint billing_webhook_events_name_check
    check (btrim(event_name) <> ''),
  constraint billing_webhook_events_object_type_check
    check (btrim(provider_object_type) <> ''),
  constraint billing_webhook_events_object_id_check
    check (btrim(provider_object_id) <> ''),
  constraint billing_webhook_events_payload_hash_check
    check (payload_hash ~ '^[0-9a-f]{64}$'),
  constraint billing_webhook_events_delivery_unique
    unique (provider, environment, payload_hash)
);

create index billing_webhook_events_status_received_idx
  on public.billing_webhook_events(processing_status, received_at desc);
create index billing_webhook_events_provider_object_idx
  on public.billing_webhook_events(
    provider,
    environment,
    provider_object_type,
    provider_object_id,
    received_at desc
  );

create trigger billing_webhook_events_set_updated_at
before update on public.billing_webhook_events
for each row execute function public.set_updated_at();

alter table public.billing_webhook_events enable row level security;

revoke all on table public.billing_webhook_events
  from public, anon, authenticated;
grant select, insert, update, delete on table public.billing_webhook_events
  to service_role;

comment on table public.billing_webhook_events is
  'Server-only minimal webhook delivery ledger. Raw provider payloads and signatures are never persisted.';
comment on column public.billing_webhook_events.payload_hash is
  'SHA-256 of the exact signed raw request body; used for delivery idempotency.';
comment on column public.billing_webhook_events.processing_status is
  'Received events await a later lifecycle phase; ignored events require no business processing.';
comment on column public.billing_webhook_events.salon_id is
  'Nullable until a later phase derives a salon from trusted server-owned provider mappings.';

commit;
