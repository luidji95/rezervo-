import { NextResponse } from "next/server";
import { z } from "zod";

import { createAuthenticatedRequestClient, getAuthenticatedRequestUser } from "@/lib/server/requestAuth";

const createEmployeeSchema = z.object({
  salonId: z.uuid(),
  fullName: z.string().trim().min(1).max(200),
  displayName: z.string().trim().max(200).nullable(),
  position: z.string().trim().max(200).nullable(),
  phone: z.string().trim().max(100).nullable(),
  email: z.email().nullable(),
  bio: z.string().trim().max(5000).nullable(),
});

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

export async function POST(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  const requestClient = createAuthenticatedRequestClient(request);
  if (!auth.ok || !requestClient) return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  const parsed = createEmployeeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("INVALID_EMPLOYEE", "Podaci zaposlenog nisu ispravni.", 400);

  const input = parsed.data;
  const { data, error } = await requestClient.rpc("create_employee_with_entitlement", {
    p_salon_id: input.salonId,
    p_full_name: input.fullName,
    p_display_name: input.displayName,
    p_position: input.position,
    p_phone: input.phone,
    p_email: input.email,
    p_bio: input.bio,
  });
  if (error) {
    if (error.message.includes("EMPLOYEE_LIMIT_REACHED")) return errorResponse("EMPLOYEE_LIMIT_REACHED", "Dostigli ste maksimalan broj zaposlenih za trenutni paket.", 403);
    if (error.message.includes("FORBIDDEN") || error.code === "42501") return errorResponse("FORBIDDEN", "Nemate dozvolu za dodavanje zaposlenih.", 403);
    return errorResponse("EMPLOYEE_CREATE_FAILED", "Zaposlenog trenutno nije moguće sačuvati.", 500);
  }
  return NextResponse.json({ success: true, employee: data }, { status: 201 });
}
