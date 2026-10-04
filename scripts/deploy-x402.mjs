// Deploy the x402 settlement stack to Monad (Monad Metropolis 分支):
//   1. AgentToken  — EIP-3009 ERC-20 (settlement asset)
//   2. AgentPayments — pool that records + holds micropayments
//
//   DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-x402.mjs
//
// The key stays in your shell environment; never written to disk. After
// deployment it prints the addresses you must paste into lib/x402/config.ts
// (and env X402_TOKEN / X402_PAYTO).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createPublicClient, createWalletClient, http } from "viem";
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
if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
  console.error(
    "\nDEPLOYER_PRIVATE_KEY is not set (or not a 0x-prefixed 32-byte hex key).\n\n" +
      "Fund a throwaway wallet with MON (Monad faucet: https://faucet.monad.xyz), then:\n\n" +
      "  DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-x402.mjs\n",
  );
  process.exit(1);
}

const chain = toViemChain(MONAD_CHAIN);
const account = privateKeyToAccount(key);
const publicClient = createPublicClient({ chain, transport: http(MONAD_RPC) });
const walletClient = createWalletClient({ chain, transport: http(MONAD_RPC), account });

const artifact = (name) => JSON.parse(
  readFileSync(join(root, "scripts", "artifacts", `${name}.json`), "utf8"),
);

async function deploy(name, args = []) {
  const { abi, bytecode } = artifact(name);
  console.log(`\nDeploying ${name}…`);
  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress) throw new Error(`${name}: no contract address`);
  console.log(`  ${name} → ${receipt.contractAddress} (tx ${hash})`);
  return receipt.contractAddress;
}

async function main() {
  const owner = account.address;
  console.log(`Deployer: ${owner}\n`);

  const token = await deploy("AgentToken", ["AgentToken", "AGT"]);
  const pool = await deploy("AgentPayments", []);

  console.log(`\n===== DEPLOYED (${MONAD_CHAIN.name}) =====`);
  console.log(`AgentToken:    ${token}`);
  console.log(`AgentPayments: ${pool}`);
  console.log("\nNext steps:");
  console.log(`  1. env: X402_TOKEN=${token}  X402_PAYTO=${pool}  X402_TOKEN_NAME=AgentToken`);
  console.log(`  2. Mint settlement tokens to test wallets: see README (mint script).`);
  console.log(`  3. Update lib/x402/config.ts with the pool address if your app needs it.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
