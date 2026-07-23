import { NextResponse } from "next/server";

import { getAuthenticatedRequestUser } from "@/lib/server/requestAuth";
import {
  buildStatisticsPeriod,
  InvalidStatisticsPeriodError,
} from "@/lib/server/statisticsPeriod";
import { supabaseServer } from "@/lib/supabaseServer";
import { addDaysToDateKey } from "@/lib/salonDateTime";
import { statisticsPeriodInputSchema, statisticsQuerySchema } from "@/features/statistics/schemas/statisticsSchema";
import type { StatisticsResponse } from "@/features/statistics/types";

export const dynamic = "force-dynamic";

function errorResponse(code: string, message: string, status: number) {
  return NextResponse.json(
    { success: false, code, message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  const authResult = await getAuthenticatedRequestUser(request);
  if (!authResult.ok) {
    return errorResponse("UNAUTHORIZED", "Morate biti prijavljeni.", 401);
  }

  const url = new URL(request.url);
  const parsedQuery = statisticsQuerySchema.safeParse({
    salonId: url.searchParams.get("salonId"),
    preset: url.searchParams.get("preset") ?? undefined,
    start: url.searchParams.get("start") ?? undefined,
    end: url.searchParams.get("end") ?? undefined,
  });
  if (!parsedQuery.success) {
    return errorResponse("INVALID_PERIOD", "Izabrani period nije ispravan.", 400);
  }

  const parsedPeriod = statisticsPeriodInputSchema.safeParse({
    preset: parsedQuery.data.preset,
    customStart: parsedQuery.data.start,
    customEnd: parsedQuery.data.end,
  });
  if (!parsedPeriod.success) {
    return errorResponse("INVALID_PERIOD", "Izabrani period nije ispravan.", 400);
  }

  const { data: salon, error: salonError } = await supabaseServer
    .from("salons")
    .select("id, owner_id, timezone, default_currency")
    .eq("id", parsedQuery.data.salonId)
    .maybeSingle();

  if (salonError) {
    if (process.env.NODE_ENV === "development") {
      console.error("STATISTICS_SALON_LOOKUP_FAILED", {
        code: salonError.code,
        message: salonError.message,
      });
    }
    return errorResponse("STATISTICS_LOAD_FAILED", "Statistiku trenutno nije moguće učitati.", 500);
  }
  if (!salon) {
    return errorResponse("SALON_NOT_FOUND", "Salon nije pronađen.", 404);
  }

  let isOwner = salon.owner_id === authResult.user.id;
  if (!isOwner) {
    const { data: ownerMembership, error: membershipError } = await supabaseServer
      .from("salon_members")
      .select("id")
      .eq("salon_id", salon.id)
      .eq("profile_id", authResult.user.id)
      .eq("role", "owner")
      .eq("status", "active")
      .maybeSingle();

    if (membershipError) {
      if (process.env.NODE_ENV === "development") {
        console.error("STATISTICS_MEMBERSHIP_LOOKUP_FAILED", {
          code: membershipError.code,
          message: membershipError.message,
        });
      }
      return errorResponse("STATISTICS_LOAD_FAILED", "Statistiku trenutno nije moguće učitati.", 500);
    }
    isOwner = Boolean(ownerMembership);
  }

  if (!isOwner) {
    return errorResponse("FORBIDDEN", "Nemate dozvolu za statistiku salona.", 403);
  }

  const timeZone = salon.timezone || "Europe/Belgrade";
  let period: ReturnType<typeof buildStatisticsPeriod>;
  try {
    period = buildStatisticsPeriod(parsedPeriod.data, timeZone);
  } catch (error) {
    if (error instanceof InvalidStatisticsPeriodError) {
      return errorResponse("INVALID_PERIOD", "Izabrani period nije ispravan.", 400);
    }
    return errorResponse("INVALID_PERIOD", "Timezone salona nije ispravan.", 400);
  }

  const { data, error } = await supabaseServer.rpc("get_owner_statistics_v1", {
    p_salon_id: salon.id,
    p_start_utc: period.startUtc.toISOString(),
    p_end_utc: period.endUtc.toISOString(),
    p_granularity: period.bucketGranularity,
  });

  if (error || !data) {
    if (process.env.NODE_ENV === "development") {
      console.error("STATISTICS_RPC_FAILED", {
        code: error?.code ?? null,
        message: error?.message ?? "No statistics payload returned",
      });
    }
    return errorResponse("STATISTICS_LOAD_FAILED", "Statistiku trenutno nije moguće učitati.", 500);
  }

  const aggregate = data as Omit<StatisticsResponse, "period">;
  const statistics: StatisticsResponse = {
    ...aggregate,
    period: {
      preset: period.preset,
      startDate: period.dateKeyStart,
      endDate: addDaysToDateKey(period.dateKeyEndExclusive, -1),
      startUtc: period.startUtc.toISOString(),
      endUtc: period.endUtc.toISOString(),
      timezone: timeZone,
      granularity: period.bucketGranularity,
      label: period.label,
    },
  };

  return NextResponse.json(
    { success: true, statistics },
    { headers: { "Cache-Control": "no-store" } },
  );
}
