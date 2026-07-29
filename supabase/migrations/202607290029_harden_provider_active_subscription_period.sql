begin;

do $$
declare
  v_invalid_count bigint;
begin
  select count(*)
  into v_invalid_count
  from public.subscriptions as subscription
  where subscription.billing_provider is not null
    and subscription.status = 'active'
    and not (
      subscription.provider_customer_id is not null
      and subscription.provider_customer_id ~ '[^[:space:]]'
      and subscription.provider_subscription_id is not null
      and subscription.provider_subscription_id ~ '[^[:space:]]'
      and subscription.current_period_starts_at is not null
      and subscription.current_period_ends_at is not null
      and subscription.provider_state_updated_at is not null
      and subscription.current_period_ends_at > subscription.current_period_starts_at
    );

  if v_invalid_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'BILLING_PROVIDER_ACTIVE_PERIOD_CONTRACT_VIOLATION invalid_row_count=%s',
        v_invalid_count
      );
  end if;
end;
$$;

alter table public.subscriptions
  add constraint subscriptions_provider_active_period_consistent
  check (
    billing_provider is null
    or status is distinct from 'active'
    or (
      provider_customer_id is not null
      and provider_customer_id ~ '[^[:space:]]'
      and provider_subscription_id is not null
      and provider_subscription_id ~ '[^[:space:]]'
      and current_period_starts_at is not null
      and current_period_ends_at is not null
      and provider_state_updated_at is not null
      and current_period_ends_at > current_period_starts_at
    )
  );

commit;
