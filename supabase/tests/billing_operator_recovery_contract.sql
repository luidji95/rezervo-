\set ON_ERROR_STOP on
begin;

-- ---------------------------------------------------------------- fixtures
create function pg_temp.mk_linked(p_label text, p_env text default 'test')
returns table(owner_id uuid, salon_id uuid, subscription_id uuid, pid text, customer text)
language plpgsql
as $$
begin
  owner_id := gen_random_uuid();
  salon_id := gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
  values(owner_id,owner_id||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug)
  values(salon_id,owner_id,p_label,p_label||'-'||substr(salon_id::text,1,8));
  select s.id into subscription_id from public.subscriptions s where s.salon_id=mk_linked.salon_id;
  pid := 'sub-'||p_label;
  customer := 'customer-'||p_label;
  update public.subscriptions set
    plan_id=(select id from public.plans where slug='starter'),status='active',
    billing_provider='lemonsqueezy',billing_environment=p_env,
    provider_customer_id=customer,provider_subscription_id=pid,
    current_period_starts_at='2026-07-01T00:00:00Z',
    current_period_ends_at='2026-09-01T00:00:00Z',
    provider_state_updated_at='2026-07-01T00:01:00Z',
    cancel_at_period_end=false,cancelled_at=null
  where id=subscription_id;
  return next;
end;
$$;

create function pg_temp.ingest_upd(
  p_env text, p_pid text, p_customer text, p_suffix text, p_status text,
  p_updated timestamptz, p_renews timestamptz, p_ends timestamptz, p_cancelled boolean,
  p_store text default null, p_product text default null, p_variant text default null,
  p_trial timestamptz default null, p_pause text default null
) returns uuid
language plpgsql
as $$
declare v_id uuid;
begin
  select event_id into v_id
  from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy',p_env,'subscription_updated','subscriptions',p_pid,
    encode(digest('event-'||p_suffix,'sha256'),'hex'),
    encode(digest('semantic-'||p_suffix,'sha256'),'hex'),
    'received',null,true,gen_random_uuid(),gen_random_uuid(),'starter',gen_random_uuid(),
    p_pid,'order-'||p_suffix,p_customer,
    coalesce(p_product,'product-'||p_env||'-v2'),coalesce(p_variant,'variant-'||p_env||'-v2'),
    p_status,'2026-07-01T00:00:00Z',p_updated,(p_env='test'),'ready',null,
    coalesce(p_store,'store-'||p_env||'-v2'),p_renews,p_ends,p_cancelled,p_trial,p_pause,null
  );
  return v_id;
end;
$$;

create function pg_temp.snap(
  p_pid text, p_customer text, p_status text, p_cancelled boolean,
  p_renews timestamptz, p_ends timestamptz, p_updated timestamptz, p_over jsonb default '{}'
) returns jsonb
language sql
as $$
  select jsonb_build_object(
    'env','test','pid',p_pid,'customer',p_customer,'store','store-test-v2','test_mode',true,
    'product','product-test-v2','variant','variant-test-v2','status',p_status,'cancelled',p_cancelled,
    'pause_mode',null,'pause_resumes',null,'trial_ends',null,'renews',p_renews,'ends',p_ends,
    'created','2026-07-01T00:00:00Z'::timestamptz,'updated',p_updated) || p_over;
$$;

create function pg_temp.plan(p_sub uuid, s jsonb, p_now timestamptz)
returns jsonb
language sql
as $$
  select to_jsonb(r) from public.plan_billing_subscription_recovery_v1(
    s->>'env',p_sub,s->>'pid',s->>'customer',s->>'store',(s->>'test_mode')::boolean,
    s->>'product',s->>'variant',s->>'status',(s->>'cancelled')::boolean,
    s->>'pause_mode',(s->>'pause_resumes')::timestamptz,(s->>'trial_ends')::timestamptz,
    (s->>'renews')::timestamptz,(s->>'ends')::timestamptz,(s->>'created')::timestamptz,
    (s->>'updated')::timestamptz,p_now) r;
$$;

create function pg_temp.apply(p_sub uuid, s jsonb, p_token text, p_now timestamptz,
  p_ticket text default 'OPS-100', p_reason text default 'operator recovery contract test',
  p_operator text default 'tester@example.invalid')
returns jsonb
language sql
as $$
  select to_jsonb(r) from public.apply_billing_subscription_recovery_v1(
    s->>'env',p_sub,s->>'pid',s->>'customer',s->>'store',(s->>'test_mode')::boolean,
    s->>'product',s->>'variant',s->>'status',(s->>'cancelled')::boolean,
    s->>'pause_mode',(s->>'pause_resumes')::timestamptz,(s->>'trial_ends')::timestamptz,
    (s->>'renews')::timestamptz,(s->>'ends')::timestamptz,(s->>'created')::timestamptz,
    (s->>'updated')::timestamptz,p_token,p_ticket,p_reason,p_operator,p_now) r;
$$;

create function pg_temp.sub_state(p_id uuid) returns jsonb
language sql as $$
  select jsonb_build_object('status',status,'end',current_period_ends_at,'cancel',cancel_at_period_end,
    'cancelled_at',cancelled_at,'pstu',provider_state_updated_at,'updated_at',updated_at,
    'plan',plan_id,'customer',provider_customer_id,'pid',provider_subscription_id,'env',billing_environment)
  from public.subscriptions where id=p_id;
$$;

-- Independent translation of what the updated processor actually did into the recovery verdict it must match.
create function pg_temp.expected_recovery(p_outcome text, p_error text) returns text
language sql as $$
  select case
    when p_outcome='processed' then 'applied'
    when p_outcome='stale_ignored' then 'stale_snapshot'
    when p_outcome='already_applied' then 'no_change'
    when p_error='processor_updated_provider_ownership_conflict' then 'identity_conflict'
    when p_error='processor_updated_plan_change_unsupported' then 'plan_change_unsupported'
    when p_error='processor_updated_provider_mapping_invalid' then 'mapping_conflict'
    when p_error='processor_updated_same_timestamp_conflict' then 'same_timestamp_conflict'
    when p_error in ('processor_updated_provider_state_unsupported','processor_updated_pause_unsupported',
      'processor_updated_provider_trial_unsupported','processor_updated_expired_reactivation_unsupported') then 'unsupported_state'
    else 'unmapped:'||coalesce(p_error,p_outcome) end;
$$;

create function pg_temp.set_local(p_id uuid, p_local text) returns void
language plpgsql as $$
begin
  if p_local='past_due' then
    update public.subscriptions set status='past_due',provider_state_updated_at='2026-07-15T00:00:00Z' where id=p_id;
  elsif p_local='cancelled' then
    update public.subscriptions set status='cancelled',cancel_at_period_end=true,cancelled_at='2026-07-20T00:00:00Z',
      current_period_ends_at='2026-09-15T00:00:00Z',provider_state_updated_at='2026-07-15T00:00:00Z' where id=p_id;
  elsif p_local='expired' then
    update public.subscriptions set status='expired',current_period_ends_at='2026-08-01T00:00:00Z',
      provider_state_updated_at='2026-07-15T00:00:00Z' where id=p_id;
  end if;
end;
$$;

create function pg_temp.audit_count() returns bigint language sql as $$
  select count(*) from public.billing_recovery_attempts;
$$;

-- ---------------------------------------------------------------- shape / ACL / immutability
do $$
declare v_fn text;
begin
  foreach v_fn in array array[
    'public.plan_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)',
    'public.apply_billing_subscription_recovery_v1(text,uuid,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,text,text,text,timestamptz)',
    'public.plan_billing_event_reprocess_v1(text,uuid,timestamptz)',
    'public.apply_billing_event_reprocess_v1(text,uuid,text,text,text,text,timestamptz)'
  ] loop
    if has_function_privilege('anon',v_fn,'execute')
       or has_function_privilege('authenticated',v_fn,'execute')
       or not has_function_privilege('service_role',v_fn,'execute')
       or exists(select 1 from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
                 where p.oid=v_fn::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE')
       or not (select prosecdef from pg_proc where oid=v_fn::regprocedure)
       or (select proconfig from pg_proc where oid=v_fn::regprocedure) is distinct from array['search_path=""']
    then raise exception 'RECOVERY_FUNCTION_ACL_INVALID %',v_fn; end if;
  end loop;
  if has_table_privilege('service_role','public.billing_recovery_attempts','insert')
     or has_table_privilege('service_role','public.billing_recovery_attempts','update')
     or has_table_privilege('service_role','public.billing_recovery_attempts','delete')
     or not has_table_privilege('service_role','public.billing_recovery_attempts','select')
     or has_table_privilege('authenticated','public.billing_recovery_attempts','select')
     or has_table_privilege('anon','public.billing_recovery_attempts','select') then
    raise exception 'RECOVERY_AUDIT_TABLE_ACL_INVALID';
  end if;
  if has_function_privilege('service_role','private.billing_sha256_v1(jsonb)','execute') then
    raise exception 'RECOVERY_PRIVATE_HELPER_EXPOSED';
  end if;
end;
$$;

-- ---------------------------------------------------------------- exposed roles are actually refused
do $$
declare v_role text;
begin
  foreach v_role in array array['anon','authenticated'] loop
    execute format('set local role %I',v_role);
    begin
      perform * from public.plan_billing_event_reprocess_v1('test',gen_random_uuid());
      reset role; raise exception 'ROLE_% CAN_PLAN_EVENT',v_role;
    exception when insufficient_privilege then reset role; end;
    execute format('set local role %I',v_role);
    begin
      perform * from public.apply_billing_event_reprocess_v1('test',gen_random_uuid(),repeat('a',64),'OPS-1','role access attempt','role');
      reset role; raise exception 'ROLE_% CAN_APPLY_EVENT',v_role;
    exception when insufficient_privilege then reset role; end;
    execute format('set local role %I',v_role);
    begin
      perform * from public.apply_billing_subscription_recovery_v1('test',gen_random_uuid(),'a','b','c',true,'d','e','active',false,null,null,null,null,null,now(),now(),repeat('a',64),'OPS-1','role access attempt','role');
      reset role; raise exception 'ROLE_% CAN_APPLY_SNAPSHOT',v_role;
    exception when insufficient_privilege then reset role; end;
    execute format('set local role %I',v_role);
    begin
      perform * from public.billing_recovery_attempts;
      reset role; raise exception 'ROLE_% CAN_READ_AUDIT',v_role;
    exception when insufficient_privilege then reset role; end;
    execute format('set local role %I',v_role);
    begin
      delete from public.billing_recovery_attempts;
      reset role; raise exception 'ROLE_% CAN_DELETE_AUDIT',v_role;
    exception when insufficient_privilege then reset role; end;
  end loop;
  -- service_role may read but not write the audit table directly
  set local role service_role;
  begin
    insert into public.billing_recovery_attempts(recovery_kind,environment,webhook_event_id,evidence_source,prior_state,ticket_ref,reason,operator_label,outcome,review_token)
    values('event_reprocess','test',gen_random_uuid(),'existing_webhook_event','{}','OPS-1','forged audit row','forger','applied',repeat('a',64));
    reset role; raise exception 'SERVICE_ROLE_CAN_FORGE_AUDIT';
  exception when insufficient_privilege then reset role; end;
end;
$$;

-- ---------------------------------------------------------------- catalogue + runtime authority
do $$
declare v_starter uuid; v_pro uuid;
begin
  select id into v_starter from public.plans where slug='starter';
  select id into v_pro from public.plans where slug='pro';
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active)
  select v_starter,'lemonsqueezy',e.environment,'monthly',p.currency,p.monthly_price,
    'product-'||e.environment||'-v2','variant-'||e.environment||'-v2','store-'||e.environment||'-v2',true
  from public.plans p cross join (values('test'::text),('live'::text)) e(environment) where p.id=v_starter
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set
    provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=true;
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,
    provider_product_id,provider_variant_id,provider_store_id,is_active)
  select v_pro,'lemonsqueezy','test','monthly',currency,monthly_price,'product-pro-v2','variant-pro-v2','store-test-v2',false
  from public.plans where id=v_pro
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set
    provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,
    provider_store_id=excluded.provider_store_id,is_active=false;
  insert into private.billing_runtime_config(singleton,environment) values(true,'test')
  on conflict(singleton) do update set environment='test';
end;
$$;

-- ---------------------------------------------------------------- A. snapshot recovery lifecycle
do $$
declare
  v_a record; v_plan jsonb; v_res jsonb; v_s jsonb; v_before jsonb; v_audit bigint;
  v_now constant timestamptz := '2026-08-11T00:00:00Z';
begin
  select * into v_a from pg_temp.mk_linked('snap');

  -- past_due -> active
  update public.subscriptions set status='past_due',provider_state_updated_at='2026-08-05T00:00:00Z'
  where id=v_a.subscription_id;
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-10T00:00:00Z',null,'2026-08-10T00:00:00Z');
  v_before := pg_temp.sub_state(v_a.subscription_id); v_audit := pg_temp.audit_count();
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  if v_plan->>'verdict'<>'eligible' or v_plan->>'proposed_status'<>'active' or v_plan->>'local_status'<>'past_due'
     or v_plan->>'review_token' !~ '^[0-9a-f]{64}$' then raise exception 'DRYRUN_PAST_DUE_ACTIVE_FAILED %',v_plan; end if;
  if pg_temp.sub_state(v_a.subscription_id) is distinct from v_before or pg_temp.audit_count()<>v_audit then
    raise exception 'DRYRUN_MUTATED'; end if;
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'applied' or v_res->>'audit_id' is null then raise exception 'APPLY_PAST_DUE_ACTIVE_FAILED %',v_res; end if;
  if not exists(select 1 from public.subscriptions where id=v_a.subscription_id and status='active'
      and current_period_ends_at='2026-09-10T00:00:00Z' and cancel_at_period_end=false and cancelled_at is null
      and provider_state_updated_at='2026-08-10T00:00:00Z' and current_period_starts_at='2026-07-01T00:00:00Z'
      and plan_id=(select id from public.plans where slug='starter')) then raise exception 'APPLIED_STATE_WRONG'; end if;
  if not exists(select 1 from public.billing_recovery_attempts where id=(v_res->>'audit_id')::uuid
      and recovery_kind='subscription_snapshot' and evidence_source='operator_provider_snapshot'
      and environment='test' and subscription_id=v_a.subscription_id and outcome='applied'
      and ticket_ref='OPS-100' and operator_label='tester@example.invalid'
      and prior_state->>'status'='past_due' and applied_state->>'status'='active'
      and evidence_fingerprint ~ '^[0-9a-f]{64}$' and webhook_event_id is null) then raise exception 'AUDIT_ROW_WRONG'; end if;
  if exists(select 1 from public.billing_webhook_events e where e.provider_object_id=v_a.pid) then
    raise exception 'SNAPSHOT_MUST_NOT_CREATE_WEBHOOK_EVENT'; end if;
  -- repeat: no duplicate effect
  v_before := pg_temp.sub_state(v_a.subscription_id);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'no_change' or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
    raise exception 'REPEAT_APPLY_NOT_IDEMPOTENT %',v_res; end if;
  if (pg_temp.plan(v_a.subscription_id,v_s,v_now))->>'verdict'<>'no_change' then raise exception 'PLAN_AFTER_APPLY_NOT_NO_CHANGE'; end if;

  -- active -> cancelled
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'cancelled',true,'2026-09-10T00:00:00Z','2026-09-20T00:00:00Z','2026-08-12T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'applied' or not exists(select 1 from public.subscriptions where id=v_a.subscription_id
      and status='cancelled' and cancel_at_period_end and current_period_ends_at='2026-09-20T00:00:00Z'
      and cancelled_at='2026-08-12T00:00:00Z') then raise exception 'ACTIVE_TO_CANCELLED_FAILED %',v_res; end if;

  -- cancelled -> active (resume)
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-25T00:00:00Z',null,'2026-08-13T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'applied' or not exists(select 1 from public.subscriptions where id=v_a.subscription_id
      and status='active' and not cancel_at_period_end and cancelled_at is null
      and current_period_ends_at='2026-09-25T00:00:00Z') then raise exception 'CANCELLED_TO_ACTIVE_FAILED %',v_res; end if;

  -- older snapshot never overwrites newer local state
  v_before := pg_temp.sub_state(v_a.subscription_id); v_audit := pg_temp.audit_count();
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'past_due',false,null,null,'2026-08-01T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,coalesce(v_plan->>'review_token',repeat('0',64)),v_now);
  if v_plan->>'verdict'<>'stale_snapshot' or v_res->>'outcome'<>'stale_snapshot'
     or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then raise exception 'OLDER_SNAPSHOT_APPLIED %',v_res; end if;
  if pg_temp.audit_count()<>v_audit+1 then raise exception 'REJECTED_APPLY_NOT_AUDITED'; end if;

  -- same timestamp, conflicting content
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'past_due',false,null,null,'2026-08-13T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_plan->>'verdict'<>'same_timestamp_conflict' or v_res->>'outcome'<>'same_timestamp_conflict'
     or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then raise exception 'SAME_TS_CONFLICT_ACCEPTED %',v_res; end if;
end;
$$;

-- ---------------------------------------------------------------- B. review-token drift + concurrent webhook ordering
do $$
declare
  v_a record; v_plan jsonb; v_res jsonb; v_s jsonb; v_event uuid; v_out text; v_before jsonb;
  v_now constant timestamptz := '2026-08-11T00:00:00Z';
begin
  select * into v_a from pg_temp.mk_linked('drift');
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-30T00:00:00Z',null,'2026-08-10T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  if v_plan->>'verdict'<>'eligible' then raise exception 'DRIFT_SETUP_FAILED %',v_plan; end if;
  -- a webhook lands between dry-run and apply
  v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'drift-hook','past_due','2026-08-05T00:00:00Z',null,null,false);
  select outcome into v_out from public.process_billing_subscription_updated_v2(v_event,v_now);
  if v_out<>'processed' then raise exception 'DRIFT_WEBHOOK_FAILED %',v_out; end if;
  v_before := pg_temp.sub_state(v_a.subscription_id);
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'stale' or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
    raise exception 'CHANGED_STATE_BETWEEN_DRYRUN_AND_APPLY_NOT_REJECTED %',v_res; end if;
  -- a changed provider snapshot cannot reuse an old review token either
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,v_now);
  v_res := pg_temp.apply(v_a.subscription_id,v_s||'{"renews":"2026-10-30T00:00:00Z"}'::jsonb,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'stale' then raise exception 'CHANGED_EVIDENCE_NOT_REJECTED %',v_res; end if;
  -- apply reviewed snapshot, then an older webhook must not overwrite it and a newer one must still apply
  v_res := pg_temp.apply(v_a.subscription_id,v_s,v_plan->>'review_token',v_now);
  if v_res->>'outcome'<>'applied' then raise exception 'REVIEWED_APPLY_FAILED %',v_res; end if;
  v_before := pg_temp.sub_state(v_a.subscription_id);
  v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'drift-old','past_due','2026-08-06T00:00:00Z',null,null,false);
  select outcome into v_out from public.process_billing_subscription_updated_v2(v_event,v_now);
  if v_out<>'stale_ignored' or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
    raise exception 'OLDER_WEBHOOK_OVERWROTE_RECOVERY %',v_out; end if;
  v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'drift-new','past_due','2026-08-20T00:00:00Z',null,null,false);
  select outcome into v_out from public.process_billing_subscription_updated_v2(v_event,'2026-08-21T00:00:00Z');
  if v_out<>'processed' or not exists(select 1 from public.subscriptions where id=v_a.subscription_id and status='past_due'
     and provider_state_updated_at='2026-08-20T00:00:00Z') then raise exception 'NEWER_WEBHOOK_BLOCKED_BY_RECOVERY %',v_out; end if;
  -- the same snapshot as a later webhook with identical content is already_applied (ordering rules are shared)
end;
$$;

-- ---------------------------------------------------------------- C. identity / environment / mapping / unsupported
do $$
declare
  v_a record; v_live record; v_s jsonb; v_plan jsonb; v_res jsonb; v_before jsonb; v_audit bigint; v_case jsonb;
  v_now constant timestamptz := '2026-08-11T00:00:00Z';
begin
  select * into v_a from pg_temp.mk_linked('ident');
  select * into v_live from pg_temp.mk_linked('identlive','live');
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-10T00:00:00Z',null,'2026-08-10T00:00:00Z');
  v_before := pg_temp.sub_state(v_a.subscription_id); v_audit := pg_temp.audit_count();

  for v_case in select * from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('name','customer','over',jsonb_build_object('customer','customer-other'),'verdict','identity_conflict'),
    jsonb_build_object('name','subscription id','over',jsonb_build_object('pid','sub-other'),'verdict','identity_conflict'),
    jsonb_build_object('name','test_mode false in test','over',jsonb_build_object('test_mode',false),'verdict','identity_conflict'),
    jsonb_build_object('name','store','over',jsonb_build_object('store','store-live-v2'),'verdict','mapping_conflict'),
    jsonb_build_object('name','unknown variant','over',jsonb_build_object('variant','variant-unknown'),'verdict','mapping_conflict'),
    jsonb_build_object('name','plan change','over',jsonb_build_object('product','product-pro-v2','variant','variant-pro-v2'),'verdict','plan_change_unsupported'),
    jsonb_build_object('name','pause','over',jsonb_build_object('pause_mode','free'),'verdict','unsupported_state'),
    jsonb_build_object('name','on_trial','over',jsonb_build_object('status','on_trial'),'verdict','unsupported_state'),
    jsonb_build_object('name','trial_ends','over',jsonb_build_object('trial_ends','2026-09-01T00:00:00Z'),'verdict','unsupported_state'),
    jsonb_build_object('name','invalid timestamps','over',jsonb_build_object('created','2026-08-12T00:00:00Z'),'verdict','snapshot_invalid')
  )) loop
    v_plan := pg_temp.plan(v_a.subscription_id,v_s||(v_case->'over'),v_now);
    v_res := pg_temp.apply(v_a.subscription_id,v_s||(v_case->'over'),coalesce(v_plan->>'review_token',repeat('0',64)),v_now);
    if v_plan->>'verdict'<>v_case->>'verdict' or v_res->>'outcome'<>v_case->>'verdict' then
      raise exception 'REJECTION_CASE_FAILED % plan=% apply=%',v_case->>'name',v_plan,v_res; end if;
    if pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
      raise exception 'REJECTED_CASE_MUTATED %',v_case->>'name'; end if;
  end loop;
  if pg_temp.audit_count()<>v_audit+10 then raise exception 'REJECTIONS_NOT_AUDITED'; end if;

  -- a live subscription is never touched by a test-environment request
  v_before := pg_temp.sub_state(v_live.subscription_id);
  v_s := pg_temp.snap(v_live.pid,v_live.customer,'active',false,'2026-09-10T00:00:00Z',null,'2026-08-10T00:00:00Z');
  v_plan := pg_temp.plan(v_live.subscription_id,v_s,v_now);
  if v_plan->>'verdict'<>'identity_conflict' then raise exception 'CROSS_ENVIRONMENT_NOT_REJECTED %',v_plan; end if;
  -- unknown subscription
  if (pg_temp.plan(gen_random_uuid(),v_s,v_now))->>'verdict'<>'not_found' then raise exception 'UNKNOWN_SUBSCRIPTION_NOT_REJECTED'; end if;
  -- DB/server environment parity failure stops everything, with no audit row
  update private.billing_runtime_config set environment='live';
  v_audit := pg_temp.audit_count();
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-10T00:00:00Z',null,'2026-08-10T00:00:00Z');
  if (pg_temp.plan(v_a.subscription_id,v_s,v_now))->>'verdict'<>'environment_mismatch'
     or (pg_temp.apply(v_a.subscription_id,v_s,repeat('a',64),v_now))->>'outcome'<>'environment_mismatch'
     or pg_temp.audit_count()<>v_audit then raise exception 'ENVIRONMENT_PARITY_NOT_ENFORCED'; end if;
  update private.billing_runtime_config set environment='test';
  -- missing reason / ticket / operator are rejected as input errors
  begin
    perform pg_temp.apply(v_a.subscription_id,v_s,repeat('a',64),v_now,'bad ticket!');
    raise exception 'TICKET_NOT_ENFORCED';
  exception when sqlstate '22023' then null; end;
  begin
    perform pg_temp.apply(v_a.subscription_id,v_s,repeat('a',64),v_now,'OPS-1','short');
    raise exception 'REASON_NOT_ENFORCED';
  exception when sqlstate '22023' then null; end;
  begin
    perform pg_temp.apply(v_a.subscription_id,v_s,repeat('a',64),v_now,'OPS-1','long enough reason','bad operator!');
    raise exception 'OPERATOR_NOT_ENFORCED';
  exception when sqlstate '22023' then null; end;
  -- audit rows are immutable
  begin
    update public.billing_recovery_attempts set reason='tampered tampered';
    raise exception 'AUDIT_UPDATE_ALLOWED';
  exception when sqlstate '0A000' then null; end;
  begin
    delete from public.billing_recovery_attempts;
    raise exception 'AUDIT_DELETE_ALLOWED';
  exception when sqlstate '0A000' then null; end;
end;
$$;

-- ---------------------------------------------------------------- D. expired subscriptions are never reactivated
do $$
declare v_a record; v_s jsonb; v_plan jsonb; v_before jsonb;
begin
  select * into v_a from pg_temp.mk_linked('expired');
  update public.subscriptions set status='expired',provider_state_updated_at='2026-08-05T00:00:00Z' where id=v_a.subscription_id;
  v_before := pg_temp.sub_state(v_a.subscription_id);
  v_s := pg_temp.snap(v_a.pid,v_a.customer,'active',false,'2026-09-10T00:00:00Z',null,'2026-08-10T00:00:00Z');
  v_plan := pg_temp.plan(v_a.subscription_id,v_s,'2026-08-11T00:00:00Z');
  if v_plan->>'verdict'<>'unsupported_state' or v_plan->>'error_code'<>'recovery_expired_reactivation_unsupported'
     or (pg_temp.apply(v_a.subscription_id,v_s,coalesce(v_plan->>'review_token',repeat('0',64)),'2026-08-11T00:00:00Z'))->>'outcome'<>'unsupported_state'
     or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then raise exception 'EXPIRED_REACTIVATED'; end if;
end;
$$;

-- ---------------------------------------------------------------- E. parity with process_billing_subscription_updated_v2
do $$
declare
  v_case jsonb; v_i integer := 0; v_a record; v_b record; v_event uuid; v_proc text; v_perr text;
  v_s jsonb; v_plan jsonb; v_res jsonb; v_rec text;
  v_now constant timestamptz := '2026-08-11T00:00:00Z';
begin
  for v_case in select * from jsonb_array_elements('[
    {"n":"active","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"cancelled","status":"cancelled","cancelled":true,"ends":"2026-09-20T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"past_due","status":"past_due","cancelled":false,"updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"unpaid","status":"unpaid","cancelled":false,"updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"expired","status":"expired","cancelled":false,"ends":"2026-08-09T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"expired future end","status":"expired","cancelled":false,"ends":"2026-08-20T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"active but cancelled","status":"active","cancelled":true,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"active renews past","status":"active","cancelled":false,"renews":"2026-08-01T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"active renews before period start","status":"active","cancelled":false,"renews":"2026-07-01T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"cancelled without end","status":"cancelled","cancelled":true,"updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"on_trial","status":"on_trial","cancelled":false,"updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"trial_ends","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","trial":"2026-09-01T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"pause","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","pause":"free","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"unknown status","status":"mystery","cancelled":false,"updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"stale","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-07-01T00:00:30Z","proc":"stale_ignored","rec":"stale_snapshot"},
    {"n":"same ts equal","status":"active","cancelled":false,"renews":"2026-09-01T00:00:00Z","updated":"2026-07-01T00:01:00Z","proc":"already_applied","rec":"no_change"},
    {"n":"same ts conflict","status":"past_due","cancelled":false,"updated":"2026-07-01T00:01:00Z","proc":"manual_review","rec":"same_timestamp_conflict"},
    {"n":"plan change","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","product":"product-pro-v2","variant":"variant-pro-v2","proc":"manual_review","rec":"plan_change_unsupported"},
    {"n":"unknown variant","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","variant":"variant-unknown","proc":"manual_review","rec":"mapping_conflict"},
    {"n":"wrong store","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","store":"store-live-v2","proc":"manual_review","rec":"mapping_conflict"},
    {"n":"past_due local to active","local":"past_due","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"cancelled local resumed","local":"cancelled","status":"active","cancelled":false,"renews":"2026-09-25T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"cancelled local to past_due","local":"cancelled","status":"past_due","cancelled":false,"updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"expired local, active snapshot","local":"expired","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"manual_review","rec":"unsupported_state"},
    {"n":"expired local, expired snapshot","local":"expired","status":"expired","cancelled":false,"ends":"2026-08-09T00:00:00Z","updated":"2026-08-10T00:00:00Z","proc":"processed","rec":"applied"},
    {"n":"wrong customer","status":"active","cancelled":false,"renews":"2026-09-10T00:00:00Z","updated":"2026-08-10T00:00:00Z","wrong_customer":true,"proc":"manual_review","rec":"identity_conflict"}
  ]'::jsonb) loop
    v_i := v_i + 1;
    select * into v_a from pg_temp.mk_linked('par'||v_i||'a');
    select * into v_b from pg_temp.mk_linked('par'||v_i||'b');
    if v_case ? 'local' then
      perform pg_temp.set_local(v_a.subscription_id,v_case->>'local');
      perform pg_temp.set_local(v_b.subscription_id,v_case->>'local');
    end if;

    v_event := pg_temp.ingest_upd('test',v_a.pid,
      case when v_case ? 'wrong_customer' then 'customer-someone-else' else v_a.customer end,
      'par-'||v_i,v_case->>'status',(v_case->>'updated')::timestamptz,
      (v_case->>'renews')::timestamptz,(v_case->>'ends')::timestamptz,(v_case->>'cancelled')::boolean,
      v_case->>'store',v_case->>'product',v_case->>'variant',(v_case->>'trial')::timestamptz,v_case->>'pause');
    select outcome,error_code into v_proc,v_perr from public.process_billing_subscription_updated_v2(v_event,v_now);

    v_s := pg_temp.snap(v_b.pid,
      case when v_case ? 'wrong_customer' then 'customer-someone-else' else v_b.customer end,
      v_case->>'status',(v_case->>'cancelled')::boolean,(v_case->>'renews')::timestamptz,
      (v_case->>'ends')::timestamptz,(v_case->>'updated')::timestamptz,
      jsonb_strip_nulls(jsonb_build_object('store',v_case->>'store','product',v_case->>'product',
        'variant',v_case->>'variant','trial_ends',v_case->>'trial','pause_mode',v_case->>'pause')));
    v_plan := pg_temp.plan(v_b.subscription_id,v_s,v_now);
    v_res := pg_temp.apply(v_b.subscription_id,v_s,coalesce(v_plan->>'review_token',repeat('0',64)),v_now);
    v_rec := v_plan->>'verdict';

    if v_proc<>v_case->>'proc' then raise exception 'PARITY_PROCESSOR_OUTCOME % got % (%)',v_case->>'n',v_proc,v_perr; end if;
    if v_res->>'outcome' is distinct from pg_temp.expected_recovery(v_proc,v_perr)
       or v_res->>'outcome' is distinct from v_case->>'rec' then
      raise exception 'PARITY_RECOVERY_OUTCOME % processor=%/% recovery=% plan=%',
        v_case->>'n',v_proc,v_perr,v_res->>'outcome',v_plan; end if;
    if (select (r.access_mode,r.access_reason,r.subscription_status,r.access_ends_at)::text
        from public.resolve_salon_access_v1(v_a.salon_id,v_now) r)
       is distinct from
       (select (r.access_mode,r.access_reason,r.subscription_status,r.access_ends_at)::text
        from public.resolve_salon_access_v1(v_b.salon_id,v_now) r) then
      raise exception 'PARITY_CANONICAL_ACCESS_DIVERGED %',v_case->>'n'; end if;
    if (pg_temp.sub_state(v_a.subscription_id) - 'updated_at' - 'customer' - 'pid')
       is distinct from (pg_temp.sub_state(v_b.subscription_id) - 'updated_at' - 'customer' - 'pid') then
      raise exception 'PARITY_STATE_DIVERGED % processor=% recovery=%',v_case->>'n',
        pg_temp.sub_state(v_a.subscription_id),pg_temp.sub_state(v_b.subscription_id);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- F. event reprocess
do $$
declare
  v_a record; v_event uuid; v_out text; v_plan jsonb; v_res jsonb; v_before jsonb; v_audit bigint;
  v_ev_before record; v_code text; v_c record; v_created uuid;
  v_now constant timestamptz := '2026-08-11T00:00:00Z';
  v_owner uuid; v_salon uuid;
begin
  -- updated event arrives before its subscription is linked: manual_review (unknown subscription)
  v_event := pg_temp.ingest_upd('test','sub-late','customer-late','late-1','past_due','2026-08-05T00:00:00Z',null,null,false);
  select outcome into v_out from public.process_billing_subscription_updated_v2(v_event,'2026-08-06T00:00:00Z');
  if v_out<>'manual_review' or not exists(select 1 from public.billing_webhook_events where id=v_event
      and processing_status='manual_review' and error_code='processor_updated_subscription_unknown') then
    raise exception 'LATE_SETUP_FAILED %',v_out; end if;
  v_plan := (select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r);
  if v_plan->>'verdict'<>'precondition_unmet' or v_plan->>'error_code'<>'recovery_local_subscription_missing' then
    raise exception 'PRECONDITION_NOT_ENFORCED %',v_plan; end if;
  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,coalesce(v_plan->>'review_token',repeat('0',64)),'OPS-200','reprocess before link','tester',v_now) r);
  if v_res->>'outcome'<>'precondition_unmet' or not exists(select 1 from public.billing_webhook_events where id=v_event
      and processing_status='manual_review' and error_code='processor_updated_subscription_unknown') then
    raise exception 'UNMET_PRECONDITION_MUTATED %',v_res; end if;

  -- subscription now linked: eligible, dry-run is read-only
  select * into v_a from pg_temp.mk_linked('late');
  select * into v_ev_before from public.billing_webhook_events where id=v_event;
  v_audit := pg_temp.audit_count(); v_before := pg_temp.sub_state(v_a.subscription_id);
  v_plan := (select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r);
  if v_plan->>'verdict'<>'eligible' or v_plan->>'prior_error_code'<>'processor_updated_subscription_unknown'
     or v_plan->>'review_token' !~ '^[0-9a-f]{64}$' then raise exception 'ELIGIBLE_PLAN_WRONG %',v_plan; end if;
  if (select e from public.billing_webhook_events e where e.id=v_event) is distinct from v_ev_before
     or pg_temp.audit_count()<>v_audit or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
    raise exception 'EVENT_DRYRUN_MUTATED'; end if;

  -- a changed review token (event state moved) is rejected
  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,repeat('b',64),'OPS-200','reprocess after link','tester',v_now) r);
  if v_res->>'outcome'<>'stale' or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='manual_review') then
    raise exception 'STALE_EVENT_TOKEN_ACCEPTED %',v_res; end if;

  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,v_plan->>'review_token','OPS-200','reprocess after link','tester',v_now) r);
  if v_res->>'outcome'<>'reprocessed' then raise exception 'REPROCESS_FAILED %',v_res; end if;
  if not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='processed' and error_code is null
        and last_processing_outcome='operator_reprocess' and processing_claim_token is null)
     or not exists(select 1 from public.subscriptions where id=v_a.subscription_id and status='past_due'
        and provider_state_updated_at='2026-08-05T00:00:00Z') then raise exception 'REPROCESS_EFFECT_WRONG'; end if;
  if not exists(select 1 from public.billing_recovery_attempts where id=(v_res->>'audit_id')::uuid
      and recovery_kind='event_reprocess' and evidence_source='existing_webhook_event' and webhook_event_id=v_event
      and prior_state->>'error_code'='processor_updated_subscription_unknown'
      and prior_state->>'processing_status'='manual_review' and applied_state->>'processor_outcome'='processed'
      and ticket_ref='OPS-200') then raise exception 'REPROCESS_AUDIT_WRONG'; end if;
  -- repeat: no duplicate effect
  v_before := pg_temp.sub_state(v_a.subscription_id);
  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,v_plan->>'review_token','OPS-200','reprocess repeated','tester',v_now) r);
  if v_res->>'outcome'<>'no_change' or pg_temp.sub_state(v_a.subscription_id) is distinct from v_before then
    raise exception 'REPROCESS_NOT_IDEMPOTENT %',v_res; end if;

  -- reasons outside the allowlist stay rejected and untouched
  foreach v_code in array array[
    'processor_updated_provider_ownership_conflict','processor_updated_plan_change_unsupported',
    'processor_updated_same_timestamp_conflict','processor_updated_pause_unsupported',
    'processor_updated_provider_trial_unsupported','processor_updated_expired_reactivation_unsupported',
    'processor_updated_provider_mapping_invalid','processor_updated_provider_state_unsupported',
    'processor_updated_event_facts_identity_conflict','processor_updated_facts_contract_invalid'
  ] loop
    v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'blocked-'||v_code,'active','2026-08-30T00:00:00Z','2026-09-30T00:00:00Z',null,false);
    update public.billing_webhook_events set processing_status='manual_review',error_code=v_code,processed_at=v_now where id=v_event;
    v_plan := (select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r);
    v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,coalesce(v_plan->>'review_token',repeat('0',64)),'OPS-201','attempt blocked reason','tester',v_now) r);
    if v_plan->>'verdict'<>'reason_not_allowed' or v_res->>'outcome'<>'reason_not_allowed'
       or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='manual_review' and error_code=v_code) then
      raise exception 'DISALLOWED_REASON_REPROCESSED % %',v_code,v_res; end if;
  end loop;
  -- created-event manual reviews other than retry exhaustion are rejected too
  v_event := pg_temp.ingest_upd('test','sub-x','customer-x','created-like','active','2026-08-30T00:00:00Z','2026-09-30T00:00:00Z',null,false);
  update public.billing_webhook_events set event_name='subscription_created',processing_status='manual_review',
    error_code='processor_checkout_correlation_invalid',processed_at=v_now where id=v_event;
  if (select r.verdict from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r)<>'reason_not_allowed' then
    raise exception 'CREATED_CORRELATION_REPROCESSABLE'; end if;

  -- received / leased events are owned by the retry worker
  v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'worker-owned','active','2026-08-31T00:00:00Z','2026-09-30T00:00:00Z',null,false);
  if (select r.verdict from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r)<>'not_manual_review' then
    raise exception 'RECEIVED_EVENT_REPROCESSABLE'; end if;
  update public.billing_webhook_events set processing_status='manual_review',error_code='processor_retry_exhausted',
    processed_at=v_now,processing_claim_token=gen_random_uuid(),processing_lease_until=v_now+interval '5 minutes' where id=v_event;
  v_plan := (select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r);
  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_event,coalesce(v_plan->>'review_token',repeat('0',64)),'OPS-202','leased event attempt','tester',v_now) r);
  if v_plan->>'verdict'<>'event_busy' or v_res->>'outcome'<>'event_busy'
     or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='manual_review') then
    raise exception 'ACTIVE_LEASE_STOLEN %',v_res; end if;
  -- expired lease: allowed
  update public.billing_webhook_events set processing_lease_until=v_now-interval '1 minute' where id=v_event;
  if (select r.verdict from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r)<>'eligible' then
    raise exception 'EXPIRED_LEASE_BLOCKS'; end if;

  -- retry exhausted created event: processed through the existing created processor
  v_owner := gen_random_uuid(); v_salon := gen_random_uuid();
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'created-exhausted','created-ex-'||substr(v_salon::text,1,8));
  insert into public.billing_checkout_sessions(salon_id,actor_profile_id,requested_plan_id,provider,environment,idempotency_key,status)
  values(v_salon,v_owner,(select id from public.plans where slug='starter'),'lemonsqueezy','test',gen_random_uuid(),'open');
  select event_id into v_created from public.ingest_billing_webhook_event_v2(
    'lemonsqueezy','test','subscription_created','subscriptions','sub-created-ex',
    encode(digest('event-created-ex','sha256'),'hex'),encode(digest('semantic-created-ex','sha256'),'hex'),
    'received',null,true,(select id from public.billing_checkout_sessions where salon_id=v_salon),v_salon,'starter',
    (select idempotency_key from public.billing_checkout_sessions where salon_id=v_salon),
    'sub-created-ex','order-created-ex','customer-created-ex','product-test-v2','variant-test-v2','active',
    '2026-07-01T00:00:00Z','2026-07-01T00:01:00Z',true,'ready',null,'store-test-v2','2026-09-01T00:00:00Z',null,false,null,null,null);
  update public.billing_webhook_events set processing_status='manual_review',error_code='processor_retry_exhausted',
    processed_at=v_now,processing_attempt_count=8 where id=v_created;
  v_plan := (select to_jsonb(r) from public.plan_billing_event_reprocess_v1('test',v_created,'2026-08-01T00:00:00Z') r);
  v_res := (select to_jsonb(r) from public.apply_billing_event_reprocess_v1('test',v_created,v_plan->>'review_token','OPS-203','created event retry exhausted','tester','2026-08-01T00:00:00Z') r);
  if v_res->>'outcome'<>'reprocessed' or not exists(select 1 from public.subscriptions s where s.salon_id=v_salon
      and s.provider_subscription_id='sub-created-ex' and s.status='active' and s.billing_environment='test')
     or not exists(select 1 from public.billing_checkout_sessions where salon_id=v_salon and status='completed') then
    raise exception 'CREATED_EXHAUSTED_REPROCESS_FAILED %',v_res; end if;

  -- wrong environment / parity
  v_event := pg_temp.ingest_upd('test',v_a.pid,v_a.customer,'env-check','active','2026-09-01T00:00:00Z','2026-09-30T00:00:00Z',null,false);
  update public.billing_webhook_events set processing_status='manual_review',error_code='processor_retry_exhausted',processed_at=v_now where id=v_event;
  if (select r.verdict from public.plan_billing_event_reprocess_v1('live',v_event,v_now) r)<>'environment_mismatch' then
    raise exception 'LIVE_REQUEST_ON_TEST_DB_ACCEPTED'; end if;
  update private.billing_runtime_config set environment='live';
  v_audit := pg_temp.audit_count();
  if (select r.verdict from public.plan_billing_event_reprocess_v1('test',v_event,v_now) r)<>'environment_mismatch'
     or (select r.outcome from public.apply_billing_event_reprocess_v1('test',v_event,repeat('c',64),'OPS-204','parity failure attempt','tester',v_now) r)<>'environment_mismatch'
     or pg_temp.audit_count()<>v_audit
     or not exists(select 1 from public.billing_webhook_events where id=v_event and processing_status='manual_review') then
    raise exception 'EVENT_ENVIRONMENT_PARITY_NOT_ENFORCED'; end if;
  update private.billing_runtime_config set environment='test';
  if (select r.verdict from public.plan_billing_event_reprocess_v1('test',gen_random_uuid(),v_now) r)<>'not_found' then
    raise exception 'UNKNOWN_EVENT_NOT_REJECTED'; end if;
end;
$$;

-- ---------------------------------------------------------------- G. invoice evidence alone never changes access
do $$
declare v_a record; v_before jsonb; v_out text; v_count bigint;
begin
  select * into v_a from pg_temp.mk_linked('invoice');
  update public.subscriptions set status='past_due',provider_state_updated_at='2026-08-05T00:00:00Z' where id=v_a.subscription_id;
  v_before := pg_temp.sub_state(v_a.subscription_id);
  select count(*) into v_count from public.subscriptions;
  select outcome into v_out from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','9001',
    encode(digest('invoice-9001','sha256'),'hex'),encode(digest('invoice-semantic-9001','sha256'),'hex'),
    true,'9001','1234','5678','440512','renewal','paid','2026-08-09T00:00:00Z','2026-08-09T00:00:00Z','2026-08-11T00:00:00Z');
  if pg_temp.sub_state(v_a.subscription_id) is distinct from v_before or (select count(*) from public.subscriptions)<>v_count then
    raise exception 'INVOICE_EVIDENCE_CHANGED_ACCESS'; end if;
end;
$$;

rollback;
select 'billing operator recovery contract passed' as result;
