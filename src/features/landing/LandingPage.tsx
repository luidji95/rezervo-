"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight, BarChart3, Bell, CalendarDays, Check, ChevronRight,
  Clock3, Menu, MonitorSmartphone, Sparkles, UserRound, UsersRound, X,
} from "lucide-react";
import { useAuth } from "@/context/AuthContext";

const features = [
  { icon: CalendarDays, title: "Upravljanje terminima", text: "Kalendar, rezervacije i raspored zaposlenih na jednom mestu." },
  { icon: UserRound, title: "CRM klijenata", text: "Istorija dolazaka, omiljene usluge i pregled odnosa sa klijentima." },
  { icon: UsersRound, title: "Upravljanje timom", text: "Posebni nalozi i jasne dozvole za vlasnika i zaposlene." },
  { icon: BarChart3, title: "Statistika", text: "Pregled poslovanja kroz jasne grafikone i KPI pokazatelje." },
];

const benefits = ["Owner i Employee dozvole", "Public Booking", "CRM klijenata", "Notifikacije", "Statistika", "Responsive interfejs", "Više zaposlenih", "Bez instalacije"];
const roadmap = ["AI Receptionist", "Online plaćanja", "Subscription Billing", "Online Booking Website", "Marketing automatizacija", "WhatsApp integracija", "Instagram rezervacije"];
const previews = [
  { key: "dashboard", title: "Dashboard", subtitle: "Dnevni pregled salona" },
  { key: "calendar", title: "Kalendar", subtitle: "Raspored termina i tima" },
  { key: "clients", title: "Klijenti", subtitle: "CRM i istorija dolazaka" },
  { key: "statistics", title: "Statistika", subtitle: "Trendovi i poslovni pokazatelji" },
  { key: "employee", title: "Employee Dashboard", subtitle: "Fokusiran radni pregled" },
];

function Brand() {
  return <span className="landing-brand"><span>R</span>Rezervo</span>;
}

function ProductPreview({ variant = "dashboard", large = false }: { variant?: string; large?: boolean }) {
  return <div className={`product-preview product-preview--${variant} ${large ? "product-preview--large" : ""}`} aria-label="Privremeni prikaz Rezervo aplikacije">
    <div className="product-preview__top"><span /><span /><span /><small>rezervo.app</small></div>
    <div className="product-preview__body">
      <aside><Brand /><i /><i /><i /><i /></aside>
      <div className="product-preview__content">
        <header><div><small>Dobro jutro</small><strong>{variant === "calendar" ? "Kalendar" : variant === "clients" ? "Klijenti" : variant === "statistics" ? "Statistika" : variant === "employee" ? "Moj radni dan" : "Pregled salona"}</strong></div><span /></header>
        {variant === "calendar" ? <div className="preview-calendar"><b>09:00</b><em /><b>10:00</b><em /><b>11:00</b><em /><b>12:00</b><em /></div> : variant === "clients" ? <div className="preview-clients">{[1,2,3,4].map((item) => <div key={item}><i /><span /><small /></div>)}</div> : <><div className="preview-kpis"><div /><div /><div /></div><div className="preview-chart"><span /><span /><span /><span /><span /><span /><span /></div></>}
      </div>
    </div>
  </div>;
}

export function LandingPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const landingRef = useRef<HTMLElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [preview, setPreview] = useState<(typeof previews)[number] | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.info("LANDING_AUTH_STATE", { mounted: true, authLoading: loading, userExists: Boolean(user), redirectTriggered: Boolean(!loading && user) });
    }
    if (!loading && user) router.replace("/dashboard");
  }, [loading, router, user]);
  useEffect(() => {
    const root = landingRef.current;
    if (!root) return;
    const elements = root.querySelectorAll("[data-reveal]");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const observerSupported = typeof IntersectionObserver !== "undefined";
    if (process.env.NODE_ENV === "development") {
      console.info("LANDING_REVEAL_INIT", { observerInitialized: observerSupported && !reducedMotion, observedElements: elements.length, reducedMotion });
    }
    if (!observerSupported || reducedMotion) return;
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (entry.isIntersecting) { entry.target.classList.add("is-visible"); observer.unobserve(entry.target); } }), { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
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

  return <main className="landing-page" ref={landingRef}>
    <nav className="landing-nav"><div className="landing-shell landing-nav__inner"><a href="#top" aria-label="Rezervo početna"><Brand /></a><button className="landing-nav__toggle" type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Otvori navigaciju">{menuOpen ? <X /> : <Menu />}</button><div className={`landing-nav__links ${menuOpen ? "is-open" : ""}`}><a href="#features" onClick={() => setMenuOpen(false)}>Funkcionalnosti</a><a href="#roadmap" onClick={() => setMenuOpen(false)}>Roadmap</a><Link href="/auth/login">Prijavi se</Link><Link className="landing-button landing-button--small" href="/auth/register">Započni besplatno</Link></div></div></nav>

    <section className="landing-hero" id="top"><div className="landing-shell landing-hero__grid"><div className="landing-hero__copy"><span className="landing-eyebrow"><Sparkles size={15} /> Napravljeno za moderan salon</span><h1>Upravljajte svojim salonom <em>iz jednog mesta.</em></h1><p>Rezervo pomaže frizerskim, barber i beauty salonima da upravljaju terminima, zaposlenima, klijentima i svakodnevnim poslovanjem.</p><div className="landing-hero__actions"><Link className="landing-button" href="/auth/register">Započni besplatno <ArrowRight size={18} /></Link><Link className="landing-button landing-button--secondary" href="/auth/login">Prijavi se</Link></div><div className="landing-hero__trust"><span><Check /> Bez instalacije</span><span><Check /> Radi na svim uređajima</span></div></div><div className="landing-hero__visual"><div className="landing-orbit landing-orbit--one" /><div className="landing-orbit landing-orbit--two" /><ProductPreview large /><span className="landing-float landing-float--one"><CalendarDays /> 8 termina danas</span><span className="landing-float landing-float--two"><Bell /> Nova rezervacija</span></div></div></section>

    <section className="landing-section" id="features"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Jednostavnije poslovanje</span><h2>Sve što vam je potrebno za organizovan salon.</h2><p>Manje administracije, bolji pregled i više vremena za klijente.</p></div><div className="landing-feature-grid">{features.map(({ icon: Icon, title, text }) => <article key={title} data-reveal><div><Icon /></div><h3>{title}</h3><p>{text}</p><span>Saznajte više <ChevronRight size={15} /></span></article>)}</div></div></section>

    <section className="landing-section landing-section--tinted" id="product"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Jedan sistem, ceo salon</span><h2>Kako izgleda Rezervo.</h2><p>Čist interfejs koji je dovoljno jednostavan za svakodnevni rad.</p></div><div className="landing-preview-grid">{previews.map((item, index) => <button key={item.key} type="button" className={index === 0 ? "is-featured" : ""} onClick={() => setPreview(item)} data-reveal><ProductPreview variant={item.key} /><span><strong>{item.title}</strong><small>{item.subtitle}</small></span></button>)}</div></div></section>

    <section className="landing-section"><div className="landing-shell landing-why"><div data-reveal><span className="landing-eyebrow">Zašto Rezervo</span><h2>Napravljen za stvaran radni dan.</h2><p>Od vlasnika do zaposlenog, svako dobija jasan pregled i samo one alate koji su mu potrebni.</p><div className="landing-device"><MonitorSmartphone /><span>Desktop, tablet i mobilni</span></div></div><div className="landing-benefits">{benefits.map((benefit) => <div key={benefit} data-reveal><Check />{benefit}</div>)}</div></div></section>

    <section className="landing-section landing-section--dark"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Počnite jednostavno</span><h2>Od naloga do prve rezervacije u tri koraka.</h2></div><div className="landing-steps">{["Napravite nalog", "Podesite salon, usluge i zaposlene", "Počnite da primate rezervacije"].map((step, index) => <article key={step} data-reveal><b>{index + 1}</b><h3>{step}.</h3>{index < 2 && <ArrowRight />}</article>)}</div></div></section>

    <section className="landing-section" id="roadmap"><div className="landing-shell"><div className="landing-section__heading" data-reveal><span>Coming Soon</span><h2>Rezervo tek počinje.</h2><p>Funkcionalnosti koje istražujemo za naredne verzije platforme.</p></div><div className="landing-roadmap">{roadmap.map((item) => <article key={item} data-reveal><Clock3 /><span><small>U planu</small><strong>{item}</strong></span></article>)}</div></div></section>

    <section className="landing-cta"><div className="landing-shell" data-reveal><div><span>Spremni za bolju organizaciju?</span><h2>Pokrenite svoj salon uz Rezervo.</h2></div><Link className="landing-button landing-button--light" href="/auth/register">Započni besplatno <ArrowRight /></Link></div></section>

    <footer className="landing-footer"><div className="landing-shell"><div><Brand /><p>Moderna platforma za upravljanje salonima.</p></div><div><Link href="/auth/login">Login</Link><Link href="/auth/register">Registracija</Link><a href="#" aria-label="GitHub uskoro">GitHub</a><a href="#" aria-label="Privacy uskoro">Privacy</a></div></div><div className="landing-shell landing-footer__bottom">© {new Date().getFullYear()} Rezervo. Sva prava zadržana.</div></footer>

    {preview && <div className="landing-modal" role="dialog" aria-modal="true" aria-label={`${preview.title} prikaz`} onMouseDown={(event) => { if (event.currentTarget === event.target) setPreview(null); }}><div><button type="button" onClick={() => setPreview(null)} aria-label="Zatvori prikaz"><X /></button><ProductPreview variant={preview.key} large /><h3>{preview.title}</h3><p>{preview.subtitle}</p></div></div>}
  </main>;
}
