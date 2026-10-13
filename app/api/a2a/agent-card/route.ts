import { NextResponse } from "next/server";
import { APP_BASE_URL } from "@/lib/x402/config";
import { storeMode } from "@/lib/x402/a2a-store";

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
      "The receipt layer for x402 — meters any API for agents with EIP-3009 " +
      "gasless signatures and books every settlement on-chain as a refundable " +
      "receipt keyed by a stable Payment Identifier.",
    url: APP_BASE_URL,
    capabilities: {
      extensions: [
        {
          uri: "https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2",
          description:
            "Supports payments using the x402 protocol for on-chain settlement.",
          required: true,
        },
        {
          uri: "https://github.com/selfxyz/self-mcp",
          description:
            "Adopts the self-mcp pattern for payer identity: the EIP-3009 payer " +
            "address can be bound to a verified attestation, so a receipt carries " +
            "a proven counterparty and not just a key. Payments still settle " +
            "without it — identity is an optional, additive claim.",
          required: false,
        },
      ],
    },
    /** Operational, namespaced — where advertised task terms are kept. */
    metadata: { "x-task-store": storeMode() },
  };
  return NextResponse.json(card);
}
