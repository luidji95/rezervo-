import { NextResponse } from "next/server";
import { processInfobipDeliveryReportBatch } from "@/features/reminders/services/infobipDeliveryReportCore";
import { parseInfobipSmsDeliveryReport } from "@/features/reminders/services/infobipDeliveryReportParser";
import { applyInfobipDeliveryReport } from "@/features/reminders/services/infobipDeliveryReportService";
import { readRequestBodyWithLimit, verifyInfobipWebhookBasicAuth } from "@/features/reminders/services/infobipWebhookHttp";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!verifyInfobipWebhookBasicAuth({
    authorization: request.headers.get("authorization"),
    expectedUsername: process.env.INFOBIP_WEBHOOK_USERNAME,
    expectedPassword: process.env.INFOBIP_WEBHOOK_PASSWORD,
  })) {
    return NextResponse.json({ success: false, code: "UNAUTHORIZED" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ success: false, code: "UNSUPPORTED_CONTENT_TYPE" }, { status: 415 });
  }

  const body = await readRequestBodyWithLimit(request);
  if (!body.ok) return NextResponse.json({ success: false, code: body.code }, { status: 413 });

  let payload: unknown;
  try {
    payload = JSON.parse(body.text);
  } catch {
    return NextResponse.json({ success: false, code: "INVALID_JSON" }, { status: 400 });
  }

  const parsed = parseInfobipSmsDeliveryReport(payload);
  if (!parsed.ok) return NextResponse.json({ success: false, code: parsed.code }, { status: 400 });

  try {
    const result = await processInfobipDeliveryReportBatch({ ...parsed, apply: applyInfobipDeliveryReport });
    return NextResponse.json(result, { status: 200 });
  } catch {
    return NextResponse.json({ success: false, code: "DELIVERY_REPORT_PROCESSING_FAILED" }, { status: 500 });
  }
}
