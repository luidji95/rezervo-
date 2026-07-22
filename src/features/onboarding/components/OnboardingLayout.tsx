import type { ReactNode } from "react";

type OnboardingLayoutProps = {
  children: ReactNode;
  submitError: string | null;
  userEmail: string;
};

export function OnboardingLayout({
  children,
  submitError,
  userEmail,
}: OnboardingLayoutProps) {
  return (
    <main className="onboarding-page">
      <section className="onboarding-shell">
        <h1>Kreirajte svoj salon</h1>

        <p>Unesite osnovne informacije i odmah nastavite na dashboard.</p>
        <p className="onboarding-user">Prijavljeni ste kao {userEmail}</p>

        {submitError && <p className="onboarding-error">{submitError}</p>}

        {children}
      </section>
    </main>
  );
}
