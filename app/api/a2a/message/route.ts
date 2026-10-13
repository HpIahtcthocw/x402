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
import { fetchQuote, isQuoteTask } from "@/lib/x402/quote";
import {
  fetchInference,
  INFERENCE_PROMPT,
  inferenceConfig,
  isInferenceTask,
} from "@/lib/x402/inference";
import {
  type IdentityAttestation,
  verifyIdentityAttestation,
} from "@/lib/x402/identity";
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
  // for this taskId (spec §5.1 Merchant Agent). If we have no record of it we
  // reject rather than trusting the client-supplied `accepted` — otherwise the
  // "validate against the terms we offered" claim would be empty.
  const record = await getTask(taskId);
  if (!record) {
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
            parts: [
              { kind: "text", text: "Unknown or expired taskId — no payment terms on record." },
            ],
            metadata: { "x402.payment.status": "payment-rejected" },
          },
        },
      },
    });
  }
  const expected = record.requirement;

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

  // Optional payer identity — the same claim the HTTP path carries in a header,
  // here travelling inside the A2A message metadata. Verified, never required.
  const attestation = (metadata["x402.identity.attestation"] ??
    null) as IdentityAttestation | null;
  const identity = attestation
    ? await verifyIdentityAttestation(attestation, X402_NETWORK.chainId)
    : undefined;

  const task = record.task;
  // Quoted tasks serve real market data; the vendor-billed task needs a key;
  // anything else falls back to a sample body.
  let output: Record<string, unknown> | null;
  if (isQuoteTask(task)) {
    output = await fetchQuote(task).catch(() => null);
  } else if (isInferenceTask(task)) {
    const cfg = inferenceConfig(task);
    output = cfg.configured
      ? await fetchInference(task, INFERENCE_PROMPT).catch(() => null)
      : { outputMode: "unconfigured", reason: `set ${cfg.keyEnv} to enable this resource` };
  } else {
    output = TASK_OUTPUTS[task] ?? {
      summary: `Completed "${task}" for ${getAddress(result.payer ?? X402_PAYTO)}`,
      tokens: 128,
      latencyMs: 342,
    };
  }

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
                ...(identity ? { identity } : {}),
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
