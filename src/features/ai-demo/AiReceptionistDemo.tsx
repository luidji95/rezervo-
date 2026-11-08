"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ArrowRight, Bot, CalendarCheck, Info, RotateCcw, Sparkles } from "lucide-react";
import {
  DEMO_BUSY,
  DEMO_EMPLOYEES,
  DEMO_SALON,
  DEMO_SERVICE,
  chooseDemoOption,
  createDemoState,
  formatPrice,
  getDemoBooking,
  getDemoChoices,
  type DemoState,
  type EmployeeId,
} from "./aiReceptionistDemoCore";
import styles from "./AiReceptionistDemo.module.css";

type Channel = "whatsapp" | "instagram";
const CHANNELS: Array<{ id: Channel; label: string }> = [{ id: "whatsapp", label: "WhatsApp" }, { id: "instagram", label: "Instagram" }];
const DAY_START = 9 * 60;
const DAY_LENGTH = 10 * 60;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";
function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
const noopSubscribe = () => () => {};

const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const blockStyle = (start: string, end: string) => ({
  top: `${((toMinutes(start) - DAY_START) / DAY_LENGTH) * 100}%`,
  height: `${((toMinutes(end) - toMinutes(start)) / DAY_LENGTH) * 100}%`,
});

export function AiReceptionistDemo() {
  const reducedMotion = useSyncExternalStore(subscribeToReducedMotion, () => window.matchMedia(REDUCED_MOTION_QUERY).matches, () => false);
  // The date label depends on the visitor's clock, so it is rendered only on the client.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const [demo, setDemo] = useState<DemoState>(() => createDemoState(new Date()));
  const [visibleCount, setVisibleCount] = useState(1);
  const [typing, setTyping] = useState(false);
  const [channel, setChannel] = useState<Channel>("whatsapp");
  const timers = useRef(new Set<number>());
  const busy = useRef(false);
  const logRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const choicesRef = useRef<HTMLDivElement>(null);
  const focusChoices = useRef(false);

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
  }, []);
  useEffect(() => clearTimers, [clearTimers]);

  const later = useCallback((callback: () => void, delay: number) => {
    const timer = window.setTimeout(() => { timers.current.delete(timer); callback(); }, delay);
    timers.current.add(timer);
  }, []);

  const revealed = visibleCount >= demo.messages.length && !typing;
  const choices = revealed ? getDemoChoices(demo) : [];
  const booking = getDemoBooking(demo);
  const done = demo.step === "done" && revealed;

  function choose(choiceId: string) {
    if (busy.current) return;
    const next = chooseDemoOption(demo, choiceId);
    if (next === demo) return;
    busy.current = true;
    focusChoices.current = true;
    stickToBottom.current = true;
    setDemo(next);
    // The visitor's own message appears at once; the receptionist answers after a short typing pause.
    setVisibleCount(demo.messages.length + 1);
    const answer = next.messages.at(-1)!;
    const finish = () => { setTyping(false); setVisibleCount(next.messages.length); busy.current = false; };
    if (reducedMotion) { finish(); return; }
    later(() => {
      setTyping(true);
      later(finish, Math.min(1500, 600 + answer.text.length * 8));
    }, 350);
  }

  function restart() {
    clearTimers();
    busy.current = false;
    focusChoices.current = true;
    stickToBottom.current = true;
    setDemo(createDemoState(new Date()));
    setVisibleCount(1);
    setTyping(false);
    setChannel("whatsapp");
  }

  // Keeps the newest message in view only while the visitor has not scrolled the conversation up.
  useEffect(() => {
    const log = logRef.current;
    if (log && stickToBottom.current) log.scrollTop = log.scrollHeight;
  }, [visibleCount, typing, channel]);

  // After an answer, keyboard focus moves to the new options without scrolling the page.
  useEffect(() => {
    if (!revealed || !focusChoices.current) return;
    focusChoices.current = false;
    choicesRef.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  }, [revealed, demo]);

  const pendingBooking = booking && demo.step !== "done" ? booking : null;
  const confirmedBooking = booking && done ? booking : null;

  return <main className={styles.page}>
    <nav className={styles.nav}><div className={styles.shell}>
      <Link href="/" className={styles.brand} aria-label="Rezervo početna"><span>R</span>Rezervo</Link>
      <Link href="/" className={styles.back}><ArrowLeft size={16} aria-hidden="true" /> Nazad na početnu</Link>
    </div></nav>

    <header className={styles.intro}><div className={styles.shell}>
      <span className={styles.badge}><Sparkles size={14} aria-hidden="true" /> Interaktivni demo — funkcija je u pripremi.</span>
      <h1>Vaš salon prima rezervacije. <em>Čak i kada ste zauzeti.</em></h1>
      <p>Ovako zamišljamo AI recepcionistu: odgovara klijentima u porukama, nudi slobodne termine i zakazuje tek kada klijent potvrdi. Izaberite odgovore i isprobajte tok razgovora.</p>
      <p className={styles.note}><Info size={16} aria-hidden="true" /> Razgovor i termini su simulirani. Ništa se ne šalje niti stvarno zakazuje.</p>
    </div></header>

    <section className={styles.demo} aria-label="Interaktivni demo AI recepcioniste"><div className={`${styles.shell} ${styles.layout}`}>
      <div className={styles.chatColumn}>
        <div className={styles.toolbar}>
          <div className={styles.channels} role="group" aria-label="Izgled razgovora">
            {CHANNELS.map((item) => <button key={item.id} type="button" aria-pressed={channel === item.id} onClick={() => setChannel(item.id)}>{item.label}</button>)}
          </div>
          <button type="button" className={styles.restart} onClick={restart}><RotateCcw size={15} aria-hidden="true" /> Pokreni ponovo</button>
        </div>
        <p className={styles.channelHint}>Izgled kanala je samo vizuelna simulacija, bez povezivanja sa WhatsApp-om ili Instagram-om.</p>

        <div className={`${styles.phone} ${channel === "whatsapp" ? styles.whatsapp : styles.instagram}`}>
          <div className={styles.chatHeader}>
            <span className={styles.avatar} aria-hidden="true">SL</span>
            <div><strong>{DEMO_SALON.name}</strong><small>AI recepcionista · simulacija</small></div>
          </div>
          <div ref={logRef} className={styles.log} role="log" aria-live="polite" aria-relevant="additions" aria-label="Razgovor"
            onScroll={(event) => { const el = event.currentTarget; stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48; }}>
            {demo.messages.slice(0, visibleCount).map((message) => <div key={message.id} className={message.from === "client" ? styles.fromClient : styles.fromReceptionist}>
              <span className={styles.srOnly}>{message.from === "client" ? "Klijent: " : "Recepcionista: "}</span>{message.text}
            </div>)}
            {typing && <div className={styles.typing} aria-hidden="true"><span /><span /><span /></div>}
            {confirmedBooking && <div className={styles.resultCard}>
              <CalendarCheck size={20} aria-hidden="true" />
              <div><strong>Termin je zakazan (simulacija)</strong><span>{confirmedBooking.service} · {confirmedBooking.employeeName} · sutra, {confirmedBooking.dayLabel} · {confirmedBooking.time}–{confirmedBooking.endTime} · {formatPrice(confirmedBooking.priceRsd)}</span></div>
            </div>}
          </div>
          {!done && <div ref={choicesRef} className={styles.choices} role="group" aria-label="Izaberite odgovor">
            {choices.map((choice) => <button key={choice.id} type="button" onClick={() => choose(choice.id)}>{choice.label}</button>)}
            {!revealed && <span className={styles.waiting}>Recepcionista odgovara…</span>}
          </div>}
        </div>

        {done && <div className={styles.outro}>
          <strong>Ovako zamišljamo AI recepcionistu za vaš salon.</strong>
          <p>Registracija otvara postojeći Rezervo za termine, klijente i online zakazivanje. AI recepcionista je u pripremi i nije deo trenutnih paketa.</p>
          <div><button type="button" onClick={restart}><RotateCcw size={16} aria-hidden="true" /> Isprobaj ponovo</button><Link href="/auth/register?next=%2Fonboarding">Započni besplatno <ArrowRight size={16} aria-hidden="true" /></Link></div>
        </div>}
      </div>

      <aside className={styles.panel} aria-label="Simulirani kalendar salona">
        <div className={styles.panelHeader}><Bot size={18} aria-hidden="true" /><div><strong>Kalendar salona</strong><small>{mounted ? `Sutra, ${demo.day.label}` : "Sutra"} · simulacija</small></div></div>
        <div className={styles.calendar}>
          <div className={styles.hours} aria-hidden="true">{["09", "11", "13", "15", "17", "19"].map((hour) => <span key={hour} style={{ top: `${((Number(hour) * 60 - DAY_START) / DAY_LENGTH) * 100}%` }}>{hour}:00</span>)}</div>
          {(Object.keys(DEMO_EMPLOYEES) as EmployeeId[]).map((employeeId) => <div key={employeeId} className={styles.column}>
            <span className={styles.columnName}>{DEMO_EMPLOYEES[employeeId].name}</span>
            <div className={styles.track}>
              {DEMO_BUSY[employeeId].map((busyBlock) => <div key={busyBlock.start} className={styles.busy} style={blockStyle(busyBlock.start, busyBlock.end)}><span>{busyBlock.start} {busyBlock.label}</span></div>)}
              {pendingBooking?.employeeId === employeeId && <div className={styles.pending} style={blockStyle(pendingBooking.time, pendingBooking.endTime)}><span>{pendingBooking.time} izabrano</span></div>}
              {confirmedBooking?.employeeId === employeeId && <div className={styles.confirmed} style={blockStyle(confirmedBooking.time, confirmedBooking.endTime)}><span>{confirmedBooking.time} Novo · {DEMO_SERVICE.name}</span></div>}
            </div>
          </div>)}
        </div>
        <dl className={styles.summary}>
          <div><dt>Usluga</dt><dd>{DEMO_SERVICE.name}, {DEMO_SERVICE.durationMinutes} min</dd></div>
          <div><dt>Zaposleni</dt><dd>{booking ? booking.employeeName : demo.employeeChoice === "any" ? "Svejedno" : demo.employeeChoice ? DEMO_EMPLOYEES[demo.employeeChoice].name : "—"}</dd></div>
          <div><dt>Vreme</dt><dd>{booking ? `${booking.time}–${booking.endTime}` : "—"}</dd></div>
          <div><dt>Cena</dt><dd>{formatPrice(DEMO_SERVICE.priceRsd)}</dd></div>
          <div><dt>Status</dt><dd>{confirmedBooking ? "Zakazano (simulacija)" : pendingBooking ? "Čeka potvrdu" : "—"}</dd></div>
        </dl>
      </aside>
    </div></section>
  </main>;
}
