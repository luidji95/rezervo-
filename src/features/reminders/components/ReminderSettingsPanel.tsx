"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import {
  BellRing,
  CheckCircle2,
  Clock3,
  Info,
  LockKeyhole,
  MessageSquareText,
  RefreshCw,
  Smartphone,
} from "lucide-react";
import { UPGRADE_DESTINATION } from "@/features/billing/upgradeNavigation";
import { useReminderSettings } from "../hooks/useReminderSettings";
import type { ReminderSettingsErrorCode } from "../types/reminderSettingsOverview";
import styles from "./ReminderSettingsPanel.module.css";

const HOUR_OPTIONS = [1, 2, 3, 6, 12, 24, 48, 72] as const;

const ERROR_MESSAGES: Record<ReminderSettingsErrorCode, string> = {
  UNAUTHORIZED: "Prijava je istekla. Osvežite stranicu i pokušajte ponovo.",
  FORBIDDEN: "Nemate dozvolu za upravljanje reminder podešavanjima.",
  INVALID_INPUT: "Proverite izabrano vreme slanja.",
  ENTITLEMENT_REQUIRED: "SMS podsetnici nisu uključeni u trenutni paket.",
  REMINDER_RUNTIME_NOT_READY: "Automatsko slanje još nije aktivirano.",
  REMINDER_SETTINGS_LOAD_FAILED: "Podešavanja podsetnika trenutno nisu dostupna.",
  REMINDER_SETTINGS_SAVE_FAILED: "Podešavanja nisu sačuvana. Pokušajte ponovo.",
};

function formatHours(value: number) {
  if (value === 1) return "1 sat pre termina";
  if (value === 2 || value === 3) return `${value} sata pre termina`;
  return `${value} sati pre termina`;
}

function formatPeriod(start: string, end: string) {
  const startDate = new Date(start);
  const endDate = new Date(new Date(end).getTime() - 1);
  const formatter = new Intl.DateTimeFormat("sr-Latn-RS", { day: "numeric", month: "long", year: "numeric" });
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function ReminderSettingsSkeleton() {
  return <div className={styles.skeleton} aria-busy="true" aria-label="Učitavanje podešavanja SMS podsetnika"><span /><span /><span /></div>;
}

export function ReminderSettingsPanel() {
  const state = useReminderSettings();
  const [enabled, setEnabled] = useState(false);
  const [hoursBefore, setHoursBefore] = useState(24);
  const [saved, setSaved] = useState(false);
  const [loadedOverview, setLoadedOverview] = useState(state.overview);

  if (state.overview !== loadedOverview) {
    setLoadedOverview(state.overview);
    if (state.overview) {
      setEnabled(state.overview.settings.enabled);
      setHoursBefore(state.overview.settings.hoursBefore);
      setSaved(false);
    }
  }

  const dirty = state.overview
    ? enabled !== state.overview.settings.enabled || hoursBefore !== state.overview.settings.hoursBefore
    : false;
  const messagePreview = useMemo(() => {
    const salonName = state.salonName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || "Vaš salon";
    return `Podsetnik: 28. jula u 14:00 imate termin u salonu ${salonName}. Za promenu termina kontaktirajte salon.`;
  }, [state.salonName]);

  if (state.loading) return <ReminderSettingsSkeleton />;
  if (state.error && !state.overview) {
    return <section className={styles.loadError} role="alert"><BellRing size={24} aria-hidden="true" /><div><h2>Podešavanja podsetnika nisu učitana</h2><p>{ERROR_MESSAGES[state.error]}</p></div><button type="button" onClick={() => void state.retry()}><RefreshCw size={15} /> Pokušaj ponovo</button></section>;
  }
  if (!state.overview) return null;

  const { overview } = state;
  if (!overview.entitlement.canUseSmsReminders) {
    return <section className={styles.locked} aria-labelledby="reminders-locked-title"><span className={styles.lockIcon}><LockKeyhole size={25} aria-hidden="true" /></span><div><span className={styles.eyebrow}>SMS podsetnici</span><h2 id="reminders-locked-title">Dostupno u Pro paketu</h2><p>Automatski podsetite klijente pre zakazanog termina i smanjite broj propuštenih dolazaka.</p></div><Link href={UPGRADE_DESTINATION}>Pogledaj Pro paket</Link></section>;
  }

  const runtimeReady = overview.runtime.ready;
  const controlsDisabled = !runtimeReady || state.saving;

  async function handleSave() {
    setSaved(false);
    const result = await state.save({ enabled, hoursBefore });
    if (result.ok) setSaved(true);
  }

  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="reminder-settings-title">
      <div className={styles.heroIcon}><BellRing size={23} aria-hidden="true" /></div>
      <div><span className={styles.eyebrow}>Automatizacija termina</span><div className={styles.titleRow}><h2 id="reminder-settings-title">SMS podsetnici</h2><span className={runtimeReady ? styles.readyBadge : styles.soonBadge}>{runtimeReady ? "Spremno" : "Uskoro"}</span></div><p>Pošaljite profesionalan SMS klijentu pre zakazanog termina.</p></div>
    </section>

    {!runtimeReady && <div className={styles.infoAlert} role="status"><Info size={19} aria-hidden="true" /><div><strong>SMS podsetnici su uključeni u vaš paket, ali automatsko slanje još nije aktivirano.</strong><p>Obavestićemo vas kada funkcija bude spremna.</p>{overview.settings.enabled && <p className={styles.paused}>Slanje je trenutno sistemski pauzirano.</p>}</div></div>}

    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="automation-title">
        <div className={styles.cardHeader}><div><span className={styles.cardIcon}><Clock3 size={18} /></span><div><h3 id="automation-title">Podešavanja slanja</h3><p>Kontrole postaju aktivne kada production runtime bude spreman.</p></div></div></div>
        <div className={styles.toggleRow}>
          <div><label htmlFor="sms-reminder-enabled">Automatski SMS podsetnici</label><p>Klijentima će biti poslat SMS pre zakazanog termina.</p></div>
          <label className={styles.switch} title={!runtimeReady ? "Sistem se priprema" : undefined}><input id="sms-reminder-enabled" type="checkbox" checked={enabled} disabled={controlsDisabled} onChange={(event) => { setEnabled(event.target.checked); setSaved(false); }} aria-describedby="sms-runtime-explanation" /><span aria-hidden="true" /></label>
        </div>
        <div className={styles.field}><label htmlFor="sms-hours-before">Pošalji podsetnik</label><select id="sms-hours-before" value={hoursBefore} disabled={controlsDisabled || !enabled} onChange={(event) => { setHoursBefore(Number(event.target.value)); setSaved(false); }}>{!HOUR_OPTIONS.includes(hoursBefore as typeof HOUR_OPTIONS[number]) && <option value={hoursBefore}>{formatHours(hoursBefore)}</option>}{HOUR_OPTIONS.map((hours) => <option key={hours} value={hours}>{formatHours(hours)}</option>)}</select><small id="sms-runtime-explanation">{runtimeReady ? enabled ? "Vreme se računa prema vremenskoj zoni salona." : "Uključite podsetnike da biste izabrali vreme." : "Sistem se priprema; kontrole su trenutno onemogućene."}</small></div>
        {state.error && <div className={styles.inlineError} role="alert" aria-live="assertive">{ERROR_MESSAGES[state.error]}</div>}
        <div className={styles.actions}><span className={styles.saveStatus} aria-live="polite">{saved ? <><CheckCircle2 size={16} /> Podešavanja su sačuvana.</> : null}</span>{runtimeReady && <button type="button" disabled={!dirty || state.saving} onClick={() => void handleSave()}>{state.saving ? "Čuvanje..." : "Sačuvaj podešavanja"}</button>}</div>
      </section>

      <section className={styles.card} aria-labelledby="usage-title">
        <div className={styles.cardHeader}><div><span className={styles.cardIcon}><MessageSquareText size={18} /></span><div><h3 id="usage-title">Mesečna potrošnja</h3><p>Broje se poruke koje je SMS provajder prihvatio.</p></div></div></div>
        {state.usageLoading ? <div className={styles.usageSkeleton} aria-label="Učitavanje mesečne potrošnje" /> : !overview.usage ? <div className={styles.usageFallback} role="status"><p>Potrošnja trenutno nije dostupna.</p><button type="button" onClick={() => void state.retry()}>Pokušaj ponovo</button></div> : <div className={styles.usageBody}>{overview.usage.used === 0 ? <strong>Još nema poslatih SMS podsetnika u ovom periodu.</strong> : <strong>{overview.usage.limit === null ? `${overview.usage.used} SMS podsetnika ovog meseca` : `${overview.usage.used} od ${overview.usage.limit} SMS podsetnika`}</strong>}{overview.usage.limit === null && <p>Pilot pristup — limit trenutno nije postavljen.</p>}<small>Period: {formatPeriod(overview.usage.periodStart, overview.usage.periodEnd)}</small>{overview.usage.limit !== null && <div className={styles.progress} aria-label={`Iskorišćeno ${overview.usage.used} od ${overview.usage.limit}`}><span style={{ width: `${Math.min(100, overview.usage.limit === 0 ? 100 : (overview.usage.used / overview.usage.limit) * 100)}%` }} /></div>}</div>}
      </section>

      <section className={styles.card} aria-labelledby="channels-title"><div className={styles.cardHeader}><div><span className={styles.cardIcon}><Smartphone size={18} /></span><div><h3 id="channels-title">Kanali</h3><p>Dostupni i planirani kanali za podsetnike.</p></div></div></div><div className={styles.channelList}><div><span className={styles.channelLogo}>SMS</span><div><strong>SMS</strong><small>Aktivni kanal</small></div><span className={styles.activeBadge}>Dostupno</span></div><div><span className={`${styles.channelLogo} ${styles.channelLogoMuted}`}>V</span><div><strong>Viber</strong><small>Integracija je u pripremi</small></div><span className={styles.soonBadge}>Uskoro</span></div></div></section>

      <section className={`${styles.card} ${styles.previewCard}`} aria-labelledby="preview-title"><div className={styles.cardHeader}><div><span className={styles.cardIcon}><MessageSquareText size={18} /></span><div><h3 id="preview-title">Primer poruke</h3><p>Informativni preview — ova poruka nije poslata.</p></div></div></div><blockquote>{messagePreview}</blockquote></section>
    </div>
  </div>;
}
