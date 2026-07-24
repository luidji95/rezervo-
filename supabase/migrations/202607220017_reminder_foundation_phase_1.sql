-- Reminder foundation only. No provider integration or scheduler is introduced here.

alter table public.plans
  add column if not exists sms_reminders_enabled boolean not null default false,
  add column if not exists max_monthly_reminders integer;

alter table public.plans
  drop constraint if exists plans_max_monthly_reminders_non_negative;
alter table public.plans
  add constraint plans_max_monthly_reminders_non_negative
  check (max_monthly_reminders is null or max_monthly_reminders >= 0);

update public.plans set sms_reminders_enabled = false, max_monthly_reminders = 0 where slug = 'starter';
update public.plans set sms_reminders_enabled = true, max_monthly_reminders = null where slug in ('pro', 'premium');

do $$ begin
  create type public.reminder_channel as enum ('sms', 'viber');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.reminder_delivery_status as enum (
    'pending', 'processing', 'sent', 'delivered', 'retry_scheduled',
    'failed', 'skipped', 'cancelled'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.salon_reminder_settings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null unique references public.salons(id) on delete cascade,
  enabled boolean not null default false,
  channel public.reminder_channel not null default 'sms',
  hours_before integer not null default 24,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint salon_reminder_settings_hours_range check (hours_before between 1 and 168),
  constraint salon_reminder_settings_phase_1_sms_only check (channel = 'sms')
);

create table if not exists public.appointment_reminder_deliveries (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  appointment_id uuid not null references public.appointments(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  reminder_type text not null default 'appointment_reminder',
  channel public.reminder_channel not null,
  scheduled_for timestamptz not null,
  appointment_start_snapshot timestamptz not null,
  recipient_snapshot text,
  salon_timezone_snapshot text not null,
  status public.reminder_delivery_status not null default 'pending',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  next_retry_at timestamptz,
  last_attempt_at timestamptz,
  provider text,
  provider_message_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  skipped_at timestamptz,
  cancelled_at timestamptz,
  last_error_code text,
  last_error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminder_delivery_type_v1 check (reminder_type = 'appointment_reminder'),
  constraint reminder_delivery_attempts_valid check (attempt_count >= 0 and max_attempts between 1 and 20),
  constraint reminder_delivery_error_message_size check (last_error_message is null or length(last_error_message) <= 1000),
  constraint reminder_delivery_schedule_unique unique (appointment_id, reminder_type, channel, scheduled_for)
);

create index if not exists reminder_deliveries_due_idx
  on public.appointment_reminder_deliveries (scheduled_for, id)
  where status in ('pending', 'processing');
create index if not exists reminder_deliveries_retry_idx
  on public.appointment_reminder_deliveries (next_retry_at, id)
  where status = 'retry_scheduled';
create index if not exists reminder_deliveries_salon_usage_idx
  on public.appointment_reminder_deliveries (salon_id, sent_at)
  where status in ('sent', 'delivered');
create index if not exists reminder_deliveries_appointment_history_idx
  on public.appointment_reminder_deliveries (appointment_id, created_at desc);
create unique index if not exists reminder_deliveries_provider_message_uidx
  on public.appointment_reminder_deliveries (provider, provider_message_id)
  where provider is not null and provider_message_id is not null;
create index if not exists appointments_reminder_due_lookup_idx
  on public.appointments (start_time, salon_id)
  where status in ('pending', 'confirmed');

create or replace function public.set_reminder_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
revoke all on function public.set_reminder_updated_at() from public, anon, authenticated;

drop trigger if exists salon_reminder_settings_updated_at on public.salon_reminder_settings;
create trigger salon_reminder_settings_updated_at before update on public.salon_reminder_settings
for each row execute function public.set_reminder_updated_at();
drop trigger if exists reminder_deliveries_updated_at on public.appointment_reminder_deliveries;
create trigger reminder_deliveries_updated_at before update on public.appointment_reminder_deliveries
for each row execute function public.set_reminder_updated_at();

alter table public.salon_reminder_settings enable row level security;
alter table public.appointment_reminder_deliveries enable row level security;

drop policy if exists salon_reminder_settings_owner_manager_read on public.salon_reminder_settings;
create policy salon_reminder_settings_owner_manager_read
on public.salon_reminder_settings for select to authenticated using (
  exists (select 1 from public.salons s where s.id = salon_id and s.owner_id = auth.uid())
  or exists (select 1 from public.salon_members sm where sm.salon_id = salon_id and sm.profile_id = auth.uid() and sm.status = 'active' and sm.role in ('owner', 'manager'))
);

revoke all on table public.salon_reminder_settings from anon, authenticated;
grant select on table public.salon_reminder_settings to authenticated;
revoke all on table public.appointment_reminder_deliveries from anon, authenticated;

create or replace function public.reminder_usage_period(p_salon_id uuid, p_at timestamptz default now())
returns table(period_start timestamptz, period_end timestamptz)
language plpgsql stable security definer set search_path = '' as $$
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
revoke all on function public.reminder_usage_period(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.reminder_usage_period(uuid, timestamptz) to service_role;

create or replace function public.get_salon_reminder_usage(p_salon_id uuid, p_at timestamptz default now())
returns table(salon_id uuid, period_start timestamptz, period_end timestamptz, accepted_count bigint, max_monthly_reminders integer, remaining integer)
language plpgsql stable security definer set search_path = '' as $$
declare v_start timestamptz; v_end timestamptz; v_count bigint; v_limit integer;
begin
  select p.period_start, p.period_end into v_start, v_end from public.reminder_usage_period(p_salon_id, p_at) p;
  select plan.max_monthly_reminders into v_limit from public.subscriptions sub join public.plans plan on plan.id=sub.plan_id where sub.salon_id=p_salon_id;
  select count(*) into v_count from public.appointment_reminder_deliveries d
   where d.salon_id=p_salon_id and d.status in ('sent','delivered') and d.sent_at >= v_start and d.sent_at < v_end;
  return query select p_salon_id, v_start, v_end, v_count, v_limit,
    case when v_limit is null then null else greatest(v_limit - v_count::integer, 0) end;
end; $$;
revoke all on function public.get_salon_reminder_usage(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.get_salon_reminder_usage(uuid, timestamptz) to service_role;

create or replace function public.preview_due_appointment_reminders(p_salon_id uuid default null, p_batch_size integer default 50, p_now timestamptz default now())
returns table(salon_id uuid, appointment_id uuid, scheduled_for timestamptz, eligible boolean, reason text, recipient_masked text, salon_timezone text)
language sql stable security definer set search_path = '' as $$
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
revoke all on function public.preview_due_appointment_reminders(uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.preview_due_appointment_reminders(uuid, integer, timestamptz) to service_role;

create or replace function public.claim_due_appointment_reminders(p_batch_size integer default 50, p_now timestamptz default now(), p_lease_minutes integer default 10)
returns table(delivery_id uuid, salon_id uuid, appointment_id uuid, client_id uuid, channel public.reminder_channel, scheduled_for timestamptz, appointment_start timestamptz, recipient text, salon_timezone text, attempt_count integer, lease_expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare r record; v_phone text; v_start timestamptz; v_end timestamptz; v_limit integer; v_used bigint; v_reserved bigint;
begin
  if p_batch_size not between 1 and 500 or p_lease_minutes not between 1 and 60 then raise exception 'INVALID_CLAIM_INPUT' using errcode='22023'; end if;

  update public.appointment_reminder_deliveries d set status='cancelled', cancelled_at=p_now, lease_expires_at=null, last_error_code='SCHEDULE_INVALIDATED'
  where d.status in ('pending','processing','retry_scheduled') and exists (
    select 1 from public.appointments a left join public.salon_reminder_settings rs on rs.salon_id=a.salon_id
    where a.id=d.appointment_id and (a.status not in ('pending','confirmed') or a.start_time <= p_now or not coalesce(rs.enabled,false)
      or d.scheduled_for <> a.start_time - make_interval(hours=>rs.hours_before))
  );

  update public.appointment_reminder_deliveries set status='failed', failed_at=p_now, lease_expires_at=null, last_error_code='MAX_ATTEMPTS_REACHED'
  where attempt_count >= max_attempts and ((status='processing' and lease_expires_at < p_now) or (status='retry_scheduled' and coalesce(next_retry_at,scheduled_for)<=p_now));

  insert into public.appointment_reminder_deliveries(salon_id,appointment_id,client_id,reminder_type,channel,scheduled_for,appointment_start_snapshot,recipient_snapshot,salon_timezone_snapshot,status,skipped_at,last_error_code)
  select a.salon_id,a.id,a.client_id,'appointment_reminder','sms',a.start_time-make_interval(hours=>rs.hours_before),a.start_time,
    case when btrim(c.phone) like '+%' then '+'||regexp_replace(c.phone,'[^0-9]','','g') else regexp_replace(c.phone,'[^0-9]','','g') end,
    coalesce(nullif(s.timezone,''),'Europe/Belgrade'),
    case when length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) < 8 then 'skipped'::public.reminder_delivery_status else 'pending'::public.reminder_delivery_status end,
    case when length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) < 8 then p_now else null end,
    case when length(regexp_replace(coalesce(c.phone,''),'[^0-9]','','g')) < 8 then 'MISSING_RECIPIENT' else null end
  from public.appointments a join public.salons s on s.id=a.salon_id join public.clients c on c.id=a.client_id and c.salon_id=a.salon_id
  join public.salon_reminder_settings rs on rs.salon_id=a.salon_id and rs.enabled and rs.channel='sms'
  join public.subscriptions sub on sub.salon_id=a.salon_id and sub.status in ('active','trialing')
  join public.plans plan on plan.id=sub.plan_id and plan.sms_reminders_enabled
  where a.status in ('pending','confirmed') and a.start_time>p_now and a.start_time-make_interval(hours=>rs.hours_before)<=p_now
    and (sub.status <> 'trialing' or sub.trial_ends_at is null or sub.trial_ends_at>p_now)
    and (sub.status <> 'active' or sub.current_period_ends_at is null or sub.current_period_ends_at>p_now)
  on conflict (appointment_id,reminder_type,channel,scheduled_for) do nothing;

  for r in
    select d.* from public.appointment_reminder_deliveries d
    join public.appointments a on a.id=d.appointment_id and a.salon_id=d.salon_id
    join public.salon_reminder_settings rs on rs.salon_id=d.salon_id and rs.enabled and rs.channel=d.channel
    join public.subscriptions sub on sub.salon_id=d.salon_id and sub.status in ('active','trialing')
    join public.plans plan on plan.id=sub.plan_id and plan.sms_reminders_enabled
    where (d.status='pending' or (d.status='retry_scheduled' and coalesce(d.next_retry_at,d.scheduled_for)<=p_now)
      or (d.status='processing' and d.lease_expires_at<p_now and d.attempt_count<d.max_attempts))
      and a.status in ('pending','confirmed') and a.start_time>p_now
      and d.attempt_count<d.max_attempts
      and d.scheduled_for=a.start_time-make_interval(hours=>rs.hours_before)
      and (sub.status <> 'trialing' or sub.trial_ends_at is null or sub.trial_ends_at>p_now)
      and (sub.status <> 'active' or sub.current_period_ends_at is null or sub.current_period_ends_at>p_now)
    order by d.scheduled_for,d.id limit p_batch_size for update of d skip locked
  loop
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('reminder-quota:'||r.salon_id::text,0));
    select u.period_start,u.period_end,u.max_monthly_reminders,u.accepted_count into v_start,v_end,v_limit,v_used
      from public.get_salon_reminder_usage(r.salon_id,p_now) u;
    select count(*) into v_reserved from public.appointment_reminder_deliveries d
      where d.salon_id=r.salon_id and d.id<>r.id and d.status='processing' and d.lease_expires_at>p_now and d.scheduled_for>=v_start and d.scheduled_for<v_end;
    if v_limit is not null and v_used+v_reserved>=v_limit then
      update public.appointment_reminder_deliveries set status='skipped',skipped_at=p_now,lease_expires_at=null,last_error_code='QUOTA_EXHAUSTED' where id=r.id;
      continue;
    end if;
    update public.appointment_reminder_deliveries d set status='processing',claimed_at=p_now,lease_expires_at=p_now+make_interval(mins=>p_lease_minutes),last_attempt_at=p_now,attempt_count=d.attempt_count+1,next_retry_at=null
      where d.id=r.id returning d.id,d.salon_id,d.appointment_id,d.client_id,d.channel,d.scheduled_for,d.appointment_start_snapshot,d.recipient_snapshot,d.salon_timezone_snapshot,d.attempt_count,d.lease_expires_at
      into delivery_id,salon_id,appointment_id,client_id,channel,scheduled_for,appointment_start,recipient,salon_timezone,attempt_count,lease_expires_at;
    return next;
  end loop;
end; $$;
revoke all on function public.claim_due_appointment_reminders(integer,timestamptz,integer) from public, anon, authenticated;
grant execute on function public.claim_due_appointment_reminders(integer,timestamptz,integer) to service_role;
