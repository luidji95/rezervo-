begin;

do $$
begin
  if exists (
    select 1
    from public.billing_checkout_sessions c
    where c.status in ('creating', 'open')
    group by c.provider, c.environment, c.salon_id
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'BILLING_ACTIVE_CHECKOUT_INTENT_DUPLICATES_EXIST';
  end if;
end;
$$;

create unique index billing_checkout_sessions_active_intent_unique
  on public.billing_checkout_sessions(provider, environment, salon_id)
  where status in ('creating', 'open');

create or replace function public.acquire_billing_checkout_intent_v1(
  p_salon_id uuid,
  p_actor_profile_id uuid,
  p_requested_plan_id uuid,
  p_provider text,
  p_environment text
)
returns table(
  acquisition_outcome text,
  checkout_session_id uuid,
  idempotency_key uuid,
  status text,
  requested_plan_id uuid,
  actor_profile_id uuid,
  provider text,
  environment text,
  provider_session_id text,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_checkout public.billing_checkout_sessions%rowtype;
  v_iteration integer;
begin
  if p_salon_id is null
     or p_actor_profile_id is null
     or p_requested_plan_id is null
     or p_provider is null
     or p_environment is null then
    raise exception using errcode = '22004', message = 'BILLING_CHECKOUT_INTENT_ARGUMENT_REQUIRED';
  end if;
  if p_provider <> 'lemonsqueezy' then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_INTENT_PROVIDER_INVALID';
  end if;
  if p_environment not in ('test', 'live') then
    raise exception using errcode = '22023', message = 'BILLING_CHECKOUT_INTENT_ENVIRONMENT_INVALID';
  end if;
  if not exists (select 1 from public.salons s where s.id = p_salon_id) then
    raise exception using errcode = 'P0002', message = 'BILLING_CHECKOUT_INTENT_SALON_NOT_FOUND';
  end if;
  if not exists (select 1 from public.profiles p where p.id = p_actor_profile_id) then
    raise exception using errcode = 'P0002', message = 'BILLING_CHECKOUT_INTENT_ACTOR_NOT_FOUND';
  end if;
  if not exists (select 1 from public.plans p where p.id = p_requested_plan_id) then
    raise exception using errcode = 'P0002', message = 'BILLING_CHECKOUT_INTENT_PLAN_NOT_FOUND';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'billing-checkout-intent:' || p_provider || ':' || p_environment || ':' || p_salon_id::text,
      0
    )
  );

  for v_iteration in 1..4 loop
    v_checkout := null;
    insert into public.billing_checkout_sessions(
      salon_id,
      actor_profile_id,
      requested_plan_id,
      provider,
      environment,
      idempotency_key,
      status
    ) values (
      p_salon_id,
      p_actor_profile_id,
      p_requested_plan_id,
      p_provider,
      p_environment,
      extensions.gen_random_uuid(),
      'creating'
    )
    on conflict (provider, environment, salon_id)
      where status in ('creating', 'open')
      do nothing
    returning * into v_checkout;

    if found then
      return query select
        'created'::text,
        v_checkout.id,
        v_checkout.idempotency_key,
        v_checkout.status,
        v_checkout.requested_plan_id,
        v_checkout.actor_profile_id,
        v_checkout.provider,
        v_checkout.environment,
        v_checkout.provider_session_id,
        v_checkout.expires_at;
      return;
    end if;

    select c.* into v_checkout
    from public.billing_checkout_sessions c
    where c.provider = p_provider
      and c.environment = p_environment
      and c.salon_id = p_salon_id
      and c.status in ('creating', 'open')
    for update;

    if found then
      return query select
        'existing'::text,
        v_checkout.id,
        v_checkout.idempotency_key,
        v_checkout.status,
        v_checkout.requested_plan_id,
        v_checkout.actor_profile_id,
        v_checkout.provider,
        v_checkout.environment,
        v_checkout.provider_session_id,
        v_checkout.expires_at;
      return;
    end if;
  end loop;

  raise exception using
    errcode = '40001',
    message = 'BILLING_CHECKOUT_INTENT_ACQUIRE_RETRY_EXHAUSTED';
end;
$$;

alter function public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)
  owner to postgres;

revoke all on function public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)
  from public, anon, authenticated;
grant execute on function public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text)
  to service_role;

comment on index public.billing_checkout_sessions_active_intent_unique is
  'At most one creating or open Lemon Squeezy checkout intent per provider, environment and salon.';
comment on function public.acquire_billing_checkout_intent_v1(uuid,uuid,uuid,text,text) is
  'Service-role atomic get-or-create for a server-authorized checkout intent; only created permits a later provider create call.';

commit;
