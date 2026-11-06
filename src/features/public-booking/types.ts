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
  categoryId: string | null;
  categoryName: string | null;
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
  note: string;
};

export type CreatePublicBookingInput = {
  salonSlug: string;
  serviceId: string;
  employeeId: string;
  idempotencyKey: string;
  manageToken: string;
  startTime: string;
  customer: PublicCustomerData;
};

export type CreatePublicBookingResult = {
  appointmentId: string;
  // True when the server attached this request's manage token to the appointment.
  manageAccess: boolean;
};

export type PublicBookingResult = CreatePublicBookingResult & {
  customer: PublicCustomerData;
  manageToken: string | null;
};

export type PublicManagedBooking = {
  salonName: string;
  salonSlug: string;
  salonPhone: string | null;
  timeZone: string;
  serviceName: string | null;
  startTime: string;
  endTime: string;
  status: string;
  canCancel: boolean;
  cancelDeadline: string;
};

export type PublicSalonPageData = {
  salon: PublicSalon;
  services: PublicService[];
  bookingAvailable: boolean;
};

export type PublicBookingAvailabilityState = {
  available: boolean;
};
