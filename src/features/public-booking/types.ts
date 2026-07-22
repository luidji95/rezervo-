export type PublicSalon = {
  id: string;
  name: string;
  slug: string;
  logoUrl: string | null;
  coverImageUrl: string | null;
  description: string | null;
  shortDescription: string | null;
  addressLine: string | null;
  city: string | null;
  phone: string | null;
  email: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  timezone: string;
};

export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  price: number;
  currency: string;
};

export type PublicEmployee = {
  id: string;
  name: string;
  position: string | null;
  avatarUrl: string | null;
  bio: string | null;
};

export type PublicEmployeeSelection = "any" | string | null;

export type PublicAvailabilitySlot = {
  startTime: string;
  endTime: string;
  employeeId: string;
};

export type PublicAvailabilityInput = {
  salonId: string;
  serviceId: string;
  employeeId: string;
  date: string;
};

export type PublicCustomerData = {
  fullName: string;
  phone: string;
  email: string;
};

export type CreatePublicBookingInput = {
  salonSlug: string;
  serviceId: string;
  employeeId: string;
  idempotencyKey: string;
  startTime: string;
  customer: PublicCustomerData;
};

export type CreatePublicBookingResult = {
  appointmentId: string;
};

export type PublicBookingResult = CreatePublicBookingResult & {
  customer: PublicCustomerData;
};

export type PublicSalonPageData = {
  salon: PublicSalon;
  services: PublicService[];
};
