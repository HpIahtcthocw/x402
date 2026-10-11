// Quick refund script — calls AgentPayments.refund(paymentId)
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const PAYMENTS = "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
const PAYMENT_ID = process.argv[2];

const account = privateKeyToAccount(process.env.DEPLOYER_PRIVATE_KEY);
const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
const walletClient = createWalletClient({ chain: baseSepolia, transport: http(), account });

const ABI = [
  {
    type: "function",
    name: "refund",
    stateMutability: "nonpayable",
    inputs: [{ name: "paymentId", type: "bytes32" }],
    outputs: [],
  },
];

const hash = await walletClient.writeContract({
  address: PAYMENTS,
  abi: ABI,
  functionName: "refund",
  args: [PAYMENT_ID],
});
console.log("refund tx:", hash);
const receipt = await publicClient.waitForTransactionReceipt({ hash });
console.log("status:", receipt.status);
console.log("block:", receipt.blockNumber);
