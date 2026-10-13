/**
 * Sample per-call outputs — the fallback "what you bought" body used by both
 * the HTTP 402 flow (/api/agent-task) and the A2A x402 flow
 * (/api/a2a/task + /api/a2a/message).
 *
 * The `quote:*` tasks are served LIVE from `lib/x402/quote.ts` (real market
 * data), so they are intentionally absent here. Everything below is a sample
 * payload for tasks with no live upstream: the payment and the on-chain
 * receipt are real, the body is an example.
 */

export const TASK_OUTPUTS: Record<string, Record<string, unknown>> = {
  "risk:address": {
    subject: "0x7A3f…91C4",
    verdict: "low",
    signals: ["no mixer exposure", "no sanctions hit", "age 412 days"],
    tokens: 128,
    latencyMs: 268,
  },
  "sentiment:news": {
    topic: "Monad",
    window: "24h",
    score: 0.62,
    label: "positive",
    headlines: ["Mainnet fee burn proposal passes", "Ecosystem TVL up 11% w/w"],
    tokens: 96,
    latencyMs: 241,
  },
};
