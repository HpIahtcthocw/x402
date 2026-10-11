import {
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  getContract,
  parseAbi,
} from "viem";
import {
  type Caip2ChainId,
  type EIP3009Authorization,
  type PaymentPayload,
  type PaymentRequirements,
  type SettlementResponse,
} from "./types";
import { verifyPayment, verifyEIP3009Signature } from "./server";

/** CAIP-2 → chain metadata we can settle on. */
export const SUPPORTED_NETWORKS: Record<
  Caip2ChainId,
  { chainId: number; name: string; explorer: string }
> = {
  "eip155:84532": { chainId: 84532, name: "Base Sepolia", explorer: "https://sepolia.basescan.org" },
  "eip155:8453": { chainId: 8453, name: "Base", explorer: "https://basescan.org" },
};

/** Minimal ABI of AgentToken.transferWithAuthorization — the only on-chain
 * call a facilitator needs to make to settle an exact/EVM payment. */
const AGENT_TOKEN_ABI = parseAbi([
  "function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)",
  "function balanceOf(address) view returns (uint256)",
  "function name() view returns (string)",
]);

/** Minimal ABI of AgentPayments.recordERC20 — books a settled payment into
 * the on-chain audit ledger after the token transfer confirms. */
const AGENT_PAYMENTS_ABI = parseAbi([
  "function recordERC20(bytes32 paymentId,address payer,address token,uint256 amount)",
]);

export interface FacilitatorOptions {
  publicClient: PublicClient;
  walletClient: WalletClient;
}

/**
 * Facilitator settlement for the exact/EVM scheme.
 *
 * Verification checklist (mirrors the x402 spec, §6.1.2):
 *   1. shape + requirement match            (verifyPayment)
 *   2. EIP-3009 signature is valid          (verifyEIP3009Signature, off-chain)
 *   3. payer has balance                     (checked on-chain by the token)
 *   4. amount matches requirement            (already ensured by shape check)
 *   5. time window valid                     (checked on-chain by the token)
 *   6. parameters match the requirement      (shape check above)
 *   7. broadcast transferWithAuthorization   (settlement)
 */
export async function settleExact(
  opts: FacilitatorOptions,
  params: {
    paymentPayload: PaymentPayload;
    paymentRequirements: PaymentRequirements;
    tokenAddress: Address;
    tokenName: string;
    chainId: number;
  },
): Promise<SettlementResponse> {
  const { paymentPayload: payload, paymentRequirements: req, tokenAddress, tokenName, chainId } = params;
  const network = req.network as Caip2ChainId;

  // Step 1 — shape + requirement match.
  const shape = verifyPayment(payload, req);
  if (!shape.isValid) {
    return {
      success: false,
      errorReason: shape.invalidReason ?? "Payment payload rejected",
      transaction: "",
      network,
    };
  }

  const auth = payload.payload.authorization;
  const signature = payload.payload.signature as Hex;

  // Step 2 — signature validity (off-chain, before touching gas).
  const sigOk = await verifyEIP3009Signature(chainId, tokenAddress, tokenName, auth, signature);
  if (!sigOk) {
    return { success: false, errorReason: "Invalid EIP-3009 signature", transaction: "", network };
  }

  // Step 7 — broadcast the transfer (the agent signed gasless; we pay gas).
  try {
    const token = getContract({
      address: tokenAddress,
      abi: AGENT_TOKEN_ABI,
      client: { public: opts.publicClient, wallet: opts.walletClient },
    });
    const sig = splitSignature(signature);
    const account = opts.walletClient.account;
    if (!account) throw new Error("Facilitator wallet has no account");
    const txHash = await token.write.transferWithAuthorization(
      [
        auth.from as Address,
        auth.to as Address,
        BigInt(auth.value),
        BigInt(auth.validAfter),
        BigInt(auth.validBefore),
        auth.nonce as Hex,
        sig.v,
        sig.r,
        sig.s,
      ],
      {
        chain: opts.walletClient.chain,
        account,
      },
    );

    // Wait for the token transfer to confirm before booking the ledger entry,
    // so a reorg can't leave a PaymentRecorded with no actual token movement.
    await opts.publicClient.waitForTransactionReceipt({ hash: txHash });

    // Book the payment into the AgentPayments on-chain audit ledger.
    // paymentId = EIP-3009 nonce (bytes32, globally unique per authorization).
    const pool = getContract({
      address: req.payTo as Address,
      abi: AGENT_PAYMENTS_ABI,
      client: { public: opts.publicClient, wallet: opts.walletClient },
    });
    const recordTxHash = await pool.write.recordERC20(
      [auth.nonce as Hex, auth.from as Address, tokenAddress, BigInt(auth.value)],
      { chain: opts.walletClient.chain, account },
    );
    await opts.publicClient.waitForTransactionReceipt({ hash: recordTxHash });

    return {
      success: true,
      transaction: txHash,
      network,
      payer: auth.from,
      amount: auth.value,
      extensions: { paymentRecordTx: recordTxHash, paymentId: auth.nonce },
    };
  } catch (e) {
    return {
      success: false,
      errorReason: e instanceof Error ? e.message : String(e),
      transaction: "",
      network,
      payer: auth.from,
    };
  }
}

/** Split a 65-byte hex signature into v/r/s. */
export function splitSignature(signature: Hex): { v: number; r: Hex; s: Hex } {
  const r = `0x${signature.slice(2, 66)}` as Hex;
  const s = `0x${signature.slice(66, 130)}` as Hex;
  const v = Number(BigInt(`0x${signature.slice(130, 132)}`));
  return { v, r, s };
}

export type { EIP3009Authorization };
