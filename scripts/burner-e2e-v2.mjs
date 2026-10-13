import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const BASE = "http://localhost:3000";
const TOKEN = "0xdabd72e3e7fb2811115970e0c59279aaa0196cdb";
const PAYTO = "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
const AMOUNT = 1000000000000000n;

const burner = privateKeyToAccount(generatePrivateKey());
console.log("burner:", burner.address);
const pub = createPublicClient({ chain: base, transport: http("https://sepolia.base.org") });

console.log("\n[1] faucet mint...");
let r = await fetch(`${BASE}/api/faucet`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: burner.address }),
});
console.log("    ", (await r.json()).tx?.slice(0, 30));

console.log("\n[2] request task (402)...");
r = await fetch(`${BASE}/api/agent-task`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ task: "buy-order" }),
});
const body = await r.json();
const req = body.x402.accepts[0];
console.log("    scheme=", req.scheme, "network=", req.network, "amount=", req.amount, "payTo=", req.payTo);

const domain = { name: "AgentToken", version: "1", chainId: 84532, verifyingContract: TOKEN };
const types = { TransferWithAuthorization: [
  { name: "from", type: "address" }, { name: "to", type: "address" },
  { name: "value", type: "uint256" }, { name: "validAfter", type: "uint256" },
  { name: "validBefore", type: "uint256" }, { name: "nonce", type: "bytes32" },
]};
const nonce = ("0x" + [...crypto.getRandomValues(new Uint8Array(32))].map(b=>b.toString(16).padStart(2,"0")).join(""));
const validAfter = "0";
const validBefore = (BigInt(Math.floor(Date.now()/1000)) + 3600n).toString();
const message = { from: burner.address, to: PAYTO, value: AMOUNT, validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), nonce };
const sig = await burner.signTypedData({ domain, primaryType: "TransferWithAuthorization", types, message });
console.log("\n[3] signed:", sig.slice(0, 30) + "...");

console.log("\n[4] settle on-chain...");
const settleBody = {
  x402Version: 2,
  paymentRequirements: req,
  paymentPayload: {
    x402Version: 2,
    accepted: req,
    payload: {
      signature: sig,
      authorization: {
        from: burner.address, to: PAYTO, value: AMOUNT.toString(),
        validAfter, validBefore, nonce,
      },
    },
  },
};
r = await fetch(`${BASE}/api/x402/settle`, {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify(settleBody),
});
console.log("    status", r.status);
const settleRes = await r.json();
console.log("    ", JSON.stringify(settleRes, null, 2));
