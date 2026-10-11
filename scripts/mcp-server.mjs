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
 *           "GATEWAY_URL": "https://avalanche-agent-mu.vercel.app",
 *           "BURNER_PRIVATE_KEY": "0x..."   // optional; generated if missing
 *         }
 *       }
 *     }
 *   }
 *
 * Then call:
 *   pay_and_call({ url: "https://your-gateway/api/agent-task", method: "POST" })
 *
 * The server:
 *   1. POSTs to the target, expects 402 + PAYMENT-REQUIRED
 *   2. Signs the EIP-3009 authorization with the burner key (offline, gasless)
 *   3. POSTs the signed payload to /api/x402/settle
 *   4. Returns the settled response + tx hash
 */

import { randomPrivateKey, privateKeyToAccount } from "viem/accounts";
import { base64encode, base64decode } from "./mcp-encode.mjs";

const GATEWAY_URL = process.env.GATEWAY_URL || "http://localhost:3000";
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
  return { status: res.status, data };
}

/** Sign EIP-3009 transferWithAuthorization with viem (offline). */
async function signAuthorization(tokenAddress, tokenName, auth) {
  const { signTypedData } = await import("viem/accounts");
  const account = privateKeyToAccount(burnerKey);
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
  const domain = {
    name: tokenName,
    version: "1",
    chainId: 84532,
    verifyingContract: tokenAddress,
  };
  const message = {
    from: auth.from,
    to: auth.to,
    value: BigInt(auth.value),
    validAfter: BigInt(auth.validAfter),
    validBefore: BigInt(auth.validBefore),
    nonce: auth.nonce,
  };
  const sig = await account.signTypedData({ domain, types, primaryType: "TransferWithAuthorization", message });
  return sig;
}

// ---------- MCP protocol ----------

const TOOLS = [
  {
    name: "pay_and_call",
    description:
      "Make an HTTP call through the x402 payment gateway. Sends the request; if the server responds 402 Payment Required, automatically signs an EIP-3009 authorization and settles on Base Sepolia, then retries with payment attached. Returns the final response body plus settlement tx hashes.",
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
  const { url, method = "POST", body = {} } = args;

  // 1. first call — expect 402
  const first = await httpJson(method, url, body);
  if (first.status !== 402) {
    return {
      content: [{ type: "text", text: `No 402 challenge (status=${first.status}). Response: ${JSON.stringify(first.data).slice(0, 500)}` }],
    };
  }

  const requiredB64 = first.data["payment-required"];
  if (!requiredB64) throw new Error("402 response missing payment-required header");
  const req = JSON.parse(new TextDecoder().decode(base64decode(requiredB64)));

  // 2. sign
  const auth = req.authorization;
  const signature = await signAuthorization(req.asset, req.assetName || "AgentToken", auth);
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: req.network,
    payload: {
      signature,
      authorization: auth,
      extra: {},
    },
  };
  const payB64 = base64encode(JSON.stringify(payload));

  // 3. settle via gateway facilitator
  const settle = await httpJson("POST", `${GATEWAY_URL}/api/x402/settle`, {
    payload,
    requirements: req,
  });

  // 4. retry original request with payment header
  const retry = await httpJson(method, url, body, { "payment-signature": payB64 });

  return {
    content: [
      {
        type: "text",
        text: [
          `✅ Paid and called ${url}`,
          `  challenge: ${req.amount} ${req.assetName || "AGT"} → ${req.payTo}`,
          `  settle tx: ${settle.data.transaction || "n/a"}`,
          `  payment record tx: ${settle.data?.extensions?.paymentRecordTx || "n/a"}`,
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
