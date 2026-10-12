import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const PAYMENTS = (process.env.X402_PAYTO ||
  "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948") as `0x${string}`;

const PAYMENT_RECORDED =
  "PaymentRecorded(bytes32,address,address,uint256,uint64)" as const;
const PAYMENT_REFUNDED = "PaymentRefunded(bytes32,uint256)" as const;

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.X402_RPC_URL || "https://sepolia.base.org"),
    });
    const fromBlock = BigInt(
      process.env.X402_DEPLOY_BLOCK || "47940000",
    );
    const toBlock = await client.getBlockNumber();

    const [recorded, refunded] = await Promise.all([
      client.getLogs({
        address: PAYMENTS,
        event: {
          type: "event",
          name: "PaymentRecorded",
          inputs: [
            { type: "bytes32", name: "paymentId", indexed: true },
            { type: "address", name: "payer", indexed: true },
            { type: "address", name: "token", indexed: false },
            { type: "uint256", name: "amount", indexed: false },
            { type: "uint64", name: "timestamp", indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      }),
      client.getLogs({
        address: PAYMENTS,
        event: {
          type: "event",
          name: "PaymentRefunded",
          inputs: [
            { type: "bytes32", name: "paymentId", indexed: true },
            { type: "uint256", name: "amount", indexed: false },
          ],
        },
        fromBlock,
        toBlock,
      }),
    ]);

    const refundedIds = new Set(
      refunded.map((l) => (l.args.paymentId as string).toLowerCase()),
    );

    const entries = recorded.map((l) => {
      const pid = (l.args.paymentId as string) || "";
      return {
        paymentId: pid,
        payer: (l.args.payer as string) || "",
        token: (l.args.token as string) || "",
        amount: (l.args.amount as bigint)?.toString() || "0",
        timestamp: Number(l.args.timestamp || 0),
        refunded: refundedIds.has(pid.toLowerCase()),
        tx: l.transactionHash,
      };
    });

    return NextResponse.json({
      ok: true,
      pool: PAYMENTS,
      count: entries.length,
      entries,
      latestBlock: toBlock.toString(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
