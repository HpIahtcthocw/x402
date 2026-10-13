import { defineChain } from "@avakit/core";

/**
 * Monad (chainId 143) — Monad Metropolis hackathon.
 * Base Sepolia version lives on colosseum branch; Avalanche Fuji on master.
 */
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  rpcUrl: "https://rpc.monad.xyz",
  explorerUrl: "https://monadscan.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  testnet: false,
});
