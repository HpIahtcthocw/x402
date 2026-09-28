import { NextResponse } from "next/server";
import { verifyPayment } from "@/lib/x402/server";
import type { PaymentPayload, PaymentRequirements } from "@/lib/x402/types";

/**
 * Facilitator: POST /api/x402/verify
 * Off-chain verification of a payment payload, per the x402 V2 spec
 * (facilitator interface §7.1). No on-chain side effects.
 */
export async function POST(req: Request) {
  let parsed: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json({ isValid: false, invalidReason: "Invalid JSON body" }, { status: 400 });
  }

  const result = verifyPayment(parsed.paymentPayload, parsed.paymentRequirements);
  return NextResponse.json(result, { status: result.isValid ? 200 : 422 });
}
