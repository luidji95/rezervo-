import assert from "node:assert/strict";
import { test } from "node:test";
import { randomBytes, randomUUID } from "node:crypto";
import { buildBookingConfirmationSms, toSmsAscii } from "./bookingConfirmationSmsTemplate.ts";
import { sanitizeSmsSalonName } from "../../reminders/services/appointmentReminderTemplate.ts";
import {
  BUSINESS_TEMPLATES,
  CASUAL_TEMPLATES,
  getConfirmationTemplates,
  pickTemplateIndex,
  PLAYFUL_TEMPLATES,
  renderConfirmationTemplate,
  resolveSmsTemplateSet,
  selectConfirmationTemplate,
  STANDARD_CONFIRMATION_TEMPLATE,
  templateFixedLength,
  type SmsConfirmationStyle,
  type SmsTemplateSet,
} from "./bookingConfirmationSmsStyles.ts";

const SETS: SmsTemplateSet[] = ["universal", "haircut", "coloring", "massage"];
const ALL = [...BUSINESS_TEMPLATES, ...CASUAL_TEMPLATES, ...SETS.flatMap((set) => PLAYFUL_TEMPLATES[set])];
// GSM 03.38 basic set (1 septet each). Extension characters such as {}[]~^|\€ count twice and are kept out of templates.
const GSM7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€\f";

function smsParts(text: string) {
  const chars = [...text];
  if (chars.every((char) => GSM7_BASIC.includes(char) || GSM7_EXTENSION.includes(char))) {
    const septets = chars.reduce((sum, char) => sum + (GSM7_EXTENSION.includes(char) ? 2 : 1), 0);
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  return text.length <= 70 ? 1 : Math.ceil(text.length / 67);
}

// Real link: production origin, /manage-booking# and a 43-character token.
const REAL_LINK = `https://rezervo.studio/manage-booking#${randomBytes(32).toString("base64url")}`;

test("counts: business 3 (the first is the standard message), casual 3, playful 10 per category", () => {
  assert.equal(BUSINESS_TEMPLATES.length, 3);
  assert.equal(BUSINESS_TEMPLATES[0], STANDARD_CONFIRMATION_TEMPLATE);
  assert.equal(STANDARD_CONFIRMATION_TEMPLATE, "Termin u salonu {salon} je potvrdjen za {datum} u {vreme}. Pregled i otkazivanje: {link}");
  assert.equal(CASUAL_TEMPLATES.length, 3);
  for (const set of SETS) assert.equal(PLAYFUL_TEMPLATES[set].length, 10, set);
  assert.equal(new Set(ALL).size, ALL.length, "no duplicates");
});

test("every template: salon, date, time and link exactly once, link last; GSM-7 basic only; never longer than the standard text", () => {
  const standardFixed = templateFixedLength(STANDARD_CONFIRMATION_TEMPLATE);
  for (const template of ALL) {
    for (const placeholder of ["{salon}", "{datum}", "{vreme}", "{link}"]) {
      assert.equal(template.split(placeholder).length - 1, 1, `${placeholder} in ${template}`);
    }
    assert.ok(template.endsWith(" {link}"), template);
    const fixed = template.replace(/\{(salon|datum|vreme|link)\}/g, "");
    assert.ok([...fixed].every((char) => GSM7_BASIC.includes(char)), `GSM-7: ${template}`);
    assert.ok(!/[čćšžđČĆŠŽĐ]/.test(fixed) && !/\p{Extended_Pictographic}/u.test(fixed), template);
    assert.ok(templateFixedLength(template) <= standardFixed, `${templateFixedLength(template)} > ${standardFixed}: ${template}`);
  }
});

test("no extra SMS part: real link length, salon names from 1 to 80 characters, every day of the year", () => {
  const names = ["A", "Iva", "Studio M", "Salon lepote Šarm Đurđa", "Beauty & Spa Centar Novi Beograd", "Frizerski salon Kod Marije i Jovane Petrović", "X".repeat(80), "Ž".repeat(90)];
  let checked = 0;
  for (const name of names) {
    for (let day = 0; day < 366; day += 1) {
      const start = new Date(Date.UTC(2028, 0, 1, 7, 30) + day * 86_400_000).toISOString();
      const base = { salonName: name, appointmentStart: start, salonTimezone: "Europe/Belgrade", manageLink: REAL_LINK };
      const standard = buildBookingConfirmationSms(base);
      for (const style of ["business", "casual", "playful"] as SmsConfirmationStyle[]) {
        for (const set of SETS) {
          for (const template of getConfirmationTemplates(style, set)) {
            const text = renderConfirmationTemplate(template, {
              salon: toSmsAscii(sanitizeSmsSalonName(name)),
              datum: standard.match(/za (\d+\. [a-z]+) u/)![1],
              vreme: standard.match(/ u (\d\d:\d\d)\./)![1],
              link: REAL_LINK,
            });
            assert.ok(text.length <= standard.length, text);
            assert.ok(smsParts(text) <= smsParts(standard), `${smsParts(text)} > ${smsParts(standard)}: ${text}`);
            assert.ok(text.endsWith(REAL_LINK));
            checked += 1;
          }
        }
      }
    }
  }
  assert.ok(checked > 100_000);
});

test("no style keeps the exact standard message; the date and time are in the salon time zone", () => {
  const input = { salonName: "Studio Šarm", appointmentStart: "2026-11-09T15:30:00.000Z", manageLink: REAL_LINK, appointmentId: randomUUID() };
  const expected = `Termin u salonu Studio Sarm je potvrdjen za 9. novembra u 16:30. Pregled i otkazivanje: ${REAL_LINK}`;
  assert.equal(buildBookingConfirmationSms({ ...input, salonTimezone: "Europe/Belgrade" }), expected);
  assert.equal(buildBookingConfirmationSms({ ...input, salonTimezone: "Europe/Belgrade", style: null }), expected);
  // 15:30 UTC is already 10 November 00:30 in Tokyo.
  assert.ok(buildBookingConfirmationSms({ ...input, salonTimezone: "Asia/Tokyo", style: "casual" }).includes("10. novembra u 00:30"));
});

test("variation by appointment id: the same booking always gets the same text; ids spread over every variation", () => {
  const id = randomUUID();
  const first = selectConfirmationTemplate({ appointmentId: id, style: "playful", templateSet: "massage" });
  for (let attempt = 0; attempt < 5; attempt += 1) assert.equal(selectConfirmationTemplate({ appointmentId: id, style: "playful", templateSet: "massage" }), first);
  assert.ok(PLAYFUL_TEMPLATES.massage.includes(first));
  for (const count of [3, 10]) {
    const seen = new Set(Array.from({ length: 400 }, () => pickTemplateIndex(randomUUID(), count)));
    assert.equal(seen.size, count);
  }
  // Business and casual ignore the category.
  assert.ok(BUSINESS_TEMPLATES.includes(selectConfirmationTemplate({ appointmentId: id, style: "business", templateSet: "haircut" }) as never));
  assert.ok(CASUAL_TEMPLATES.includes(selectConfirmationTemplate({ appointmentId: id, style: "casual", templateSet: "coloring" }) as never));
});

test("template set: one shared category, otherwise universal (mixed, missing, unknown, none)", () => {
  assert.equal(resolveSmsTemplateSet(["haircut"]), "haircut");
  assert.equal(resolveSmsTemplateSet(["coloring", "coloring"]), "coloring");
  assert.equal(resolveSmsTemplateSet(["massage"]), "massage");
  assert.equal(resolveSmsTemplateSet(["haircut", "coloring"]), "universal");
  assert.equal(resolveSmsTemplateSet(["haircut", null]), "universal");
  assert.equal(resolveSmsTemplateSet([null, "haircut"]), "universal");
  assert.equal(resolveSmsTemplateSet([null]), "universal");
  assert.equal(resolveSmsTemplateSet([]), "universal");
  assert.equal(resolveSmsTemplateSet(["nails"]), "universal");
  assert.equal(resolveSmsTemplateSet(["universal"]), "universal");
});

test("scissors and hair jokes only for haircut; universal lines name no trade", () => {
  for (const set of ["universal", "coloring", "massage"] as const) {
    for (const template of PLAYFUL_TEMPLATES[set]) assert.ok(!/makaz|cesalj|sisanj|frizur/i.test(template), template);
  }
  for (const template of PLAYFUL_TEMPLATES.universal) assert.ok(!/kos[aei]|boj[aeiu]|nijans|masaz|ledj|ramen|nokt/i.test(template), template);
});

test("values are inserted once: a salon named like a placeholder stays literal", () => {
  const text = renderConfirmationTemplate(STANDARD_CONFIRMATION_TEMPLATE, { salon: "{link}", datum: "1. maja", vreme: "09:00", link: REAL_LINK });
  assert.equal(text, `Termin u salonu {link} je potvrdjen za 1. maja u 09:00. Pregled i otkazivanje: ${REAL_LINK}`);
});
