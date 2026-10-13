import { NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toViemChain } from "@avakit/core";
import { monadTestnet } from "@/lib/chain";
import { X402_NETWORK, X402_PAYTO } from "@/lib/x402/config";

const PAYMENTS = X402_PAYTO as `0x${string}`;

const ABI = [
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [],
  },
] as const;

export const dynamic = "force-dynamic";

/**
 * Owner-authorized refund. `AgentPayments.refund()` is `onlyOwner`, so the
 * browser can never call it directly — this route signs with the deployer key
 * and returns the second on-chain transaction (`PaymentRefunded`).
 */
export async function POST(req: Request) {
  try {
    const { paymentId } = (await req.json()) as { paymentId: `0x${string}` };
    if (!paymentId || !paymentId.startsWith("0x") || paymentId.length !== 66) {
      return NextResponse.json(
        { ok: false, error: "invalid paymentId" },
        { status: 400 },
      );
    }
    const pk = (process.env.X402_DEPLOYER_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY) as `0x${string}` | undefined;
    if (!pk) {
      return NextResponse.json(
        { ok: false, error: "DEPLOYER_PRIVATE_KEY not set" },
        { status: 500 },
      );
    }
    const account = privateKeyToAccount(pk);
    const chain = toViemChain(monadTestnet);
    const transport = http(process.env.X402_RPC_URL || X402_NETWORK.rpc);
    const wallet = createWalletClient({ chain, transport, account });
    const publicClient = createPublicClient({ chain, transport });
    const hash = await wallet.writeContract({
      address: PAYMENTS,
      abi: ABI,
      functionName: "refund",
      args: [paymentId],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return NextResponse.json({ ok: true, tx: hash });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
