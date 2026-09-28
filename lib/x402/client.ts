import {
  type Address,
  type Hex,
  type WalletClient,
  bytesToHex,
} from "viem";
import {
  type EIP3009Authorization,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
} from "./types";
import { decodePaymentRequired, encodePaymentPayload } from "./encode";

/**
 * Client-side x402 logic — the paying agent. Given an HTTP 402 response, the
 * agent:
 *   1. decodes PAYMENT-REQUIRED (which schemes/amounts/payees are accepted),
 *   2. picks a requirement (first acceptable one),
 *   3. signs an EIP-3009 transferWithAuthorization for its wallet,
 *   4. retries the request with PAYMENT-SIGNATURE.
 *
 * The signature is "gasless": the agent signs off-chain; the server (or
 * facilitator) broadcasts the transfer. This is what keeps per-task agent
 * micropayments cheap.
 */

/** Parse an HTTP Response's PAYMENT-REQUIRED header into the typed object. */
export function parsePaymentRequired(response: Response): PaymentRequired {
  const header = response.headers.get("payment-required");
  if (!header) throw new Error("Response is not an x402 challenge: missing PAYMENT-REQUIRED");
  return decodePaymentRequired(header);
}

/** Pick the first requirement the agent's wallet can satisfy. */
export function pickRequirement(
  required: PaymentRequired,
  opts: { scheme?: string; network?: string } = {},
): PaymentRequirements {
  const match = required.accepts.find(
    (r) =>
      (!opts.scheme || r.scheme === opts.scheme) &&
      (!opts.network || r.network === opts.network),
  );
  if (!match) {
    throw new Error(
      `No acceptable payment requirement (scheme=${opts.scheme ?? "*"}, network=${opts.network ?? "*"})`,
    );
  }
  return match;
}

/** Fresh 32-byte nonce for EIP-3009 replay protection. */
export function newNonce(): Hex {
  const bytes = new Uint8Array(32);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    // Node fallback (SSR / scripts).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("node:crypto") as typeof import("node:crypto");
    nodeCrypto.randomFillSync(bytes);
  }
  return bytesToHex(bytes);
}

/**
 * Sign the EIP-3009 transferWithAuthorization for the agent wallet. Uses
 * `walletClient.signTypedData`, which resolves the right signer from the
 * wallet's accounts.
 */
export async function signTransferWithAuthorization(params: {
  walletClient: WalletClient;
  tokenAddress: Address;
  tokenName: string;
  auth: Omit<EIP3009Authorization, "nonce"> & { nonce?: Hex };
}): Promise<{ auth: EIP3009Authorization; signature: Hex }> {
  const { walletClient, tokenAddress, tokenName } = params;
  const auth: EIP3009Authorization = {
    ...params.auth,
    nonce: params.auth.nonce ?? newNonce(),
  };

  const account = walletClient.account;
  if (!account) throw new Error("Wallet client has no account — connect a wallet first");
  const chain = walletClient.chain;
  if (!chain) throw new Error("Wallet client has no chain — set Fuji before paying");

  const signature = await walletClient.signTypedData({
    account,
    domain: {
      name: tokenName,
      version: "1",
      chainId: chain.id,
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
    } as const,
    primaryType: "TransferWithAuthorization",
    message: {
      from: auth.from,
      to: auth.to,
      value: BigInt(auth.value),
      validAfter: BigInt(auth.validAfter),
      validBefore: BigInt(auth.validBefore),
      nonce: auth.nonce,
    } as never,
  } as never);

  return { auth, signature };
}

/** Build the full PaymentPayload object for PAYMENT-SIGNATURE. */
export function buildPaymentPayload(params: {
  required: PaymentRequired;
  accepted: PaymentRequirements;
  auth: EIP3009Authorization;
  signature: Hex;
}): PaymentPayload {
  return {
    x402Version: 2,
    resource: params.required.resource,
    accepted: params.accepted,
    payload: {
      signature: params.signature,
      authorization: params.auth,
    },
  };
}

/** Convenience: encode a PaymentPayload for the PAYMENT-SIGNATURE header. */
export function encodeSignatureHeader(payload: PaymentPayload): string {
  return encodePaymentPayload(payload);
}

export { encodePaymentPayload };
export type { PaymentPayload };
