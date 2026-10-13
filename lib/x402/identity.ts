import { getAddress, verifyMessage, type Address, type Hex } from "viem";

/**
 * Payer identity — a claim the merchant actually verifies, not just a URI it
 * advertises on the agent card.
 *
 * The claim is an EIP-191 `personal_sign` signature over a domain-separated,
 * address-bound message:
 *
 *   x402-identity:v1:<chainId>:<subject>:<issuedAt>
 *
 * `subject` is the payer address (the EIP-3009 `from`), so a receipt can carry
 * *which attester vouched for which payer* rather than only which key paid.
 *
 * Trust model, stated plainly — the signature check and the trust decision are
 * deliberately two separate outputs:
 *   - `verified`  = the signature is cryptographically real
 *   - `trust`     = whether we accept the signer as an attester
 *       · allowlist configured → "allowlisted" (in list) / "untrusted" (not)
 *       · no allowlist         → "self-attested" (attester == subject) / "untrusted"
 *
 * Settlement never depends on any of this. Identity is additive to the receipt.
 */

export const IDENTITY_HEADER = "x-identity-attestation";

export type IdentityAttestation = {
  attester: Address;
  subject: Address;
  issuedAt: number;
  signature: Hex;
};

export type IdentityTrust = "allowlisted" | "self-attested" | "untrusted" | "none";

export type IdentityVerification = {
  verified: boolean;
  trust: IdentityTrust;
  attester?: Address;
  subject?: Address;
  issuedAt?: number;
  reason?: string;
};

/** The canonical message an attester signs. Clients must build it with this fn. */
export function identityMessage(chainId: number, subject: Address, issuedAt: number): string {
  return `x402-identity:v1:${chainId}:${getAddress(subject).toLowerCase()}:${issuedAt}`;
}

/** Configured allowlist of attester addresses (empty = no allowlist). */
export function identityAllowlist(): string[] {
  return (process.env.IDENTITY_ATTESTER || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/** Wire format: base64 of the attestation JSON. `btoa` exists in browsers and Node. */
export function encodeIdentityHeader(att: IdentityAttestation): string {
  return btoa(JSON.stringify(att));
}

export function decodeIdentityAttestation(raw: string): IdentityAttestation | null {
  const text = (() => {
    try {
      return atob(raw);
    } catch {
      return raw; // tolerate a plain-JSON encoding too
    }
  })();
  try {
    const parsed = JSON.parse(text) as IdentityAttestation;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** Read an attestation off an HTTP request header, if the client sent one. */
export function parseIdentityHeader(headers: Headers): IdentityAttestation | null {
  const raw = headers.get(IDENTITY_HEADER);
  return raw ? decodeIdentityAttestation(raw) : null;
}

/** Verify one attestation against the chain id and the attester allowlist. */
export async function verifyIdentityAttestation(
  att: IdentityAttestation | null | undefined,
  chainId: number,
): Promise<IdentityVerification> {
  if (!att?.attester || !att?.subject || !att?.signature || !att?.issuedAt) {
    return { verified: false, trust: "none", reason: "Incomplete identity attestation" };
  }

  let attester: Address;
  let subject: Address;
  try {
    attester = getAddress(att.attester);
    subject = getAddress(att.subject);
  } catch {
    return { verified: false, trust: "none", reason: "Invalid attester/subject address" };
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyMessage({
      address: attester,
      message: identityMessage(chainId, subject, Number(att.issuedAt)),
      signature: att.signature,
    });
  } catch {
    return { verified: false, trust: "none", reason: "Malformed signature" };
  }

  if (!signatureValid) {
    return { verified: false, trust: "none", reason: "Signature does not match the attestation" };
  }

  const allow = identityAllowlist();
  const trust: IdentityTrust = allow.length
    ? allow.includes(attester.toLowerCase())
      ? "allowlisted"
      : "untrusted"
    : attester.toLowerCase() === subject.toLowerCase()
      ? "self-attested"
      : "untrusted";

  return { verified: true, trust, attester, subject, issuedAt: Number(att.issuedAt) };
}
