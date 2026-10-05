begin;

create function public.billing_environment_matches_v1(p_environment text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_environment in ('test', 'live')
    and count(*) = 1
    and min(c.environment) = p_environment,
    false
  )
  from private.billing_runtime_config c;
$$;

alter function public.billing_environment_matches_v1(text) owner to postgres;
revoke all on function public.billing_environment_matches_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.billing_environment_matches_v1(text) to service_role;
comment on function public.billing_environment_matches_v1(text) is
  'Read-only service-role attestation of server/DB billing environment parity; exposes no configuration row and performs no writes.';

commit;
