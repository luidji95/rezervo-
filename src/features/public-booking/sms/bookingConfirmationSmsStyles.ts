// Confirmation SMS styles chosen by the salon. Templates live in code; nothing is generated or copied per salon or
// service. Placeholders: {salon}, {datum}, {vreme}, {link}. Every template keeps salon, date, time and the private
// link, and its fixed text (without placeholders) is never longer than the standard message's, so for the same booking
// a styled message is never longer and never needs an extra SMS part (enforced by the tests). GSM-7 letters only, no
// emoji: Serbian letters are written without diacritics, like the standard message.

export const SMS_CONFIRMATION_STYLES = ["business", "casual", "playful"] as const;
export type SmsConfirmationStyle = (typeof SMS_CONFIRMATION_STYLES)[number];

// Service category for the playful style only. A service without one (null) is universal.
export const SMS_HUMOR_CATEGORIES = ["haircut", "coloring", "massage"] as const;
export type SmsHumorCategory = (typeof SMS_HUMOR_CATEGORIES)[number];
export type SmsTemplateSet = "universal" | SmsHumorCategory;

export const SMS_CONFIRMATION_STYLE_LABELS: Record<SmsConfirmationStyle, string> = {
  business: "Poslovni",
  casual: "Opušteni",
  playful: "Šaljivi",
};

export const SMS_HUMOR_CATEGORY_LABELS: Record<SmsTemplateSet, string> = {
  universal: "Univerzalno",
  haircut: "Šišanje",
  coloring: "Farbanje",
  massage: "Masaža",
};

export function isSmsConfirmationStyle(value: unknown): value is SmsConfirmationStyle {
  return typeof value === "string" && (SMS_CONFIRMATION_STYLES as readonly string[]).includes(value);
}

export function isSmsHumorCategory(value: unknown): value is SmsHumorCategory {
  return typeof value === "string" && (SMS_HUMOR_CATEGORIES as readonly string[]).includes(value);
}

// The message every salon received before styles existed; still the one sent while a salon has not chosen a style.
export const STANDARD_CONFIRMATION_TEMPLATE = "Termin u salonu {salon} je potvrdjen za {datum} u {vreme}. Pregled i otkazivanje: {link}";

export const BUSINESS_TEMPLATES = [
  STANDARD_CONFIRMATION_TEMPLATE,
  "Potvrdjen termin: {salon}, {datum} u {vreme}. Pregled i otkazivanje: {link}",
  "{salon}: termin za {datum} u {vreme} je potvrdjen. Otkazivanje: {link}",
] as const;

export const CASUAL_TEMPLATES = [
  "Vidimo se u salonu {salon}, {datum} u {vreme}! Ako se plan promeni: {link}",
  "Zakazano je! {salon}, {datum} u {vreme}. Ako nesto iskrsne: {link}",
  "Sve je spremno za {datum} u {vreme} u salonu {salon}. Ako se plan promeni: {link}",
] as const;

// Playful, by the category of the booked service. Universal lines must make sense for any business.
export const PLAYFUL_TEMPLATES: Record<SmsTemplateSet, readonly string[]> = {
  universal: [
    "Legendo, termin je tvoj! Cekamo te: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Kalendar kaze: {salon}, {datum} u {vreme}. Mi kazemo: vidimo se! Otkazivanje: {link}",
    "Zvanicno je! {salon} te ceka {datum} u {vreme}. Otkazivanje: {link}",
    "Upisano velikim slovima: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Podsetnik za buduceg sebe: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Mesto je tvoje! {salon}, {datum} u {vreme}. Ne kasni, ne zuri. Otkazivanje: {link}",
    "Dogovoreno i zapecaceno: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Termin cuvamo bolje od lozinke: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Dobra odluka! {salon}, {datum} u {vreme}. Vidimo se! Otkazivanje: {link}",
    "Stigla je potvrda, stize i tvoj red: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
  ],
  haircut: [
    "Makaze su naostrene! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Kosa, spremi se! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Nova frizura na vidiku: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Makaze vec broje dane: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Frizura ce ti zahvaliti: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Cesalj i makaze su u pripravnosti: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Krajevi kose ce biti srecni: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Ogledalo vec ceka novu frizuru: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Sisanje bez stresa, termin bez cekanja: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Kosa je u dobrim rukama: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
  ],
  coloring: [
    "Boja je izabrana, termin takodje! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Nijanse se vec raduju: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Vreme je za malo boje: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Paleta je spremna! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Termin u boji je potvrdjen: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Mi spremamo boje, ti spremi osmeh: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Crno na belo, a uskoro i u boji: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Boja dana: tvoja! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Sjaj je zakazan: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Mesamo nijanse, ne termine: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
  ],
  massage: [
    "Ramena, opustite se! {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Stres je dobio otkaz: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Napetost odlazi, ti dolazis: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Ledja ti vec zahvaljuju: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Opustanje je zakazano: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Cvorovi u ledjima imaju rok: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Duboko udahni, termin je tvoj: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Telefon na tiho, ramena na odmor: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Vreme za predah je zakazano: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
    "Ruke su zagrejane, termin potvrdjen: {salon}, {datum} u {vreme}. Otkazivanje: {link}",
  ],
};

// One category for the whole booking: all booked services share it, otherwise (mixed, missing, unknown) universal.
export function resolveSmsTemplateSet(categories: readonly (string | null | undefined)[]): SmsTemplateSet {
  const [first] = categories;
  if (!isSmsHumorCategory(first)) return "universal";
  return categories.every((category) => category === first) ? first : "universal";
}

export function getConfirmationTemplates(style: SmsConfirmationStyle | null, templateSet: SmsTemplateSet = "universal"): readonly string[] {
  if (style === "business") return BUSINESS_TEMPLATES;
  if (style === "casual") return CASUAL_TEMPLATES;
  if (style === "playful") return PLAYFUL_TEMPLATES[templateSet];
  return [STANDARD_CONFIRMATION_TEMPLATE];
}

// Stable index from the appointment id (FNV-1a), so processing the same booking again picks the same line.
export function pickTemplateIndex(appointmentId: string, count: number) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < appointmentId.length; index += 1) {
    hash ^= appointmentId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return count > 0 ? hash % count : 0;
}

export function selectConfirmationTemplate(input: { appointmentId: string; style: SmsConfirmationStyle | null; templateSet?: SmsTemplateSet }) {
  const templates = getConfirmationTemplates(input.style, input.style === "playful" ? input.templateSet : "universal");
  return templates[pickTemplateIndex(input.appointmentId, templates.length)];
}

const PLACEHOLDER = /\{(salon|datum|vreme|link)\}/g;

// Single pass: values are never scanned for placeholders again (a salon named "{link}" stays literal).
export function renderConfirmationTemplate(template: string, values: { salon: string; datum: string; vreme: string; link: string }) {
  return template.replace(PLACEHOLDER, (_, key: keyof typeof values) => values[key]);
}

export function templateFixedLength(template: string) {
  return template.replace(PLACEHOLDER, "").length;
}
