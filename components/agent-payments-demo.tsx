"use client";

import {
  Button,
  ConnectAvalanche,
  humanizeError,
  shortenAddress,
  useAvaKit,
} from "@avakit/react";
import { getPublicClient, toViemChain } from "@avakit/core";
import { ArrowDown, CheckCircle2, Loader2, Lock, ShieldCheck, Wallet } from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import {
  buildPaymentPayload,
  parsePaymentRequired,
  pickRequirement,
  signTransferWithAuthorization,
} from "@/lib/x402/client";
import type { PaymentRequired, SettlementResponse } from "@/lib/x402/types";
import { decodeSettlementResponse } from "@/lib/x402/encode";

/**
 * AI Agent × x402 payment demo.
 *
 * Runs a full x402 payment loop against the demo resource API:
 *  1. Agent posts a task → server answers 402 + PAYMENT-REQUIRED.
 *  2. Agent picks the "exact" requirement (Fuji, AgentToken, fixed amount).
 *  3. Agent's wallet signs an EIP-3009 transferWithAuthorization (gasless).
 *  4. Agent retries with PAYMENT-SIGNATURE → server verifies + settles.
 *  5. Server returns the job result + PAYMENT-RESPONSE receipt.
 *
 * The token address is configured server-side (env X402_TOKEN); for the demo
 * the client signs against the token the server advertises in the challenge,
 * so the panel works with zero client config.
 */

function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  return (
    <Button
      variant="outline"
      size="icon"
      aria-label="Toggle theme"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      {resolvedTheme === "dark" ? "☀" : "☾"}
    </Button>
  );
}

export function AgentPaymentsDemo() {
  const { address, provider, chain, status } = useAvaKit();
  const isConnected = status === "connected";

  const [task, setTask] = useState("generate-report");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PaymentRequired | null>(null);
  const [signatureHeader, setSignatureHeader] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<SettlementResponse | null>(null);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);

  const walletClient = useMemo(() => {
    if (!address || !provider) return null;
    return createWalletClient({
      chain: toViemChain(chain),
      transport: custom(provider),
      account: address,
    });
  }, [address, provider, chain]);

  /** Step 1 — request the task without payment: expect a 402 challenge. */
  async function requestTask() {
    setBusy(true);
    setError(null);
    setJob(null);
    setSettlement(null);
    setSignatureHeader(null);
    setChallenge(null);
    try {
      setStep("agent → api: POST /api/agent-task (no payment)");
      const res = await fetch("/api/agent-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (res.status === 402) {
        const required = parsePaymentRequired(res);
        setChallenge(required);
        setStep("api → agent: 402 + PAYMENT-REQUIRED");
      } else {
        const data = await res.json().catch(() => null);
        setError(`Expected 402 challenge, got ${res.status}`);
        setJob(data as Record<string, unknown>);
      }
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  /** Step 2 — sign the EIP-3009 authorization and retry with the header. */
  async function payAndRetry() {
    if (!challenge || !walletClient || !address) return;
    setBusy(true);
    setError(null);
    setJob(null);
    setSettlement(null);
    try {
      const requirement = pickRequirement(challenge, { scheme: "exact", network: "eip155:43113" });
      const asset = requirement.asset as Address;
      const tokenName = (requirement.extra?.name as string) || "AgentToken";

      setStep("agent wallet: sign EIP-3009 transferWithAuthorization (gasless)");
      const now = Math.floor(Date.now() / 1000);
      const { auth, signature } = await signTransferWithAuthorization({
        walletClient,
        tokenAddress: asset,
        tokenName,
        auth: {
          from: address,
          to: requirement.payTo as Address,
          value: requirement.amount,
          validAfter: String(now - 60),
          validBefore: String(now + 300),
        },
      });

      const payload = buildPaymentPayload({ required: challenge, accepted: requirement, auth, signature });
      const header = btoa(JSON.stringify(payload));
      setSignatureHeader(header);

      setStep("agent → api: retry with PAYMENT-SIGNATURE");
      const res = await fetch("/api/agent-task", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": header,
        },
        body: JSON.stringify({ task }),
      });

      const body = await res.json().catch(() => null);
      const respHeader = res.headers.get("payment-response");
      if (respHeader) setSettlement(decodeSettlementResponse(respHeader));

      if (res.ok) {
        setJob(body as Record<string, unknown>);
        setStep("api → agent: 200 + job result + PAYMENT-RESPONSE");
      } else {
        setError(body?.reason || `Payment rejected (${res.status})`);
      }
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-6 px-6 py-12">
      <header className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold">agent × x402 · avalanche</span>
        <div className="flex items-center gap-2">
          <ConnectAvalanche />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          AI Agent 链上微支付底座 <span className="align-middle text-xs font-normal text-muted-foreground">x402 · EIP-3009 · Fuji</span>
        </h1>
        <p className="text-muted-foreground text-sm">
          Agent 完成任务后通过 x402 协议自动发起链上微支付——无需账号、无需 API key、
          无需订阅。签名 gasless（EIP-3009），结算由服务端广播，链上全程可审计。
        </p>
      </div>

      {!isConnected || !address || !provider ? (
        <div className="text-muted-foreground rounded-xl border border-dashed p-10 text-center text-sm">
          连接钱包后即可演示 Agent 支付闭环（burner 钱包零门槛可试）。
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {/* Task input */}
          <div className="flex flex-col gap-2 rounded-xl border p-5">
            <label className="text-sm font-medium">Agent 任务（付费资源）</label>
            <select
              className="border-input bg-transparent rounded-md border px-3 py-2 text-sm"
              value={task}
              onChange={(e) => setTask(e.target.value)}
            >
              <option value="generate-report">generate-report — 生成周报</option>
              <option value="research-summary">research-summary — 研究摘要</option>
              <option value="code-review">code-review — 代码审查</option>
              <option value="data-insight">data-insight — 数据洞察</option>
            </select>
            <Button disabled={busy} onClick={requestTask}>
              {busy && step?.startsWith("agent → api") ? <Loader2 className="animate-spin" /> : null}
              ① 发起任务（触发 402）
            </Button>
          </div>

          {/* Challenge card */}
          {challenge ? (
            <div className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Lock className="size-4" /> HTTP 402 Payment Required
              </div>
              {challenge.accepts.map((r) => (
                <div key={r.network + r.asset} className="flex flex-col gap-1 rounded-lg bg-background/60 p-3 text-xs">
                  <Row label="scheme" value={r.scheme} mono />
                  <Row label="network" value={r.network} mono />
                  <Row label="amount" value={formatAmount(r.amount, (r.extra?.decimals as number) ?? 18)} mono />
                  <Row label="asset" value={r.asset} mono />
                  <Row label="payTo" value={shortenAddress(r.payTo, 8)} mono />
                </div>
              ))}
              <Button disabled={busy} onClick={payAndRetry} variant="default">
                {busy && step?.startsWith("agent wallet") ? <Loader2 className="animate-spin" /> : null}
                ② 签名授权并支付（EIP-3009，gasless）
              </Button>
            </div>
          ) : null}

          {/* Progress / result */}
          {step ? (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <ArrowDown className="size-3" /> <span className="font-mono">{step}</span>
            </div>
          ) : null}

          {signatureHeader ? (
            <div className="flex flex-col gap-2 rounded-xl border border-green-500/40 bg-green-500/5 p-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="size-4" /> PAYMENT-SIGNATURE 已生成
              </div>
              <p className="font-mono break-all text-[10px] text-muted-foreground">{signatureHeader}</p>
            </div>
          ) : null}

          {settlement ? (
            <div className="flex flex-col gap-2 rounded-xl border border-green-500/40 bg-green-500/5 p-4 text-xs">
              <div className="flex items-center gap-2 text-sm font-medium">
                <CheckCircle2 className="size-4" /> 结算回执（PAYMENT-RESPONSE）
              </div>
              <Row label="success" value={String(settlement.success)} mono />
              <Row label="tx" value={shortenAddress(settlement.transaction, 10)} mono />
              <Row label="network" value={settlement.network} mono />
              {settlement.payer ? <Row label="payer" value={shortenAddress(settlement.payer, 8)} mono /> : null}
            </div>
          ) : null}

          {job ? (
            <div className="flex flex-col gap-2 rounded-xl border p-5">
              <div className="text-sm font-medium">任务结果（已付费解锁）</div>
              <pre className="bg-muted rounded-md p-3 text-[11px] overflow-auto">
                {JSON.stringify(job, null, 2)}
              </pre>
            </div>
          ) : null}

          {error ? (
            <p className="border-destructive text-destructive rounded-md border px-3 py-2 text-sm font-medium">
              {error}
            </p>
          ) : null}
        </div>
      )}

      <footer className="flex items-center gap-2 border-t pt-4 text-xs text-muted-foreground">
        <Wallet className="size-3" />
        {isConnected && address ? (
          <span>
            wallet: {shortenAddress(address, 6)} · chain: {chain.name} (43113)
          </span>
        ) : (
          <span>未连接钱包</span>
        )}
      </footer>
    </div>
  );
}

function formatAmount(atomic: string, decimals: number): string {
  try {
    const a = BigInt(atomic);
    const div = 10n ** BigInt(decimals);
    const int = a / div;
    const frac = (a % div).toString().padStart(decimals, "0").replace(/0+$/, "");
    return frac ? `${int}.${frac}` : int.toString();
  } catch {
    return atomic;
  }
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono" : ""}>{value}</span>
    </div>
  );
}
