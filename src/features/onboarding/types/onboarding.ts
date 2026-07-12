export type WorkingHourFormDay = {
  dayOfWeek: number;
  label: string;
  isWorkingDay: boolean;
  opensAt: string;
  closesAt: string;
  breakStartsAt: string;
  breakEndsAt: string;
};

export type OnboardingServiceItem = {
  id?: string;
  rowKey: string;
  name: string;
  durationMinutes: number;
  priceAmount: number;
};

export type OnboardingServiceTemplateItem = Omit<
  OnboardingServiceItem,
  "rowKey"
>;

export type TeamMode = "solo" | "team";

export type OnboardingEmployeeItem = {
  id?: string;
  rowKey: string;
  fullName: string;
  position: string;
  phone: string;
  email: string;
};

export type OnboardingDestination = "/dashboard" | "/calendar";

