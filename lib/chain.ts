import { defineChain } from "@avakit/core";

/**
 * Base Sepolia (chainId 84532) — Colosseum 版本的主网配置。
 * Avalanche Fuji 版本在 master 分支（评限期冻结）；本分支为 Base 版。
 */
export const baseSepolia = defineChain({
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  explorerUrl: "https://sepolia.basescan.org",
  nativeCurrency: { name: "Base", symbol: "ETH", decimals: 18 },
  testnet: true,
});
