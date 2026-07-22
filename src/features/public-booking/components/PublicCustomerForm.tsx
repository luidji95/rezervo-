"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { optionalEmailSchema, optionalPhoneSchema, requiredStringSchema } from "@/lib/validation/commonSchemas";

import type {
  PublicAvailabilitySlot,
  PublicCustomerData,
  PublicEmployee,
  PublicService,
} from "../types";
import { PublicBookingSummary } from "./PublicBookingSummary";

const publicCustomerSchema = z
  .object({
    fullName: requiredStringSchema("Ime i prezime", 2, 120),
    phone: optionalPhoneSchema,
    email: optionalEmailSchema,
  })
  .superRefine((customer, context) => {
    if (!customer.phone && !customer.email) {
      context.addIssue({
        code: "custom",
        path: ["phone"],
        message: "Unesite telefon ili email.",
      });
    }
  });

type PublicCustomerFormProps = {
  bookingError: string | null;
  date: string;
  defaultValues: PublicCustomerData;
  employee: PublicEmployee;
  isSubmitting: boolean;
  salonName: string;
  service: PublicService;
  slot: PublicAvailabilitySlot;
  onSubmit: (customer: PublicCustomerData) => Promise<void>;
};

export function PublicCustomerForm({
  bookingError,
  date,
  defaultValues,
  employee,
  isSubmitting,
  salonName,
  service,
  slot,
  onSubmit,
}: PublicCustomerFormProps) {
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<PublicCustomerData>({
    resolver: zodResolver(publicCustomerSchema),
    defaultValues,
  });
  const customer = useWatch({ control });
  const summaryCustomer: PublicCustomerData = {
    fullName: customer.fullName ?? "",
    phone: customer.phone ?? "",
    email: customer.email ?? "",
  };

  return (
    <section className="public-customer-section">
      <div className="public-section-heading">
        <p className="public-booking-eyebrow">Kontakt</p>
        <h2>Vaši podaci</h2>
        <p>Unesite telefon ili email kako bi salon mogao da vas kontaktira.</p>
      </div>

      <form
        className="public-customer-form"
        onSubmit={handleSubmit(onSubmit)}
        noValidate
      >
        <label className="public-customer-field">
          <span>Ime i prezime</span>
          <input
            type="text"
            autoComplete="name"
            disabled={isSubmitting}
            {...register("fullName")}
          />
          {errors.fullName && <small>{errors.fullName.message}</small>}
        </label>

        <label className="public-customer-field">
          <span>Telefon</span>
          <input
            type="tel"
            autoComplete="tel"
            disabled={isSubmitting}
            {...register("phone")}
          />
          {errors.phone && <small>{errors.phone.message}</small>}
        </label>

        <label className="public-customer-field">
          <span>Email</span>
          <input
            type="email"
            autoComplete="email"
            disabled={isSubmitting}
            {...register("email")}
          />
          {errors.email && <small>{errors.email.message}</small>}
        </label>

        <PublicBookingSummary
          customer={summaryCustomer}
          date={date}
          employee={employee}
          salonName={salonName}
          service={service}
          slot={slot}
        />

        {bookingError && (
          <div className="public-inline-state public-inline-state-error" role="alert">
            {bookingError}
          </div>
        )}

        <button
          type="submit"
          className="public-booking-submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Zakazujem..." : "Potvrdi rezervaciju"}
        </button>
      </form>
    </section>
  );
}
