/**
 * x402 protocol core types (V2), matching the Coinbase x402 specification
 * (specs/x402-specification-v2.md). Transport-agnostic: these exact shapes are
 * what get Base64-encoded into the PAYMENT-REQUIRED / PAYMENT-SIGNATURE /
 * PAYMENT-RESPONSE HTTP headers.
 */

/** CAIP-2 chain identifier, e.g. "eip155:43113" (Avalanche Fuji). */
export type Caip2ChainId = string;

/** ResourceInfo — describes the protected resource the agent is paying for. */
export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
}

/** A single acceptable payment requirement offered by the server. */
export interface PaymentRequirements {
  /** Payment scheme identifier, e.g. "exact". */
  scheme: string;
  /** Blockchain network in CAIP-2 format, e.g. "eip155:43113". */
  network: Caip2ChainId;
  /** Required payment amount in atomic token units. */
  amount: string;
  /** Token contract address, or "0x0"/ISO code for the native asset. */
  asset: string;
  /** Recipient wallet address. */
  payTo: string;
  /** Maximum time allowed for payment completion (seconds). */
  maxTimeoutSeconds: number;
  /** Scheme-specific extra info (e.g. {name, version} for EIP-3009). */
  extra?: Record<string, unknown>;
}

/** Server → client: why payment is required + what it accepts. */
export interface PaymentRequired {
  x402Version: 2;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

/** EIP-3009 authorization parameters (exact scheme, EVM). */
export interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** Scheme-specific payment payload (exact/EVM: signature + authorization). */
export interface PaymentPayload {
  x402Version: 2;
  resource?: ResourceInfo;
  /** The payment requirement the client accepted. */
  accepted: PaymentRequirements;
  payload: {
    signature: string;
    authorization: EIP3009Authorization;
  };
  extensions?: Record<string, unknown>;
}

/** Server → client: result of settlement. */
export interface SettlementResponse {
  success: boolean;
  errorReason?: string;
  payer?: string;
  /** Blockchain transaction hash (empty string if settlement failed). */
  transaction: string;
  network: Caip2ChainId;
  amount?: string;
  extensions?: Record<string, unknown>;
}

/** Facilitator: verification result (POST /verify). */
export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  payer?: string;
}

/** Payloads for the facilitator HTTP API. */
export interface VerifyRequest {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface SettleRequest {
  x402Version: 2;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

/** Well-known constants. */
export const X402_VERSION = 2 as const;
export const X402_HEADER_REQUIRED = "payment-required";
export const X402_HEADER_SIGNATURE = "payment-signature";
export const X402_HEADER_RESPONSE = "payment-response";

/** Native asset sentinel used across EVM x402 implementations. */
export const NATIVE_ASSET = "0x0";
