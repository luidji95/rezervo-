do $$
begin
  if exists (
    select 1
    from public.employees
    where profile_id is not null
    group by salon_id, profile_id
    having count(*) > 1
  ) then
    raise exception
      'Cannot create employees_unique_profile_per_salon: duplicate (salon_id, profile_id) links exist.';
  end if;
end;
$$;

create unique index if not exists employees_unique_profile_per_salon
  on public.employees (salon_id, profile_id)
  where profile_id is not null;
