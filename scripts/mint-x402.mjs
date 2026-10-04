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
// MONAD_TESTNET=1 → Monad Testnet (chainId 10143); default = Monad Mainnet (143).
const IS_TESTNET = process.env.MONAD_TESTNET === "1";
const MONAD_RPC = IS_TESTNET ? "https://testnet-rpc.monad.xyz" : "https://rpc.monad.xyz";
const MONAD_CHAIN = {
  id: IS_TESTNET ? 10143 : 143,
  name: IS_TESTNET ? "Monad Testnet" : "Monad",
  rpcUrl: MONAD_RPC,
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
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

const chain = toViemChain(MONAD_CHAIN);
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain, transport: http(MONAD_RPC) });
const walletClient = createWalletClient({ chain, transport: http(MONAD_RPC), account });

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
