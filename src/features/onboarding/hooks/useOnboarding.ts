"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  onboardingSchema,
  SALON_BUSINESS_TYPE_VALUES,
  type OnboardingFormData,
} from "@/app/onboarding/onboardingSchema";
import { useAuth } from "@/context/AuthContext";
import {
  getCurrentSalon,
  saveOnboardingSalon,
} from "@/services/salonService";

export function useOnboarding() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingSalon, setCheckingSalon] = useState(true);
  const [existingSalonId, setExistingSalonId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const form = useForm<OnboardingFormData>({
    resolver: zodResolver(onboardingSchema),
    defaultValues: {
      name: "",
      businessType: "barbershop",
      phone: "",
      email: "",
      addressLine: "",
      websiteUrl: "",
      instagramUrl: "",
      description: "",
    },
  });

  const { reset } = form;

  useEffect(() => {
    const checkAccess = async () => {
      if (loading) return;

      if (!user) {
        router.replace("/auth/login");
        return;
      }

      try {
        const salon = await getCurrentSalon(user.id);

        if (salon?.onboarding_completed) {
          router.replace("/dashboard");
          return;
        }

        if (salon) {
          const businessType =
            SALON_BUSINESS_TYPE_VALUES.find(
              (value) => value === salon.business_type
            ) ?? "barbershop";

          setExistingSalonId(salon.id);
          reset({
            name: salon.name ?? "",
            businessType,
            phone: salon.phone ?? "",
            email: salon.email ?? "",
            addressLine: salon.address_line ?? "",
            websiteUrl: salon.website_url ?? "",
            instagramUrl: salon.instagram_url ?? "",
            description: salon.description ?? "",
          });
        }

        setCheckingSalon(false);
      } catch (error) {
        console.error("Failed to check salon:", error);

        setSubmitError("Could not verify your salon setup.");
        setCheckingSalon(false);
      }
    };

    checkAccess();
  }, [
    loading,
    reset,
    router,
    user,
  ]);

  const onSubmitBasicInfo = async (data: OnboardingFormData) => {
    if (!user) return;

    setSubmitError(null);

    try {
      await saveOnboardingSalon({
        salonId: existingSalonId ?? undefined,
        ownerId: user.id,
        name: data.name,
        businessType: data.businessType,
        phone: data.phone,
        email: data.email,
        addressLine: data.addressLine,
        websiteUrl: data.websiteUrl,
        instagramUrl: data.instagramUrl,
        description: data.description,
      });
      router.replace("/dashboard");
    } catch (error) {
      console.error("Failed to save salon:", error);

      setSubmitError("Something went wrong while saving your salon.");
    }
  };

  return {
    checkingSalon,
    form,
    loading,
    onSubmitBasicInfo,
    submitError,
    user,
  };
}
