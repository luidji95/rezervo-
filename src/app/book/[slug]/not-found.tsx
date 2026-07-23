import Link from "next/link";
import "./public-booking.css";

export default function PublicBookingNotFound() {
  return (
    <main className="public-booking-page">
      <div className="public-booking-state" role="status">
        <div className="public-booking-mark" aria-hidden="true">R</div>
        <p className="public-booking-eyebrow">404</p>
        <h1>Salon nije pronađen</h1>
        <p>Link možda više nije aktivan ili salon trenutno ne prima online rezervacije.</p>
        <Link className="public-booking-secondary-action" href="/">Nazad na Rezervo</Link>
      </div>
    </main>
  );
}
