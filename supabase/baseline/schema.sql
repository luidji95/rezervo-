


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

-- Application extensions. These contain no environment-specific data.
CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA "public";

-- Scheduler foundation only. The baseline creates no Vault secrets and no
-- cron.job rows.
CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";
CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";
CREATE EXTENSION IF NOT EXISTS "supabase_vault";


CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE TYPE "public"."ai_conversation_status" AS ENUM (
    'active',
    'paused',
    'human_takeover'
);


ALTER TYPE "public"."ai_conversation_status" OWNER TO "postgres";


CREATE TYPE "public"."appointment_status" AS ENUM (
    'pending',
    'confirmed',
    'completed',
    'cancelled',
    'no_show'
);


ALTER TYPE "public"."appointment_status" OWNER TO "postgres";


CREATE TYPE "public"."audit_actor_type" AS ENUM (
    'profile',
    'client',
    'system',
    'ai'
);


ALTER TYPE "public"."audit_actor_type" OWNER TO "postgres";


CREATE TYPE "public"."booking_source" AS ENUM (
    'manual',
    'public',
    'ai',
    'whatsapp',
    'instagram'
);


ALTER TYPE "public"."booking_source" OWNER TO "postgres";


CREATE TYPE "public"."business_type" AS ENUM (
    'barbershop',
    'hair_salon',
    'beauty_salon',
    'spa',
    'other'
);


ALTER TYPE "public"."business_type" OWNER TO "postgres";


CREATE TYPE "public"."client_status" AS ENUM (
    'active',
    'blocked',
    'archived'
);


ALTER TYPE "public"."client_status" OWNER TO "postgres";


CREATE TYPE "public"."conversation_status" AS ENUM (
    'open',
    'closed',
    'archived'
);


ALTER TYPE "public"."conversation_status" OWNER TO "postgres";


CREATE TYPE "public"."global_role" AS ENUM (
    'user',
    'admin',
    'super_admin'
);


ALTER TYPE "public"."global_role" OWNER TO "postgres";


CREATE TYPE "public"."integration_status" AS ENUM (
    'connected',
    'disconnected',
    'error'
);


ALTER TYPE "public"."integration_status" OWNER TO "postgres";


CREATE TYPE "public"."member_status" AS ENUM (
    'invited',
    'active',
    'inactive',
    'removed'
);


ALTER TYPE "public"."member_status" OWNER TO "postgres";


CREATE TYPE "public"."message_direction" AS ENUM (
    'inbound',
    'outbound'
);


ALTER TYPE "public"."message_direction" OWNER TO "postgres";


CREATE TYPE "public"."message_sender_type" AS ENUM (
    'client',
    'member',
    'ai',
    'system'
);


ALTER TYPE "public"."message_sender_type" OWNER TO "postgres";


CREATE TYPE "public"."payment_record_status" AS ENUM (
    'pending',
    'paid',
    'failed',
    'refunded'
);


ALTER TYPE "public"."payment_record_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_status" AS ENUM (
    'unpaid',
    'paid',
    'partially_paid',
    'refunded'
);


ALTER TYPE "public"."payment_status" OWNER TO "postgres";


CREATE TYPE "public"."payment_type" AS ENUM (
    'cash',
    'card',
    'online',
    'refund'
);


ALTER TYPE "public"."payment_type" OWNER TO "postgres";


CREATE TYPE "public"."reminder_channel" AS ENUM (
    'sms',
    'viber'
);


ALTER TYPE "public"."reminder_channel" OWNER TO "postgres";


CREATE TYPE "public"."reminder_delivery_status" AS ENUM (
    'pending',
    'processing',
    'sent',
    'delivered',
    'retry_scheduled',
    'failed',
    'skipped',
    'cancelled'
);


ALTER TYPE "public"."reminder_delivery_status" OWNER TO "postgres";


CREATE TYPE "public"."salon_member_role" AS ENUM (
    'owner',
    'manager',
    'employee'
);


ALTER TYPE "public"."salon_member_role" OWNER TO "postgres";


CREATE TYPE "public"."salon_status" AS ENUM (
    'active',
    'inactive',
    'suspended'
);


ALTER TYPE "public"."salon_status" OWNER TO "postgres";


CREATE TYPE "public"."subscription_status" AS ENUM (
    'trialing',
    'active',
    'past_due',
    'cancelled',
    'expired'
);


ALTER TYPE "public"."subscription_status" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "private"."invoke_rezervo_reminder_worker"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_worker_url text;
  v_cron_secret text;
  v_request_id bigint;
begin
  select nullif(btrim(s.decrypted_secret), '')
    into v_worker_url
  from vault.decrypted_secrets s
  where s.name = 'rezervo_reminder_worker_url'
  limit 1;

  select nullif(btrim(s.decrypted_secret), '')
    into v_cron_secret
  from vault.decrypted_secrets s
  where s.name = 'rezervo_reminder_cron_secret'
  limit 1;

  if v_worker_url is null then
    raise exception 'REMINDER_WORKER_URL_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  if left(v_worker_url, 8) <> 'https://' then
    raise exception 'REMINDER_WORKER_URL_MUST_USE_HTTPS' using errcode = 'P0001';
  end if;
  if v_cron_secret is null then
    raise exception 'REMINDER_CRON_SECRET_NOT_CONFIGURED' using errcode = 'P0001';
  end if;

  select net.http_post(
    url := v_worker_url,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || v_cron_secret,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  ) into v_request_id;

  return v_request_id;
end;
$$;


ALTER FUNCTION "private"."invoke_rezervo_reminder_worker"() OWNER TO "postgres";


COMMENT ON FUNCTION "private"."invoke_rezervo_reminder_worker"() IS 'Reads the reminder worker URL and Bearer secret from Vault and queues one pg_net request. Does not schedule cron.';



CREATE OR REPLACE FUNCTION "public"."accept_team_invitation"("p_invitation_id" "uuid", "p_profile_id" "uuid") RETURNS TABLE("result_status" "text", "salon_id" "uuid", "employee_id" "uuid", "membership_id" "uuid", "already_accepted" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_invitation public.team_invitations%rowtype;
  v_employee public.employees%rowtype;
  v_membership public.salon_members%rowtype;
  v_auth_email text;
begin
  select invitation.*
  into v_invitation
  from public.team_invitations as invitation
  where invitation.id = p_invitation_id
  for update;

  if not found then
    raise exception 'INVALID_INVITATION' using errcode = 'P0001';
  end if;

  select lower(btrim(auth_user.email))
  into v_auth_email
  from auth.users as auth_user
  where auth_user.id = p_profile_id;

  if v_auth_email is null then
    raise exception 'UNAUTHORIZED' using errcode = 'P0001';
  end if;

  if v_auth_email <> v_invitation.email then
    raise exception 'EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  if v_invitation.auth_user_id is not null
     and v_invitation.auth_user_id <> p_profile_id then
    raise exception 'EMAIL_MISMATCH' using errcode = 'P0001';
  end if;

  if v_invitation.status = 'revoked' then
    return query select 'revoked', v_invitation.salon_id,
      v_invitation.employee_id, null::uuid, false;
    return;
  end if;

  if v_invitation.status = 'expired'
     or (
       v_invitation.status = 'invited'
       and v_invitation.expires_at <= now()
     ) then
    if v_invitation.status = 'invited' then
      update public.team_invitations
      set status = 'expired'
      where id = v_invitation.id;
    end if;

    return query select 'expired', v_invitation.salon_id,
      v_invitation.employee_id, null::uuid, false;
    return;
  end if;

  select employee.*
  into v_employee
  from public.employees as employee
  where employee.id = v_invitation.employee_id
    and employee.salon_id = v_invitation.salon_id
    and employee.is_active = true
  for update;

  if not found then
    raise exception 'EMPLOYEE_NOT_FOUND' using errcode = 'P0001';
  end if;

  select membership.*
  into v_membership
  from public.salon_members as membership
  where membership.salon_id = v_invitation.salon_id
    and membership.profile_id = p_profile_id
  for update;

  if v_invitation.status = 'accepted' then
    if v_invitation.auth_user_id = p_profile_id
       and v_employee.profile_id = p_profile_id
       and v_membership.id is not null
       and v_membership.role = 'employee'::public.salon_member_role
       and v_membership.status = 'active'::public.member_status then
      return query select 'accepted', v_invitation.salon_id,
        v_invitation.employee_id, v_membership.id, true;
      return;
    end if;

    raise exception 'INVITATION_ALREADY_ACCEPTED' using errcode = 'P0001';
  end if;

  if v_employee.profile_id is not null
     and v_employee.profile_id <> p_profile_id then
    raise exception 'EMPLOYEE_ALREADY_LINKED' using errcode = 'P0001';
  end if;

  if exists (
    select 1
    from public.employees as linked_employee
    where linked_employee.salon_id = v_invitation.salon_id
      and linked_employee.profile_id = p_profile_id
      and linked_employee.id <> v_invitation.employee_id
  ) then
    raise exception 'PROFILE_ALREADY_LINKED' using errcode = 'P0001';
  end if;

  if v_membership.id is not null then
    if v_membership.role <> 'employee'::public.salon_member_role then
      raise exception 'ROLE_CONFLICT' using errcode = 'P0001';
    end if;

    if v_membership.status in (
      'inactive'::public.member_status,
      'removed'::public.member_status
    ) then
      raise exception 'MEMBERSHIP_CONFLICT' using errcode = 'P0001';
    end if;

    if v_membership.status = 'invited'::public.member_status then
      update public.salon_members
      set status = 'active'::public.member_status,
          invited_by = v_invitation.invited_by,
          invited_at = v_invitation.created_at,
          joined_at = now(),
          updated_at = now()
      where id = v_membership.id
      returning * into v_membership;
    elsif v_membership.status <> 'active'::public.member_status then
      raise exception 'MEMBERSHIP_CONFLICT' using errcode = 'P0001';
    end if;
  else
    insert into public.salon_members (
      salon_id,
      profile_id,
      role,
      status,
      invited_by,
      invited_at,
      joined_at
    )
    values (
      v_invitation.salon_id,
      p_profile_id,
      'employee'::public.salon_member_role,
      'active'::public.member_status,
      v_invitation.invited_by,
      v_invitation.created_at,
      now()
    )
    returning * into v_membership;
  end if;

  update public.employees
  set profile_id = p_profile_id
  where id = v_invitation.employee_id;

  update public.team_invitations
  set status = 'accepted',
      auth_user_id = p_profile_id,
      accepted_at = now()
  where id = v_invitation.id;

  return query select 'accepted', v_invitation.salon_id,
    v_invitation.employee_id, v_membership.id, false;
exception
  when unique_violation then
    raise exception 'PROFILE_ALREADY_LINKED' using errcode = 'P0001';
end;
$$;


ALTER FUNCTION "public"."accept_team_invitation"("p_invitation_id" "uuid", "p_profile_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."accept_team_invitation"("p_invitation_id" "uuid", "p_profile_id" "uuid") IS 'Atomically activates an employee membership and links an accepted Auth profile.';



CREATE OR REPLACE FUNCTION "public"."apply_infobip_sms_delivery_report"("p_provider_message_id" "text", "p_status_id" integer, "p_status_group" "text", "p_status_name" "text", "p_error_code" "text" DEFAULT NULL::"text", "p_error_name" "text" DEFAULT NULL::"text", "p_error_permanent" boolean DEFAULT NULL::boolean, "p_provider_done_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_received_at" timestamp with time zone DEFAULT "now"()) RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  d public.appointment_reminder_deliveries%rowtype;
  v_group text := upper(btrim(coalesce(p_status_group, '')));
  v_status_name text := nullif(btrim(p_status_name), '');
  v_error_code text := nullif(btrim(p_error_code), '');
  v_error_name text := nullif(btrim(p_error_name), '');
  v_effective_at timestamptz := coalesce(p_provider_done_at, p_received_at);
begin
  if p_provider_message_id is null or length(btrim(p_provider_message_id)) not between 1 and 256
    or length(v_group) not between 1 and 128
    or (v_status_name is not null and length(v_status_name) > 128)
    or (v_error_code is not null and length(v_error_code) > 128)
    or (v_error_name is not null and length(v_error_name) > 128) then
    raise exception 'INVALID_DELIVERY_REPORT_INPUT' using errcode = '22023';
  end if;

  select * into d
  from public.appointment_reminder_deliveries
  where provider = 'infobip' and provider_message_id = btrim(p_provider_message_id)
  for update;

  if not found then return 'ignored_unknown_message'; end if;

  if d.provider_done_at is not null and (
    p_provider_done_at is null or p_provider_done_at < d.provider_done_at
  ) then
    return 'ignored_stale';
  end if;

  if d.provider_done_at is not distinct from p_provider_done_at
    and d.provider_status_id is not distinct from p_status_id
    and d.provider_status_group is not distinct from v_group
    and d.provider_status_name is not distinct from v_status_name
    and d.provider_error_code is not distinct from v_error_code
    and d.provider_error_name is not distinct from v_error_name
    and d.provider_error_permanent is not distinct from p_error_permanent then
    return 'ignored_duplicate';
  end if;

  if d.status = 'delivered' and v_group <> 'DELIVERED' then
    return 'ignored_monotone';
  end if;
  if d.status = 'failed' and v_group = 'PENDING' then
    return 'ignored_monotone';
  end if;

  if v_group = 'DELIVERED' then
    update public.appointment_reminder_deliveries
    set status = 'delivered', delivered_at = coalesce(p_provider_done_at, delivered_at, p_received_at),
        provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at,
        last_error_code = null, last_error_message = null
    where id = d.id;
  elsif v_group in ('UNDELIVERABLE', 'EXPIRED', 'REJECTED') then
    update public.appointment_reminder_deliveries
    set status = 'failed', failed_at = coalesce(p_provider_done_at, failed_at, p_received_at),
        provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at,
        last_error_code = left('INFOBIP_' || coalesce(v_status_name, v_group), 128),
        last_error_message = left('Infobip delivery report: ' || v_group || coalesce('/' || v_status_name, ''), 1000),
        next_retry_at = null, lease_expires_at = null, claim_token = null
    where id = d.id;
  else
    update public.appointment_reminder_deliveries
    set provider_status_id = p_status_id, provider_status_group = v_group,
        provider_status_name = v_status_name, provider_error_code = v_error_code,
        provider_error_name = v_error_name, provider_error_permanent = p_error_permanent,
        provider_done_at = coalesce(p_provider_done_at, provider_done_at),
        delivery_report_received_at = p_received_at
    where id = d.id;
  end if;

  return 'updated';
end; $$;


ALTER FUNCTION "public"."apply_infobip_sms_delivery_report"("p_provider_message_id" "text", "p_status_id" integer, "p_status_group" "text", "p_status_name" "text", "p_error_code" "text", "p_error_name" "text", "p_error_permanent" boolean, "p_provider_done_at" timestamp with time zone, "p_received_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_due_appointment_reminders"("p_batch_size" integer DEFAULT 50, "p_now" timestamp with time zone DEFAULT "now"(), "p_lease_minutes" integer DEFAULT 10) RETURNS TABLE("delivery_id" "uuid", "salon_id" "uuid", "appointment_id" "uuid", "client_id" "uuid", "channel" "public"."reminder_channel", "scheduled_for" timestamp with time zone, "appointment_start" timestamp with time zone, "recipient" "text", "salon_timezone" "text", "attempt_count" integer, "lease_expires_at" timestamp with time zone, "claim_token" "uuid")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_candidate record;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_monthly_limit integer;
  v_accepted_count bigint;
  v_reserved_count bigint;
begin
  if p_batch_size not between 1 and 500
    or p_lease_minutes not between 1 and 60
  then
    raise exception 'INVALID_CLAIM_INPUT' using errcode = '22023';
  end if;

  update public.appointment_reminder_deliveries as delivery
  set status = 'cancelled',
      cancelled_at = p_now,
      lease_expires_at = null,
      claim_token = null,
      last_error_code = 'SCHEDULE_INVALIDATED'
  where delivery.status in ('pending', 'processing', 'retry_scheduled')
    and exists (
      select 1
      from public.appointments as appointment
      left join public.salon_reminder_settings as reminder_settings
        on reminder_settings.salon_id = appointment.salon_id
      where appointment.id = delivery.appointment_id
        and (
          appointment.status not in ('pending', 'confirmed')
          or appointment.start_time <= p_now
          or not coalesce(reminder_settings.enabled, false)
          or delivery.scheduled_for <>
            appointment.start_time
              - make_interval(hours => reminder_settings.hours_before)
        )
    );

  update public.appointment_reminder_deliveries as delivery
  set status = 'failed',
      failed_at = p_now,
      lease_expires_at = null,
      claim_token = null,
      last_error_code = 'MAX_ATTEMPTS_REACHED'
  where delivery.attempt_count >= delivery.max_attempts
    and (
      (
        delivery.status = 'processing'
        and delivery.lease_expires_at < p_now
      )
      or (
        delivery.status = 'retry_scheduled'
        and coalesce(delivery.next_retry_at, delivery.scheduled_for) <= p_now
      )
    );

  insert into public.appointment_reminder_deliveries (
    salon_id,
    appointment_id,
    client_id,
    reminder_type,
    channel,
    scheduled_for,
    appointment_start_snapshot,
    recipient_snapshot,
    salon_timezone_snapshot,
    status,
    skipped_at,
    last_error_code
  )
  select
    appointment.salon_id,
    appointment.id,
    appointment.client_id,
    'appointment_reminder',
    'sms',
    appointment.start_time
      - make_interval(hours => reminder_settings.hours_before),
    appointment.start_time,
    case
      when btrim(client.phone) like '+%'
        then '+' || regexp_replace(client.phone, '[^0-9]', '', 'g')
      else regexp_replace(client.phone, '[^0-9]', '', 'g')
    end,
    coalesce(nullif(salon.timezone, ''), 'Europe/Belgrade'),
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then 'skipped'::public.reminder_delivery_status
      else 'pending'::public.reminder_delivery_status
    end,
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then p_now
    end,
    case
      when length(regexp_replace(coalesce(client.phone, ''), '[^0-9]', '', 'g')) < 8
        then 'MISSING_RECIPIENT'
    end
  from public.appointments as appointment
  join public.salons as salon
    on salon.id = appointment.salon_id
  join public.clients as client
    on client.id = appointment.client_id
    and client.salon_id = appointment.salon_id
  join public.salon_reminder_settings as reminder_settings
    on reminder_settings.salon_id = appointment.salon_id
    and reminder_settings.enabled
    and reminder_settings.channel = 'sms'
  join public.subscriptions as subscription
    on subscription.salon_id = appointment.salon_id
    and subscription.status in ('active', 'trialing')
  join public.plans as plan
    on plan.id = subscription.plan_id
    and plan.sms_reminders_enabled
  where appointment.status in ('pending', 'confirmed')
    and appointment.start_time > p_now
    and appointment.start_time
      - make_interval(hours => reminder_settings.hours_before) <= p_now
    and (
      subscription.status <> 'trialing'
      or subscription.trial_ends_at is null
      or subscription.trial_ends_at > p_now
    )
    and (
      subscription.status <> 'active'
      or subscription.current_period_ends_at is null
      or subscription.current_period_ends_at > p_now
    )
  on conflict on constraint reminder_delivery_schedule_unique do nothing;

  for v_candidate in
    select delivery.*
    from public.appointment_reminder_deliveries as delivery
    join public.appointments as appointment
      on appointment.id = delivery.appointment_id
      and appointment.salon_id = delivery.salon_id
    join public.salon_reminder_settings as reminder_settings
      on reminder_settings.salon_id = delivery.salon_id
      and reminder_settings.enabled
      and reminder_settings.channel = delivery.channel
    join public.subscriptions as subscription
      on subscription.salon_id = delivery.salon_id
      and subscription.status in ('active', 'trialing')
    join public.plans as plan
      on plan.id = subscription.plan_id
      and plan.sms_reminders_enabled
    where (
      delivery.status = 'pending'
      or (
        delivery.status = 'retry_scheduled'
        and coalesce(delivery.next_retry_at, delivery.scheduled_for) <= p_now
      )
      or (
        delivery.status = 'processing'
        and delivery.lease_expires_at < p_now
        and delivery.attempt_count < delivery.max_attempts
      )
    )
      and appointment.status in ('pending', 'confirmed')
      and appointment.start_time > p_now
      and delivery.attempt_count < delivery.max_attempts
      and delivery.scheduled_for =
        appointment.start_time
          - make_interval(hours => reminder_settings.hours_before)
      and (
        subscription.status <> 'trialing'
        or subscription.trial_ends_at is null
        or subscription.trial_ends_at > p_now
      )
      and (
        subscription.status <> 'active'
        or subscription.current_period_ends_at is null
        or subscription.current_period_ends_at > p_now
      )
    order by delivery.scheduled_for, delivery.id
    limit p_batch_size
    for update of delivery skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(
        'reminder-quota:' || v_candidate.salon_id::text,
        0
      )
    );

    select
      usage.period_start,
      usage.period_end,
      usage.max_monthly_reminders,
      usage.accepted_count
    into
      v_period_start,
      v_period_end,
      v_monthly_limit,
      v_accepted_count
    from public.get_salon_reminder_usage(
      v_candidate.salon_id,
      p_now
    ) as usage;

    select count(*)
    into v_reserved_count
    from public.appointment_reminder_deliveries as reserved_delivery
    where reserved_delivery.salon_id = v_candidate.salon_id
      and reserved_delivery.id <> v_candidate.id
      and reserved_delivery.status = 'processing'
      and reserved_delivery.lease_expires_at > p_now
      and reserved_delivery.scheduled_for >= v_period_start
      and reserved_delivery.scheduled_for < v_period_end;

    if v_monthly_limit is not null
      and v_accepted_count + v_reserved_count >= v_monthly_limit
    then
      update public.appointment_reminder_deliveries as delivery
      set status = 'skipped',
          skipped_at = p_now,
          lease_expires_at = null,
          claim_token = null,
          last_error_code = 'QUOTA_EXHAUSTED'
      where delivery.id = v_candidate.id;
      continue;
    end if;

    update public.appointment_reminder_deliveries as delivery
    set status = 'processing',
        claimed_at = p_now,
        lease_expires_at = p_now + make_interval(mins => p_lease_minutes),
        last_attempt_at = p_now,
        attempt_count = delivery.attempt_count + 1,
        next_retry_at = null,
        claim_token = gen_random_uuid()
    where delivery.id = v_candidate.id
    returning
      delivery.id,
      delivery.salon_id,
      delivery.appointment_id,
      delivery.client_id,
      delivery.channel,
      delivery.scheduled_for,
      delivery.appointment_start_snapshot,
      delivery.recipient_snapshot,
      delivery.salon_timezone_snapshot,
      delivery.attempt_count,
      delivery.lease_expires_at,
      delivery.claim_token
    into
      delivery_id,
      salon_id,
      appointment_id,
      client_id,
      channel,
      scheduled_for,
      appointment_start,
      recipient,
      salon_timezone,
      attempt_count,
      lease_expires_at,
      claim_token;

    return next;
  end loop;
end;
$$;


ALTER FUNCTION "public"."claim_due_appointment_reminders"("p_batch_size" integer, "p_now" timestamp with time zone, "p_lease_minutes" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cleanup_simulation_run"("p_salon_id" "uuid", "p_appointment_ids" "uuid"[], "p_client_ids" "uuid"[]) RETURNS TABLE("deleted_notifications" integer, "deleted_snapshots" integer, "deleted_appointments" integer, "deleted_clients" integer, "retained_clients" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  if p_salon_id is null or p_appointment_ids is null or p_client_ids is null then
    raise exception 'INVALID_SIMULATION_CLEANUP' using errcode = '22023';
  end if;

  delete from public.notifications
  where salon_id = p_salon_id
    and entity_type = 'appointment'
    and entity_id::text = any(p_appointment_ids::text[]);
  get diagnostics deleted_notifications = row_count;

  delete from public.appointment_services as snapshot
  using public.appointments as appointment
  where snapshot.appointment_id = appointment.id
    and appointment.salon_id = p_salon_id
    and appointment.id = any(p_appointment_ids);
  get diagnostics deleted_snapshots = row_count;

  delete from public.appointments
  where salon_id = p_salon_id
    and id = any(p_appointment_ids);
  get diagnostics deleted_appointments = row_count;

  delete from public.clients as client
  where client.salon_id = p_salon_id
    and client.id = any(p_client_ids)
    and not exists (
      select 1 from public.appointments as appointment
      where appointment.client_id = client.id
    );
  get diagnostics deleted_clients = row_count;

  select count(*)::integer into retained_clients
  from public.clients as client
  where client.salon_id = p_salon_id
    and client.id = any(p_client_ids);

  return next;
end;
$$;


ALTER FUNCTION "public"."cleanup_simulation_run"("p_salon_id" "uuid", "p_appointment_ids" "uuid"[], "p_client_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_employee_appointment_atomic"("p_profile_id" "uuid", "p_service_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_customer_note" "text", "p_idempotency_key" "uuid") RETURNS TABLE("appointment_id" "uuid", "was_created" boolean, "appointment_status" "public"."appointment_status", "appointment_start" timestamp with time zone, "salon_id" "uuid", "service_name" "text", "customer_name" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_context record;
  v_existing record;
  v_client_id uuid;
  v_client_by_phone uuid;
  v_client_by_email uuid;
  v_appointment_id uuid;
  v_duration integer;
  v_buffer integer;
  v_price numeric;
  v_end_time timestamp with time zone;
  v_phone text := nullif(regexp_replace(btrim(p_customer_phone), '[[:space:]()-]', '', 'g'), '');
  v_email text := nullif(lower(btrim(p_customer_email)), '');
  v_name text := btrim(coalesce(p_customer_full_name, ''));
  v_note text := nullif(btrim(p_customer_note), '');
  v_constraint_name text;
begin
  if p_profile_id is null or p_idempotency_key is null then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if length(v_name) < 2 or (v_phone is null and v_email is null) then
    raise exception 'INVALID_INPUT' using errcode = '22023';
  end if;

  if p_start_time <= now() then
    raise exception 'SLOT_UNAVAILABLE' using errcode = '22023';
  end if;

  select
    salon.id as salon_id,
    employee.id as employee_id,
    service.id as service_id,
    service.name as service_name,
    service.duration_minutes,
    coalesce(service.buffer_minutes, 0) as buffer_minutes,
    service.price,
    service.currency,
    relation.custom_duration_minutes,
    relation.custom_price
  into v_context
  from public.salon_members as membership
  join public.salons as salon
    on salon.id = membership.salon_id
   and salon.status = 'active'::public.salon_status
  join public.employees as employee
    on employee.salon_id = membership.salon_id
   and employee.profile_id = membership.profile_id
   and employee.is_active = true
   and employee.is_bookable = true
  join public.employee_services as relation
    on relation.salon_id = employee.salon_id
   and relation.employee_id = employee.id
   and relation.service_id = p_service_id
   and relation.is_active = true
  join public.services as service
    on service.id = relation.service_id
   and service.salon_id = employee.salon_id
   and service.is_active = true
  where membership.profile_id = p_profile_id
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
  limit 1;

  if not found then
    raise exception 'SERVICE_NOT_ASSIGNED' using errcode = 'P0001';
  end if;

  v_duration := coalesce(v_context.custom_duration_minutes, v_context.duration_minutes);
  v_buffer := v_context.buffer_minutes;
  v_price := coalesce(v_context.custom_price, v_context.price);
  v_end_time := p_start_time + make_interval(mins => v_duration + v_buffer);

  perform pg_advisory_xact_lock(
    hashtextextended('employee-appointment:' || p_idempotency_key::text, 0)
  );

  select
    appointment.id,
    appointment.salon_id,
    appointment.employee_id,
    appointment.primary_service_id,
    appointment.start_time,
    appointment.status
  into v_existing
  from public.appointments as appointment
  where appointment.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.salon_id <> v_context.salon_id
      or v_existing.employee_id is distinct from v_context.employee_id
      or v_existing.primary_service_id is distinct from p_service_id
      or v_existing.start_time <> p_start_time
    then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;

    return query select
      v_existing.id,
      false,
      v_existing.status,
      v_existing.start_time,
      v_existing.salon_id,
      v_context.service_name::text,
      v_name;
    return;
  end if;

  if v_phone is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_context.salon_id::text || ':phone:' || v_phone, 0));
  end if;
  if v_email is not null then
    perform pg_advisory_xact_lock(hashtextextended(v_context.salon_id::text || ':email:' || v_email, 0));
  end if;

  if v_phone is not null then
    select client.id into v_client_by_phone
    from public.clients as client
    where client.salon_id = v_context.salon_id
      and regexp_replace(btrim(coalesce(client.phone, '')), '[[:space:]()-]', '', 'g') = v_phone
    order by client.created_at
    limit 1;
  end if;

  if v_email is not null then
    select client.id into v_client_by_email
    from public.clients as client
    where client.salon_id = v_context.salon_id
      and lower(btrim(coalesce(client.email, ''))) = v_email
    order by client.created_at
    limit 1;
  end if;

  if v_client_by_phone is not null
    and v_client_by_email is not null
    and v_client_by_phone <> v_client_by_email
  then
    raise exception 'CLIENT_CONFLICT' using errcode = 'P0001';
  end if;

  v_client_id := coalesce(v_client_by_phone, v_client_by_email);
  if v_client_id is null then
    insert into public.clients (salon_id, full_name, phone, email, source)
    values (v_context.salon_id, v_name, v_phone, v_email, 'manual')
    returning id into v_client_id;
  end if;

  begin
    insert into public.appointments (
      salon_id, client_id, employee_id, primary_service_id,
      start_time, end_time, duration_minutes, buffer_minutes,
      price, currency, status, payment_status, booking_source,
      customer_note, idempotency_key
    ) values (
      v_context.salon_id, v_client_id, v_context.employee_id, p_service_id,
      p_start_time, v_end_time, v_duration, v_buffer,
      v_price, v_context.currency, 'pending', 'unpaid', 'manual',
      v_note, p_idempotency_key
    ) returning id into v_appointment_id;

    insert into public.appointment_services (
      appointment_id, service_id, service_name_snapshot,
      duration_minutes_snapshot, price_snapshot, sort_order
    ) values (
      v_appointment_id, p_service_id, v_context.service_name,
      v_duration, v_price, 0
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;
      if v_constraint_name <> 'appointments_idempotency_key_uidx' then
        raise;
      end if;

      select appointment.id, appointment.salon_id, appointment.employee_id,
        appointment.primary_service_id, appointment.start_time, appointment.status
      into v_existing
      from public.appointments as appointment
      where appointment.idempotency_key = p_idempotency_key
      limit 1;

      if not found
        or v_existing.salon_id <> v_context.salon_id
        or v_existing.employee_id is distinct from v_context.employee_id
        or v_existing.primary_service_id is distinct from p_service_id
        or v_existing.start_time <> p_start_time
      then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
      end if;

      return query select v_existing.id, false, v_existing.status,
        v_existing.start_time, v_existing.salon_id,
        v_context.service_name::text, v_name;
      return;
  end;

  return query select v_appointment_id, true,
    'pending'::public.appointment_status, p_start_time,
    v_context.salon_id, v_context.service_name::text, v_name;
end;
$$;


ALTER FUNCTION "public"."create_employee_appointment_atomic"("p_profile_id" "uuid", "p_service_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_customer_note" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."employees" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "profile_id" "uuid",
    "full_name" "text" NOT NULL,
    "display_name" "text",
    "public_slug" "text",
    "bio" "text",
    "position" "text",
    "avatar_url" "text",
    "phone" "text",
    "email" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "is_bookable" boolean DEFAULT true NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employees_full_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "full_name")) > 0))
);


ALTER TABLE "public"."employees" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_employee_with_entitlement"("p_salon_id" "uuid", "p_full_name" "text", "p_display_name" "text" DEFAULT NULL::"text", "p_position" "text" DEFAULT NULL::"text", "p_phone" "text" DEFAULT NULL::"text", "p_email" "text" DEFAULT NULL::"text", "p_bio" "text" DEFAULT NULL::"text") RETURNS "public"."employees"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  employee_limit integer;
  active_employee_count integer;
  created_employee public.employees;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'UNAUTHORIZED';
  end if;

  if not exists (
    select 1 from public.salons s
    where s.id = p_salon_id and s.owner_id = auth.uid()
  ) and not exists (
    select 1 from public.salon_members sm
    where sm.salon_id = p_salon_id
      and sm.profile_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'manager')
  ) then
    raise exception using errcode = '42501', message = 'FORBIDDEN';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_salon_id::text, 0));

  select p.max_employees into employee_limit
  from public.subscriptions sub
  join public.plans p on p.id = sub.plan_id
  where sub.salon_id = p_salon_id;

  if not found then
    raise exception using errcode = 'P0001', message = 'ENTITLEMENTS_NOT_CONFIGURED';
  end if;

  if employee_limit is not null then
    select count(*) into active_employee_count
    from public.employees e
    where e.salon_id = p_salon_id and e.is_active = true;

    if active_employee_count >= employee_limit then
      raise exception using errcode = 'P0001', message = 'EMPLOYEE_LIMIT_REACHED';
    end if;
  end if;

  insert into public.employees (
    salon_id, full_name, display_name, position, phone, email, bio
  ) values (
    p_salon_id, p_full_name, p_display_name, p_position, p_phone, p_email, p_bio
  )
  returning * into created_employee;

  return created_employee;
end;
$$;


ALTER FUNCTION "public"."create_employee_with_entitlement"("p_salon_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_position" "text", "p_phone" "text", "p_email" "text", "p_bio" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_notification_recipients"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
begin
  -- Every salon event has an owner recipient. The active owner membership is
  -- included as a compatibility source, while UNION and the unique constraint
  -- guarantee a single recipient when both sources point to the same profile.
  insert into public.notification_recipients (
    notification_id,
    profile_id
  )
  select new.id, owner_recipient.profile_id
  from (
    select salon.owner_id as profile_id
    from public.salons as salon
    where salon.id = new.salon_id
      and salon.owner_id is not null

    union

    select membership.profile_id
    from public.salon_members as membership
    where membership.salon_id = new.salon_id
      and membership.role = 'owner'::public.salon_member_role
      and membership.status = 'active'::public.member_status
  ) as owner_recipient
  join public.profiles as profile
    on profile.id = owner_recipient.profile_id
  on conflict (notification_id, profile_id) do nothing;

  -- Appointment events are additionally routed only to the assigned employee.
  -- Unknown/admin event types intentionally stop at the owner recipient above.
  if new.type::text in (
    'appointment_created',
    'appointment_cancelled',
    'appointment_confirmed',
    'appointment_completed',
    'appointment_rescheduled',
    'appointment_no_show'
  )
    and new.entity_type = 'appointment'
    and new.entity_id is not null
  then
    insert into public.notification_recipients (
      notification_id,
      profile_id
    )
    select new.id, employee.profile_id
    from public.appointments as appointment
    join public.employees as employee
      on employee.id = appointment.employee_id
     and employee.salon_id = appointment.salon_id
     and employee.profile_id is not null
    join public.salon_members as membership
      on membership.salon_id = appointment.salon_id
     and membership.profile_id = employee.profile_id
     and membership.role = 'employee'::public.salon_member_role
     and membership.status = 'active'::public.member_status
    where appointment.id::text = new.entity_id::text
      and appointment.salon_id = new.salon_id
    on conflict (notification_id, profile_id) do nothing;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."create_notification_recipients"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_public_booking_atomic"("p_salon_slug" "text", "p_service_id" "uuid", "p_employee_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_idempotency_key" "uuid") RETURNS TABLE("appointment_id" "uuid", "was_created" boolean, "booked_service_name" "text", "appointment_start" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_salon_id uuid;
  v_service record;
  v_employee_service record;
  v_client_id uuid;
  v_appointment_id uuid;
  v_existing record;
  v_duration_minutes integer;
  v_buffer_minutes integer;
  v_price numeric;
  v_end_time timestamptz;
  v_constraint_name text;
  v_phone text := nullif(btrim(p_customer_phone), '');
  v_email text := nullif(btrim(p_customer_email), '');
begin
  if p_idempotency_key is null then
    raise exception 'Idempotency key is required.' using errcode = '22023';
  end if;

  if length(btrim(coalesce(p_customer_full_name, ''))) < 2 then
    raise exception 'Customer name is required.' using errcode = '22023';
  end if;

  if v_phone is null and v_email is null then
    raise exception 'Phone or email is required.' using errcode = '22023';
  end if;

  if p_start_time <= now() then
    raise exception 'Appointment must be in the future.' using errcode = '22023';
  end if;

  select
    appointment.id,
    appointment.salon_id,
    appointment.primary_service_id,
    appointment.employee_id,
    appointment.start_time,
    salon.slug,
    coalesce(snapshot.service_name_snapshot, service.name) as service_name
  into v_existing
  from public.appointments appointment
  join public.salons salon on salon.id = appointment.salon_id
  left join public.appointment_services snapshot
    on snapshot.appointment_id = appointment.id
   and snapshot.sort_order = 0
  left join public.services service
    on service.id = appointment.primary_service_id
  where appointment.idempotency_key = p_idempotency_key
  limit 1;

  if found then
    if v_existing.slug <> p_salon_slug
      or v_existing.primary_service_id <> p_service_id
      or v_existing.employee_id <> p_employee_id
      or v_existing.start_time <> p_start_time
    then
      raise exception 'Idempotency key was reused for another booking.'
        using errcode = '22023';
    end if;

    return query
    select
      v_existing.id,
      false,
      v_existing.service_name,
      v_existing.start_time;
    return;
  end if;

  select salon.id
  into v_salon_id
  from public.salons salon
  where salon.slug = p_salon_slug
    and salon.status = 'active'
    and salon.booking_enabled = true
    and salon.online_booking_enabled = true;

  if v_salon_id is null then
    raise exception 'Public booking is not available.' using errcode = '22023';
  end if;

  select
    service.id,
    service.name,
    service.duration_minutes,
    coalesce(service.buffer_minutes, 0) as buffer_minutes,
    service.price,
    service.currency
  into v_service
  from public.services service
  where service.id = p_service_id
    and service.salon_id = v_salon_id
    and service.is_active = true
    and service.is_public = true;

  if not found then
    raise exception 'Selected service is not available.' using errcode = '22023';
  end if;

  select
    relation.custom_duration_minutes,
    relation.custom_price
  into v_employee_service
  from public.employee_services relation
  join public.employees employee
    on employee.id = relation.employee_id
   and employee.salon_id = v_salon_id
   and employee.is_active = true
   and employee.is_bookable = true
   and employee.is_public = true
  where relation.salon_id = v_salon_id
    and relation.employee_id = p_employee_id
    and relation.service_id = p_service_id
    and relation.is_active = true
  limit 1;

  if not found then
    raise exception 'Selected employee is not available.' using errcode = '22023';
  end if;

  v_duration_minutes := coalesce(
    v_employee_service.custom_duration_minutes,
    v_service.duration_minutes
  );
  v_buffer_minutes := v_service.buffer_minutes;
  v_price := coalesce(v_employee_service.custom_price, v_service.price);
  v_end_time := p_start_time
    + make_interval(mins => v_duration_minutes + v_buffer_minutes);

  begin
    if v_phone is not null then
      select client.id
      into v_client_id
      from public.clients client
      where client.salon_id = v_salon_id
        and client.phone = v_phone
      limit 1;
    end if;

    if v_client_id is null and v_email is not null then
      select client.id
      into v_client_id
      from public.clients client
      where client.salon_id = v_salon_id
        and client.email = v_email
      limit 1;
    end if;

    if v_client_id is null then
      insert into public.clients (
        salon_id,
        full_name,
        phone,
        email,
        source
      )
      values (
        v_salon_id,
        btrim(p_customer_full_name),
        v_phone,
        v_email,
        'public'
      )
      returning id into v_client_id;
    end if;

    insert into public.appointments (
      salon_id,
      client_id,
      employee_id,
      primary_service_id,
      start_time,
      end_time,
      duration_minutes,
      buffer_minutes,
      price,
      currency,
      status,
      payment_status,
      booking_source,
      idempotency_key
    )
    values (
      v_salon_id,
      v_client_id,
      p_employee_id,
      p_service_id,
      p_start_time,
      v_end_time,
      v_duration_minutes,
      v_buffer_minutes,
      v_price,
      v_service.currency,
      'pending',
      'unpaid',
      'public',
      p_idempotency_key
    )
    returning id into v_appointment_id;

    insert into public.appointment_services (
      appointment_id,
      service_id,
      service_name_snapshot,
      duration_minutes_snapshot,
      price_snapshot,
      sort_order
    )
    values (
      v_appointment_id,
      p_service_id,
      v_service.name,
      v_duration_minutes,
      v_price,
      0
    );
  exception
    when unique_violation then
      get stacked diagnostics v_constraint_name = constraint_name;

      if v_constraint_name <> 'appointments_idempotency_key_uidx' then
        raise;
      end if;

      select
        appointment.id,
        appointment.salon_id,
        appointment.primary_service_id,
        appointment.employee_id,
        appointment.start_time,
        salon.slug,
        coalesce(snapshot.service_name_snapshot, service.name) as service_name
      into v_existing
      from public.appointments appointment
      join public.salons salon on salon.id = appointment.salon_id
      left join public.appointment_services snapshot
        on snapshot.appointment_id = appointment.id
       and snapshot.sort_order = 0
      left join public.services service
        on service.id = appointment.primary_service_id
      where appointment.idempotency_key = p_idempotency_key
      limit 1;

      if not found then
        raise;
      end if;

      if v_existing.slug <> p_salon_slug
        or v_existing.primary_service_id <> p_service_id
        or v_existing.employee_id <> p_employee_id
        or v_existing.start_time <> p_start_time
      then
        raise exception 'Idempotency key was reused for another booking.'
          using errcode = '22023';
      end if;

      return query
      select
        v_existing.id,
        false,
        v_existing.service_name,
        v_existing.start_time;
      return;
  end;

  return query
  select
    v_appointment_id,
    true,
    v_service.name::text,
    p_start_time;
end;
$$;


ALTER FUNCTION "public"."create_public_booking_atomic"("p_salon_slug" "text", "p_service_id" "uuid", "p_employee_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_idempotency_key" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_trial_subscription_for_new_salon"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  pro_plan_id uuid;
begin
  select id into pro_plan_id
  from public.plans
  where slug = 'pro'
  limit 1;

  if pro_plan_id is null then
    raise exception 'PRO_PLAN_NOT_CONFIGURED';
  end if;

  insert into public.subscriptions (
    salon_id,
    plan_id,
    status,
    trial_starts_at,
    trial_ends_at
  ) values (
    new.id,
    pro_plan_id,
    'trialing',
    now(),
    now() + interval '14 days'
  )
  on conflict (salon_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."create_trial_subscription_for_new_salon"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select employee.id
  from public.employees as employee
  join public.salon_members as membership
    on membership.salon_id = employee.salon_id
   and membership.profile_id = employee.profile_id
  where employee.salon_id = target_salon_id
    and employee.profile_id = auth.uid()
    and employee.is_active = true
    and membership.profile_id = auth.uid()
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
  limit 1;
$$;


ALTER FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."finalize_claimed_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_now" timestamp with time zone DEFAULT "now"(), "p_provider" "text" DEFAULT NULL::"text", "p_provider_message_id" "text" DEFAULT NULL::"text", "p_error_code" "text" DEFAULT NULL::"text", "p_error_message" "text" DEFAULT NULL::"text", "p_next_retry_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d public.appointment_reminder_deliveries%rowtype;
begin
  if p_outcome not in ('sent', 'retry_scheduled', 'failed', 'cancelled') then
    raise exception 'INVALID_FINALIZATION_OUTCOME' using errcode = '22023';
  end if;
  if p_error_message is not null and length(p_error_message) > 1000 then
    raise exception 'ERROR_MESSAGE_TOO_LONG' using errcode = '22023';
  end if;

  select * into d from public.appointment_reminder_deliveries
  where id = p_delivery_id for update;
  if not found or d.status <> 'processing' or d.claim_token is distinct from p_claim_token then
    return false;
  end if;

  if p_outcome = 'sent' then
    if p_provider is null or p_provider_message_id is null then
      raise exception 'PROVIDER_RESULT_REQUIRED' using errcode = '22023';
    end if;
    update public.appointment_reminder_deliveries
    set status = 'sent', provider = p_provider,
        provider_message_id = p_provider_message_id, sent_at = p_now,
        last_error_code = null, last_error_message = null,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
    update public.appointments a
    set reminder_sent_at = p_now
    where a.id = d.appointment_id and a.salon_id = d.salon_id
      and a.start_time = d.appointment_start_snapshot
      and a.status in ('pending', 'confirmed');
  elsif p_outcome = 'retry_scheduled' then
    if p_next_retry_at is null or p_next_retry_at <= p_now then
      raise exception 'INVALID_RETRY_TIME' using errcode = '22023';
    end if;
    update public.appointment_reminder_deliveries
    set status = 'retry_scheduled', next_retry_at = p_next_retry_at,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null
    where id = d.id;
  elsif p_outcome = 'failed' then
    update public.appointment_reminder_deliveries
    set status = 'failed', failed_at = p_now,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
  else
    update public.appointment_reminder_deliveries
    set status = 'cancelled', cancelled_at = p_now,
        last_error_code = p_error_code, last_error_message = p_error_message,
        lease_expires_at = null, claim_token = null, next_retry_at = null
    where id = d.id;
  end if;
  return true;
end; $$;


ALTER FUNCTION "public"."finalize_claimed_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_now" timestamp with time zone, "p_provider" "text", "p_provider_message_id" "text", "p_error_code" "text", "p_error_message" "text", "p_next_retry_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") RETURNS TABLE("id" "uuid", "full_name" "text", "phone" "text", "email" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  select distinct
    client.id,
    client.full_name,
    client.phone,
    client.email
  from public.clients as client
  join public.appointments as appointment
    on appointment.client_id = client.id
   and appointment.salon_id = client.salon_id
  where client.salon_id = target_salon_id
    and appointment.employee_id = public.current_employee_id(target_salon_id);
$$;


ALTER FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_owner_clients_page_v1"("p_salon_id" "uuid", "p_page" integer, "p_page_size" integer, "p_search" "text", "p_status" "text", "p_sort" "text", "p_month_start_utc" timestamp with time zone, "p_month_end_utc" timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  v_offset integer;
  v_result jsonb;
begin
  if p_salon_id is null
    or p_page < 1
    or p_page_size < 1
    or p_page_size > 100
    or p_sort not in ('newest', 'oldest', 'name_asc', 'name_desc', 'most_visits', 'highest_spend')
    or p_status not in ('all', 'active', 'blocked', 'archived')
    or p_month_start_utc is null
    or p_month_end_utc is null
    or p_month_start_utc >= p_month_end_utc
  then
    raise exception 'INVALID_CLIENTS_QUERY' using errcode = '22023';
  end if;

  if not exists (select 1 from public.salons where id = p_salon_id) then
    raise exception 'SALON_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_offset := (p_page - 1) * p_page_size;

  with completed_metrics as (
    select
      appointment.client_id,
      count(*)::integer as completed_visits,
      coalesce(sum(appointment.price), 0)::numeric as completed_revenue,
      max(appointment.start_time) as last_completed_visit
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
    group by appointment.client_id
  ),
  favorite_service_counts as (
    select
      appointment.client_id,
      snapshot.service_id,
      snapshot.service_name_snapshot,
      count(*)::integer as completed_count,
      row_number() over (
        partition by appointment.client_id
        order by count(*) desc, snapshot.service_name_snapshot, snapshot.service_id
      ) as rank
    from public.appointments as appointment
    join public.appointment_services as snapshot
      on snapshot.appointment_id = appointment.id
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
    group by appointment.client_id, snapshot.service_id, snapshot.service_name_snapshot
  ),
  filtered_clients as (
    select
      client.id,
      client.salon_id,
      client.full_name,
      client.phone,
      client.email,
      client.status::text as status,
      client.source,
      client.created_at,
      coalesce(metric.completed_visits, 0) as completed_visits,
      coalesce(metric.completed_revenue, 0) as completed_revenue,
      metric.last_completed_visit,
      favorite.service_id as favorite_service_id,
      favorite.service_name_snapshot as favorite_service_name,
      favorite.completed_count as favorite_service_count
    from public.clients as client
    left join completed_metrics as metric on metric.client_id = client.id
    left join favorite_service_counts as favorite
      on favorite.client_id = client.id
     and favorite.rank = 1
    where client.salon_id = p_salon_id
      and (p_status = 'all' or client.status::text = p_status)
      and (
        nullif(btrim(p_search), '') is null
        or client.full_name ilike '%' || btrim(p_search) || '%'
        or coalesce(client.phone, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(client.email, '') ilike '%' || btrim(p_search) || '%'
      )
  ),
  page_rows as (
    select *
    from filtered_clients
    order by
      case when p_sort = 'newest' then created_at end desc nulls last,
      case when p_sort = 'oldest' then created_at end asc nulls last,
      case when p_sort = 'name_asc' then lower(full_name) end asc nulls last,
      case when p_sort = 'name_desc' then lower(full_name) end desc nulls last,
      case when p_sort = 'most_visits' then completed_visits end desc nulls last,
      case when p_sort = 'highest_spend' then completed_revenue end desc nulls last,
      id
    offset v_offset
    limit p_page_size
  ),
  month_completed as (
    select appointment.client_id, appointment.price
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.start_time >= p_month_start_utc
      and appointment.start_time < p_month_end_utc
  ),
  salon_client_metrics as (
    select count(*)::integer as clients_with_visits,
           count(*) filter (where completed_visits >= 2)::integer as returning_clients
    from completed_metrics
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', client.id,
        'salonId', client.salon_id,
        'fullName', client.full_name,
        'phone', client.phone,
        'email', client.email,
        'status', client.status,
        'source', client.source,
        'createdAt', client.created_at,
        'completedVisits', client.completed_visits,
        'completedRevenue', client.completed_revenue,
        'lastCompletedVisit', client.last_completed_visit,
        'favoriteService', case when client.favorite_service_name is null then null else jsonb_build_object(
          'serviceId', client.favorite_service_id,
          'name', client.favorite_service_name,
          'count', client.favorite_service_count
        ) end,
        'recentVisits', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', visit.id,
            'startTime', visit.start_time,
            'serviceName', visit.service_name,
            'price', visit.price
          ) order by visit.start_time desc)
          from (
            select appointment.id, appointment.start_time,
                   coalesce(snapshot.service_name_snapshot, service.name, 'Bez usluge') as service_name,
                   coalesce(appointment.price, 0) as price
            from public.appointments as appointment
            left join public.appointment_services as snapshot
              on snapshot.appointment_id = appointment.id and snapshot.sort_order = 0
            left join public.services as service on service.id = appointment.primary_service_id
            where appointment.salon_id = p_salon_id
              and appointment.client_id = client.id
              and appointment.status = 'completed'::public.appointment_status
            order by appointment.start_time desc
            limit 5
          ) as visit
        ), '[]'::jsonb)
      )) from page_rows as client
    ), '[]'::jsonb),
    'page', p_page,
    'pageSize', p_page_size,
    'totalCount', (select count(*) from filtered_clients),
    'kpis', jsonb_build_object(
      'totalClients', (select count(*) from public.clients where salon_id = p_salon_id),
      'newClientsThisMonth', (select count(*) from public.clients where salon_id = p_salon_id and created_at >= p_month_start_utc and created_at < p_month_end_utc),
      'visitsThisMonth', (select count(*) from month_completed),
      'revenueThisMonth', (select coalesce(sum(price), 0) from month_completed),
      'clientsWithVisits', (select clients_with_visits from salon_client_metrics),
      'returningClients', (select returning_clients from salon_client_metrics)
    )
  ) into v_result;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_owner_clients_page_v1"("p_salon_id" "uuid", "p_page" integer, "p_page_size" integer, "p_search" "text", "p_status" "text", "p_sort" "text", "p_month_start_utc" timestamp with time zone, "p_month_end_utc" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_owner_statistics_v1"("p_salon_id" "uuid", "p_start_utc" timestamp with time zone, "p_end_utc" timestamp with time zone, "p_granularity" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_timezone text;
  v_currency text;
  v_result jsonb;
begin
  if p_salon_id is null
    or p_start_utc is null
    or p_end_utc is null
    or p_start_utc >= p_end_utc
    or p_granularity not in ('day', 'month')
  then
    raise exception 'INVALID_PERIOD' using errcode = '22023';
  end if;

  select
    coalesce(nullif(salon.timezone, ''), 'Europe/Belgrade'),
    coalesce(nullif(salon.default_currency, ''), 'RSD')
  into v_timezone, v_currency
  from public.salons as salon
  where salon.id = p_salon_id;

  if not found then
    raise exception 'SALON_NOT_FOUND' using errcode = 'P0001';
  end if;

  with
  period_appointments as materialized (
    select appointment.*
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.start_time >= p_start_utc
      and appointment.start_time < p_end_utc
  ),
  completed_history as materialized (
    select
      appointment.id,
      appointment.client_id,
      appointment.start_time,
      row_number() over (
        partition by appointment.client_id
        order by appointment.start_time, appointment.id
      ) as completed_ordinal
    from public.appointments as appointment
    where appointment.salon_id = p_salon_id
      and appointment.status = 'completed'::public.appointment_status
      and appointment.client_id is not null
      and appointment.start_time < p_end_utc
  ),
  overview_values as (
    select
      coalesce(sum(appointment.price) filter (
        where appointment.status = 'completed'::public.appointment_status
      ), 0) as completed_revenue,
      count(*) filter (
        where appointment.status = 'completed'::public.appointment_status
      ) as completed_appointments,
      count(*) filter (
        where appointment.status = 'no_show'::public.appointment_status
      ) as no_show_appointments
    from period_appointments as appointment
  ),
  client_values as (
    select
      count(distinct history.client_id) filter (
        where history.completed_ordinal = 1
          and history.start_time >= p_start_utc
          and history.start_time < p_end_utc
      ) as new_clients,
      count(distinct history.client_id) filter (
        where history.completed_ordinal >= 2
      ) as returning_clients,
      count(*) filter (
        where history.completed_ordinal >= 2
          and history.start_time >= p_start_utc
          and history.start_time < p_end_utc
      ) as returning_visits
    from completed_history as history
  ),
  trend_rows as (
    select
      case
        when p_granularity = 'month' then
          to_char(date_trunc('month', timezone(v_timezone, appointment.start_time)), 'YYYY-MM')
        else
          to_char(date_trunc('day', timezone(v_timezone, appointment.start_time)), 'YYYY-MM-DD')
      end as bucket,
      coalesce(sum(appointment.price), 0) as revenue,
      count(*) as completed_appointments
    from period_appointments as appointment
    where appointment.status = 'completed'::public.appointment_status
    group by 1
    order by 1
  ),
  source_rows as (
    select
      coalesce(appointment.booking_source::text, 'unknown') as source,
      count(*) as source_count
    from period_appointments as appointment
    group by 1
    order by source_count desc, source
  ),
  service_rows as (
    select
      coalesce(snapshot.service_id::text, 'snapshot:' || lower(snapshot.service_name_snapshot)) as service_key,
      (array_agg(
        snapshot.service_name_snapshot
        order by appointment.start_time desc, snapshot.sort_order, snapshot.id
      ))[1] as service_name,
      count(*) as completed_count,
      coalesce(sum(snapshot.price_snapshot), 0) as revenue
    from period_appointments as appointment
    join public.appointment_services as snapshot
      on snapshot.appointment_id = appointment.id
    where appointment.status = 'completed'::public.appointment_status
    group by 1
    order by revenue desc, completed_count desc, service_name
    limit 10
  ),
  employee_rows as (
    select
      appointment.employee_id,
      coalesce(employee.display_name, employee.full_name, 'Nepoznat zaposleni') as employee_name,
      count(*) filter (where appointment.status = 'completed'::public.appointment_status) as completed,
      count(*) filter (where appointment.status = 'confirmed'::public.appointment_status) as confirmed,
      count(*) filter (where appointment.status = 'cancelled'::public.appointment_status) as cancelled,
      count(*) filter (where appointment.status = 'no_show'::public.appointment_status) as no_show,
      coalesce(sum(appointment.price) filter (
        where appointment.status = 'completed'::public.appointment_status
      ), 0) as revenue
    from period_appointments as appointment
    left join public.employees as employee
      on employee.id = appointment.employee_id
     and employee.salon_id = p_salon_id
    group by appointment.employee_id, employee.display_name, employee.full_name
    order by revenue desc, completed desc, employee_name
  ),
  top_client_rows as (
    select
      appointment.client_id,
      coalesce(client.full_name, 'Nepoznat klijent') as client_name,
      count(*) as completed_visits,
      coalesce(sum(appointment.price), 0) as revenue
    from period_appointments as appointment
    left join public.clients as client
      on client.id = appointment.client_id
     and client.salon_id = p_salon_id
    where appointment.status = 'completed'::public.appointment_status
    group by appointment.client_id, client.full_name
    order by revenue desc, completed_visits desc, client_name
    limit 10
  )
  select jsonb_build_object(
    'overview', jsonb_build_object(
      'completedRevenue', overview.completed_revenue,
      'completedAppointments', overview.completed_appointments,
      'newClients', clients.new_clients,
      'returningClients', clients.returning_clients,
      'returningVisits', clients.returning_visits,
      'noShowRate', case
        when overview.completed_appointments + overview.no_show_appointments = 0 then 0
        else round(
          overview.no_show_appointments::numeric * 100 /
          (overview.completed_appointments + overview.no_show_appointments),
          2
        )
      end,
      'currency', v_currency
    ),
    'trend', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucket', trend.bucket,
        'revenue', trend.revenue,
        'completedAppointments', trend.completed_appointments
      ) order by trend.bucket)
      from trend_rows as trend
    ), '[]'::jsonb),
    'appointments', jsonb_build_object(
      'total', (select count(*) from period_appointments),
      'byStatus', jsonb_build_object(
        'pending', (select count(*) from period_appointments where status = 'pending'::public.appointment_status),
        'confirmed', (select count(*) from period_appointments where status = 'confirmed'::public.appointment_status),
        'completed', (select count(*) from period_appointments where status = 'completed'::public.appointment_status),
        'cancelled', (select count(*) from period_appointments where status = 'cancelled'::public.appointment_status),
        'no_show', (select count(*) from period_appointments where status = 'no_show'::public.appointment_status)
      ),
      'bySource', coalesce((
        select jsonb_agg(jsonb_build_object(
          'source', source.source,
          'count', source.source_count
        ) order by source.source_count desc, source.source)
        from source_rows as source
      ), '[]'::jsonb)
    ),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
        'serviceKey', service.service_key,
        'serviceName', service.service_name,
        'completedCount', service.completed_count,
        'revenue', service.revenue
      ) order by service.revenue desc, service.completed_count desc)
      from service_rows as service
    ), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
        'employeeId', employee.employee_id,
        'employeeName', employee.employee_name,
        'completed', employee.completed,
        'confirmed', employee.confirmed,
        'cancelled', employee.cancelled,
        'noShow', employee.no_show,
        'revenue', employee.revenue
      ) order by employee.revenue desc, employee.completed desc)
      from employee_rows as employee
    ), '[]'::jsonb),
    'clients', jsonb_build_object(
      'topClients', coalesce((
        select jsonb_agg(jsonb_build_object(
          'clientId', client.client_id,
          'clientName', client.client_name,
          'completedVisits', client.completed_visits,
          'revenue', client.revenue
        ) order by client.revenue desc, client.completed_visits desc)
        from top_client_rows as client
      ), '[]'::jsonb)
    )
  )
  into v_result
  from overview_values as overview
  cross join client_values as clients;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."get_owner_statistics_v1"("p_salon_id" "uuid", "p_start_utc" timestamp with time zone, "p_end_utc" timestamp with time zone, "p_granularity" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_salon_reminder_usage"("p_salon_id" "uuid", "p_at" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("salon_id" "uuid", "period_start" timestamp with time zone, "period_end" timestamp with time zone, "accepted_count" bigint, "max_monthly_reminders" integer, "remaining" integer)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_count bigint;
  v_limit integer;
begin
  select p.period_start, p.period_end
    into v_start, v_end
  from public.reminder_usage_period(p_salon_id, p_at) p;

  select plan.max_monthly_reminders
    into v_limit
  from public.subscriptions sub
  join public.plans plan on plan.id = sub.plan_id
  where sub.salon_id = p_salon_id;

  select count(*) into v_count
  from public.appointment_reminder_deliveries d
  where d.salon_id = p_salon_id
    and d.sent_at is not null
    and d.provider_message_id is not null
    and d.sent_at >= v_start
    and d.sent_at < v_end;

  return query select p_salon_id, v_start, v_end, v_count, v_limit,
    case when v_limit is null then null
      else greatest(v_limit - v_count::integer, 0) end;
end; $$;


ALTER FUNCTION "public"."get_salon_reminder_usage"("p_salon_id" "uuid", "p_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_simulation_schema_contract"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
  with audit as (
    select
      exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'employee_services'
          and indexname = 'employee_services_unique_pair'
          and indexdef ilike '%unique%employee_id%service_id%'
      ) as employee_service_unique,
      exists (
        select 1
        from pg_catalog.pg_indexes
        where schemaname = 'public'
          and tablename = 'appointments'
          and indexname = 'appointments_idempotency_key_uidx'
          and indexdef ilike '%unique%idempotency_key%'
      ) as appointment_idempotency_unique,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointments'::pg_catalog.regclass
          and conname = 'appointments_employee_time_no_overlap'
          and contype = 'x'
      ) as appointment_overlap_exclusion,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_appointment_id_fkey'
          and contype = 'f'
      ) as snapshot_appointment_fk,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_service_id_fkey'
          and contype = 'f'
      ) as snapshot_service_fk,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_duration_positive'
          and contype = 'c'
      ) as snapshot_duration_check,
      exists (
        select 1
        from pg_catalog.pg_constraint
        where conrelid = 'public.appointment_services'::pg_catalog.regclass
          and conname = 'appointment_services_price_non_negative'
          and contype = 'c'
      ) as snapshot_price_check
  )
  select jsonb_build_object(
    'ready',
      employee_service_unique
      and appointment_idempotency_unique
      and appointment_overlap_exclusion
      and snapshot_appointment_fk
      and snapshot_service_fk
      and snapshot_duration_check
      and snapshot_price_check,
    'guards', jsonb_build_object(
      'employeeServiceUnique', employee_service_unique,
      'appointmentIdempotencyUnique', appointment_idempotency_unique,
      'appointmentOverlapExclusion', appointment_overlap_exclusion,
      'snapshotAppointmentFk', snapshot_appointment_fk,
      'snapshotServiceFk', snapshot_service_fk,
      'snapshotDurationCheck', snapshot_duration_check,
      'snapshotPriceCheck', snapshot_price_check
    )
  )
  from audit;
$$;


ALTER FUNCTION "public"."get_simulation_schema_contract"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, full_name, email, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    coalesce(new.email, ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_simulation_appointment_batch"("p_salon_id" "uuid", "p_appointments" "jsonb") RETURNS TABLE("inserted_count" integer, "existing_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_item jsonb;
  v_existing public.appointments%rowtype;
  v_context record;
  v_schedule record;
  v_id uuid;
  v_snapshot_id uuid;
  v_client_id uuid;
  v_employee_id uuid;
  v_service_id uuid;
  v_start timestamptz;
  v_end timestamptz;
  v_duration integer;
  v_buffer integer;
  v_price numeric;
  v_status public.appointment_status;
  v_source public.booking_source;
  v_idempotency_key uuid;
  v_timezone text;
  v_local_start timestamp;
  v_local_end timestamp;
begin
  inserted_count := 0;
  existing_count := 0;

  if p_salon_id is null
    or jsonb_typeof(p_appointments) <> 'array'
    or jsonb_array_length(p_appointments) < 1
    or jsonb_array_length(p_appointments) > 500
  then
    raise exception 'INVALID_SIMULATION_APPOINTMENT_BATCH' using errcode = '22023';
  end if;

  select coalesce(nullif(timezone, ''), 'Europe/Belgrade')
    into v_timezone
  from public.salons
  where id = p_salon_id;
  if not found then
    raise exception 'SIMULATION_SALON_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_item in select value from jsonb_array_elements(p_appointments)
  loop
    v_id := (v_item ->> 'id')::uuid;
    v_snapshot_id := (v_item ->> 'snapshot_id')::uuid;
    v_client_id := (v_item ->> 'client_id')::uuid;
    v_employee_id := (v_item ->> 'employee_id')::uuid;
    v_service_id := (v_item ->> 'service_id')::uuid;
    v_start := (v_item ->> 'start_time')::timestamptz;
    v_end := (v_item ->> 'end_time')::timestamptz;
    v_duration := (v_item ->> 'duration_minutes')::integer;
    v_buffer := (v_item ->> 'buffer_minutes')::integer;
    v_price := (v_item ->> 'price')::numeric;
    v_status := (v_item ->> 'status')::public.appointment_status;
    v_source := (v_item ->> 'booking_source')::public.booking_source;
    v_idempotency_key := (v_item ->> 'idempotency_key')::uuid;

    if v_status not in (
      'completed'::public.appointment_status,
      'cancelled'::public.appointment_status,
      'no_show'::public.appointment_status
    ) or v_start >= now() or v_end <= v_start then
      raise exception 'INVALID_SIMULATION_APPOINTMENT' using errcode = '22023';
    end if;

    if not exists (
      select 1 from public.clients
      where id = v_client_id and salon_id = p_salon_id
    ) then
      raise exception 'SIMULATION_CLIENT_NOT_FOUND' using errcode = 'P0001';
    end if;

    select
      employee.id as employee_id,
      service.id as service_id,
      service.name as service_name,
      coalesce(relation.custom_duration_minutes, service.duration_minutes) as duration_minutes,
      coalesce(service.buffer_minutes, 0) as buffer_minutes,
      coalesce(relation.custom_price, service.price) as price
    into v_context
    from public.employees as employee
    join public.employee_services as relation
      on relation.salon_id = employee.salon_id
     and relation.employee_id = employee.id
     and relation.service_id = v_service_id
     and relation.is_active = true
    join public.services as service
      on service.id = relation.service_id
     and service.salon_id = employee.salon_id
     and service.is_active = true
    where employee.id = v_employee_id
      and employee.salon_id = p_salon_id
      and employee.is_active = true;

    if not found
      or v_duration <> v_context.duration_minutes
      or v_buffer <> v_context.buffer_minutes
      or v_price <> v_context.price
      or v_end <> v_start + make_interval(mins => v_duration + v_buffer)
      or (v_item ->> 'service_name_snapshot') <> v_context.service_name
    then
      raise exception 'SIMULATION_SERVICE_ASSIGNMENT_MISMATCH' using errcode = 'P0001';
    end if;

    v_local_start := timezone(v_timezone, v_start);
    v_local_end := timezone(v_timezone, v_end);
    select working.* into v_schedule
    from public.working_hours as working
    where working.salon_id = p_salon_id
      and working.day_of_week = extract(dow from v_local_start)::integer
      and (working.employee_id = v_employee_id or working.employee_id is null)
    order by (working.employee_id is null)
    limit 1;

    if not found
      or not v_schedule.is_working_day
      or v_local_start::date <> v_local_end::date
      or v_local_start::time < v_schedule.opens_at
      or v_local_end::time > v_schedule.closes_at
      or (
        v_schedule.break_starts_at is not null
        and v_schedule.break_ends_at is not null
        and v_local_start::time < v_schedule.break_ends_at
        and v_local_end::time > v_schedule.break_starts_at
      )
    then
      raise exception 'SIMULATION_OUTSIDE_WORKING_HOURS' using errcode = 'P0001';
    end if;

    if exists (
      select 1 from public.closures as closure
      where closure.salon_id = p_salon_id
        and (closure.employee_id is null or closure.employee_id = v_employee_id)
        and tstzrange(closure.starts_at, closure.ends_at, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      raise exception 'SIMULATION_CLOSURE_CONFLICT' using errcode = 'P0001';
    end if;

    select * into v_existing from public.appointments where id = v_id;
    if found then
      if v_existing.salon_id <> p_salon_id
        or v_existing.client_id is distinct from v_client_id
        or v_existing.employee_id is distinct from v_employee_id
        or v_existing.primary_service_id is distinct from v_service_id
        or v_existing.start_time <> v_start
        or v_existing.end_time <> v_end
        or v_existing.duration_minutes <> v_duration
        or v_existing.buffer_minutes <> v_buffer
        or v_existing.price <> v_price
        or v_existing.status <> v_status
        or v_existing.booking_source <> v_source
        or v_existing.idempotency_key is distinct from v_idempotency_key
        or not exists (
          select 1 from public.appointment_services
          where id = v_snapshot_id
            and appointment_id = v_id
            and service_id = v_service_id
            and service_name_snapshot = v_context.service_name
            and duration_minutes_snapshot = v_duration
            and price_snapshot = v_price
            and sort_order = 0
        )
      then
        raise exception 'SIMULATION_APPOINTMENT_ID_CONFLICT' using errcode = 'P0001';
      end if;
      existing_count := existing_count + 1;
      continue;
    end if;

    if exists (
      select 1 from public.appointments as appointment
      where appointment.employee_id = v_employee_id
        and appointment.id <> v_id
        and tstzrange(appointment.start_time, appointment.end_time, '[)') && tstzrange(v_start, v_end, '[)')
    ) then
      raise exception 'SIMULATION_APPOINTMENT_OVERLAP' using errcode = '23P01';
    end if;

    insert into public.appointments (
      id, salon_id, client_id, employee_id, primary_service_id,
      start_time, end_time, duration_minutes, buffer_minutes,
      price, currency, status, payment_status, booking_source,
      cancellation_reason, cancelled_at, cancelled_by,
      confirmed_at, completed_at, created_at, idempotency_key
    ) values (
      v_id, p_salon_id, v_client_id, v_employee_id, v_service_id,
      v_start, v_end, v_duration, v_buffer,
      v_price, (v_item ->> 'currency'), v_status, 'unpaid'::public.payment_status, v_source,
      nullif(v_item ->> 'cancellation_reason', ''),
      nullif(v_item ->> 'cancelled_at', '')::timestamptz,
      nullif(v_item ->> 'cancelled_by', ''),
      nullif(v_item ->> 'confirmed_at', '')::timestamptz,
      nullif(v_item ->> 'completed_at', '')::timestamptz,
      (v_item ->> 'created_at')::timestamptz,
      v_idempotency_key
    );

    insert into public.appointment_services (
      id, appointment_id, service_id, service_name_snapshot,
      duration_minutes_snapshot, price_snapshot, sort_order,
      created_at
    ) values (
      v_snapshot_id, v_id, v_service_id, v_context.service_name,
      v_duration, v_price, 0,
      (v_item ->> 'created_at')::timestamptz
    );
    inserted_count := inserted_count + 1;
  end loop;

  return next;
end;
$$;


ALTER FUNCTION "public"."insert_simulation_appointment_batch"("p_salon_id" "uuid", "p_appointments" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_simulation_client_batch"("p_salon_id" "uuid", "p_clients" "jsonb") RETURNS TABLE("inserted_count" integer, "existing_count" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_item jsonb;
  v_existing public.clients%rowtype;
  v_id uuid;
  v_name text;
  v_phone text;
  v_email text;
  v_source text;
  v_created_at timestamptz;
begin
  inserted_count := 0;
  existing_count := 0;

  if p_salon_id is null
    or jsonb_typeof(p_clients) <> 'array'
    or jsonb_array_length(p_clients) < 1
    or jsonb_array_length(p_clients) > 500
    or not exists (select 1 from public.salons where id = p_salon_id)
  then
    raise exception 'INVALID_SIMULATION_CLIENT_BATCH' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_clients)
  loop
    v_id := (v_item ->> 'id')::uuid;
    v_name := btrim(coalesce(v_item ->> 'full_name', ''));
    v_phone := nullif(regexp_replace(btrim(v_item ->> 'phone'), '[[:space:]()-]', '', 'g'), '');
    v_email := nullif(lower(btrim(v_item ->> 'email')), '');
    v_source := coalesce(nullif(btrim(v_item ->> 'source'), ''), 'manual');
    v_created_at := (v_item ->> 'created_at')::timestamptz;

    if length(v_name) < 2 or (v_phone is null and v_email is null) then
      raise exception 'INVALID_SIMULATION_CLIENT' using errcode = '22023';
    end if;

    if exists (
      select 1
      from public.clients as client
      where client.salon_id = p_salon_id
        and client.id <> v_id
        and (
          (v_phone is not null and regexp_replace(btrim(coalesce(client.phone, '')), '[[:space:]()-]', '', 'g') = v_phone)
          or (v_email is not null and lower(btrim(coalesce(client.email, ''))) = v_email)
        )
    ) then
      raise exception 'SIMULATION_CLIENT_CONTACT_CONFLICT' using errcode = 'P0001';
    end if;

    select * into v_existing
    from public.clients
    where id = v_id;

    if found then
      if v_existing.salon_id <> p_salon_id
        or v_existing.full_name <> v_name
        or v_existing.phone is distinct from v_phone
        or v_existing.email is distinct from v_email
      then
        raise exception 'SIMULATION_CLIENT_ID_CONFLICT' using errcode = 'P0001';
      end if;
      existing_count := existing_count + 1;
    else
      insert into public.clients (
        id, salon_id, full_name, phone, email, source, status, created_at
      ) values (
        v_id, p_salon_id, v_name, v_phone, v_email, v_source,
        'active'::public.client_status, v_created_at
      );
      inserted_count := inserted_count + 1;
    end if;
  end loop;

  return next;
end;
$$;


ALTER FUNCTION "public"."insert_simulation_client_batch"("p_salon_id" "uuid", "p_clients" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_salon_member"("target_salon_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.salon_members sm
    where sm.salon_id = target_salon_id
      and sm.profile_id = auth.uid()
      and sm.status = 'active'
  ) or exists (
    select 1
    from public.salons s
    where s.id = target_salon_id
      and s.owner_id = auth.uid()
  ) or public.is_super_admin();
$$;


ALTER FUNCTION "public"."is_salon_member"("target_salon_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_salon_owner_or_manager"("target_salon_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.salon_members sm
    where sm.salon_id = target_salon_id
      and sm.profile_id = auth.uid()
      and sm.status = 'active'
      and sm.role in ('owner', 'manager')
  ) or exists (
    select 1
    from public.salons s
    where s.id = target_salon_id
      and s.owner_id = auth.uid()
  ) or public.is_super_admin();
$$;


ALTER FUNCTION "public"."is_salon_owner_or_manager"("target_salon_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.global_role = 'super_admin'
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owns_salon"("target_salon_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.salons s
    where s.id = target_salon_id
      and s.owner_id = auth.uid()
  ) or public.is_super_admin();
$$;


ALTER FUNCTION "public"."owns_salon"("target_salon_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."preview_due_appointment_reminders"("p_salon_id" "uuid" DEFAULT NULL::"uuid", "p_batch_size" integer DEFAULT 50, "p_now" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("salon_id" "uuid", "appointment_id" "uuid", "scheduled_for" timestamp with time zone, "eligible" boolean, "reason" "text", "recipient_masked" "text", "salon_timezone" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
  select a.salon_id, a.id, a.start_time - make_interval(hours => coalesce(rs.hours_before,24)),
    (sub.status in ('active','trialing') and (sub.status <> 'trialing' or sub.trial_ends_at is null or sub.trial_ends_at > p_now)
      and (sub.status <> 'active' or sub.current_period_ends_at is null or sub.current_period_ends_at > p_now)
      and plan.sms_reminders_enabled and rs.enabled and rs.channel='sms'
      and a.status in ('pending','confirmed') and a.start_time > p_now
      and a.start_time - make_interval(hours => rs.hours_before) <= p_now
      and length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) >= 8
      and (usage.remaining is null or usage.remaining > 0)) as eligible,
    case when rs.id is null or not rs.enabled then 'REMINDERS_DISABLED'
      when sub.id is null or sub.status not in ('active','trialing') or (sub.status='trialing' and sub.trial_ends_at is not null and sub.trial_ends_at <= p_now) then 'SUBSCRIPTION_INACTIVE'
      when not coalesce(plan.sms_reminders_enabled,false) then 'ENTITLEMENT_REQUIRED'
      when a.status not in ('pending','confirmed') then 'APPOINTMENT_NOT_ELIGIBLE'
      when a.start_time <= p_now then 'APPOINTMENT_IN_PAST'
      when a.start_time - make_interval(hours => rs.hours_before) > p_now then 'NOT_DUE'
      when length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) < 8 then 'MISSING_RECIPIENT'
      when usage.remaining = 0 then 'QUOTA_EXHAUSTED'
      else 'ELIGIBLE' end,
    case when length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) >= 8
      then left(regexp_replace(c.phone,'[^0-9]','','g'),4) || '*****' || right(regexp_replace(c.phone,'[^0-9]','','g'),3) else null end,
    coalesce(nullif(s.timezone,''),'Europe/Belgrade')
  from public.appointments a join public.salons s on s.id=a.salon_id
  left join public.clients c on c.id=a.client_id and c.salon_id=a.salon_id
  left join public.salon_reminder_settings rs on rs.salon_id=a.salon_id
  left join public.subscriptions sub on sub.salon_id=a.salon_id
  left join public.plans plan on plan.id=sub.plan_id
  left join lateral public.get_salon_reminder_usage(a.salon_id,p_now) usage on true
  where (p_salon_id is null or a.salon_id=p_salon_id)
    and a.start_time > p_now - interval '7 days'
  order by a.start_time limit least(greatest(p_batch_size,1),500);
$$;


ALTER FUNCTION "public"."preview_due_appointment_reminders"("p_salon_id" "uuid", "p_batch_size" integer, "p_now" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."recover_accepted_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_sent_at" timestamp with time zone DEFAULT "now"()) RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare d public.appointment_reminder_deliveries%rowtype;
begin
  if p_provider is null or p_provider_message_id is null then return false; end if;
  select * into d from public.appointment_reminder_deliveries where id = p_delivery_id for update;
  if not found then return false; end if;
  if d.status = 'sent' and d.provider = p_provider and d.provider_message_id = p_provider_message_id then
    return true;
  end if;
  if d.status <> 'processing' or d.claim_token is distinct from p_claim_token then return false; end if;

  update public.appointment_reminder_deliveries
  set status = 'sent', provider = p_provider, provider_message_id = p_provider_message_id,
      sent_at = p_sent_at, last_error_code = null, last_error_message = null,
      lease_expires_at = null, claim_token = null, next_retry_at = null
  where id = d.id;
  update public.appointments a set reminder_sent_at = p_sent_at
  where a.id = d.appointment_id and a.salon_id = d.salon_id
    and a.start_time = d.appointment_start_snapshot and a.status in ('pending', 'confirmed');
  return true;
end; $$;


ALTER FUNCTION "public"."recover_accepted_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_sent_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."reminder_usage_period"("p_salon_id" "uuid", "p_at" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("period_start" timestamp with time zone, "period_end" timestamp with time zone)
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare v_start timestamptz; v_end timestamptz; v_tz text; v_local timestamp;
begin
  select sub.current_period_starts_at, sub.current_period_ends_at
    into v_start, v_end from public.subscriptions sub where sub.salon_id = p_salon_id;
  if v_start is not null and v_end is not null and p_at >= v_start and p_at < v_end then
    return query select v_start, v_end; return;
  end if;
  select coalesce(nullif(s.timezone, ''), 'Europe/Belgrade') into v_tz from public.salons s where s.id = p_salon_id;
  if v_tz is null then raise exception 'SALON_NOT_FOUND' using errcode = 'P0001'; end if;
  v_local := date_trunc('month', p_at at time zone v_tz);
  return query select v_local at time zone v_tz, (v_local + interval '1 month') at time zone v_tz;
end; $$;


ALTER FUNCTION "public"."reminder_usage_period"("p_salon_id" "uuid", "p_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_reminder_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO ''
    AS $$
begin new.updated_at = now(); return new; end; $$;


ALTER FUNCTION "public"."set_reminder_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_employee_appointment_status"("p_appointment_id" "uuid", "p_profile_id" "uuid", "p_next_status" "public"."appointment_status") RETURNS TABLE("appointment_id" "uuid", "salon_id" "uuid", "previous_status" "public"."appointment_status", "new_status" "public"."appointment_status")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog', 'public', 'pg_temp'
    AS $$
declare
  v_salon_id uuid;
  v_employee_id uuid;
  v_appointment public.appointments%rowtype;
begin
  select appointment.*
    into v_appointment
  from public.appointments as appointment
  where appointment.id = p_appointment_id
  for update;

  if not found then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select membership.salon_id, employee.id
    into v_salon_id, v_employee_id
  from public.salon_members as membership
  join public.employees as employee
    on employee.salon_id = membership.salon_id
   and employee.profile_id = membership.profile_id
  where membership.salon_id = v_appointment.salon_id
    and membership.profile_id = p_profile_id
    and membership.role = 'employee'::public.salon_member_role
    and membership.status = 'active'::public.member_status
    and employee.is_active = true
  limit 1;

  if v_employee_id is null
    or v_appointment.employee_id is distinct from v_employee_id
  then
    raise exception 'APPOINTMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_appointment.status = p_next_status then
    raise exception 'APPOINTMENT_ALREADY_UPDATED' using errcode = 'P0001';
  end if;

  if not (
    (v_appointment.status = 'pending'::public.appointment_status
      and p_next_status in (
        'confirmed'::public.appointment_status,
        'cancelled'::public.appointment_status
      ))
    or
    (v_appointment.status = 'confirmed'::public.appointment_status
      and p_next_status in (
        'completed'::public.appointment_status,
        'cancelled'::public.appointment_status,
        'no_show'::public.appointment_status
      ))
  ) then
    raise exception 'INVALID_STATUS_TRANSITION' using errcode = 'P0001';
  end if;

  update public.appointments as appointment
  set status = p_next_status
  where appointment.id = v_appointment.id
    and appointment.status = v_appointment.status;

  if not found then
    raise exception 'APPOINTMENT_ALREADY_UPDATED' using errcode = 'P0001';
  end if;

  return query
  select
    v_appointment.id,
    v_appointment.salon_id,
    v_appointment.status,
    p_next_status;
end;
$$;


ALTER FUNCTION "public"."update_employee_appointment_status"("p_appointment_id" "uuid", "p_profile_id" "uuid", "p_next_status" "public"."appointment_status") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_claimed_reminder_for_send"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_now" timestamp with time zone DEFAULT "now"()) RETURNS TABLE("is_valid" boolean, "reason" "text", "delivery_id" "uuid", "salon_id" "uuid", "appointment_id" "uuid", "recipient" "text", "appointment_start" timestamp with time zone, "salon_timezone" "text", "salon_name" "text", "service_name" "text", "attempt_count" integer, "max_attempts" integer)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO ''
    AS $$
declare
  d public.appointment_reminder_deliveries%rowtype;
  v_status text;
  v_start timestamptz;
  v_salon_name text;
  v_timezone text;
  v_service_name text;
  v_settings_enabled boolean;
  v_hours_before integer;
  v_subscription_status text;
  v_trial_ends timestamptz;
  v_period_ends timestamptz;
  v_entitled boolean;
  v_limit integer;
  v_used bigint;
  v_reserved bigint;
begin
  select * into d from public.appointment_reminder_deliveries
  where id = p_delivery_id for update;
  if not found then
    return query select false, 'DELIVERY_NOT_FOUND'::text, p_delivery_id,
      null::uuid, null::uuid, null::text, null::timestamptz,
      null::text, null::text, null::text, null::integer, null::integer;
    return;
  end if;

  if d.status <> 'processing' or d.claim_token is distinct from p_claim_token then
    return query select false, 'CLAIM_EXPIRED'::text, d.id, d.salon_id,
      d.appointment_id, null::text, d.appointment_start_snapshot,
      d.salon_timezone_snapshot, null::text, null::text, d.attempt_count, d.max_attempts;
    return;
  end if;
  if d.lease_expires_at is null or d.lease_expires_at <= p_now then
    return query select false, 'CLAIM_EXPIRED'::text, d.id, d.salon_id,
      d.appointment_id, null::text, d.appointment_start_snapshot,
      d.salon_timezone_snapshot, null::text, null::text, d.attempt_count, d.max_attempts;
    return;
  end if;

  select a.status::text, a.start_time, s.name,
    coalesce(nullif(s.timezone, ''), 'Europe/Belgrade'), service.name,
    coalesce(rs.enabled, false), rs.hours_before, sub.status::text,
    sub.trial_ends_at, sub.current_period_ends_at,
    coalesce(plan.sms_reminders_enabled, false), plan.max_monthly_reminders
  into v_status, v_start, v_salon_name, v_timezone, v_service_name,
    v_settings_enabled, v_hours_before, v_subscription_status,
    v_trial_ends, v_period_ends, v_entitled, v_limit
  from public.appointments a
  join public.salons s on s.id = a.salon_id
  left join public.services service on service.id = a.primary_service_id and service.salon_id = a.salon_id
  left join public.salon_reminder_settings rs on rs.salon_id = a.salon_id and rs.channel = d.channel
  left join public.subscriptions sub on sub.salon_id = a.salon_id
  left join public.plans plan on plan.id = sub.plan_id
  where a.id = d.appointment_id and a.salon_id = d.salon_id
  for update of a;

  reason := case
    when v_status is null then 'APPOINTMENT_NOT_FOUND'
    when v_status = 'cancelled' then 'APPOINTMENT_CANCELLED'
    when v_status not in ('pending', 'confirmed') then 'APPOINTMENT_STATUS_CHANGED'
    when v_start <= p_now then 'APPOINTMENT_IN_PAST'
    when v_start is distinct from d.appointment_start_snapshot
      or v_hours_before is null
      or d.scheduled_for is distinct from v_start - make_interval(hours => v_hours_before)
      then 'APPOINTMENT_RESCHEDULED'
    when not v_settings_enabled then 'REMINDERS_DISABLED'
    when not v_entitled then 'ENTITLEMENT_REQUIRED'
    when v_subscription_status not in ('active', 'trialing') then 'SUBSCRIPTION_INACTIVE'
    when v_subscription_status = 'trialing' and v_trial_ends is not null and v_trial_ends <= p_now then 'SUBSCRIPTION_INACTIVE'
    when v_subscription_status = 'active' and v_period_ends is not null and v_period_ends <= p_now then 'SUBSCRIPTION_INACTIVE'
    when d.recipient_snapshot is null or btrim(d.recipient_snapshot) = '' then 'MISSING_RECIPIENT'
    else 'ELIGIBLE'
  end;

  if reason = 'ELIGIBLE' and v_limit is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reminder-quota:' || d.salon_id::text, 0));
    select u.accepted_count into v_used from public.get_salon_reminder_usage(d.salon_id, p_now) u;
    select count(*) into v_reserved
    from public.appointment_reminder_deliveries other
    where other.salon_id = d.salon_id and other.status = 'processing'
      and other.lease_expires_at > p_now;
    if v_used + v_reserved > v_limit then reason := 'QUOTA_EXHAUSTED'; end if;
  end if;

  if reason <> 'ELIGIBLE' then
    update public.appointment_reminder_deliveries
    set status = 'cancelled', cancelled_at = p_now, lease_expires_at = null,
        claim_token = null, last_error_code = reason
    where id = d.id and status = 'processing' and claim_token = p_claim_token;
  end if;

  return query select reason = 'ELIGIBLE', reason, d.id, d.salon_id,
    d.appointment_id,
    case when reason = 'ELIGIBLE' then d.recipient_snapshot else null end,
    d.appointment_start_snapshot, v_timezone, v_salon_name, v_service_name,
    d.attempt_count, d.max_attempts;
end; $$;


ALTER FUNCTION "public"."validate_claimed_reminder_for_send"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_now" timestamp with time zone) OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ai_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "assistant_name" "text" DEFAULT 'Rezervo AI'::"text" NOT NULL,
    "tone" "text" DEFAULT 'friendly'::"text" NOT NULL,
    "greeting_message" "text",
    "fallback_message" "text",
    "auto_reply_enabled" boolean DEFAULT true NOT NULL,
    "auto_booking_enabled" boolean DEFAULT true NOT NULL,
    "human_takeover_enabled" boolean DEFAULT true NOT NULL,
    "booking_confirmation_required" boolean DEFAULT true NOT NULL,
    "max_suggestions_per_reply" integer DEFAULT 3 NOT NULL,
    "min_notice_minutes" integer DEFAULT 60 NOT NULL,
    "max_booking_days_ahead" integer DEFAULT 30 NOT NULL,
    "max_daily_bookings_per_client" integer DEFAULT 2 NOT NULL,
    "max_active_bookings_per_client" integer DEFAULT 3 NOT NULL,
    "allow_reschedule" boolean DEFAULT true NOT NULL,
    "allow_cancellation" boolean DEFAULT true NOT NULL,
    "cancellation_notice_hours" integer DEFAULT 24 NOT NULL,
    "reminder_enabled" boolean DEFAULT true NOT NULL,
    "reminder_hours_before" integer DEFAULT 24 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ai_settings_active_bookings_positive" CHECK (("max_active_bookings_per_client" > 0)),
    CONSTRAINT "ai_settings_booking_days_positive" CHECK (("max_booking_days_ahead" > 0)),
    CONSTRAINT "ai_settings_cancellation_notice_non_negative" CHECK (("cancellation_notice_hours" >= 0)),
    CONSTRAINT "ai_settings_daily_bookings_positive" CHECK (("max_daily_bookings_per_client" > 0)),
    CONSTRAINT "ai_settings_max_suggestions_positive" CHECK (("max_suggestions_per_reply" > 0)),
    CONSTRAINT "ai_settings_notice_non_negative" CHECK (("min_notice_minutes" >= 0)),
    CONSTRAINT "ai_settings_reminder_hours_non_negative" CHECK (("reminder_hours_before" >= 0))
);


ALTER TABLE "public"."ai_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_reminder_deliveries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "reminder_type" "text" DEFAULT 'appointment_reminder'::"text" NOT NULL,
    "channel" "public"."reminder_channel" NOT NULL,
    "scheduled_for" timestamp with time zone NOT NULL,
    "appointment_start_snapshot" timestamp with time zone NOT NULL,
    "recipient_snapshot" "text",
    "salon_timezone_snapshot" "text" NOT NULL,
    "status" "public"."reminder_delivery_status" DEFAULT 'pending'::"public"."reminder_delivery_status" NOT NULL,
    "attempt_count" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "claimed_at" timestamp with time zone,
    "lease_expires_at" timestamp with time zone,
    "next_retry_at" timestamp with time zone,
    "last_attempt_at" timestamp with time zone,
    "provider" "text",
    "provider_message_id" "text",
    "sent_at" timestamp with time zone,
    "delivered_at" timestamp with time zone,
    "failed_at" timestamp with time zone,
    "skipped_at" timestamp with time zone,
    "cancelled_at" timestamp with time zone,
    "last_error_code" "text",
    "last_error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claim_token" "uuid",
    "provider_status_id" integer,
    "provider_status_group" "text",
    "provider_status_name" "text",
    "provider_error_code" "text",
    "provider_error_name" "text",
    "provider_error_permanent" boolean,
    "provider_done_at" timestamp with time zone,
    "delivery_report_received_at" timestamp with time zone,
    CONSTRAINT "reminder_delivery_attempts_valid" CHECK ((("attempt_count" >= 0) AND (("max_attempts" >= 1) AND ("max_attempts" <= 20)))),
    CONSTRAINT "reminder_delivery_error_message_size" CHECK ((("last_error_message" IS NULL) OR ("length"("last_error_message") <= 1000))),
    CONSTRAINT "reminder_delivery_provider_metadata_size" CHECK (((("provider_status_group" IS NULL) OR ("length"("provider_status_group") <= 128)) AND (("provider_status_name" IS NULL) OR ("length"("provider_status_name") <= 128)) AND (("provider_error_code" IS NULL) OR ("length"("provider_error_code") <= 128)) AND (("provider_error_name" IS NULL) OR ("length"("provider_error_name") <= 128)))),
    CONSTRAINT "reminder_delivery_type_v1" CHECK (("reminder_type" = 'appointment_reminder'::"text"))
);


ALTER TABLE "public"."appointment_reminder_deliveries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointment_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "appointment_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "service_name_snapshot" "text" NOT NULL,
    "duration_minutes_snapshot" integer NOT NULL,
    "price_snapshot" numeric NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "appointment_services_duration_positive" CHECK (("duration_minutes_snapshot" > 0)),
    CONSTRAINT "appointment_services_price_non_negative" CHECK (("price_snapshot" >= (0)::numeric))
);


ALTER TABLE "public"."appointment_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."appointments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "resource_id" "uuid",
    "primary_service_id" "uuid",
    "start_time" timestamp with time zone NOT NULL,
    "end_time" timestamp with time zone NOT NULL,
    "duration_minutes" integer NOT NULL,
    "buffer_minutes" integer DEFAULT 0 NOT NULL,
    "price" numeric NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "status" "public"."appointment_status" DEFAULT 'pending'::"public"."appointment_status" NOT NULL,
    "payment_status" "public"."payment_status" DEFAULT 'unpaid'::"public"."payment_status" NOT NULL,
    "booking_source" "public"."booking_source" DEFAULT 'manual'::"public"."booking_source" NOT NULL,
    "customer_note" "text",
    "internal_note" "text",
    "cancellation_reason" "text",
    "cancelled_at" timestamp with time zone,
    "cancelled_by" "text",
    "confirmed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "reminder_sent_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "idempotency_key" "uuid",
    CONSTRAINT "appointments_buffer_non_negative" CHECK (("buffer_minutes" >= 0)),
    CONSTRAINT "appointments_duration_positive" CHECK (("duration_minutes" > 0)),
    CONSTRAINT "appointments_price_non_negative" CHECK (("price" >= (0)::numeric)),
    CONSTRAINT "appointments_valid_time" CHECK (("start_time" < "end_time"))
);


ALTER TABLE "public"."appointments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."audit_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "actor_type" "public"."audit_actor_type" NOT NULL,
    "actor_profile_id" "uuid",
    "client_id" "uuid",
    "entity_type" "text" NOT NULL,
    "entity_id" "uuid" NOT NULL,
    "action" "text" NOT NULL,
    "old_values" "jsonb",
    "new_values" "jsonb",
    "description" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "audit_logs_action_not_empty" CHECK (("length"(TRIM(BOTH FROM "action")) > 0)),
    CONSTRAINT "audit_logs_entity_type_not_empty" CHECK (("length"(TRIM(BOTH FROM "entity_type")) > 0))
);


ALTER TABLE "public"."audit_logs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "full_name" "text" NOT NULL,
    "phone" "text",
    "email" "text",
    "avatar_url" "text",
    "notes" "text",
    "preferred_employee_id" "uuid",
    "preferred_service_id" "uuid",
    "marketing_consent" boolean DEFAULT false NOT NULL,
    "marketing_consent_at" timestamp with time zone,
    "total_appointments" integer DEFAULT 0 NOT NULL,
    "completed_appointments" integer DEFAULT 0 NOT NULL,
    "cancelled_appointments" integer DEFAULT 0 NOT NULL,
    "no_show_count" integer DEFAULT 0 NOT NULL,
    "total_spent" numeric DEFAULT 0 NOT NULL,
    "last_visit_at" timestamp with time zone,
    "next_appointment_at" timestamp with time zone,
    "status" "public"."client_status" DEFAULT 'active'::"public"."client_status" NOT NULL,
    "source" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "clients_cancelled_appointments_non_negative" CHECK (("cancelled_appointments" >= 0)),
    CONSTRAINT "clients_completed_appointments_non_negative" CHECK (("completed_appointments" >= 0)),
    CONSTRAINT "clients_full_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "full_name")) > 0)),
    CONSTRAINT "clients_no_show_count_non_negative" CHECK (("no_show_count" >= 0)),
    CONSTRAINT "clients_total_appointments_non_negative" CHECK (("total_appointments" >= 0)),
    CONSTRAINT "clients_total_spent_non_negative" CHECK (("total_spent" >= (0)::numeric))
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."closures" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "title" "text" NOT NULL,
    "reason" "text",
    "starts_at" timestamp with time zone NOT NULL,
    "ends_at" timestamp with time zone NOT NULL,
    "is_full_day" boolean DEFAULT false NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "closures_title_not_empty" CHECK (("length"(TRIM(BOTH FROM "title")) > 0)),
    CONSTRAINT "closures_valid_range" CHECK (("starts_at" < "ends_at"))
);


ALTER TABLE "public"."closures" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."conversations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "channel" "text" NOT NULL,
    "external_conversation_id" "text",
    "status" "public"."conversation_status" DEFAULT 'open'::"public"."conversation_status" NOT NULL,
    "ai_status" "public"."ai_conversation_status" DEFAULT 'active'::"public"."ai_conversation_status" NOT NULL,
    "intent" "text",
    "last_message_preview" "text",
    "last_message_at" timestamp with time zone,
    "assigned_member_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "conversations_channel_not_empty" CHECK (("length"(TRIM(BOTH FROM "channel")) > 0))
);


ALTER TABLE "public"."conversations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."employee_services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "service_id" "uuid" NOT NULL,
    "custom_duration_minutes" integer,
    "custom_price" numeric,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "employee_services_custom_duration_positive" CHECK ((("custom_duration_minutes" IS NULL) OR ("custom_duration_minutes" > 0))),
    CONSTRAINT "employee_services_custom_price_non_negative" CHECK ((("custom_price" IS NULL) OR ("custom_price" >= (0)::numeric)))
);


ALTER TABLE "public"."employee_services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."integrations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "provider" "text" NOT NULL,
    "status" "public"."integration_status" DEFAULT 'disconnected'::"public"."integration_status" NOT NULL,
    "external_account_id" "text",
    "external_account_name" "text",
    "access_token_encrypted" "text",
    "refresh_token_encrypted" "text",
    "token_expires_at" timestamp with time zone,
    "settings" "jsonb",
    "last_synced_at" timestamp with time zone,
    "error_message" "text",
    "connected_at" timestamp with time zone,
    "disconnected_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "integrations_provider_not_empty" CHECK (("length"(TRIM(BOTH FROM "provider")) > 0))
);


ALTER TABLE "public"."integrations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "conversation_id" "uuid" NOT NULL,
    "client_id" "uuid",
    "sender_type" "public"."message_sender_type" NOT NULL,
    "sender_profile_id" "uuid",
    "content" "text" NOT NULL,
    "message_type" "text" DEFAULT 'text'::"text" NOT NULL,
    "direction" "public"."message_direction" NOT NULL,
    "ai_generated" boolean DEFAULT false NOT NULL,
    "ai_confidence" numeric,
    "related_appointment_id" "uuid",
    "external_message_id" "text",
    "sent_at" timestamp with time zone,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "messages_ai_confidence_valid" CHECK ((("ai_confidence" IS NULL) OR (("ai_confidence" >= (0)::numeric) AND ("ai_confidence" <= (1)::numeric)))),
    CONSTRAINT "messages_content_not_empty" CHECK (("length"(TRIM(BOTH FROM "content")) > 0))
);


ALTER TABLE "public"."messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notification_recipients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "notification_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "notification_recipients_read_state_check" CHECK (((("is_read" = false) AND ("read_at" IS NULL)) OR (("is_read" = true) AND ("read_at" IS NOT NULL))))
);


ALTER TABLE "public"."notification_recipients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "message" "text" NOT NULL,
    "entity_type" "text",
    "entity_id" "uuid",
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "appointment_id" "uuid",
    "client_id" "uuid",
    "amount" numeric NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "type" "public"."payment_type" NOT NULL,
    "status" "public"."payment_record_status" DEFAULT 'pending'::"public"."payment_record_status" NOT NULL,
    "provider" "text",
    "provider_payment_id" "text",
    "paid_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "payments_amount_non_negative" CHECK (("amount" >= (0)::numeric))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."plans" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "monthly_price" numeric NOT NULL,
    "yearly_price" numeric,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "max_employees" integer,
    "max_monthly_bookings" integer,
    "max_ai_messages" integer,
    "ai_receptionist_enabled" boolean DEFAULT false NOT NULL,
    "whatsapp_enabled" boolean DEFAULT false NOT NULL,
    "instagram_enabled" boolean DEFAULT false NOT NULL,
    "analytics_enabled" boolean DEFAULT true NOT NULL,
    "marketing_enabled" boolean DEFAULT false NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "sms_reminders_enabled" boolean DEFAULT false NOT NULL,
    "max_monthly_reminders" integer,
    CONSTRAINT "plans_max_monthly_reminders_non_negative" CHECK ((("max_monthly_reminders" IS NULL) OR ("max_monthly_reminders" >= 0))),
    CONSTRAINT "plans_monthly_price_non_negative" CHECK (("monthly_price" >= (0)::numeric)),
    CONSTRAINT "plans_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "plans_slug_not_empty" CHECK (("length"(TRIM(BOTH FROM "slug")) > 0)),
    CONSTRAINT "plans_yearly_price_non_negative" CHECK ((("yearly_price" IS NULL) OR ("yearly_price" >= (0)::numeric)))
);


ALTER TABLE "public"."plans" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text" DEFAULT ''::"text" NOT NULL,
    "email" "text" NOT NULL,
    "phone" "text",
    "avatar_url" "text",
    "global_role" "public"."global_role" DEFAULT 'user'::"public"."global_role" NOT NULL,
    "username" "text",
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "last_active_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."resources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "description" "text",
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "resources_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "resources_type_not_empty" CHECK (("length"(TRIM(BOTH FROM "type")) > 0))
);


ALTER TABLE "public"."resources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salon_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "profile_id" "uuid" NOT NULL,
    "role" "public"."salon_member_role" DEFAULT 'owner'::"public"."salon_member_role" NOT NULL,
    "status" "public"."member_status" DEFAULT 'active'::"public"."member_status" NOT NULL,
    "invited_by" "uuid",
    "invited_at" timestamp with time zone,
    "joined_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."salon_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salon_reminder_settings" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "enabled" boolean DEFAULT false NOT NULL,
    "channel" "public"."reminder_channel" DEFAULT 'sms'::"public"."reminder_channel" NOT NULL,
    "hours_before" integer DEFAULT 24 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "salon_reminder_settings_hours_range" CHECK ((("hours_before" >= 1) AND ("hours_before" <= 168))),
    CONSTRAINT "salon_reminder_settings_phase_1_sms_only" CHECK (("channel" = 'sms'::"public"."reminder_channel"))
);


ALTER TABLE "public"."salon_reminder_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."salons" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "short_description" "text",
    "logo_url" "text",
    "cover_image_url" "text",
    "phone" "text",
    "email" "text",
    "website_url" "text",
    "address_line" "text",
    "city" "text",
    "country" "text" DEFAULT 'Serbia'::"text" NOT NULL,
    "postal_code" "text",
    "latitude" numeric,
    "longitude" numeric,
    "business_type" "public"."business_type" DEFAULT 'barbershop'::"public"."business_type" NOT NULL,
    "status" "public"."salon_status" DEFAULT 'active'::"public"."salon_status" NOT NULL,
    "timezone" "text" DEFAULT 'Europe/Belgrade'::"text" NOT NULL,
    "default_currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "booking_enabled" boolean DEFAULT true NOT NULL,
    "online_booking_enabled" boolean DEFAULT true NOT NULL,
    "public_booking_url" "text",
    "instagram_url" "text",
    "facebook_url" "text",
    "tiktok_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "onboarding_completed" boolean DEFAULT false NOT NULL,
    "onboarding_step" integer DEFAULT 1 NOT NULL,
    CONSTRAINT "salons_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "salons_slug_not_empty" CHECK (("length"(TRIM(BOTH FROM "slug")) > 0))
);


ALTER TABLE "public"."salons" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_categories" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "service_categories_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0))
);


ALTER TABLE "public"."service_categories" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."services" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "category_id" "uuid",
    "name" "text" NOT NULL,
    "description" "text",
    "duration_minutes" integer NOT NULL,
    "buffer_minutes" integer DEFAULT 0 NOT NULL,
    "price" numeric NOT NULL,
    "currency" "text" DEFAULT 'EUR'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_public" boolean DEFAULT true NOT NULL,
    "color" "text",
    "sort_order" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "category_name" "text",
    CONSTRAINT "services_buffer_non_negative" CHECK (("buffer_minutes" >= 0)),
    CONSTRAINT "services_duration_positive" CHECK (("duration_minutes" > 0)),
    CONSTRAINT "services_name_not_empty" CHECK (("length"(TRIM(BOTH FROM "name")) > 0)),
    CONSTRAINT "services_price_non_negative" CHECK (("price" >= (0)::numeric))
);


ALTER TABLE "public"."services" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."subscriptions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "plan_id" "uuid" NOT NULL,
    "status" "public"."subscription_status" DEFAULT 'trialing'::"public"."subscription_status" NOT NULL,
    "billing_provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "provider_customer_id" "text",
    "provider_subscription_id" "text",
    "trial_starts_at" timestamp with time zone,
    "trial_ends_at" timestamp with time zone,
    "current_period_starts_at" timestamp with time zone,
    "current_period_ends_at" timestamp with time zone,
    "cancel_at_period_end" boolean DEFAULT false NOT NULL,
    "cancelled_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."subscriptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."team_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "employee_id" "uuid" NOT NULL,
    "invited_by" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "status" "text" DEFAULT 'invited'::"text" NOT NULL,
    "auth_user_id" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "accepted_at" timestamp with time zone,
    "expires_at" timestamp with time zone DEFAULT ("now"() + '7 days'::interval) NOT NULL,
    CONSTRAINT "team_invitations_email_normalized" CHECK ((("email" = "lower"("btrim"("email"))) AND ("length"("email") > 3))),
    CONSTRAINT "team_invitations_status_valid" CHECK (("status" = ANY (ARRAY['invited'::"text", 'accepted'::"text", 'expired'::"text", 'revoked'::"text"])))
);


ALTER TABLE "public"."team_invitations" OWNER TO "postgres";


COMMENT ON TABLE "public"."team_invitations" IS 'Server-managed employee invitation lifecycle. No direct browser access.';



CREATE TABLE IF NOT EXISTS "public"."working_hours" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "salon_id" "uuid" NOT NULL,
    "employee_id" "uuid",
    "day_of_week" integer NOT NULL,
    "opens_at" time without time zone NOT NULL,
    "closes_at" time without time zone NOT NULL,
    "break_starts_at" time without time zone,
    "break_ends_at" time without time zone,
    "is_working_day" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "working_hours_valid_break" CHECK (((("break_starts_at" IS NULL) AND ("break_ends_at" IS NULL)) OR (("break_starts_at" IS NOT NULL) AND ("break_ends_at" IS NOT NULL) AND ("break_starts_at" < "break_ends_at")))),
    CONSTRAINT "working_hours_valid_day" CHECK ((("day_of_week" >= 0) AND ("day_of_week" <= 6))),
    CONSTRAINT "working_hours_valid_time" CHECK (("opens_at" < "closes_at"))
);


ALTER TABLE "public"."working_hours" OWNER TO "postgres";


ALTER TABLE ONLY "public"."ai_settings"
    ADD CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ai_settings"
    ADD CONSTRAINT "ai_settings_salon_id_key" UNIQUE ("salon_id");



ALTER TABLE ONLY "public"."appointment_reminder_deliveries"
    ADD CONSTRAINT "appointment_reminder_deliveries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_employee_time_no_overlap" EXCLUDE USING "gist" ("employee_id" WITH =, "tstzrange"("start_time", "end_time", '[)'::"text") WITH &&) WHERE ((("employee_id" IS NOT NULL) AND ("status" = ANY (ARRAY['pending'::"public"."appointment_status", 'confirmed'::"public"."appointment_status"]))));



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."closures"
    ADD CONSTRAINT "closures_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_unique_external" UNIQUE ("salon_id", "channel", "external_conversation_id");



ALTER TABLE ONLY "public"."employee_services"
    ADD CONSTRAINT "employee_services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employee_services"
    ADD CONSTRAINT "employee_services_unique_pair" UNIQUE ("employee_id", "service_id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_public_slug_unique_per_salon" UNIQUE ("salon_id", "public_slug");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_unique_provider_per_salon" UNIQUE ("salon_id", "provider");



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notification_recipients"
    ADD CONSTRAINT "notification_recipients_notification_profile_key" UNIQUE ("notification_id", "profile_id");



ALTER TABLE ONLY "public"."notification_recipients"
    ADD CONSTRAINT "notification_recipients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."plans"
    ADD CONSTRAINT "plans_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_username_key" UNIQUE ("username");



ALTER TABLE ONLY "public"."appointment_reminder_deliveries"
    ADD CONSTRAINT "reminder_delivery_schedule_unique" UNIQUE ("appointment_id", "reminder_type", "channel", "scheduled_for");



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_unique_name_per_salon" UNIQUE ("salon_id", "name");



ALTER TABLE ONLY "public"."salon_members"
    ADD CONSTRAINT "salon_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salon_members"
    ADD CONSTRAINT "salon_members_unique_profile" UNIQUE ("salon_id", "profile_id");



ALTER TABLE ONLY "public"."salon_reminder_settings"
    ADD CONSTRAINT "salon_reminder_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salon_reminder_settings"
    ADD CONSTRAINT "salon_reminder_settings_salon_id_key" UNIQUE ("salon_id");



ALTER TABLE ONLY "public"."salons"
    ADD CONSTRAINT "salons_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."salons"
    ADD CONSTRAINT "salons_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_unique_name_per_salon" UNIQUE ("salon_id", "name");



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_salon_id_key" UNIQUE ("salon_id");



ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_unique_day" UNIQUE ("salon_id", "employee_id", "day_of_week");



CREATE UNIQUE INDEX "appointments_idempotency_key_uidx" ON "public"."appointments" USING "btree" ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);



CREATE INDEX "appointments_reminder_due_lookup_idx" ON "public"."appointments" USING "btree" ("start_time", "salon_id") WHERE ("status" = ANY (ARRAY['pending'::"public"."appointment_status", 'confirmed'::"public"."appointment_status"]));



CREATE UNIQUE INDEX "employees_unique_profile_per_salon" ON "public"."employees" USING "btree" ("salon_id", "profile_id") WHERE ("profile_id" IS NOT NULL);



CREATE INDEX "idx_appointment_services_appointment_id" ON "public"."appointment_services" USING "btree" ("appointment_id");



CREATE INDEX "idx_appointment_services_service_id" ON "public"."appointment_services" USING "btree" ("service_id");



CREATE INDEX "idx_appointments_client_start" ON "public"."appointments" USING "btree" ("client_id", "start_time");



CREATE INDEX "idx_appointments_employee_start" ON "public"."appointments" USING "btree" ("employee_id", "start_time");



CREATE INDEX "idx_appointments_resource_start" ON "public"."appointments" USING "btree" ("resource_id", "start_time");



CREATE INDEX "idx_appointments_salon_start" ON "public"."appointments" USING "btree" ("salon_id", "start_time");



CREATE INDEX "idx_audit_logs_entity" ON "public"."audit_logs" USING "btree" ("entity_type", "entity_id");



CREATE INDEX "idx_audit_logs_salon_created" ON "public"."audit_logs" USING "btree" ("salon_id", "created_at");



CREATE INDEX "idx_clients_salon_email" ON "public"."clients" USING "btree" ("salon_id", "email");



CREATE INDEX "idx_clients_salon_phone" ON "public"."clients" USING "btree" ("salon_id", "phone");



CREATE INDEX "idx_closures_employee_start" ON "public"."closures" USING "btree" ("employee_id", "starts_at");



CREATE INDEX "idx_closures_salon_start" ON "public"."closures" USING "btree" ("salon_id", "starts_at");



CREATE INDEX "idx_conversations_salon_client" ON "public"."conversations" USING "btree" ("salon_id", "client_id");



CREATE INDEX "idx_conversations_salon_last_message" ON "public"."conversations" USING "btree" ("salon_id", "last_message_at");



CREATE INDEX "idx_employee_services_employee_id" ON "public"."employee_services" USING "btree" ("employee_id");



CREATE INDEX "idx_employee_services_salon_id" ON "public"."employee_services" USING "btree" ("salon_id");



CREATE INDEX "idx_employee_services_service_id" ON "public"."employee_services" USING "btree" ("service_id");



CREATE INDEX "idx_employees_profile_id" ON "public"."employees" USING "btree" ("profile_id");



CREATE INDEX "idx_employees_salon_id" ON "public"."employees" USING "btree" ("salon_id");



CREATE INDEX "idx_integrations_salon_id" ON "public"."integrations" USING "btree" ("salon_id");



CREATE INDEX "idx_messages_conversation_created" ON "public"."messages" USING "btree" ("conversation_id", "created_at");



CREATE INDEX "idx_messages_salon_created" ON "public"."messages" USING "btree" ("salon_id", "created_at");



CREATE INDEX "idx_notification_recipients_notification_id" ON "public"."notification_recipients" USING "btree" ("notification_id");



CREATE INDEX "idx_notification_recipients_profile_created" ON "public"."notification_recipients" USING "btree" ("profile_id", "created_at" DESC);



CREATE INDEX "idx_notification_recipients_profile_unread" ON "public"."notification_recipients" USING "btree" ("profile_id", "created_at" DESC) WHERE ("is_read" = false);



CREATE INDEX "idx_notifications_created_at" ON "public"."notifications" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_notifications_is_read" ON "public"."notifications" USING "btree" ("is_read");



CREATE INDEX "idx_notifications_salon_id" ON "public"."notifications" USING "btree" ("salon_id");



CREATE INDEX "idx_payments_appointment_id" ON "public"."payments" USING "btree" ("appointment_id");



CREATE INDEX "idx_payments_client_id" ON "public"."payments" USING "btree" ("client_id");



CREATE INDEX "idx_payments_salon_created" ON "public"."payments" USING "btree" ("salon_id", "created_at");



CREATE INDEX "idx_resources_salon_id" ON "public"."resources" USING "btree" ("salon_id");



CREATE INDEX "idx_salon_members_profile_id" ON "public"."salon_members" USING "btree" ("profile_id");



CREATE INDEX "idx_salon_members_salon_id" ON "public"."salon_members" USING "btree" ("salon_id");



CREATE INDEX "idx_salons_owner_id" ON "public"."salons" USING "btree" ("owner_id");



CREATE INDEX "idx_service_categories_salon_id" ON "public"."service_categories" USING "btree" ("salon_id");



CREATE INDEX "idx_services_category_id" ON "public"."services" USING "btree" ("category_id");



CREATE INDEX "idx_services_salon_id" ON "public"."services" USING "btree" ("salon_id");



CREATE INDEX "idx_team_invitations_auth_user_id" ON "public"."team_invitations" USING "btree" ("auth_user_id") WHERE ("auth_user_id" IS NOT NULL);



CREATE INDEX "idx_team_invitations_salon_id" ON "public"."team_invitations" USING "btree" ("salon_id");



CREATE INDEX "idx_working_hours_employee_id" ON "public"."working_hours" USING "btree" ("employee_id");



CREATE INDEX "idx_working_hours_salon_id" ON "public"."working_hours" USING "btree" ("salon_id");



CREATE INDEX "reminder_deliveries_appointment_history_idx" ON "public"."appointment_reminder_deliveries" USING "btree" ("appointment_id", "created_at" DESC);



CREATE INDEX "reminder_deliveries_claim_token_idx" ON "public"."appointment_reminder_deliveries" USING "btree" ("id", "claim_token") WHERE ("status" = 'processing'::"public"."reminder_delivery_status");



CREATE INDEX "reminder_deliveries_due_idx" ON "public"."appointment_reminder_deliveries" USING "btree" ("scheduled_for", "id") WHERE ("status" = ANY (ARRAY['pending'::"public"."reminder_delivery_status", 'processing'::"public"."reminder_delivery_status"]));



CREATE UNIQUE INDEX "reminder_deliveries_provider_message_uidx" ON "public"."appointment_reminder_deliveries" USING "btree" ("provider", "provider_message_id") WHERE (("provider" IS NOT NULL) AND ("provider_message_id" IS NOT NULL));



CREATE INDEX "reminder_deliveries_retry_idx" ON "public"."appointment_reminder_deliveries" USING "btree" ("next_retry_at", "id") WHERE ("status" = 'retry_scheduled'::"public"."reminder_delivery_status");



CREATE INDEX "reminder_deliveries_salon_usage_idx" ON "public"."appointment_reminder_deliveries" USING "btree" ("salon_id", "sent_at") WHERE (("sent_at" IS NOT NULL) AND ("provider_message_id" IS NOT NULL));



CREATE UNIQUE INDEX "salons_slug_unique_idx" ON "public"."salons" USING "btree" ("slug") WHERE ("slug" IS NOT NULL);



CREATE UNIQUE INDEX "team_invitations_active_email_uidx" ON "public"."team_invitations" USING "btree" ("salon_id", "email") WHERE ("status" = 'invited'::"text");



CREATE UNIQUE INDEX "team_invitations_active_employee_uidx" ON "public"."team_invitations" USING "btree" ("salon_id", "employee_id") WHERE ("status" = 'invited'::"text");



CREATE UNIQUE INDEX "unique_employee_working_day" ON "public"."working_hours" USING "btree" ("salon_id", "employee_id", "day_of_week") WHERE ("employee_id" IS NOT NULL);



CREATE UNIQUE INDEX "unique_salon_default_working_day" ON "public"."working_hours" USING "btree" ("salon_id", "day_of_week") WHERE ("employee_id" IS NULL);



CREATE OR REPLACE TRIGGER "create_notification_recipients_after_insert" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."create_notification_recipients"();



CREATE OR REPLACE TRIGGER "create_trial_subscription_after_salon_insert" AFTER INSERT ON "public"."salons" FOR EACH ROW EXECUTE FUNCTION "public"."create_trial_subscription_for_new_salon"();



CREATE OR REPLACE TRIGGER "reminder_deliveries_updated_at" BEFORE UPDATE ON "public"."appointment_reminder_deliveries" FOR EACH ROW EXECUTE FUNCTION "public"."set_reminder_updated_at"();



CREATE OR REPLACE TRIGGER "salon_reminder_settings_updated_at" BEFORE UPDATE ON "public"."salon_reminder_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_reminder_updated_at"();



CREATE OR REPLACE TRIGGER "set_ai_settings_updated_at" BEFORE UPDATE ON "public"."ai_settings" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_appointments_updated_at" BEFORE UPDATE ON "public"."appointments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_clients_updated_at" BEFORE UPDATE ON "public"."clients" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_closures_updated_at" BEFORE UPDATE ON "public"."closures" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_conversations_updated_at" BEFORE UPDATE ON "public"."conversations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_employees_updated_at" BEFORE UPDATE ON "public"."employees" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_integrations_updated_at" BEFORE UPDATE ON "public"."integrations" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_payments_updated_at" BEFORE UPDATE ON "public"."payments" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_plans_updated_at" BEFORE UPDATE ON "public"."plans" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_resources_updated_at" BEFORE UPDATE ON "public"."resources" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_salons_updated_at" BEFORE UPDATE ON "public"."salons" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_service_categories_updated_at" BEFORE UPDATE ON "public"."service_categories" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_services_updated_at" BEFORE UPDATE ON "public"."services" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_subscriptions_updated_at" BEFORE UPDATE ON "public"."subscriptions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "set_working_hours_updated_at" BEFORE UPDATE ON "public"."working_hours" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."ai_settings"
    ADD CONSTRAINT "ai_settings_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_reminder_deliveries"
    ADD CONSTRAINT "appointment_reminder_deliveries_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_reminder_deliveries"
    ADD CONSTRAINT "appointment_reminder_deliveries_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointment_reminder_deliveries"
    ADD CONSTRAINT "appointment_reminder_deliveries_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."appointment_services"
    ADD CONSTRAINT "appointment_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_primary_service_id_fkey" FOREIGN KEY ("primary_service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_resource_id_fkey" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."appointments"
    ADD CONSTRAINT "appointments_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_actor_profile_id_fkey" FOREIGN KEY ("actor_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."audit_logs"
    ADD CONSTRAINT "audit_logs_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_preferred_employee_id_fkey" FOREIGN KEY ("preferred_employee_id") REFERENCES "public"."employees"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_preferred_service_id_fkey" FOREIGN KEY ("preferred_service_id") REFERENCES "public"."services"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closures"
    ADD CONSTRAINT "closures_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."closures"
    ADD CONSTRAINT "closures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."closures"
    ADD CONSTRAINT "closures_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_assigned_member_id_fkey" FOREIGN KEY ("assigned_member_id") REFERENCES "public"."salon_members"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."conversations"
    ADD CONSTRAINT "conversations_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_services"
    ADD CONSTRAINT "employee_services_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_services"
    ADD CONSTRAINT "employee_services_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employee_services"
    ADD CONSTRAINT "employee_services_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."employees"
    ADD CONSTRAINT "employees_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."integrations"
    ADD CONSTRAINT "integrations_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_related_appointment_id_fkey" FOREIGN KEY ("related_appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."messages"
    ADD CONSTRAINT "messages_sender_profile_id_fkey" FOREIGN KEY ("sender_profile_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notification_recipients"
    ADD CONSTRAINT "notification_recipients_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "public"."notifications"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notification_recipients"
    ADD CONSTRAINT "notification_recipients_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."resources"
    ADD CONSTRAINT "resources_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salon_members"
    ADD CONSTRAINT "salon_members_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."salon_members"
    ADD CONSTRAINT "salon_members_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salon_members"
    ADD CONSTRAINT "salon_members_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salon_reminder_settings"
    ADD CONSTRAINT "salon_reminder_settings_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."salons"
    ADD CONSTRAINT "salons_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_categories"
    ADD CONSTRAINT "service_categories_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."service_categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."services"
    ADD CONSTRAINT "services_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."subscriptions"
    ADD CONSTRAINT "subscriptions_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_auth_user_id_fkey" FOREIGN KEY ("auth_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."team_invitations"
    ADD CONSTRAINT "team_invitations_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."working_hours"
    ADD CONSTRAINT "working_hours_salon_id_fkey" FOREIGN KEY ("salon_id") REFERENCES "public"."salons"("id") ON DELETE CASCADE;



CREATE POLICY "Authenticated users can create their own salon" ON "public"."salons" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "Users can create notifications for their salon" ON "public"."notifications" FOR INSERT WITH CHECK (("salon_id" IN ( SELECT "salon_members"."salon_id"
   FROM "public"."salon_members"
  WHERE ("salon_members"."profile_id" = "auth"."uid"()))));



ALTER TABLE "public"."ai_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "ai_settings_manage_owner_or_manager" ON "public"."ai_settings" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "ai_settings_select_members" ON "public"."ai_settings" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."appointment_reminder_deliveries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."appointment_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointment_services_manage_owner_or_manager" ON "public"."appointment_services" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments" "appointment"
  WHERE (("appointment"."id" = "appointment_services"."appointment_id") AND "public"."is_salon_owner_or_manager"("appointment"."salon_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."appointments" "appointment"
  WHERE (("appointment"."id" = "appointment_services"."appointment_id") AND "public"."is_salon_owner_or_manager"("appointment"."salon_id")))));



CREATE POLICY "appointment_services_select_employee_own" ON "public"."appointment_services" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."appointments" "appointment"
  WHERE (("appointment"."id" = "appointment_services"."appointment_id") AND ("appointment"."employee_id" = "public"."current_employee_id"("appointment"."salon_id"))))));



ALTER TABLE "public"."appointments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "appointments_manage_owner_or_manager" ON "public"."appointments" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "appointments_select_employee_own" ON "public"."appointments" FOR SELECT TO "authenticated" USING (("employee_id" = "public"."current_employee_id"("salon_id")));



ALTER TABLE "public"."audit_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "audit_logs_insert_members" ON "public"."audit_logs" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_salon_member"("salon_id"));



CREATE POLICY "audit_logs_select_owner_or_manager" ON "public"."audit_logs" FOR SELECT TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id"));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_manage_owner_or_manager" ON "public"."clients" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



ALTER TABLE "public"."closures" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "closures_manage_owner_or_manager" ON "public"."closures" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "closures_select_members" ON "public"."closures" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."conversations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "conversations_manage_members" ON "public"."conversations" TO "authenticated" USING ("public"."is_salon_member"("salon_id")) WITH CHECK ("public"."is_salon_member"("salon_id"));



CREATE POLICY "conversations_select_members" ON "public"."conversations" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."employee_services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employee_services_manage_owner_or_manager" ON "public"."employee_services" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "employee_services_select_members" ON "public"."employee_services" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."employees" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "employees_manage_owner_or_manager" ON "public"."employees" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "employees_select_members" ON "public"."employees" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."integrations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "integrations_manage_owner_or_manager" ON "public"."integrations" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "integrations_select_owner_or_manager" ON "public"."integrations" FOR SELECT TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id"));



ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "messages_manage_members" ON "public"."messages" TO "authenticated" USING ("public"."is_salon_member"("salon_id")) WITH CHECK ("public"."is_salon_member"("salon_id"));



CREATE POLICY "messages_select_members" ON "public"."messages" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."notification_recipients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notification_recipients_select_own" ON "public"."notification_recipients" FOR SELECT TO "authenticated" USING (("profile_id" = "auth"."uid"()));



CREATE POLICY "notification_recipients_update_own" ON "public"."notification_recipients" FOR UPDATE TO "authenticated" USING (("profile_id" = "auth"."uid"())) WITH CHECK (("profile_id" = "auth"."uid"()));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own_recipient" ON "public"."notifications" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."notification_recipients" "recipient"
  WHERE (("recipient"."notification_id" = "notifications"."id") AND ("recipient"."profile_id" = "auth"."uid"())))));



ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payments_manage_owner_or_manager" ON "public"."payments" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "payments_select_members" ON "public"."payments" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."plans" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "plans_select_authenticated" ON "public"."plans" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_select_self_or_same_salon" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."salon_members" "sm1"
     JOIN "public"."salon_members" "sm2" ON (("sm2"."salon_id" = "sm1"."salon_id")))
  WHERE (("sm1"."profile_id" = "auth"."uid"()) AND ("sm2"."profile_id" = "profiles"."id") AND ("sm1"."status" = 'active'::"public"."member_status") AND ("sm2"."status" = 'active'::"public"."member_status"))))));



CREATE POLICY "profiles_update_self" ON "public"."profiles" FOR UPDATE TO "authenticated" USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"())) WITH CHECK ((("id" = "auth"."uid"()) OR "public"."is_super_admin"()));



CREATE POLICY "public_can_read_active_employee_services" ON "public"."employee_services" FOR SELECT TO "anon" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM (("public"."employees" "e"
     JOIN "public"."services" "sv" ON (("sv"."id" = "employee_services"."service_id")))
     JOIN "public"."salons" "s" ON (("s"."id" = "employee_services"."salon_id")))
  WHERE (("e"."id" = "employee_services"."employee_id") AND ("e"."is_active" = true) AND ("e"."is_bookable" = true) AND ("e"."is_public" = true) AND ("sv"."is_active" = true) AND ("sv"."is_public" = true) AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true))))));



CREATE POLICY "public_can_read_active_public_categories" ON "public"."service_categories" FOR SELECT TO "anon" USING ((("is_active" = true) AND (EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "service_categories"."salon_id") AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true))))));



CREATE POLICY "public_can_read_active_public_employees" ON "public"."employees" FOR SELECT TO "anon" USING ((("is_active" = true) AND ("is_bookable" = true) AND ("is_public" = true) AND (EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "employees"."salon_id") AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true))))));



CREATE POLICY "public_can_read_active_public_salons" ON "public"."salons" FOR SELECT TO "anon" USING ((("status" = 'active'::"public"."salon_status") AND ("booking_enabled" = true) AND ("online_booking_enabled" = true)));



CREATE POLICY "public_can_read_active_public_services" ON "public"."services" FOR SELECT TO "anon" USING ((("is_active" = true) AND ("is_public" = true) AND (EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "services"."salon_id") AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true))))));



CREATE POLICY "public_can_read_closures_for_availability" ON "public"."closures" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "closures"."salon_id") AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true)))));



CREATE POLICY "public_can_read_working_hours_for_public_booking" ON "public"."working_hours" FOR SELECT TO "anon" USING ((EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "working_hours"."salon_id") AND ("s"."status" = 'active'::"public"."salon_status") AND ("s"."booking_enabled" = true) AND ("s"."online_booking_enabled" = true)))));



ALTER TABLE "public"."resources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "resources_manage_owner_or_manager" ON "public"."resources" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "resources_select_members" ON "public"."resources" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."salon_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "salon_members_delete_owner" ON "public"."salon_members" FOR DELETE TO "authenticated" USING ("public"."owns_salon"("salon_id"));



CREATE POLICY "salon_members_insert_owner_bootstrap" ON "public"."salon_members" FOR INSERT TO "authenticated" WITH CHECK ((("profile_id" = "auth"."uid"()) AND ("role" = 'owner'::"public"."salon_member_role") AND ("status" = 'active'::"public"."member_status") AND (EXISTS ( SELECT 1
   FROM "public"."salons"
  WHERE (("salons"."id" = "salon_members"."salon_id") AND ("salons"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "salon_members_select_members" ON "public"."salon_members" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



CREATE POLICY "salon_members_update_owner_or_manager" ON "public"."salon_members" FOR UPDATE TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



ALTER TABLE "public"."salon_reminder_settings" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "salon_reminder_settings_owner_manager_read" ON "public"."salon_reminder_settings" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."salons" "owned_salon"
  WHERE (("owned_salon"."id" = "salon_reminder_settings"."salon_id") AND ("owned_salon"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."salon_members" "member"
  WHERE (("member"."salon_id" = "salon_reminder_settings"."salon_id") AND ("member"."profile_id" = "auth"."uid"()) AND ("member"."status" = 'active'::"public"."member_status") AND ("member"."role" = ANY (ARRAY['owner'::"public"."salon_member_role", 'manager'::"public"."salon_member_role"])))))));



ALTER TABLE "public"."salons" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "salons_delete_owner" ON "public"."salons" FOR DELETE TO "authenticated" USING ("public"."owns_salon"("id"));



CREATE POLICY "salons_select_members_or_owner" ON "public"."salons" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."is_salon_member"("id")));



CREATE POLICY "salons_update_owner_or_manager" ON "public"."salons" FOR UPDATE TO "authenticated" USING ("public"."is_salon_owner_or_manager"("id")) WITH CHECK ("public"."is_salon_owner_or_manager"("id"));



ALTER TABLE "public"."service_categories" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_categories_manage_owner_or_manager" ON "public"."service_categories" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "service_categories_select_members" ON "public"."service_categories" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."services" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "services_manage_owner_or_manager" ON "public"."services" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "services_select_members" ON "public"."services" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



ALTER TABLE "public"."subscriptions" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "subscriptions_owner_manager_read" ON "public"."subscriptions" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."salons" "s"
  WHERE (("s"."id" = "subscriptions"."salon_id") AND ("s"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."salon_members" "sm"
  WHERE (("sm"."salon_id" = "subscriptions"."salon_id") AND ("sm"."profile_id" = "auth"."uid"()) AND ("sm"."status" = 'active'::"public"."member_status") AND ("sm"."role" = ANY (ARRAY['owner'::"public"."salon_member_role", 'manager'::"public"."salon_member_role"])))))));



ALTER TABLE "public"."team_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."working_hours" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "working_hours_manage_owner_or_manager" ON "public"."working_hours" TO "authenticated" USING ("public"."is_salon_owner_or_manager"("salon_id")) WITH CHECK ("public"."is_salon_owner_or_manager"("salon_id"));



CREATE POLICY "working_hours_select_members" ON "public"."working_hours" FOR SELECT TO "authenticated" USING ("public"."is_salon_member"("salon_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "private"."invoke_rezervo_reminder_worker"() FROM PUBLIC;



REVOKE ALL ON FUNCTION "public"."accept_team_invitation"("p_invitation_id" "uuid", "p_profile_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."accept_team_invitation"("p_invitation_id" "uuid", "p_profile_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_infobip_sms_delivery_report"("p_provider_message_id" "text", "p_status_id" integer, "p_status_group" "text", "p_status_name" "text", "p_error_code" "text", "p_error_name" "text", "p_error_permanent" boolean, "p_provider_done_at" timestamp with time zone, "p_received_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_infobip_sms_delivery_report"("p_provider_message_id" "text", "p_status_id" integer, "p_status_group" "text", "p_status_name" "text", "p_error_code" "text", "p_error_name" "text", "p_error_permanent" boolean, "p_provider_done_at" timestamp with time zone, "p_received_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_due_appointment_reminders"("p_batch_size" integer, "p_now" timestamp with time zone, "p_lease_minutes" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_due_appointment_reminders"("p_batch_size" integer, "p_now" timestamp with time zone, "p_lease_minutes" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cleanup_simulation_run"("p_salon_id" "uuid", "p_appointment_ids" "uuid"[], "p_client_ids" "uuid"[]) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cleanup_simulation_run"("p_salon_id" "uuid", "p_appointment_ids" "uuid"[], "p_client_ids" "uuid"[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_employee_appointment_atomic"("p_profile_id" "uuid", "p_service_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_customer_note" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_employee_appointment_atomic"("p_profile_id" "uuid", "p_service_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_customer_note" "text", "p_idempotency_key" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."employees" TO "anon";
GRANT ALL ON TABLE "public"."employees" TO "authenticated";
GRANT ALL ON TABLE "public"."employees" TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_employee_with_entitlement"("p_salon_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_position" "text", "p_phone" "text", "p_email" "text", "p_bio" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_employee_with_entitlement"("p_salon_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_position" "text", "p_phone" "text", "p_email" "text", "p_bio" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_employee_with_entitlement"("p_salon_id" "uuid", "p_full_name" "text", "p_display_name" "text", "p_position" "text", "p_phone" "text", "p_email" "text", "p_bio" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_notification_recipients"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_notification_recipients"() TO "anon";
GRANT ALL ON FUNCTION "public"."create_notification_recipients"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_notification_recipients"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_public_booking_atomic"("p_salon_slug" "text", "p_service_id" "uuid", "p_employee_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_idempotency_key" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_public_booking_atomic"("p_salon_slug" "text", "p_service_id" "uuid", "p_employee_id" "uuid", "p_start_time" timestamp with time zone, "p_customer_full_name" "text", "p_customer_phone" "text", "p_customer_email" "text", "p_idempotency_key" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_trial_subscription_for_new_salon"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_trial_subscription_for_new_salon"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."current_employee_id"("target_salon_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."finalize_claimed_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_now" timestamp with time zone, "p_provider" "text", "p_provider_message_id" "text", "p_error_code" "text", "p_error_message" "text", "p_next_retry_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."finalize_claimed_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_outcome" "text", "p_now" timestamp with time zone, "p_provider" "text", "p_provider_message_id" "text", "p_error_code" "text", "p_error_message" "text", "p_next_retry_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_employee_appointment_clients"("target_salon_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_owner_clients_page_v1"("p_salon_id" "uuid", "p_page" integer, "p_page_size" integer, "p_search" "text", "p_status" "text", "p_sort" "text", "p_month_start_utc" timestamp with time zone, "p_month_end_utc" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_owner_clients_page_v1"("p_salon_id" "uuid", "p_page" integer, "p_page_size" integer, "p_search" "text", "p_status" "text", "p_sort" "text", "p_month_start_utc" timestamp with time zone, "p_month_end_utc" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_owner_statistics_v1"("p_salon_id" "uuid", "p_start_utc" timestamp with time zone, "p_end_utc" timestamp with time zone, "p_granularity" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_owner_statistics_v1"("p_salon_id" "uuid", "p_start_utc" timestamp with time zone, "p_end_utc" timestamp with time zone, "p_granularity" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_salon_reminder_usage"("p_salon_id" "uuid", "p_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_salon_reminder_usage"("p_salon_id" "uuid", "p_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_simulation_schema_contract"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_simulation_schema_contract"() TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_simulation_appointment_batch"("p_salon_id" "uuid", "p_appointments" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_simulation_appointment_batch"("p_salon_id" "uuid", "p_appointments" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_simulation_client_batch"("p_salon_id" "uuid", "p_clients" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_simulation_client_batch"("p_salon_id" "uuid", "p_clients" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_salon_member"("target_salon_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_salon_member"("target_salon_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_salon_member"("target_salon_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_salon_owner_or_manager"("target_salon_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_salon_owner_or_manager"("target_salon_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_salon_owner_or_manager"("target_salon_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."owns_salon"("target_salon_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."owns_salon"("target_salon_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owns_salon"("target_salon_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."preview_due_appointment_reminders"("p_salon_id" "uuid", "p_batch_size" integer, "p_now" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."preview_due_appointment_reminders"("p_salon_id" "uuid", "p_batch_size" integer, "p_now" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."recover_accepted_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_sent_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."recover_accepted_reminder_delivery"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_provider" "text", "p_provider_message_id" "text", "p_sent_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."reminder_usage_period"("p_salon_id" "uuid", "p_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."reminder_usage_period"("p_salon_id" "uuid", "p_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_reminder_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_reminder_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_employee_appointment_status"("p_appointment_id" "uuid", "p_profile_id" "uuid", "p_next_status" "public"."appointment_status") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_employee_appointment_status"("p_appointment_id" "uuid", "p_profile_id" "uuid", "p_next_status" "public"."appointment_status") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_claimed_reminder_for_send"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_now" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_claimed_reminder_for_send"("p_delivery_id" "uuid", "p_claim_token" "uuid", "p_now" timestamp with time zone) TO "service_role";



GRANT ALL ON TABLE "public"."ai_settings" TO "anon";
GRANT ALL ON TABLE "public"."ai_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."ai_settings" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_reminder_deliveries" TO "service_role";



GRANT ALL ON TABLE "public"."appointment_services" TO "anon";
GRANT ALL ON TABLE "public"."appointment_services" TO "authenticated";
GRANT ALL ON TABLE "public"."appointment_services" TO "service_role";



GRANT ALL ON TABLE "public"."appointments" TO "anon";
GRANT ALL ON TABLE "public"."appointments" TO "authenticated";
GRANT ALL ON TABLE "public"."appointments" TO "service_role";



GRANT ALL ON TABLE "public"."audit_logs" TO "anon";
GRANT ALL ON TABLE "public"."audit_logs" TO "authenticated";
GRANT ALL ON TABLE "public"."audit_logs" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."closures" TO "anon";
GRANT ALL ON TABLE "public"."closures" TO "authenticated";
GRANT ALL ON TABLE "public"."closures" TO "service_role";



GRANT ALL ON TABLE "public"."conversations" TO "anon";
GRANT ALL ON TABLE "public"."conversations" TO "authenticated";
GRANT ALL ON TABLE "public"."conversations" TO "service_role";



GRANT ALL ON TABLE "public"."employee_services" TO "anon";
GRANT ALL ON TABLE "public"."employee_services" TO "authenticated";
GRANT ALL ON TABLE "public"."employee_services" TO "service_role";



GRANT ALL ON TABLE "public"."integrations" TO "anon";
GRANT ALL ON TABLE "public"."integrations" TO "authenticated";
GRANT ALL ON TABLE "public"."integrations" TO "service_role";



GRANT ALL ON TABLE "public"."messages" TO "anon";
GRANT ALL ON TABLE "public"."messages" TO "authenticated";
GRANT ALL ON TABLE "public"."messages" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."notification_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_recipients" TO "service_role";



GRANT UPDATE("is_read") ON TABLE "public"."notification_recipients" TO "authenticated";



GRANT UPDATE("read_at") ON TABLE "public"."notification_recipients" TO "authenticated";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "anon";
GRANT ALL ON TABLE "public"."payments" TO "authenticated";
GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."plans" TO "anon";
GRANT ALL ON TABLE "public"."plans" TO "authenticated";
GRANT ALL ON TABLE "public"."plans" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."resources" TO "anon";
GRANT ALL ON TABLE "public"."resources" TO "authenticated";
GRANT ALL ON TABLE "public"."resources" TO "service_role";



GRANT ALL ON TABLE "public"."salon_members" TO "anon";
GRANT ALL ON TABLE "public"."salon_members" TO "authenticated";
GRANT ALL ON TABLE "public"."salon_members" TO "service_role";



GRANT ALL ON TABLE "public"."salon_reminder_settings" TO "service_role";
GRANT SELECT ON TABLE "public"."salon_reminder_settings" TO "authenticated";



GRANT ALL ON TABLE "public"."salons" TO "anon";
GRANT ALL ON TABLE "public"."salons" TO "authenticated";
GRANT ALL ON TABLE "public"."salons" TO "service_role";



GRANT ALL ON TABLE "public"."service_categories" TO "anon";
GRANT ALL ON TABLE "public"."service_categories" TO "authenticated";
GRANT ALL ON TABLE "public"."service_categories" TO "service_role";



GRANT ALL ON TABLE "public"."services" TO "anon";
GRANT ALL ON TABLE "public"."services" TO "authenticated";
GRANT ALL ON TABLE "public"."services" TO "service_role";



GRANT ALL ON TABLE "public"."subscriptions" TO "anon";
GRANT ALL ON TABLE "public"."subscriptions" TO "authenticated";
GRANT ALL ON TABLE "public"."subscriptions" TO "service_role";



GRANT ALL ON TABLE "public"."team_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."working_hours" TO "anon";
GRANT ALL ON TABLE "public"."working_hours" TO "authenticated";
GRANT ALL ON TABLE "public"."working_hours" TO "service_role";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";


-- pg_dump with --schema public,private cannot include a trigger attached to
-- Supabase-managed auth.users, so keep that final application trigger here.
-- Supabase local projects define broad default table privileges before this
-- application baseline is restored. Revoke them explicitly for server-managed
-- tables so a clean restore matches the production privilege contract.
REVOKE ALL ON TABLE "public"."appointment_reminder_deliveries" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."appointment_reminder_deliveries" TO "service_role";

REVOKE ALL ON TABLE "public"."notification_recipients" FROM "anon", "authenticated";
GRANT SELECT, MAINTAIN ON TABLE "public"."notification_recipients" TO "authenticated";
GRANT UPDATE ("is_read", "read_at") ON TABLE "public"."notification_recipients" TO "authenticated";
GRANT ALL ON TABLE "public"."notification_recipients" TO "service_role";

REVOKE ALL ON TABLE "public"."salon_reminder_settings" FROM "anon", "authenticated";
GRANT SELECT ON TABLE "public"."salon_reminder_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."salon_reminder_settings" TO "service_role";

REVOKE ALL ON TABLE "public"."team_invitations" FROM "anon", "authenticated";
GRANT ALL ON TABLE "public"."team_invitations" TO "service_role";

DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
AFTER INSERT ON "auth"."users"
FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
