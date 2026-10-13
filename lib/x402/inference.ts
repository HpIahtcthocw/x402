/**
 * Live LLM inference — the metered resources that sit on genuinely vendor-billed
 * upstreams. Each is OpenAI-compatible and env-gated: without a key the resource
 * reports `outputMode: "unconfigured"` rather than pretending it ran.
 *
 *   inference:tiny  → Alibaba Cloud Model Studio (Qwen)   — DASHSCOPE_API_KEY
 *   inference:kimi  → Moonshot AI (Kimi)                  — MOONSHOT_API_KEY
 *
 * The payment and its on-chain receipt are unchanged; only the billed vendor
 * differs, and each receipt names which one actually served the call.
 */

export const INFERENCE_TASK = "inference:tiny";
export const KIMI_TASK = "inference:kimi";

export const INFERENCE_PROMPT =
  "In one sentence, what does HTTP 402 mean for AI agents?";

type ProviderSpec = {
  task: string;
  /** Named so a receipt records which billed vendor actually served the call. */
  vendor: string;
  baseUrl: string;
  model: string;
  keyEnv: string;
  key: () => string | undefined;
};

const PROVIDERS: ProviderSpec[] = [
  {
    task: INFERENCE_TASK,
    vendor: "alibaba-cloud-model-studio",
    baseUrl: (process.env.DASHSCOPE_BASE_URL || "https://dashscope.aliyuncs.com/compatible-mode/v1").replace(/\/$/, ""),
    model: process.env.DASHSCOPE_MODEL || "qwen3.8-max",
    keyEnv: "DASHSCOPE_API_KEY",
    key: () => process.env.DASHSCOPE_API_KEY,
  },
  {
    task: KIMI_TASK,
    vendor: "moonshot-kimi",
    baseUrl: (process.env.MOONSHOT_BASE_URL || "https://api.moonshot.cn/v1").replace(/\/$/, ""),
    model: process.env.MOONSHOT_MODEL || "kimi-k3",
    keyEnv: "MOONSHOT_API_KEY",
    key: () => process.env.MOONSHOT_API_KEY,
  },
];

function spec(task: string): ProviderSpec | undefined {
  return PROVIDERS.find((p) => p.task === task);
}

export function isInferenceTask(task: string): boolean {
  return Boolean(spec(task));
}

/** Everything a route needs to report an honest status for this task. */
export function inferenceConfig(task: string): {
  configured: boolean;
  vendor: string;
  model: string;
  keyEnv: string;
} {
  const p = spec(task) ?? PROVIDERS[0];
  return { configured: Boolean(p.key()), vendor: p.vendor, model: p.model, keyEnv: p.keyEnv };
}

export type Inference = {
  provider: string;
  model: string;
  prompt: string;
  completion: string;
  tokens: number;
  asOf: string;
  latencyMs: number;
};

export async function fetchInference(task: string, prompt: string): Promise<Inference> {
  const p = spec(task);
  if (!p) throw new Error(`unknown inference task: ${task}`);
  const key = p.key();
  if (!key) throw new Error(`inference upstream not configured (${p.keyEnv})`);

  const started = Date.now();
  const res = await fetch(`${p.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: p.model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`upstream responded ${res.status}`);

  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { total_tokens?: number };
  };

  return {
    provider: p.vendor,
    model: p.model,
    prompt,
    completion: data.choices?.[0]?.message?.content?.trim() ?? "",
    tokens: data.usage?.total_tokens ?? 0,
    asOf: new Date().toISOString(),
    latencyMs: Date.now() - started,
  };
}
