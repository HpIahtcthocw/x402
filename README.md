# x402 Agent Gateway · Stripe for AI Agents

> **Your AI buys something and pays for it on its own — no account, no API key, no gas, every transaction auditable on-chain.**

A minimal, working **x402 v2 payment gateway for AI Agents**, deployed live on **Base Sepolia**. Agents pay per HTTP request with a gasless EIP-3009 signature; the facilitator broadcasts settlement on-chain. No signup, no API keys, no subscriptions.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Live demo

- **Web**: https://avalanche-agent-mu.vercel.app
- **Network**: Base Sepolia (`eip155:84532`)
- **Explorer**: https://sepolia.basescan.org

Press **"Start burner demo"** — a fresh burner wallet is generated in your browser, funded with test tokens, signs one EIP-3009 authorization, and a real on-chain settlement transaction appears in seconds.

## What just happened (30-second mental model)

```
Agent calls POST /api/agent-task
        │
        ▼
402 Payment Required  ──►  amount, payTo, asset, network
        │
        ▼
Agent signs EIP-3009 transferWithAuthorization  (offline, gasless)
        │
        ▼
POST /api/x402/settle  ──►  facilitator broadcasts on-chain
        │
        ▼
200 OK  +  PAYMENT-RESPONSE  +  real tx hash
```

## Contracts (Base Sepolia, real bytecode)

| Contract | Address | Purpose |
|---|---|---|
| `AgentToken` | [`0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`](https://sepolia.basescan.org/address/0xdabd72e3e7fb2811115970e0c59279aaa0196cdb) | EIP-3009-enabled ERC-20 (`transferWithAuthorization`) |
| `AgentPayments` | [`0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`](https://sepolia.basescan.org/address/0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948) | Auditable payment pool: records payer / amount / token per settlement |

## Verified on-chain settlement

Run the end-to-end script locally and you will see a **real transaction hash** appear on basescan:

```bash
# 1. fresh burner EOA
# 2. POST /api/faucet      → mint AGT on Base Sepolia (real tx)
# 3. POST /api/agent-task  → 402 challenge
# 4. sign EIP-3009         → offline, gasless
# 5. POST /api/x402/settle → facilitator broadcasts transferWithAuthorization
node scripts/burner-e2e-v2.mjs
```

Sample settlement tx (from our own smoke run):
[`0x5d0b9513ce17cd6b1a7c5c0044249e635b78ab4fc9f9e27f77604fe30ac6b000`](https://sepolia.basescan.org/tx/0x5d0b9513ce17cd6b1a7c5c0044249e635b78ab4fc9f9e27f77604fe30ac6b000)

## Architecture

```
lib/x402/
  types.ts        # x402 v2 protocol types (PaymentRequired / PaymentPayload / SettlementResponse)
  encode.ts       # Base64 header encoding (payment-required / payment-signature / payment-response)
  server.ts       # server-side challenge builder
  client.ts       # client-side payment signer
  facilitator.ts  # verify + broadcast EIP-3009 transferWithAuthorization
app/api/
  agent-task/     # protected resource (returns 402 unless paid)
  faucet/         # test-token dispenser (demo only, real on-chain mint)
  x402/verify/    # facilitator: signature verification
  x402/settle/    # facilitator: on-chain settlement broadcast
contracts/
  AgentToken.sol      # ERC-20 + EIP-3009 (transferWithAuthorization / receiveWithAuthorization)
  AgentPayments.sol   # auditable payment pool
```

## Why this matters

The x402 standard (Linux Foundation, Visa / Stripe / AWS among 40 members) wants AI agents to pay each other over HTTP the same way browsers pay over HTTP today. This repo is a reference implementation that:

- **Works without a wallet extension** — burner EOA generated client-side, gas paid by the facilitator.
- **Is gasless for the agent** — EIP-3009 means the agent only signs once, never holds gas.
- **Is auditable** — every settlement lands on a payment pool contract with a verifiable tx hash.
- **Is chain-agnostic** — swap `lib/x402/config.ts` to point at any EVM chain with an EIP-3009 token.

## Quickstart

```bash
cp .env.example .env.local
# fill in:
#   X402_TOKEN / X402_PAYTO / X402_TOKEN_NAME / X402_AMOUNT
#   X402_DEPLOYER_PRIVATE_KEY (facilitator, pays gas)
#   X402_DEMO=false

npm install
npm run dev
# open http://localhost:3000?demo=burner
```

## Deploy contracts yourself

```bash
node scripts/deploy-x402.mjs
# prints AgentToken / AgentPayments addresses + deployment tx hashes
```

## License

MIT — see [LICENSE](LICENSE).
