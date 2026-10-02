begin;

do $$
declare
  v_invalid_count bigint;
begin
  select count(*)
  into v_invalid_count
  from public.subscriptions
  where
    (
      billing_provider is null
      and (
        billing_environment is not null
        or provider_customer_id is not null
        or provider_subscription_id is not null
      )
    )
    or
    (
      billing_provider is not null
      and (
        billing_environment is null
        or billing_environment not in ('test', 'live')
      )
    );

  if v_invalid_count > 0 then
    raise exception using
      errcode = '23514',
      message = format(
        'BILLING_PROVIDER_ENVIRONMENT_CONTRACT_VIOLATION invalid_row_count=%s',
        v_invalid_count
      );
  end if;
end;
$$;

alter table public.subscriptions
  drop constraint subscriptions_provider_metadata_consistent;

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
      and billing_environment is not null
      and billing_environment in ('test', 'live')
    )
  );

commit;
