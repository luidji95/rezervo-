begin;

-- SMS confirmation of a new public booking (pilot). Additive only: booking, cancellation and reminder functions, their
-- tables and quotas are unchanged.
-- One row per appointment records the single send attempt. It holds no phone number, message text, link or token:
-- the recipient is stored only as an HMAC digest computed by the server with its own key, used for the limits.
-- Sending is off by default per salon (and globally in the application configuration).

alter table public.salons
  add column booking_confirmation_sms_enabled boolean not null default false;

create table public.public_booking_confirmation_sms (
  appointment_id uuid primary key references public.appointments(id) on delete cascade,
  salon_id uuid not null references public.salons(id) on delete cascade,
  recipient_hash bytea not null,
  status text not null default 'sending',
  provider text,
  provider_message_id text,
  error_code text,
  created_at timestamptz not null default pg_catalog.now(),
  finished_at timestamptz,
  constraint public_booking_confirmation_sms_status check (status in ('sending', 'accepted', 'rejected', 'unknown')),
  constraint public_booking_confirmation_sms_hash_length check (pg_catalog.octet_length(recipient_hash) = 32),
  constraint public_booking_confirmation_sms_error_code check (error_code is null or error_code ~ '^[A-Za-z0-9_.-]{1,64}$')
);

create index public_booking_confirmation_sms_recipient_idx on public.public_booking_confirmation_sms (recipient_hash, created_at);
create index public_booking_confirmation_sms_salon_idx on public.public_booking_confirmation_sms (salon_id, created_at);

alter table public.public_booking_confirmation_sms enable row level security;
revoke all on table public.public_booking_confirmation_sms from public, anon, authenticated, service_role;

-- Reserves the one send attempt for a just-created public booking. Every attempt counts toward the limits, whatever
-- its outcome. Limits (rolling windows): 1 per recipient per 10 minutes, 3 per recipient per 24 hours, 20 per salon
-- per 24 hours. The salon lock and then the recipient lock serialize concurrent reservations, so parallel requests
-- cannot pass a limit together.
-- Outcomes: reserved, already_reserved, not_eligible, salon_disabled, recipient_limit, salon_limit.
create or replace function public.reserve_public_booking_confirmation_sms_v1(p_appointment_id uuid, p_recipient_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash bytea;
  v_appointment record;
begin
  if p_recipient_hash is null or p_recipient_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid recipient digest is required.' using errcode = '22023';
  end if;
  v_hash := pg_catalog.decode(p_recipient_hash, 'hex');

  -- Only a confirmed public booking with a private link, created moments ago, can be confirmed by SMS.
  select appointment.id, appointment.salon_id, salon.booking_confirmation_sms_enabled as enabled
  into v_appointment
  from public.appointments appointment
  join public.salons salon on salon.id = appointment.salon_id
  where appointment.id = p_appointment_id
    and appointment.booking_source = 'public'
    and appointment.status = 'confirmed'
    and appointment.start_time > pg_catalog.now()
    and appointment.created_at > pg_catalog.now() - interval '15 minutes'
    and exists (select 1 from public.public_booking_manage_tokens token where token.appointment_id = appointment.id);

  if not found then
    return 'not_eligible';
  end if;
  if not v_appointment.enabled then
    return 'salon_disabled';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-confirmation-sms-salon:' || v_appointment.salon_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('booking-confirmation-sms-recipient:' || p_recipient_hash, 0));

  if exists (select 1 from public.public_booking_confirmation_sms sms where sms.appointment_id = p_appointment_id) then
    return 'already_reserved';
  end if;

  if exists (
    select 1 from public.public_booking_confirmation_sms sms
    where sms.recipient_hash = v_hash and sms.created_at > pg_catalog.now() - interval '10 minutes'
  ) or (
    select pg_catalog.count(*) from public.public_booking_confirmation_sms sms
    where sms.recipient_hash = v_hash and sms.created_at > pg_catalog.now() - interval '24 hours'
  ) >= 3 then
    return 'recipient_limit';
  end if;

  if (
    select pg_catalog.count(*) from public.public_booking_confirmation_sms sms
    where sms.salon_id = v_appointment.salon_id and sms.created_at > pg_catalog.now() - interval '24 hours'
  ) >= 20 then
    return 'salon_limit';
  end if;

  insert into public.public_booking_confirmation_sms (appointment_id, salon_id, recipient_hash)
  values (p_appointment_id, v_appointment.salon_id, v_hash);
  return 'reserved';
end;
$$;

-- Records the provider outcome once: accepted (provider took the message), rejected (provider certainly did not
-- accept it) or unknown (timeout, network or ambiguous answer). There is no retry.
create or replace function public.finish_public_booking_confirmation_sms_v1(
  p_appointment_id uuid,
  p_status text,
  p_provider text,
  p_provider_message_id text,
  p_error_code text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_status not in ('accepted', 'rejected', 'unknown') then
    raise exception 'Invalid confirmation SMS status.' using errcode = '22023';
  end if;

  update public.public_booking_confirmation_sms sms
  set status = p_status,
      provider = pg_catalog.left(p_provider, 32),
      provider_message_id = pg_catalog.left(p_provider_message_id, 128),
      error_code = p_error_code,
      finished_at = pg_catalog.now()
  where sms.appointment_id = p_appointment_id
    and sms.status = 'sending';
  return found;
end;
$$;

revoke all on function public.reserve_public_booking_confirmation_sms_v1(uuid, text) from public, anon, authenticated;
revoke all on function public.finish_public_booking_confirmation_sms_v1(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.reserve_public_booking_confirmation_sms_v1(uuid, text) to service_role;
grant execute on function public.finish_public_booking_confirmation_sms_v1(uuid, text, text, text, text) to service_role;

commit;
