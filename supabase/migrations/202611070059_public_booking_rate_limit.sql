begin;

-- Per-IP limit for new public booking attempts, shared by all application instances. Additive only.
-- The application sends an HMAC digest of the normalized client IP (IPv4 address or IPv6 /64), computed with its own
-- server key; the raw address is never stored. Limits are rolling windows: 10 new attempts per 10 minutes and 40 per
-- 24 hours per digest. Idempotent replays of an already created booking are answered before this check and never
-- reach it.
-- Cleanup is not scheduled (no cron): each call deletes this digest's attempts older than 24 hours and at most 200
-- attempts older than 2 days of any digest. Without new attempts, old rows stay.

create table public.public_booking_rate_limit_events (
  id bigint generated always as identity primary key,
  key_hash bytea not null,
  created_at timestamptz not null default pg_catalog.now(),
  constraint public_booking_rate_limit_events_key_length check (pg_catalog.octet_length(key_hash) = 32)
);

create index public_booking_rate_limit_events_key_idx on public.public_booking_rate_limit_events (key_hash, created_at);
create index public_booking_rate_limit_events_created_idx on public.public_booking_rate_limit_events (created_at);

alter table public.public_booking_rate_limit_events enable row level security;
revoke all on table public.public_booking_rate_limit_events from public, anon, authenticated, service_role;

-- Records one attempt if both windows have room. The per-digest lock makes check and insert atomic, so concurrent
-- requests from one address can never pass a limit together. A refused attempt is not recorded.
-- reason: null when allowed, otherwise per_10_minutes or per_day; retry_after_seconds: when the oldest counted attempt
-- leaves the full window.
create or replace function public.hit_public_booking_rate_limit_v1(p_key_hash text)
returns table (allowed boolean, retry_after_seconds integer, reason text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key bytea;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_short_count integer;
  v_short_oldest timestamptz;
  v_day_count integer;
  v_day_oldest timestamptz;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid rate limit key is required.' using errcode = '22023';
  end if;
  v_key := pg_catalog.decode(p_key_hash, 'hex');

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('public-booking-rate-limit:' || p_key_hash, 0));

  delete from public.public_booking_rate_limit_events e
  where e.key_hash = v_key and e.created_at <= v_now - interval '24 hours';
  delete from public.public_booking_rate_limit_events e
  where e.id in (
    select old.id from public.public_booking_rate_limit_events old
    where old.created_at < v_now - interval '2 days'
    order by old.created_at
    limit 200
  );

  -- Ordered by time, so the first row after the limit-th newest is the one that has to expire.
  select pg_catalog.count(*)::integer, pg_catalog.min(e.created_at)
  into v_short_count, v_short_oldest
  from (
    select recent.created_at from public.public_booking_rate_limit_events recent
    where recent.key_hash = v_key and recent.created_at > v_now - interval '10 minutes'
    order by recent.created_at desc
    limit 10
  ) e;

  if v_short_count >= 10 then
    return query select false,
      greatest(1, pg_catalog.ceil(extract(epoch from (v_short_oldest + interval '10 minutes' - v_now)))::integer),
      'per_10_minutes'::text;
    return;
  end if;

  select pg_catalog.count(*)::integer, pg_catalog.min(e.created_at)
  into v_day_count, v_day_oldest
  from (
    select recent.created_at from public.public_booking_rate_limit_events recent
    where recent.key_hash = v_key and recent.created_at > v_now - interval '24 hours'
    order by recent.created_at desc
    limit 40
  ) e;

  if v_day_count >= 40 then
    return query select false,
      greatest(1, pg_catalog.ceil(extract(epoch from (v_day_oldest + interval '24 hours' - v_now)))::integer),
      'per_day'::text;
    return;
  end if;

  insert into public.public_booking_rate_limit_events (key_hash, created_at) values (v_key, v_now);
  return query select true, 0, null::text;
end;
$$;

revoke all on function public.hit_public_booking_rate_limit_v1(text) from public, anon, authenticated;
grant execute on function public.hit_public_booking_rate_limit_v1(text) to service_role;

commit;
