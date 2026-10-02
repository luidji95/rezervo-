begin;

do $$
declare
  v_raw text := repeat('1', 64);
  v_semantic text := repeat('2', 64);
  v_resend_raw text := repeat('3', 64);
  v_ignored_raw text := repeat('4', 64);
  v_ignored_semantic text := repeat('5', 64);
  v_legacy_raw text := repeat('6', 64);
  v_guard_raw text := repeat('a', 64);
  v_event_id uuid;
  v_outcome text;
  v_status text;
  v_rejected boolean;
  v_plans_before text;
  v_subscriptions_before text;
  v_sessions_before text;
begin
  select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by p.id), '')) into v_plans_before from public.plans p;
  select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) into v_subscriptions_before from public.subscriptions s;
  select md5(coalesce(string_agg(row_to_json(c)::text, '|' order by c.id), '')) into v_sessions_before from public.billing_checkout_sessions c;

  if not (select relrowsecurity from pg_class where oid = 'public.billing_webhook_subscription_facts'::regclass) then
    raise exception 'FACTS_RLS_DISABLED';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='billing_webhook_subscription_facts') then
    raise exception 'FACTS_BROWSER_POLICY_EXISTS';
  end if;
  if has_table_privilege('anon','public.billing_webhook_subscription_facts','select,insert,update,delete')
     or has_table_privilege('authenticated','public.billing_webhook_subscription_facts','select,insert,update,delete') then
    raise exception 'FACTS_BROWSER_ACCESS_ALLOWED';
  end if;
  if not has_table_privilege('service_role','public.billing_webhook_subscription_facts','select')
     or has_table_privilege('service_role','public.billing_webhook_subscription_facts','insert,update,delete') then
    raise exception 'FACTS_SERVICE_ROLE_GRANTS_INVALID';
  end if;
  if has_function_privilege('anon', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute')
     or has_function_privilege('authenticated', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute')
     or not has_function_privilege('service_role', 'public.ingest_billing_webhook_event_v1(text,text,text,text,text,text,text,text,timestamptz,boolean,uuid,uuid,text,uuid,text,text,text,text,text,text,timestamptz,timestamptz,boolean,text,text)', 'execute') then
    raise exception 'INGEST_RPC_GRANTS_INVALID';
  end if;

  v_rejected := false;
  begin
    perform * from public.ingest_billing_webhook_event_v1(
      'lemonsqueezy','test','subscription_created','subscriptions','guard-no-facts',
      v_guard_raw,repeat('b',64),'received',null,false,
      null,null,null,null,null,null,null,null,null,null,null,null,true,null,null
    );
  exception when check_violation then v_rejected := true; end;
  if not v_rejected or exists(select 1 from public.billing_webhook_events where payload_hash=v_guard_raw) then
    raise exception 'RECEIVED_WITHOUT_FACTS_ALLOWED';
  end if;

  v_rejected := false;
  begin
    perform * from public.ingest_billing_webhook_event_v1(
      'lemonsqueezy','test','order_created','orders','guard-ignored-facts',
      repeat('c',64),repeat('d',64),'ignored',now(),true,
      null,null,null,null,'subscription',null,null,null,null,'active',null,null,true,
      'legacy_missing_checkout_session',null
    );
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'IGNORED_WITH_FACTS_ALLOWED'; end if;

  v_rejected := false;
  begin
    perform * from public.ingest_billing_webhook_event_v1(
      'lemonsqueezy','test','subscription_created','subscriptions','guard-incomplete',
      repeat('e',64),repeat('f',64),'received',null,true,
      null,'10000000-0000-4000-8000-000000000002','pro',
      '10000000-0000-4000-8000-000000000003',null,null,null,null,null,'active',null,null,true,
      'legacy_missing_checkout_session',null
    );
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'INCOMPLETE_FACTS_ALLOWED'; end if;

  select event_id, outcome, stored_status into v_event_id, v_outcome, v_status
  from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','subscription_created','subscriptions','2383060',
    v_raw,v_semantic,'received',null,true,
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002','pro',
    '10000000-0000-4000-8000-000000000003',
    '2383060','41001','51001','61001','71001','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null
  );
  if v_outcome <> 'inserted' or v_status <> 'received' then raise exception 'NEW_EVENT_RESULT_INVALID'; end if;
  if not exists (
    select 1 from public.billing_webhook_subscription_facts f
    where f.webhook_event_id=v_event_id and f.facts_schema_version=1
      and f.checkout_session_id='10000000-0000-4000-8000-000000000001'
      and f.custom_salon_id='10000000-0000-4000-8000-000000000002'
      and f.custom_plan_code='pro'
      and f.custom_idempotency_key='10000000-0000-4000-8000-000000000003'
      and f.provider_subscription_id='2383060' and f.provider_order_id='41001'
      and f.provider_customer_id='51001' and f.provider_product_id='61001'
      and f.provider_variant_id='71001' and f.provider_status='active'
      and f.test_mode and f.correlation_status='ready' and f.correlation_error_code is null
  ) then raise exception 'NORMALIZED_FACTS_INVALID'; end if;

  select event_id, outcome, stored_status into v_event_id, v_outcome, v_status
  from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','subscription_created','subscriptions','legacy-valid',
    repeat('0',64),repeat('a',64),'received',null,true,
    null,'10000000-0000-4000-8000-000000000002','pro',
    '10000000-0000-4000-8000-000000000003',
    'legacy-valid','41002','51002','61002','71002','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,
    'legacy_missing_checkout_session',null
  );
  if not exists (
    select 1 from public.billing_webhook_subscription_facts
    where webhook_event_id=v_event_id and checkout_session_id is null
      and custom_salon_id is not null and custom_plan_code='pro'
      and custom_idempotency_key is not null
      and correlation_status='legacy_missing_checkout_session'
      and correlation_error_code is null
  ) then raise exception 'VALID_LEGACY_FACTS_REJECTED'; end if;

  perform * from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','subscription_created','subscriptions','legacy-invalid-custom',
    repeat('b',64),repeat('c',64),'received',null,true,
    null,null,'pro','10000000-0000-4000-8000-000000000003',
    'legacy-invalid-custom','41003','51003','61003','71003','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,
    'invalid_custom_data','custom_salon_id_invalid'
  );
  if not exists (
    select 1 from public.billing_webhook_subscription_facts
    where provider_subscription_id='legacy-invalid-custom'
      and correlation_status='invalid_custom_data'
      and correlation_error_code='custom_salon_id_invalid'
  ) then raise exception 'INVALID_LEGACY_CUSTOM_NOT_RECORDED'; end if;

  for v_status in select unnest(array['', 'UNSANITIZED ERROR']) loop
    v_rejected := false;
    begin
      perform * from public.ingest_billing_webhook_event_v1(
        'lemonsqueezy','test','subscription_created','subscriptions',concat('bad-error-',length(v_status)),
        encode(digest(concat('bad-error-',v_status),'sha256'),'hex'),
        encode(digest(concat('bad-semantic-',v_status),'sha256'),'hex'),'received',null,true,
        null,null,'pro','10000000-0000-4000-8000-000000000003',
        concat('bad-error-',length(v_status)),null,null,null,null,'active',null,null,true,
        'invalid_custom_data',v_status
      );
    exception when check_violation then v_rejected := true; end;
    if not v_rejected then raise exception 'UNSANITIZED_ERROR_CODE_ALLOWED'; end if;
  end loop;

  select event_id, outcome, stored_status into v_event_id, v_outcome, v_status
  from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','subscription_created','subscriptions','2383060',
    v_resend_raw,v_semantic,'received',null,true,
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002','pro',
    '10000000-0000-4000-8000-000000000003',
    '2383060','41001','51001','61001','71001','active',
    '2026-07-28T10:00:00Z','2026-07-28T10:01:00Z',true,'ready',null
  );
  if v_outcome <> 'duplicate' then raise exception 'SEMANTIC_RESEND_NOT_DUPLICATE'; end if;
  if (select count(*) from public.billing_webhook_events where semantic_fingerprint=v_semantic) <> 1
     or (select count(*) from public.billing_webhook_subscription_facts f join public.billing_webhook_events e on e.id=f.webhook_event_id where e.semantic_fingerprint=v_semantic) <> 1 then
    raise exception 'DUPLICATE_CREATED_EXTRA_ROWS';
  end if;

  perform * from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','order_created','orders','order-1',
    v_ignored_raw,v_ignored_semantic,'ignored',now(),false,
    null,null,null,null,null,null,null,null,null,null,null,null,true,null,null
  );
  if exists (
    select 1 from public.billing_webhook_subscription_facts f
    join public.billing_webhook_events e on e.id=f.webhook_event_id
    where e.semantic_fingerprint=v_ignored_semantic
  ) then raise exception 'IGNORED_EVENT_HAS_FACTS'; end if;

  insert into public.billing_webhook_events(
    provider,environment,event_name,provider_object_type,provider_object_id,
    payload_hash,semantic_fingerprint,processing_status
  ) values ('lemonsqueezy','test','subscription_created','subscriptions','legacy',v_legacy_raw,null,'received');
  select outcome into v_outcome from public.ingest_billing_webhook_event_v1(
    'lemonsqueezy','test','subscription_created','subscriptions','legacy',
    v_legacy_raw,repeat('7',64),'received',null,true,
    null,null,null,null,'legacy',null,null,null,null,'active',null,null,true,
    'legacy_missing_checkout_session',null
  );
  if v_outcome <> 'duplicate' then raise exception 'PRE_021_EVENT_NOT_DUPLICATE'; end if;
  if exists (
    select 1 from public.billing_webhook_subscription_facts f
    join public.billing_webhook_events e on e.id=f.webhook_event_id
    where e.payload_hash=v_legacy_raw
  ) then raise exception 'PRE_021_EVENT_WAS_BACKFILLED'; end if;

  v_rejected := false;
  begin
    perform * from public.ingest_billing_webhook_event_v1(
      'lemonsqueezy','test','subscription_created','subscriptions','mismatch',
      repeat('8',64),repeat('9',64),'received',null,true,
      null,null,null,null,'mismatch',null,null,null,null,'active',null,null,false,
      'legacy_missing_checkout_session','CHECKOUT_SESSION_ID_MISSING'
    );
  exception when check_violation then v_rejected := true; end;
  if not v_rejected then raise exception 'TEST_LIVE_MISMATCH_ALLOWED'; end if;

  if v_plans_before <> (select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by p.id), '')) from public.plans p)
     or v_subscriptions_before <> (select md5(coalesce(string_agg(row_to_json(s)::text, '|' order by s.id), '')) from public.subscriptions s)
     or v_sessions_before <> (select md5(coalesce(string_agg(row_to_json(c)::text, '|' order by c.id), '')) from public.billing_checkout_sessions c) then
    raise exception 'PROTECTED_BILLING_STATE_CHANGED';
  end if;
end;
$$;

rollback;
