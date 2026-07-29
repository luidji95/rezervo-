\set ON_ERROR_STOP on
begin;

do $$
begin
  if to_regclass('public.billing_subscription_reconciliation_checks') is null then raise exception 'RECONCILIATION_TABLE_MISSING'; end if;
  if (select count(*) from information_schema.columns where table_schema='public' and table_name='billing_subscription_reconciliation_checks')<>23 then raise exception 'RECONCILIATION_COLUMNS_INVALID'; end if;
  if not exists(select 1 from pg_indexes where schemaname='public' and indexname='billing_subscription_reconciliation_active_unique') then raise exception 'ACTIVE_INDEX_MISSING'; end if;
  if not (select relrowsecurity from pg_class where oid='public.billing_subscription_reconciliation_checks'::regclass) then raise exception 'RLS_DISABLED'; end if;
  if has_table_privilege('anon','public.billing_subscription_reconciliation_checks','select') or has_table_privilege('authenticated','public.billing_subscription_reconciliation_checks','select')
     or has_table_privilege('service_role','public.billing_subscription_reconciliation_checks','insert,update,delete')
     or not has_table_privilege('service_role','public.billing_subscription_reconciliation_checks','select') then raise exception 'TABLE_GRANTS_INVALID'; end if;
  if has_function_privilege('anon','public.claim_next_linked_billing_subscription_for_reconciliation_v1(uuid,timestamptz,interval,interval)','execute')
     or has_function_privilege('authenticated','public.finalize_billing_subscription_reconciliation_v1(uuid,uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,text,timestamptz)','execute')
     or not has_function_privilege('service_role','public.evaluate_billing_subscription_snapshot_v1(uuid,text,text,text,text,boolean,text,text,text,boolean,text,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz,timestamptz)','execute') then raise exception 'RPC_GRANTS_INVALID'; end if;
end;$$;

do $$
declare
  v_owner uuid:=gen_random_uuid();v_salon uuid:=gen_random_uuid();v_subscription uuid;v_starter uuid;v_pro uuid;
  v_check record;v_outcome text;v_business_before text;v_business_after text;v_identity text;
begin
  select id into v_starter from public.plans where slug='starter';select id into v_pro from public.plans where slug='pro';
  insert into public.billing_provider_prices(plan_id,provider,environment,billing_interval,currency,amount,provider_product_id,provider_variant_id,provider_store_id,is_active) values
    (v_starter,'lemonsqueezy','test','monthly','RSD',2990,'product-starter','variant-starter','440512',true),
    (v_pro,'lemonsqueezy','test','monthly','RSD',5990,'product-pro','variant-pro','440512',true)
  on conflict(provider,environment,plan_id,billing_interval,currency) do update set provider_product_id=excluded.provider_product_id,provider_variant_id=excluded.provider_variant_id,provider_store_id=excluded.provider_store_id,is_active=true;
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug) values(v_salon,v_owner,'Reconciliation contract','recon-'||substr(v_salon::text,1,8));
  select id into v_subscription from public.subscriptions where salon_id=v_salon;
  update public.subscriptions set plan_id=v_starter,status='active',billing_provider='lemonsqueezy',billing_environment='test',provider_customer_id='customer-recon',provider_subscription_id='subscription-recon',current_period_starts_at='2026-07-29T09:00:00Z',current_period_ends_at='2026-08-29T10:00:00Z',cancel_at_period_end=false,cancelled_at=null,provider_state_updated_at='2026-07-29T10:00:00Z' where id=v_subscription;
  select md5(row(s.*)::text) into v_business_before from public.subscriptions s where id=v_subscription;
  select * into v_check from public.claim_next_linked_billing_subscription_for_reconciliation_v1(gen_random_uuid(),'2026-07-29T10:05:00Z','5 minutes','15 minutes');
  if v_check.subscription_id is distinct from v_subscription or v_check.claim_token is null then raise exception 'ELIGIBLE_SUBSCRIPTION_NOT_CLAIMED'; end if;
  if (select count(*) from public.claim_next_linked_billing_subscription_for_reconciliation_v1(gen_random_uuid(),'2026-07-29T10:05:01Z','5 minutes','15 minutes'))<>0 then raise exception 'ACTIVE_CHECK_NOT_EXCLUSIVE'; end if;
  select outcome into v_outcome from public.finalize_billing_subscription_reconciliation_v1(v_check.check_id,v_check.claim_token,'snapshot','subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:00:00Z',null,'2026-07-29T10:05:00Z');
  if v_outcome<>'in_sync' then raise exception 'IN_SYNC_EVALUATION_FAILED_%',v_outcome; end if;
  if not exists(select 1 from public.billing_subscription_reconciliation_checks where id=v_check.check_id and status='completed' and remote_state_fingerprint~'^[0-9a-f]{64}$' and remote_status='active') then raise exception 'FINALIZED_CHECK_INVALID'; end if;
  select md5(row(s.*)::text) into v_business_after from public.subscriptions s where id=v_subscription;
  if v_business_before<>v_business_after then raise exception 'SUBSCRIPTION_MUTATED'; end if;

  select claimed_local_identity_fingerprint into v_identity from public.billing_subscription_reconciliation_checks where id=v_check.check_id;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'remote_newer_in_sync_equivalent' then raise exception 'REMOTE_EQUIVALENT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','cancelled',true,null,null,null,null,'2026-08-30T10:00:00Z','2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'remote_newer_drift' then raise exception 'REMOTE_DRIFT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T09:59:00Z','2026-07-29T10:05:00Z'))<>'local_newer' then raise exception 'LOCAL_NEWER_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-pro','variant-pro','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'plan_change_detected' then raise exception 'PLAN_CHANGE_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','active',false,'free',null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'unsupported_remote_state' then raise exception 'PAUSE_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','wrong-customer','440512',true,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'identity_conflict' then raise exception 'IDENTITY_CONFLICT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',false,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'identity_conflict' then raise exception 'TEST_MODE_CONFLICT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'unknown-product','unknown-variant','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'mapping_conflict' then raise exception 'MAPPING_CONFLICT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','on_trial',false,null,null,'2026-08-01T10:00:00Z','2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'unsupported_remote_state' then raise exception 'PROVIDER_TRIAL_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','future_status',false,null,null,null,null,null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'unsupported_remote_state' then raise exception 'UNKNOWN_STATUS_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','cancelled',true,null,null,null,null,'2026-08-30T10:00:00Z','2026-07-01T10:00:00Z','2026-07-29T10:00:00Z','2026-07-29T10:05:00Z'))<>'same_timestamp_conflict' then raise exception 'SAME_TIMESTAMP_CONFLICT_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','past_due',false,null,null,null,'2026-08-30T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'remote_newer_drift' then raise exception 'PAST_DUE_PARITY_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','unpaid',false,null,null,null,'2026-08-30T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'remote_newer_drift' then raise exception 'UNPAID_PARITY_FAILED'; end if;
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','expired',true,null,null,null,null,'2026-07-28T10:00:00Z','2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'remote_newer_drift' then raise exception 'EXPIRED_PARITY_FAILED'; end if;
  update public.billing_provider_prices set provider_variant_id='variant-starter-changed' where plan_id=v_starter and provider='lemonsqueezy' and environment='test';
  if (select outcome from public.evaluate_billing_subscription_snapshot_v1(v_subscription,v_identity,'subscription-recon','customer-recon','440512',true,'product-starter','variant-starter','active',false,null,null,null,'2026-08-29T10:00:00Z',null,'2026-07-01T10:00:00Z','2026-07-29T10:01:00Z','2026-07-29T10:05:00Z'))<>'local_changed_during_check' then raise exception 'LOCAL_CHANGED_FAILED'; end if;
end;$$;

do $$
declare v_check uuid:=gen_random_uuid();v_subscription uuid;v_token uuid:=gen_random_uuid();v_outcome text;
begin
  select id into v_subscription from public.subscriptions where provider_subscription_id='subscription-recon';
  insert into public.billing_subscription_reconciliation_checks(id,run_id,subscription_id,status,attempt_count,claim_token,lease_until,started_at,claimed_local_identity_fingerprint) values(v_check,gen_random_uuid(),v_subscription,'claimed',1,v_token,'2026-07-29T10:05:00Z','2026-07-29T10:00:00Z',repeat('a',64));
  select outcome into v_outcome from public.finalize_billing_subscription_reconciliation_v1(v_check,gen_random_uuid(),'provider_not_found',p_now=>'2026-07-29T10:00:00Z');
  if v_outcome<>'claim_lost' or not exists(select 1 from public.billing_subscription_reconciliation_checks where id=v_check and status='claimed') then raise exception 'CLAIM_LOST_INVALID'; end if;
  select outcome into v_outcome from public.finalize_billing_subscription_reconciliation_v1(v_check,v_token,'provider_unavailable',p_provider_error_code=>'provider_timeout',p_now=>'2026-07-29T10:00:00Z');
  if v_outcome<>'retry_scheduled' or not exists(select 1 from public.billing_subscription_reconciliation_checks where id=v_check and status='retry_scheduled' and next_attempt_at='2026-07-29T10:01:00Z') then raise exception 'RETRY_BACKOFF_INVALID'; end if;
end;$$;

rollback;
