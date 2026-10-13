import { NextResponse } from "next/server";
import { createPublicClient, http } from "viem";
import { toViemChain } from "@avakit/core";
import { monadTestnet } from "@/lib/chain";
import { X402_NETWORK, X402_PAYTO } from "@/lib/x402/config";

const PAYMENTS = X402_PAYTO as `0x${string}`;

/**
 * Raw contract read — `AgentPayments.settlements(paymentId)`.
 *
 * The UI shows this verbatim for a ledger row, so a judge can confirm the
 * receipt is contract state (not a dashboard row): payer, token, amount,
 * timestamp and the `refunded` flag all come straight off the chain.
 */
const SETTLEMENTS_ABI = [
  {
    type: "function",
    name: "settlements",
    stateMutability: "view",
    inputs: [{ name: "", type: "bytes32" }],
    outputs: [
      { name: "paymentId", type: "bytes32" },
      { name: "payer", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "timestamp", type: "uint64" },
      { name: "refunded", type: "bool" },
    ],
  },
] as const;

const ENVIO_HYPERRPC = "https://monad-testnet.rpc.hypersync.xyz";
const ENVIO_TOKEN = process.env.ENVIO_API_TOKEN;
const RPC_URL =
  process.env.X402_LEDGER_RPC_URL ||
  (ENVIO_TOKEN ? `${ENVIO_HYPERRPC}/${ENVIO_TOKEN}` : X402_NETWORK.rpc);

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const paymentId = new URL(req.url).searchParams.get("paymentId");
  if (!paymentId || !paymentId.startsWith("0x") || paymentId.length !== 66) {
    return NextResponse.json({ ok: false, error: "invalid paymentId" }, { status: 400 });
  }
  try {
    const client = createPublicClient({
      chain: toViemChain(monadTestnet),
      transport: http(RPC_URL),
    });
    const raw = await client.readContract({
      address: PAYMENTS,
      abi: SETTLEMENTS_ABI,
      functionName: "settlements",
      args: [paymentId as `0x${string}`],
    });
    const [pid, payer, token, amount, timestamp, refunded] = raw as readonly [
      `0x${string}`,
      `0x${string}`,
      `0x${string}`,
      bigint,
      bigint,
      boolean,
    ];
    return NextResponse.json({
      ok: true,
      contract: PAYMENTS,
      explorer: X402_NETWORK.explorer,
      raw: {
        payment_id: pid,
        payer,
        token,
        amount: amount.toString(),
        timestamp: Number(timestamp),
        refunded,
      },
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
