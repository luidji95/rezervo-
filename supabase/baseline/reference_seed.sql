-- System/reference data only. Values intentionally mirror the current
-- production plan catalogue at baseline cutover 202607270001.

insert into public.plans (
  name, slug, description, monthly_price, yearly_price, currency,
  max_employees, max_monthly_bookings, max_ai_messages,
  ai_receptionist_enabled, whatsapp_enabled, instagram_enabled,
  analytics_enabled, marketing_enabled, is_active, sort_order,
  sms_reminders_enabled, max_monthly_reminders
)
values
  (
    'Starter', 'starter', 'Basic booking system for small salons.',
    19, 190, 'EUR', 3, null, 0,
    false, false, false, false, false, true, 1, false, 0
  ),
  (
    'Pro', 'pro', 'Booking, reminders, analytics and more capacity.',
    49, 490, 'EUR', 10, null, 0,
    false, false, false, true, false, true, 2, true, null
  ),
  (
    'Premium', 'premium', 'Advanced AI receptionist and multi-channel integrations.',
    99, 990, 'EUR', 25, null, 5000,
    true, true, true, true, true, false, 3, true, null
  )
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    monthly_price = excluded.monthly_price,
    yearly_price = excluded.yearly_price,
    currency = excluded.currency,
    max_employees = excluded.max_employees,
    max_monthly_bookings = excluded.max_monthly_bookings,
    max_ai_messages = excluded.max_ai_messages,
    ai_receptionist_enabled = excluded.ai_receptionist_enabled,
    whatsapp_enabled = excluded.whatsapp_enabled,
    instagram_enabled = excluded.instagram_enabled,
    analytics_enabled = excluded.analytics_enabled,
    marketing_enabled = excluded.marketing_enabled,
    is_active = excluded.is_active,
    sort_order = excluded.sort_order,
    sms_reminders_enabled = excluded.sms_reminders_enabled,
    max_monthly_reminders = excluded.max_monthly_reminders,
    updated_at = now();
