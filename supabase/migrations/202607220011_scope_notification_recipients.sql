create or replace function public.create_notification_recipients()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
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

revoke all on function public.create_notification_recipients() from public;

-- Notification events are readable only when routing produced a recipient row
-- for the current profile. This replaces the previous salon-wide member read.
drop policy if exists "Users can view notifications from their salon"
  on public.notifications;
drop policy if exists notifications_select_own_recipient
  on public.notifications;

create policy notifications_select_own_recipient
  on public.notifications
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.notification_recipients as recipient
      where recipient.notification_id = notifications.id
        and recipient.profile_id = auth.uid()
    )
  );
