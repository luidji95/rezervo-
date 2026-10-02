\set ON_ERROR_STOP on
begin;

do $$
declare
  v_definition text;
begin
  if to_regprocedure('public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)') is null then
    raise exception 'RETRY_V2_RPC_MISSING';
  end if;
  if has_function_privilege('public','public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)','execute')
     or has_function_privilege('anon','public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)','execute')
     or has_function_privilege('authenticated','public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)','execute')
     or not has_function_privilege('service_role','public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)','execute') then
    raise exception 'RETRY_V2_RPC_GRANTS_INVALID';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='claim_pending_billing_webhook_events_v2'
      and p.prosecdef
      and exists (
        select 1
        from unnest(coalesce(p.proconfig, array[]::text[])) setting
        where setting in ('search_path=', 'search_path=""')
      )
      and pg_get_userbyid(p.proowner)='postgres'
  ) then raise exception 'RETRY_V2_SECURITY_METADATA_INVALID'; end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname='public' and indexname='billing_webhook_events_retry_claim_environment_idx'
  ) then raise exception 'RETRY_V2_INDEX_MISSING'; end if;

  select pg_get_functiondef('public.claim_pending_billing_webhook_events_v2(text,integer,timestamptz,interval)'::regprocedure)
  into v_definition;
  if v_definition !~ 'e\.environment = p_environment'
     or v_definition !~ 'created_event\.environment = e\.environment'
     or v_definition !~ 'for update of e skip locked' then
    raise exception 'RETRY_V2_ENVIRONMENT_CONTRACT_MISSING';
  end if;
end;
$$;

create function pg_temp.make_environment_retry_event(
  p_environment text,
  p_event_name text,
  p_subscription_id text default null,
  p_attempts integer default 0
)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_nonce text := gen_random_uuid()::text;
begin
  insert into public.billing_webhook_events(
    id,provider,environment,event_name,provider_object_type,provider_object_id,
    payload_hash,semantic_fingerprint,processing_status,received_at,
    next_processing_attempt_at,processing_attempt_count
  ) values(
    v_id,'lemonsqueezy',p_environment,p_event_name,'subscriptions',
    coalesce(p_subscription_id,'object-'||v_nonce),
    md5('raw-'||v_nonce)||md5('raw2-'||v_nonce),
    md5('semantic-'||v_nonce)||md5('semantic2-'||v_nonce),
    'received','2026-07-30T09:00:00Z','2026-07-30T09:00:00Z',p_attempts
  );
  if p_subscription_id is not null then
    insert into public.billing_webhook_subscription_facts(
      webhook_event_id,facts_schema_version,provider_subscription_id,test_mode,
      correlation_status,correlation_error_code
    ) values(
      v_id,2,p_subscription_id,p_environment='test','invalid_custom_data','fixture'
    );
  end if;
  return v_id;
end;
$$;

do $$
begin
  begin
    perform * from public.claim_pending_billing_webhook_events_v2('sandbox',1,'2026-07-30T10:00:00Z','5 minutes');
    raise exception 'INVALID_ENVIRONMENT_ALLOWED';
  exception when sqlstate '22023' then
    if sqlerrm <> 'BILLING_WORKER_ENVIRONMENT_INVALID' then raise; end if;
  end;
end;
$$;

do $$
declare
  v_test uuid := pg_temp.make_environment_retry_event('test','subscription_created');
  v_live uuid := pg_temp.make_environment_retry_event('live','subscription_created');
  v_claimed uuid[];
begin
  select coalesce(array_agg(webhook_event_id), '{}'::uuid[]) into v_claimed
  from public.claim_pending_billing_webhook_events_v2('test',20,'2026-07-30T10:00:00Z','5 minutes');
  if not (v_test=any(v_claimed)) or v_live=any(v_claimed) then
    raise exception 'TEST_CLAIM_ENVIRONMENT_LEAK';
  end if;
  if exists(select 1 from public.billing_webhook_events where id=v_live and processing_attempt_count<>0) then
    raise exception 'TEST_CLAIM_MUTATED_LIVE';
  end if;

  select coalesce(array_agg(webhook_event_id), '{}'::uuid[]) into v_claimed
  from public.claim_pending_billing_webhook_events_v2('live',20,'2026-07-30T10:00:00Z','5 minutes');
  if not (v_live=any(v_claimed)) or v_test=any(v_claimed) then
    raise exception 'LIVE_CLAIM_ENVIRONMENT_LEAK';
  end if;
  if exists(
    select 1 from public.billing_webhook_events
    where id in (v_test,v_live)
      and (processing_attempt_count<>1 or processing_claim_token is null
           or processing_lease_until<>'2026-07-30T10:05:00Z')
  ) then raise exception 'ENVIRONMENT_CLAIM_METADATA_INVALID'; end if;
end;
$$;

do $$
declare
  v_test_created uuid := pg_temp.make_environment_retry_event('test','subscription_created','shared-provider-subscription');
  v_test_updated uuid := pg_temp.make_environment_retry_event('test','subscription_updated','shared-provider-subscription');
  v_live_updated uuid := pg_temp.make_environment_retry_event('live','subscription_updated','shared-provider-subscription');
  v_claimed uuid[];
begin
  select coalesce(array_agg(webhook_event_id), '{}'::uuid[]) into v_claimed
  from public.claim_pending_billing_webhook_events_v2('test',20,'2026-07-30T10:00:00Z','5 minutes');
  if not (v_test_created=any(v_claimed)) or v_test_updated=any(v_claimed) or v_live_updated=any(v_claimed) then
    raise exception 'TEST_DEPENDENCY_SCOPE_INVALID';
  end if;

  select coalesce(array_agg(webhook_event_id), '{}'::uuid[]) into v_claimed
  from public.claim_pending_billing_webhook_events_v2('live',20,'2026-07-30T10:00:00Z','5 minutes');
  if not (v_live_updated=any(v_claimed)) or v_test_created=any(v_claimed) then
    raise exception 'CROSS_ENVIRONMENT_DEPENDENCY_MATCHED';
  end if;
end;
$$;

do $$
declare
  v_test_exhausted uuid := pg_temp.make_environment_retry_event('test','subscription_created',null,7);
  v_live_exhausted uuid := pg_temp.make_environment_retry_event('live','subscription_created',null,7);
begin
  perform * from public.claim_pending_billing_webhook_events_v2('test',1,'2026-07-30T10:00:00Z','5 minutes');
  if not exists(select 1 from public.billing_webhook_events where id=v_test_exhausted and processing_status='manual_review' and error_code='processor_retry_exhausted') then
    raise exception 'TEST_EXHAUSTION_NOT_FINALIZED';
  end if;
  if not exists(select 1 from public.billing_webhook_events where id=v_live_exhausted and processing_status='received' and processing_attempt_count=7) then
    raise exception 'TEST_CLEANUP_MUTATED_LIVE';
  end if;
end;
$$;

rollback;
