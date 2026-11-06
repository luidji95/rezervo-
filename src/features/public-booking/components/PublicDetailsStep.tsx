"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Pencil } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { getPhoneValidationMessage, PHONE_EXAMPLE } from "@/lib/phone/phoneNumber";
import { optionalEmailSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";
import { formatDateShort, formatPrice, formatTimeRange, getDayParts } from "../publicBookingFormat";
import type { PublicAvailabilitySlot, PublicCustomerData, PublicEmployee, PublicService } from "../types";

export const PUBLIC_DETAILS_FORM_ID = "pb-details-form";

// Same rule as the API: name and phone are required (the phone is normalized to E.164 by the same function on the
// server); email and note are optional.
const publicCustomerSchema = z.object({
  fullName: requiredStringSchema("Ime i prezime", 2, 120),
  phone: z.string().superRefine((phone, context) => {
    const message = getPhoneValidationMessage(phone);
    if (message) context.addIssue({ code: "custom", message });
  }),
  email: optionalEmailSchema,
  note: z.string().trim().max(1000, "Napomena može imati najviše 1000 karaktera."),
});

type Props = {
  service: PublicService;
  employee: PublicEmployee;
  date: string;
  slot: PublicAvailabilitySlot;
  timeZone: string;
  defaultValues: PublicCustomerData;
  disabled: boolean;
  onDraftChange: (customer: PublicCustomerData) => void;
  onEditTime: () => void;
  onSubmit: (customer: PublicCustomerData) => void;
};

export function PublicDetailsStep({ service, employee, date, slot, timeZone, defaultValues, disabled, onDraftChange, onEditTime, onSubmit }: Props) {
  const { register, handleSubmit, getValues, formState: { errors } } = useForm<PublicCustomerData>({
    resolver: zodResolver(publicCustomerSchema),
    defaultValues,
  });
  const day = getDayParts(date);

  return (
    <section className="pb-step" aria-labelledby="pb-details-title">
      <h1 className="pb-title" id="pb-details-title">Vaši podaci</h1>
      <p className="pb-lead">Potrebni su nam samo da bismo zakazali termin.</p>

      <div className="pb-review">
        <div className="pb-date-tile" aria-hidden="true"><span>{day.month}</span><strong>{day.day}</strong></div>
        <dl className="pb-review-text">
          <dt className="pb-sr-only">Usluga</dt><dd className="pb-review-title">{service.name}</dd>
          <dt className="pb-sr-only">Datum i vreme</dt><dd>{formatDateShort(date)} · {formatTimeRange(slot, timeZone)}</dd>
          <dt className="pb-sr-only">Zaposleni i cena</dt><dd>{employee.name} · {formatPrice(service.price, service.currency)}</dd>
        </dl>
        <button type="button" className="pb-icon-button pb-edit" onClick={onEditTime} disabled={disabled} aria-label="Izmeni uslugu, zaposlenog, datum ili vreme">
          <Pencil size={18} aria-hidden="true" />
        </button>
      </div>

      <form id={PUBLIC_DETAILS_FORM_ID} className="pb-form" onSubmit={handleSubmit(onSubmit)} onChange={() => onDraftChange(getValues())} noValidate>
        <label className="pb-field">
          <span className="pb-label">Ime i prezime <span className="pb-required" aria-hidden="true">*</span></span>
          <input type="text" autoComplete="name" placeholder="npr. Ana Jovanović" disabled={disabled} aria-invalid={Boolean(errors.fullName)} {...register("fullName")} />
          {errors.fullName && <small className="pb-error" role="alert">{errors.fullName.message}</small>}
        </label>
        <label className="pb-field pb-field-primary">
          <span className="pb-label">Broj telefona <span className="pb-required" aria-hidden="true">*</span></span>
          <input type="tel" inputMode="tel" autoComplete="tel" placeholder="npr. 064 123 4567" required disabled={disabled} aria-invalid={Boolean(errors.phone)} aria-describedby="pb-phone-help" {...register("phone")} />
          {errors.phone ? <small className="pb-error" role="alert" id="pb-phone-help">{errors.phone.message}</small> : <small className="pb-help" id="pb-phone-help">Salon vas kontaktira na ovaj broj. Primer: {PHONE_EXAMPLE}.</small>}
        </label>
        <label className="pb-field">
          <span className="pb-label">Email <span className="pb-tag">opciono</span></span>
          <input type="email" inputMode="email" autoComplete="email" placeholder="ana@primer.rs" disabled={disabled} aria-invalid={Boolean(errors.email)} {...register("email")} />
          {errors.email && <small className="pb-error" role="alert">{errors.email.message}</small>}
        </label>
        <label className="pb-field">
          <span className="pb-label">Napomena <span className="pb-tag">opciono</span></span>
          <textarea rows={3} disabled={disabled} placeholder="Napomena za salon" aria-invalid={Boolean(errors.note)} {...register("note")} />
          {errors.note && <small className="pb-error" role="alert">{errors.note.message}</small>}
        </label>
      </form>
    </section>
  );
}
