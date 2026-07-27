# Production acquisition rollout

## Canonical surface

- Public URL: `https://rezervo-app-gamma.vercel.app`
- Production branch: `main`
- Repository: `luidji95/rezervo-`
- Expected production commit: verify against `origin/main` before every rollout.

The public production alias must follow the production deployment and remain accessible without Vercel Authentication. Immutable and preview deployments may remain protected. Never expose or embed a protection bypass token.

## Operator checks

1. In the authenticated Vercel dashboard, confirm which project owns `rezervo-app-gamma.vercel.app`, record its project ID and team ID, and verify its Git repository, production branch and production Supabase variables.
2. Treat the other `rezervo`/`rezervo-app` integration as a duplicate until its domains and environment variables are compared. Do not delete it during rollout discovery.
3. Set `NEXT_PUBLIC_APP_URL=https://rezervo-app-gamma.vercel.app` for Production. Preview may use Vercel's generated URL; local development falls back to `http://localhost:3000`.
4. Keep production public and preview/development protected where the Vercel plan supports that granularity.
5. Confirm Supabase Auth Site URL and the exact redirect allowlist documented in `public-pricing-and-trial-acquisition.md`.
6. Run the public read-only smoke from that document. Do not submit registration or onboarding forms.

Old short aliases that serve another application must not be promoted as Rezervo 2.0. After authenticated ownership verification, remove them from the legacy project or redirect them to the canonical URL if Vercel supports the redirect without weakening protection.
