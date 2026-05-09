"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/context/AuthContext";
import {
  createSalonWithOwner,
  getMySalon,
} from "@/services/salonService";
import {
  onboardingSchema,
  type OnboardingFormData,
} from "./onboardingSchema";

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingSalon, setCheckingSalon] = useState(true);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
  });

  useEffect(() => {
    const checkAccess = async () => {
      if (loading) return;

      if (!user) {
        router.replace("/auth/login");
        return;
      }

      try {
        const salon = await getMySalon(user.id);

        if (salon) {
          router.replace("/dashboard");
          return;
        }

        setCheckingSalon(false);
      } catch (error) {
        console.error("Failed to check salon:", error);
        setSubmitError("Could not verify your salon setup.");
        setCheckingSalon(false);
      }
    };

    checkAccess();
  }, [user, loading, router]);

  const onSubmit = async (data: OnboardingFormData) => {
    if (!user) return;

    setSubmitError(null);

    try {
      await createSalonWithOwner({
        name: data.salonName,
        phone: data.phone,
        city: data.city,
        addressLine: data.address,
        ownerId: user.id,
      });

      router.replace("/dashboard");
    } catch (error) {
      console.error("Failed to create salon:", error);
      setSubmitError("Something went wrong while creating your salon.");
    }
  };

  if (loading || checkingSalon) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return null;
  }

  return (
    <main>
      <h1>Set up your salon</h1>
      <p>Welcome: {user.email}</p>

      <form onSubmit={handleSubmit(onSubmit)}>
        <div>
          <label htmlFor="salonName">Salon name</label>
          <input id="salonName" type="text" {...register("salonName")} />
          {errors.salonName && <p>{errors.salonName.message}</p>}
        </div>

        <div>
          <label htmlFor="phone">Phone</label>
          <input id="phone" type="text" {...register("phone")} />
          {errors.phone && <p>{errors.phone.message}</p>}
        </div>

        <div>
          <label htmlFor="city">City</label>
          <input id="city" type="text" {...register("city")} />
          {errors.city && <p>{errors.city.message}</p>}
        </div>

        <div>
          <label htmlFor="address">Address</label>
          <input id="address" type="text" {...register("address")} />
          {errors.address && <p>{errors.address.message}</p>}
        </div>

        {submitError && <p>{submitError}</p>}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Creating..." : "Create salon"}
        </button>
      </form>
    </main>
  );
}