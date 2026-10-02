import "server-only";
import { supabaseServer } from "@/lib/supabaseServer";
import type { BillingReconciliationRepository,ClaimedReconciliationCheck,ReconciliationFinalResult } from "./billingReconciliationWorkerCore";

export class SupabaseBillingReconciliationRepository implements BillingReconciliationRepository{
  async claimNext(runId:string){
    const {data,error}=await supabaseServer.rpc("claim_next_linked_billing_subscription_for_reconciliation_v1",{p_run_id:runId}).maybeSingle();
    if(error)throw new Error("BILLING_RECONCILIATION_CLAIM_FAILED"); if(!data)return null;
    const row=data as {check_id:string;subscription_id:string;claim_token:string;provider_subscription_id:string;provider_customer_id:string};
    return {checkId:row.check_id,subscriptionId:row.subscription_id,claimToken:row.claim_token,providerSubscriptionId:row.provider_subscription_id,providerCustomerId:row.provider_customer_id} satisfies ClaimedReconciliationCheck;
  }
  async finalize(input:Parameters<BillingReconciliationRepository["finalize"]>[0]){
    const s=input.snapshot;
    const {data,error}=await supabaseServer.rpc("finalize_billing_subscription_reconciliation_v1",{
      p_check_id:input.check.checkId,p_claim_token:input.check.claimToken,p_result_kind:input.resultKind,
      p_provider_subscription_id:s?.providerSubscriptionId??null,p_provider_customer_id:s?.providerCustomerId??null,
      p_provider_store_id:s?.providerStoreId??null,p_test_mode:s?.testMode??null,p_provider_product_id:s?.providerProductId??null,p_provider_variant_id:s?.providerVariantId??null,
      p_provider_status:s?.providerStatus??null,p_provider_cancelled:s?.providerCancelled??null,p_provider_pause_mode:s?.providerPauseMode??null,
      p_provider_pause_resumes_at:s?.providerPauseResumesAt??null,p_provider_trial_ends_at:s?.providerTrialEndsAt??null,
      p_provider_renews_at:s?.providerRenewsAt??null,p_provider_ends_at:s?.providerEndsAt??null,p_provider_created_at:s?.providerCreatedAt??null,
      p_provider_updated_at:s?.providerUpdatedAt??null,p_provider_error_code:input.errorCode??null,
    }).single();
    const row=data as {outcome?:unknown}|null;if(error||!row||typeof row.outcome!=="string")throw new Error("BILLING_RECONCILIATION_FINALIZE_FAILED");return row.outcome as ReconciliationFinalResult;
  }
}
