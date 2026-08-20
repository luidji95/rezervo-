import "server-only";

import { supabaseServer } from "@/lib/supabaseServer";
import type {
  BillingCheckoutLedger,
  BillingCheckoutRepository,
  BillingPriceMapping,
} from "./billingCheckoutCore";
import type { CheckoutPlanCode } from "../providers/billingProvider";
import type { BillingEnvironment } from "../config/billingEnvironment";
import {
  parseBillingCheckoutCurrentState,
  parseBillingCheckoutIntentAcquisition,
} from "./billingCheckoutIntent";

type MappingResult = {
  id: string;
  plan_id: string;
  amount: number;
  currency: string;
  is_active: boolean;
  provider_variant_id: string;
  provider_store_id: string;
  environment: string;
  plans: {
    slug: string;
    is_active: boolean;
    monthly_price: number;
    currency: string;
  };
};

function toLedger(row: {
  id: string;
  salon_id: string;
  actor_profile_id: string;
  requested_plan_id: string;
  idempotency_key: string;
  status: string;
  expires_at: string | null;
}): BillingCheckoutLedger {
  return {
    id: row.id,
    salonId: row.salon_id,
    actorProfileId: row.actor_profile_id,
    requestedPlanId: row.requested_plan_id,
    idempotencyKey: row.idempotency_key,
    status: row.status as BillingCheckoutLedger["status"],
    expiresAt: row.expires_at,
  };
}

const LEDGER_COLUMNS =
  "id,salon_id,actor_profile_id,requested_plan_id,idempotency_key,status,expires_at";

export class SupabaseBillingCheckoutRepository
  implements BillingCheckoutRepository
{
  constructor(private readonly environment: BillingEnvironment) {}

  async isSalonOwner(salonId: string, actorProfileId: string) {
    const { data, error } = await supabaseServer
      .from("salons")
      .select("id")
      .eq("id", salonId)
      .eq("owner_id", actorProfileId)
      .maybeSingle();
    if (error) throw new Error("BILLING_AUTHORIZATION_LOOKUP_FAILED");
    return Boolean(data);
  }

  async hasActiveOverride(salonId: string, now: string) {
    const { data, error } = await supabaseServer
      .from("billing_access_overrides")
      .select("id")
      .eq("salon_id", salonId)
      .eq("enabled", true)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt."${now}"`)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("BILLING_OVERRIDE_LOOKUP_FAILED");
    return Boolean(data);
  }

  async getPriceMapping(
    planCode: CheckoutPlanCode,
  ): Promise<BillingPriceMapping | null> {
    const { data, error } = await supabaseServer
      .from("billing_provider_prices")
      .select(
        "id,plan_id,amount,currency,is_active,provider_store_id,provider_variant_id,environment,plans!inner(slug,is_active,monthly_price,currency)",
      )
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("billing_interval", "monthly")
      .eq("plans.slug", planCode)
      .maybeSingle();
    if (error) throw new Error("BILLING_MAPPING_LOOKUP_FAILED");
    if (!data) return null;
    const row = data as unknown as MappingResult;
    if (row.plans.slug !== "starter" && row.plans.slug !== "pro") {
      throw new Error("BILLING_MAPPING_LOOKUP_FAILED");
    }
    return {
      id: row.id,
      planId: row.plan_id,
      planCode: row.plans.slug,
      planActive: row.plans.is_active,
      planMonthlyPrice: Number(row.plans.monthly_price),
      planCurrency: row.plans.currency,
      mappingActive: row.is_active,
      mappingAmount: Number(row.amount),
      mappingCurrency: row.currency,
      providerVariantId: row.provider_variant_id,
      providerStoreId: row.provider_store_id,
      environment: row.environment as BillingEnvironment,
    };
  }

  async acquireCheckoutIntent(input: {
    salonId: string;
    actorProfileId: string;
    planId: string;
  }) {
    const { data, error } = await supabaseServer.rpc(
      "acquire_billing_checkout_intent_v1",
      {
        p_salon_id: input.salonId,
        p_actor_profile_id: input.actorProfileId,
        p_requested_plan_id: input.planId,
        p_provider: "lemonsqueezy",
        p_environment: this.environment,
      },
    );
    if (error || !Array.isArray(data) || data.length !== 1) {
      throw new Error("BILLING_CHECKOUT_INTENT_ACQUIRE_FAILED");
    }
    return parseBillingCheckoutIntentAcquisition(
      data[0],
      this.environment,
      input.salonId,
    );
  }

  async getCheckoutSessionById(id: string) {
    const { data, error } = await supabaseServer
      .from("billing_checkout_sessions")
      .select(`${LEDGER_COLUMNS},provider,environment,provider_session_id,checkout_url_hash`)
      .eq("id", id)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .maybeSingle();
    if (error) throw new Error("BILLING_SESSION_LOOKUP_FAILED");
    return data ? parseBillingCheckoutCurrentState(data, this.environment) : null;
  }

  async findByIdempotencyKey(key: string) {
    const { data, error } = await supabaseServer
      .from("billing_checkout_sessions")
      .select(LEDGER_COLUMNS)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (error) throw new Error("BILLING_SESSION_LOOKUP_FAILED");
    return data ? toLedger(data) : null;
  }

  async findReusableOpenSession(input: {
    salonId: string;
    planId: string;
    now: string;
  }) {
    const cutoff = new Date(Date.parse(input.now) - 30 * 60 * 1000).toISOString();
    const { data, error } = await supabaseServer
      .from("billing_checkout_sessions")
      .select(LEDGER_COLUMNS)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("salon_id", input.salonId)
      .eq("requested_plan_id", input.planId)
      .eq("status", "open")
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("BILLING_SESSION_LOOKUP_FAILED");
    return data ? toLedger(data) : null;
  }

  async markExpired(id: string) {
    const { error } = await supabaseServer
      .from("billing_checkout_sessions")
      .update({ status: "expired" })
      .eq("id", id)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("status", "open");
    if (error) throw new Error("BILLING_SESSION_UPDATE_FAILED");
  }

  async insertCreating(input: {
    salonId: string;
    actorProfileId: string;
    planId: string;
    idempotencyKey: string;
  }) {
    const { data, error } = await supabaseServer
      .from("billing_checkout_sessions")
      .insert({
        salon_id: input.salonId,
        actor_profile_id: input.actorProfileId,
        requested_plan_id: input.planId,
        provider: "lemonsqueezy",
        environment: this.environment,
        idempotency_key: input.idempotencyKey,
        status: "creating",
      })
      .select(LEDGER_COLUMNS)
      .single();
    if (!error && data) {
      return {
        outcome: "created" as const,
        checkoutSession: {
          ...toLedger(data),
          status: "creating" as const,
        },
      };
    }
    if (error?.code === "23505") {
      const existing = await this.findByIdempotencyKey(input.idempotencyKey);
      if (existing) {
        return { outcome: "existing" as const, checkoutSession: existing };
      }
    }
    throw new Error("BILLING_SESSION_INSERT_FAILED");
  }

  async markOpen(input: {
    id: string;
    providerSessionId: string;
    checkoutUrlHash: string;
    expiresAt: string;
  }) {
    const { data, error } = await supabaseServer
      .from("billing_checkout_sessions")
      .update({
        status: "open",
        provider_session_id: input.providerSessionId,
        checkout_url_hash: input.checkoutUrlHash,
        expires_at: input.expiresAt,
        error_code: null,
      })
      .eq("id", input.id)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("status", "creating")
      .select("id")
      .maybeSingle();
    if (error || !data) throw new Error("BILLING_SESSION_UPDATE_FAILED");
  }

  async markFailed(id: string, errorCode: string) {
    const { error } = await supabaseServer
      .from("billing_checkout_sessions")
      .update({
        status: "failed",
        failed_at: new Date().toISOString(),
        error_code: errorCode,
      })
      .eq("id", id)
      .eq("provider", "lemonsqueezy")
      .eq("environment", this.environment)
      .eq("status", "creating");
    if (error) throw new Error("BILLING_SESSION_UPDATE_FAILED");
  }
}
