import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { PublicSalonHeader } from "@/features/public-booking/components/PublicSalonHeader";
import { PublicBookingSelection } from "@/features/public-booking/components/PublicBookingSelection";
import { getPublicSalonPageData } from "@/features/public-booking/services/publicBookingServerService";
import "./public-booking.css";

type Props = { params: Promise<{ slug: string }> };
const loadSalon = cache((slug: string) => getPublicSalonPageData(slug));

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  try {
    const data = await loadSalon(slug);
    if (!data) return { title: "Salon nije pronađen | Rezervo", robots: { index: false } };
    const description = data.salon.shortDescription || data.salon.description || "Book your appointment online.";
    return {
      title: `${data.salon.name} | Online Booking`,
      description,
      openGraph: {
        title: `${data.salon.name} | Online Booking`,
        description,
        type: "website",
        images: data.salon.coverImageUrl ? [{ url: data.salon.coverImageUrl, alt: data.salon.name }] : undefined,
      },
    };
  } catch {
    return { title: "Online Booking | Rezervo", description: "Book your appointment online." };
  }
}

export default async function PublicSalonPage({ params }: Props) {
  const { slug } = await params;
  let data;
  try {
    data = await loadSalon(slug);
  } catch (error) {
    console.error("PUBLIC_BOOKING_PAGE_LOAD_FAILED", { slugPresent: Boolean(slug), errorPresent: Boolean(error) });
    return <main className="public-booking-page"><div className="public-booking-state" role="alert"><div className="public-booking-mark">R</div><h1>Rezervacije trenutno nisu dostupne</h1><p>Proverite internet vezu i pokušajte ponovo.</p></div></main>;
  }

  if (!data) notFound();

  return (
    <main className="public-booking-page">
      <div className="public-booking-container">
        <PublicSalonHeader salon={data.salon} />
        {data.bookingAvailable ? <PublicBookingSelection salonId={data.salon.id} salonName={data.salon.name} salonSlug={data.salon.slug} salonTimeZone={data.salon.timezone} services={data.services} /> : <section className="public-booking-state" role="status"><h1>Online zakazivanje trenutno nije dostupno.</h1><p>Za informacije o terminima kontaktirajte salon.</p></section>}
        <footer className="public-booking-footer"><span>Rezervacije omogućava</span><strong>Rezervo</strong></footer>
      </div>
    </main>
  );
}
