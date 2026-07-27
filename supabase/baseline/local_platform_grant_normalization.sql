-- Supabase local images may preconfigure direct anon/authenticated EXECUTE
-- defaults before this repository baseline is restored. Production has no
-- such grants on the service-only routines below. Apply immediately after
-- schema.sql on a new/disposable environment; never as a production migration.
do $$
declare
  v_routine record;
begin
  for v_routine in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = any(array[
        'accept_team_invitation',
        'apply_infobip_sms_delivery_report',
        'claim_due_appointment_reminders',
        'cleanup_simulation_run',
        'create_employee_appointment_atomic',
        'create_public_booking_atomic',
        'finalize_claimed_reminder_delivery',
        'get_owner_clients_page_v1',
        'get_owner_statistics_v1',
        'get_salon_reminder_usage',
        'get_simulation_schema_contract',
        'insert_simulation_appointment_batch',
        'insert_simulation_client_batch',
        'preview_due_appointment_reminders',
        'recover_accepted_reminder_delivery',
        'reminder_usage_period',
        'set_reminder_updated_at',
        'update_employee_appointment_status',
        'validate_claimed_reminder_for_send'
      ])
  loop
    execute format(
      'revoke execute on function %s from anon, authenticated',
      v_routine.signature
    );
  end loop;

  revoke execute on function public.create_employee_with_entitlement(
    uuid, text, text, text, text, text, text
  ) from anon;
end;
$$;
