do $$
declare
  v_later_appointment_id constant uuid :=
    '876abe75-5ae2-4d6f-8c7a-22aee8701a8f';
  v_kept_appointment_id constant uuid :=
    'e1c6c279-66a9-433b-b97c-6a347352f11d';
begin
  if not exists (
    select 1
    from public.appointments appointment
    where appointment.id = v_kept_appointment_id
  ) then
    raise exception 'Expected earlier appointment % was not found.',
      v_kept_appointment_id;
  end if;

  if not exists (
    select 1
    from public.appointments appointment
    where appointment.id = v_later_appointment_id
  ) then
    raise exception 'Expected later appointment % was not found.',
      v_later_appointment_id;
  end if;

  update public.appointments
  set
    status = 'cancelled',
    cancellation_reason = coalesce(
      cancellation_reason,
      'Duplicate public booking conflict resolved before overlap constraint'
    )
  where id = v_later_appointment_id
    and status in ('pending', 'confirmed');
end;
$$;
