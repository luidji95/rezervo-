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

const updateEmployeeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("update_details"), employeeId: z.uuid(), fullName: z.string().trim().min(1).max(200), displayName: z.string().trim().max(200).nullable(), position: z.string().trim().max(200).nullable(), phone: z.string().trim().max(100).nullable(), email: z.email().nullable(), bio: z.string().trim().max(5000).nullable(), isBookable: z.boolean().nullable(), isPublic: z.boolean().nullable() }),
  z.object({ action: z.literal("set_active"), employeeId: z.uuid(), isActive: z.boolean() }),
  z.object({ action: z.literal("link_current_owner"), employeeId: z.uuid() }),
]);

const deleteEmployeeSchema = z.object({ employeeId: z.uuid() });

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json({ success: false, code, message }, { status });
}

function employeeRpcError(error: { code?: string; message?: string }) {
  const message = error.message ?? "";
  if (message.includes("EMPLOYEE_LIMIT_REACHED")) return errorResponse("EMPLOYEE_LIMIT_REACHED", "Dostigli ste maksimalan broj zaposlenih za trenutni paket.", 403);
  if (message.includes("EMPLOYEE_ACCESS_REQUIRED")) return errorResponse("EMPLOYEE_ACCESS_REQUIRED", "Pretplata trenutno ne dozvoljava aktiviranje zaposlenih.", 403);
  if (message.includes("EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED")) return errorResponse("EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED", "Paket salona trenutno nije ispravno podešen.", 409);
  if (message.includes("EMPLOYEE_HAS_FUTURE_APPOINTMENTS")) return errorResponse("EMPLOYEE_HAS_FUTURE_APPOINTMENTS", "Zaposleni ima buduće termine.", 409);
  if (message.includes("EMPLOYEE_NOT_FOUND") || error.code === "P0002") return errorResponse("EMPLOYEE_NOT_FOUND", "Zaposleni nije pronađen.", 404);
  if (message.includes("PROFILE_ALREADY_LINKED") || message.includes("EMPLOYEE_ALREADY_LINKED")) return errorResponse("EMPLOYEE_ALREADY_LINKED", "Nalog je već povezan sa zaposlenim.", 409);
  if (message.includes("FORBIDDEN") || error.code === "42501") return errorResponse("FORBIDDEN", "Nemate dozvolu za ovu izmenu.", 403);
  return errorResponse("EMPLOYEE_MUTATION_FAILED", "Izmenu zaposlenog trenutno nije moguće sačuvati.", 500);
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
    if (error.message.includes("EMPLOYEE_ACCESS_REQUIRED") || error.message.includes("EMPLOYEE_ENTITLEMENT_NOT_CONFIGURED")) return employeeRpcError(error);
    if (error.message.includes("EMPLOYEE_LIMIT_REACHED")) return errorResponse("EMPLOYEE_LIMIT_REACHED", "Dostigli ste maksimalan broj zaposlenih za trenutni paket.", 403);
    if (error.message.includes("FORBIDDEN") || error.code === "42501") return errorResponse("FORBIDDEN", "Nemate dozvolu za dodavanje zaposlenih.", 403);
    return errorResponse("EMPLOYEE_CREATE_FAILED", "Zaposlenog trenutno nije moguće sačuvati.", 500);
  }
  return NextResponse.json({ success: true, employee: data }, { status: 201 });
}

export async function PATCH(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  const requestClient = createAuthenticatedRequestClient(request);
  if (!auth.ok || !requestClient) return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  const parsed = updateEmployeeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("INVALID_EMPLOYEE", "Podaci zaposlenog nisu ispravni.", 400);
  const input = parsed.data;
  const call = input.action === "update_details"
    ? requestClient.rpc("update_employee_details_v1", { p_employee_id: input.employeeId, p_full_name: input.fullName, p_display_name: input.displayName, p_position: input.position, p_phone: input.phone, p_email: input.email, p_bio: input.bio, p_is_bookable: input.isBookable, p_is_public: input.isPublic })
    : input.action === "set_active"
      ? requestClient.rpc("set_employee_active_state", { p_employee_id: input.employeeId, p_is_active: input.isActive })
      : requestClient.rpc("link_current_owner_employee_v1", { p_employee_id: input.employeeId });
  const { data, error } = await call;
  if (error) return employeeRpcError(error);
  return NextResponse.json({ success: true, employee: data });
}

export async function DELETE(request: Request) {
  const auth = await getAuthenticatedRequestUser(request);
  const requestClient = createAuthenticatedRequestClient(request);
  if (!auth.ok || !requestClient) return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  const parsed = deleteEmployeeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorResponse("INVALID_EMPLOYEE", "Zaposleni nije ispravan.", 400);
  const { data, error } = await requestClient.rpc("delete_employee_safely_v1", { p_employee_id: parsed.data.employeeId });
  if (error) return employeeRpcError(error);
  return NextResponse.json({ success: true, mode: data });
}
