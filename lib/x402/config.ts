import type { Address } from "viem";

/**
 * x402 payment base — network & settlement configuration.
 *
 * These values are read from the environment when present (deployed setup),
 * falling back to the demo values below. After running
 * `scripts/deploy-x402.mjs`, set:
 *   X402_TOKEN=0x...   X402_PAYTO=0x...   X402_TOKEN_NAME=AgentToken
 */

export const X402_NETWORK = {
  /** CAIP-2 identifier — Monad Mainnet (Monad Metropolis 分支). */
  caip2: "eip155:143" as const,
  chainId: 143,
  name: "Monad",
  rpc: "https://rpc.monad.xyz",
  explorer: "https://monadscan.com",
};

/** Settlement token contract (AgentToken, EIP-3009). */
export const X402_TOKEN_ADDRESS: Address =
  (process.env.X402_TOKEN || "0x000000000000000000000000000000000000dEaD") as Address;

/** Token name used in the EIP-712 domain (must match AgentToken.sol). */
export const X402_TOKEN_NAME = process.env.X402_TOKEN_NAME || "AgentToken";

/** Token decimals — AgentToken mints with 18. */
export const X402_TOKEN_DECIMALS = 18;

/** Payee: the AgentPayments pool that collects + records micropayments.
 *  Demo 模式（未部署时）fallback 到 dead address，保证空 .env 也能跑通演示与 smoke；
 *  部署后由 X402_PAYTO 覆盖为真实收款池地址。 */
export const X402_PAYTO: Address =
  (process.env.X402_PAYTO || "0x000000000000000000000000000000000000dEaD") as Address;

/** Fixed price per agent task, in atomic units (default 0.001 AGT). */
export const X402_AMOUNT = process.env.X402_AMOUNT || "1000000000000000";

/** Whether /api/agent-task serves the resource in demo mode (no on-chain tx). */
export const X402_DEMO = process.env.X402_DEMO !== "false";
