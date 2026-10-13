import { defineChain } from "@avakit/core";

/**
 * Monad Testnet (chainId 10143) — where the AgentToken / AgentPayments
 * settlement stack is deployed.
 *
 * Monad mainnet (143) has no deployment yet, so everything defaults here.
 */
export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  rpcUrl: "https://10143.rpc.thirdweb.com",
  explorerUrl: "https://testnet.monadexplorer.com",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  testnet: true,
});
