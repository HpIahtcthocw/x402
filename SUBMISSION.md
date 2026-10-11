# Colosseum Crypto World's Fair — Submission Copy

> Base Track · 直接粘进提交表单

## Problem Statement

AI agents are starting to transact autonomously — calling paid APIs thousands of times a day. x402 (the Linux Foundation standard, backed by Visa / Stripe / AWS) solved *how* an agent pays with a gasless EIP-3009 signature. But nobody solved *reconciliation*: when an agent spends across thousands of micro-payments, there is no receipt, no per-payment record, and no refund trail. Finance teams cannot audit what an autonomous agent actually bought.

## Technical Approach

We implement the official x402 v2 protocol (exact scheme, EIP-3009 `transferWithAuthorization`) end-to-end on Base Sepolia: 402 challenge → client signs an authorization → facilitator verifies off-chain and settles on-chain. On the receiving side we add `AgentPayments`, a settlement ledger: every payment is booked under a stable `paymentId` (payer / amount / token / timestamp) via `PaymentRecorded`, enabling progressive reconciliation, owner-authorized refunds, and nonce-based replay protection. A headless agent client — drivable as an MCP tool — runs the full loop autonomously: no LLM, no browser extension, no gas.

## Target Audience

Two sides: (1) **API providers** who want to meter agent traffic per-request without signup, API keys, or cards — one line to 402-gate any endpoint; (2) **agent builders / ops teams** who need an auditable spend trail for autonomous agents. Secondary: finance & compliance teams that must reconcile machine-initiated spend.

## Business Model

Free, MIT-licensed reference implementation and self-hostable gateway. Monetization is a hosted settlement + ledger service for providers: usage-based fee on settled volume, plus a reconciliation / export dashboard. The open core drives adoption; the hosted ledger (batch settlement, refund workflows, audit export) is the paid tier.

## Competitive Landscape

Earlier work proved the category on other chains: Corbits (Solana) for merchant dashboards, Glassbox402 (Hedera) for x402 analytics. We bring the receipt-and-refund layer to **Base + USDC**, the largest x402 settlement venue — and we make the receipt a **contract primitive** (`AgentPayments.refund()`), not a dashboard view. Complementary to the standard, not a competing facilitator.

## Future Vision

As agent-to-agent commerce grows, the entity that owns the *receipt layer* owns trust. Next steps: batch settlement (official `batch-settlement` scheme), the `Payment Identifier` extension for idempotency, an on-chain reputation score derived from verified settlement history, and multi-chain settlement (Base first).

---

## Verified on-chain evidence (Base Sepolia)

- AgentToken: `0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`
- AgentPayments: `0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`
- Sample settle tx (transferWithAuthorization): `0x5300c0f777e52b3bacb979223b6aa7c7d94dbbab6b36c1f2f807f0644228145b`
- Sample record tx (PaymentRecorded event): `0xb2e54660bc244dc875a3e3b3183ab742b549535f2d981d770aaeb580e10f962c`
- GitHub: https://github.com/HpIahtcthocw/x402/tree/colosseum
- Live demo: https://avalanche-agent-mu.vercel.app
