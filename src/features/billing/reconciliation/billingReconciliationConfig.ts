import { createHash,timingSafeEqual } from "node:crypto";
import { parseBillingEnvironment } from "../config/billingEnvironment.ts";
export type BillingReconciliationConfig={enabled:true;secret:string;batchSize:number;apiKey:string;storeId:string};
export class BillingReconciliationConfigError extends Error{constructor(){super("BILLING_RECONCILIATION_DISABLED");this.name="BillingReconciliationConfigError";}}
export function getBillingReconciliationConfig(env:Record<string,string|undefined>=process.env){
  const secret=env.BILLING_RECONCILIATION_SECRET?.trim(),apiKey=env.LEMONSQUEEZY_API_KEY?.trim(),storeId=env.LEMONSQUEEZY_STORE_ID?.trim();
  let billingEnvironment;
  try{billingEnvironment=parseBillingEnvironment(env.BILLING_ENVIRONMENT);}catch{throw new BillingReconciliationConfigError();}
  if(env.BILLING_RECONCILIATION_ENABLED!=="true"||env.BILLING_PROVIDER!=="lemonsqueezy"||billingEnvironment!=="test"||!secret||!apiKey||!storeId||!/^\d+$/.test(storeId)) throw new BillingReconciliationConfigError();
  const value=Number(env.BILLING_RECONCILIATION_BATCH_SIZE??"10");
  return {enabled:true,secret,batchSize:Number.isInteger(value)&&value>=1&&value<=20?value:10,apiKey,storeId} satisfies BillingReconciliationConfig;
}
export function verifyBillingReconciliationAuthorization(value:string|null,secret:string){const supplied=value?.startsWith("Bearer ")?value.slice(7).trim():"";if(!supplied)return false;return timingSafeEqual(createHash("sha256").update(supplied).digest(),createHash("sha256").update(secret).digest());}
