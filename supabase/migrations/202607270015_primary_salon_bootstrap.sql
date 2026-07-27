-- Phase 7A.0, step A: additive primary-salon invariant and idempotent bootstrap RPC.
do $$ begin
  if exists(select 1 from public.salons s where s.owner_id is null) then raise exception 'PRIMARY_SALON_PREFLIGHT_NULL_OWNER'; end if;
  if exists(select 1 from public.salons s group by s.owner_id having count(*)>1) then raise exception 'PRIMARY_SALON_PREFLIGHT_DUPLICATE_OWNER'; end if;
  if exists(select 1 from public.salons s where not exists(select 1 from public.salon_members sm where sm.salon_id=s.id and sm.profile_id=s.owner_id and sm.role='owner' and sm.status='active')) then raise exception 'PRIMARY_SALON_PREFLIGHT_OWNER_MEMBERSHIP'; end if;
  if exists(select 1 from public.salons s where not exists(select 1 from public.subscriptions sub where sub.salon_id=s.id)) then raise exception 'PRIMARY_SALON_PREFLIGHT_SUBSCRIPTION'; end if;
end $$;

do $$ begin
  if not exists(select 1 from pg_catalog.pg_constraint c where c.conname='salons_owner_id_unique' and c.conrelid='public.salons'::regclass) then
    alter table public.salons add constraint salons_owner_id_unique unique(owner_id);
  end if;
end $$;

create or replace function public.create_primary_salon_once_v1(
  p_name text,
  p_slug_candidate text,
  p_business_type public.business_type,
  p_phone text default null,
  p_email text default null,
  p_address_line text default null,
  p_website_url text default null,
  p_instagram_url text default null,
  p_description text default null
) returns table(
  salon_id uuid, was_created boolean, salon_name text, salon_slug text,
  onboarding_completed boolean, onboarding_step integer, trial_ends_at timestamptz
)
language plpgsql security definer set search_path='' as $$
declare
  v_owner uuid:=auth.uid(); v_salon public.salons; v_membership public.salon_members;
  v_subscription public.subscriptions; v_name text:=pg_catalog.btrim(coalesce(p_name,''));
  v_base_slug text:=pg_catalog.lower(pg_catalog.btrim(coalesce(p_slug_candidate,'')));
  v_slug text; v_attempt integer:=1; v_created boolean:=false;
begin
  if v_owner is null then raise exception using errcode='P0001',message='UNAUTHORIZED'; end if;
  if v_name='' or char_length(v_name)>200 then raise exception using errcode='P0001',message='INVALID_SALON_INPUT'; end if;
  v_base_slug:=pg_catalog.regexp_replace(v_base_slug,'[^a-z0-9-]+','-','g');
  v_base_slug:=pg_catalog.btrim(v_base_slug,'-');
  if v_base_slug='' or char_length(v_base_slug)>100 then raise exception using errcode='P0001',message='INVALID_SALON_INPUT'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('rezervo:primary-salon:'||v_owner::text,0));
  select * into v_salon from public.salons s where s.owner_id=v_owner;

  if not found then
    loop
      v_slug:=case when v_attempt=1 then v_base_slug else v_base_slug||'-'||v_attempt::text end;
      begin
        insert into public.salons(owner_id,name,slug,business_type,phone,email,address_line,website_url,instagram_url,description,onboarding_completed,onboarding_step)
        values(v_owner,v_name,v_slug,p_business_type,nullif(pg_catalog.btrim(coalesce(p_phone,'')),''),nullif(pg_catalog.lower(pg_catalog.btrim(coalesce(p_email,''))),''),nullif(pg_catalog.btrim(coalesce(p_address_line,'')),''),nullif(pg_catalog.btrim(coalesce(p_website_url,'')),''),nullif(pg_catalog.btrim(coalesce(p_instagram_url,'')),''),nullif(pg_catalog.btrim(coalesce(p_description,'')),''),true,1)
        returning * into v_salon;
        v_created:=true; exit;
      exception when unique_violation then
        select * into v_salon from public.salons s where s.owner_id=v_owner;
        if found then v_created:=false; exit; end if;
        v_attempt:=v_attempt+1;
        if v_attempt>20 then raise exception using errcode='P0001',message='SLUG_CONFLICT'; end if;
      end;
    end loop;
  end if;

  select * into v_membership from public.salon_members sm where sm.salon_id=v_salon.id and sm.profile_id=v_owner;
  if found and (v_membership.role<>'owner' or v_membership.status<>'active') then
    raise exception using errcode='P0001',message='OWNER_MEMBERSHIP_CONFLICT';
  elsif not found then
    insert into public.salon_members(salon_id,profile_id,role,status,joined_at)
    values(v_salon.id,v_owner,'owner','active',pg_catalog.now());
  end if;

  select * into v_subscription from public.subscriptions sub where sub.salon_id=v_salon.id;
  if not found then raise exception using errcode='P0001',message='TRIAL_CREATION_FAILED'; end if;
  if v_created and (v_subscription.status<>'trialing' or v_subscription.trial_ends_at is null or v_subscription.billing_provider is not null or v_subscription.provider_customer_id is not null or v_subscription.provider_subscription_id is not null)
  then raise exception using errcode='P0001',message='TRIAL_CREATION_FAILED'; end if;

  return query select v_salon.id,v_created,v_salon.name,v_salon.slug,v_salon.onboarding_completed,v_salon.onboarding_step,v_subscription.trial_ends_at;
end $$;

revoke all on function public.create_primary_salon_once_v1(text,text,public.business_type,text,text,text,text,text,text) from public,anon;
grant execute on function public.create_primary_salon_once_v1(text,text,public.business_type,text,text,text,text,text,text) to authenticated,service_role;
comment on function public.create_primary_salon_once_v1(text,text,public.business_type,text,text,text,text,text,text) is 'Atomically returns or creates the authenticated owner primary salon, owner membership, and trigger-created trial.';
