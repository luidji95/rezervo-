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
  FORBIDDEN: "Nemate dozvolu za upravljanje SMS podešavanjima.",
  INVALID_INPUT: "Proverite izabrano vreme slanja.",
  ENTITLEMENT_REQUIRED: "SMS obaveštenja nisu uključena u trenutni paket.",
  SALON_WRITE_ACCESS_REQUIRED: "Podešavanja trenutno ne mogu da se menjaju jer je salon u režimu pregleda.",
  REMINDER_SETTINGS_LOAD_FAILED: "SMS podešavanja trenutno nisu dostupna.",
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
  return <div className={styles.skeleton} aria-busy="true" aria-label="Učitavanje SMS podešavanja"><span /><span /><span /></div>;
}

export function ReminderSettingsPanel() {
  const state = useReminderSettings();
  const [smsEnabled, setSmsEnabled] = useState(false);
  const [reminderEnabled, setReminderEnabled] = useState(false);
  const [hoursBefore, setHoursBefore] = useState(24);
  const [saved, setSaved] = useState(false);
  const [loadedOverview, setLoadedOverview] = useState(state.overview);

  if (state.overview !== loadedOverview) {
    setLoadedOverview(state.overview);
    if (state.overview) {
      setSmsEnabled(state.overview.settings.smsEnabled);
      setReminderEnabled(state.overview.settings.reminderEnabled);
      setHoursBefore(state.overview.settings.hoursBefore);
      setSaved(false);
    }
  }

  const dirty = state.overview
    ? smsEnabled !== state.overview.settings.smsEnabled
      || reminderEnabled !== state.overview.settings.reminderEnabled
      || hoursBefore !== state.overview.settings.hoursBefore
    : false;
  const previews = useMemo(() => {
    const salonName = state.salonName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() || "Vaš salon";
    return {
      confirmation: `Termin u salonu ${salonName} je potvrdjen za 28. jula u 14:00. Pregled i otkazivanje: [privatni link]`,
      reminder: `Podsetnik: 28. jula u 14:00 imate termin u salonu ${salonName}. Za promenu termina kontaktirajte salon.`,
    };
  }, [state.salonName]);

  if (state.loading) return <ReminderSettingsSkeleton />;
  if (state.error && !state.overview) {
    return <section className={styles.loadError} role="alert"><BellRing size={24} aria-hidden="true" /><div><h2>SMS podešavanja nisu učitana</h2><p>{ERROR_MESSAGES[state.error]}</p></div><button type="button" onClick={() => void state.retry()}><RefreshCw size={15} /> Pokušaj ponovo</button></section>;
  }
  if (!state.overview) return null;

  const { overview } = state;
  if (!overview.entitlement.canUseSmsReminders) {
    return <section className={styles.locked} aria-labelledby="sms-locked-title"><span className={styles.lockIcon}><LockKeyhole size={25} aria-hidden="true" /></span><div><span className={styles.eyebrow}>SMS obaveštenja</span><h2 id="sms-locked-title">Dostupno u Pro paketu</h2><p>Klijenti dobijaju SMS potvrdu odmah nakon online rezervacije i podsetnik pre termina.</p></div><Link href={UPGRADE_DESTINATION}>Pogledaj Pro paket</Link></section>;
  }

  const { confirmationsReady, remindersReady } = overview.runtime;
  const reminderAvailable = smsEnabled && !state.saving;
  const pausedConfirmations = overview.settings.smsEnabled && !confirmationsReady;
  const pausedReminders = overview.settings.smsEnabled && overview.settings.reminderEnabled && !remindersReady;
  const pausedDetail = pausedConfirmations && pausedReminders
    ? "Pauzirane su potvrde i podsetnici."
    : pausedConfirmations ? "Pauzirane su SMS potvrde." : "Pauzirani su podsetnici.";

  async function handleSave() {
    setSaved(false);
    const result = await state.save({ smsEnabled, reminderEnabled, hoursBefore });
    if (result.ok) setSaved(true);
  }

  return <div className={styles.page}>
    <section className={styles.hero} aria-labelledby="sms-settings-title">
      <div className={styles.heroIcon}><BellRing size={23} aria-hidden="true" /></div>
      <div><span className={styles.eyebrow}>Automatizacija termina</span><div className={styles.titleRow}><h2 id="sms-settings-title">SMS obaveštenja</h2><span className={overview.settings.smsEnabled ? styles.readyBadge : styles.soonBadge}>{overview.settings.smsEnabled ? "Uključeno" : "Isključeno"}</span></div><p>Klijent dobija SMS potvrdu odmah nakon online rezervacije, a po želji i podsetnik pre termina.</p></div>
    </section>

    {(pausedConfirmations || pausedReminders) && <div className={styles.infoAlert} role="status"><Info size={19} aria-hidden="true" /><div><strong>Slanje je trenutno sistemski pauzirano.</strong><p>Vaša podešavanja su sačuvana i slanje se nastavlja kada pauza prestane. {pausedDetail}</p></div></div>}

    <div className={styles.grid}>
      <section className={styles.card} aria-labelledby="automation-title">
        <div className={styles.cardHeader}><div><span className={styles.cardIcon}><Clock3 size={18} /></span><div><h3 id="automation-title">Podešavanja slanja</h3><p>Promene važe za nove rezervacije i podsetnike koji još nisu poslati.</p></div></div></div>
        <div className={styles.toggleRow}>
          <div><label htmlFor="sms-notifications-enabled">SMS obaveštenja</label><p>Odmah nakon online rezervacije klijent dobija SMS potvrdu sa detaljima termina i privatnim linkom za pregled i otkazivanje.</p></div>
          <label className={styles.switch}><input id="sms-notifications-enabled" type="checkbox" checked={smsEnabled} disabled={state.saving} onChange={(event) => { setSmsEnabled(event.target.checked); setSaved(false); }} /><span aria-hidden="true" /></label>
        </div>
        <div className={`${styles.toggleRow} ${styles.subOption}`} aria-disabled={!smsEnabled}>
          <div><label htmlFor="sms-reminder-enabled">Podsetnik pre termina</label><p>{smsEnabled ? "Pored potvrde, klijent dobija i podsetnik u izabrano vreme pre termina." : "Dostupno kada su SMS obaveštenja uključena."}</p></div>
          <label className={styles.switch}><input id="sms-reminder-enabled" type="checkbox" checked={smsEnabled && reminderEnabled} disabled={!reminderAvailable} onChange={(event) => { setReminderEnabled(event.target.checked); setSaved(false); }} aria-describedby="sms-hours-explanation" /><span aria-hidden="true" /></label>
        </div>
        <div className={styles.field}><label htmlFor="sms-hours-before">Pošalji podsetnik</label><select id="sms-hours-before" value={hoursBefore} disabled={!reminderAvailable || !reminderEnabled} onChange={(event) => { setHoursBefore(Number(event.target.value)); setSaved(false); }}>{!HOUR_OPTIONS.includes(hoursBefore as typeof HOUR_OPTIONS[number]) && <option value={hoursBefore}>{formatHours(hoursBefore)}</option>}{HOUR_OPTIONS.map((hours) => <option key={hours} value={hours}>{formatHours(hours)}</option>)}</select><small id="sms-hours-explanation">{smsEnabled && reminderEnabled ? "Vreme se računa prema vremenskoj zoni salona. Otkazani termini ne dobijaju podsetnik." : "Uključite podsetnik da biste izabrali vreme."}</small></div>
        {state.error && <div className={styles.inlineError} role="alert" aria-live="assertive">{ERROR_MESSAGES[state.error]}</div>}
        <div className={styles.actions}><span className={styles.saveStatus} aria-live="polite">{saved ? <><CheckCircle2 size={16} /> Podešavanja su sačuvana.</> : null}</span><button type="button" disabled={!dirty || state.saving} onClick={() => void handleSave()}>{state.saving ? "Čuvanje..." : "Sačuvaj podešavanja"}</button></div>
      </section>

      <section className={styles.card} aria-labelledby="usage-title">
        <div className={styles.cardHeader}><div><span className={styles.cardIcon}><MessageSquareText size={18} /></span><div><h3 id="usage-title">Poslati podsetnici</h3><p>Broje se podsetnici koje je SMS provajder prihvatio.</p></div></div></div>
        {state.usageLoading ? <div className={styles.usageSkeleton} aria-label="Učitavanje poslatih podsetnika" /> : !overview.usage ? <div className={styles.usageFallback} role="status"><p>Pregled trenutno nije dostupan.</p><button type="button" onClick={() => void state.retry()}>Pokušaj ponovo</button></div> : <div className={styles.usageBody}>{overview.usage.used === 0 ? <strong>Još nema poslatih SMS podsetnika u ovom periodu.</strong> : <strong>{overview.usage.limit === null ? `${overview.usage.used} SMS podsetnika ovog meseca` : `${overview.usage.used} od ${overview.usage.limit} SMS podsetnika`}</strong>}<small>Period: {formatPeriod(overview.usage.periodStart, overview.usage.periodEnd)}</small>{overview.usage.limit !== null && <div className={styles.progress} aria-label={`Iskorišćeno ${overview.usage.used} od ${overview.usage.limit}`}><span style={{ width: `${Math.min(100, overview.usage.limit === 0 ? 100 : (overview.usage.used / overview.usage.limit) * 100)}%` }} /></div>}</div>}
      </section>

      <section className={styles.card} aria-labelledby="channels-title"><div className={styles.cardHeader}><div><span className={styles.cardIcon}><Smartphone size={18} /></span><div><h3 id="channels-title">Kanali</h3><p>Dostupni i planirani kanali za obaveštenja.</p></div></div></div><div className={styles.channelList}><div><span className={styles.channelLogo}>SMS</span><div><strong>SMS</strong><small>Aktivni kanal</small></div><span className={styles.activeBadge}>Dostupno</span></div><div><span className={`${styles.channelLogo} ${styles.channelLogoMuted}`}>V</span><div><strong>Viber</strong><small>Integracija je u pripremi</small></div><span className={styles.soonBadge}>Uskoro</span></div></div></section>

      <section className={`${styles.card} ${styles.previewCard}`} aria-labelledby="preview-title"><div className={styles.cardHeader}><div><span className={styles.cardIcon}><MessageSquareText size={18} /></span><div><h3 id="preview-title">Primer poruka</h3><p>Informativni prikaz — ove poruke nisu poslate.</p></div></div></div><p className={styles.previewLabel}>Potvrda rezervacije</p><blockquote>{previews.confirmation}</blockquote><p className={styles.previewLabel}>Podsetnik pre termina</p><blockquote>{previews.reminder}</blockquote></section>
    </div>
  </div>;
}
