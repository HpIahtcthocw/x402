import { NextResponse } from "next/server";

/**
 * A2A (Agent-to-Agent) AgentCard — declares that this agent supports the
 * x402 Payments Extension (Google A2A-x402 v0.2, Standalone Flow).
 *
 * https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2
 */
export async function GET() {
  const card = {
    protocolVersion: "0.2",
    name: "x402 Agent Gateway",
    description:
      "AI Agent 链上微支付底座 — 通过 x402 (V2) 开放支付标准为 agent 服务计费；" +
      "EIP-3009 gasless 签名、链上可审计收款池（batch-settlement / Payment Identifier）。",
    url: "https://github.com/HpIahtcthocw/x402",
    capabilities: {
      extensions: [
        {
          uri: "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2",
          description:
            "Supports payments using the x402 protocol for on-chain settlement.",
          required: true,
        },
      ],
    },
  };
  return NextResponse.json(card);
}
