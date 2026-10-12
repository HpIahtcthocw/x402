# Colosseum Crypto World's Fair — Submission Copy

> Base Track · 直接粘进提交表单

## Problem Statement

AI agents are starting to transact autonomously — calling paid APIs thousands of times a day. x402 (the Linux Foundation standard, backed by Visa / Stripe / AWS) solved *how* an agent pays with a gasless EIP-3009 signature. But the receiving side is still unsolved: providers get raw transfers — no per-payment record, no receipt, and no refund trail. Finance teams cannot audit what an autonomous agent actually bought.

## Technical Approach

We implement the official x402 v2 protocol (exact scheme, EIP-3009 `transferWithAuthorization`) end-to-end on Base Sepolia: 402 challenge → client signs an authorization → facilitator verifies off-chain and settles on-chain. On the receiving side we add `AgentPayments`, a settlement ledger: every payment is booked under a stable `paymentId` (payer / amount / token / timestamp), with an on-chain refund path via `PaymentRecorded`, enabling progressive reconciliation, owner-authorized refunds, and nonce-based replay protection. A headless agent client — drivable as an MCP tool — runs the full loop autonomously: no LLM, no browser extension, no gas.

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
- settle #1 (transferWithAuthorization): `0x5300c0f777e52b3bacb979223b6aa7c7d94dbbab6b36c1f2f807f0644228145b`
- settle #2 (transferWithAuthorization): `0x4d46b4d52ab21b758891f2b84d3faf00b66c53b2b0a2ba59e8d151a6134fee40`
- record #1 (PaymentRecorded): `0xb2e54660bc244dc875a3e3b3183ab742b549535f2d981d770aaeb580e10f962c`
- record #2 (PaymentRecorded): `0xe8c3be26c60a2c21f287a79dbf960344cd0c49f5fb1d2e17d7c7051bc2c02edd`
- refund #1 (PaymentRefunded): `0x41bbab6f2cf4377336e2d94b02c92fe4a57377ff83969b6115b976e1aec9fd7c`
- GitHub: https://github.com/HpIahtcthocw/x402/tree/colosseum
- Live demo: https://x402-agent-gateway.vercel.app
