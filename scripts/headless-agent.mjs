// Unattended x402 buyer — the "nobody at the keyboard" run.
//
//   npm run dev                       (terminal 1)
//   node scripts/headless-agent.mjs --interval 20 --calls 5   (terminal 2)
//
// Each tick: fresh burner → faucet mint → 402 challenge → EIP-3009 sign →
// pay the metered endpoint → print the on-chain receipt. No browser, no
// extension, no human. Point it at a deployment with GATEWAY_URL.
//
// Options:
//   --task <id>       metered task to buy (default quote:BTC)
//   --interval <sec>  seconds between calls (default 15)
//   --calls <n>       stop after n calls (default 0 = run forever)
//   --once            shorthand for --calls 1
//   --forge-identity  attest to a subject that is NOT the payer (negative test)
//   --bad-signature   send a deliberately invalid attestation signature (negative test)
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const BASE = process.env.GATEWAY_URL || "http://localhost:3000";
const TASK = arg("task", "quote:BTC");
const INTERVAL = Number(arg("interval", "15"));
const CALLS = argv.includes("--once") ? 1 : Number(arg("calls", "0"));
const TOKEN = process.env.X402_TOKEN || "0xdabd72e3e7fb2811115970e0c59279aaa0196cdb";
const PAYTO = process.env.X402_PAYTO || "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
const CHAIN_ID = 10143;
const AMOUNT = 1000000000000000n;
const EXPLORER = "https://testnet.monadexplorer.com";

/** Same Base64 encoding the protocol mandates for PAYMENT-* headers. */
const b64 = (obj) => btoa(unescape(encodeURIComponent(JSON.stringify(obj))));

const EIP712_DOMAIN = (token) => ({
  name: "AgentToken", version: "1", chainId: CHAIN_ID, verifyingContract: token,
});
const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" }, { name: "to", type: "address" },
    { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
  ],
};

const burner = privateKeyToAccount(generatePrivateKey());
const nonce32 = () =>
  "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");

console.log(`headless agent  ${burner.address}`);
console.log(`gateway: ${BASE}  task: ${TASK}  every ${INTERVAL}s${CALLS ? `  x${CALLS}` : "  (until Ctrl-C)"}`);

// --- one-time onboarding: the agent funds itself from the faucet -------------
const mint = await fetch(`${BASE}/api/faucet`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: burner.address }),
});
const mintRes = await mint.json().catch(() => ({}));
console.log(mintRes.tx ? `faucet minted  ${EXPLORER}/tx/${mintRes.tx}` : `faucet: ${mintRes.error || mintRes.message || "skipped"}`);

/** Idempotent-ish identity claim: the burner attests to its own payer address. */
async function selfAttestation() {
  const issuedAt = Math.floor(Date.now() / 1000);
  // Negative test: attest to someone else's address, or ship a junk signature.
  const subject = argv.includes("--forge-identity") ? PAYTO : burner.address;
  const message = `x402-identity:v1:${CHAIN_ID}:${subject.toLowerCase()}:${issuedAt}`;
  const signature = argv.includes("--bad-signature")
    ? `0x${"ab".repeat(65)}`
    : await burner.signMessage({ message });
  return { attester: burner.address, subject, issuedAt, signature };
}

let call = 0;
for (;;) {
  call += 1;
  const stamp = new Date().toISOString().slice(11, 19);
  try {
    // 1 — ask for the resource; the gateway replies 402 with its terms.
    const challenge = await fetch(`${BASE}/api/agent-task`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: TASK }),
    });
    if (challenge.status !== 402) {
      console.log(`[${stamp}] #${call} expected 402, got ${challenge.status}`);
    }
    const req = (await challenge.json()).x402.accepts[0];

    // 2 — sign the exact terms it advertised (offline, no gas).
    const validBefore = (BigInt(Math.floor(Date.now() / 1000)) + 3600n).toString();
    const nonce = nonce32();
    const authorization = {
      from: burner.address, to: req.payTo, value: req.amount || AMOUNT.toString(),
      validAfter: "0", validBefore, nonce,
    };
    const signature = await burner.signTypedData({
      domain: EIP712_DOMAIN(req.asset || TOKEN),
      primaryType: "TransferWithAuthorization", types: EIP712_TYPES,
      message: {
        from: authorization.from, to: authorization.to, value: BigInt(authorization.value),
        validAfter: 0n, validBefore: BigInt(validBefore), nonce,
      },
    });
    const payload = {
      x402Version: 2, accepted: req,
      payload: { signature, authorization },
    };

    // 3 — re-request with the signed payment (+ an identity attestation).
    const paid = await fetch(`${BASE}/api/agent-task`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "payment-signature": b64(payload),
        "x-identity-attestation": b64(await selfAttestation()),
      },
      body: JSON.stringify({ task: TASK }),
    });
    const paidBody = await paid.json().catch(() => ({}));

    if (!paid.ok) {
      console.log(`[${stamp}] #${call} payment rejected  ${paidBody.reason || paidBody.error || paid.status}`);
    } else {
      const mode = paidBody.payment?.settled || "?";
      const tx = paidBody.payment?.tx;
      const id = paidBody.identity;
      const body = paidBody.output ?? {};
      const summary = body.price != null ? `price ${body.price}` : (paidBody.outputMode || body.outputMode || "ok");
      console.log(
        `[${stamp}] #${call} paid  ${mode}  ${summary}` +
          (id ? `  identity=${id.verified ? id.trust : "invalid"}` : "") +
          (tx && /^0x[0-9a-f]{64}$/i.test(tx) && !/^0x0+$/.test(tx) ? `\n            receipt ${EXPLORER}/tx/${tx}` : ""),
      );
    }
  } catch (e) {
    console.log(`[${stamp}] #${call} error  ${e instanceof Error ? e.message : e}`);
  }

  if (CALLS && call >= CALLS) break;
  await new Promise((r) => setTimeout(r, INTERVAL * 1000));
}

console.log(`\ndone — ${call} call(s), agent address ${burner.address}`);
