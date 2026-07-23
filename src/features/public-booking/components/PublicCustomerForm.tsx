"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";
import type { PublicCustomerData } from "../types";

const publicCustomerSchema = z.object({
  fullName: requiredStringSchema("Ime i prezime", 2, 120),
  phone: optionalPhoneSchema,
  email: optionalEmailSchema,
  note: z.string().trim().max(1000, "Napomena može imati najviše 1000 karaktera."),
}).superRefine((customer, context) => {
  if (!customer.phone && !customer.email) {
    context.addIssue({ code: "custom", path: ["phone"], message: "Unesite telefon ili email." });
  }
});

type Props = {
  defaultValues: PublicCustomerData;
  disabled: boolean;
  onContinue: (customer: PublicCustomerData) => void;
};

export function PublicCustomerForm({ defaultValues, disabled, onContinue }: Props) {
  const { register, handleSubmit, formState: { errors } } = useForm<PublicCustomerData>({
    resolver: zodResolver(publicCustomerSchema),
    defaultValues,
  });

  return (
    <section className="public-customer-section">
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Vaši podaci</p>
        <h2>Kako salon može da vas kontaktira?</h2>
        <p>Unesite telefon ili email. Podaci se koriste samo za ovu rezervaciju.</p>
      </div>
      <form className="public-customer-form" onSubmit={handleSubmit(onContinue)} noValidate>
        <label className="public-customer-field public-field-wide">
          <span>Ime i prezime</span>
          <input type="text" autoComplete="name" disabled={disabled} {...register("fullName")} />
          {errors.fullName && <small>{errors.fullName.message}</small>}
        </label>
        <label className="public-customer-field">
          <span>Telefon</span>
          <input type="tel" inputMode="tel" autoComplete="tel" disabled={disabled} {...register("phone")} />
          {errors.phone && <small>{errors.phone.message}</small>}
        </label>
        <label className="public-customer-field">
          <span>Email <em>(opciono)</em></span>
          <input type="email" inputMode="email" autoComplete="email" disabled={disabled} {...register("email")} />
          {errors.email && <small>{errors.email.message}</small>}
        </label>
        <label className="public-customer-field public-field-wide">
          <span>Napomena <em>(opciono)</em></span>
          <textarea rows={4} disabled={disabled} placeholder="Dodajte napomenu za salon…" {...register("note")} />
          {errors.note && <small>{errors.note.message}</small>}
        </label>
        <button type="submit" className="public-booking-submit" disabled={disabled}>Pregled rezervacije</button>
      </form>
    </section>
  );
}
