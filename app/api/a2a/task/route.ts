import { NextResponse } from "next/server";
import { createPaymentRequired } from "@/lib/x402/server";
import {
  X402_AMOUNT,
  X402_DEMO,
  X402_NETWORK,
  X402_PAYTO,
  X402_TOKEN_ADDRESS,
  X402_TOKEN_DECIMALS,
} from "@/lib/x402/config";
import { saveTask } from "@/lib/x402/a2a-store";

/**
 * A2A x402 — Step 1: Payment Request (Merchant → Client).
 *
 * Standalone Flow (spec v0.2):
 *  - task.status.state = "input-required"
 *  - status.message.metadata["x402.payment.status"] = "payment-required"
 *  - status.message.metadata["x402.payment.required"] = { x402Version, accepts[] }
 *
 * The merchant stores the advertised PaymentRequirements keyed by taskId so
 * the submission step can validate against the exact terms it offered.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    id?: string;
    task?: string;
  };
  const task = body.task || "buy-order";

  const resource = {
    url: `${req.url}`,
    description: `Run agent task "${task}" — paid per execution via x402`,
    mimeType: "application/json",
  };

  const { paymentRequired } = createPaymentRequired(resource, {
    payTo: X402_PAYTO,
    asset: X402_TOKEN_ADDRESS,
    network: X402_NETWORK.caip2,
    amount: X402_AMOUNT,
    decimals: X402_TOKEN_DECIMALS,
  });

  const taskId = `task_${Date.now()}`;
  saveTask(taskId, {
    task,
    requirement: paymentRequired.accepts[0],
    createdAt: Date.now(),
  });

  const result = {
    jsonrpc: "2.0",
    id: body.id ?? `req_${Date.now()}`,
    result: {
      kind: "task",
      id: taskId,
      status: {
        state: "input-required",
        message: {
          kind: "message",
          role: "agent",
          parts: [
            {
              kind: "text",
              text: `Payment is required to run agent task "${task}".`,
            },
          ],
          metadata: {
            "x402.payment.status": "payment-required",
            "x402.payment.required": {
              x402Version: paymentRequired.x402Version,
              accepts: paymentRequired.accepts,
            },
          },
        },
      },
    },
  };

  return NextResponse.json(result, {
    status: 200,
    headers: { "x-x402-mode": X402_DEMO ? "demo" : "onchain" },
  });
}
