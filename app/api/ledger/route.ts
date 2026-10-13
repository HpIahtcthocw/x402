import { NextResponse } from "next/server";
import { createPublicClient, http, type AbiEvent } from "viem";
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
      transport: http(process.env.X402_LEDGER_RPC_URL || "https://base-sepolia-rpc.publicnode.com"),
    });
    const fromBlock = BigInt(
      process.env.X402_DEPLOY_BLOCK || "47940000",
    );
    const toBlock = await client.getBlockNumber();

    // PublicNode accepts at most 50,000 blocks per eth_getLogs request.
    async function scan(event: AbiEvent) {
      const logs: Awaited<ReturnType<typeof client.getLogs>> = [];
      for (let start = fromBlock; start <= toBlock; start += 50000n) {
        const end = start + 49999n < toBlock ? start + 49999n : toBlock;
        logs.push(...await client.getLogs({ address: PAYMENTS, event, fromBlock: start, toBlock: end }));
      }
      return logs;
    }

    const [recorded, refunded] = await Promise.all([
      scan({
          type: "event",
          name: "PaymentRecorded",
          inputs: [
            { type: "bytes32", name: "paymentId", indexed: true },
            { type: "address", name: "payer", indexed: true },
            { type: "address", name: "token", indexed: false },
            { type: "uint256", name: "amount", indexed: false },
            { type: "uint64", name: "timestamp", indexed: false },
          ],
      }),
      scan({
          type: "event",
          name: "PaymentRefunded",
          inputs: [
            { type: "bytes32", name: "paymentId", indexed: true },
            { type: "uint256", name: "amount", indexed: false },
          ],
      }),
    ]);

    const refundedIds = new Set(
      refunded.map((l) => ((l as unknown as { args: { paymentId: string } }).args.paymentId).toLowerCase()),
    );

    const entries = recorded.map((l) => {
      const args = (l as unknown as { args: { paymentId: string; payer: string; token: string; amount: bigint; timestamp: bigint } }).args;
      const pid = args.paymentId || "";
      return {
        paymentId: pid,
        payer: args.payer || "",
        token: args.token || "",
        amount: args.amount?.toString() || "0",
        timestamp: Number(args.timestamp || 0),
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
