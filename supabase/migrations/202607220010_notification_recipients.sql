create table if not exists public.notification_recipients (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null
    references public.notifications(id) on delete cascade,
  profile_id uuid not null
    references public.profiles(id) on delete cascade,
  is_read boolean not null default false,
  read_at timestamp with time zone,
  created_at timestamp with time zone not null default now(),
  constraint notification_recipients_notification_profile_key
    unique (notification_id, profile_id),
  constraint notification_recipients_read_state_check
    check (
      (is_read = false and read_at is null)
      or (is_read = true and read_at is not null)
    )
);

create index if not exists idx_notification_recipients_profile_created
  on public.notification_recipients (profile_id, created_at desc);

create index if not exists idx_notification_recipients_profile_unread
  on public.notification_recipients (profile_id, created_at desc)
  where is_read = false;

create index if not exists idx_notification_recipients_notification_id
  on public.notification_recipients (notification_id);

alter table public.notification_recipients enable row level security;

revoke all on table public.notification_recipients from anon;
revoke insert, delete, update on table public.notification_recipients
  from authenticated;
grant select on table public.notification_recipients to authenticated;
grant update (is_read, read_at) on table public.notification_recipients
  to authenticated;

-- Event rows are immutable from the browser. Read state now belongs only to
-- notification_recipients, so the legacy salon-wide UPDATE policy must go.
drop policy if exists "Users can update notifications from their salon"
  on public.notifications;

drop policy if exists notification_recipients_select_own
  on public.notification_recipients;
drop policy if exists notification_recipients_update_own
  on public.notification_recipients;

create policy notification_recipients_select_own
  on public.notification_recipients
  for select
  to authenticated
  using (profile_id = auth.uid());

create policy notification_recipients_update_own
  on public.notification_recipients
  for update
  to authenticated
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create or replace function public.create_notification_recipients()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
begin
  insert into public.notification_recipients (
    notification_id,
    profile_id
  )
  select new.id, recipient.profile_id
  from (
    select membership.profile_id
    from public.salon_members as membership
    where membership.salon_id = new.salon_id
      and membership.status = 'active'::public.member_status

    union

    select salon.owner_id
    from public.salons as salon
    where salon.id = new.salon_id
      and salon.owner_id is not null
  ) as recipient
  join public.profiles as profile
    on profile.id = recipient.profile_id
  on conflict (notification_id, profile_id) do nothing;

  return new;
end;
$$;

revoke all on function public.create_notification_recipients() from public;

drop trigger if exists create_notification_recipients_after_insert
  on public.notifications;

create trigger create_notification_recipients_after_insert
after insert on public.notifications
for each row execute function public.create_notification_recipients();
