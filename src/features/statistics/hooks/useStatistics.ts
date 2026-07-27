"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuthorization } from "@/context/AuthorizationContext";
import { useEntitlements } from "@/features/billing/hooks/useEntitlements";
import { statisticsPeriodInputSchema } from "../schemas/statisticsSchema";
import {
  getStatistics,
  StatisticsServiceError,
  type StatisticsErrorCode,
} from "../services/statisticsService";
import type {
  StatisticsPeriodInput,
  StatisticsPreset,
  StatisticsResponse,
} from "../types";

function periodFromParams(params: URLSearchParams): StatisticsPeriodInput {
  const candidate = {
    preset: params.get("preset") ?? "this_month",
    customStart: params.get("start") ?? undefined,
    customEnd: params.get("end") ?? undefined,
  };
  const parsed = statisticsPeriodInputSchema.safeParse(candidate);
  return parsed.success ? parsed.data : { preset: "this_month" };
}

export function useStatistics() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { currentSalon, currentRole } = useAuthorization();
  const entitlementState = useEntitlements();
  const period = useMemo(
    () => periodFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const [data, setData] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StatisticsErrorCode | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  const updatePeriod = useCallback(
    (next: StatisticsPeriodInput) => {
      const parsed = statisticsPeriodInputSchema.safeParse(next);
      if (!parsed.success) return false;
      const query = new URLSearchParams({ preset: parsed.data.preset });
      if (parsed.data.customStart) query.set("start", parsed.data.customStart);
      if (parsed.data.customEnd) query.set("end", parsed.data.customEnd);
      router.replace(`/statistics?${query.toString()}`, { scroll: false });
      return true;
    },
    [router],
  );

  const selectPreset = useCallback(
    (preset: Exclude<StatisticsPreset, "custom">) =>
      updatePeriod({ preset }),
    [updatePeriod],
  );

  const retry = useCallback(() => setRequestVersion((value) => value + 1), []);

  useEffect(() => {
    if (!currentSalon || currentRole !== "owner" || entitlementState.loading) return;
    if (!entitlementState.entitlements?.effectiveCapabilities.canUseStatistics) {
      Promise.resolve().then(() => setLoading(false));
      return;
    }
    const controller = new AbortController();
    const request = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void getStatistics({
        salonId: currentSalon.id,
        period,
        signal: controller.signal,
      })
        .then((result) => {
          if (!controller.signal.aborted) setData(result);
        })
        .catch((requestError) => {
          if (controller.signal.aborted) return;
          const code =
            requestError instanceof StatisticsServiceError
              ? requestError.code
              : "STATISTICS_LOAD_FAILED";
          setError(code);
          if (code === "FORBIDDEN") router.replace("/dashboard");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 0);

    return () => {
      window.clearTimeout(request);
      controller.abort();
    };
  }, [currentRole, currentSalon, entitlementState.entitlements?.effectiveCapabilities.canUseStatistics, entitlementState.loading, period, requestVersion, router]);

  return {
    data,
    period,
    loading,
    initialLoading: loading && !data,
    error,
    selectPreset,
    updatePeriod,
    retry,
  };
}
