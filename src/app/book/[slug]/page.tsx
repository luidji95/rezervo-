import { Suspense } from "react";

import { PublicSalonHeader } from "@/features/public-booking/components/PublicSalonHeader";
import { PublicBookingSelection } from "@/features/public-booking/components/PublicBookingSelection";
import { getPublicSalonPageData } from "@/features/public-booking/services/publicBookingService";

import "./public-booking.css";

type PublicSalonPageProps = {
  params: Promise<{ slug: string }>;
};

function PublicBookingState({ message }: { message: string }) {
  return (
    <div className="public-booking-state" role="status">
      <div className="public-booking-mark" aria-hidden="true">R</div>
      <h1>Online rezervacije</h1>
      <p>{message}</p>
    </div>
  );
}

async function PublicSalonContent({ params }: PublicSalonPageProps) {
  const { slug } = await params;
  const result = await loadPublicSalonPageData(slug);

  if (result.status === "error") {
    return (
      <PublicBookingState message="Trenutno ne možemo da učitamo salon. Pokušajte ponovo malo kasnije." />
    );
  }

  if (!result.data) {
    return (
      <PublicBookingState message="Salon nije pronađen ili online rezervacije trenutno nisu dostupne." />
    );
  }

  return (
    <div className="public-booking-container">
      <PublicSalonHeader salon={result.data.salon} />
      <PublicBookingSelection
        salonId={result.data.salon.id}
        salonName={result.data.salon.name}
        salonSlug={result.data.salon.slug}
        salonTimeZone={result.data.salon.timezone}
        services={result.data.services}
      />
    </div>
  );
}

async function loadPublicSalonPageData(slug: string) {
  try {
    return {
      status: "success" as const,
      data: await getPublicSalonPageData(slug),
    };
  } catch (error) {
    console.error("Failed to load public salon page:", error);
    return { status: "error" as const, data: null };
  }
}

export default function PublicSalonPage({ params }: PublicSalonPageProps) {
  return (
    <main className="public-booking-page">
      <Suspense
        fallback={<PublicBookingState message="Učitavamo podatke o salonu..." />}
      >
        <PublicSalonContent params={params} />
      </Suspense>
    </main>
  );
}
