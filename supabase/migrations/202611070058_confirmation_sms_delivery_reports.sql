begin;

-- Infobip delivery reports (DLR) for booking-confirmation SMS. Additive: the reminder report function
-- (apply_infobip_sms_delivery_report), reminder tables and quotas are unchanged.
-- `status` keeps the send outcome (accepted = the provider took the request); the new delivery_* columns hold what the
-- delivery report says (pending / delivered / failed), with the provider codes and times. A report is matched only by
-- the stored Infobip messageId.
-- A report can arrive before the messageId is written after the send. Such a report is kept briefly in
-- infobip_early_delivery_reports (codes and times only, no number or text) and applied when the messageId is written.
-- Both sides take the same per-messageId lock, so the report is never lost in between.
-- Cleanup is not scheduled (no cron): a kept report is deleted when it is applied by finish, and rows older than 2 days
-- are deleted only while another unmatched report is being stored. Without new unmatched reports, old rows stay.

alter table public.public_booking_confirmation_sms
  add column delivery_status text,
  add column delivery_status_id integer,
  add column delivery_status_group text,
  add column delivery_status_name text,
  add column delivery_error_code text,
  add column delivery_error_name text,
  add column delivery_error_permanent boolean,
  add column delivery_done_at timestamptz,
  add column delivery_report_received_at timestamptz,
  add constraint public_booking_confirmation_sms_delivery_status check (delivery_status is null or delivery_status in ('pending', 'delivered', 'failed')),
  add constraint public_booking_confirmation_sms_delivery_metadata_size check (
    (delivery_status_group is null or pg_catalog.length(delivery_status_group) <= 128)
    and (delivery_status_name is null or pg_catalog.length(delivery_status_name) <= 128)
    and (delivery_error_code is null or pg_catalog.length(delivery_error_code) <= 128)
    and (delivery_error_name is null or pg_catalog.length(delivery_error_name) <= 128)
  );

create unique index public_booking_confirmation_sms_message_uidx
  on public.public_booking_confirmation_sms (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;

create table public.infobip_early_delivery_reports (
  provider_message_id text primary key,
  status_id integer,
  status_group text not null,
  status_name text,
  error_code text,
  error_name text,
  error_permanent boolean,
  provider_done_at timestamptz,
  received_at timestamptz not null default pg_catalog.now(),
  constraint infobip_early_delivery_reports_size check (
    pg_catalog.length(provider_message_id) between 1 and 256
    and pg_catalog.length(status_group) between 1 and 128
    and (status_name is null or pg_catalog.length(status_name) <= 128)
    and (error_code is null or pg_catalog.length(error_code) <= 128)
    and (error_name is null or pg_catalog.length(error_name) <= 128)
  )
);
create index infobip_early_delivery_reports_received_idx on public.infobip_early_delivery_reports (received_at);

alter table public.infobip_early_delivery_reports enable row level security;
revoke all on table public.infobip_early_delivery_reports from public, anon, authenticated, service_role;

-- Same ordering rules as the reminder reports:
--   ignored_stale      an older (or undated) report after a dated one
--   ignored_duplicate  the same report again
--   ignored_monotone   delivered never goes back; failed never goes back to pending
-- Final groups: DELIVERED -> delivered; UNDELIVERABLE, EXPIRED, REJECTED -> failed; anything else, including an unknown
-- group name, -> pending (never delivered or failed, and never over a delivered or failed status).
-- Outcomes: updated, ignored_stale, ignored_duplicate, ignored_monotone, deferred_unknown_message.
create or replace function public.apply_confirmation_sms_delivery_report_v1(
  p_provider_message_id text,
  p_status_id integer,
  p_status_group text,
  p_status_name text,
  p_error_code text default null,
  p_error_name text default null,
  p_error_permanent boolean default null,
  p_provider_done_at timestamptz default null,
  p_received_at timestamptz default pg_catalog.now()
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c public.public_booking_confirmation_sms%rowtype;
  e public.infobip_early_delivery_reports%rowtype;
  v_message_id text := pg_catalog.btrim(p_provider_message_id);
  v_group text := pg_catalog.upper(pg_catalog.btrim(coalesce(p_status_group, '')));
  v_status_name text := nullif(pg_catalog.btrim(p_status_name), '');
  v_error_code text := nullif(pg_catalog.btrim(p_error_code), '');
  v_error_name text := nullif(pg_catalog.btrim(p_error_name), '');
  v_next text;
begin
  if v_message_id is null or pg_catalog.length(v_message_id) not between 1 and 256
    or pg_catalog.length(v_group) not between 1 and 128
    or (v_status_name is not null and pg_catalog.length(v_status_name) > 128)
    or (v_error_code is not null and pg_catalog.length(v_error_code) > 128)
    or (v_error_name is not null and pg_catalog.length(v_error_name) > 128) then
    raise exception 'INVALID_DELIVERY_REPORT_INPUT' using errcode = '22023';
  end if;

  -- Serializes with finish_public_booking_confirmation_sms_v1 writing this messageId.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('infobip-message:' || v_message_id, 0));

  select * into c
  from public.public_booking_confirmation_sms sms
  where sms.provider = 'infobip' and sms.provider_message_id = v_message_id
  for update;

  if not found then
    -- Not (yet) known: keep the most relevant report for this id, by the same ordering rules. Lazy cleanup: rows older
    -- than 2 days are removed here, i.e. only when another unmatched report arrives (there is no scheduled job).
    delete from public.infobip_early_delivery_reports old where old.received_at < pg_catalog.now() - interval '2 days';
    select * into e from public.infobip_early_delivery_reports early where early.provider_message_id = v_message_id for update;
    if not found then
      insert into public.infobip_early_delivery_reports
        (provider_message_id, status_id, status_group, status_name, error_code, error_name, error_permanent, provider_done_at, received_at)
      values (v_message_id, p_status_id, v_group, v_status_name, v_error_code, v_error_name, p_error_permanent, p_provider_done_at, p_received_at);
    elsif not (
      (e.provider_done_at is not null and (p_provider_done_at is null or p_provider_done_at < e.provider_done_at))
      or (e.status_group = 'DELIVERED' and v_group <> 'DELIVERED')
      or (e.status_group in ('UNDELIVERABLE', 'EXPIRED', 'REJECTED') and v_group not in ('DELIVERED', 'UNDELIVERABLE', 'EXPIRED', 'REJECTED'))
    ) then
      update public.infobip_early_delivery_reports early
      set status_id = p_status_id, status_group = v_group, status_name = v_status_name, error_code = v_error_code,
          error_name = v_error_name, error_permanent = p_error_permanent, provider_done_at = p_provider_done_at, received_at = p_received_at
      where early.provider_message_id = v_message_id;
    end if;
    return 'deferred_unknown_message';
  end if;

  if c.delivery_done_at is not null and (p_provider_done_at is null or p_provider_done_at < c.delivery_done_at) then
    return 'ignored_stale';
  end if;

  if c.delivery_status_group is not distinct from v_group
    and c.delivery_status_id is not distinct from p_status_id
    and c.delivery_status_name is not distinct from v_status_name
    and c.delivery_error_code is not distinct from v_error_code
    and c.delivery_error_name is not distinct from v_error_name
    and c.delivery_error_permanent is not distinct from p_error_permanent
    and c.delivery_done_at is not distinct from p_provider_done_at then
    return 'ignored_duplicate';
  end if;

  if c.delivery_status = 'delivered' and v_group <> 'DELIVERED' then
    return 'ignored_monotone';
  end if;
  if c.delivery_status = 'failed' and v_group not in ('DELIVERED', 'UNDELIVERABLE', 'EXPIRED', 'REJECTED') then
    return 'ignored_monotone';
  end if;

  v_next := case
    when v_group = 'DELIVERED' then 'delivered'
    when v_group in ('UNDELIVERABLE', 'EXPIRED', 'REJECTED') then 'failed'
    else 'pending'
  end;

  update public.public_booking_confirmation_sms sms
  set delivery_status = v_next,
      delivery_status_id = p_status_id,
      delivery_status_group = v_group,
      delivery_status_name = v_status_name,
      delivery_error_code = v_error_code,
      delivery_error_name = v_error_name,
      delivery_error_permanent = p_error_permanent,
      delivery_done_at = coalesce(p_provider_done_at, sms.delivery_done_at),
      delivery_report_received_at = p_received_at
  where sms.appointment_id = c.appointment_id;
  return 'updated';
end;
$$;

-- Same contract as in 057; additionally applies a delivery report that arrived before the messageId was written.
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
declare
  v_message_id text := nullif(pg_catalog.btrim(p_provider_message_id), '');
  e public.infobip_early_delivery_reports%rowtype;
begin
  if p_status not in ('accepted', 'rejected', 'unknown') then
    raise exception 'Invalid confirmation SMS status.' using errcode = '22023';
  end if;

  if v_message_id is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('infobip-message:' || v_message_id, 0));
  end if;

  update public.public_booking_confirmation_sms sms
  set status = p_status,
      provider = pg_catalog.left(p_provider, 32),
      provider_message_id = pg_catalog.left(v_message_id, 128),
      error_code = p_error_code,
      finished_at = pg_catalog.now()
  where sms.appointment_id = p_appointment_id
    and sms.status = 'sending';
  if not found then
    return false;
  end if;

  if v_message_id is not null and p_provider = 'infobip' then
    select * into e from public.infobip_early_delivery_reports early where early.provider_message_id = pg_catalog.left(v_message_id, 128);
    if found then
      perform public.apply_confirmation_sms_delivery_report_v1(e.provider_message_id, e.status_id, e.status_group, e.status_name,
        e.error_code, e.error_name, e.error_permanent, e.provider_done_at, e.received_at);
      delete from public.infobip_early_delivery_reports early where early.provider_message_id = e.provider_message_id;
    end if;
  end if;
  return true;
end;
$$;

revoke all on function public.apply_confirmation_sms_delivery_report_v1(text, integer, text, text, text, text, boolean, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_confirmation_sms_delivery_report_v1(text, integer, text, text, text, text, boolean, timestamptz, timestamptz)
  to service_role;
revoke all on function public.finish_public_booking_confirmation_sms_v1(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.finish_public_booking_confirmation_sms_v1(uuid, text, text, text, text) to service_role;

commit;
