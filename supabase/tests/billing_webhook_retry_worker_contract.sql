\set ON_ERROR_STOP on
begin;

do $$
declare
  v_columns integer;
begin
  select count(*) into v_columns
  from information_schema.columns
  where table_schema='public' and table_name='billing_webhook_events'
    and column_name in (
      'processing_attempt_count','last_processing_attempt_at',
      'next_processing_attempt_at','last_processing_outcome',
      'processing_lease_until','processing_claim_token'
    );
  if v_columns <> 6 then raise exception 'RETRY_COLUMNS_MISSING'; end if;
  if (select column_default <> '0' from information_schema.columns where table_schema='public' and table_name='billing_webhook_events' and column_name='processing_attempt_count') then
    raise exception 'ATTEMPT_DEFAULT_INVALID';
  end if;
  if not exists (select 1 from pg_constraint where conname='billing_webhook_events_attempt_count_check')
     or not exists (select 1 from pg_constraint where conname='billing_webhook_events_lease_token_pair_check') then
    raise exception 'RETRY_CONSTRAINTS_MISSING';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='billing_webhook_events_retry_claim_idx') then
    raise exception 'RETRY_INDEX_MISSING';
  end if;
  if to_regprocedure('public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)') is null
     or to_regprocedure('public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)') is null then
    raise exception 'RETRY_RPCS_MISSING';
  end if;
  if has_function_privilege('public','public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)','execute')
     or has_function_privilege('anon','public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)','execute')
     or has_function_privilege('authenticated','public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)','execute')
     or not has_function_privilege('service_role','public.claim_pending_billing_webhook_events_v1(integer,timestamptz,interval)','execute')
     or has_function_privilege('public','public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)','execute')
     or has_function_privilege('anon','public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)','execute')
     or has_function_privilege('authenticated','public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)','execute')
     or not has_function_privilege('service_role','public.finalize_billing_webhook_processing_attempt_v1(uuid,uuid,text,timestamptz)','execute') then
    raise exception 'RETRY_RPC_GRANTS_INVALID';
  end if;
end;
$$;

create function pg_temp.make_retry_event(
  p_event_name text,
  p_status text default 'received',
  p_environment text default 'test',
  p_subscription_id text default null,
  p_with_facts boolean default false,
  p_next timestamptz default '2026-07-29T10:00:00Z'
)
returns uuid language plpgsql as $$
declare
  v_id uuid := gen_random_uuid();
  v_nonce text := gen_random_uuid()::text;
begin
  insert into public.billing_webhook_events(
    id,provider,environment,event_name,provider_object_type,provider_object_id,
    payload_hash,semantic_fingerprint,processing_status,received_at,
    processed_at,next_processing_attempt_at
  ) values (
    v_id,'lemonsqueezy',p_environment,p_event_name,'subscriptions',
    coalesce(p_subscription_id,'object-'||v_nonce),
    md5('raw-'||v_nonce)||md5('raw2-'||v_nonce),
    md5('semantic-'||v_nonce)||md5('semantic2-'||v_nonce),
    p_status,'2026-07-29T09:00:00Z',
    case when p_status='received' then null else '2026-07-29T09:01:00Z'::timestamptz end,
    p_next
  );
  if p_with_facts then
    insert into public.billing_webhook_subscription_facts(
      webhook_event_id,facts_schema_version,provider_subscription_id,test_mode,
      correlation_status,correlation_error_code
    ) values(v_id,2,p_subscription_id,true,'invalid_custom_data','fixture');
  end if;
  return v_id;
end;
$$;

do $$
declare
  v_created uuid;
  v_updated uuid;
  v_missing_facts uuid;
  v_processed uuid;
  v_ignored uuid;
  v_manual uuid;
  v_live uuid;
  v_payment uuid;
  v_granular uuid;
  v_future uuid;
  v_active_lease uuid;
  v_claimed uuid[];
  v_token uuid;
begin
  v_created := pg_temp.make_retry_event('subscription_created','received','test','sub-ordering',true);
  v_updated := pg_temp.make_retry_event('subscription_updated','received','test','sub-ordering',true);
  v_missing_facts := pg_temp.make_retry_event('subscription_updated');
  v_processed := pg_temp.make_retry_event('subscription_created','processed');
  v_ignored := pg_temp.make_retry_event('subscription_created','ignored');
  v_manual := pg_temp.make_retry_event('subscription_created','manual_review');
  v_live := pg_temp.make_retry_event('subscription_created','received','live');
  v_payment := pg_temp.make_retry_event('subscription_payment_success');
  v_granular := pg_temp.make_retry_event('subscription_cancelled');
  v_future := pg_temp.make_retry_event('subscription_created','received','test',null,false,'2026-07-29T12:00:00Z');
  v_active_lease := pg_temp.make_retry_event('subscription_created');
  update public.billing_webhook_events set processing_lease_until='2026-07-29T10:10:00Z',processing_claim_token=gen_random_uuid() where id=v_active_lease;

  select array_agg(webhook_event_id order by event_name,webhook_event_id)
  into v_claimed
  from public.claim_pending_billing_webhook_events_v1(20,'2026-07-29T10:00:00Z','5 minutes');
  if cardinality(v_claimed) <> 2 or not (v_created=any(v_claimed)) or not (v_missing_facts=any(v_claimed)) or v_updated=any(v_claimed) then
    raise exception 'CLAIM_SELECTION_INVALID';
  end if;
  if exists(select 1 from public.billing_webhook_events where id in (v_processed,v_ignored,v_manual,v_live,v_payment,v_granular,v_future,v_active_lease) and processing_attempt_count<>0) then
    raise exception 'INELIGIBLE_EVENT_CLAIMED';
  end if;
  if exists(select 1 from public.billing_webhook_events where id=any(v_claimed) and (processing_attempt_count<>1 or last_processing_outcome<>'claimed' or processing_claim_token is null or processing_lease_until<>'2026-07-29T10:05:00Z')) then
    raise exception 'CLAIM_METADATA_INVALID';
  end if;
  if (select count(distinct processing_claim_token) from public.billing_webhook_events where id=any(v_claimed))<>2 then
    raise exception 'CLAIM_TOKENS_NOT_UNIQUE';
  end if;

  update public.billing_webhook_events set processing_status='processed' where id=v_created;
  select webhook_event_id into v_token from public.claim_pending_billing_webhook_events_v1(1,'2026-07-29T10:00:01Z','5 minutes') where webhook_event_id=v_updated;
  if v_token is null then raise exception 'UPDATED_NOT_UNBLOCKED_AFTER_CREATED'; end if;
end;
$$;

do $$
declare
  v_event uuid;
  v_token uuid;
  v_outcome text;
  v_expected interval[] := array[interval '1 minute',interval '5 minutes',interval '15 minutes',interval '1 hour',interval '6 hours',interval '24 hours'];
  i integer;
begin
  v_event := pg_temp.make_retry_event('subscription_updated');
  for i in 1..6 loop
    v_token := gen_random_uuid();
    update public.billing_webhook_events set processing_status='received',processing_attempt_count=i,processing_claim_token=v_token,processing_lease_until='2026-07-29T10:05:00Z',next_processing_attempt_at=null where id=v_event;
    select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_token,case when i%2=0 then 'dependency_pending' else 'transient_error' end,'2026-07-29T10:00:00Z');
    if v_outcome<>'retry_scheduled' or (select next_processing_attempt_at-'2026-07-29T10:00:00Z'::timestamptz from public.billing_webhook_events where id=v_event)<>v_expected[i] then
      raise exception 'BACKOFF_INVALID_ATTEMPT_%',i;
    end if;
  end loop;

  v_token := gen_random_uuid();
  update public.billing_webhook_events set processing_status='received',processing_attempt_count=7,processing_claim_token=v_token,processing_lease_until='2026-07-29T10:05:00Z' where id=v_event;
  select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_token,'transient_error','2026-07-29T10:00:00Z');
  if v_outcome<>'retry_exhausted' or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='manual_review' and error_code='processor_retry_exhausted' and last_processing_outcome='retry_exhausted') then
    raise exception 'SEVENTH_ATTEMPT_NOT_EXHAUSTED';
  end if;
end;
$$;

do $$
declare
  v_event uuid;
  v_token uuid;
  v_other uuid := gen_random_uuid();
  v_outcome text;
begin
  v_event := pg_temp.make_retry_event('subscription_created');
  v_token := gen_random_uuid();
  update public.billing_webhook_events set processing_claim_token=v_token,processing_lease_until='2026-07-29T10:05:00Z' where id=v_event;
  select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_other,'transient_error','2026-07-29T10:00:00Z');
  if v_outcome<>'claim_lost' or (select processing_claim_token from public.billing_webhook_events where id=v_event)<>v_token then raise exception 'CLAIM_MISMATCH_MUTATED'; end if;

  select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_token,'unknown_outcome','2026-07-29T10:00:00Z');
  if v_outcome<>'manual_review' or not exists(select 1 from public.billing_webhook_events where id=v_event and error_code='processor_worker_outcome_unknown') then raise exception 'UNKNOWN_OUTCOME_INVALID'; end if;

  v_event := pg_temp.make_retry_event('subscription_created'); v_token:=gen_random_uuid();
  update public.billing_webhook_events set processing_claim_token=v_token,processing_lease_until='2026-07-29T10:05:00Z' where id=v_event;
  select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_token,'processed','2026-07-29T10:00:00Z');
  if v_outcome<>'manual_review' or not exists(select 1 from public.billing_webhook_events where id=v_event and error_code='processor_worker_state_mismatch') then raise exception 'STATE_MISMATCH_INVALID'; end if;

  v_event := pg_temp.make_retry_event('subscription_created'); v_token:=gen_random_uuid();
  update public.billing_webhook_events set processing_status='processed',processed_at='2026-07-29T09:30:00Z',error_code=null,processing_claim_token=v_token,processing_lease_until='2026-07-29T10:05:00Z' where id=v_event;
  select outcome into v_outcome from public.finalize_billing_webhook_processing_attempt_v1(v_event,v_token,'transient_error','2026-07-29T10:00:00Z');
  if v_outcome<>'finalized_terminal' or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='processed' and processed_at='2026-07-29T09:30:00Z' and processing_claim_token is null) then raise exception 'DB_TERMINAL_PRIORITY_INVALID'; end if;
end;
$$;

do $$
declare
  v_exhausted uuid;
  v_scheduled_terminal uuid;
  v_active_terminal uuid;
  v_expired_terminal uuid;
  v_active_token uuid := gen_random_uuid();
begin
  v_exhausted:=pg_temp.make_retry_event('subscription_created');
  update public.billing_webhook_events set processing_attempt_count=7,processing_claim_token=gen_random_uuid(),processing_lease_until='2026-07-29T09:59:00Z' where id=v_exhausted;

  v_scheduled_terminal:=pg_temp.make_retry_event('subscription_created','processed');
  update public.billing_webhook_events
  set processed_at='2026-07-29T09:30:00Z',error_code=null,
      next_processing_attempt_at='2026-07-29T11:00:00Z'
  where id=v_scheduled_terminal;

  v_active_terminal:=pg_temp.make_retry_event('subscription_created','processed');
  update public.billing_webhook_events
  set processed_at='2026-07-29T09:31:00Z',processing_claim_token=v_active_token,
      processing_lease_until='2026-07-29T10:05:00Z'
  where id=v_active_terminal;

  v_expired_terminal:=pg_temp.make_retry_event('subscription_created','processed');
  update public.billing_webhook_events
  set processed_at='2026-07-29T09:32:00Z',processing_claim_token=gen_random_uuid(),
      processing_lease_until='2026-07-29T09:59:00Z'
  where id=v_expired_terminal;

  perform * from public.claim_pending_billing_webhook_events_v1(1,'2026-07-29T10:00:00Z','5 minutes');
  if not exists(select 1 from public.billing_webhook_events where id=v_exhausted and processing_status='manual_review' and error_code='processor_retry_exhausted') then raise exception 'CRASH_EXHAUSTION_CLEANUP_INVALID'; end if;
  if not exists(select 1 from public.billing_webhook_events where id=v_scheduled_terminal and processing_status='processed' and processed_at='2026-07-29T09:30:00Z' and error_code is null and next_processing_attempt_at is null and processing_attempt_count=0) then raise exception 'TERMINAL_SCHEDULE_CLEANUP_INVALID'; end if;
  if not exists(select 1 from public.billing_webhook_events where id=v_active_terminal and processing_status='processed' and processed_at='2026-07-29T09:31:00Z' and processing_claim_token=v_active_token and processing_lease_until='2026-07-29T10:05:00Z' and processing_attempt_count=0) then raise exception 'ACTIVE_TERMINAL_LEASE_INTERRUPTED'; end if;
  if not exists(select 1 from public.billing_webhook_events where id=v_expired_terminal and processing_status='processed' and processed_at='2026-07-29T09:32:00Z' and processing_claim_token is null and processing_lease_until is null and processing_attempt_count=0) then raise exception 'EXPIRED_TERMINAL_LEASE_CLEANUP_INVALID'; end if;
end;
$$;

rollback;
