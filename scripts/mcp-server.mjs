#!/usr/bin/env node
/**
 * x402 Agent Gateway — MCP server
 *
 * Exposes a single tool `pay_and_call` that lets any MCP client (Cursor,
 * Claude Desktop, etc.) make a paid HTTP call through the x402 gateway.
 *
 * Wire protocol: stdio JSON-RPC (Model Context Protocol).
 *
 * Usage (in your MCP client config):
 *   {
 *     "mcpServers": {
 *       "x402": {
 *         "command": "node",
 *         "args": ["scripts/mcp-server.mjs"],
 *         "env": {
 *           "GATEWAY_URL": "https://x402-agent-gateway.vercel.app",
 *           "BURNER_PRIVATE_KEY": "0x..."   // optional; generated if missing
 *         }
 *       }
 *     }
 *   }
 *
 * Then call:
 *   pay_and_call({ url: "https://your-gateway/api/agent-task", body: { task: "quote:BTC" } })
 *
 * The server:
 *   1. POSTs to the target, expects 402 + a PAYMENT-REQUIRED header
 *   2. Signs the EIP-3009 authorization with the burner key (offline, gasless)
 *   3. POSTs the signed payload to /api/x402/settle on Monad Testnet
 *   4. Returns the settled response + settlement / receipt tx hashes
 */

import { randomPrivateKey, privateKeyToAccount } from "viem/accounts";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000";
const CHAIN_ID = Number(process.env.X402_CHAIN_ID || 10143);
const EXPLORER = process.env.X402_EXPLORER || "https://testnet.monadexplorer.com";
let burnerKey = process.env.BURNER_PRIVATE_KEY;
if (!burnerKey) {
  burnerKey = randomPrivateKey();
  console.error(
    `[x402-mcp] no BURNER_PRIVATE_KEY set — generated throwaway burner: ${privateKeyToAccount(burnerKey).address}`,
  );
}

// ---------- helpers ----------

async function httpJson(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data, headers: res.headers };
}

const b64encode = (obj) => Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
const b64decode = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));

/** Sign EIP-3009 transferWithAuthorization with viem (offline, gasless). */
async function signAuthorization(requirement) {
  const account = privateKeyToAccount(burnerKey);
  const auth = requirement.authorization || {
    from: account.address,
    to: requirement.payTo,
    value: requirement.amount,
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 3600),
    nonce: "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join(""),
  };
  const domain = {
    name: requirement.extra?.name || "AgentToken",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: requirement.asset,
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
  const message = {
    from: auth.from,
    to: auth.to,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };
  const signature = await account.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message });
  return { auth, signature };
}

// ---------- MCP protocol ----------

const TOOLS = [
  {
    name: "pay_and_call",
    description:
      "Make an HTTP call through the x402 payment gateway. Sends the request; if the server responds 402 Payment Required, automatically signs an EIP-3009 authorization and settles on Monad Testnet, then retries with payment attached. Returns the final response body plus settlement tx hashes.",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "Full URL of the protected resource, e.g. https://your-gateway/api/agent-task" },
        method: { type: "string", enum: ["GET", "POST"], default: "POST" },
        body: { type: "object", description: "Optional JSON request body" },
      },
    },
  },
];

async function handlePayAndCall(args) {
  const { url, method = "POST", body = { task: "quote:BTC" } } = args;

  // 1. first call — expect 402
  const first = await httpJson(method, url, body);
  if (first.status !== 402) {
    return {
      content: [{ type: "text", text: `No 402 challenge (status=${first.status}). Response: ${JSON.stringify(first.data).slice(0, 500)}` }],
    };
  }

  const requiredB64 = first.headers.get("payment-required");
  if (!requiredB64) throw new Error("402 response missing PAYMENT-REQUIRED header");
  const paymentRequired = b64decode(requiredB64);
  const requirement = paymentRequired.accepts?.[0];
  if (!requirement) throw new Error("PAYMENT-REQUIRED header has no acceptable requirement");

  // 2. sign (offline EIP-3009 — the agent never touches gas)
  const { auth, signature } = await signAuthorization(requirement);
  const payload = {
    x402Version: 2,
    resource: paymentRequired.resource,
    accepted: requirement,
    payload: { signature, authorization: auth },
  };
  const payB64 = b64encode(payload);

  // 3. settle through the gateway facilitator (this is what pays the gas)
  const settle = await httpJson("POST", `${GATEWAY_URL}/api/x402/settle`, {
    paymentPayload: payload,
    paymentRequirements: requirement,
  });

  // 4. retry the original request with the payment attached
  const retry = await httpJson(method, url, body, { "payment-signature": payB64 });

  const tx = settle.data.transaction || "n/a";
  const record = settle.data?.extensions?.paymentRecordTx || "n/a";
  return {
    content: [
      {
        type: "text",
        text: [
          `✅ Paid and called ${url}`,
          `  challenge: ${requirement.amount} AGT → ${requirement.payTo}`,
          `  settle tx: ${tx}${tx !== "n/a" ? `  ${EXPLORER}/tx/${tx}` : ""}`,
          `  receipt tx: ${record}${record !== "n/a" ? `  ${EXPLORER}/tx/${record}` : ""}`,
          `  payment id: ${settle.data?.extensions?.paymentId || auth.nonce}`,
          `  final status: ${retry.status}`,
          `  response: ${JSON.stringify(retry.data).slice(0, 800)}`,
        ].join("\n"),
      },
    ],
  };
}

async function handleRequest(msg) {
  const { id, method, params } = msg;
  if (method === "initialize") {
    return {
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "x402-agent-gateway", version: "0.1.0" },
      },
    };
  }
  if (method === "tools/list") return { id, result: { tools: TOOLS } };
  if (method === "tools/call") {
    const { name, arguments: args } = params;
    if (name === "pay_and_call") return { id, result: await handlePayAndCall(args) };
    return { id, error: { code: -32601, message: `unknown tool: ${name}` } };
  }
  return { id, result: {} };
}

// stdio loop
let buf = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", async (chunk) => {
  buf += chunk;
  let idx;
  while ((idx = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      const resp = await handleRequest(msg);
      process.stdout.write(JSON.stringify(resp) + "\n");
    } catch (e) {
      process.stderr.write(`[x402-mcp] error: ${e.message}\n`);
    }
  }
});
