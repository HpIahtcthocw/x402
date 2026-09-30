// Mint settlement tokens to a wallet (owner-only, testnet convenience).
//
//   DEPLOYER_PRIVATE_KEY=0x... TOKEN=0x... TO=0x... AMOUNT=100 node scripts/mint-x402.mjs
//
// Defaults: AMOUNT=100 (AGT, 18 decimals → 100 * 1e18).

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toViemChain } from "@avakit/core";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_RPC = "https://sepolia.base.org";
const BASE_CHAIN = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: BASE_RPC,
  nativeCurrency: { name: "Base", symbol: "ETH", decimals: 18 },
};

const key = process.env.DEPLOYER_PRIVATE_KEY;
const token = process.env.TOKEN;
const to = process.env.TO;
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key) || !token || !to) {
  console.error(
    "\nUsage: DEPLOYER_PRIVATE_KEY=0x... TOKEN=0x... TO=0x... AMOUNT=100 node scripts/mint-x402.mjs\n",
  );
  process.exit(1);
}

const chain = toViemChain(BASE_CHAIN);
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain, transport: http(BASE_RPC) });
const walletClient = createWalletClient({ chain, transport: http(BASE_RPC), account });

const abi = parseAbi(["function mint(address to, uint256 value)"]);

const amount = parseUnits(process.env.AMOUNT || "100", 18);

async function main() {
  console.log(`Minting ${amount.toString()} (${process.env.AMOUNT || "100"} AGT) → ${to}`);
  const hash = await walletClient.writeContract({
    address: token,
    abi,
    functionName: "mint",
    args: [to, amount],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`✓ minted — tx ${receipt.transactionHash}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
