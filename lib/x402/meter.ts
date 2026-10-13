import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toViemChain } from "@avakit/core";
import { monadTestnet } from "@/lib/chain";
import {
  buildSettlementResponse,
  createPaymentRequired,
  parsePaymentSignature,
  verifyPayment,
} from "./server";
import { encodeSettlementResponse } from "./encode";
import { settleExact } from "./facilitator";
import { parseIdentityHeader, verifyIdentityAttestation } from "./identity";
import {
  X402_AMOUNT,
  X402_DEMO,
  X402_NETWORK,
  X402_PAYTO,
  X402_TOKEN_ADDRESS,
  X402_TOKEN_DECIMALS,
  X402_TOKEN_NAME,
} from "./config";
import type { Caip2ChainId } from "./types";

/**
 * `meter(handler, { name })` — gate any JSON endpoint behind an x402 payment.
 *
 * The whole payment loop lives here so a resource server only writes the
 * business handler:
 *
 *   export const POST = meter(async () => ({ pair: "BTC/USD", price: 118420.5 }),
 *                             { name: "quote:BTC" });
 *
 * Behaviour mirrors `app/api/agent-task/route.ts`:
 *   1. no PAYMENT-SIGNATURE            → 402 + PAYMENT-REQUIRED
 *   2. signature shape mismatch        → 400 (invalidReason)
 *   3. demo mode                       → serve with a synthetic receipt
 *   4. production (`X402_DEMO=false`)  → settle EIP-3009 on Monad first, and
 *                                        only release the body if it confirms
 */
export function meter<T extends Record<string, unknown>>(
  handler: (
    req: Request,
    ctx: { task: string; body: { task?: string; model?: string; prompt?: string } },
  ) => T | Promise<T>,
  opts: { name: string; price?: string; network?: Caip2ChainId },
) {
  return async function meteredPOST(req: Request): Promise<Response> {
    const body = (await req.json().catch(() => ({}))) as {
      task?: string;
      model?: string;
      prompt?: string;
    };
    const task = body.task || opts.name;

    const resource = {
      url: `${req.url}`,
      description: `${opts.name} — metered per call via x402`,
      mimeType: "application/json",
    };

    const { header, paymentRequired } = createPaymentRequired(resource, {
      payTo: X402_PAYTO,
      asset: X402_TOKEN_ADDRESS,
      network: opts.network ?? X402_NETWORK.caip2,
      amount: opts.price ?? X402_AMOUNT,
      decimals: X402_TOKEN_DECIMALS,
    });

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

    const expected = paymentRequired.accepts[0];
    const result = verifyPayment(payload, expected);
    if (!result.isValid) {
      return new NextResponse(
        JSON.stringify({ error: "Payment invalid", reason: result.invalidReason }),
        { status: 400, headers: { "payment-required": header } },
      );
    }

    let receiptTx = (process.env.X402_DEMO_TX as string) || `0x${"0".repeat(64)}`;
    let settlement = buildSettlementResponse({
      success: true,
      transaction: receiptTx,
      network: X402_NETWORK.caip2,
      payer: result.payer ? (result.payer as `0x${string}`) : undefined,
      amount: expected.amount,
    });

    if (!X402_DEMO) {
      const key = process.env.X402_DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
      if (!key) return NextResponse.json({ reason: "Facilitator not configured" }, { status: 503 });
      const chain = toViemChain(monadTestnet);
      const transport = http(process.env.X402_RPC_URL || X402_NETWORK.rpc);
      settlement = await settleExact(
        {
          publicClient: createPublicClient({ chain, transport }),
          walletClient: createWalletClient({ chain, transport, account: privateKeyToAccount(key) }),
        },
        {
          paymentPayload: payload,
          paymentRequirements: expected,
          tokenAddress: X402_TOKEN_ADDRESS,
          tokenName: X402_TOKEN_NAME,
          chainId: X402_NETWORK.chainId,
        },
      );
      if (!settlement.success) {
        return NextResponse.json({ reason: settlement.errorReason }, { status: 422 });
      }
      receiptTx = settlement.transaction;
    }

    const output = await handler(req, { task, body });

    // Optional payer identity: verified, never required. Absent header → omitted.
    const attestation = parseIdentityHeader(req.headers);
    const identity = attestation
      ? await verifyIdentityAttestation(attestation, X402_NETWORK.chainId)
      : undefined;

    return new NextResponse(
      JSON.stringify({
        ...output,
        payment: {
          amount: expected.amount,
          asset: expected.asset,
          network: expected.network,
          settled: X402_DEMO ? "demo" : "onchain",
          tx: receiptTx,
        },
        ...(identity ? { identity } : {}),
      }),
      { status: 200, headers: { "payment-response": encodeSettlementResponse(settlement) } },
    );
  };
}
