create or replace function public.accept_team_invitation(
  p_invitation_id uuid,
  p_profile_id uuid
)
returns table (
  result_status text,
  salon_id uuid,
  employee_id uuid,
  membership_id uuid,
  already_accepted boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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

revoke all on function public.accept_team_invitation(uuid, uuid) from public;
revoke all on function public.accept_team_invitation(uuid, uuid) from anon;
revoke all on function public.accept_team_invitation(uuid, uuid) from authenticated;
grant execute on function public.accept_team_invitation(uuid, uuid) to service_role;

comment on function public.accept_team_invitation(uuid, uuid) is
  'Atomically activates an employee membership and links an accepted Auth profile.';
