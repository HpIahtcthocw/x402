import type { PaymentRequirements } from "./types";

/**
 * A2A task store — maps taskId → the PaymentRequirements the merchant
 * advertised for that task. Per the A2A-x402 v0.2 spec, the Merchant Agent
 * uses the taskId to retrieve the original requirements when a payment
 * submission arrives, so it can validate that the signed payload corresponds
 * to a payment option it actually offered.
 *
 * Two interchangeable backends behind one interface:
 *   - Upstash Redis (REST, no SDK) when UPSTASH_REDIS_REST_URL + _TOKEN are
 *     set — task records survive a cold start and are visible to every
 *     instance, which is required when routes are separate serverless
 *     functions.
 *   - A process-wide map otherwise. It is kept on `globalThis` rather than in
 *     module scope because Next.js compiles each route handler into its own
 *     module graph: `/api/a2a/task` and `/api/a2a/message` would otherwise
 *     each get their own empty Map and the flow could never complete.
 *
 * Records are short-lived (they only need to outlive one purchase), so the
 * Redis entries carry a TTL.
 */

export interface A2ATaskRecord {
  task: string;
  requirement: PaymentRequirements;
  createdAt: number;
}

/** Records only need to outlive the purchase, so they expire on their own. */
const TTL_SECONDS = 15 * 60;
const KEY_PREFIX = "a2a:task:";

declare global {
  // eslint-disable-next-line no-var
  var __x402A2ATasks: Map<string, A2ATaskRecord> | undefined;
}

const memStore = (globalThis.__x402A2ATasks ??= new Map<string, A2ATaskRecord>());

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_ENABLED = Boolean(REDIS_URL && REDIS_TOKEN);

/** Which backend this process is using — surfaced in the UI/README. */
export function storeMode(): "redis" | "memory" {
  return REDIS_ENABLED ? "redis" : "memory";
}

/** Run a single Upstash REST command and return its result. */
async function redis(
  command: (string | number)[],
  url = REDIS_URL!,
  token = REDIS_TOKEN!,
): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(command),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`store responded ${res.status}`);
  const data = (await res.json()) as { result?: unknown; error?: string };
  if (data.error) throw new Error(data.error);
  return data.result;
}

export async function saveTask(taskId: string, record: A2ATaskRecord): Promise<void> {
  memStore.set(taskId, record);
  if (!REDIS_ENABLED) return;
  try {
    await redis(["SET", `${KEY_PREFIX}${taskId}`, JSON.stringify(record), "EX", TTL_SECONDS]);
  } catch {
    /* Local copy still serves this instance; the durable write is best-effort. */
  }
}

export async function getTask(taskId: string): Promise<A2ATaskRecord | undefined> {
  if (REDIS_ENABLED) {
    try {
      const raw = await redis(["GET", `${KEY_PREFIX}${taskId}`]);
      if (typeof raw === "string") return JSON.parse(raw) as A2ATaskRecord;
    } catch {
      /* Fall through to the local copy. */
    }
  }
  return memStore.get(taskId);
}
