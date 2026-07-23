import { supabase } from "@/lib/supabase/client";
import type {
  StatisticsPeriodInput,
  StatisticsResponse,
} from "@/features/statistics/types";

export type StatisticsErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "INVALID_PERIOD"
  | "SALON_NOT_FOUND"
  | "STATISTICS_LOAD_FAILED";

export class StatisticsServiceError extends Error {
  constructor(public readonly code: StatisticsErrorCode) {
    super(code);
    this.name = "StatisticsServiceError";
  }
}

export async function getStatistics(input: {
  salonId: string;
  period: StatisticsPeriodInput;
  signal?: AbortSignal;
}): Promise<StatisticsResponse> {
  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.access_token) {
    throw new StatisticsServiceError("UNAUTHORIZED");
  }

  const query = new URLSearchParams({
    salonId: input.salonId,
    preset: input.period.preset,
  });
  if (input.period.customStart) query.set("start", input.period.customStart);
  if (input.period.customEnd) query.set("end", input.period.customEnd);

  const response = await fetch(`/api/statistics?${query.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${session.access_token}` },
    cache: "no-store",
    signal: input.signal,
  });
  const body = (await response.json().catch(() => null)) as
    | { success: true; statistics: StatisticsResponse }
    | { success: false; code?: StatisticsErrorCode }
    | null;

  if (!response.ok || !body?.success) {
    throw new StatisticsServiceError(
      body && "code" in body && body.code
        ? body.code
        : "STATISTICS_LOAD_FAILED",
    );
  }

  return body.statistics;
}
