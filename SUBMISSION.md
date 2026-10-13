# Monad Metropolis — Submission Copy

> Trust, Identity & AI Infrastructure · 直接粘进提交表单

## Problem Statement

AI agents are starting to transact autonomously — calling paid APIs thousands of times a day. x402 (the Linux Foundation standard, backed by Visa / Stripe / AWS) solved *how* an agent pays with a gasless EIP-3009 signature. But the receiving side is still unsolved: providers get raw transfers — no per-payment record, no receipt, and no refund trail. Finance teams cannot audit what an autonomous agent actually bought.

## Technical Approach

We implement the official x402 v2 protocol (exact scheme, EIP-3009 `transferWithAuthorization`) end-to-end on Monad Testnet (`eip155:10143`): 402 challenge → client signs an authorization → facilitator verifies off-chain and settles on-chain. On the receiving side we add `AgentPayments`, a settlement ledger: every payment is booked under a stable `paymentId` (payer / amount / token / timestamp), with an on-chain refund path and nonce-based replay protection. Two decisions make it **auditable, not trusted**:

- the **receipt is contract state** — each ledger row is read back from `AgentPayments.settlements(paymentId)`, not from our database;
- the **refund is a contract method** — `AgentPayments.refund()` is owner-authorized and moves value back to the original payer.

The on-chain read layer is powered by **Envio HyperRPC**, and the payment flow is exposed as an **agent wallet / MCP tool** so a headless agent can run the full loop autonomously: no LLM, no browser extension, no gas. A second door speaks **A2A** (`agent-card` / `task` / `message`, Google's a2a-x402 v0.2 Standalone Flow) so another agent can discover the metered APIs and pay per call without bespoke glue.

**Payer identity is verified, not merely declared.** The paying wallet signs an EIP-191 attestation over its own address; the merchant verifies the signature server-side and reports two separate facts on the receipt — `verified` (is the signature real) and `trust` (`allowlisted` / `self-attested` / `untrusted`, by attester allowlist). Settlement never depends on it, so identity is additive evidence rather than a gate.

## Built with Qwen (Alibaba Cloud Model Studio)

One metered resource is a **real vendor-billed API**, not a stub: `inference:tiny` proxies **Qwen 3.8 Max** over the Alibaba Cloud Model Studio OpenAI-compatible endpoint. The agent pays per call in x402, the facilitator settles on-chain, and the receipt is booked — proving the gateway meters a genuine third-party paid model, not a mock. It is env-gated on `DASHSCOPE_API_KEY` and reports `outputMode: "unconfigured"` (never a fake success) until the key is set.

## Built with Kimi (Moonshot AI)

A second metered resource, `inference:kimi`, proxies **Kimi** over the Moonshot AI OpenAI-compatible endpoint — the same x402 loop, a different billed vendor. It shows the meter is provider-agnostic: one gateway, two paid upstreams, and each receipt names which vendor served the call. Env-gated on `MOONSHOT_API_KEY`, it reports `outputMode: "unconfigured"` until the key is set.

## Six-week increment

The hackathon window is 2026-09-01 → 2026-10-13. Pre-existing baseline carried in: the x402 v2 protocol core (`lib/x402/`), the two contracts, and the burner smoke test. Built **within** the window: the on-chain receipt ledger read over Envio HyperRPC (with public-RPC fallback); the owner-authorized refund path and its UI; the A2A surface (`agent-card` / `task` / `message/send`) and its durable task store; the verifiable payer-identity attestation; the Qwen- and Kimi-metered resources; the unattended headless payer; the spend-analytics view and the CSV reconciliation export.

## Target Audience

Two sides: (1) **API providers** who want to meter agent traffic per-request without signup, API keys, or cards — one line to 402-gate any endpoint; (2) **agent builders / ops teams** who need an auditable spend trail for autonomous agents. Secondary: finance & compliance teams that must reconcile machine-initiated spend.

## Business Model

Free, MIT-licensed reference implementation and self-hostable gateway. Monetization is a hosted settlement + ledger service for providers: usage-based fee on settled volume, plus a reconciliation / export dashboard. The open core drives adoption; the hosted ledger (batch settlement, refund workflows, audit export) is the paid tier.

## Competitive Landscape

Earlier work proved the category on other chains: Corbits (Solana) for merchant dashboards, Glassbox402 (Hedera) for x402 analytics. We bring the receipt-and-refund layer to **Monad** — and we make the receipt a **contract primitive** (`AgentPayments.refund()`), not a dashboard view. Complementary to the standard, not a competing facilitator.

## Future Vision

As agent-to-agent commerce grows, the entity that owns the *receipt layer* owns trust. Next steps: batch settlement (official `batch-settlement` scheme), the `Payment Identifier` extension for idempotency, an on-chain reputation score derived from verified settlement history, and multi-chain settlement.

---

## Verified on-chain evidence (Monad Testnet)

- AgentToken: `0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`
- AgentPayments: `0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`
- faucet mint (AgentToken.mint): `0x63305b4b329da54ae686d09b6b311f9f7302bcfb971076aa7a249acce968b8fe`
- settle (transferWithAuthorization): `0x73ca354d98519ff3886a3530c007b74e6ac713ae2c53cbac7aa543d944aa4b33`
- record (PaymentRecorded): `0xa6a3c1581251e894de3ad59c01910d0c5365cd6574047e4e454703199a62e59d`
- refund (PaymentRefunded): `0xd8c1c03309a34ec9998370605ccb2f96f3e820980268554d0471490b8353317c`
- replay: re-submitting the same authorization reverts (`AgentToken: authorization already used`)
- Explorer: https://testnet.monadexplorer.com
- GitHub: https://github.com/HpIahtcthocw/x402
- Live demo: https://x402-agent-gateway.vercel.app
