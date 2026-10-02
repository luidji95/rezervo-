import { normalizeLemonSqueezySubscriptionObject } from "../lemonSqueezy/lemonSqueezySubscriptionObjectCore.ts";
import { BILLING_RECONCILIATION_PROVIDER_TIMEOUT_MS,BillingReconciliationProviderError, type BillingReconciliationProvider } from "./billingReconciliationProvider.ts";

const API_BASE="https://api.lemonsqueezy.com/v1/subscriptions/"; const JSON_API="application/vnd.api+json";
function remaining(value:string|null){ if(value===null||!/^(0|[1-9]\d*)$/.test(value)) return null; const n=Number(value); return Number.isSafeInteger(n)?n:null; }
export class LemonSqueezyReconciliationProvider implements BillingReconciliationProvider {
  private readonly apiKey:string;private readonly fetchImpl:typeof fetch;private readonly timeoutMs:number;
  constructor(apiKey:string,fetchImpl:typeof fetch=fetch,timeoutMs=BILLING_RECONCILIATION_PROVIDER_TIMEOUT_MS){this.apiKey=apiKey;this.fetchImpl=fetchImpl;this.timeoutMs=timeoutMs;}
  async retrieveSubscription(providerSubscriptionId:string){
    const controller=new AbortController(); const timeout=setTimeout(()=>controller.abort(),this.timeoutMs);
    try {
      const response=await this.fetchImpl(`${API_BASE}${encodeURIComponent(providerSubscriptionId)}`,{method:"GET",headers:{Accept:JSON_API,"Content-Type":JSON_API,Authorization:`Bearer ${this.apiKey}`},cache:"no-store",redirect:"error",signal:controller.signal});
      const rateLimitRemaining=remaining(response.headers.get("x-ratelimit-remaining"));
      if(response.status===401||response.status===403) throw new BillingReconciliationProviderError("configuration_error","reconciliation_provider_configuration_error",true);
      if(response.status===404) throw new BillingReconciliationProviderError("provider_not_found","reconciliation_provider_not_found",false);
      if(response.status===429) throw new BillingReconciliationProviderError("provider_unavailable","provider_rate_limited",true);
      if(response.status>=500) throw new BillingReconciliationProviderError("provider_unavailable","provider_server_unavailable",false);
      if(!response.ok) throw new BillingReconciliationProviderError("provider_response_invalid","reconciliation_provider_response_invalid",false);
      let payload:unknown; try{payload=await response.json();}catch{throw new BillingReconciliationProviderError("provider_response_invalid","reconciliation_provider_response_invalid",false);}
      try{return {snapshot:normalizeLemonSqueezySubscriptionObject(payload),rateLimitRemaining};}
      catch{throw new BillingReconciliationProviderError("provider_response_invalid","reconciliation_provider_response_invalid",false);}
    } catch(error){
      if(error instanceof BillingReconciliationProviderError) throw error;
      throw new BillingReconciliationProviderError("provider_unavailable","provider_timeout",false);
    } finally {clearTimeout(timeout);}
  }
}
