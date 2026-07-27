# Public pricing and trial acquisition

The public catalogue is loaded server-side from `public.plans`, sanitized, and cached for one hour under the `public-plan-catalog` tag. A future catalogue mutation can call `revalidateTag("public-plan-catalog")`; normal updates also become visible when the TTL expires. Missing or malformed catalogue rows produce an unavailable state, never a fabricated price.

The public response contains only the plan slug/code, display name, monthly and nullable yearly price, currency, employee limit, public availability and relevant capability flags. It excludes plan UUIDs, timestamps, provider metadata, subscriptions and administrative fields. The loader fails closed unless Starter, Pro and Premium all match the canonical RSD contract: 2,990/5,990/17,990 RSD, employee limits 3/10/25, no yearly price, Starter and Pro active, Premium inactive.

Starter and Pro CTA clicks are acquisition context only. Both create the same account flow and every newly created salon receives the existing 14-day Pro trial from the database trigger. No pricing query parameter writes `plan_id`, purchases a plan, creates a second trial, or stores a requested plan. Premium is visible as coming soon and has no signup action.

The optional `next` parameter is restricted to an explicit internal allowlist. Authentication first resolves the authoritative salon/onboarding state: missing or incomplete salons go to onboarding; completed salons may continue to a safe internal route. Existing owners cannot obtain another trial by opening registration or onboarding.

Pricing query parameters are presentation-only. `plan` accepts only `starter` or `pro`; `premium` and unknown values are ignored. Anonymous Starter and Pro actions go through registration with `next=/onboarding`. Authenticated users without a salon or with unfinished onboarding continue to `/onboarding`; completed and read-only salon users go to Settings → Plaćanje i plan. Premium is labelled `Uskoro` and has no registration action.

Registration and login sanitize `next` before navigation or forwarding. The allowlist currently contains `/onboarding`, `/dashboard`, `/settings` and `/settings?tab=billing`; absolute, protocol-relative, encoded external, backslash and unknown paths fail closed. Email confirmation redirects are built from the browser's current origin, so local development stays local and a production signup stays on the deployed HTTPS origin.

The local Supabase auth configuration uses localhost URLs. Production Site URL and redirect allowlist must contain the deployed HTTPS login callback and were not mutated by this phase. Smoke testing pricing requires no production writes; email confirmation and onboarding writes require an explicitly approved test account.

There is no checkout, card, payment method, automatic renewal, annual price, or plan-switch mutation. Those actions belong to the checkout-ready billing lifecycle phase.

The Billing tab is informational. It uses the existing authenticated entitlement and billing-overview contracts, shows the real `trial_ends_at`, rounds positive partial trial days up and clamps expired trials to zero. Legacy active access and internal/pilot/complimentary/support overrides never invent a renewal or payment. The global read-only banner links to `/settings?tab=billing`.

Production smoke for this phase is read-only: verify `/`, `/pricing`, CTA hrefs, registration copy and responsive rendering without creating an Auth user, salon or trial. Operators must confirm the Supabase Auth Site URL and redirect allowlist contain the deployed HTTPS login URL; this phase does not mutate dashboard configuration.

Phase 7B owns checkout/payment-provider integration, actual plan selection or switching, billing lifecycle mutations, invoices/payment methods and any SMS credit model.

## Production URL and deployment contract

The canonical public MVP URL is `https://rezervo-app-gamma.vercel.app`. It serves the current `origin/main` application and is public, while immutable Vercel deployment URLs remain protected. `NEXT_PUBLIC_APP_URL` is the single explicit application URL override. When it is absent, server metadata uses Vercel's `VERCEL_PROJECT_PRODUCTION_URL`; local development falls back to `http://localhost:3000`.

Supabase Auth Site URL must match the canonical public URL. Its exact redirect allowlist retains local development and contains `/auth/login` for email confirmation plus `/auth/accept-invite` for invitations on both the production and localhost origins. Existing `/auth/callback` entries are retained until a separate auth-route cleanup confirms they are unused.

The two Vercel integrations named `rezervo` and `rezervo-app` currently build the same Git repository and `main` commit. The public `rezervo-app-gamma.vercel.app` alias is the canonical acquisition surface; the other integration is treated as a duplicate until an authenticated Vercel project audit can confirm project IDs, domain ownership and safe alias removal. Do not delete either project or move aliases without that audit.

Production acceptance smoke is read-only: request `/`, `/pricing`, `/auth/register`, `/auth/login` and `/auth/accept-invite`; verify the canonical RSD catalogue, metadata, safe CTA query parameters and absence of checkout/provider UI. Never create an Auth user, salon or trial for this smoke.

The onboarding route redirect remains an AuthorizationContext UX guard. It is not a security boundary: `create_primary_salon_once_v1()` derives ownership from `auth.uid()`, is idempotent, the named owner constraint prevents a second primary salon, and direct authenticated salon bootstrap inserts are denied. A future architecture phase may introduce a server-readable Supabase cookie session, middleware/server route guards and server-side authorization bootstrap; that work is intentionally outside this MVP rollout.
