import { NextResponse } from "next/server";
import { createWalletClient, createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";

const PAYMENTS = (process.env.X402_PAYTO ||
  "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948") as `0x${string}`;

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

export async function POST(req: Request) {
  try {
    const { paymentId } = (await req.json()) as { paymentId: `0x${string}` };
    if (!paymentId || !paymentId.startsWith("0x") || paymentId.length !== 66) {
      return NextResponse.json(
        { ok: false, error: "invalid paymentId" },
        { status: 400 },
      );
    }
    const pk = process.env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
    if (!pk) {
      return NextResponse.json(
        { ok: false, error: "DEPLOYER_PRIVATE_KEY not set" },
        { status: 500 },
      );
    }
    const account = privateKeyToAccount(pk);
    const wallet = createWalletClient({
      chain: baseSepolia,
      transport: http(process.env.X402_RPC_URL || "https://sepolia.base.org"),
      account,
    });
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.X402_RPC_URL || "https://sepolia.base.org"),
    });
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
