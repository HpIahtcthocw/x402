import { NextResponse } from "next/server";
import { createPublicClient, http, type AbiEvent } from "viem";
import { toViemChain } from "@avakit/core";
import { monadTestnet } from "@/lib/chain";
import { X402_NETWORK, X402_PAYTO, X402_DEPLOY_BLOCK } from "@/lib/x402/config";

const PAYMENTS = X402_PAYTO as `0x${string}`;

/**
 * Envio HyperRPC — the read-only JSON-RPC built on HyperSync, used as the data
 * source for our core feature: the on-chain receipt ledger. Every row below is a
 * real `PaymentRecorded` log; the ledger IS the product, so it streams the whole
 * history from Envio in a single call instead of walking a rate-limited node.
 *
 * Envio needs the API token appended to the endpoint URL
 * (https://docs.envio.dev/docs/HyperRPC/hyperrpc-supported-networks).
 */
const ENVIO_HYPERRPC = "https://monad-testnet.rpc.hypersync.xyz";
const ENVIO_TOKEN = process.env.ENVIO_API_TOKEN;

const RPC_URL = process.env.X402_LEDGER_RPC_URL || (ENVIO_TOKEN ? `${ENVIO_HYPERRPC}/${ENVIO_TOKEN}` : X402_NETWORK.rpc);

/**
 * Free public nodes cap `eth_getLogs` (thirdweb: 1000 blocks) and rate-limit
 * bursts, so without an Envio token we scan a recent window in 1000-block
 * chunks, both events in one call (OR topics) and paced to stay under the limit.
 */
// Envio HyperRPC on Monad also caps eth_getLogs at 100 blocks per call,
// so we always scan a recent window in small chunks.
const CHUNK = 1000n;
const RECENT_WINDOW = 30_000n;
const PACE_MS = 150;

const PAYMENT_RECORDED: AbiEvent = {
  type: "event",
  name: "PaymentRecorded",
  inputs: [
    { type: "bytes32", name: "paymentId", indexed: true },
    { type: "address", name: "payer", indexed: true },
    { type: "address", name: "token", indexed: false },
    { type: "uint256", name: "amount", indexed: false },
    { type: "uint64", name: "timestamp", indexed: false },
  ],
};

const PAYMENT_REFUNDED: AbiEvent = {
  type: "event",
  name: "PaymentRefunded",
  inputs: [
    { type: "bytes32", name: "paymentId", indexed: true },
    { type: "uint256", name: "amount", indexed: false },
  ],
};

/** Decoded log shapes (kept explicit so the OR-topic pass can be typed). */
type PaymentRecordedLog = {
  eventName?: string;
  transactionHash: string | null;
  args: { paymentId: string; payer: string; token: string; amount: bigint; timestamp: bigint };
};
type PaymentRefundedLog = {
  transactionHash: string | null;
  args: { paymentId: string; amount: bigint };
};

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const client = createPublicClient({
      chain: toViemChain(monadTestnet),
      transport: http(RPC_URL),
    });
    const deployBlock = BigInt(X402_DEPLOY_BLOCK);
    const toBlock = await client.getBlockNumber();
    // Always scan a recent window — Envio on Monad doesn't support large ranges.
    const fromBlock = toBlock - RECENT_WINDOW > deployBlock
      ? toBlock - RECENT_WINDOW
      : deployBlock;

    /** Free RPCs answer `-32029 Too Many Requests` on bursts; back off + retry. */
    async function getLogsPaced(params: Parameters<typeof client.getLogs>[0]) {
      for (let attempt = 0; ; attempt++) {
        try {
          return await client.getLogs(params);
        } catch (e) {
          const msg = (e as Error).message ?? "";
          if (attempt < 5 && /429|too many requests|rate limit/i.test(msg)) {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          throw e;
        }
      }
    }

    async function scan(event: AbiEvent) {
      const logs: Awaited<ReturnType<typeof client.getLogs>> = [];
      for (let start = fromBlock; start <= toBlock; start += CHUNK) {
        const end = start + CHUNK - 1n < toBlock ? start + CHUNK - 1n : toBlock;
        logs.push(...(await getLogsPaced({ address: PAYMENTS, event, fromBlock: start, toBlock: end })));
        if (PACE_MS) await new Promise((r) => setTimeout(r, PACE_MS));
      }
      return logs;
    }

    // Both events share the same chunk loop (OR topics), so the fallback pays
    // for one pass of block ranges instead of two.
    async function scanBoth() {
      const recorded: PaymentRecordedLog[] = [];
      const refunded: PaymentRefundedLog[] = [];
      const events = [PAYMENT_RECORDED, PAYMENT_REFUNDED] as const;
      for (let start = fromBlock; start <= toBlock; start += CHUNK) {
        const end = start + CHUNK - 1n < toBlock ? start + CHUNK - 1n : toBlock;
        const chunk = await getLogsPaced({ address: PAYMENTS, events, fromBlock: start, toBlock: end });
        for (const log of chunk) {
          const named = log as unknown as { eventName?: string } & PaymentRecordedLog;
          if (named.eventName === "PaymentRecorded") recorded.push(named);
          else refunded.push(named as unknown as PaymentRefundedLog);
        }
        if (PACE_MS) await new Promise((r) => setTimeout(r, PACE_MS));
      }
      return { recorded, refunded };
    }

    const { recorded, refunded } = await scanBoth();

    const refundedIds = new Set(refunded.map((l) => l.args.paymentId.toLowerCase()));

    const entries = recorded.map((l) => {
      const args = l.args;
      const pid = args.paymentId || "";
      return {
        paymentId: pid,
        payer: args.payer || "",
        token: args.token || "",
        amount: args.amount?.toString() || "0",
        timestamp: Number(args.timestamp || 0),
        refunded: refundedIds.has(pid.toLowerCase()),
        tx: l.transactionHash ?? "",
      };
    });

    return NextResponse.json({
      ok: true,
      pool: PAYMENTS,
      network: X402_NETWORK.caip2,
      explorer: X402_NETWORK.explorer,
      dataSource: ENVIO_TOKEN ? "envio-hyperrpc" : "public-rpc",
      count: entries.length,
      refundedCount: refunded.length,
      entries,
      scannedFrom: fromBlock.toString(),
      latestBlock: toBlock.toString(),
      deployBlock: deployBlock.toString(),
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
