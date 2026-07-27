import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabaseServer";
import { hasPublicBookingAccess } from "@/features/public-booking/services/publicBookingAccessService";

const schema = z.object({ salonId: z.string().uuid(), serviceId: z.string().uuid() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ success: false, code: "INVALID_INPUT" }, { status: 400 });
  const { salonId, serviceId } = parsed.data;
  try {
    const { data: salon } = await supabaseServer.from("salons")
      .select("id,status,booking_enabled,online_booking_enabled").eq("id", salonId).maybeSingle();
    if (!salon || salon.status !== "active" || !salon.booking_enabled || !salon.online_booking_enabled || !await hasPublicBookingAccess(salonId)) {
      return NextResponse.json({ success: false, code: "BOOKING_UNAVAILABLE" }, { status: 403 });
    }
    const { data: service } = await supabaseServer.from("services").select("id")
      .eq("id", serviceId).eq("salon_id", salonId).eq("is_active", true).eq("is_public", true).maybeSingle();
    if (!service) return NextResponse.json({ success: false, code: "BOOKING_UNAVAILABLE" }, { status: 404 });
    const { data, error } = await supabaseServer.from("employees").select("id,full_name,display_name,position,avatar_url,bio,sort_order,employee_services!inner(id)")
      .eq("salon_id", salonId).eq("is_active", true).eq("is_bookable", true).eq("is_public", true)
      .eq("employee_services.salon_id", salonId).eq("employee_services.service_id", serviceId)
      .eq("employee_services.is_active", true).order("sort_order", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ success: true, employees: (data ?? []).map((employee) => ({
      id: employee.id, name: employee.display_name || employee.full_name,
      position: employee.position, avatarUrl: employee.avatar_url, bio: employee.bio,
    })) });
  } catch {
    return NextResponse.json({ success: false, code: "BOOKING_UNAVAILABLE" }, { status: 500 });
  }
}
