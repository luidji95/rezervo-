-- Server-only operator runbook. Run with explicit psql variables, for example:
-- psql ... -v plan_slug=starter -v provider=lemonsqueezy -v environment=test
--   -v billing_interval=monthly -v currency=RSD -v amount=2990
--   -v provider_product_id=... -v provider_variant_id=... -v live_confirm=NO
-- This file ends in ROLLBACK. Review the result and consciously replace it with
-- COMMIT only for an approved operation. Never paste credentials into this file.

\if :{?plan_slug}
\else
  \echo 'plan_slug is required'
  \quit 3
\endif
\if :{?provider_variant_id}
\else
  \echo 'provider_variant_id is required'
  \quit 3
\endif
\if :{?provider_product_id}
\else
  \echo 'provider_product_id is required (use an empty value when absent)'
  \quit 3
\endif
\if :{?provider}
\else
  \echo 'provider is required'
  \quit 3
\endif
\if :{?environment}
\else
  \echo 'environment is required'
  \quit 3
\endif
\if :{?billing_interval}
\else
  \echo 'billing_interval is required'
  \quit 3
\endif
\if :{?currency}
\else
  \echo 'currency is required'
  \quit 3
\endif
\if :{?amount}
\else
  \echo 'amount is required'
  \quit 3
\endif
\if :{?live_confirm}
\else
  \echo 'live_confirm is required'
  \quit 3
\endif

begin;

select set_config('billing.mapping.plan_slug', :'plan_slug', true);
select set_config('billing.mapping.provider', :'provider', true);
select set_config('billing.mapping.environment', :'environment', true);
select set_config('billing.mapping.interval', :'billing_interval', true);
select set_config('billing.mapping.currency', :'currency', true);
select set_config('billing.mapping.amount', :'amount', true);
select set_config('billing.mapping.live_confirm', :'live_confirm', true);

do $$
declare
  v_plan public.plans%rowtype;
  v_plan_slug text := current_setting('billing.mapping.plan_slug');
  v_provider text := current_setting('billing.mapping.provider');
  v_environment text := current_setting('billing.mapping.environment');
  v_interval text := current_setting('billing.mapping.interval');
  v_currency text := current_setting('billing.mapping.currency');
  v_amount numeric := current_setting('billing.mapping.amount')::numeric;
  v_live_confirm text := current_setting('billing.mapping.live_confirm');
begin
  if v_provider <> 'lemonsqueezy' then raise exception 'UNSUPPORTED_PROVIDER'; end if;
  if v_environment not in ('test', 'live') then raise exception 'INVALID_ENVIRONMENT'; end if;
  if v_environment = 'live' and v_live_confirm <> 'CONFIRM_LIVE_MAPPING' then
    raise exception 'LIVE_MAPPING_REQUIRES_EXPLICIT_CONFIRMATION';
  end if;
  if v_interval <> 'monthly' then raise exception 'YEARLY_NOT_SUPPORTED'; end if;
  if v_currency <> 'RSD' then raise exception 'RSD_REQUIRED'; end if;

  select * into strict v_plan from public.plans where slug = v_plan_slug;
  if v_plan.slug not in ('starter', 'pro') or not v_plan.is_active then
    raise exception 'BILLING_PLAN_NOT_AVAILABLE';
  end if;
  if v_plan.monthly_price <> v_amount or v_plan.currency <> v_currency then
    raise exception 'BILLING_PRICE_MISMATCH';
  end if;
  if exists (
    select 1 from public.billing_provider_prices m
    where m.provider = v_provider and m.environment = v_environment
      and m.plan_id = v_plan.id and m.billing_interval = v_interval
      and m.currency = v_currency and m.is_active
  ) then raise exception 'ACTIVE_MAPPING_ALREADY_EXISTS'; end if;
end;
$$;

insert into public.billing_provider_prices (
  plan_id, provider, environment, billing_interval, currency, amount,
  provider_product_id, provider_variant_id
)
select p.id, :'provider', :'environment', :'billing_interval', :'currency',
       :'amount'::numeric, nullif(:'provider_product_id', ''), :'provider_variant_id'
from public.plans p
where p.slug = :'plan_slug';

select p.slug, m.provider, m.environment, m.billing_interval, m.currency,
       m.amount, m.is_active, m.provider_product_id is not null as has_product_id,
       m.provider_variant_id is not null as has_variant_id
from public.billing_provider_prices m
join public.plans p on p.id = m.plan_id
where p.slug = :'plan_slug' and m.provider = :'provider'
  and m.environment = :'environment';

rollback;
