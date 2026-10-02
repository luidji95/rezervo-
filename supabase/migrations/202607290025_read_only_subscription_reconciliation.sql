begin;

create table public.billing_subscription_reconciliation_checks (
  id uuid primary key default extensions.gen_random_uuid(),
  run_id uuid not null,
  subscription_id uuid not null references public.subscriptions(id) on delete restrict,
  status text not null,
  attempt_count integer not null default 0,
  claim_token uuid,
  lease_until timestamptz,
  next_attempt_at timestamptz,
  started_at timestamptz,
  checked_at timestamptz,
  outcome text,
  error_code text,
  claimed_local_identity_fingerprint text not null,
  claimed_provider_state_updated_at timestamptz,
  local_provider_state_updated_at timestamptz,
  remote_provider_updated_at timestamptz,
  remote_status text,
  remote_cancelled boolean,
  remote_renews_at timestamptz,
  remote_ends_at timestamptz,
  remote_state_fingerprint text,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint billing_subscription_reconciliation_status_check
    check (status in ('claimed','retry_scheduled','completed','abandoned')),
  constraint billing_subscription_reconciliation_attempt_check
    check (attempt_count >= 0),
  constraint billing_subscription_reconciliation_lease_pair_check
    check ((claim_token is null and lease_until is null) or (claim_token is not null and lease_until is not null)),
  constraint billing_subscription_reconciliation_state_check check (
    (status='claimed' and claim_token is not null and lease_until is not null and next_attempt_at is null and checked_at is null)
    or (status='retry_scheduled' and claim_token is null and lease_until is null and next_attempt_at is not null and checked_at is null)
    or (status in ('completed','abandoned') and claim_token is null and lease_until is null and next_attempt_at is null and checked_at is not null)
  ),
  constraint billing_subscription_reconciliation_claimed_fingerprint_check
    check (claimed_local_identity_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_subscription_reconciliation_remote_fingerprint_check
    check (remote_state_fingerprint is null or remote_state_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint billing_subscription_reconciliation_error_code_check
    check (error_code is null or error_code ~ '^[a-z0-9_]+$')
);

create unique index billing_subscription_reconciliation_active_unique
  on public.billing_subscription_reconciliation_checks(subscription_id)
  where status in ('claimed','retry_scheduled');
create index billing_subscription_reconciliation_retry_idx
  on public.billing_subscription_reconciliation_checks(next_attempt_at, subscription_id)
  where status='retry_scheduled';
create index billing_subscription_reconciliation_latest_idx
  on public.billing_subscription_reconciliation_checks(subscription_id, checked_at desc)
  where status in ('completed','abandoned');
create index billing_subscription_reconciliation_run_idx
  on public.billing_subscription_reconciliation_checks(run_id, created_at);

alter table public.billing_subscription_reconciliation_checks enable row level security;
revoke all on table public.billing_subscription_reconciliation_checks from public, anon, authenticated, service_role;
grant select on table public.billing_subscription_reconciliation_checks to service_role;

create or replace function public.evaluate_billing_subscription_snapshot_v1(
  p_subscription_id uuid,
  p_claimed_local_identity_fingerprint text,
  p_provider_subscription_id text,
  p_provider_customer_id text,
  p_provider_store_id text,
  p_test_mode boolean,
  p_provider_product_id text,
  p_provider_variant_id text,
  p_provider_status text,
  p_provider_cancelled boolean,
  p_provider_pause_mode text,
  p_provider_pause_resumes_at timestamptz,
  p_provider_trial_ends_at timestamptz,
  p_provider_renews_at timestamptz,
  p_provider_ends_at timestamptz,
  p_provider_created_at timestamptz,
  p_provider_updated_at timestamptz,
  p_now timestamptz default pg_catalog.now()
)
returns table(outcome text, error_code text, local_provider_state_updated_at timestamptz)
language plpgsql stable security definer set search_path=''
as $$
declare
  v_subscription public.subscriptions%rowtype;
  v_plan public.plans%rowtype;
  v_mapping public.billing_provider_prices%rowtype;
  v_identity text;
  v_equivalent boolean := false;
begin
  select * into v_subscription from public.subscriptions where id=p_subscription_id;
  if not found then return query select 'local_changed_during_check'::text,null::text,null::timestamptz; return; end if;
  select * into v_plan from public.plans where id=v_subscription.plan_id;
  select * into v_mapping from public.billing_provider_prices
   where provider='lemonsqueezy' and environment='test' and plan_id=v_subscription.plan_id
     and billing_interval='monthly' and is_active limit 1;
  v_identity := pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'billing_environment',v_subscription.billing_environment,'billing_interval',v_mapping.billing_interval,
    'billing_provider',v_subscription.billing_provider,'mapping_product_id',v_mapping.provider_product_id,
    'mapping_store_id',v_mapping.provider_store_id,'mapping_variant_id',v_mapping.provider_variant_id,
    'plan_id',v_subscription.plan_id,'provider_customer_id',v_subscription.provider_customer_id,
    'provider_subscription_id',v_subscription.provider_subscription_id)::text,'UTF8'),'sha256'),'hex');
  if v_identity is distinct from p_claimed_local_identity_fingerprint then
    return query select 'local_changed_during_check'::text,null::text,v_subscription.provider_state_updated_at; return;
  end if;
  if p_test_mode is distinct from true then
    return query select 'identity_conflict'::text,'reconciliation_environment_conflict'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if v_subscription.billing_provider<>'lemonsqueezy' or v_subscription.billing_environment<>'test'
     or v_subscription.provider_subscription_id is distinct from p_provider_subscription_id
     or v_subscription.provider_customer_id is distinct from p_provider_customer_id
     or v_mapping.provider_store_id is distinct from p_provider_store_id then
    return query select 'identity_conflict'::text,'reconciliation_identity_conflict'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if v_mapping.provider_variant_id is distinct from p_provider_variant_id
     or (v_mapping.provider_product_id is not null and v_mapping.provider_product_id is distinct from p_provider_product_id) then
    if exists(select 1 from public.billing_provider_prices m join public.plans p on p.id=m.plan_id
      where m.provider='lemonsqueezy' and m.environment='test' and m.billing_interval='monthly' and m.is_active
        and p.is_active and p.slug in ('starter','pro') and m.plan_id<>v_subscription.plan_id
        and m.provider_variant_id=p_provider_variant_id
        and (m.provider_product_id is null or m.provider_product_id is not distinct from p_provider_product_id)) then
      return query select 'plan_change_detected'::text,'reconciliation_plan_change_detected'::text,v_subscription.provider_state_updated_at; return;
    end if;
    return query select 'mapping_conflict'::text,'reconciliation_mapping_conflict'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if v_plan.id is null or not v_plan.is_active or v_plan.slug not in ('starter','pro') or v_mapping.id is null then
    return query select 'mapping_conflict'::text,'reconciliation_mapping_conflict'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if p_provider_created_at is null or p_provider_updated_at is null or p_provider_updated_at<p_provider_created_at then
    return query select 'provider_response_invalid'::text,'reconciliation_provider_timestamp_invalid'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if p_provider_pause_mode is not null or p_provider_pause_resumes_at is not null
     or p_provider_status='on_trial' or p_provider_trial_ends_at is not null then
    return query select 'unsupported_remote_state'::text,'reconciliation_remote_state_unsupported'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if p_provider_status='active' and p_provider_cancelled is false and p_provider_ends_at is null
     and p_provider_renews_at is not null and p_provider_renews_at>p_now then
    v_equivalent := v_subscription.status='active' and v_subscription.current_period_ends_at is not distinct from p_provider_renews_at
      and v_subscription.cancel_at_period_end=false and v_subscription.cancelled_at is null;
  elsif p_provider_status='cancelled' and p_provider_cancelled is true and p_provider_ends_at is not null
     and p_provider_ends_at>p_now and p_provider_ends_at>p_provider_updated_at then
    v_equivalent := v_subscription.status='cancelled' and v_subscription.current_period_ends_at is not distinct from p_provider_ends_at
      and v_subscription.cancel_at_period_end=true and v_subscription.cancelled_at is not null;
  elsif p_provider_status in ('past_due','unpaid') and p_provider_cancelled is false and p_provider_ends_at is null then
    v_equivalent := v_subscription.status='past_due' and v_subscription.cancel_at_period_end=false;
  elsif p_provider_status='expired' and p_provider_ends_at is not null and p_provider_ends_at<=p_now
     and p_provider_ends_at<=p_provider_updated_at then
    v_equivalent := v_subscription.status='expired' and v_subscription.current_period_ends_at is not distinct from p_provider_ends_at
      and v_subscription.cancel_at_period_end=false;
  else
    return query select 'unsupported_remote_state'::text,'reconciliation_remote_state_unsupported'::text,v_subscription.provider_state_updated_at; return;
  end if;
  if v_subscription.provider_state_updated_at is null or p_provider_updated_at>v_subscription.provider_state_updated_at then
    return query select case when v_equivalent then 'remote_newer_in_sync_equivalent' else 'remote_newer_drift' end,
      null::text,v_subscription.provider_state_updated_at; return;
  elsif p_provider_updated_at<v_subscription.provider_state_updated_at then
    return query select 'local_newer'::text,null::text,v_subscription.provider_state_updated_at; return;
  end if;
  return query select case when v_equivalent then 'in_sync' else 'same_timestamp_conflict' end,
    null::text,v_subscription.provider_state_updated_at;
end;
$$;

create or replace function public.claim_next_linked_billing_subscription_for_reconciliation_v1(
  p_run_id uuid,
  p_now timestamptz default pg_catalog.now(),
  p_lease_duration interval default interval '5 minutes',
  p_min_freshness interval default interval '15 minutes'
)
returns table(check_id uuid,subscription_id uuid,claim_token uuid,provider_subscription_id text,
  provider_customer_id text,local_plan_id uuid,local_status text,local_current_period_ends_at timestamptz,
  local_cancel_at_period_end boolean,local_cancelled_at timestamptz,local_provider_state_updated_at timestamptz,
  mapped_store_id text,mapped_product_id text,mapped_variant_id text)
language plpgsql security definer set search_path=''
as $$
declare v_check public.billing_subscription_reconciliation_checks%rowtype; v_candidate record; v_token uuid; v_identity text;
begin
  if p_run_id is null or p_now is null then raise exception using errcode='22004',message='BILLING_RECONCILIATION_ARGUMENT_REQUIRED'; end if;
  if p_lease_duration<interval '30 seconds' or p_lease_duration>interval '10 minutes'
     or p_min_freshness<interval '1 minute' or p_min_freshness>interval '24 hours' then
    raise exception using errcode='22023',message='BILLING_RECONCILIATION_INTERVAL_INVALID';
  end if;
  update public.billing_subscription_reconciliation_checks c set status='abandoned',outcome='provider_unavailable',
    error_code='reconciliation_retry_exhausted',checked_at=p_now,claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now
  where c.status in ('claimed','retry_scheduled') and c.attempt_count>=7
    and ((c.status='claimed' and c.lease_until<=p_now) or (c.status='retry_scheduled' and c.next_attempt_at<=p_now));

  select * into v_check from public.billing_subscription_reconciliation_checks c
   where c.status in ('claimed','retry_scheduled') and c.attempt_count<7
     and ((c.status='claimed' and c.lease_until<=p_now) or (c.status='retry_scheduled' and c.next_attempt_at<=p_now))
   order by case when c.status='retry_scheduled' then 0 else 1 end,coalesce(c.next_attempt_at,c.lease_until),c.id
   for update skip locked limit 1;
  if found then
    select s.*,p.slug,m.provider_store_id,m.provider_product_id,m.provider_variant_id,m.billing_interval into v_candidate
      from public.subscriptions s join public.plans p on p.id=s.plan_id
      join public.billing_provider_prices m on m.plan_id=s.plan_id and m.provider='lemonsqueezy' and m.environment='test'
        and m.billing_interval='monthly' and m.is_active
      where s.id=v_check.subscription_id and s.billing_provider='lemonsqueezy' and s.billing_environment='test'
        and s.status in ('active','cancelled','past_due','expired') and p.is_active and p.slug in ('starter','pro')
        and s.provider_subscription_id~'[^[:space:]]' and s.provider_customer_id~'[^[:space:]]'
        and m.provider_store_id~'[^[:space:]]' and m.provider_variant_id~'[^[:space:]]';
    if not found then
      update public.billing_subscription_reconciliation_checks set status='completed',outcome='local_changed_during_check',
        checked_at=p_now,claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now where id=v_check.id;
      return query select * from public.claim_next_linked_billing_subscription_for_reconciliation_v1(p_run_id,p_now,p_lease_duration,p_min_freshness);
      return;
    end if;
    v_identity:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'billing_environment',v_candidate.billing_environment,'billing_interval',v_candidate.billing_interval,
      'billing_provider',v_candidate.billing_provider,'mapping_product_id',v_candidate.provider_product_id,
      'mapping_store_id',v_candidate.provider_store_id,'mapping_variant_id',v_candidate.provider_variant_id,
      'plan_id',v_candidate.plan_id,'provider_customer_id',v_candidate.provider_customer_id,
      'provider_subscription_id',v_candidate.provider_subscription_id)::text,'UTF8'),'sha256'),'hex');
    if v_identity is distinct from v_check.claimed_local_identity_fingerprint then
      update public.billing_subscription_reconciliation_checks set status='completed',outcome='local_changed_during_check',
        checked_at=p_now,claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now where id=v_check.id;
      return query select * from public.claim_next_linked_billing_subscription_for_reconciliation_v1(p_run_id,p_now,p_lease_duration,p_min_freshness);
      return;
    end if;
    v_token:=extensions.gen_random_uuid();
    update public.billing_subscription_reconciliation_checks set run_id=p_run_id,status='claimed',attempt_count=attempt_count+1,
      claim_token=v_token,lease_until=p_now+p_lease_duration,next_attempt_at=null,started_at=p_now,updated_at=p_now where id=v_check.id;
  else
    select s.*,p.slug,m.provider_store_id,m.provider_product_id,m.provider_variant_id,m.billing_interval into v_candidate
      from public.subscriptions s join public.plans p on p.id=s.plan_id
      join public.billing_provider_prices m on m.plan_id=s.plan_id and m.provider='lemonsqueezy' and m.environment='test'
        and m.billing_interval='monthly' and m.is_active
      where s.billing_provider='lemonsqueezy' and s.billing_environment='test'
        and s.status in ('active','cancelled','past_due','expired') and p.is_active and p.slug in ('starter','pro')
        and s.provider_subscription_id~'[^[:space:]]' and s.provider_customer_id~'[^[:space:]]'
        and m.provider_store_id~'[^[:space:]]' and m.provider_variant_id~'[^[:space:]]'
        and not exists(select 1 from public.billing_subscription_reconciliation_checks a where a.subscription_id=s.id and a.status in ('claimed','retry_scheduled'))
        and coalesce((select max(c.checked_at) from public.billing_subscription_reconciliation_checks c
          where c.subscription_id=s.id and c.status='completed'),'-infinity'::timestamptz)<=p_now-p_min_freshness
      order by case s.status when 'past_due' then 0 when 'cancelled' then 1 when 'active' then 2 else 3 end,
        coalesce((select max(c.checked_at) from public.billing_subscription_reconciliation_checks c where c.subscription_id=s.id),'-infinity'::timestamptz),s.id
      for update of s skip locked limit 1;
    if not found then return; end if;
    v_identity:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
      'billing_environment',v_candidate.billing_environment,'billing_interval',v_candidate.billing_interval,
      'billing_provider',v_candidate.billing_provider,'mapping_product_id',v_candidate.provider_product_id,
      'mapping_store_id',v_candidate.provider_store_id,'mapping_variant_id',v_candidate.provider_variant_id,
      'plan_id',v_candidate.plan_id,'provider_customer_id',v_candidate.provider_customer_id,
      'provider_subscription_id',v_candidate.provider_subscription_id)::text,'UTF8'),'sha256'),'hex');
    v_token:=extensions.gen_random_uuid();
    insert into public.billing_subscription_reconciliation_checks(run_id,subscription_id,status,attempt_count,claim_token,
      lease_until,started_at,claimed_local_identity_fingerprint,claimed_provider_state_updated_at)
    values(p_run_id,v_candidate.id,'claimed',1,v_token,p_now+p_lease_duration,p_now,v_identity,v_candidate.provider_state_updated_at)
    returning * into v_check;
  end if;
  return query select v_check.id,v_candidate.id,v_token,v_candidate.provider_subscription_id,v_candidate.provider_customer_id,
    v_candidate.plan_id,v_candidate.status::text,v_candidate.current_period_ends_at,v_candidate.cancel_at_period_end,
    v_candidate.cancelled_at,v_candidate.provider_state_updated_at,v_candidate.provider_store_id,
    v_candidate.provider_product_id,v_candidate.provider_variant_id;
end;
$$;

create or replace function public.finalize_billing_subscription_reconciliation_v1(
  p_check_id uuid,p_claim_token uuid,p_result_kind text,
  p_provider_subscription_id text default null,p_provider_customer_id text default null,p_provider_store_id text default null,
  p_test_mode boolean default null,
  p_provider_product_id text default null,p_provider_variant_id text default null,p_provider_status text default null,
  p_provider_cancelled boolean default null,p_provider_pause_mode text default null,p_provider_pause_resumes_at timestamptz default null,
  p_provider_trial_ends_at timestamptz default null,p_provider_renews_at timestamptz default null,p_provider_ends_at timestamptz default null,
  p_provider_created_at timestamptz default null,p_provider_updated_at timestamptz default null,
  p_provider_error_code text default null,p_now timestamptz default pg_catalog.now()
)
returns table(outcome text)
language plpgsql security definer set search_path=''
as $$
declare v_check public.billing_subscription_reconciliation_checks%rowtype; v_evaluation record; v_next timestamptz; v_fingerprint text;
begin
  select * into v_check from public.billing_subscription_reconciliation_checks where id=p_check_id for update;
  if not found then return query select 'claim_lost'::text; return; end if;
  if v_check.status in ('completed','abandoned') then return query select 'already_terminal'::text; return; end if;
  if p_claim_token is null or v_check.claim_token is distinct from p_claim_token then return query select 'claim_lost'::text; return; end if;
  if v_check.status<>'claimed' then return query select 'claim_lost'::text; return; end if;
  if p_result_kind not in ('snapshot','provider_not_found','provider_unavailable','configuration_error','provider_response_invalid') then
    raise exception using errcode='22023',message='BILLING_RECONCILIATION_RESULT_INVALID';
  end if;
  if p_result_kind='provider_unavailable' then
    if v_check.attempt_count>=7 then
      update public.billing_subscription_reconciliation_checks set status='abandoned',outcome='provider_unavailable',
        error_code='reconciliation_retry_exhausted',checked_at=p_now,claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now where id=v_check.id;
      return query select 'abandoned'::text; return;
    end if;
    v_next:=p_now+case v_check.attempt_count when 1 then interval '1 minute' when 2 then interval '5 minutes'
      when 3 then interval '15 minutes' when 4 then interval '1 hour' when 5 then interval '6 hours' else interval '24 hours' end;
    update public.billing_subscription_reconciliation_checks set status='retry_scheduled',outcome='provider_unavailable',
      error_code=p_provider_error_code,next_attempt_at=v_next,claim_token=null,lease_until=null,updated_at=p_now where id=v_check.id;
    return query select 'retry_scheduled'::text; return;
  end if;
  if p_result_kind<>'snapshot' then
    update public.billing_subscription_reconciliation_checks set status='completed',outcome=p_result_kind,error_code=p_provider_error_code,
      checked_at=p_now,claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now where id=v_check.id;
    return query select p_result_kind; return;
  end if;
  select * into v_evaluation from public.evaluate_billing_subscription_snapshot_v1(v_check.subscription_id,
    v_check.claimed_local_identity_fingerprint,p_provider_subscription_id,p_provider_customer_id,p_provider_store_id,p_test_mode,
    p_provider_product_id,p_provider_variant_id,p_provider_status,p_provider_cancelled,p_provider_pause_mode,
    p_provider_pause_resumes_at,p_provider_trial_ends_at,p_provider_renews_at,p_provider_ends_at,p_provider_created_at,
    p_provider_updated_at,p_now);
  v_fingerprint:=pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.jsonb_build_object(
    'cancelled',p_provider_cancelled,'created_at',p_provider_created_at,'ends_at',p_provider_ends_at,
    'pause_mode',p_provider_pause_mode,'pause_resumes_at',p_provider_pause_resumes_at,
    'renews_at',p_provider_renews_at,'status',p_provider_status,'trial_ends_at',p_provider_trial_ends_at,
    'updated_at',p_provider_updated_at)::text,'UTF8'),'sha256'),'hex');
  update public.billing_subscription_reconciliation_checks set status='completed',checked_at=p_now,outcome=v_evaluation.outcome,
    error_code=v_evaluation.error_code,local_provider_state_updated_at=v_evaluation.local_provider_state_updated_at,
    remote_provider_updated_at=p_provider_updated_at,remote_status=p_provider_status,remote_cancelled=p_provider_cancelled,
    remote_renews_at=p_provider_renews_at,remote_ends_at=p_provider_ends_at,remote_state_fingerprint=v_fingerprint,
    claim_token=null,lease_until=null,next_attempt_at=null,updated_at=p_now where id=v_check.id;
  return query select v_evaluation.outcome::text;
end;
$$;

revoke all on function public.evaluate_billing_subscription_snapshot_v1(uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.evaluate_billing_subscription_snapshot_v1(uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) to service_role;
revoke all on function public.claim_next_linked_billing_subscription_for_reconciliation_v1(uuid,timestamptz,interval,interval) from public,anon,authenticated;
grant execute on function public.claim_next_linked_billing_subscription_for_reconciliation_v1(uuid,timestamptz,interval,interval) to service_role;
revoke all on function public.finalize_billing_subscription_reconciliation_v1(uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz) from public,anon,authenticated;
grant execute on function public.finalize_billing_subscription_reconciliation_v1(uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz) to service_role;

comment on table public.billing_subscription_reconciliation_checks is 'Server-only PII-free read-only provider reconciliation audit; never subscription authority.';
comment on function public.evaluate_billing_subscription_snapshot_v1(uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz) is 'Read-only Lemon Squeezy test subscription snapshot evaluator.';
comment on function public.claim_next_linked_billing_subscription_for_reconciliation_v1(uuid,timestamptz,interval,interval) is 'Claims at most one linked Lemon Squeezy test subscription for read-only reconciliation.';
comment on function public.finalize_billing_subscription_reconciliation_v1(uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz) is 'Finalizes one PII-free read-only reconciliation check without changing billing business state.';

commit;
