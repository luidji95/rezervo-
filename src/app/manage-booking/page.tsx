import type { Metadata } from "next";
import { connection } from "next/server";
import { PublicBookingManage } from "@/features/public-booking/components/PublicBookingManage";
import "../book/[slug]/public-booking.css";

// Private page reached through /manage-booking#<token>. The token stays in the URL fragment, so it never reaches the
// server, its logs or a Referer header; the page itself is the same for everyone and holds no booking data.
export const metadata: Metadata = {
  title: "Vaš termin | Rezervo",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
  referrer: "no-referrer",
};

export default async function ManageBookingPage() {
  await connection();
  return (
    <main className="public-booking-page pb-page">
      <PublicBookingManage />
    </main>
  );
}
