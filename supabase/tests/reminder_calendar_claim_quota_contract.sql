-- Disposable PostgreSQL only. All fixture changes roll back.
begin;

create function pg_temp.assert_true(value boolean, message text)
returns void language plpgsql as $$
begin
  if value is distinct from true then raise exception '%', message; end if;
end $$;

create function pg_temp.quota_salon(label text, zone text default 'Europe/Belgrade')
returns uuid language plpgsql as $$
declare v_owner uuid := extensions.gen_random_uuid(); v_salon uuid := extensions.gen_random_uuid();
begin
  insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data)
    values(v_owner,v_owner||'@example.invalid','{}','{}');
  insert into public.salons(id,owner_id,name,slug,timezone)
    values(v_salon,v_owner,label,'claim-quota-'||v_salon,zone);
  update public.subscriptions set plan_id=(select id from public.plans where slug='pro'),
    status='trialing',trial_ends_at='2029-01-01T00:00:00Z',
    current_period_starts_at='2026-08-21T10:00:00Z',current_period_ends_at='2026-10-21T10:00:00Z'
    where public.subscriptions.salon_id=v_salon;
  insert into public.clients(salon_id,full_name,phone) values(v_salon,'Quota test','+381641234567');
  insert into public.salon_reminder_settings(salon_id,enabled,channel,hours_before)
    values(v_salon,true,'sms',24);
  return v_salon;
end $$;

create function pg_temp.quota_appointment(salon uuid, starts timestamptz)
returns uuid language plpgsql as $$
declare appointment uuid := extensions.gen_random_uuid();
begin
  insert into public.appointments(id,salon_id,client_id,start_time,end_time,duration_minutes,price,status,idempotency_key)
    select appointment,salon,c.id,starts,starts+interval '30 minutes',30,1000,'pending',extensions.gen_random_uuid()
    from public.clients c where c.salon_id=salon limit 1;
  return appointment;
end $$;

update public.plans set max_monthly_reminders=1 where slug='pro';

do $$
declare salon uuid := pg_temp.quota_salon('Calendar'); ny uuid := pg_temp.quota_salon('New York','America/New_York');
  row record; actual record;
begin
  for row in select * from (values
    ('2026-01-15T12:00:00Z'::timestamptz,'2025-12-31T23:00:00Z'::timestamptz,'2026-01-31T23:00:00Z'::timestamptz),
    ('2027-02-15T12:00:00Z','2027-01-31T23:00:00Z','2027-02-28T23:00:00Z'),
    ('2028-02-29T12:00:00Z','2028-01-31T23:00:00Z','2028-02-29T23:00:00Z'),
    ('2026-03-29T12:00:00Z','2026-02-28T23:00:00Z','2026-03-31T22:00:00Z'),
    ('2026-10-25T12:00:00Z','2026-09-30T22:00:00Z','2026-10-31T23:00:00Z'),
    ('2026-08-31T21:59:59.999999Z','2026-07-31T22:00:00Z','2026-08-31T22:00:00Z'),
    ('2026-08-31T22:00:00Z','2026-08-31T22:00:00Z','2026-09-30T22:00:00Z')
  ) t(at_time,starts,ends) loop
    select * into actual from public.reminder_usage_period(salon,row.at_time);
    perform pg_temp.assert_true(actual.period_start=row.starts and actual.period_end=row.ends,'LOCAL_MONTH_BOUNDARY');
    perform pg_temp.assert_true(row.at_time>=actual.period_start and row.at_time<actual.period_end,'HALF_OPEN_INTERVAL');
  end loop;
  select * into actual from public.reminder_usage_period(ny,'2026-08-31T22:00:00Z');
  perform pg_temp.assert_true(actual.period_start='2026-08-01T04:00:00Z' and actual.period_end='2026-09-01T04:00:00Z','SALON_TIMEZONE_AUTHORITY');
  update public.subscriptions set current_period_starts_at=null,current_period_ends_at=null where salon_id=salon;
  perform pg_temp.assert_true((select period_start='2026-08-31T22:00:00Z' from public.reminder_usage_period(salon,'2026-08-31T22:00:00Z')),'NO_SUBSCRIPTION_PERIOD_DEPENDENCY');
end $$;

-- Two occupied slots belong to different months even while both leases are live.
do $$
declare salon uuid := pg_temp.quota_salon('Cross midnight'); old_appointment uuid; new_appointment uuid;
  old_claim record; new_claim record; sub_before jsonb;
begin
  select to_jsonb(s) into sub_before from public.subscriptions s where s.salon_id=salon;
  old_appointment := pg_temp.quota_appointment(salon,'2026-02-01T22:58:00Z');
  select * into old_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(old_claim.appointment_id=old_appointment,'JANUARY_CLAIM');
  perform pg_temp.assert_true((select quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=old_claim.delivery_id),'JANUARY_KEY_STORED');
  new_appointment := pg_temp.quota_appointment(salon,'2026-02-01T23:00:00Z');
  select * into new_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:00:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(new_claim.appointment_id=new_appointment,'RESET_AT_LOCAL_MIDNIGHT');
  perform pg_temp.assert_true((select is_valid from public.validate_claimed_reminder_for_send(old_claim.delivery_id,old_claim.claim_token,'2026-01-31T23:00:01Z')),'OLD_LEASE_VALIDATED_IN_ITS_MONTH');
  perform pg_temp.assert_true((select is_valid from public.validate_claimed_reminder_for_send(new_claim.delivery_id,new_claim.claim_token,'2026-01-31T23:00:01Z')),'NEW_LEASE_VALIDATED_IN_ITS_MONTH');
  perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(old_claim.delivery_id,old_claim.claim_token,'sent','2026-01-31T23:00:02Z','fixture','old-month-'||salon),'FINALIZE_OLD_MONTH');
  perform pg_temp.assert_true((select accepted_count=1 and remaining=0 from public.get_salon_reminder_usage(salon,'2026-01-31T22:59:59Z')),'ACCEPTED_CHARGED_TO_CLAIM_MONTH');
  perform pg_temp.assert_true((select accepted_count=0 and remaining=1 from public.get_salon_reminder_usage(salon,'2026-01-31T23:00:02Z')),'SEND_TIME_DOES_NOT_MOVE_QUOTA');
  perform pg_temp.assert_true(public.recover_accepted_reminder_delivery(new_claim.delivery_id,new_claim.claim_token,'fixture','new-month-'||salon,'2026-01-31T23:00:03Z'),'RECOVERY_PRESERVES_QUOTA_KEY');
  update public.appointment_reminder_deliveries set status='failed' where id=new_claim.delivery_id;
  perform pg_temp.assert_true((select accepted_count=1 and remaining=0 from public.get_salon_reminder_usage(salon,'2026-02-01T12:00:00Z')),'ACCEPTED_FAILURE_STILL_COUNTS');
  perform pg_temp.quota_appointment(salon,'2026-02-01T23:00:04Z');
  perform pg_temp.assert_true(not exists(select 1 from public.claim_due_appointment_reminders(50,'2026-01-31T23:00:04Z',10) where salon_id=salon),'ACCEPTED_QUOTA_ENFORCED');
  perform pg_temp.assert_true(sub_before=(select to_jsonb(s) from public.subscriptions s where s.salon_id=salon),'BILLING_UNCHANGED');
end $$;

-- Retry releases the lease reservation but never changes the first-claim month.
do $$
declare salon uuid := pg_temp.quota_salon('Retry'); first_claim record; second_claim record;
begin
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:58:00Z');
  select * into first_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(first_claim.delivery_id,first_claim.claim_token,'retry_scheduled','2026-01-31T23:00:01Z',p_next_retry_at=>'2026-01-31T23:01:00Z'),'SCHEDULE_RETRY');
  select * into second_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:01:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(second_claim.delivery_id=first_claim.delivery_id and second_claim.attempt_count=2 and second_claim.claim_token<>first_claim.claim_token,'RETRY_NEW_LEASE');
  perform pg_temp.assert_true((select quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=second_claim.delivery_id),'RETRY_RETAINS_JANUARY');
  perform pg_temp.assert_true(not public.recover_accepted_reminder_delivery(first_claim.delivery_id,first_claim.claim_token,'fixture','stale-'||salon,'2026-01-31T23:01:01Z'),'STALE_TOKEN_REJECTED');
  perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(second_claim.delivery_id,second_claim.claim_token,'sent','2026-01-31T23:01:02Z','fixture','retry-'||salon),'RETRY_FINALIZED');
  perform pg_temp.assert_true((select accepted_count=1 from public.get_salon_reminder_usage(salon,'2026-01-31T22:59:00Z')),'RETRY_CHARGED_TO_FIRST_CLAIM_MONTH');
  perform pg_temp.assert_true((select accepted_count=0 from public.get_salon_reminder_usage(salon,'2026-01-31T23:01:03Z')),'RETRY_NOT_CHARGED_TO_FEBRUARY');
end $$;

-- A delayed appointment scheduled in January must reserve February capacity.
do $$
declare salon uuid := pg_temp.quota_salon('Delayed'); claimed integer;
begin
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:51:00Z');
  select count(*) into claimed from public.claim_due_appointment_reminders(50,'2026-01-31T23:00:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(claimed=1,'SCHEDULED_FOR_CANNOT_BYPASS_RESERVATION');
  perform pg_temp.assert_true((select count(*)=1 from public.appointment_reminder_deliveries where salon_id=salon and status='skipped' and last_error_code='QUOTA_EXHAUSTED'),'SECOND_CLAIM_REJECTED');
end $$;

-- Pre-send revalidation must still enforce the old month after midnight, even
-- when the current month has no usage (e.g. a limit reduction after claim).
do $$
declare salon uuid := pg_temp.quota_salon('Old month revalidation'); old_claim record;
begin
  update public.plans set max_monthly_reminders=2 where slug='pro';
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:51:00Z');
  perform public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',10);
  select id,claim_token into old_claim from public.appointment_reminder_deliveries where salon_id=salon and status='processing' limit 1;
  update public.plans set max_monthly_reminders=1 where slug='pro';
  perform pg_temp.assert_true((select accepted_count=0 from public.get_salon_reminder_usage(salon,'2026-01-31T23:00:00Z')),'NEW_MONTH_EMPTY');
  perform pg_temp.assert_true((select not is_valid and reason='QUOTA_EXHAUSTED' from public.validate_claimed_reminder_for_send(old_claim.id,old_claim.claim_token,'2026-01-31T23:00:00Z')),'OLD_MONTH_QUOTA_REVALIDATED');
end $$;

-- Expired, unaccepted leases may be reclaimed in the new month; old tokens fail.
do $$
declare salon uuid := pg_temp.quota_salon('Expired lease'); first_claim record; second_claim record;
begin
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  select * into first_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',1) where salon_id=salon;
  perform pg_temp.assert_true((select not is_valid and reason='CLAIM_EXPIRED' from public.validate_claimed_reminder_for_send(first_claim.delivery_id,first_claim.claim_token,'2026-01-31T23:00:00Z')),'EXACT_LEASE_END_EXPIRED');
  select * into second_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:00:00.000001Z',10) where salon_id=salon;
  perform pg_temp.assert_true(second_claim.delivery_id=first_claim.delivery_id and second_claim.claim_token<>first_claim.claim_token,'EXPIRED_LEASE_RECLAIMED');
  perform pg_temp.assert_true((select quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=second_claim.delivery_id),'RECLAIM_RETAINS_JANUARY');
  perform pg_temp.assert_true(not public.finalize_claimed_reminder_delivery(first_claim.delivery_id,first_claim.claim_token,'sent','2026-01-31T23:00:01Z','fixture','stale-expired-'||salon),'EXPIRED_TOKEN_CANNOT_FINALIZE');
  perform pg_temp.assert_true(public.recover_accepted_reminder_delivery(second_claim.delivery_id,second_claim.claim_token,'fixture','reclaimed-recovery-'||salon,'2026-01-31T23:00:02Z'),'RECLAIMED_RECOVERY');
  perform pg_temp.assert_true((select quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=second_claim.delivery_id),'RECOVERY_AFTER_RECLAIM_RETAINS_JANUARY');
end $$;

-- SECURITY DEFINER, signature/owner and service-only privileges are preserved.
-- Multiple retry/reclaim cycles and terminal outcomes preserve the original key.
do $$
declare salon uuid := pg_temp.quota_salon('Repeated retry'); active_claim record; original_key timestamptz; i integer;
begin
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:58:00Z');
  select * into active_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',1) where salon_id=salon;
  update public.appointment_reminder_deliveries set max_attempts=6 where id=active_claim.delivery_id;
  select quota_period_start into original_key from public.appointment_reminder_deliveries where id=active_claim.delivery_id;
  for i in 1..2 loop
    perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(active_claim.delivery_id,active_claim.claim_token,'retry_scheduled',
      '2026-01-31T23:00:00Z'::timestamptz+i*interval '2 minutes',
      p_next_retry_at=>'2026-01-31T23:01:00Z'::timestamptz+i*interval '2 minutes'),'REPEATED_TRANSIENT_FAILURE');
    perform pg_temp.assert_true((select quota_period_start=original_key from public.appointment_reminder_deliveries where id=active_claim.delivery_id),'RETRY_SCHEDULING_RETAINS_KEY');
    select * into active_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:01:00Z'::timestamptz+i*interval '2 minutes',1) where salon_id=salon;
    perform pg_temp.assert_true((select quota_period_start=original_key from public.appointment_reminder_deliveries where id=active_claim.delivery_id),'REPEATED_RETRY_RETAINS_KEY');
  end loop;
  select * into active_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:07:00Z',1) where salon_id=salon;
  perform pg_temp.assert_true(active_claim.attempt_count=4,'MULTIPLE_RECLAIMS_COUNTED');
  perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(active_claim.delivery_id,active_claim.claim_token,'failed','2026-01-31T23:07:01Z'),'TERMINAL_FAILURE');
  perform pg_temp.assert_true((select quota_period_start=original_key and status='failed' from public.appointment_reminder_deliveries where id=active_claim.delivery_id),'FAILED_AUDIT_RETAINED');
  update public.appointment_reminder_deliveries set status='cancelled' where id=active_claim.delivery_id;
  perform pg_temp.assert_true((select quota_period_start=original_key from public.appointment_reminder_deliveries where id=active_claim.delivery_id),'CANCELLED_AUDIT_RETAINED');
  begin
    update public.appointment_reminder_deliveries set quota_period_start=null where id=active_claim.delivery_id;
    raise exception 'QUOTA_KEY_WAS_CLEARED';
  exception when check_violation then
    perform pg_temp.assert_true(sqlerrm='REMINDER_QUOTA_PERIOD_IMMUTABLE','IMMUTABILITY_ERROR_CODE');
  end;
  begin
    update public.appointment_reminder_deliveries set quota_period_start='2026-01-31T23:00:00Z' where id=active_claim.delivery_id;
    raise exception 'QUOTA_KEY_WAS_CHANGED';
  exception when check_violation then
    perform pg_temp.assert_true(sqlerrm='REMINDER_QUOTA_PERIOD_IMMUTABLE','IMMUTABILITY_ERROR_CODE');
  end;
end $$;

-- The actual cancellation finalizer also retains a claimed row's audit period.
do $$
declare salon uuid := pg_temp.quota_salon('Cancellation finalizer'); active_claim record;
begin
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  select * into active_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:59:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(public.finalize_claimed_reminder_delivery(active_claim.delivery_id,active_claim.claim_token,'cancelled','2026-01-31T23:00:01Z'),'CANCELLATION_FINALIZED');
  perform pg_temp.assert_true((select status='cancelled' and quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=active_claim.delivery_id),'CANCELLATION_FINALIZER_RETAINS_JANUARY');
end $$;

-- January accepted + reserved usage must deny a January retry, even when the
-- February quota is empty. A February first claim can still get its own slot.
do $$
declare salon uuid := pg_temp.quota_salon('Retry quota authority'); retry_claim record; other_claim record; feb_claim record;
begin
  update public.plans set max_monthly_reminders=3 where slug='pro';
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  select * into retry_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:55:00Z',60) where salon_id=salon;
  perform public.finalize_claimed_reminder_delivery(retry_claim.delivery_id,retry_claim.claim_token,'retry_scheduled','2026-01-31T22:56:00Z',p_next_retry_at=>'2026-01-31T23:01:00Z');
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:57:00Z');
  select * into other_claim from public.claim_due_appointment_reminders(50,'2026-01-31T22:57:00Z',60) where salon_id=salon;
  perform public.finalize_claimed_reminder_delivery(other_claim.delivery_id,other_claim.claim_token,'sent','2026-01-31T22:57:01Z','fixture','retry-authority-'||salon);
  perform pg_temp.quota_appointment(salon,'2026-02-01T22:58:00Z');
  perform public.claim_due_appointment_reminders(50,'2026-01-31T22:58:00Z',60);
  update public.plans set max_monthly_reminders=2 where slug='pro';
  perform pg_temp.quota_appointment(salon,'2026-02-01T23:00:00Z');
  select * into feb_claim from public.claim_due_appointment_reminders(50,'2026-01-31T23:01:00Z',10) where salon_id=salon;
  perform pg_temp.assert_true(feb_claim.delivery_id is not null and feb_claim.delivery_id<>retry_claim.delivery_id,'FEBRUARY_FIRST_CLAIM_ALLOWED');
  perform pg_temp.assert_true((select status='skipped' and last_error_code='QUOTA_EXHAUSTED' and quota_period_start='2025-12-31T23:00:00Z' from public.appointment_reminder_deliveries where id=retry_claim.delivery_id),'JANUARY_ACCEPTED_PLUS_RESERVED_DENIES_RETRY');
  perform pg_temp.assert_true((select quota_period_start='2026-01-31T23:00:00Z' from public.appointment_reminder_deliveries where id=feb_claim.delivery_id),'FEBRUARY_SEPARATE_KEY');
  update public.plans set max_monthly_reminders=1 where slug='pro';
end $$;

-- Relevant claimed states cannot enter the table without a quota key. Rows
-- without any successful claim (including cancelled/failed) need no key.
do $$
declare salon uuid := pg_temp.quota_salon('Constraint'); appointment uuid; state text;
begin
  appointment:=pg_temp.quota_appointment(salon,'2026-02-01T22:50:00Z');
  foreach state in array array['processing','retry_scheduled','sent','delivered','failed','cancelled'] loop
    begin
      insert into public.appointment_reminder_deliveries(salon_id,appointment_id,channel,scheduled_for,appointment_start_snapshot,salon_timezone_snapshot,status,attempt_count,claimed_at)
        values(salon,appointment,'sms','2026-01-31T22:50:00Z','2026-02-01T22:50:00Z','Europe/Belgrade',state::public.reminder_delivery_status,1,'2026-01-31T22:55:00Z');
      raise exception 'CLAIM_WITHOUT_QUOTA_KEY_ALLOWED %',state;
    exception when check_violation then null;
    end;
  end loop;
  insert into public.appointment_reminder_deliveries(salon_id,appointment_id,channel,scheduled_for,appointment_start_snapshot,salon_timezone_snapshot,status)
    values(salon,appointment,'sms','2026-01-31T22:50:00Z','2026-02-01T22:50:00Z','Europe/Belgrade','pending');
  begin
    update public.appointment_reminder_deliveries set quota_period_start='2025-12-31T23:00:00Z' where appointment_id=appointment;
    raise exception 'QUOTA_KEY_WITHOUT_FIRST_CLAIM_ALLOWED';
  exception when check_violation then null;
  end;
  update public.appointment_reminder_deliveries set status='cancelled' where appointment_id=appointment;
  perform pg_temp.assert_true((select quota_period_start is null from public.appointment_reminder_deliveries where appointment_id=appointment),'UNCLAIMED_ROW_NEEDS_NO_KEY');
end $$;

select pg_temp.assert_true((select prosecdef and provolatile='s' and proowner='postgres'::regrole and proconfig @> array['search_path=""'] from pg_proc where oid='public.reminder_usage_period(uuid,timestamptz)'::regprocedure),'PERIOD_SECURITY_CONTRACT');
select pg_temp.assert_true(has_function_privilege('service_role','public.reminder_usage_period(uuid,timestamptz)','EXECUTE') and not has_function_privilege('anon','public.reminder_usage_period(uuid,timestamptz)','EXECUTE') and not has_function_privilege('authenticated','public.reminder_usage_period(uuid,timestamptz)','EXECUTE'),'PERIOD_EXECUTE_ACL');
select pg_temp.assert_true((select convalidated and pg_get_constraintdef(oid) like '%current_period_ends_at > current_period_starts_at%' from pg_constraint where conrelid='public.subscriptions'::regclass and conname='subscriptions_provider_active_period_consistent'),'BILLING_PERIOD_INVARIANT_PRESERVED');

rollback;
