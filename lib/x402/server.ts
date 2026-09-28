import {
  type Address,
  type Hex,
  encodeAbiParameters,
  getAddress,
  hashTypedData,
  parseAbiParameters,
  verifyTypedData,
} from "viem";
import {
  type Caip2ChainId,
  type EIP3009Authorization,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentRequired,
  type ResourceInfo,
  type SettlementResponse,
  type VerifyResponse,
  NATIVE_ASSET,
} from "./types";
import { encodePaymentRequired, decodePaymentPayload } from "./encode";

/**
 * Server-side x402 logic: build PaymentRequired responses and verify /
 * settle PaymentPayloads. A resource server can call this directly, or
 * delegate to the facilitator API routes (app/api/x402/*).
 *
 * Scheme: "exact" on EVM networks, settled via EIP-3009
 * `transferWithAuthorization` (ERC-20) or a plain value transfer (native
 * asset). Network: eip155:43113 (Avalanche Fuji).
 */

export interface X402ServerOptions {
  /** Where the agent's payment is collected (your AgentPayments pool). */
  payTo: Address;
  /** Settlement token contract address, or NATIVE_ASSET for AVAX. */
  asset: Address | typeof NATIVE_ASSET;
  /** CAIP-2 chain id, e.g. "eip155:43113". */
  network: Caip2ChainId;
  /** Fixed price for the "exact" scheme, in atomic units. */
  amount: string;
  /** EIP-3009 token decimals — used to scale human amounts. */
  decimals?: number;
}

/** Scale a human decimal amount to atomic units. */
export function toAtomic(amount: string, decimals: number): string {
  const [int, frac = ""] = amount.split(".");
  const padded = (frac + "0".repeat(decimals)).slice(0, decimals);
  return (BigInt(int || "0") * 10n ** BigInt(decimals) + BigInt(padded || "0")).toString();
}

/** Format atomic units back to a human decimal string. */
export function fromAtomic(amount: string | bigint, decimals: number): string {
  const a = BigInt(amount);
  const divisor = 10n ** BigInt(decimals);
  const int = a / divisor;
  const frac = (a % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int.toString();
}

/**
 * Build the PaymentRequired object + header for a protected resource.
 */
export function createPaymentRequired(
  resource: ResourceInfo,
  opts: X402ServerOptions,
  errorMsg = "PAYMENT-SIGNATURE header is required",
): { paymentRequired: PaymentRequired; header: string } {
  const requirement: PaymentRequirements = {
    scheme: "exact",
    network: opts.network,
    amount: opts.amount,
    asset: opts.asset,
    payTo: opts.payTo,
    maxTimeoutSeconds: 300,
    extra: {
      name: opts.asset === NATIVE_ASSET ? "AVAX" : "AgentToken",
      version: "1",
      decimals: opts.decimals ?? 18,
    },
  };

  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    error: errorMsg,
    resource,
    accepts: [requirement],
  };

  return { paymentRequired, header: encodePaymentRequired(paymentRequired) };
}

/**
 * Extract and decode the PAYMENT-SIGNATURE header from a request.
 * Returns null when absent or malformed.
 */
export function parsePaymentSignature(headers: Headers): PaymentPayload | null {
  const raw = headers.get("payment-signature");
  if (!raw) return null;
  try {
    // Dynamic import keeps encode.ts (dependency-free) out of the hot path;
    // this never rejects for a valid Base64 header.
    return decodePaymentPayload(raw);
  } catch {
    return null;
  }
}

/**
 * Off-chain verification — the "verify" half of the facilitator. Checks the
 * EIP-3009 authorization shape and that the agent chose exactly the
 * requirement the server advertised. Full on-chain checks (signature,
 * balance, simulation) happen in the settle step / by the facilitator.
 */
export function verifyPayment(
  payload: PaymentPayload,
  expected: PaymentRequirements,
): VerifyResponse {
  // 1. Version must match.
  if (payload.x402Version !== 2) {
    return { isValid: false, invalidReason: "Unsupported x402Version" };
  }
  // 2. The accepted requirement must match the advertised one exactly.
  const a = payload.accepted;
  if (
    a.scheme !== expected.scheme ||
    a.network !== expected.network ||
    a.amount !== expected.amount ||
    a.asset !== expected.asset ||
    getAddress(a.payTo) !== getAddress(expected.payTo)
  ) {
    return { isValid: false, invalidReason: "Accepted requirement does not match advertised" };
  }
  // 3. Authorization shape.
  const auth = payload.payload?.authorization;
  if (!auth) return { isValid: false, invalidReason: "Missing EIP-3009 authorization" };
  if (
    !auth.from ||
    !auth.to ||
    !auth.value ||
    !auth.validAfter ||
    !auth.validBefore ||
    !auth.nonce
  ) {
    return { isValid: false, invalidReason: "Incomplete EIP-3009 authorization" };
  }
  // 4. The authorization must pay the server's address.
  if (getAddress(auth.to) !== getAddress(expected.payTo)) {
    return { isValid: false, invalidReason: "Authorization payee mismatch" };
  }
  return { isValid: true, payer: auth.from };
}

/**
 * Reconstruct the EIP-712 typed data used to sign an EIP-3009
 * transferWithAuthorization — the canonical shape both AgentToken.sol and the
 * client signer agree on.
 */
export function eip712TransferWithAuthorization(
  chainId: number,
  tokenAddress: Address,
  tokenName: string,
  auth: EIP3009Authorization,
) {
  return {
    domain: {
      name: tokenName,
      version: "1",
      chainId,
      verifyingContract: tokenAddress,
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization" as const,
    message: {
      from: auth.from,
      to: auth.to,
      value: auth.value,
      validAfter: auth.validAfter,
      validBefore: auth.validBefore,
      nonce: auth.nonce as Hex,
    },
  };
}

/** Compute the digest an agent signs (used by verifiers and tests). */
export function transferWithAuthorizationDigest(
  chainId: number,
  tokenAddress: Address,
  tokenName: string,
  auth: EIP3009Authorization,
): Hex {
  return hashTypedData(eip712TransferWithAuthorization(chainId, tokenAddress, tokenName, auth));
}

/** Verify an EIP-3009 signature off-chain using viem's typed-data verifier. */
export async function verifyEIP3009Signature(
  chainId: number,
  tokenAddress: Address,
  tokenName: string,
  auth: EIP3009Authorization,
  signature: Hex,
): Promise<boolean> {
  return verifyTypedData({
    address: getAddress(auth.from),
    domain: eip712TransferWithAuthorization(chainId, tokenAddress, tokenName, auth).domain,
    types: eip712TransferWithAuthorization(chainId, tokenAddress, tokenName, auth).types,
    primaryType: "TransferWithAuthorization",
    message: eip712TransferWithAuthorization(chainId, tokenAddress, tokenName, auth).message,
    signature,
  });
}

/** Build a SettlementResponse for the PAYMENT-RESPONSE header. */
export function buildSettlementResponse(params: {
  success: boolean;
  transaction: string;
  network: Caip2ChainId;
  payer?: Address;
  amount?: string;
  errorReason?: string;
}): SettlementResponse {
  return {
    success: params.success,
    errorReason: params.errorReason,
    payer: params.payer,
    transaction: params.transaction,
    network: params.network,
    amount: params.amount,
  };
}

/** Encode the EIP-3009 authorization into the exact ABI order the token expects. */
export function encodeAuthorizationCall(
  auth: EIP3009Authorization,
  signature: Hex,
): Hex {
  // AgentToken.transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32)
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = Number(BigInt(`0x${signature.slice(130, 132)}`));
  return encodeAbiParameters(
    parseAbiParameters(
      "address,address,uint256,uint256,uint256,bytes32,uint8,bytes32,bytes32",
    ),
    [
      auth.from as Address,
      auth.to as Address,
      BigInt(auth.value),
      BigInt(auth.validAfter),
      BigInt(auth.validBefore),
      auth.nonce as Hex,
      v,
      r,
      s,
    ],
  );
}

// Re-export helper for clients.
export type { EIP3009Authorization };
