import type {BillingReconciliationConfig} from "./billingReconciliationConfig.ts";
import {BillingReconciliationConfigError,verifyBillingReconciliationAuthorization} from "./billingReconciliationConfig.ts";
import type {BillingReconciliationSummary} from "./billingReconciliationWorkerCore.ts";
export type PublicReconciliationSummary={claimed:number;inSync:number;remoteNewerEquivalent:number;driftDetected:number;manualReview:number;providerUnavailable:number;configurationError:number;claimLost:number};
const headers={"Cache-Control":"no-store"} as const;
function failure(code:string,status:number){return{status,body:{success:false as const,code},headers};}
export async function handleBillingReconciliationRequest(input:{request:Request;getConfig:()=>BillingReconciliationConfig;run:(config:BillingReconciliationConfig)=>Promise<BillingReconciliationSummary>}){
  let config:BillingReconciliationConfig;try{config=input.getConfig();}catch(error){return error instanceof BillingReconciliationConfigError?failure("BILLING_RECONCILIATION_DISABLED",503):failure("BILLING_RECONCILIATION_INTERNAL_ERROR",500);}
  if(!verifyBillingReconciliationAuthorization(input.request.headers.get("authorization"),config.secret))return failure("BILLING_RECONCILIATION_UNAUTHORIZED",401);
  const url=new URL(input.request.url);if(url.search||(await input.request.text()).length>0)return failure("BILLING_RECONCILIATION_REQUEST_INVALID",400);
  try{const s=await input.run(config);const summary:PublicReconciliationSummary={claimed:s.claimed,inSync:s.inSync,remoteNewerEquivalent:s.remoteNewerEquivalent,driftDetected:s.remoteNewerDrift+s.sameTimestampConflict,manualReview:s.localChangedDuringCheck+s.identityConflict+s.mappingConflict+s.planChangeDetected+s.providerNotFound+s.unsupportedRemoteState+s.providerResponseInvalid,providerUnavailable:s.providerUnavailable,configurationError:s.configurationError,claimLost:s.claimLost};return{status:200,body:{success:true as const,summary},headers,internalSummary:s};}catch{return failure("BILLING_RECONCILIATION_INTERNAL_ERROR",500);}
}
