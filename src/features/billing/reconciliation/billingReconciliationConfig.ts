import { createHash,timingSafeEqual } from "node:crypto";
import {resolveLemonSqueezyProviderConfig} from "../config/lemonSqueezyProviderConfigCore.ts";
export type BillingReconciliationConfig={enabled:true;secret:string;batchSize:number;apiKey:string;storeId:string};
export class BillingReconciliationConfigError extends Error{constructor(){super("BILLING_RECONCILIATION_DISABLED");this.name="BillingReconciliationConfigError";}}
export function getBillingReconciliationConfig(env:Record<string,string|undefined>=process.env){
  const secret=env.BILLING_RECONCILIATION_SECRET?.trim();
  if(env.BILLING_RECONCILIATION_ENABLED!=="true"||!secret) throw new BillingReconciliationConfigError();
  let providerConfig;
  try{providerConfig=resolveLemonSqueezyProviderConfig(env,"test");}catch{throw new BillingReconciliationConfigError();}
  const value=Number(env.BILLING_RECONCILIATION_BATCH_SIZE??"10");
  return {enabled:true,secret,batchSize:Number.isInteger(value)&&value>=1&&value<=20?value:10,apiKey:providerConfig.apiKey,storeId:providerConfig.storeId} satisfies BillingReconciliationConfig;
}
export function verifyBillingReconciliationAuthorization(value:string|null,secret:string){const supplied=value?.startsWith("Bearer ")?value.slice(7).trim():"";if(!supplied)return false;return timingSafeEqual(createHash("sha256").update(supplied).digest(),createHash("sha256").update(secret).digest());}
