import type { Metadata } from "next";
import Link from "next/link";
import { PricingCards } from "@/features/pricing/components/PricingCards";
import { getPublicPlanCatalog } from "@/features/pricing/services/publicPlanCatalog";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Cene i paketi | Rezervo",
  description: "Uporedite Starter, Pro i budući Premium paket za upravljanje salonom. Novi saloni dobijaju 14 dana Pro funkcija bez kartice.",
  alternates: { canonical: "/pricing" },
  openGraph: { title: "Rezervo paketi", description: "14 dana Pro funkcija bez kartice.", type: "website", url: "/pricing" },
};

export default async function PricingPage() {
  const plans = await getPublicPlanCatalog();
  return <main className={styles.page}><nav className={styles.nav}><Link href="/">Rezervo</Link><div><Link href="/auth/login">Prijavi se</Link><Link href="/auth/register?next=%2Fonboarding&source=pricing">Registracija</Link></div></nav><header><span>Paketi</span><h1>Izaberite paket nakon što upoznate Rezervo.</h1><p>Svi novi saloni dobijaju 14 dana Pro funkcija bez kartice. Paket birate nakon probnog perioda.</p></header>{plans ? <PricingCards plans={plans} /> : <section className={styles.unavailable} role="status"><h2>Paketi trenutno nisu dostupni</h2><p>Informacije o paketima trenutno nisu dostupne. Pokušajte ponovo uskoro.</p></section>}<section className={styles.explainer}><h2>Kako funkcioniše probni period?</h2><ol><li>Kreirate nalog i podesite salon.</li><li>Kada kreirate salon, počinje 14-dnevni Pro probni period bez kartice.</li><li>Nakon probnog perioda birate paket; do tada klik na Starter ili Pro ne menja pretplatu.</li></ol><p>Checkout i online plaćanje još nisu dostupni.</p></section></main>;
}
