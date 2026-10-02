begin;

alter table public.subscriptions
  add column billing_environment text;

alter table public.subscriptions
  add constraint subscriptions_billing_environment_check
  check (billing_environment is null or billing_environment in ('test', 'live'));

alter table public.subscriptions
  drop constraint if exists subscriptions_provider_metadata_consistent;

alter table public.subscriptions
  add constraint subscriptions_provider_metadata_consistent
  check (
    (
      billing_provider is null
      and billing_environment is null
      and provider_customer_id is null
      and provider_subscription_id is null
    )
    or
    (
      billing_provider is not null
      and billing_environment in ('test', 'live')
    )
  );

create unique index subscriptions_provider_subscription_unique
  on public.subscriptions(
    billing_provider,
    billing_environment,
    provider_subscription_id
  )
  where provider_subscription_id is not null;

alter table public.billing_checkout_sessions
  add column provider_order_id text,
  add column resulting_subscription_id uuid
    references public.subscriptions(id) on delete set null,
  add constraint billing_checkout_sessions_provider_order_id_check
    check (
      provider_order_id is null
      or provider_order_id ~ '[^[:space:]]'
    );

create unique index billing_checkout_sessions_provider_order_unique
  on public.billing_checkout_sessions(provider, environment, provider_order_id)
  where provider_order_id is not null;

create index billing_checkout_sessions_resulting_subscription_idx
  on public.billing_checkout_sessions(resulting_subscription_id);

comment on column public.subscriptions.billing_environment is
  'Provider object environment. Null is retained for subscriptions without provider metadata.';
comment on column public.billing_checkout_sessions.provider_order_id is
  'Provider order produced by this checkout; populated only by a future verified lifecycle processor.';
comment on column public.billing_checkout_sessions.resulting_subscription_id is
  'Resulting Rezervo subscription; populated only by a future verified lifecycle processor.';

commit;
