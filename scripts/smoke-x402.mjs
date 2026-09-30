// End-to-end smoke test for the x402 payment loop against a running dev
// server. Pure .mjs (no TS imports) — simulates the paying agent:
//
//   1. POST /api/agent-task (no signature)  → expect 402 + PAYMENT-REQUIRED
//   2. decode the challenge, pick the "exact" requirement
//   3. sign an EIP-3009 transferWithAuthorization with a throwaway local key
//   4. POST /api/x402/verify  → expect isValid: true
//   5. POST /api/agent-task with PAYMENT-SIGNATURE → expect 200 + job
//
// Run: node scripts/smoke-x402.mjs [baseUrl]
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { toViemChain } from "@avakit/core";

const BASE = process.argv[2] || "http://localhost:3111";
const TASK = process.env.SMOKE_TASK || "buy-order";
const KEY = process.env.TEST_PRIVATE_KEY || "0x" + "11".repeat(32);

const BASE_CHAIN = {
  id: 84532,
  name: "Base Sepolia",
  rpcUrl: "https://sepolia.base.org",
  nativeCurrency: { name: "Base", symbol: "ETH", decimals: 18 },
};
const chain = toViemChain(BASE_CHAIN);
const account = privateKeyToAccount(KEY);
const walletClient = createWalletClient({ chain, transport: http(), account });

const b64decode = (s) => JSON.parse(decodeURIComponent(escape(atob(s))));
const b64encode = (o) => Buffer.from(JSON.stringify(o)).toString("base64");

async function main() {
  console.log("=== x402 smoke test ===\n");
  console.log(`Agent (payer): ${account.address}  task=${TASK}\n`);

  // 1. Challenge.
  console.log("[1] POST /api/agent-task (no payment)");
  const res1 = await fetch(`${BASE}/api/agent-task`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ task: TASK }),
  });
  console.log(`    status=${res1.status}`);
  if (res1.status !== 402) throw new Error(`Expected 402, got ${res1.status}`);
  const hdr = res1.headers.get("payment-required");
  const required = b64decode(hdr);
  const req0 = required.accepts[0];
  console.log(`    challenge: scheme=${req0.scheme} network=${req0.network} amount=${req0.amount} payTo=${req0.payTo}`);

  // 2. Sign EIP-3009.
  console.log("\n[2] sign EIP-3009 transferWithAuthorization");
  const now = Math.floor(Date.now() / 1000);
  const auth = {
    from: account.address,
    to: req0.payTo,
    value: req0.amount,
    validAfter: String(now - 60),
    validBefore: String(now + 300),
    nonce: "0x" + "ab".repeat(32),
  };
  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: "AgentToken",
      version: "1",
      chainId: chain.id,
      verifyingContract: req0.asset,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    },
  });
  console.log(`    from=${auth.from}`);
  console.log(`    to=${auth.to}`);
  console.log(`    signature=${signature.slice(0, 18)}…`);

  const payload = {
    x402Version: 2,
    resource: required.resource,
    accepted: req0,
    payload: { signature, authorization: auth },
  };
  const signatureHeader = b64encode(payload);

  // 3. Verify.
  console.log("\n[3] POST /api/x402/verify");
  const resV = await fetch(`${BASE}/api/x402/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: req0 }),
  });
  const v = await resV.json();
  console.log(`    status=${resV.status} isValid=${v.isValid}`);
  if (v.isValid !== true) throw new Error(`Verify rejected: ${v.invalidReason}`);

  // 4. Retry with signature.
  console.log("\n[4] POST /api/agent-task (with PAYMENT-SIGNATURE)");
  const res2 = await fetch(`${BASE}/api/agent-task`, {
    method: "POST",
    headers: { "content-type": "application/json", "payment-signature": signatureHeader },
    body: JSON.stringify({ task: TASK }),
  });
  const body = await res2.json();
  const receipt = res2.headers.get("payment-response");
  console.log(`    status=${res2.status}`);
  if (res2.status !== 200) throw new Error(`Expected 200, got ${res2.status}: ${JSON.stringify(body)}`);
  if (receipt) {
    const settled = b64decode(receipt);
    console.log(`    PAYMENT-RESPONSE: success=${settled.success} tx=${settled.transaction.slice(0, 18)}…`);
  }
  console.log(`    job=${JSON.stringify(body)}`);

  console.log("\n=== PASS: full x402 loop works ===");
}

main().catch((e) => {
  console.error("\n=== FAIL ===");
  console.error(e);
  process.exit(1);
});
