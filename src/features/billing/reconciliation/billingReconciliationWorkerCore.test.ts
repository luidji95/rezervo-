import assert from "node:assert/strict";import test from "node:test";import {runBillingReconciliation,type BillingReconciliationRepository,type ClaimedReconciliationCheck,type ReconciliationFinalResult} from "./billingReconciliationWorkerCore.ts";import {BillingReconciliationProviderError} from "./billingReconciliationProvider.ts";
const check=(id:string):ClaimedReconciliationCheck=>({checkId:id,subscriptionId:id,claimToken:`t-${id}`,providerSubscriptionId:id,providerCustomerId:"customer"});
const snapshot={providerSubscriptionId:"1",providerStoreId:"10",providerCustomerId:"customer",providerOrderId:null,providerProductId:"20",providerVariantId:"30",providerStatus:"active",providerCancelled:false,providerPauseMode:null,providerPauseResumesAt:null,providerTrialEndsAt:null,providerRenewsAt:"2026-08-01T00:00:00Z",providerEndsAt:null,providerCreatedAt:"2026-07-01T00:00:00Z",providerUpdatedAt:"2026-07-02T00:00:00Z",testMode:true} as const;
class Repo implements BillingReconciliationRepository{claims=0;active=0;max=0;readonly items:ClaimedReconciliationCheck[];readonly outcomes:string[];constructor(items:ClaimedReconciliationCheck[],outcomes:string[]=[] ){this.items=items;this.outcomes=outcomes;}async claimNext(){return this.items[this.claims++]??null;}async finalize(){return (this.outcomes.shift()??"in_sync") as ReconciliationFinalResult;}}
test("claims and processes one item at a time up to batch",async()=>{const repo=new Repo([check("1"),check("2")]);let active=0,max=0;const provider={retrieveSubscription:async()=>{active++;max=Math.max(max,active);await Promise.resolve();active--;return{snapshot:{...snapshot},rateLimitRemaining:10};}};const s=await runBillingReconciliation({runId:"r",batchSize:2,storeId:"10",repository:repo,provider});assert.equal(max,1);assert.equal(s.claimed,2);assert.equal(s.inSync,2);});
test("empty selection ends run",async()=>{
  const result=await runBillingReconciliation({
    runId:"r",batchSize:10,repository:new Repo([]),storeId:"10",
    provider:{retrieveSubscription:async()=>({snapshot:{...snapshot},rateLimitRemaining:null})},
  });
  assert.equal(result.claimed,0);
});
test("configuration error stops before another claim",async()=>{const repo=new Repo([check("1"),check("2")],["configuration_error"]);await runBillingReconciliation({runId:"r",batchSize:10,storeId:"10",repository:repo,provider:{retrieveSubscription:async()=>{throw new BillingReconciliationProviderError("configuration_error","code",true);}}});assert.equal(repo.claims,1);});
test("429 stops before another claim",async()=>{const repo=new Repo([check("1"),check("2")],["retry_scheduled"]);await runBillingReconciliation({runId:"r",batchSize:10,storeId:"10",repository:repo,provider:{retrieveSubscription:async()=>{throw new BillingReconciliationProviderError("provider_unavailable","provider_rate_limited",true);}}});assert.equal(repo.claims,1);});
test("low remaining stops after finalized item",async()=>{const repo=new Repo([check("1"),check("2")]);await runBillingReconciliation({runId:"r",batchSize:10,storeId:"10",repository:repo,provider:{retrieveSubscription:async()=>({snapshot:{...snapshot},rateLimitRemaining:1})}});assert.equal(repo.claims,1);});
test("timeout continues with later items",async()=>{
  const repo=new Repo([check("1"),check("2")],["retry_scheduled","in_sync"]);let calls=0;
  const provider={retrieveSubscription:async()=>{if(calls++===0)throw new BillingReconciliationProviderError("provider_unavailable","provider_timeout",false);return{snapshot:{...snapshot},rateLimitRemaining:null};}};
  const s=await runBillingReconciliation({runId:"r",batchSize:2,storeId:"10",repository:repo,provider});
  assert.equal(s.claimed,2);assert.equal(s.providerUnavailable,1);assert.equal(s.inSync,1);
});
test("finalizer error is sanitized and later claim continues",async()=>{const repo=new Repo([check("1"),check("2")]);let calls=0;repo.finalize=async()=>{if(calls++===0)throw new Error("private");return"in_sync";};const s=await runBillingReconciliation({runId:"r",batchSize:2,storeId:"10",repository:repo,provider:{retrieveSubscription:async()=>({snapshot:{...snapshot},rateLimitRemaining:null})}});assert.equal(s.claimLost,1);assert.equal(s.inSync,1);});
