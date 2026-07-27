"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  onboardingSchema,
  SALON_BUSINESS_TYPE_VALUES,
  type OnboardingFormData,
} from "@/app/onboarding/onboardingSchema";
import { useAuth } from "@/context/AuthContext";
import { useAuthorization } from "@/context/AuthorizationContext";
import { saveOnboardingSalon } from "@/services/salonService";
import { completeOnboardingAndNavigate } from "@/features/onboarding/services/onboardingCompletionCore";

export function useOnboarding() {
  const { user, loading } = useAuth();
  const { currentSalon, refetchAuthorization, resolution } = useAuthorization();
  const router = useRouter();
  const [checkingSalon, setCheckingSalon] = useState(true);
  const [existingSalonId, setExistingSalonId] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const redirectStartedRef = useRef(false);
  const submitStartedRef = useRef(false);

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
    if (loading || resolution === "loading") return;
    let ignore = false;
    const commit = (callback: () => void) => {
      queueMicrotask(() => {
        if (!ignore) callback();
      });
    };

    if (!user || resolution === "unauthenticated") {
      if (!redirectStartedRef.current) {
        redirectStartedRef.current = true;
        router.replace("/auth/login");
      }
      return () => { ignore = true; };
    }

    if (resolution === "error") {
      commit(() => {
        setSubmitError("Could not verify your salon setup.");
        setCheckingSalon(false);
      });
      return () => { ignore = true; };
    }

    if (resolution === "loaded_with_completed_onboarding") {
      if (!redirectStartedRef.current) {
        redirectStartedRef.current = true;
        router.replace("/dashboard");
      }
      return () => { ignore = true; };
    }

    if (currentSalon) {
      const businessType =
        SALON_BUSINESS_TYPE_VALUES.find(
          (value) => value === currentSalon.business_type,
        ) ?? "barbershop";
      commit(() => {
        setExistingSalonId(currentSalon.id);
        reset({
          name: currentSalon.name ?? "",
          businessType,
          phone: currentSalon.phone ?? "",
          email: currentSalon.email ?? "",
          addressLine: currentSalon.address_line ?? "",
          websiteUrl: currentSalon.website_url ?? "",
          instagramUrl: currentSalon.instagram_url ?? "",
          description: currentSalon.description ?? "",
        });
        setCheckingSalon(false);
      });
    } else {
      commit(() => setCheckingSalon(false));
    }
    return () => { ignore = true; };
  }, [currentSalon, loading, reset, resolution, router, user]);

  const onSubmitBasicInfo = async (data: OnboardingFormData) => {
    if (!user || submitStartedRef.current) return;
    submitStartedRef.current = true;
    setSubmitError(null);
    let salonSaved = false;

    try {
      await completeOnboardingAndNavigate({
        save: () => saveOnboardingSalon({
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
        }),
        onSaved: (salon) => {
          salonSaved = true;
          setExistingSalonId(salon.id);
        },
        refreshAuthorization: refetchAuthorization,
        navigate: () => {
          redirectStartedRef.current = true;
          router.replace("/dashboard");
        },
      });
    } catch (error) {
      console.error("Failed to finish onboarding:", {
        code: error instanceof Error ? error.name : "UNKNOWN_ERROR",
      });
      setSubmitError(
        salonSaved
          ? "Salon je sačuvan, ali stanje aplikacije nije osveženo. Pokušajte ponovo."
          : "Salon trenutno nije moguće sačuvati. Pokušajte ponovo.",
      );
      submitStartedRef.current = false;
    }
  };

  return { checkingSalon, form, loading, onSubmitBasicInfo, submitError, user };
}
