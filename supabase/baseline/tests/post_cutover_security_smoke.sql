-- Run only after the frozen baseline, reference seed, and every post-cutover
-- migration. The frozen cutover schema historically grants anon table access;
-- migration 202607270010 establishes the final hardened clients contract.
begin;

do $$
begin
  if has_table_privilege('anon', 'public.clients', 'select') then
    raise exception 'ANON_PRIVATE_CLIENT_READ_ALLOWED';
  end if;
end;
$$;

set local role anon;
do $$
declare
  v_denied boolean := false;
begin
  begin
    perform 1 from public.clients limit 1;
  exception when insufficient_privilege then
    v_denied := true;
  end;

  if not v_denied then
    raise exception 'ANON_PRIVATE_CLIENT_READ_ALLOWED';
  end if;
end;
$$;
reset role;

rollback;
