"use client";

import {
  Button,
  ConnectAvalanche,
  humanizeError,
  shortenAddress,
  useAvaKit,
} from "@avakit/react";
import { getPublicClient, toViemChain } from "@avakit/core";
import {
  ArrowDownRight,
  CheckCircle2,
  CircleDashed,
  CircleDot,
  FileText,
  Loader2,
  Lock,
  PenLine,
  Send,
  ShieldCheck,
  Wallet,
  XCircle,
} from "lucide-react";
import { useMemo, useState } from "react";
import { createWalletClient, custom, type Address } from "viem";
import {
  buildPaymentPayload,
  parsePaymentRequired,
  pickRequirement,
  signTransferWithAuthorization,
} from "@/lib/x402/client";
import type { PaymentRequired, SettlementResponse } from "@/lib/x402/types";
import { decodeSettlementResponse, encodePaymentPayload } from "@/lib/x402/encode";

/**
 * AI Agent × x402 payment demo — dark Web3 console.
 *
 * Runs a full x402 payment loop against the demo resource API:
 *  1. Agent posts a task → server answers 402 + PAYMENT-REQUIRED.
 *  2. Agent picks the "exact" requirement (Fuji, AgentToken, fixed amount).
 *  3. Agent's wallet signs an EIP-3009 transferWithAuthorization (gasless).
 *  4. Agent retries with PAYMENT-SIGNATURE → server verifies + settles.
 *  5. Server returns the job result + PAYMENT-RESPONSE receipt.
 */

const TASKS = [
  { id: "generate-report", label: "generate-report", desc: "生成周报 · 结构化摘要" },
  { id: "research-summary", label: "research-summary", desc: "研究摘要 · 多源综合" },
  { id: "code-review", label: "code-review", desc: "代码审查 · 静态分析" },
  { id: "data-insight", label: "data-insight", desc: "数据洞察 · 指标归因" },
] as const;

const FLOW = [
  {
    icon: Send,
    title: "Agent 发起请求",
    desc: "POST /api/agent-task，携带任务意图（无账号、无 API key）",
  },
  {
    icon: Lock,
    title: "收到 402 挑战",
    desc: "服务端返回 PAYMENT-REQUIRED：金额 · 收款方 · 网络 · 超时",
  },
  {
    icon: PenLine,
    title: "钱包签名授权",
    desc: "EIP-3009 transferWithAuthorization，离线签名 · 零 gas 费",
  },
  {
    icon: CheckCircle2,
    title: "链上结算完成",
    desc: "服务端验签并广播结算，返回任务结果 + PAYMENT-RESPONSE 回执",
  },
] as const;

type LedgerEntry = {
  time: string;
  task: string;
  amount: string;
  status: "CHALLENGED" | "SETTLED" | "FAILED";
  tx?: string;
};

export function AgentPaymentsDemo() {
  const { address, provider, chain, status } = useAvaKit();
  const isConnected = status === "connected";

  const [task, setTask] = useState<(typeof TASKS)[number]["id"]>("generate-report");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PaymentRequired | null>(null);
  const [signatureHeader, setSignatureHeader] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<SettlementResponse | null>(null);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);

  const walletClient = useMemo(() => {
    if (!address || !provider) return null;
    return createWalletClient({
      chain: toViemChain(chain),
      transport: custom(provider),
      account: address,
    });
  }, [address, provider, chain]);

  const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

  /** Faucet — mint 1 AGT test token to the connected wallet (one click). */
  async function claimAGT() {
    if (!address) return;
    setFaucetBusy(true);
    setFaucetMsg(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFaucetMsg({ ok: false, text: data?.error || `Faucet error (${res.status})` });
        return;
      }
      setFaucetMsg({
        ok: true,
        text: data.demo ? "Demo 模式 — 已模拟领取 1 AGT" : `已领取 1 AGT · tx ${(data.tx || "").slice(0, 12)}…`,
        tx: data.tx,
      });
    } catch (e) {
      setFaucetMsg({ ok: false, text: humanizeError(e) });
    } finally {
      setFaucetBusy(false);
    }
  }

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
        setLedger((l) => [
          { time: now(), task, amount: "0.001 AGT", status: "CHALLENGED" },
          ...l,
        ]);
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
      const nowSec = Math.floor(Date.now() / 1000);
      const { auth, signature } = await signTransferWithAuthorization({
        walletClient,
        tokenAddress: asset,
        tokenName,
        auth: {
          from: address,
          to: requirement.payTo as Address,
          value: requirement.amount,
          validAfter: String(nowSec - 60),
          validBefore: String(nowSec + 300),
        },
      });

      const payload = buildPaymentPayload({ required: challenge, accepted: requirement, auth, signature });
      const header = encodePaymentPayload(payload);
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
        setLedger((l) => [
          { time: now(), task, amount: "0.001 AGT", status: "SETTLED", tx: settlement?.transaction },
          ...l,
        ]);
      } else {
        setError(body?.reason || `Payment rejected (${res.status})`);
        setLedger((l) => [{ time: now(), task, amount: "0.001 AGT", status: "FAILED" }, ...l]);
      }
    } catch (e) {
      setError(humanizeError(e));
      setLedger((l) => [{ time: now(), task, amount: "0.001 AGT", status: "FAILED" }, ...l]);
    } finally {
      setBusy(false);
    }
  }

  const stage =
    step === null
      ? 0
      : step.includes("402")
        ? 1
        : step.includes("sign")
          ? 2
          : step.includes("200")
            ? 4
            : 3;

  return (
    <div className="flex flex-col gap-5">
      {/* ── Hero: what this is, why it matters ── */}
      <section className="relative overflow-hidden rounded-2xl border border-white/8 bg-card/60 px-6 py-8 backdrop-blur">
        <div className="relative flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-[10px] font-semibold text-primary">
              ● x402 v2 · LIVE
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              EIP-3009 gasless
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              FUJI · 43113
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[10px] text-muted-foreground">
              已部署 2 合约
            </span>
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              AI Agent 链上微支付底座
            </h1>
            <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
              HTTP <span className="font-mono text-foreground">402</span> 即支付挑战 —— Agent 用{" "}
              <span className="font-mono text-primary">EIP-3009</span> 离线签名付款，链上结算自动完成。
              无需账号、无需 API key、无需订阅：把「付费能力」变成一行 HTTP 调用。
            </p>
          </div>
        </div>
      </section>

      {/* ── Protocol flow: how it works ── */}
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW.map((f, i) => (
          <div
            key={f.title}
            className="relative flex flex-col gap-2 rounded-xl border border-white/8 bg-card/60 p-4 backdrop-blur"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/70">
                step {i + 1}
              </span>
              {i < 3 ? <ArrowDownRight className="size-3.5 text-white/20" /> : null}
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <f.icon className="size-4 text-primary" />
              {f.title}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* ── Status bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-card px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="size-3.5" />
          {isConnected && address ? (
            <span>
              wallet <span className="font-mono text-foreground">{shortenAddress(address, 8)}</span>
              <span className="mx-2 text-white/15">·</span>
              chain <span className="font-mono text-foreground">{chain.name}</span>
              <span className="mx-2 text-white/15">·</span>
              price <span className="font-mono text-primary">0.001 AGT / task</span>
            </span>
          ) : (
            <span>未连接钱包 —— 连接后解锁演示工作台（burner 零门槛）</span>
          )}
        </div>
        <ConnectAvalanche />
      </div>

      {/* ── Login gate (not connected) ── */}
      {!isConnected || !address || !provider ? (
        <div className="flex flex-col gap-6 rounded-2xl border border-white/8 bg-card/40 px-6 py-12 backdrop-blur sm:px-10">
          <div className="flex flex-col items-center gap-2 text-center">
            <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
              连接钱包，解锁演示工作台
            </h2>
            <p className="max-w-xl text-sm leading-relaxed text-muted-foreground">
              这里没有传统账号密码——<span className="text-foreground">连接钱包就是登录</span>。
              三种方式任选其一，30 秒进入演示。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              {
                title: "什么是 x402",
                desc: "AI Agent 之间的 HTTP 支付协议（Linux 基金会标准，Visa / Stripe / AWS 等 40 家成员推动）",
              },
              {
                title: "演示什么",
                desc: "0.001 AGT 现场跑通「发起任务 → 402 挑战 → 签名 → 链上结算」完整闭环",
              },
              {
                title: "链上可审计",
                desc: "每笔支付上链（Avalanche Fuji），合约已部署、地址页可见，结算回执可查",
              },
            ].map((c) => (
              <div key={c.title} className="flex flex-col gap-1.5 rounded-xl border border-white/8 bg-background/50 p-4 text-left">
                <span className="text-sm font-semibold text-foreground">{c.title}</span>
                <span className="text-[11px] leading-relaxed text-muted-foreground">{c.desc}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col items-center gap-2">
            <ConnectAvalanche />
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              0.001 AGT / task · gasless EIP-3009 · 无需 API key / 订阅
            </p>
          </div>
        </div>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)_340px]">
          {/* ── Left: agent task list ── */}
          <aside className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/8 bg-card p-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold text-foreground">AGT 测试代币</span>
                <span className="font-mono text-[10px] text-muted-foreground">Fuji faucet</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                没余额？一键领取 1 AGT，即可真实支付跑通全链路。
              </p>
              <Button disabled={faucetBusy} onClick={claimAGT} className="w-full">
                {faucetBusy ? <Loader2 className="size-4 animate-spin" /> : <CircleDot className="size-4" />}
                {faucetBusy ? "领取中…" : "领取 1 AGT"}
              </Button>
              {faucetMsg ? (
                <div
                  className={
                    faucetMsg.ok
                      ? "flex flex-col gap-0.5 rounded-md border border-primary/20 bg-primary/8 px-2 py-1.5 text-[10px] text-primary"
                      : "flex flex-col gap-0.5 rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-[10px] text-red-300"
                  }
                >
                  <span>{faucetMsg.text}</span>
                  {faucetMsg.ok && faucetMsg.tx ? (
                    <a
                      href={`https://testnet.snowtrace.io/tx/${faucetMsg.tx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      testnet.snowtrace.io/tx/{faucetMsg.tx.slice(0, 10)}… ↗
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <SectionTitle>Agent 任务 · 付费资源</SectionTitle>
            <div className="flex flex-col gap-2">
              {TASKS.map((t) => {
                const active = t.id === task;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTask(t.id)}
                    className={
                      active
                        ? "flex flex-col gap-0.5 rounded-lg border border-primary/40 bg-primary/8 p-3 text-left transition"
                        : "flex flex-col gap-0.5 rounded-lg border border-white/5 bg-card p-3 text-left transition hover:border-white/15"
                    }
                  >
                    <span className="flex items-center gap-2 font-mono text-xs font-medium">
                      {active ? (
                        <CircleDot className="size-3 text-primary" />
                      ) : (
                        <FileText className="size-3 text-muted-foreground" />
                      )}
                      {t.label}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{t.desc}</span>
                  </button>
                );
              })}
            </div>
            <Button disabled={busy} onClick={requestTask} className="mt-1 w-full">
              {busy && step?.startsWith("agent → api") ? <Loader2 className="animate-spin" /> : null}
              ① 发起任务 · 触发 402
            </Button>
            <p className="text-center font-mono text-[10px] text-muted-foreground">
              POST /api/agent-task
            </p>
          </aside>

          {/* ── Center: payment flow ── */}
          <section className="flex flex-col gap-4">
            {challenge ? (
              <div className="flex flex-col gap-3 overflow-hidden rounded-xl border border-amber-400/25 bg-card backdrop-blur">
                <div className="flex items-center justify-between border-b border-white/5 bg-amber-400/8 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-sm font-semibold text-amber-300">
                    <Lock className="size-4" /> HTTP 402 · PAYMENT REQUIRED
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground">
                    x402 v2 · eip155:43113
                  </span>
                </div>
                {challenge.accepts.map((r) => (
                  <div key={r.network + r.asset} className="flex flex-col gap-3 px-4 pb-4">
                    <div className="flex items-end justify-between">
                      <span className="text-xs text-muted-foreground">amount</span>
                      <span className="font-mono text-3xl font-semibold tracking-tight text-primary">
                        {formatAmount(r.amount, (r.extra?.decimals as number) ?? 18)}{" "}
                        <span className="text-base text-muted-foreground">AGT</span>
                      </span>
                    </div>
                    <div className="flex flex-col gap-1.5 rounded-lg border border-white/5 bg-background/50 p-3 text-xs">
                      <Field label="scheme" value={r.scheme} mono />
                      <Field label="network" value={r.network} mono />
                      <Field label="asset" value={shortenAddress(r.asset, 10)} mono full={r.asset} />
                      <Field label="payTo" value={shortenAddress(r.payTo, 10)} mono full={r.payTo} />
                      <Field label="timeout" value={`${r.maxTimeoutSeconds}s`} mono />
                    </div>
                    <Button disabled={busy} onClick={payAndRetry} className="w-full">
                      {busy && step?.startsWith("agent wallet") ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldCheck className="size-4" />
                      )}
                      ② 签名授权并支付（EIP-3009 · gasless）
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-card/40 px-6 py-16 text-center backdrop-blur">
                <CircleDashed className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  选择左侧任务并点击「发起任务」—— 服务端将返回 402 + 支付挑战
                </p>
              </div>
            )}

            {signatureHeader ? (
              <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/6 p-4 backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <ShieldCheck className="size-4" /> PAYMENT-SIGNATURE 已生成（EIP-3009）
                </div>
                <p className="break-all font-mono text-[10px] leading-relaxed text-muted-foreground">
                  {signatureHeader}
                </p>
              </div>
            ) : null}

            {settlement ? (
              <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/6 p-4 text-xs backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <CheckCircle2 className="size-4" /> 结算回执 · PAYMENT-RESPONSE
                </div>
                <Field label="success" value={String(settlement.success)} mono />
                <Field
                  label="tx"
                  value={shortenAddress(settlement.transaction, 12)}
                  mono
                  full={settlement.transaction}
                />
                <Field label="network" value={settlement.network} mono />
                {settlement.payer ? (
                  <Field label="payer" value={shortenAddress(settlement.payer, 8)} mono />
                ) : null}
              </div>
            ) : null}

            {job ? (
              <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-card p-4 backdrop-blur">
                <div className="text-sm font-medium">任务结果 · 已付费解锁</div>
                <pre className="max-h-64 overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                  {JSON.stringify(job, null, 2)}
                </pre>
              </div>
            ) : null}

            {error ? (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm font-medium text-red-300">
                {error}
              </p>
            ) : null}
          </section>

          {/* ── Right: on-chain ledger ── */}
          <aside className="flex flex-col gap-3">
            <SectionTitle>链上流水 · 本会话</SectionTitle>
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-card p-3 backdrop-blur">
              {ledger.length === 0 ? (
                <p className="py-6 text-center font-mono text-[11px] text-muted-foreground">
                  no payments yet
                </p>
              ) : (
                ledger.map((e, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-2 rounded-md border border-white/5 bg-background/40 px-2.5 py-2 text-[11px]"
                  >
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-mono text-foreground/90">{e.task}</span>
                      <span className="text-[10px] text-muted-foreground">{e.time}</span>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-0.5">
                      <span className="font-mono text-primary">{e.amount}</span>
                      <LedgerBadge status={e.status} />
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-card p-3 font-mono text-[10px] text-muted-foreground backdrop-blur">
              <div className="mb-0.5 text-[10px] uppercase tracking-wider text-muted-foreground/60">
                Deployed contracts · Fuji
              </div>
              <Field label="token" value={shortenAddress(process.env.NEXT_PUBLIC_X402_TOKEN || "", 10)} mono />
              <Field
                label="payments"
                value={shortenAddress(process.env.NEXT_PUBLIC_X402_PAYTO || "", 10)}
                mono
              />
            </div>
          </aside>
        </div>
      )}

      {/* ── Bottom: settlement status flow ── */}
      <footer className="flex flex-col gap-3 rounded-xl border border-white/5 bg-card px-6 py-4 backdrop-blur">
        <div className="flex items-center justify-between gap-2">
          {["402 CHALLENGE", "SIGNED", "VERIFIED", "SETTLED"].map((label, i) => {
            const node = i + 1;
            const done = stage >= node;
            const current = stage === node;
            return (
              <div key={label} className="flex flex-1 items-center gap-2">
                <div
                  className={
                    current
                      ? "flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-[11px] font-semibold text-primary"
                      : done
                        ? "flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-mono text-[11px] text-primary/80"
                        : "flex items-center gap-1.5 rounded-full border border-white/8 bg-white/3 px-3 py-1 font-mono text-[11px] text-muted-foreground"
                  }
                >
                  {done ? (
                    <CheckCircle2 className="size-3" />
                  ) : current ? (
                    <CircleDot className="size-3" />
                  ) : (
                    <CircleDashed className="size-3" />
                  )}
                  {label}
                </div>
                {i < 3 ? <div className="h-px flex-1 bg-white/8" /> : null}
              </div>
            );
          })}
        </div>
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span className="font-mono">
            {step ?? "idle — connect wallet, pick a task, start the loop"}
          </span>
          <span className="hidden items-center gap-1 sm:flex">
            <ArrowDownRight className="size-3" /> gasless settle · on-chain auditable
          </span>
        </div>
      </footer>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 px-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="size-1 rounded-full bg-primary" />
      {children}
    </h2>
  );
}

function LedgerBadge({ status }: { status: LedgerEntry["status"] }) {
  if (status === "SETTLED")
    return (
      <span className="flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-[9px] text-primary">
        SETTLED
      </span>
    );
  if (status === "FAILED")
    return (
      <span className="flex items-center gap-1 rounded-full border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 font-mono text-[9px] text-red-300">
        FAILED
      </span>
    );
  return (
    <span className="flex items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[9px] text-amber-300">
      CHALLENGED
    </span>
  );
}

function Field({
  label,
  value,
  mono,
  full,
}: {
  label: string;
  value: string;
  mono?: boolean;
  full?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className={mono ? "truncate font-mono text-foreground/90" : "text-foreground/90"} title={full}>
        {value}
      </span>
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
