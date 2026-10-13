// Quick refund script — calls AgentPayments.refund(paymentId) on Monad Testnet.
// Usage: DEPLOYER_PRIVATE_KEY=0x... node scripts/refund-once.mjs <paymentId>
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, createWalletClient, defineChain, http, parseAbi } from "viem";

const PAYMENTS = process.env.X402_PAYTO || "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
const PAYMENT_ID = process.argv[2];

if (!process.env.DEPLOYER_PRIVATE_KEY) {
  console.error("Set DEPLOYER_PRIVATE_KEY env var first.");
  process.exit(1);
}
if (!PAYMENT_ID) {
  console.error("Usage: DEPLOYER_PRIVATE_KEY=0x... node scripts/refund-once.mjs <paymentId>");
  process.exit(1);
}

const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://monad-testnet.drpc.org"] } },
});

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: monadTestnet, transport: http() });
const walletClient = createWalletClient({ chain: monadTestnet, transport: http(), account });

const ABI = parseAbi(["function refund(bytes32 paymentId)"]);

const hash = await walletClient.writeContract({
  address: PAYMENTS,
  abi: ABI,
  functionName: "refund",
  args: [PAYMENT_ID],
});
console.log("refund tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("status:", receipt.status, "block:", receipt.blockNumber, "logs:", receipt.logs.length);
console.log(`explorer: https://testnet.monadexplorer.com/tx/${hash}`);
