"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  ArrowRight,
  BarChart3,
  Bell,
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  CreditCard,
  Menu,
  MonitorSmartphone,
  Play,
  Rocket,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { PricingCards } from "@/features/pricing/components/PricingCards";
import type { PublicPlan } from "@/features/pricing/types";

type FeatureId = "appointments" | "clients" | "team" | "statistics";

const features: Array<{
  id: FeatureId;
  icon: typeof CalendarDays;
  title: string;
  description: string;
  showcaseDescription: string;
  bullets: [string, string, string];
  mediaSrc: string;
  posterSrc: string;
}> = [
  {
    id: "appointments",
    icon: CalendarDays,
    title: "Upravljanje terminima",
    description: "Kalendar, rezervacije i raspored zaposlenih na jednom mestu.",
    showcaseDescription: "Od dnevnog pregleda do promene termina — ceo raspored salona ostaje jasan i ažuran.",
    bullets: ["Pregled termina po danu i zaposlenom", "Promena statusa bez napuštanja kalendara", "Otkazivanje i pomeranje termina"],
    mediaSrc: "/landing/videos/calendar-showcase.mp4",
    posterSrc: "/landing/calendar.webp",
  },
  {
    id: "clients",
    icon: UserRound,
    title: "CRM klijenata",
    description: "Istorija dolazaka, omiljene usluge i odnos sa svakim klijentom.",
    showcaseDescription: "Sve što tim treba da zna o klijentu nalazi se u jednom preglednom profilu.",
    bullets: ["Kompletna istorija dolazaka", "Omiljene i najčešće usluge", "Jasan pregled odnosa sa klijentom"],
    mediaSrc: "/landing/videos/clients-showcase.mp4",
    posterSrc: "/landing/clients.webp",
  },
  {
    id: "team",
    icon: UsersRound,
    title: "Upravljanje timom",
    description: "Posebni nalozi, jasne dozvole i pregled celog tima.",
    showcaseDescription: "Organizujte zaposlene i pristup aplikaciji bez deljenja naloga ili komplikovanih podešavanja.",
    bullets: ["Profili zaposlenih i njihove usluge", "Owner i Employee nalozi i dozvole", "Pregled tima i dostupnosti"],
    mediaSrc: "/landing/videos/team-showcase.mp4",
    posterSrc: "/landing/team.webp",
  },
  {
    id: "statistics",
    icon: BarChart3,
    title: "Statistika",
    description: "Pregled poslovanja kroz jasne grafikone i KPI pokazatelje.",
    showcaseDescription: "Pratite najvažnije rezultate salona bez tabela i ručnog računanja.",
    bullets: ["Najvažniji KPI pokazatelji", "Grafikoni trendova i izvora rezervacija", "Pregled učinka usluga i tima"],
    mediaSrc: "/landing/videos/statistics-showcase.mp4",
    posterSrc: "/landing/statistics.webp",
  },
];

const benefits = ["Owner i Employee dozvole", "Public Booking", "CRM klijenata", "Notifikacije", "Statistika", "Responsive interfejs", "Više zaposlenih", "Bez instalacije"];

const productScreens = [
  { id: "dashboard", title: "Dashboard", subtitle: "Dnevni pregled salona", src: "/landing/dashboard.webp", videoSrc: "/landing/videos/dashboard-showcase.mp4" },
  { id: "calendar", title: "Kalendar", subtitle: "Raspored termina i tima", src: "/landing/calendar.webp", videoSrc: "/landing/videos/calendar-showcase.mp4" },
  { id: "clients", title: "Klijenti", subtitle: "CRM i istorija dolazaka", src: "/landing/clients.webp", videoSrc: "/landing/videos/clients-showcase.mp4" },
  { id: "team", title: "Tim", subtitle: "Zaposleni, nalozi i dozvole", src: "/landing/team.webp", videoSrc: "/landing/videos/team-showcase.mp4" },
  { id: "statistics", title: "Statistika", subtitle: "Trendovi i poslovni pokazatelji", src: "/landing/statistics.webp", videoSrc: "/landing/videos/statistics-showcase.mp4" },
];

const roadmapGroups = [
  { label: "Dostupno", tone: "active", icon: Check, items: ["Subscription Billing", "Online Booking Website"] },
  { label: "Uskoro", tone: "soon", icon: Rocket, items: ["Online plaćanja"] },
  { label: "U planu", tone: "planned", icon: Clock3, items: ["AI Receptionist", "Marketing automatizacija", "WhatsApp integracija", "Instagram rezervacije"] },
] as const;

function Brand() {
  return <span className="landing-brand"><span>R</span>Rezervo</span>;
}

function ProductShot({ src, alt, priority = false }: { src: string; alt: string; priority?: boolean }) {
  return <div className="landing-product-shot">
    <Image src={src} alt={alt} fill priority={priority} sizes="(max-width: 720px) 100vw, (max-width: 1100px) 90vw, 1100px" />
  </div>;
}

// Kratak nemi snimak ekrana aplikacije. Automatski se pusti u krug, osim kada korisnik
// u sistemu trazi manje animacija; tada ostaje poster, a kontrole su dostupne.
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function ProductVideo({ src, poster, label, controls = false }: { src: string; poster: string; label: string; controls?: boolean }) {
  // Na serveru se ne zna sistemsko podesavanje, pa se tamo video ne pusti sam.
  const autoPlay = useSyncExternalStore(
    subscribeToReducedMotion,
    () => !window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
  return <div className="landing-product-shot landing-product-video">
    <video key={`${src}-${autoPlay}`} src={src} poster={poster} aria-label={label} autoPlay={autoPlay} muted loop playsInline preload="metadata" controls={controls || !autoPlay} />
  </div>;
}

function FeatureShowcase({ feature }: { feature: (typeof features)[number] }) {
  return <div className="landing-showcase" id={`feature-${feature.id}`} role="region" aria-label={`${feature.title} detalji`}>
    <div className="landing-showcase__media">
      <ProductVideo src={feature.mediaSrc} poster={feature.posterSrc} label={`${feature.title} u Rezervo aplikaciji, video prikaz`} />
    </div>
    <div className="landing-showcase__copy">
      <span className="landing-eyebrow">Detaljnije</span>
      <h3>{feature.title}</h3>
      <p>{feature.showcaseDescription}</p>
      <ul>{feature.bullets.map((bullet) => <li key={bullet}><Check />{bullet}</li>)}</ul>
      <Link className="landing-button" href="/auth/register">Započni besplatno <ArrowRight size={17} /></Link>
    </div>
  </div>;
}

export function LandingPage({ plans }: { plans: PublicPlan[] | null }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const { resolution } = useAuthorization();
  const landingRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeFeature, setActiveFeature] = useState<FeatureId | null>(null);
  const [preview, setPreview] = useState<(typeof productScreens)[number] | null>(null);

  useEffect(() => {
    if (!loading && user && resolution !== "loading") {
      router.replace(resolution === "loaded_without_salon" || resolution === "loaded_with_incomplete_onboarding" ? "/onboarding" : "/dashboard");
    }
  }, [loading, resolution, router, user]);

  useEffect(() => {
    const root = landingRef.current;
    if (!root || window.matchMedia("(prefers-reduced-motion: reduce)").matches || typeof IntersectionObserver === "undefined") return;
    const elements = root.querySelectorAll("[data-reveal]");
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); }
    }), { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
    elements.forEach((element) => observer.observe(element));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!preview) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setPreview(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [preview]);

  if (user) return <main className="landing-auth-loading" aria-label="Preusmeravanje na kontrolnu tablu"><span /></main>;

  const selectedFeature = features.find((feature) => feature.id === activeFeature) ?? null;

  return <main className="landing-page" ref={landingRef}>
    <nav className="landing-nav"><div className="landing-shell landing-nav__inner"><a href="#top" aria-label="Rezervo početna"><Brand /></a><button className="landing-nav__toggle" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Otvori navigaciju">{menuOpen ? <X /> : <Menu />}</button><div className={`landing-nav__links ${menuOpen ? "is-open" : ""}`}><a href="#features" onClick={() => setMenuOpen(false)}>Funkcionalnosti</a><Link href="/pricing" onClick={() => setMenuOpen(false)}>Paketi</Link><a href="#roadmap" onClick={() => setMenuOpen(false)}>Roadmap</a><Link href="/auth/login">Prijavi se</Link><Link className="landing-button landing-button--small" href="/auth/register?next=%2Fonboarding">Započni besplatno</Link></div></div></nav>

    <section className="landing-hero" id="top"><div className="landing-shell landing-hero__grid"><div className="landing-hero__copy"><span className="landing-eyebrow"><Sparkles size={15} /> Napravljeno za moderan salon</span><h1>Upravljajte svojim salonom <em>iz jednog mesta.</em></h1><p>Rezervo pomaže frizerskim, barber i beauty salonima da upravljaju terminima, zaposlenima, klijentima i svakodnevnim poslovanjem.</p><div className="landing-hero__actions"><Link className="landing-button" href="/auth/register">Započni besplatno <ArrowRight size={18} /></Link><Link className="landing-button landing-button--secondary" href="/auth/login">Prijavi se</Link></div><div className="landing-hero__trust"><span><Check /> Bez instalacije</span><span><Check /> Radi na svim uređajima</span></div></div><div className="landing-hero__visual"><div className="landing-orbit landing-orbit--one" /><div className="landing-orbit landing-orbit--two" /><ProductShot src="/landing/dashboard.webp" alt="Rezervo dashboard sa dnevnim pregledom salona" priority /><span className="landing-float landing-float--one"><CalendarDays /> 8 termina danas</span><span className="landing-float landing-float--two"><Bell /> Nova rezervacija</span></div></div></section>

    <section className="landing-section" id="features"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Jednostavnije poslovanje</span><h2>Sve što vam je potrebno za organizovan salon.</h2><p>Manje administracije, bolji pregled i više vremena za klijente.</p></div><div className="landing-feature-grid">{features.map(({ id, icon: Icon, title, description }) => { const open = id === activeFeature; return <article key={id} className={open ? "is-active" : ""} data-reveal><div><Icon /></div><h3>{title}</h3><p>{description}</p><button type="button" aria-expanded={open} aria-controls={`feature-${id}`} onClick={() => setActiveFeature(open ? null : id)}>Saznajte više <ChevronDown size={15} /></button></article>; })}</div><div className={`landing-showcase-wrap ${selectedFeature ? "is-open" : ""}`}>{selectedFeature && <FeatureShowcase feature={selectedFeature} />}</div></div></section>

    <section className="landing-section landing-section--tinted" id="product"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Jedan sistem, ceo salon</span><h2>Kako izgleda Rezervo.</h2><p>Čist interfejs koji je dovoljno jednostavan za svakodnevni rad.</p></div><div className="landing-preview-grid">{productScreens.map((item, index) => <button key={item.id} type="button" className={index === 0 ? "is-featured" : ""} onClick={() => setPreview(item)} aria-label={`Pusti video: ${item.title}`} data-reveal><ProductShot src={item.src} alt={`${item.title} ekran Rezervo aplikacije`} /><span className="landing-play" aria-hidden="true"><Play /></span><span><strong>{item.title}</strong><small>{item.subtitle}</small></span></button>)}</div></div></section>

    <section className="landing-section"><div className="landing-shell landing-why"><div data-reveal><span className="landing-eyebrow">Zašto Rezervo</span><h2>Napravljen za stvaran radni dan.</h2><p>Od vlasnika do zaposlenog, svako dobija jasan pregled i samo one alate koji su mu potrebni.</p><div className="landing-device"><MonitorSmartphone /><span>Desktop, tablet i mobilni</span></div></div><div className="landing-benefits">{benefits.map((benefit) => <div key={benefit} data-reveal><Check />{benefit}</div>)}</div></div></section>

    <section className="landing-section landing-section--dark"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Počnite jednostavno</span><h2>Od naloga do prve rezervacije u tri koraka.</h2></div><div className="landing-steps">{["Napravite nalog", "Podesite salon, usluge i zaposlene", "Počnite da primate rezervacije"].map((step, index) => <article key={step} data-reveal><b>{index + 1}</b><h3>{step}.</h3>{index < 2 && <ArrowRight />}</article>)}</div></div></section>

    <section className="landing-section" id="pricing"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Paketi</span><h2>Počnite sa 14 dana Pro funkcija.</h2><p>Svi novi saloni dobijaju 14 dana Pro funkcija bez kartice. Paket birate nakon probnog perioda.</p></div>{plans ? <PricingCards plans={plans} compact /> : <div className="landing-pricing-unavailable" role="status"><h3>Paketi trenutno nisu dostupni</h3><p>Informacije o paketima trenutno nisu dostupne. Pokušajte ponovo uskoro.</p></div>}<div className="landing-pricing-link"><Link href="/pricing">Pogledajte kompletno poređenje paketa <ArrowRight size={17} /></Link></div></div></section>

    <section className="landing-section" id="roadmap"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Razvoj proizvoda</span><h2>Rezervo raste zajedno sa vašim salonom.</h2><p>Jasno odvajamo ono što već radi, ono što uskoro stiže i ideje koje istražujemo.</p></div><div className="landing-roadmap-groups">{roadmapGroups.map(({ label, tone, icon: Icon, items }) => <div className={`landing-roadmap-group landing-roadmap-group--${tone}`} key={label} data-reveal><header><Icon /><div><span>{label}</span><small>{items.length} {items.length === 1 ? "funkcionalnost" : "funkcionalnosti"}</small></div></header><div>{items.map((item) => <article key={item}><span>{item === "Online plaćanja" ? <CreditCard /> : <Check />}</span><strong>{item}</strong></article>)}</div></div>)}</div></div></section>

    <section className="landing-cta"><div className="landing-shell" data-reveal><div><span>Spremni za bolju organizaciju?</span><h2>Pokrenite svoj salon uz Rezervo.</h2></div><Link className="landing-button landing-button--light" href="/auth/register">Započni besplatno <ArrowRight /></Link></div></section>

    <footer className="landing-footer"><div className="landing-shell"><div><Brand /><p>Moderna platforma za upravljanje salonima.</p></div><div><Link href="/auth/login">Login</Link><Link href="/auth/register">Registracija</Link><a href="#features">Funkcionalnosti</a><a href="#roadmap">Razvoj proizvoda</a></div></div><div className="landing-shell landing-footer__bottom">© {new Date().getFullYear()} Rezervo. Sva prava zadržana.</div></footer>

    {preview && <div className="landing-modal" role="dialog" aria-modal="true" aria-label={`${preview.title} prikaz`} onMouseDown={(event) => { if (event.currentTarget === event.target) setPreview(null); }}><div><button type="button" onClick={() => setPreview(null)} aria-label="Zatvori prikaz"><X /></button><ProductVideo src={preview.videoSrc} poster={preview.src} label={`${preview.title}, video prikaz Rezervo aplikacije`} controls /><h3>{preview.title}</h3><p>{preview.subtitle}</p></div></div>}
  </main>;
}
