// Simulate the burner end-to-end on real Base Sepolia:
// 1. fresh burner EOA
// 2. POST /api/faucet to mint AGT
// 3. sign EIP-3009 transferWithAuthorization
// 4. POST /api/x402/settle -> expect a REAL tx hash on basescan
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http, parseAbi, encodeFunctionData } from "viem";
import { base } from "viem/chains";

const BASE = "http://localhost:3000";
const TOKEN = "0xdabd72e3e7fb2811115970e0c59279aaa0196cdb";
const PAYTO = "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
const AMOUNT = 1000000000000000n; // 0.001 AGT

const burner = privateKeyToAccount(generatePrivateKey());
console.log("burner:", burner.address);

const pub = createPublicClient({ chain: base, transport: http("https://sepolia.base.org") });

// 1. faucet mint
console.log("\n[1] faucet mint...");
let r = await fetch(`${BASE}/api/faucet`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ address: burner.address }),
});
console.log("    status", r.status, await r.text());

// check balance
const erc20 = parseAbi(["function balanceOf(address) view returns (uint256)"]);
await new Promise((r) => setTimeout(r, 4000));
const bal = await pub.readContract({ address: TOKEN, abi: erc20, functionName: "balanceOf", args: [burner.address] });
console.log("    AGT balance:", bal.toString());

// 2. request task -> 402 challenge
console.log("\n[2] request task...");
r = await fetch(`${BASE}/api/agent-task`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ task: "buy-order" }),
});
const ch = await r.json();
console.log("    status", r.status);
const payReq = ch.paymentRequired || ch.payment || ch;
console.log("    payReq:", JSON.stringify(payReq).slice(0, 300));

// 3. sign EIP-3009 transferWithAuthorization
// domain = token contract; types TransferWithAuthorization
const domain = {
  name: "AgentToken",
  version: "1",
  chainId: 84532,
  verifyingContract: TOKEN,
};
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
};
const nonce = ("0x" + crypto.getRandomValues(new Uint8Array(32)).reduce((h, b) => h + b.toString(16).padStart(2, "0"), ""));
const validAfter = 0n;
const validBefore = (BigInt(Math.floor(Date.now() / 1000)) + 3600n);
const message = { from: burner.address, to: PAYTO, value: AMOUNT, validAfter, validBefore, nonce };
const sig = await burner.signTypedData({ domain, primaryType: "TransferWithAuthorization", types, message });
console.log("\n[3] signed:", sig.slice(0, 40) + "...");

// 4. settle
console.log("\n[4] settle (broadcast on-chain)...");
const settleBody = {
  from: burner.address,
  to: PAYTO,
  value: AMOUNT.toString(),
  validAfter: validAfter.toString(),
  validBefore: validBefore.toString(),
  nonce,
  signature: sig,
};
r = await fetch(`${BASE}/api/x402/settle`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(settleBody),
});
console.log("    status", r.status);
const settleRes = await r.json();
console.log("    resp:", JSON.stringify(settleRes, null, 2).slice(0, 600));
