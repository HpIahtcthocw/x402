import type { PaymentPayload, PaymentRequired, SettlementResponse } from "./types";

/**
 * x402 V2 transport encoding: every protocol object travels in a single HTTP
 * header as Base64-encoded JSON. The spec requires Base64 (not base64url) —
 * be strict about it so headers interop with Coinbase's reference impl.
 */

/** Base64-encode a JSON-serializable object for a PAYMENT-* header. */
export function encodeObject<T>(value: T): string {
  const json = JSON.stringify(value);
  return btoa(unescape(encodeURIComponent(json)));
}

/** Decode a PAYMENT-* header value back into its typed object. */
export function decodeObject<T>(header: string): T {
  // btoa cannot hold raw UTF-8; mirror the encode path.
  const json = decodeURIComponent(escape(atob(header)));
  return JSON.parse(json) as T;
}

export function encodePaymentRequired(value: PaymentRequired): string {
  return encodeObject(value);
}

export function decodePaymentRequired(header: string): PaymentRequired {
  return decodeObject<PaymentRequired>(header);
}

export function encodePaymentPayload(value: PaymentPayload): string {
  return encodeObject(value);
}

export function decodePaymentPayload(header: string): PaymentPayload {
  return decodeObject<PaymentPayload>(header);
}

export function encodeSettlementResponse(value: SettlementResponse): string {
  return encodeObject(value);
}

export function decodeSettlementResponse(header: string): SettlementResponse {
  return decodeObject<SettlementResponse>(header);
}
