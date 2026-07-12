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
import { getSalonEmployees } from "@/services/employeeService";
import {
  completeOnboardingSetup,
  getCurrentSalon,
  saveOnboardingSalon,
} from "@/services/salonService";
import { getSalonServices } from "@/services/serviceService";
import { getSalonWorkingHours } from "@/services/workingService";

import { ONBOARDING_STEPS } from "../constants/onboardingSteps";
import type { OnboardingDestination } from "../types/onboarding";
import {
  buildEmployeeItems,
  buildServiceItems,
  buildWorkingHourDays,
  getInitialTeamMode,
} from "../utils/onboardingMappers";
import { normalizeStep } from "../utils/onboardingValidators";
import { useServicesStep } from "./useServicesStep";
import { useTeamStep } from "./useTeamStep";
import { useWorkingHoursStep } from "./useWorkingHoursStep";

export function useOnboarding() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingSalon, setCheckingSalon] = useState(true);
  const [existingSalonId, setExistingSalonId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [salonName, setSalonName] = useState("");
  const [salonSlug, setSalonSlug] = useState<string | null>(null);
  const [salonBusinessType, setSalonBusinessType] = useState("barbershop");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSkippingSetup, setIsSkippingSetup] = useState(false);

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

  const workingHoursStep = useWorkingHoursStep({
    existingSalonId,
    setCurrentStep,
    setSubmitError,
  });

  const servicesStep = useServicesStep({
    existingSalonId,
    salonBusinessType,
    setCurrentStep,
    setSubmitError,
  });

  const teamStep = useTeamStep({
    existingSalonId,
    salonName,
    setCurrentStep,
    setSubmitError,
  });

  const { reset } = form;
  const { setHasWorkingHours, setWorkingHourDays } = workingHoursStep;
  const { setServiceItems, setServicesCount } = servicesStep;
  const { setEmployeeItems, setEmployeesCount, setTeamMode } = teamStep;

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
          setExistingSalonId(salon.id);
          setCurrentStep(normalizeStep(salon.onboarding_step));
          const businessType =
            SALON_BUSINESS_TYPE_VALUES.find(
              (value) => value === salon.business_type
            ) ?? "barbershop";
          const workingHours = await getSalonWorkingHours(salon.id);
          const services = await getSalonServices(salon.id);
          const employees = await getSalonEmployees(salon.id);

          setSalonName(salon.name ?? "");
          setSalonSlug(salon.slug ?? null);
          setSalonBusinessType(businessType);
          setHasWorkingHours(workingHours.length > 0);
          setServicesCount(
            services.filter((service) => service.is_active && service.is_public)
              .length
          );
          setEmployeesCount(employees.length);
          setWorkingHourDays(buildWorkingHourDays(workingHours));
          setServiceItems(buildServiceItems(services, businessType));
          setTeamMode(getInitialTeamMode(employees));
          setEmployeeItems(buildEmployeeItems(employees));
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
        } else {
          setCurrentStep(1);
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
    router,
    reset,
    setEmployeeItems,
    setEmployeesCount,
    setHasWorkingHours,
    setServiceItems,
    setServicesCount,
    setTeamMode,
    setWorkingHourDays,
    user,
  ]);

  const onSubmitBasicInfo = async (data: OnboardingFormData) => {
    if (!user) return;

    setSubmitError(null);

    try {
      const salon = await saveOnboardingSalon({
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

      setExistingSalonId(salon.id);
      setSalonName(data.name);
      setSalonSlug(salon.slug ?? null);
      setSalonBusinessType(data.businessType);
      servicesStep.setServiceItems((items) =>
        items.some((item) => item.id)
          ? items
          : buildServiceItems([], data.businessType)
      );
      setCurrentStep(2);
    } catch (error) {
      console.error("Failed to save salon:", error);

      setSubmitError("Something went wrong while saving your salon.");
    }
  };

  async function skipSetupAndGoToDashboard() {
    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    setSubmitError(null);
    setIsSkippingSetup(true);

    try {
      await completeOnboardingSetup(existingSalonId);
      router.replace("/dashboard");
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      setSubmitError("Something went wrong while completing onboarding.");
    } finally {
      setIsSkippingSetup(false);
    }
  }

  async function finishOnboardingAndNavigate(path: OnboardingDestination) {
    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    setSubmitError(null);
    setIsSkippingSetup(true);

    try {
      await completeOnboardingSetup(existingSalonId);
      router.replace(path);
    } catch (error) {
      console.error("Failed to complete onboarding:", error);
      setSubmitError("Something went wrong while completing onboarding.");
    } finally {
      setIsSkippingSetup(false);
    }
  }

  function goBack() {
    setCurrentStep((step) => Math.max(step - 1, 1));
  }

  const progress = Math.round((currentStep / ONBOARDING_STEPS.length) * 100);

  return {
    checkingSalon,
    currentStep,
    finishOnboardingAndNavigate,
    form,
    goBack,
    isSkippingSetup,
    loading,
    onSubmitBasicInfo,
    progress,
    salonName,
    salonSlug,
    servicesStep,
    skipSetupAndGoToDashboard,
    submitError,
    teamStep,
    user,
    workingHoursStep,
  };
}
