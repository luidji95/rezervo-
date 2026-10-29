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

        <p>Kada kreirate salon, počinje vaš Pro probni period: 3 meseca besplatno, bez kartice. Nakon probnog perioda svi podaci ostaju sačuvani.</p>
        <p className="onboarding-user">Prijavljeni ste kao {userEmail}</p>

        {submitError && <p className="onboarding-error">{submitError}</p>}

        {children}
      </section>
    </main>
  );
}
