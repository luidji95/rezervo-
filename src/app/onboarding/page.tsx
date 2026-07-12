"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { useAuth } from "@/context/AuthContext";
import {
  completeOnboardingSetup,
  getCurrentSalon,
  saveOnboardingSalon,
  updateOnboardingProgress,
} from "@/services/salonService";
import {
  getSalonWorkingHours,
  upsertWorkingHour,
} from "@/services/workingService";
import {
  createService,
  getSalonServices,
  updateService,
} from "@/services/serviceService";
import {
  createEmployee,
  deleteEmployee,
  getSalonEmployees,
  updateEmployee,
} from "@/services/employeeService";
import type { WorkingHour } from "@/types/workingHour";
import type { Service } from "@/types/service";
import type { Employee } from "@/types/employee";

import {
  onboardingSchema,
  SALON_BUSINESS_TYPE_OPTIONS,
  SALON_BUSINESS_TYPE_VALUES,
  type OnboardingFormData,
} from "./onboardingSchema";

const ONBOARDING_STEPS = [
  "Osnovne informacije",
  "Radno vreme",
  "Usluge",
  "Tim",
  "Završetak",
] as const;

const DAY_OPTIONS = [
  { label: "Ponedeljak", value: 1, isWeekday: true },
  { label: "Utorak", value: 2, isWeekday: true },
  { label: "Sreda", value: 3, isWeekday: true },
  { label: "Četvrtak", value: 4, isWeekday: true },
  { label: "Petak", value: 5, isWeekday: true },
  { label: "Subota", value: 6, isWeekday: false },
  { label: "Nedelja", value: 0, isWeekday: false },
] as const;

type WorkingHourFormDay = {
  dayOfWeek: number;
  label: string;
  isWorkingDay: boolean;
  opensAt: string;
  closesAt: string;
  breakStartsAt: string;
  breakEndsAt: string;
};

type OnboardingServiceItem = {
  id?: string;
  rowKey: string;
  name: string;
  durationMinutes: number;
  priceAmount: number;
};

type TeamMode = "solo" | "team";

type OnboardingEmployeeItem = {
  id?: string;
  rowKey: string;
  fullName: string;
  position: string;
  phone: string;
  email: string;
};

const SERVICE_TEMPLATES: Record<string, Omit<OnboardingServiceItem, "rowKey">[]> =
  {
    barbershop: [
      { name: "Muško šišanje", durationMinutes: 30, priceAmount: 1200 },
      { name: "Brada", durationMinutes: 20, priceAmount: 700 },
      { name: "Šišanje + brada", durationMinutes: 45, priceAmount: 1700 },
    ],
    hair_salon: [
      { name: "Šišanje", durationMinutes: 45, priceAmount: 1500 },
      { name: "Feniranje", durationMinutes: 30, priceAmount: 1200 },
      { name: "Farbanje", durationMinutes: 90, priceAmount: 3500 },
    ],
    beauty_salon: [
      { name: "Tretman lica", durationMinutes: 60, priceAmount: 3000 },
      { name: "Depilacija", durationMinutes: 30, priceAmount: 1500 },
      { name: "Masaža", durationMinutes: 60, priceAmount: 3500 },
    ],
    spa: [
      { name: "Masaža", durationMinutes: 60, priceAmount: 4000 },
      { name: "Relax tretman", durationMinutes: 90, priceAmount: 6000 },
    ],
    other: [{ name: "Usluga", durationMinutes: 30, priceAmount: 1000 }],
  };

let serviceRowCounter = 0;
let employeeRowCounter = 0;

function createServiceRow(
  service: Omit<OnboardingServiceItem, "rowKey">
): OnboardingServiceItem {
  serviceRowCounter += 1;

  return {
    ...service,
    rowKey: `${service.id ?? "new"}-${serviceRowCounter}`,
  };
}

function createEmployeeRow(
  employee: Omit<OnboardingEmployeeItem, "rowKey">
): OnboardingEmployeeItem {
  employeeRowCounter += 1;

  return {
    ...employee,
    rowKey: `${employee.id ?? "new"}-${employeeRowCounter}`,
  };
}

function normalizeStep(step?: number | null) {
  if (!step || step < 1) return 1;
  if (step > ONBOARDING_STEPS.length) return ONBOARDING_STEPS.length;

  return step;
}

function buildWorkingHourDays(
  workingHours: WorkingHour[] = []
): WorkingHourFormDay[] {
  return DAY_OPTIONS.map((day) => {
    const existing = workingHours.find(
      (workingHour) => workingHour.day_of_week === day.value
    );

    return {
      dayOfWeek: day.value,
      label: day.label,
      isWorkingDay: existing?.is_working_day ?? day.isWeekday,
      opensAt: existing?.opens_at?.slice(0, 5) ?? "09:00",
      closesAt: existing?.closes_at?.slice(0, 5) ?? "17:00",
      breakStartsAt: existing?.break_starts_at?.slice(0, 5) ?? "",
      breakEndsAt: existing?.break_ends_at?.slice(0, 5) ?? "",
    };
  });
}

function buildServiceItems(
  services: Service[],
  businessType: string
): OnboardingServiceItem[] {
  const visibleServices = services.filter(
    (service) => service.is_active && service.is_public
  );

  if (visibleServices.length > 0) {
    return visibleServices.map((service) =>
      createServiceRow({
        id: service.id,
        name: service.name,
        durationMinutes: service.duration_minutes,
        priceAmount: service.price,
      })
    );
  }

  return (SERVICE_TEMPLATES[businessType] ?? SERVICE_TEMPLATES.other).map(
    createServiceRow
  );
}

function isOwnerEmployee(employee: Employee) {
  return employee.position?.toLowerCase() === "vlasnik";
}

function buildEmployeeItems(employees: Employee[]): OnboardingEmployeeItem[] {
  if (employees.length === 0) {
    return [
      createEmployeeRow({
        fullName: "",
        position: "",
        phone: "",
        email: "",
      }),
    ];
  }

  return employees.map((employee) =>
    createEmployeeRow({
      id: employee.id,
      fullName: employee.full_name,
      position: employee.position ?? "",
      phone: employee.phone ?? "",
      email: employee.email ?? "",
    })
  );
}

function getInitialTeamMode(employees: Employee[]): TeamMode {
  if (
    employees.length === 1 &&
    isOwnerEmployee(employees[0])
  ) {
    return "solo";
  }

  return employees.length > 0 ? "team" : "solo";
}

export default function OnboardingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  const [checkingSalon, setCheckingSalon] = useState(true);
  const [existingSalonId, setExistingSalonId] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(1);
  const [salonName, setSalonName] = useState("");
  const [salonSlug, setSalonSlug] = useState<string | null>(null);
  const [salonBusinessType, setSalonBusinessType] = useState("barbershop");
  const [hasWorkingHours, setHasWorkingHours] = useState(false);
  const [servicesCount, setServicesCount] = useState(0);
  const [employeesCount, setEmployeesCount] = useState(0);
  const [workingHourDays, setWorkingHourDays] = useState<WorkingHourFormDay[]>(
    () => buildWorkingHourDays()
  );
  const [serviceItems, setServiceItems] = useState<OnboardingServiceItem[]>(
    () => buildServiceItems([], "barbershop")
  );
  const [teamMode, setTeamMode] = useState<TeamMode>("solo");
  const [employeeItems, setEmployeeItems] = useState<OnboardingEmployeeItem[]>(
    () => buildEmployeeItems([])
  );
  const [serviceValidationError, setServiceValidationError] = useState<
    string | null
  >(null);
  const [teamValidationError, setTeamValidationError] = useState<string | null>(
    null
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSkippingSetup, setIsSkippingSetup] = useState(false);
  const [isSavingWorkingHours, setIsSavingWorkingHours] = useState(false);
  const [isSavingServices, setIsSavingServices] = useState(false);
  const [isSavingTeam, setIsSavingTeam] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<OnboardingFormData>({
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
  }, [user, loading, router, reset]);

  const onSubmit = async (data: OnboardingFormData) => {
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
      setServiceItems((items) =>
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

  async function finishOnboardingAndNavigate(path: "/dashboard" | "/calendar") {
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

  function updateWorkingHourDay(
    index: number,
    values: Partial<WorkingHourFormDay>
  ) {
    setWorkingHourDays((days) =>
      days.map((day, dayIndex) =>
        dayIndex === index ? { ...day, ...values } : day
      )
    );
  }

  function applyWorkingHoursTemplate(opensAt: string, closesAt: string) {
    setWorkingHourDays((days) =>
      days.map((day) => ({
        ...day,
        isWorkingDay: day.dayOfWeek >= 1 && day.dayOfWeek <= 5,
        opensAt,
        closesAt,
      }))
    );
  }

  async function saveWorkingHours(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    setSubmitError(null);
    setIsSavingWorkingHours(true);

    try {
      await Promise.all(
        workingHourDays.map((day) =>
          upsertWorkingHour({
            salon_id: existingSalonId,
            employee_id: null,
            day_of_week: day.dayOfWeek,
            opens_at: day.opensAt,
            closes_at: day.closesAt,
            break_starts_at: day.breakStartsAt || null,
            break_ends_at: day.breakEndsAt || null,
            is_working_day: day.isWorkingDay,
          })
        )
      );

      await updateOnboardingProgress(existingSalonId, 3);
      setHasWorkingHours(true);
      setCurrentStep(3);
    } catch (error) {
      console.error("Failed to save working hours:", error);
      setSubmitError("Something went wrong while saving working hours.");
    } finally {
      setIsSavingWorkingHours(false);
    }
  }

  function updateServiceItem(
    index: number,
    values: Partial<OnboardingServiceItem>
  ) {
    setServiceItems((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...values } : item
      )
    );
  }

  function addServiceItem() {
    setServiceItems((items) => [
      ...items,
      createServiceRow({
        name: "",
        durationMinutes: 30,
        priceAmount: 0,
      }),
    ]);
  }

  function removeServiceItem(index: number) {
    setServiceItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
  }

  function applyServiceTemplate() {
    const template = SERVICE_TEMPLATES[salonBusinessType] ?? SERVICE_TEMPLATES.other;

    setServiceItems(template.map(createServiceRow));
    setServiceValidationError(null);
  }

  function validateServices() {
    if (serviceItems.length === 0) {
      return "Dodajte bar jednu uslugu.";
    }

    for (const service of serviceItems) {
      if (!service.name.trim()) {
        return "Naziv usluge je obavezan.";
      }

      if (!Number.isFinite(service.durationMinutes) || service.durationMinutes < 5) {
        return "Trajanje mora biti broj i najmanje 5 minuta.";
      }

      if (!Number.isFinite(service.priceAmount) || service.priceAmount < 0) {
        return "Cena mora biti broj i ne može biti negativna.";
      }
    }

    return null;
  }

  async function saveServices(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    const validationError = validateServices();

    if (validationError) {
      setServiceValidationError(validationError);
      return;
    }

    setSubmitError(null);
    setServiceValidationError(null);
    setIsSavingServices(true);

    try {
      const existingServices = await getSalonServices(existingSalonId);
      const submittedIds = new Set(
        serviceItems
          .map((service) => service.id)
          .filter((serviceId): serviceId is string => Boolean(serviceId))
      );
      const servicesToDeactivate = existingServices.filter(
        (service) => !submittedIds.has(service.id)
      );
      const servicesToUpdate = serviceItems.filter((service) => service.id);
      const servicesToCreate = serviceItems.filter((service) => !service.id);

      for (const service of servicesToDeactivate) {
        await updateService({
          serviceId: service.id,
          name: service.name,
          description: service.description,
          categoryName: service.category_name,
          durationMinutes: service.duration_minutes,
          priceAmount: service.price,
          isActive: false,
          isPublic: false,
        });
      }

      for (const service of servicesToUpdate) {
        if (!service.id) continue;

        await updateService({
          serviceId: service.id,
          name: service.name.trim(),
          description: null,
          categoryName: null,
          durationMinutes: service.durationMinutes,
          priceAmount: service.priceAmount,
          isActive: true,
          isPublic: true,
        });
      }

      for (const service of servicesToCreate) {
        await createService({
          salonId: existingSalonId,
          name: service.name.trim(),
          description: null,
          categoryName: null,
          durationMinutes: service.durationMinutes,
          priceAmount: service.priceAmount,
          isActive: true,
          isPublic: true,
        });
      }

      const savedServices = await getSalonServices(existingSalonId);
      setServiceItems(buildServiceItems(savedServices, salonBusinessType));
      setServicesCount(
        savedServices.filter(
          (service) => service.is_active && service.is_public
        ).length
      );
      await updateOnboardingProgress(existingSalonId, 4);
      setCurrentStep(4);
    } catch (error) {
      console.error("Failed to save services:", error);
      setSubmitError("Something went wrong while saving services.");
    } finally {
      setIsSavingServices(false);
    }
  }

  function updateEmployeeItem(
    index: number,
    values: Partial<OnboardingEmployeeItem>
  ) {
    setEmployeeItems((employees) =>
      employees.map((employee, employeeIndex) =>
        employeeIndex === index ? { ...employee, ...values } : employee
      )
    );
  }

  function addEmployeeItem() {
    setEmployeeItems((employees) => [
      ...employees,
      createEmployeeRow({
        fullName: "",
        position: "",
        phone: "",
        email: "",
      }),
    ]);
  }

  function removeEmployeeItem(index: number) {
    setEmployeeItems((employees) =>
      employees.filter((_, employeeIndex) => employeeIndex !== index)
    );
  }

  function validateTeam() {
    if (teamMode === "solo") {
      return null;
    }

    if (employeeItems.length === 0) {
      return "Dodajte bar jednog zaposlenog.";
    }

    for (const employee of employeeItems) {
      if (!employee.fullName.trim()) {
        return "Ime zaposlenog je obavezno.";
      }
    }

    return null;
  }

  async function saveTeam(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!existingSalonId) {
      setSubmitError("Please save basic salon information first.");
      return;
    }

    const validationError = validateTeam();

    if (validationError) {
      setTeamValidationError(validationError);
      return;
    }

    setSubmitError(null);
    setTeamValidationError(null);
    setIsSavingTeam(true);

    try {
      const existingEmployees = await getSalonEmployees(existingSalonId);

      if (teamMode === "solo") {
        const ownerEmployee =
          existingEmployees.find(isOwnerEmployee) ?? existingEmployees[0];
        const ownerName = ownerEmployee?.full_name || salonName || "Vlasnik";

        if (ownerEmployee) {
          await updateEmployee({
            employeeId: ownerEmployee.id,
            fullName: ownerName,
            displayName: ownerEmployee.display_name,
            position: "Vlasnik",
            phone: ownerEmployee.phone,
            email: ownerEmployee.email,
            bio: ownerEmployee.bio,
          });
        } else {
          await createEmployee({
            salonId: existingSalonId,
            fullName: salonName || "Vlasnik",
            displayName: null,
            position: "Vlasnik",
            phone: null,
            email: null,
            bio: null,
          });
        }

        for (const employee of existingEmployees) {
          if (employee.id !== ownerEmployee?.id) {
            await deleteEmployee(employee.id);
          }
        }
      } else {
        const submittedIds = new Set(
          employeeItems
            .map((employee) => employee.id)
            .filter((employeeId): employeeId is string => Boolean(employeeId))
        );

        for (const employee of existingEmployees) {
          if (!submittedIds.has(employee.id)) {
            await deleteEmployee(employee.id);
          }
        }

        for (const employee of employeeItems) {
          const payload = {
            fullName: employee.fullName.trim(),
            displayName: null,
            position: employee.position.trim() || null,
            phone: employee.phone.trim() || null,
            email: employee.email.trim() || null,
            bio: null,
          };

          if (employee.id) {
            await updateEmployee({
              employeeId: employee.id,
              ...payload,
            });
          } else {
            await createEmployee({
              salonId: existingSalonId,
              ...payload,
            });
          }
        }
      }

      const savedEmployees = await getSalonEmployees(existingSalonId);
      setTeamMode(getInitialTeamMode(savedEmployees));
      setEmployeeItems(buildEmployeeItems(savedEmployees));
      setEmployeesCount(savedEmployees.length);
      await updateOnboardingProgress(existingSalonId, 5);
      setCurrentStep(5);
    } catch (error) {
      console.error("Failed to save team:", error);
      setSubmitError("Something went wrong while saving team.");
    } finally {
      setIsSavingTeam(false);
    }
  }

  function goBack() {
    setCurrentStep((step) => Math.max(step - 1, 1));
  }

  if (loading || checkingSalon) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return null;
  }

  const progress = Math.round((currentStep / ONBOARDING_STEPS.length) * 100);

  return (
    <main>
      <h1>Set up your salon</h1>

      <p>Welcome: {user.email}</p>

      <header>
        <p>
          Step {currentStep} of {ONBOARDING_STEPS.length}
        </p>

        <div
          aria-label="Onboarding progress"
          style={{
            background: "#e5e7eb",
            borderRadius: 999,
            height: 8,
            marginBottom: 16,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "#2563eb",
              height: "100%",
              width: `${progress}%`,
            }}
          />
        </div>

        <ol>
          {ONBOARDING_STEPS.map((step, index) => {
            const stepNumber = index + 1;

            return (
              <li key={step}>
                {stepNumber === currentStep ? "→ " : ""}
                {step}
              </li>
            );
          })}
        </ol>
      </header>

      {currentStep > 1 && (
        <button type="button" onClick={goBack}>
          Nazad
        </button>
      )}

      {submitError && <p>{submitError}</p>}

      {currentStep === 1 && (
        <form onSubmit={handleSubmit(onSubmit)} noValidate>
          <div>
            <label htmlFor="name">Salon name</label>

            <input id="name" type="text" {...register("name")} />

            {errors.name && <p>{errors.name.message}</p>}
          </div>

          <div>
            <label htmlFor="businessType">Business type</label>

            <select id="businessType" {...register("businessType")}>
              {SALON_BUSINESS_TYPE_OPTIONS.map((type) => (
                <option key={`${type.label}-${type.value}`} value={type.value}>
                  {type.label}
                </option>
              ))}
            </select>

            {errors.businessType && <p>{errors.businessType.message}</p>}
          </div>

          <div>
            <label htmlFor="phone">Phone</label>

            <input id="phone" type="text" {...register("phone")} />
          </div>

          <div>
            <label htmlFor="email">Email</label>

            <input id="email" type="email" {...register("email")} />

            {errors.email && <p>{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="addressLine">Address</label>

            <input id="addressLine" type="text" {...register("addressLine")} />
          </div>

          <div>
            <label htmlFor="websiteUrl">Website</label>

            <input id="websiteUrl" type="text" {...register("websiteUrl")} />

            {errors.websiteUrl && <p>{errors.websiteUrl.message}</p>}
          </div>

          <div>
            <label htmlFor="instagramUrl">Instagram</label>

            <input
              id="instagramUrl"
              type="text"
              placeholder="@instagram"
              {...register("instagramUrl")}
            />

            {errors.instagramUrl && <p>{errors.instagramUrl.message}</p>}
          </div>

          <div>
            <label htmlFor="description">Description</label>

            <textarea id="description" rows={4} {...register("description")} />
          </div>

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save and continue"}
          </button>
        </form>
      )}

      {currentStep === 2 && (
        <form onSubmit={saveWorkingHours}>
          <h2>Radno vreme</h2>

          <div>
            <button
              type="button"
              onClick={() => applyWorkingHoursTemplate("09:00", "17:00")}
            >
              09-17
            </button>
            <button
              type="button"
              onClick={() => applyWorkingHoursTemplate("10:00", "18:00")}
            >
              10-18
            </button>
            <button
              type="button"
              onClick={() => applyWorkingHoursTemplate("12:00", "20:00")}
            >
              12-20
            </button>
          </div>

          {workingHourDays.map((day, index) => (
            <fieldset key={day.dayOfWeek}>
              <legend>{day.label}</legend>

              <label>
                <input
                  checked={day.isWorkingDay}
                  type="checkbox"
                  onChange={(event) =>
                    updateWorkingHourDay(index, {
                      isWorkingDay: event.target.checked,
                    })
                  }
                />
                Radi
              </label>

              <div>
                <label htmlFor={`opensAt-${day.dayOfWeek}`}>Početak</label>
                <input
                  id={`opensAt-${day.dayOfWeek}`}
                  disabled={!day.isWorkingDay}
                  type="time"
                  value={day.opensAt}
                  onChange={(event) =>
                    updateWorkingHourDay(index, {
                      opensAt: event.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label htmlFor={`closesAt-${day.dayOfWeek}`}>Kraj</label>
                <input
                  id={`closesAt-${day.dayOfWeek}`}
                  disabled={!day.isWorkingDay}
                  type="time"
                  value={day.closesAt}
                  onChange={(event) =>
                    updateWorkingHourDay(index, {
                      closesAt: event.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label htmlFor={`breakStartsAt-${day.dayOfWeek}`}>
                  Pauza od
                </label>
                <input
                  id={`breakStartsAt-${day.dayOfWeek}`}
                  disabled={!day.isWorkingDay}
                  type="time"
                  value={day.breakStartsAt}
                  onChange={(event) =>
                    updateWorkingHourDay(index, {
                      breakStartsAt: event.target.value,
                    })
                  }
                />
              </div>

              <div>
                <label htmlFor={`breakEndsAt-${day.dayOfWeek}`}>Pauza do</label>
                <input
                  id={`breakEndsAt-${day.dayOfWeek}`}
                  disabled={!day.isWorkingDay}
                  type="time"
                  value={day.breakEndsAt}
                  onChange={(event) =>
                    updateWorkingHourDay(index, {
                      breakEndsAt: event.target.value,
                    })
                  }
                />
              </div>
            </fieldset>
          ))}

          <button type="submit" disabled={isSavingWorkingHours}>
            {isSavingWorkingHours ? "Čuvam..." : "Sačuvaj i nastavi"}
          </button>

          <button
            type="button"
            onClick={skipSetupAndGoToDashboard}
            disabled={isSkippingSetup}
          >
            {isSkippingSetup
              ? "Preusmeravam..."
              : "Preskoči setup i idi na dashboard"}
          </button>
        </form>
      )}

      {currentStep === 3 && (
        <form onSubmit={saveServices}>
          <h2>Usluge</h2>

          <div>
            <button type="button" onClick={applyServiceTemplate}>
              Koristi template
            </button>
            <button type="button" onClick={addServiceItem}>
              + Dodaj uslugu
            </button>
          </div>

          {serviceValidationError && <p>{serviceValidationError}</p>}

          {serviceItems.map((service, index) => (
            <fieldset key={service.rowKey}>
              <legend>Usluga {index + 1}</legend>

              <div>
                <label htmlFor={`serviceName-${service.rowKey}`}>
                  Naziv usluge
                </label>
                <input
                  id={`serviceName-${service.rowKey}`}
                  type="text"
                  value={service.name}
                  onChange={(event) =>
                    updateServiceItem(index, { name: event.target.value })
                  }
                />
              </div>

              <div>
                <label htmlFor={`serviceDuration-${service.rowKey}`}>
                  Trajanje u minutima
                </label>
                <input
                  id={`serviceDuration-${service.rowKey}`}
                  min={5}
                  step={5}
                  type="number"
                  value={service.durationMinutes}
                  onChange={(event) =>
                    updateServiceItem(index, {
                      durationMinutes: event.target.valueAsNumber,
                    })
                  }
                />
              </div>

              <div>
                <label htmlFor={`servicePrice-${service.rowKey}`}>Cena</label>
                <input
                  id={`servicePrice-${service.rowKey}`}
                  min={0}
                  step={100}
                  type="number"
                  value={service.priceAmount}
                  onChange={(event) =>
                    updateServiceItem(index, {
                      priceAmount: event.target.valueAsNumber,
                    })
                  }
                />
              </div>

              <button
                type="button"
                onClick={() => removeServiceItem(index)}
                disabled={serviceItems.length === 1}
              >
                Obriši uslugu
              </button>
            </fieldset>
          ))}

          <button type="submit" disabled={isSavingServices}>
            {isSavingServices ? "Čuvam..." : "Sačuvaj i nastavi"}
          </button>
        </form>
      )}

      {currentStep === 4 && (
        <form onSubmit={saveTeam}>
          <h2>Tim</h2>

          <div>
            <label>
              <input
                checked={teamMode === "solo"}
                name="teamMode"
                type="radio"
                value="solo"
                onChange={() => {
                  setTeamMode("solo");
                  setTeamValidationError(null);
                }}
              />
              Samo ja
            </label>

            <label>
              <input
                checked={teamMode === "team"}
                name="teamMode"
                type="radio"
                value="team"
                onChange={() => {
                  setTeamMode("team");
                  setTeamValidationError(null);
                }}
              />
              Imam tim
            </label>
          </div>

          {teamMode === "solo" && (
            <p>
              Kreiraćemo jednog zaposlenog za salon sa pozicijom Vlasnik, bez
              dupliranja ako već postoji.
            </p>
          )}

          {teamMode === "team" && (
            <>
              <button type="button" onClick={addEmployeeItem}>
                + Dodaj zaposlenog
              </button>

              {teamValidationError && <p>{teamValidationError}</p>}

              {employeeItems.map((employee, index) => (
                <fieldset key={employee.rowKey}>
                  <legend>Zaposleni {index + 1}</legend>

                  <div>
                    <label htmlFor={`employeeName-${employee.rowKey}`}>
                      Ime
                    </label>
                    <input
                      id={`employeeName-${employee.rowKey}`}
                      type="text"
                      value={employee.fullName}
                      onChange={(event) =>
                        updateEmployeeItem(index, {
                          fullName: event.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`employeePosition-${employee.rowKey}`}>
                      Pozicija
                    </label>
                    <input
                      id={`employeePosition-${employee.rowKey}`}
                      type="text"
                      value={employee.position}
                      onChange={(event) =>
                        updateEmployeeItem(index, {
                          position: event.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`employeePhone-${employee.rowKey}`}>
                      Telefon
                    </label>
                    <input
                      id={`employeePhone-${employee.rowKey}`}
                      type="text"
                      value={employee.phone}
                      onChange={(event) =>
                        updateEmployeeItem(index, {
                          phone: event.target.value,
                        })
                      }
                    />
                  </div>

                  <div>
                    <label htmlFor={`employeeEmail-${employee.rowKey}`}>
                      Email
                    </label>
                    <input
                      id={`employeeEmail-${employee.rowKey}`}
                      type="email"
                      value={employee.email}
                      onChange={(event) =>
                        updateEmployeeItem(index, {
                          email: event.target.value,
                        })
                      }
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => removeEmployeeItem(index)}
                    disabled={employeeItems.length === 1}
                  >
                    Ukloni zaposlenog
                  </button>
                </fieldset>
              ))}
            </>
          )}

          {teamMode === "solo" && teamValidationError && (
            <p>{teamValidationError}</p>
          )}

          <button type="submit" disabled={isSavingTeam}>
            {isSavingTeam ? "Čuvam..." : "Sačuvaj i nastavi"}
          </button>
        </form>
      )}

      {currentStep === 5 && (
        <section>
          <h2>🎉 Vaš salon je spreman.</h2>
          <p>
            Uspešno ste završili početno podešavanje. Sve osnovne informacije
            su sačuvane i možete odmah početi da koristite Rezervo.
          </p>

          <div>
            <article>
              <h3>Naziv salona</h3>
              <p>{salonName || "Salon"}</p>
            </article>

            <article>
              <h3>Broj zaposlenih</h3>
              <p>{employeesCount}</p>
            </article>

            <article>
              <h3>Broj usluga</h3>
              <p>{servicesCount}</p>
            </article>

            <article>
              <h3>Radno vreme podešeno</h3>
              <p>{hasWorkingHours ? "✓" : "Nije podešeno"}</p>
            </article>
          </div>

          <div>
            <button
              type="button"
              onClick={() => finishOnboardingAndNavigate("/dashboard")}
              disabled={isSkippingSetup}
            >
              <strong>Idi na Dashboard</strong>
              <span>Otvori glavni pregled i počni sa radom.</span>
            </button>

            <button
              type="button"
              onClick={() => finishOnboardingAndNavigate("/calendar")}
              disabled={isSkippingSetup}
            >
              <strong>Dodaj prvi termin</strong>
              <span>Brzo kreiraj prvu rezervaciju.</span>
            </button>

            <button type="button" disabled>
              <strong>Booking link</strong>
              <span>{salonSlug ? `/book/${salonSlug}` : "Uskoro dostupno"}</span>
              <span>Uskoro dostupno</span>
            </button>
          </div>

          <div>
            <button type="button" onClick={goBack}>
              Nazad
            </button>

            <button
              type="button"
              onClick={() => finishOnboardingAndNavigate("/dashboard")}
              disabled={isSkippingSetup}
            >
              {isSkippingSetup ? "Preusmeravam..." : "Idi na Dashboard"}
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
