begin;
create or replace function pg_temp.assert_true(v boolean,m text) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception '%',m;end if;end$$;
create or replace function pg_temp.expect_error(q text,c text) returns void language plpgsql as $$begin execute q;raise exception 'EXPECTED:%',c;exception when others then if sqlerrm='EXPECTED:'||c or position(c in sqlerrm)=0 then raise;end if;end$$;

insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
('d1000000-0000-4000-8000-000000000001','settings-a@example.invalid','{}','{}'),
('d1000000-0000-4000-8000-000000000002','settings-b@example.invalid','{}','{}');
insert into public.salons(id,owner_id,name,slug) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','Settings A','settings-a'),
('d2000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000002','Settings B','settings-b');
update public.subscriptions set status='active',trial_ends_at=null,current_period_ends_at=now()+interval '30 days'
where salon_id in ('d2000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000002');

set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select (public.update_salon_profile_v1('d2000000-0000-4000-8000-000000000001','Settings A Updated',null,null,null,null,null,null,null)).id;
select (public.upsert_working_hour_v1('d2000000-0000-4000-8000-000000000001',null,1,'09:00','17:00',null,null,true)).id;
select (public.create_closure_v1('d2000000-0000-4000-8000-000000000001',null,'Holiday',null,now()+interval '1 day',now()+interval '2 days',true)).id;
select pg_temp.expect_error($q$select (public.update_salon_profile_v1('d2000000-0000-4000-8000-000000000002','Cross tenant',null,null,null,null,null,null,null)).id$q$,'FORBIDDEN');
select pg_temp.expect_error($q$insert into public.working_hours(salon_id,day_of_week,opens_at,closes_at) values('d2000000-0000-4000-8000-000000000001',2,'09:00','17:00')$q$,'permission denied');
select pg_temp.expect_error($q$delete from public.closures where salon_id='d2000000-0000-4000-8000-000000000001'$q$,'permission denied');
reset role;

update public.subscriptions set status='expired',current_period_ends_at=now()-interval '1 day' where salon_id='d2000000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
select pg_temp.expect_error($q$select (public.update_salon_profile_v1('d2000000-0000-4000-8000-000000000001','Blocked',null,null,null,null,null,null,null)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select (public.upsert_working_hour_v1('d2000000-0000-4000-8000-000000000001',null,2,'09:00','17:00',null,null,true)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
select pg_temp.expect_error($q$select (public.create_closure_v1('d2000000-0000-4000-8000-000000000001',null,'Blocked',null,now()+interval '3 days',now()+interval '4 days',true)).id$q$,'SALON_WRITE_ACCESS_REQUIRED');
reset role;

select pg_temp.assert_true(not has_table_privilege('authenticated','public.salons','update') and not has_table_privilege('authenticated','public.salons','delete'),'SALON_DIRECT_WRITE_REMAINS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.working_hours','insert') and not has_table_privilege('authenticated','public.working_hours','update') and not has_table_privilege('authenticated','public.working_hours','delete'),'WORKING_HOURS_DIRECT_WRITE_REMAINS');
select pg_temp.assert_true(not has_table_privilege('authenticated','public.closures','insert') and not has_table_privilege('authenticated','public.closures','update') and not has_table_privilege('authenticated','public.closures','delete'),'CLOSURE_DIRECT_WRITE_REMAINS');
select pg_temp.assert_true(has_table_privilege('authenticated','public.profiles','update'),'PERSONAL_PROFILE_UPDATE_BROKEN');
select pg_temp.assert_true(has_column_privilege('authenticated','public.notification_recipients','is_read','update') and has_column_privilege('authenticated','public.notification_recipients','read_at','update'),'NOTIFICATION_READ_STATE_BROKEN');
rollback;
