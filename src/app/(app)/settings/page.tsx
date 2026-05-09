"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useSalon } from "@/context/SalonContext";
import { updateCurrentSalon } from "@/services/salonService";
import { settingsSchema, type SettingsFormData } from "./settingsSchema";

export default function SettingsPage() {
  const { currentSalon, salonLoading, refetchSalon } = useSalon();

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SettingsFormData>({
    resolver: zodResolver(settingsSchema),
    values: {
      name: currentSalon?.name ?? "",
      phone: currentSalon?.phone ?? "",
      email: currentSalon?.email ?? "",
      websiteUrl: currentSalon?.website_url ?? "",
      city: currentSalon?.city ?? "",
      addressLine: currentSalon?.address_line ?? "",
    },
  });

  const onSubmit = async (data: SettingsFormData) => {
    if (!currentSalon) return;

    setSubmitError(null);
    setSubmitSuccess(null);

    try {
      await updateCurrentSalon({
        salonId: currentSalon.id,
        name: data.name,
        phone: data.phone || null,
        email: data.email || null,
        websiteUrl: data.websiteUrl || null,
        city: data.city || null,
        addressLine: data.addressLine || null,
      });

      await refetchSalon();

      setSubmitSuccess("Salon settings updated successfully.");
    } catch (error) {
      console.error("Failed to update salon:", error);
      setSubmitError("Something went wrong while updating salon settings.");
    }
  };

  if (salonLoading) {
    return <p>Loading salon settings...</p>;
  }

  if (!currentSalon) {
    return <p>No salon found.</p>;
  }

  return (
    <main>
      <h1>Salon Settings</h1>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div>
          <label htmlFor="name">Salon name</label>
          <input id="name" type="text" {...register("name")} />
          {errors.name && <p>{errors.name.message}</p>}
        </div>

        <div>
          <label htmlFor="phone">Phone</label>
          <input id="phone" type="text" {...register("phone")} />
          {errors.phone && <p>{errors.phone.message}</p>}
        </div>

        <div>
          <label htmlFor="email">Email</label>
          <input id="email" type="email" {...register("email")} />
          {errors.email && <p>{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="websiteUrl">Website URL</label>
          <input id="websiteUrl" type="text" {...register("websiteUrl")} />
          {errors.websiteUrl && <p>{errors.websiteUrl.message}</p>}
        </div>

        <div>
          <label htmlFor="city">City</label>
          <input id="city" type="text" {...register("city")} />
          {errors.city && <p>{errors.city.message}</p>}
        </div>

        <div>
          <label htmlFor="addressLine">Address</label>
          <input id="addressLine" type="text" {...register("addressLine")} />
          {errors.addressLine && <p>{errors.addressLine.message}</p>}
        </div>

        {submitError && <p>{submitError}</p>}
        {submitSuccess && <p>{submitSuccess}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Saving..." : "Save changes"}
        </button>
      </form>
    </main>
  );
}