export type UpdateSalonInput = {
  salonId: string;
  name: string;
  phone: string;
  email: string;
  websiteUrl?: string;
  instagramUrl?: string;
  city?: string;
  addressLine: string;
  description?: string;
};