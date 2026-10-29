import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Active user-facing copy must match the trial authority (3 calendar months, migration 202610280050).
const ACTIVE_COPY = [
  "src/app/auth/register/page.tsx",
  "src/app/pricing/page.tsx",
  "src/features/landing/LandingPage.tsx",
  "src/features/onboarding/components/OnboardingLayout.tsx",
  "src/features/pricing/components/PricingCards.tsx",
];

test("active trial copy promises 3 months free without a card and no other duration", () => {
  for (const file of ACTIVE_COPY) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /14[ -]?(dana|dnevn)|\b90 dana|5 meseci|pet meseci/i, file);
  }
  const combined = ACTIVE_COPY.map((file) => readFileSync(file, "utf8")).join("\n");
  assert.match(combined, /3 meseca besplatno, bez kartice/);
  // never promises an automatic charge or a new free period on repurchase
  assert.doesNotMatch(combined, /automatski (naplać|naplat)|nov[io] (besplatn|probn)/i);
});
