# Your agent calls a paid API 1,000 times a day. Can finance prove what it bought?

> **A trading agent buys live spot quotes per call on Monad — every payment settles on-chain as a refundable receipt.**

**1.** One line to meter any API. **2.** Gasless EIP-3009 on Monad. **3.** Every payment a refundable on-chain receipt.

*No account. No API key. No gas. The agent pays itself.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## Live demo

- **Web**: https://x402-agent-gateway.vercel.app
- **Network**: Monad Testnet (`eip155:10143`)
- **Explorer**: https://testnet.monadexplorer.com

## Why

AI agents are starting to transact autonomously — calling paid APIs thousands of times a day. x402 (the Linux Foundation standard, backed by Visa / Stripe / AWS) solved *how* an agent pays with a gasless EIP-3009 signature. The receiving side is still open: providers get raw transfers — no per-payment record, no receipt, and no refund trail — so finance cannot audit what an autonomous agent actually bought.

We are the **receipt layer**: every settlement is booked into an on-chain contract under a stable `paymentId` (payer / amount / token / timestamp), enabling per-payment reconciliation, owner-authorized refunds, and nonce-based replay protection.

## Auditable, not trusted

- **The receipt is contract state, not a dashboard row.** Every ledger row is read back from `AgentPayments.settlements(paymentId)` — payer, amount, timestamp and the refund flag come straight off Monad.
- **The refund is a contract method, not a support ticket.** `AgentPayments.refund()` returns the money to the original payer; it is owner-authorized, so the browser can never call it directly.
- **Replay is rejected on-chain.** Reusing an EIP-3009 nonce reverts with `AgentToken: authorization already used`.

## Who pays for this (and why it isn't optional)

**Buyer** — the finance / platform team on either side of an agent's spend:
- **Sellers** of agent-facing API capacity want per-call billing with a receipt they can prove, discount and refund.
- **Buyers** (teams running autonomous agents) want to reconcile what a thousand unattended calls actually bought.

**What they buy** — a one-line `meter()` that turns any endpoint into a paid resource, plus an on-chain receipt ledger that exports to CSV, so reconciliation never has to trust our dashboard.

**How it's charged** — a platform fee per settled receipt, or a self-host license (MIT) for teams that keep the ledger in their own stack.

## Contracts

| Contract | Address | Purpose |
|---|---|---|
| `AgentToken` | [`0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`](https://testnet.monadexplorer.com/address/0xdabd72e3e7fb2811115970e0c59279aaa0196cdb) | EIP-3009 ERC-20 (`transferWithAuthorization`) |
| `AgentPayments` | [`0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`](https://testnet.monadexplorer.com/address/0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948) | On-chain settlement ledger: `PaymentRecorded`, `refund()`, `settlements[paymentId]` |

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

**Read `PaymentRecorded` off Monad with none of our code in the loop — it matches the dashboard row for row.**

## Verified on-chain evidence (Monad Testnet)

- `AgentToken`: `0xdabd72e3e7fb2811115970e0c59279aaa0196cdb`
- `AgentPayments`: `0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948`
- faucet mint (AgentToken.mint): [`0x63305b4b329da54ae686d09b6b311f9f7302bcfb971076aa7a249acce968b8fe`](https://testnet.monadexplorer.com/tx/0x63305b4b329da54ae686d09b6b311f9f7302bcfb971076aa7a249acce968b8fe)
- settle (transferWithAuthorization): [`0x73ca354d98519ff3886a3530c007b74e6ac713ae2c53cbac7aa543d944aa4b33`](https://testnet.monadexplorer.com/tx/0x73ca354d98519ff3886a3530c007b74e6ac713ae2c53cbac7aa543d944aa4b33)
- record (PaymentRecorded): [`0xa6a3c1581251e894de3ad59c01910d0c5365cd6574047e4e454703199a62e59d`](https://testnet.monadexplorer.com/tx/0xa6a3c1581251e894de3ad59c01910d0c5365cd6574047e4e454703199a62e59d)
- refund (PaymentRefunded): [`0xd8c1c03309a34ec9998370605ccb2f96f3e820980268554d0471490b8353317c`](https://testnet.monadexplorer.com/tx/0xd8c1c03309a34ec9998370605ccb2f96f3e820980268554d0471490b8353317c)
- replay: re-submitting the same authorization reverts (`AgentToken: authorization already used`)

## Run the agent yourself (one command)

```bash
# Fresh burner → faucet mint → 402 → sign → settle → record on-chain + replay check
node scripts/burner-e2e-v2.mjs
```

Or drive it from any MCP client (Cursor / Claude Desktop) — see [`scripts/mcp-server.mjs`](scripts/mcp-server.mjs).

## How it's made (the shortcut we took)

The quoted tasks return **live** market data (Binance public market data) — the agent pays, and what it gets back is the real spot price. Payment, on-chain receipt and refund are real too. The ledger reads **Envio HyperRPC** (one call, whole history) when `ENVIO_API_TOKEN` is set, and otherwise falls back to a paced public-RPC scan of a recent block window.

## Run it with nobody at the keyboard

The point of agent payments is that no human is present. `scripts/headless-agent.mjs` is an unattended payer: it mints a fresh burner, hits the faucet, reads the 402 terms, signs an EIP-3009 authorization and settles — on a loop, with nothing open on screen.

```bash
node scripts/headless-agent.mjs --once --task quote:BTC        # one shot, prints the on-chain receipt
node scripts/headless-agent.mjs --calls 5 --interval 5000      # keeps running on an interval
node scripts/headless-agent.mjs --once --forge-identity        # negative case: merchant reports identity.untrusted
```

It signs its **own** EIP-191 identity attestation on every call, so each receipt carries a verified payer — and `--forge-identity` shows the merchant reporting the claim as untrusted instead of taking the caller's word for it.

## Built with real vendor APIs (Qwen · Kimi)

Two metered resources are **real third-party paid APIs**, not stubs — and together they show the meter is provider-agnostic:

- `inference:tiny` proxies **Qwen** through the Alibaba Cloud Model Studio OpenAI-compatible endpoint (`https://dashscope.aliyuncs.com/compatible-mode/v1`, model `qwen3.8-max`).
- `inference:kimi` proxies **Kimi** through the Moonshot AI OpenAI-compatible endpoint (`https://api.moonshot.cn/v1`, model `kimi-k3`).

The agent pays per call in x402, the facilitator settles on-chain, and the receipt is booked — so what is metered is a genuine vendor-billed model. Each resource names its provider in the body (`alibaba-cloud-model-studio` / `moonshot-kimi`), and each stays honest (`outputMode: "unconfigured"`) until its key (`DASHSCOPE_API_KEY` / `MOONSHOT_API_KEY`) is configured.

## Architecture

```
lib/x402/          # x402 v2 protocol (types, codec, server challenge, client signer, facilitator, meter, quote, inference, identity, a2a-store)
app/api/
  agent-task/      # protected resource — one-line `meter()` wrapper (returns 402 unless paid)
  a2a/             # A2A surface — agent-card (x402 + identity extensions), task, message/send
  x402/settle/     # facilitator: verify + broadcast transferWithAuthorization + recordERC20
  ledger/          # the on-chain receipt ledger (Envio HyperRPC / public-RPC fallback)
  receipt/         # raw `settlements(paymentId)` contract read, shown verbatim in the UI
  refund/          # owner-authorized refund (server signs; browser never touches the key)
  faucet/          # test-token dispenser (real on-chain mint)
contracts/
  AgentToken.sol   # ERC-20 + EIP-3009
  AgentPayments.sol # on-chain ledger: recordERC20 / refund / withdraw
scripts/
  burner-e2e-v2.mjs  # end-to-end smoke (one command, real tx hashes)
  headless-agent.mjs # unattended payer: loop, sign identity, print on-chain receipts
  mcp-server.mjs     # MCP tool: pay_and_call
```

## We implement a standard we don't own

We implement the published **x402 v2** flow — all three spec headers round-trip, not a private variant:

| Header | Direction | What we put in it |
|---|---|---|
| `PAYMENT-REQUIRED` | server → agent | `amount` / `payTo` / `asset` / `network` / `timeout` |
| `PAYMENT-SIGNATURE` | agent → server | Base64 exact-scheme `transferWithAuthorization` payload |
| `PAYMENT-RESPONSE` | server → agent | settlement tx hash + `paymentId` |

Where the spec leaves the receiving side open, we fill it with the primitive the extension layer already names: a **Payment Identifier** — the stable `paymentId` every settlement books under, so any downstream system can join on it, and the pool view rolls thousands of per-call receipts into one. We align with the intent of the `batch-settlement` scheme without yet implementing its voucher flow. Spec: [docs.x402.org](https://docs.x402.org).

The pattern we follow — a compliant x402 core plus exactly one value-added layer — is the one EF already pointed at (`superfluid-org/x402-sf`). Earlier work proved the category on other chains (Corbits on Solana, Glassbox402 on Hedera). We bring the receipt-and-refund layer to **Monad**, and we make the receipt a **contract primitive** (`AgentPayments.refund()`), not a dashboard view.

## Not another facilitator dashboard

Corbits ships a merchant dashboard *and* a facilitator; we take the narrower, harder-to-copy slice — **the receipt is contract state, refunds are contract methods, reconciliation is a plain `getLogs`**. We borrow the dashboard craft that came before it (live pool volume, an exportable reconciliation file) — that's UX we should not reinvent — but not the position. A generic facilitator can restyle a UI; it cannot restyle a settlement contract that the token transfer, the refund and the replay rejection all resolve to.

## Speaks A2A

The gateway also exposes an [A2A](https://a2a-protocol.org/) surface — `agent-card`, `task`, `message` — implementing Google's **a2a-x402 v0.2** payments extension (Standalone Flow). x402 answers *how an agent pays*; A2A answers *how it asks*. `GET /api/a2a/agent-card` advertises the x402 extension so an A2A client can discover the metered APIs and pay per call without bespoke glue. The whole loop is runnable from the UI in one click ("Run the A2A purchase") — it shows the agent card verbatim, then walks `task → sign → message/send` and surfaces the returned receipt.

Two further declarations ride on the same card, both additive:

- **Payer identity** (`capabilities.extensions`, following the [`self-mcp`](https://github.com/selfxyz/self-mcp) pattern): the EIP-3009 payer address can be bound to a **verified** EIP-191 attestation, so a receipt names a proven counterparty rather than just a key. The merchant verifies the signature and decides trust (`allowlisted` / `self-attested` / `untrusted`, by `IDENTITY_ATTESTER`); the result is attached to the receipt. It is optional — settlement never depends on it.
- **Task durability**: advertised terms are stored keyed by `taskId`, backed by Upstash Redis (REST) when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set, so a purchase survives a cold start or a second instance. With no credentials it falls back to an in-process map (single-instance demo only).

## What's real, and what isn't yet

Real, and verifiable by anyone: the EIP-3009 payment, the `PaymentRecorded` / `PaymentRefunded` receipts, the replay revert, the ledger read over Envio HyperRPC, and the resource body (a live spot quote).

Not yet — we would rather name it than pretend:

- **The settlement token is a test AGT, not USDC.** A mainnet deployment needs a real asset.
- **The default demo meters a free public feed** (`quote:*`). The product is the receipt layer, not the feed — a production deployment meters an endpoint someone actually pays for. We added two such resources behind keys (`inference:tiny` → Alibaba Cloud Model Studio / Qwen, `inference:kimi` → Moonshot / Kimi): each returns `outputMode: "unconfigured"` until its key is set, rather than faking success. The path is proven; the metered-by-default vendor API is not yet wired to a paying vendor account.
- **Single tenant.** One payee contract per deployment; there is no hosted multi-tenant control plane.
- **Refunds are owner-authorized** (the server holds the key). Genuinely permissionless refunds need a per-provider role model, not one owner.
- **The A2A task store is durable only with Upstash credentials.** Without `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` it falls back to a process-wide map (`globalThis`, shared across route bundles) — fine for a single-process host, but it is not durable and does not span separate serverless functions.
- **The identity extension verifies a signature, not a person.** The card advertises the `self-mcp` pattern, and the gateway now verifies an EIP-191 attestation on every payment (`lib/x402/identity.ts`; attester allowlist via `IDENTITY_ATTESTER`). `verified` (the signature is real) and `trust` (we accept the attester) are reported as two separate facts. There is still no on-chain or ZK proof of the human behind the key.
- **No paying customer yet.** The mechanism is real; the demand is unvalidated.

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
