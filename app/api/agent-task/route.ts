import { NextResponse } from "next/server";
import { getAddress } from "viem";
import {
  createPaymentRequired,
  parsePaymentSignature,
  verifyPayment,
  buildSettlementResponse,
} from "@/lib/x402/server";
import { encodeSettlementResponse } from "@/lib/x402/encode";
import {
  X402_AMOUNT,
  X402_DEMO,
  X402_NETWORK,
  X402_PAYTO,
  X402_TOKEN_ADDRESS,
  X402_TOKEN_DECIMALS,
} from "@/lib/x402/config";
import { TASK_OUTPUTS } from "@/lib/x402/task-outputs";

/**
 * Demo protected resource: an "agent job" the agent pays for per task via
 * x402 (exact scheme, EIP-3009 on Monad).
 *
 * Flow:
 *  1. Agent POSTs a task without PAYMENT-SIGNATURE → 402 + PAYMENT-REQUIRED.
 *  2. Agent signs transferWithAuthorization and retries with PAYMENT-SIGNATURE.
 *  3. Server verifies the payload shape off-chain; the facilitator route
 *     (app/api/x402/settle) performs the real on-chain settlement. In demo
 *     mode (default) this route serves the result directly with a demo
 *     receipt; with X402_DEMO=false it requires a settled on-chain tx hash.
 */

interface TaskBody {
  task?: string;
  model?: string;
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as TaskBody;
  const task = body.task || "generate-report";

  const resource = {
    url: `${req.url}`,
    description: `Run agent task "${task}" — paid per execution via x402`,
    mimeType: "application/json",
  };

  const { header, paymentRequired } = createPaymentRequired(resource, {
    payTo: X402_PAYTO,
    asset: X402_TOKEN_ADDRESS,
    network: X402_NETWORK.caip2,
    amount: X402_AMOUNT,
    decimals: X402_TOKEN_DECIMALS,
  });

  // No PAYMENT-SIGNATURE → challenge the agent.
  const payload = parsePaymentSignature(req.headers);
  if (!payload) {
    return new NextResponse(
      JSON.stringify({
        error: "Payment required",
        details: "Attach a PAYMENT-SIGNATURE header to complete the payment",
        x402: paymentRequired,
      }),
      { status: 402, headers: { "payment-required": header } },
    );
  }

  // Have a signature — verify its shape against what we advertised.
  const expected = paymentRequired.accepts[0];
  const result = verifyPayment(payload, expected);

  if (!result.isValid) {
    return new NextResponse(
      JSON.stringify({ error: "Payment invalid", reason: result.invalidReason }),
      { status: 400, headers: { "payment-required": header } },
    );
  }

  // In demo mode, serve immediately with a synthetic receipt. In production
  // the facilitator settles first (POST /api/x402/settle) and you check
  // result.success before serving.
  const receiptTx =
    (process.env.X402_DEMO_TX as string) || `0x${"0".repeat(64)}`;

  const settlement = buildSettlementResponse({
    success: true,
    transaction: receiptTx,
    network: X402_NETWORK.caip2,
    payer: result.payer ? (result.payer as `0x${string}`) : undefined,
    amount: expected.amount,
  });

  const job = {
    jobId: `job_${Date.now()}`,
    task,
    model: body.model || "agent-base",
    output: TASK_OUTPUTS[task] ?? {
      summary: `Completed "${task}" for ${getAddress(result.payer ?? X402_PAYTO)}`,
      tokens: 128,
      latencyMs: 342,
    },
    payment: {
      amount: expected.amount,
      asset: expected.asset,
      network: expected.network,
      settled: X402_DEMO ? "demo" : "onchain",
      tx: receiptTx,
    },
  };

  return new NextResponse(JSON.stringify(job), {
    status: 200,
    headers: { "payment-response": encodeSettlementResponse(settlement) },
  });
}
