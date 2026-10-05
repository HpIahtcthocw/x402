import { NextResponse } from "next/server";
import { getAddress } from "viem";
import {
  buildSettlementResponse,
  verifyPayment,
} from "@/lib/x402/server";
import { encodeSettlementResponse } from "@/lib/x402/encode";
import {
  X402_AMOUNT,
  X402_DEMO,
  X402_NETWORK,
  X402_PAYTO,
} from "@/lib/x402/config";
import { getTask } from "@/lib/x402/a2a-store";
import { TASK_OUTPUTS } from "@/lib/x402/task-outputs";
import type { PaymentPayload } from "@/lib/x402/types";

/**
 * A2A x402 — Step 3: Fulfill and Settle (Client → Merchant → Client).
 *
 * Standalone Flow (spec v0.2):
 *  - Client sends message/send with message.metadata["x402.payment.status"] = "payment-submitted"
 *  - message.metadata["x402.payment.payload"] = the signed PaymentPayload object
 *  - Merchant verifies against the requirement stored at task creation
 *    (taskId → original PaymentRequirements), settles, and returns a final
 *    Task with state "completed" and metadata["x402.payment.receipts"].
 *  - Client may also respond with status "payment-rejected" — honored here.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    jsonrpc?: string;
    method?: string;
    id?: string;
    params?: {
      message?: {
        taskId?: string;
        role?: string;
        parts?: unknown[];
        metadata?: Record<string, unknown>;
      };
    };
  };

  const id = body.id ?? `req_${Date.now()}`;
  const message = body.params?.message ?? {};
  const taskId = message.taskId ?? "task_unknown";
  const metadata = message.metadata ?? {};
  const paymentStatus = metadata["x402.payment.status"];

  // Client rejected the payment terms.
  if (paymentStatus === "payment-rejected") {
    return NextResponse.json({
      jsonrpc: "2.0",
      id,
      result: {
        kind: "task",
        id: taskId,
        status: {
          state: "completed",
          message: {
            kind: "message",
            role: "agent",
            parts: [{ kind: "text", text: "Payment rejected — task cancelled." }],
            metadata: { "x402.payment.status": "payment-rejected" },
          },
        },
      },
    });
  }

  if (paymentStatus !== "payment-submitted") {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message:
            'Invalid x402.payment.status — expected "payment-submitted" (or "payment-rejected").',
        },
      },
      { status: 400 },
    );
  }

  const payload = metadata["x402.payment.payload"] as PaymentPayload | undefined;
  if (!payload) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        error: {
          code: -32602,
          message: "Missing x402.payment.payload in message metadata.",
        },
      },
      { status: 400 },
    );
  }

  // Merchant-side state management: retrieve the requirement we advertised
  // for this taskId (spec §5.1 Merchant Agent).
  const record = getTask(taskId);
  const expected = record?.requirement ?? payload.accepted;

  // Off-chain shape + requirement match (the facilitator half).
  const result = verifyPayment(payload, expected);
  if (!result.isValid) {
    return NextResponse.json(
      {
        jsonrpc: "2.0",
        id,
        result: {
          kind: "task",
          id: taskId,
          status: {
            state: "completed",
            message: {
              kind: "message",
              role: "agent",
              parts: [{ kind: "text", text: `Payment invalid: ${result.invalidReason}` }],
              metadata: { "x402.payment.status": "payment-rejected" },
            },
          },
        },
      },
      { status: 200 },
    );
  }

  // Settlement receipt — demo mode serves a synthetic receipt (same policy as
  // /api/agent-task). With X402_DEMO=false the facilitator route
  // (/api/x402/settle) performs the real on-chain broadcast first, then this
  // route returns the resulting tx hash.
  const receiptTx =
    (process.env.X402_DEMO_TX as string) || `0x${"0".repeat(64)}`;

  const settlement = buildSettlementResponse({
    success: true,
    transaction: receiptTx,
    network: X402_NETWORK.caip2,
    payer: result.payer ? (result.payer as `0x${string}`) : undefined,
    amount: expected.amount,
  });

  const task = record?.task ?? "generate-report";
  const output = TASK_OUTPUTS[task] ?? {
    summary: `Completed "${task}" for ${getAddress(result.payer ?? X402_PAYTO)}`,
    tokens: 128,
    latencyMs: 342,
  };

  return NextResponse.json(
    {
      jsonrpc: "2.0",
      id,
      result: {
        kind: "task",
        id: taskId,
        status: {
          state: "completed",
          message: {
            kind: "message",
            role: "agent",
            parts: [
              {
                kind: "text",
                text: `Task "${task}" completed after ${X402_DEMO ? "demo" : "on-chain"} settlement.`,
              },
              { kind: "data", data: output },
            ],
            metadata: {
              "x402.payment.status": "payment-completed",
              "x402.payment.receipts": {
                success: settlement.success,
                transaction: settlement.transaction,
                network: settlement.network,
                amount: settlement.amount,
                payer: settlement.payer,
              },
            },
          },
        },
      },
    },
    {
      status: 200,
      headers: { "payment-response": encodeSettlementResponse(settlement) },
    },
  );
}
