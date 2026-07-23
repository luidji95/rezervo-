-- RLS is evaluated only after PostgreSQL's base privileges allow the command.
-- Keep recipient identity/routing immutable from the browser while permitting
-- authenticated users to read their RLS-scoped rows and update read state.

grant usage on schema public to authenticated;

revoke all privileges
  on table public.notification_recipients
  from anon;

revoke insert, delete, truncate, references, trigger
  on table public.notification_recipients
  from authenticated;

revoke update
  on table public.notification_recipients
  from authenticated;

grant select
  on table public.notification_recipients
  to authenticated;

grant update (is_read, read_at)
  on table public.notification_recipients
  to authenticated;

-- Ask PostgREST to refresh its privilege/schema cache after this migration.
notify pgrst, 'reload schema';
