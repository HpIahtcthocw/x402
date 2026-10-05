import type { PaymentRequirements } from "./types";

/**
 * In-memory A2A task store — maps taskId → the PaymentRequirements the
 * merchant advertised for that task. Per the A2A-x402 v0.2 spec, the
 * Merchant Agent uses the taskId to retrieve the original requirements when
 * a payment submission arrives, so it can validate that the signed payload
 * corresponds to a payment option it actually offered.
 *
 * Dev/demo: a module-level Map is sufficient (single Next.js instance).
 * Production: swap for KV/DB (the store interface stays identical).
 */

export interface A2ATaskRecord {
  task: string;
  requirement: PaymentRequirements;
  createdAt: number;
}

const taskStore = new Map<string, A2ATaskRecord>();

export function saveTask(taskId: string, record: A2ATaskRecord): void {
  taskStore.set(taskId, record);
}

export function getTask(taskId: string): A2ATaskRecord | undefined {
  return taskStore.get(taskId);
}
