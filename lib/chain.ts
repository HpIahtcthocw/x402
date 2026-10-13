import { defineChain } from "@avakit/core";

/**
 * Monad Testnet (chainId 10143) — Monad Metropolis hackathon.
 * Base Sepolia version lives on colosseum branch; Avalanche Fuji on master.
 */
export const monadMainnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  rpcUrl: "https://testnet-rpc.monad.xyz",
  explorerUrl: "https://testnet.monadexplorer.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  testnet: true,
});
