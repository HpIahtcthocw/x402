import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "@/lib/chain";
import { toViemChain } from "@avakit/core";
import { settleExact } from "@/lib/x402/facilitator";
import { X402_NETWORK, X402_TOKEN_ADDRESS, X402_TOKEN_NAME } from "@/lib/x402/config";
import type { PaymentPayload, PaymentRequirements } from "@/lib/x402/types";

/**
 * Facilitator: POST /api/x402/settle
 * Settles an exact/EVM payment on-chain by broadcasting the agent's EIP-3009
 * transferWithAuthorization. The agent signed gasless; the facilitator (this
 * server) pays the gas and forwards the tokens to the AgentPayments pool
 * (X402_PAYTO — set it to the pool address after deployment).
 *
 * Requires env config:
 *   X402_DEPLOYER_PRIVATE_KEY — facilitator wallet that pays gas
 *   X402_TOKEN               — AgentToken address on Base Sepolia
 *   X402_TOKEN_NAME          — token name for the EIP-712 domain (default AgentToken)
 *
 * Returns the PAYMENT-RESPONSE-compatible SettlementResponse.
 */
export async function POST(req: Request) {
  const privateKey = process.env.X402_DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;

  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    return NextResponse.json(
      {
        success: false,
        errorReason: "X402_DEPLOYER_PRIVATE_KEY not set — configure the facilitator wallet",
        transaction: "",
        network: X402_NETWORK.caip2,
      },
      { status: 500 },
    );
  }

  let parsed: { paymentPayload: PaymentPayload; paymentRequirements: PaymentRequirements };
  try {
    parsed = await req.json();
  } catch {
    return NextResponse.json(
      {
        success: false,
        errorReason: "Invalid JSON body",
        transaction: "",
        network: X402_NETWORK.caip2,
      },
      { status: 400 },
    );
  }

  if (parsed.paymentRequirements.network !== X402_NETWORK.caip2) {
    return NextResponse.json(
      {
        success: false,
        errorReason: `Unsupported network — settle on ${X402_NETWORK.caip2}`,
        transaction: "",
        network: parsed.paymentRequirements.network,
      },
      { status: 422 },
    );
  }

  const chain = toViemChain(baseSepolia);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({
    chain,
    transport: http(),
    account: privateKeyToAccount(privateKey),
  });

  const result = await settleExact(
    { publicClient, walletClient },
    {
      paymentPayload: parsed.paymentPayload,
      paymentRequirements: parsed.paymentRequirements,
      tokenAddress: X402_TOKEN_ADDRESS,
      tokenName: X402_TOKEN_NAME,
      chainId: X402_NETWORK.chainId,
    },
  );

  return NextResponse.json(result, { status: result.success ? 200 : 422 });
}
