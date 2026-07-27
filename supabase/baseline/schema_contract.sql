-- Stable, data-free schema inventory used for clean/remote parity checks.
-- Environment-specific owners, Vault contents, Cron jobs and row data are omitted.
select jsonb_pretty(jsonb_build_object(
  'enums', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schema_name, x.type_name, x.enum_order), '[]'::jsonb) from (
    select n.nspname schema_name, t.typname type_name, e.enumsortorder enum_order, e.enumlabel enum_value
    from pg_type t join pg_namespace n on n.oid=t.typnamespace join pg_enum e on e.enumtypid=t.oid
    where n.nspname in ('public','private')
  ) x),
  'columns', (select coalesce(jsonb_agg(to_jsonb(x) order by x.table_schema, x.table_name, x.ordinal_position), '[]'::jsonb) from (
    select table_schema, table_name, ordinal_position, column_name, data_type, udt_schema, udt_name, is_nullable, column_default
    from information_schema.columns where table_schema in ('public','private')
  ) x),
  'constraints', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schema_name, x.table_name, x.constraint_name), '[]'::jsonb) from (
    select n.nspname schema_name, c.relname table_name, con.conname constraint_name,
           con.contype constraint_type, pg_get_constraintdef(con.oid, true) definition
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private')
  ) x),
  'indexes', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schemaname, x.tablename, x.indexname), '[]'::jsonb)
    from (select schemaname, tablename, indexname, indexdef from pg_indexes where schemaname in ('public','private')) x),
  'functions', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schema_name, x.signature), '[]'::jsonb) from (
    select n.nspname schema_name, p.oid::regprocedure::text signature, p.prosecdef security_definer,
           pg_get_function_result(p.oid) result_type, coalesce(array_to_string(p.proconfig, ','), '') config
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')
  ) x),
  'triggers', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schema_name, x.table_name, x.trigger_name), '[]'::jsonb) from (
    select n.nspname schema_name, c.relname table_name, t.tgname trigger_name, pg_get_triggerdef(t.oid, true) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and n.nspname in ('public','private')
  ) x),
  'rls', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schema_name, x.table_name), '[]'::jsonb) from (
    select n.nspname schema_name, c.relname table_name, c.relrowsecurity enabled, c.relforcerowsecurity forced
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where c.relkind in ('r','p') and n.nspname in ('public','private')
  ) x),
  'policies', (select coalesce(jsonb_agg(to_jsonb(x) order by x.schemaname, x.tablename, x.policyname), '[]'::jsonb)
    from (select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
          from pg_policies where schemaname in ('public','private')) x),
  'grants', (select coalesce(jsonb_agg(to_jsonb(x) order by x.object_schema, x.object_name, x.grantee, x.privilege_type), '[]'::jsonb) from (
    select table_schema object_schema, table_name object_name, grantee, privilege_type, 'table' object_type
    from information_schema.role_table_grants where table_schema in ('public','private')
    union all
    select routine_schema, routine_name, grantee, privilege_type, 'function'
    from information_schema.role_routine_grants where routine_schema in ('public','private')
  ) x)
));
