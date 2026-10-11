# The Receipt Layer for x402 — on Base

> **Meter any API for agents on Base — every payment settled on-chain, auditable and refundable.**

**1.** One line to meter any API. **2.** Base, gasless EIP-3009. **3.** Every payment a refundable on-chain receipt.

*No account. No API key. No gas. The agent pays itself.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Live demo

- **Web**: https://avalanche-agent-mu.vercel.app
- **Network**: Base Sepolia (`eip155:84532`)
- **Explorer**: https://sepolia.basescan.org

## Why

AI agents are starting to transact autonomously — calling paid APIs thousands of times a day. x402 (the Linux Foundation standard, backed by Visa / Stripe / AWS) solved *how* an agent pays with a gasless EIP-3009 signature. But nobody solved *reconciliation*: when an agent spends across thousands of micro-payments, there is no receipt, no per-payment record, and no refund trail.

We are the **receipt layer**: every settlement is booked into an on-chain contract with a stable `paymentId` (payer / amount / token / timestamp), enabling batch reconciliation, owner-authorized refunds, and nonce-based replay protection.

## Contracts (Base Sepolia, real bytecode)

| Contract | Address | Purpose |
|---|---|---|
| `AgentToken` | [`0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`](https://sepolia.basescan.org/address/0xdabd72e3e7fb2811115970e0c59279aaa0196cdb) | EIP-3009 ERC-20 (`transferWithAuthorization`) |
| `AgentPayments` | [`0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`](https://sepolia.basescan.org/address/0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948) | On-chain settlement ledger: `PaymentRecorded`, `refund()`, `settlements[paymentId]` |

## How it works

```
agent ──POST /api/agent-task──▶ 402 Payment Required
                                     │
agent ──signs EIP-3009 offline──────▶ (gasless, no wallet extension)
                                     │
agent ──POST /api/x402/settle──────▶ facilitator broadcasts:
                                     │   1) transferWithAuthorization (token moves)
                                     │   2) recordERC20 (books the receipt)
                                     ▼
                          200 OK + tx hash + paymentId
```

**Read `PaymentRecorded` off Base with none of our code in the loop — it matches the dashboard row for row.**

## Run the agent yourself (one command)

```bash
# Fresh burner → faucet mint → 402 → sign → settle → record on-chain
node scripts/burner-e2e-v2.mjs
```

Or drive it from any MCP client (Cursor / Claude Desktop) — see [`scripts/mcp-server.mjs`](scripts/mcp-server.mjs).

## Architecture

```
lib/x402/          # x402 v2 protocol (types, codec, server challenge, client signer, facilitator)
app/api/
  agent-task/      # protected resource (returns 402 unless paid)
  x402/settle/     # facilitator: verify + broadcast transferWithAuthorization + recordERC20
  faucet/          # test-token dispenser (real on-chain mint)
contracts/
  AgentToken.sol   # ERC-20 + EIP-3009
  AgentPayments.sol # on-chain ledger: recordERC20 / refund / withdraw
scripts/
  burner-e2e-v2.mjs  # end-to-end smoke (one command, real tx hashes)
  mcp-server.mjs     # MCP tool: pay_and_call
```

## We implement a standard we don't own

We implement the official x402 v2 spec — we extend a standard we don't own. Earlier work proved the category on other chains (Corbits on Solana, Glassbox402 on Hedera). We bring the receipt-and-refund layer to **Base**, the largest x402 settlement venue — and we make the receipt a **contract primitive** (`AgentPayments.refund()`), not a dashboard view.

## Quickstart

```bash
cp .env.example .env.local
# X402_TOKEN / X402_PAYTO / X402_TOKEN_NAME / X402_AMOUNT / X402_DEPLOYER_PRIVATE_KEY / X402_DEMO=false
npm install
npm run dev
# open http://localhost:3000
```

## License

MIT — see [LICENSE](LICENSE).
