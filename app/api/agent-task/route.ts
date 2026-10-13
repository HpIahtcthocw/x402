import { meter } from "@/lib/x402/meter";
import { TASK_OUTPUTS } from "@/lib/x402/task-outputs";
import { fetchQuote, isQuoteTask } from "@/lib/x402/quote";
import {
  fetchInference,
  INFERENCE_PROMPT,
  inferenceConfig,
  isInferenceTask,
} from "@/lib/x402/inference";

/**
 * Demo metered resource — an API call the agent pays for per request via x402
 * (exact scheme, EIP-3009 on Monad Testnet).
 *
 * The entire 402 → sign → settle → receipt loop lives in `meter()`; this route
 * only declares what it sells. That is the point of the library: one line to
 * meter any endpoint.
 *
 * The quoted tasks return **real market data** (Binance public market data) —
 * the agent pays, and what it gets back is the actual spot price. Payment,
 * receipt and refund are real either way; if the upstream vendor is down the
 * call still returns an explicit `outputMode: "unavailable"`.
 *
 *   POST /api/agent-task   { "task": "quote:BTC" }
 */
export const POST = meter(
  async (_req, { task, body }) => {
    const base = {
      jobId: `job_${Date.now()}`,
      task,
      model: body.model || "agent-base",
    };

    if (isQuoteTask(task)) {
      try {
        return { ...base, output: await fetchQuote(task), outputMode: "live — Binance public market data" };
      } catch (e) {
        return {
          ...base,
          output: null,
          outputMode: "unavailable",
          reason: e instanceof Error ? e.message : "upstream error",
          note: "the payment and its on-chain receipt are unaffected by upstream availability",
        };
      }
    }

    if (isInferenceTask(task)) {
      const cfg = inferenceConfig(task);
      if (!cfg.configured) {
        return {
          ...base,
          output: null,
          outputMode: "unconfigured",
          reason: `set ${cfg.keyEnv} to enable this resource`,
        };
      }
      try {
        return {
          ...base,
          output: await fetchInference(task, body.prompt || INFERENCE_PROMPT),
          outputMode: `live — ${cfg.vendor} (${cfg.model})`,
        };
      } catch (e) {
        return {
          ...base,
          output: null,
          outputMode: "unavailable",
          reason: e instanceof Error ? e.message : "upstream error",
          note: "the payment and its on-chain receipt are unaffected by upstream availability",
        };
      }
    }

    return {
      ...base,
      output: TASK_OUTPUTS[task] ?? { summary: `Completed "${task}"`, tokens: 128, latencyMs: 342 },
      outputMode: "fixture — payment and receipt are live on-chain; this resource body is an example",
    };
  },
  { name: "quote:BTC" },
);