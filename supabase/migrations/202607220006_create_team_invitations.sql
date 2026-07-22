create table if not exists public.team_invitations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  employee_id uuid not null references public.employees(id) on delete cascade,
  invited_by uuid not null references public.profiles(id) on delete restrict,
  email text not null,
  status text not null default 'invited',
  auth_user_id uuid null references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz null,
  expires_at timestamptz not null default (now() + interval '7 days'),
  constraint team_invitations_email_normalized
    check (email = lower(btrim(email)) and length(email) > 3),
  constraint team_invitations_status_valid
    check (status in ('invited', 'accepted', 'expired', 'revoked'))
);

create unique index if not exists team_invitations_active_employee_uidx
  on public.team_invitations (salon_id, employee_id)
  where status = 'invited';

create unique index if not exists team_invitations_active_email_uidx
  on public.team_invitations (salon_id, email)
  where status = 'invited';

create index if not exists idx_team_invitations_salon_id
  on public.team_invitations (salon_id);

create index if not exists idx_team_invitations_auth_user_id
  on public.team_invitations (auth_user_id)
  where auth_user_id is not null;

alter table public.team_invitations enable row level security;

revoke all on table public.team_invitations from anon, authenticated;
grant all on table public.team_invitations to service_role;

comment on table public.team_invitations is
  'Server-managed employee invitation lifecycle. No direct browser access.';
