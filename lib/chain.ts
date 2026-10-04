import { defineChain } from "@avakit/core";

/**
 * Monad Mainnet (chainId 143) — Monad Metropolis 黑客松版本的主网配置。
 * Avalanche Fuji 版在 master 分支（评限期冻结）；Base 版在 colosseum 分支。
 * 测试网为 chainId 10143（https://testnet-rpc.monad.xyz），部署脚本用
 * MONAD_TESTNET=1 切换。
 */
export const monadMainnet = defineChain({
  id: 143,
  name: "Monad",
  rpcUrl: "https://rpc.monad.xyz",
  explorerUrl: "https://monadscan.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  testnet: false,
});
