import { NextResponse } from "next/server";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "@/lib/chain";
import { toViemChain } from "@avakit/core";
import { X402_NETWORK, X402_TOKEN_ADDRESS, X402_DEMO } from "@/lib/x402/config";

/**
 * Faucet: POST /api/faucet  { address }
 *
 * Mints 1 AGT (testnet settlement token) to the requesting wallet so anyone
 * can try the real x402 payment loop with their own wallet. Owner-only mint
 * on AgentToken; the facilitator key pays gas.
 *
 * - Demo mode (default): returns a mock receipt, no on-chain tx.
 * - Production mode (X402_DEMO=false): broadcasts a real mint tx on Base
 *   Sepolia and returns the transaction hash.
 */
export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const to = body.address;
  if (!to || !isAddress(to)) {
    return NextResponse.json({ ok: false, error: "A valid EVM address is required" }, { status: 400 });
  }

  const privateKey = process.env.X402_DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined;
  const isDemo = X402_DEMO;
  if (!isDemo && (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey))) {
    return NextResponse.json(
      { ok: false, error: "Facilitator key not configured (X402_DEPLOYER_PRIVATE_KEY)" },
      { status: 500 },
    );
  }

  if (isDemo) {
    return NextResponse.json({
      ok: true,
      demo: true,
      amount: "1",
      asset: X402_TOKEN_ADDRESS,
      network: X402_NETWORK.caip2,
      message: "Demo mode — 1 AGT credited (mock). Set X402_DEMO=false for a real on-chain mint.",
    });
  }

  const chain = toViemChain(baseSepolia);
  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http() });
  const walletClient = createWalletClient({ chain, transport: http(), account });

  try {
    const amount = parseUnits("1", 18);
    const hash = await walletClient.writeContract({
      address: X402_TOKEN_ADDRESS,
      abi: parseAbi(["function mint(address to, uint256 value)"]),
      functionName: "mint",
      args: [to, amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
    return NextResponse.json({
      ok: true,
      demo: false,
      amount: "1",
      asset: X402_TOKEN_ADDRESS,
      network: X402_NETWORK.caip2,
      tx: hash,
      explorer: `${X402_NETWORK.explorer}/tx/${hash}`,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `Mint failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 500 },
    );
  }
}
