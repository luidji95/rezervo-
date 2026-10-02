import { createDisposableSupabasePostgres } from "./lib/disposable-supabase-postgres.mjs";

const postgres = createDisposableSupabasePostgres("rezervo-b11a-invoice-concurrency");
const call = (payloadHash, fingerprint) => postgres.sql(`
  select outcome from public.ingest_billing_subscription_invoice_evidence_v1(
    'lemonsqueezy','test','subscription_payment_success','subscription-invoices','91001',
    '${payloadHash}','${fingerprint}',true,'91001','3383060','199110','540512',
    'renewal','paid','2026-08-28T10:59:00Z','2026-08-28T11:00:00Z','2026-08-28T11:01:00Z'
  );
`, "parallel invoice evidence");

try {
  await postgres.initialize();
  const outcomes = await Promise.all([
    call("a".repeat(64), "b".repeat(64)),
    call("c".repeat(64), "d".repeat(64)),
  ]);
  if (outcomes.sort().join("|") !== "invoice_evidence_already_recorded|invoice_evidence_recorded") {
    throw new Error(`unexpected concurrent outcomes: ${outcomes.join(",")}`);
  }
  const evidence = await postgres.sql(`
    select concat_ws('|',count(*),count(distinct webhook_event_id))
    from public.billing_webhook_subscription_invoice_facts
    where provider='lemonsqueezy' and environment='test' and provider_invoice_id='91001';
  `, "concurrent evidence assertion");
  if (evidence !== "1|1") throw new Error(`expected one canonical facts row, received ${evidence}`);
  console.log("B11a concurrent same-invoice contract passed on disposable PostgreSQL (one canonical evidence row). ");
} finally {
  postgres.cleanup();
}
