import { BILLING_RECONCILIATION_PROVIDER_TIMEOUT_MS,BillingReconciliationProviderError,type BillingReconciliationProvider } from "./billingReconciliationProvider.ts";
import type { NormalizedLemonSqueezySubscription } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";

export const BILLING_RECONCILIATION_EXECUTION_BUDGET_MS=55_000;
export const BILLING_RECONCILIATION_FINALIZATION_RESERVE_MS=5_000;
export const BILLING_RECONCILIATION_MINIMUM_ITEM_TIME_MS=BILLING_RECONCILIATION_PROVIDER_TIMEOUT_MS+BILLING_RECONCILIATION_FINALIZATION_RESERVE_MS;

export type ClaimedReconciliationCheck={checkId:string;subscriptionId:string;claimToken:string;providerSubscriptionId:string;providerCustomerId:string};
export type ReconciliationFinalResult="in_sync"|"remote_newer_in_sync_equivalent"|"remote_newer_drift"|"same_timestamp_conflict"|"local_newer"|"local_changed_during_check"|"identity_conflict"|"mapping_conflict"|"plan_change_detected"|"provider_not_found"|"unsupported_remote_state"|"provider_unavailable"|"configuration_error"|"provider_response_invalid"|"retry_scheduled"|"abandoned"|"claim_lost"|"already_terminal";
export interface BillingReconciliationRepository{
  claimNext(runId:string):Promise<ClaimedReconciliationCheck|null>;
  finalize(input:{check:ClaimedReconciliationCheck;resultKind:"snapshot"|"provider_not_found"|"provider_unavailable"|"configuration_error"|"provider_response_invalid";snapshot?:NormalizedLemonSqueezySubscription;errorCode?:string}):Promise<ReconciliationFinalResult>;
}
export type BillingReconciliationSummary={claimed:number;inSync:number;remoteNewerEquivalent:number;remoteNewerDrift:number;sameTimestampConflict:number;localNewer:number;localChangedDuringCheck:number;identityConflict:number;mappingConflict:number;planChangeDetected:number;providerNotFound:number;unsupportedRemoteState:number;providerUnavailable:number;configurationError:number;providerResponseInvalid:number;claimLost:number;executionBudgetReached:boolean};
const empty=():BillingReconciliationSummary=>({claimed:0,inSync:0,remoteNewerEquivalent:0,remoteNewerDrift:0,sameTimestampConflict:0,localNewer:0,localChangedDuringCheck:0,identityConflict:0,mappingConflict:0,planChangeDetected:0,providerNotFound:0,unsupportedRemoteState:0,providerUnavailable:0,configurationError:0,providerResponseInvalid:0,claimLost:0,executionBudgetReached:false});
function count(summary:BillingReconciliationSummary,result:ReconciliationFinalResult){
  const map:Partial<Record<ReconciliationFinalResult,keyof BillingReconciliationSummary>>={in_sync:"inSync",remote_newer_in_sync_equivalent:"remoteNewerEquivalent",remote_newer_drift:"remoteNewerDrift",same_timestamp_conflict:"sameTimestampConflict",local_newer:"localNewer",local_changed_during_check:"localChangedDuringCheck",identity_conflict:"identityConflict",mapping_conflict:"mappingConflict",plan_change_detected:"planChangeDetected",provider_not_found:"providerNotFound",unsupported_remote_state:"unsupportedRemoteState",provider_unavailable:"providerUnavailable",retry_scheduled:"providerUnavailable",abandoned:"providerUnavailable",configuration_error:"configurationError",provider_response_invalid:"providerResponseInvalid",claim_lost:"claimLost"};
  const key=map[result]; if(key) summary[key]++;
}
export async function runBillingReconciliation(input:{runId:string;batchSize:number;storeId:string;repository:BillingReconciliationRepository;provider:BillingReconciliationProvider;monotonicNow?:()=>number}){
  const summary=empty();
  const monotonicNow=input.monotonicNow??(()=>performance.now());
  const startedAt=monotonicNow();
  for(let index=0;index<input.batchSize;index++){
    const remainingMs=BILLING_RECONCILIATION_EXECUTION_BUDGET_MS-(monotonicNow()-startedAt);
    if(remainingMs<=BILLING_RECONCILIATION_MINIMUM_ITEM_TIME_MS){summary.executionBudgetReached=true;break;}
    const check=await input.repository.claimNext(input.runId); if(!check)break; summary.claimed++;
    let stop=false;let finalizeInput:Parameters<BillingReconciliationRepository["finalize"]>[0];
    try{const result=await input.provider.retrieveSubscription(check.providerSubscriptionId);finalizeInput={check,resultKind:"snapshot",snapshot:result.snapshot};if(result.rateLimitRemaining!==null&&result.rateLimitRemaining<2)stop=true;}
    catch(error){const providerError=error instanceof BillingReconciliationProviderError?error:new BillingReconciliationProviderError("provider_unavailable","provider_timeout",false);finalizeInput={check,resultKind:providerError.kind,errorCode:providerError.code};if(providerError.stopRun)stop=true;}
    try{const final=await input.repository.finalize(finalizeInput);count(summary,final);}catch{summary.claimLost++;}
    if(stop)break;
  }
  return summary;
}
