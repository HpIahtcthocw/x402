"use client";

import {
  Button,
  ConnectAvalanche as ConnectWallet,
  humanizeError,
  shortenAddress,
  useAvaKit,
} from "@avakit/react";
import {
  ArrowDownRight,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CircleDot,
  FileText,
  Loader2,
  Lock,
  Network,
  PenLine,
  RotateCcw,
  Send,
  ShieldCheck,
  Terminal,
  Wallet,
} from "lucide-react";
import { useMemo, useState, useEffect } from "react";
import nextDynamic from "next/dynamic";
import { createWalletClient, custom, http, formatUnits, type Chain, type Address } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { APP_BASE_URL, X402_AMOUNT } from "@/lib/x402/config";
import { toViemChain } from "@avakit/core";
import { monadTestnet } from "@/lib/chain";
import {
  buildPaymentPayload,
  parsePaymentRequired,
  pickRequirement,
  signTransferWithAuthorization,
} from "@/lib/x402/client";
import type { PaymentRequired, PaymentRequirements, SettlementResponse } from "@/lib/x402/types";
import { decodeSettlementResponse, encodePaymentPayload } from "@/lib/x402/encode";
import {
  encodeIdentityHeader,
  identityMessage,
  type IdentityAttestation,
  type IdentityTrust,
  type IdentityVerification,
} from "@/lib/x402/identity";

/** Monad Testnet (chain id 10143) — the burner client signs against this chain. */
const MONAD_TESTNET: Chain = {
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://10143.rpc.thirdweb.com"] } },
};

const EXPLORER = "https://testnet.monadexplorer.com";
const NETWORK_CAIP2 = "eip155:10143";

/** Optional Dynamic embedded-wallet signer — only loads when an environment ID is set. */
const DynamicEmbeddedWallet = nextDynamic(() => import("./dynamic-embedded-wallet"), { ssr: false });
const DYNAMIC_ENABLED = Boolean(process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID);

/** The metered APIs we sell — billed per call, not per subscription.
 *  `quote:*` return **live** market data (Binance public market data).
 *  `inference:*` proxy a **vendor-billed** LLM and report `unconfigured` until
 *  the matching key is set: `inference:tiny` → Qwen (DASHSCOPE_API_KEY),
 *  `inference:kimi` → Kimi (MOONSHOT_API_KEY). */
const TASKS = [
  { id: "quote:BTC", label: "quote:BTC", desc: "Live BTC spot — one call" },
  { id: "quote:ETH", label: "quote:ETH", desc: "Live ETH spot — one call" },
  { id: "quote:SOL", label: "quote:SOL", desc: "Live SOL spot — one call" },
  { id: "inference:tiny", label: "inference:tiny", desc: "Vendor-billed LLM · Qwen — needs a key" },
  { id: "inference:kimi", label: "inference:kimi", desc: "Vendor-billed LLM · Kimi — needs a key" },
] as const;

const FLOW = [
  {
    icon: Send,
    title: "Agent requests",
    desc: "POST /api/agent-task with the task intent (no account, no API key)",
  },
  {
    icon: Lock,
    title: "Receives 402",
    desc: "Server responds PAYMENT-REQUIRED: amount, payTo, network, timeout",
  },
  {
    icon: PenLine,
    title: "Signs authorization",
    desc: "EIP-3009 transferWithAuthorization — offline signature, zero gas",
  },
  {
    icon: CheckCircle2,
    title: "Settles on-chain",
    desc: "Facilitator verifies and broadcasts; books a PaymentRecorded receipt",
  },
] as const;

const INTEGRATE_SNIPPET = `// app/api/quote/route.ts — meter any endpoint in one line
import { meter } from "@/lib/x402/meter";

export const POST = meter(
  async () => fetchSpot("BTCUSDT"),   // your real handler
  { name: "quote:BTC" },
);`;

const mcpSnippet = (base: string) => `{
  "mcpServers": {
    "x402": {
      "command": "node",
      "args": ["scripts/mcp-server.mjs"],
      "env": { "GATEWAY_URL": "${base}" }
    }
  }
}`;

const curlSnippet = (base: string) => `curl -X POST ${base}/api/agent-task \\
  -H 'content-type: application/json' \\
  -d '{"task":"quote:BTC"}'
# → 402 + PAYMENT-REQUIRED: amount / payTo / network / timeout`;

type ChainEntry = {
  paymentId: string;
  payer: string;
  amount: string;
  timestamp: number;
  refunded: boolean;
  tx: string;
};

type ReceiptRaw = {
  payment_id: string;
  payer: string;
  token: string;
  amount: string;
  timestamp: number;
  refunded: boolean;
};

export function AgentPaymentsDemo() {
  const { address, provider, chain, status } = useAvaKit();
  const isConnected = status === "connected";

  const [task, setTask] = useState<(typeof TASKS)[number]["id"]>("quote:BTC");
  // Snippets must show the domain the app is actually served from, so we prefer
  // the live origin once mounted (falls back to APP_BASE_URL during SSR).
  const [baseUrl, setBaseUrl] = useState(APP_BASE_URL);
  useEffect(() => setBaseUrl(window.location.origin), []);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [challenge, setChallenge] = useState<PaymentRequired | null>(null);
  const [signatureHeader, setSignatureHeader] = useState<string | null>(null);
  const [settlement, setSettlement] = useState<SettlementResponse | null>(null);
  const [job, setJob] = useState<Record<string, unknown> | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);
  const [faucetMsg, setFaucetMsg] = useState<{ ok: boolean; text: string; tx?: string } | null>(null);
  /** Burner demo — ephemeral in-memory EOA, no wallet extension needed. */
  const [burner, setBurner] = useState<null | { address: Address; account: ReturnType<typeof privateKeyToAccount> }>(null);
  const [autoRunning, setAutoRunning] = useState(false);
  /** On-chain ledger read from PaymentRecorded events (not just this session). */
  const [chainLedger, setChainLedger] = useState<ChainEntry[]>([]);
  const [ledgerMeta, setLedgerMeta] = useState<{ latestBlock: string; dataSource: string; refundedCount: number }>({
    latestBlock: "—",
    dataSource: "—",
    refundedCount: 0,
  });
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundTx, setRefundTx] = useState<string | null>(null);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  /** Spend analytics — aggregated straight from the on-chain receipts. */
  const poolStats = useMemo(() => {
    const volume = chainLedger.reduce((s, e) => s + BigInt(e.amount), 0n);
    const refunded = chainLedger.filter((e) => e.refunded);
    return {
      payments: chainLedger.length,
      volume,
      payers: new Set(chainLedger.map((e) => e.payer.toLowerCase())).size,
      refundedCount: refunded.length,
      refundedVolume: refunded.reduce((s, e) => s + BigInt(e.amount), 0n),
    };
  }, [chainLedger]);
  /** Cumulative settled volume over time — an actual trend, not a static number. */
  const volumeSeries = useMemo(() => {
    const ordered = [...chainLedger].sort((a, b) => a.timestamp - b.timestamp);
    if (ordered.length === 0) return [] as number[];
    let run = 0;
    return [0, ...ordered.map((e) => (run += Number(formatUnits(BigInt(e.amount), 18))))];
  }, [chainLedger]);
  /** Replay — reuse the authorization we already settled; the nonce is spent. */
  const [lastSignatureHeader, setLastSignatureHeader] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);
  const [replayMsg, setReplayMsg] = useState<string | null>(null);
  /** Expandable contract receipt (raw settlements[paymentId]). */
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [receipts, setReceipts] = useState<Record<string, ReceiptRaw | "loading" | "error">>({});
  const [cinema, setCinema] = useState(false);
  useEffect(() => { setCinema(new URLSearchParams(location.search).has("cinema")); }, []);
  /** A2A surface — the same purchase, driven by an agent instead of a browser. */
  const [agentCard, setAgentCard] = useState<Record<string, unknown> | null>(null);
  const [a2aBusy, setA2aBusy] = useState(false);
  const [a2aError, setA2aError] = useState<string | null>(null);
  const [a2aTaskId, setA2aTaskId] = useState<string | null>(null);
  const [a2aSteps, setA2aSteps] = useState<{ task: string; sign: string; message: string } | null>(null);
  const [a2aReceipt, setA2aReceipt] = useState<Record<string, unknown> | null>(null);
  const [a2aOutput, setA2aOutput] = useState<Record<string, unknown> | null>(null);

  /** The agent card is what an A2A client fetches first — show it verbatim. */
  useEffect(() => {
    fetch("/api/a2a/agent-card", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setAgentCard(d as Record<string, unknown>))
      .catch(() => setAgentCard(null));
  }, []);

  async function fetchChainLedger() {
    try {
      const res = await fetch("/api/ledger", { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) {
        setChainLedger((data.entries || []).slice().reverse());
        setLedgerMeta({
          latestBlock: String(data.latestBlock ?? "—"),
          dataSource: String(data.dataSource ?? "—"),
          refundedCount: Number(data.refundedCount ?? 0),
        });
        setLedgerError(null);
      } else setLedgerError("Ledger unavailable — retrying in 15 seconds");
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    fetchChainLedger();
    const t = setInterval(fetchChainLedger, 15000);
    return () => clearInterval(t);
  }, []);

  async function refundPayment(paymentId: string) {
    setRefundingId(paymentId);
    try {
      const res = await fetch("/api/refund", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paymentId }),
      });
      const data = await res.json();
      if (!data?.ok) setError(data?.error || "refund failed");
      else setRefundTx(data.tx);
      await fetchChainLedger();
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setRefundingId(null);
    }
  }

  async function toggleReceipt(paymentId: string) {
    if (expandedId === paymentId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(paymentId);
    if (receipts[paymentId] && receipts[paymentId] !== "error") return;
    setReceipts((r) => ({ ...r, [paymentId]: "loading" }));
    try {
      const res = await fetch(`/api/receipt?paymentId=${paymentId}`, { cache: "no-store" });
      const data = await res.json();
      if (data?.ok) setReceipts((r) => ({ ...r, [paymentId]: data.raw as ReceiptRaw }));
      else setReceipts((r) => ({ ...r, [paymentId]: "error" }));
    } catch {
      setReceipts((r) => ({ ...r, [paymentId]: "error" }));
    }
  }

  /** Give the receipt a downstream consumer: a CSV any finance/ERP tool can import. */
  function exportReceipts() {
    const header = "paymentId,payer,amount_agt,timestamp_iso,refunded,txHash,network,contract";
    const rows = chainLedger.map((e) =>
      [
        e.paymentId,
        e.payer,
        formatUnits(BigInt(e.amount), 18),
        new Date(e.timestamp * 1000).toISOString(),
        e.refunded ? "true" : "false",
        e.tx,
        NETWORK_CAIP2,
        poolAddress,
      ].join(","),
    );
    const url = URL.createObjectURL(
      new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `x402-receipts-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Start the burner demo: generate an ephemeral account, skip the login gate. */
  function startBurner() {
    if (burner) return;
    const account = privateKeyToAccount(generatePrivateKey());
    setBurner({ address: account.address, account });
  }

  const effectiveAddress: Address | null = burner?.address ?? (isConnected ? address : null);

  const walletClient = useMemo(() => {
    if (burner) {
      return createWalletClient({
        chain: MONAD_TESTNET,
        transport: http(),
        account: burner.account,
      });
    }
    if (!address || !provider) return null;
    return createWalletClient({
      chain: toViemChain(chain),
      transport: custom(provider),
      account: address,
    });
  }, [address, provider, chain, burner]);

  const now = () => new Date().toLocaleTimeString("en-GB", { hour12: false });

  /** Default: auto-start burner on load so the judge sees the loop in 0 clicks. */
  useEffect(() => {
    if (burner || autoRunning) return;
    setAutoRunning(true);
    const t = setTimeout(() => {
      startBurner();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Faucet — mint 1 AGT test token to the connected wallet (one click). */
  async function claimAGT() {
    if (!effectiveAddress) return;
    setFaucetBusy(true);
    setFaucetMsg(null);
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: effectiveAddress }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        setFaucetMsg({ ok: false, text: data?.error || `Faucet error (${res.status})` });
        return;
      }
      setFaucetMsg({
        ok: true,
        text: data.demo ? "Demo mode — minted 1 AGT (simulated)" : `Minted 1 AGT · tx ${(data.tx || "").slice(0, 12)}…`,
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
    setReplayMsg(null);
    try {
      setStep("agent -> api: POST /api/agent-task (no payment)");
      const res = await fetch("/api/agent-task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task }),
      });

      if (res.status === 402) {
        const required = parsePaymentRequired(res);
        setChallenge(required);
        setStep("api -> agent: 402 + PAYMENT-REQUIRED");
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

  /**
   * Payer identity — the paying wallet signs an EIP-191 attestation over its own
   * address. It rides along in a header (HTTP path) or in the A2A message
   * metadata, and the merchant verifies the signature server-side before it is
   * allowed anywhere near a receipt.
   */
  async function buildIdentity(): Promise<{ header: string; attestation: IdentityAttestation } | null> {
    if (!walletClient || !effectiveAddress) return null;
    const issuedAt = Math.floor(Date.now() / 1000);
    try {
      const signature = await walletClient.signMessage({
        message: identityMessage(MONAD_TESTNET.id, effectiveAddress, issuedAt),
      });
      const attestation: IdentityAttestation = {
        attester: effectiveAddress,
        subject: effectiveAddress,
        issuedAt,
        signature,
      };
      return { header: encodeIdentityHeader(attestation), attestation };
    } catch {
      return null;
    }
  }

  /** Step 2 — sign the EIP-3009 authorization and retry with the header. */
  async function payAndRetry(challengeOverride?: PaymentRequired) {
    const currentChallenge = challengeOverride ?? challenge;
    if (!currentChallenge || !walletClient || !effectiveAddress) return;
    setBusy(true);
    setError(null);
    setJob(null);
    setSettlement(null);
    setReplayMsg(null);
    try {
      const requirement = pickRequirement(currentChallenge, { scheme: "exact", network: NETWORK_CAIP2 });
      const asset = requirement.asset as Address;
      const tokenName = (requirement.extra?.name as string) || "AgentToken";

      setStep("agent wallet: sign EIP-3009 transferWithAuthorization (gasless)");
      const nowSec = Math.floor(Date.now() / 1000);
      const { auth, signature } = await signTransferWithAuthorization({
        walletClient,
        tokenAddress: asset,
        tokenName,
        auth: {
          from: effectiveAddress,
          to: requirement.payTo as Address,
          value: requirement.amount,
          validAfter: String(nowSec - 60),
          validBefore: String(nowSec + 300),
        },
      });

      const payload = buildPaymentPayload({ required: currentChallenge, accepted: requirement, auth, signature });
      const header = encodePaymentPayload(payload);
      setSignatureHeader(header);
      setLastSignatureHeader(header);

      setStep("agent -> api: retry with PAYMENT-SIGNATURE");
      const identity = await buildIdentity();
      const res = await fetch("/api/agent-task", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": header,
          ...(identity ? { "x-identity-attestation": identity.header } : {}),
        },
        body: JSON.stringify({ task }),
      });

      const body = await res.json().catch(() => null);
      const respHeader = res.headers.get("payment-response");
      const currentSettlement = respHeader ? decodeSettlementResponse(respHeader) : null;
      if (currentSettlement) setSettlement(currentSettlement);

      if (res.ok) {
        setJob(body as Record<string, unknown>);
        setStep("api -> agent: 200 + job result + PAYMENT-RESPONSE");
        await fetchChainLedger();
      } else {
        setError(body?.reason || `Payment rejected (${res.status})`);
      }
    } catch (e) {
      setError(humanizeError(e));
    } finally {
      setBusy(false);
    }
  }

  /** Replay the exact authorization we already settled — the nonce is spent. */
  async function replay() {
    if (!lastSignatureHeader) return;
    setReplaying(true);
    setReplayMsg(null);
    try {
      const res = await fetch("/api/agent-task", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "payment-signature": lastSignatureHeader,
        },
        body: JSON.stringify({ task }),
      });
      const body = await res.json().catch(() => null);
      setReplayMsg(
        res.ok
          ? `Unexpected: the resource was served twice (${res.status})`
          : `${body?.reason || body?.error || `rejected (${res.status})`}`,
      );
    } catch (e) {
      setReplayMsg(humanizeError(e));
    } finally {
      setReplaying(false);
    }
  }

  /**
   * Run the whole A2A x402 Standalone Flow from the browser: task → sign →
   * message/send. Same signer and same receipt as the HTTP path; the only
   * difference is that the payload travels inside the A2A message metadata.
   */
  async function runA2A() {
    if (!walletClient || !effectiveAddress) return;
    setA2aBusy(true);
    setA2aError(null);
    setA2aReceipt(null);
    setA2aOutput(null);
    setA2aTaskId(null);
    setA2aSteps({ task: "POST /api/a2a/task …", sign: "idle", message: "idle" });
    try {
      // Step 1 — merchant replies input-required with the x402 terms.
      const taskRes = await fetch("/api/a2a/task", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ task }),
      });
      const taskBody = await taskRes.json();
      const taskId = String(taskBody?.result?.id ?? "");
      const terms = taskBody?.result?.status?.message?.metadata?.["x402.payment.required"] as
        | { x402Version: 2; accepts: PaymentRequirements[] }
        | undefined;
      if (!taskId || !terms?.accepts?.length) throw new Error("A2A task returned no payment terms");
      setA2aTaskId(taskId);
      setA2aSteps({ task: `task ${taskId} · state=input-required`, sign: "signing…", message: "idle" });

      // Step 2 — sign the exact requirement the merchant advertised.
      const required: PaymentRequired = {
        x402Version: 2,
        resource: { url: `${baseUrl}/api/a2a/task`, mimeType: "application/json" },
        accepts: terms.accepts,
      };
      const requirement = pickRequirement(required, { scheme: "exact", network: NETWORK_CAIP2 });
      const nowSec = Math.floor(Date.now() / 1000);
      const { auth, signature } = await signTransferWithAuthorization({
        walletClient,
        tokenAddress: requirement.asset as Address,
        tokenName: (requirement.extra?.name as string) || "AgentToken",
        auth: {
          from: effectiveAddress,
          to: requirement.payTo as Address,
          value: requirement.amount,
          validAfter: String(nowSec - 60),
          validBefore: String(nowSec + 300),
        },
      });
      const payload = buildPaymentPayload({ required, accepted: requirement, auth, signature });
      setA2aSteps({
        task: `task ${taskId} · state=input-required`,
        sign: "EIP-3009 authorization signed",
        message: "message/send …",
      });

      // Step 3 — submit the payment inside an A2A message; read back the receipt.
      const identity = await buildIdentity();
      const msgRes = await fetch("/api/a2a/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `msg_${Date.now()}`,
          method: "message/send",
          params: {
            message: {
              taskId,
              role: "user",
              parts: [{ kind: "text", text: `Run ${task}` }],
              metadata: {
                "x402.payment.status": "payment-submitted",
                "x402.payment.payload": payload,
                ...(identity ? { "x402.identity.attestation": identity.attestation } : {}),
              },
            },
          },
        }),
      });
      const msgBody = await msgRes.json();
      const status = msgBody?.result?.status;
      const meta = (status?.message?.metadata ?? {}) as Record<string, unknown>;
      setA2aReceipt((meta["x402.payment.receipts"] as Record<string, unknown>) ?? null);
      const dataPart = (status?.message?.parts ?? []).find(
        (p: { kind?: string }) => p?.kind === "data",
      );
      setA2aOutput((dataPart?.data as Record<string, unknown>) ?? null);
      setA2aSteps({
        task: `task ${taskId} · state=input-required`,
        sign: "EIP-3009 authorization signed",
        message: `state=${status?.state ?? "?"} · payment-completed`,
      });
      await fetchChainLedger();
    } catch (e) {
      setA2aError(humanizeError(e));
    } finally {
      setA2aBusy(false);
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

  const settledCount = chainLedger.length;
  const poolAddress = process.env.NEXT_PUBLIC_X402_PAYTO || "0x3d22a8ec8e8e47c8914b2ed70d18283a45cee948";
  const tokenAddress = process.env.NEXT_PUBLIC_X402_TOKEN || "0xdabd72e3e7fb2811115970e0c59279aaa0196cdb";

  return (
    <div className={`flex flex-col gap-5 ${cinema ? "cinema" : ""}`}>
      {cinema && <div className="demo-heading"><span>LIVE PRODUCT</span><strong>{refundTx ? "Payment returned. Proof preserved." : settlement?.success ? "Paid. Delivered. Recorded." : challenge ? "One request. One payment challenge." : "An API call with a receipt."}</strong><small>AGT test token · live spot quote · real on-chain payment</small></div>}
      {/* ── Hero ── */}
      <section className="relative overflow-hidden rounded-2xl border border-white/8 bg-card/60 px-6 py-8 backdrop-blur">
        <div className="relative flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
              ● x402 v2 · LIVE
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              EIP-3009 gasless
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              MIT · self-hostable
            </span>
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-xs text-muted-foreground">
              A2A-compatible
            </span>
          </div>
          <div className="flex flex-col gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
              Your agent calls a paid API 1,000 times a day. Can finance prove what it bought?
            </h1>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              x402 (<span className="text-foreground/80">HTTP 402 payments for agents</span>) lets an agent pay per request with one{" "}
              <span className="font-mono text-primary">EIP-3009</span> signature. We meter the endpoints{" "}
              <span className="text-foreground/80">you already sell</span> and turn every payment into an on-chain receipt —
              payer, amount, timestamp, refundable. <span className="text-muted-foreground/80">(This demo meters a live spot feed so it runs without a vendor key.)</span>
            </p>
            <ul className="flex max-w-3xl flex-col gap-1.5 text-sm text-muted-foreground">
              <li><b className="text-foreground">1.</b> Every payment is a <b className="text-foreground">contract state</b>, not a log line.</li>
              <li><b className="text-foreground">2.</b> Refunds are a <b className="text-foreground">contract method</b> (<span className="font-mono text-xs">refund()</span>), owner-authorized.</li>
              <li><b className="text-foreground">3.</b> The same nonce <b className="text-foreground">reverts on-chain</b> — replay-proof by construction.</li>
            </ul>
            <p className="font-mono text-sm text-foreground/90">
              No account. No API key. No gas. The agent pays itself.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || !effectiveAddress}
              onClick={() => void requestTask()}
              className="gap-2"
            >
              {busy && step?.startsWith("agent -> api") ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Run a live settlement
            </Button>
            <a
              href="#ledger"
              className="rounded-md border border-white/10 bg-white/5 px-4 py-2 text-sm text-muted-foreground transition hover:bg-white/10"
            >
              Read the ledger ↓
            </a>
          </div>
        </div>
      </section>

      {/* ── Always-on chain truth ── */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 font-mono text-xs backdrop-blur">
        <span className="flex items-center gap-1.5 text-primary">
          <span className="size-1.5 rounded-full bg-primary" />
          Live on-chain
        </span>
        <span className="text-muted-foreground">
          Settled on-chain: <span className="text-foreground">{settledCount}</span>
        </span>
        <span className="text-muted-foreground">
          Refunded: <span className="text-foreground">{ledgerMeta.refundedCount}</span>
        </span>
        <span className="text-muted-foreground">
          Latest block <span className="text-foreground">#{ledgerMeta.latestBlock}</span>
        </span>
        <span className="text-muted-foreground">
          Price <span className="text-foreground">{formatUnits(BigInt(X402_AMOUNT), 18)} AGT</span> per call · no subscription
        </span>
        <span className="text-muted-foreground/70">
          read via {ledgerMeta.dataSource === "envio-hyperrpc" ? "Envio HyperRPC" : "public RPC"}
        </span>
      </div>

      {/* ── Protocol flow ── */}
      <section className="protocol-overview grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FLOW.map((f, i) => (
          <div
            key={f.title}
            className="relative flex flex-col gap-2 rounded-xl border border-white/8 bg-card/60 p-4 backdrop-blur"
          >
            <div className="flex items-center justify-between">
              <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">
                step {i + 1}
              </span>
              {i < 3 ? <ArrowDownRight className="size-3.5 text-white/20" /> : null}
            </div>
            <div className="flex items-center gap-2 text-sm font-semibold">
              <f.icon className="size-4 text-primary" />
              {f.title}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">{f.desc}</p>
          </div>
        ))}
      </section>

      {/* ── Status bar ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-card px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Wallet className="size-3.5" />
          {effectiveAddress ? (
            <span>
              {burner ? (
                <span className="rounded border border-primary/30 bg-primary/10 px-1 text-xs text-primary">BURNER</span>
              ) : null}{" "}
              wallet <span className="font-mono text-foreground">{shortenAddress(effectiveAddress, 8)}</span>
              <span className="mx-2 text-white/15">·</span>
              chain <span className="font-mono text-foreground">{burner ? "Monad Testnet" : chain.name}</span>
              <span className="mx-2 text-white/15">·</span>
              price <span className="font-mono text-primary">0.001 AGT / call</span>
            </span>
          ) : (
            <span>No wallet connected — burner starting…</span>
          )}
        </div>
        <ConnectWallet />
      </div>

      {DYNAMIC_ENABLED ? <DynamicEmbeddedWallet /> : null}

      {/* ── Main workspace (burner auto-started, no gate) ── */}
      {!effectiveAddress ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-white/8 bg-card/40 px-6 py-16 backdrop-blur">
          <Loader2 className="size-6 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Starting burner wallet…</p>
        </div>
      ) : (
        <div className="payment-workspace grid items-start gap-5 lg:grid-cols-[300px_minmax(0,1fr)_360px]">
          {/* ── Left: metered APIs ── */}
          <aside className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/8 bg-card p-3 backdrop-blur">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">AGT test token</span>
                <span className="font-mono text-xs text-muted-foreground">faucet</span>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                No balance? Mint 1 AGT to run the full loop.
              </p>
              <Button disabled={faucetBusy} onClick={claimAGT} className="w-full">
                {faucetBusy ? <Loader2 className="size-4 animate-spin" /> : <CircleDot className="size-4" />}
                {faucetBusy ? "Minting…" : "Mint 1 AGT"}
              </Button>
              {faucetMsg ? (
                <div
                  className={
                    faucetMsg.ok
                      ? "flex flex-col gap-0.5 rounded-md border border-primary/20 bg-primary/8 px-2 py-1.5 text-xs text-primary"
                      : "flex flex-col gap-0.5 rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 text-xs text-red-300"
                  }
                >
                  <span>{faucetMsg.text}</span>
                  {faucetMsg.ok && faucetMsg.tx ? (
                    <a
                      href={`${EXPLORER}/tx/${faucetMsg.tx}`}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      {EXPLORER.replace("https://", "")}/tx/{faucetMsg.tx.slice(0, 10)}… ↗
                    </a>
                  ) : null}
                </div>
              ) : null}
            </div>
            <SectionTitle>Metered APIs · billed per call</SectionTitle>
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
                    <span className="text-xs text-muted-foreground">{t.desc}</span>
                  </button>
                );
              })}
            </div>
            <Button disabled={busy} onClick={requestTask} className="mt-1 w-full">
              {busy && step?.startsWith("agent -> api") ? <Loader2 className="animate-spin" /> : null}
              ① Request · trigger 402
            </Button>
            <p className="text-center font-mono text-xs text-muted-foreground">
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
                  <span className="font-mono text-xs text-muted-foreground">
                    x402 v2 · {NETWORK_CAIP2}
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
                    <Button disabled={busy} onClick={() => void payAndRetry()} className="w-full">
                      {busy && step?.startsWith("agent wallet") ? (
                        <Loader2 className="animate-spin" />
                      ) : (
                        <ShieldCheck className="size-4" />
                      )}
                      ② Sign & pay (EIP-3009 · gasless)
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/10 bg-card/40 px-6 py-16 text-center backdrop-blur">
                <CircleDashed className="size-6 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  Pick a metered API and hit "Request" — the server returns a 402 payment challenge.
                </p>
              </div>
            )}

            {signatureHeader ? (
              <div className="signature-card flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/6 p-4 backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <ShieldCheck className="size-4" /> PAYMENT-SIGNATURE generated (EIP-3009)
                </div>
                <p className="break-all font-mono text-xs leading-relaxed text-muted-foreground">
                  {signatureHeader}
                </p>
              </div>
            ) : null}

            {settlement ? (
              <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/6 p-4 text-xs backdrop-blur">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <CheckCircle2 className="size-4" /> Settlement receipt · PAYMENT-RESPONSE
                </div>
                <Field label="success" value={String(settlement.success)} mono />
                <Field
                  label="tx"
                  value={shortenAddress(settlement.transaction, 12)}
                  mono
                  full={settlement.transaction}
                />
                <Field label="network" value={settlement.network} mono />
                {typeof settlement.extensions?.paymentRecordTx === "string" && <a className="text-primary underline" href={`${EXPLORER}/tx/${settlement.extensions.paymentRecordTx}`} target="_blank" rel="noreferrer">Receipt booked on-chain ↗</a>}
                <a className="text-primary underline" href={`${EXPLORER}/tx/${settlement.transaction}`} target="_blank" rel="noreferrer">Verify transfer on Monad ↗</a>
                {settlement.payer ? (
                  <Field label="payer" value={shortenAddress(settlement.payer, 8)} mono />
                ) : null}
              </div>
            ) : null}

            {lastSignatureHeader ? (
              <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-card p-4 text-xs backdrop-blur">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <RotateCcw className="size-4 text-primary" /> Replay the same authorization
                  </span>
                  <button
                    onClick={() => void replay()}
                    disabled={replaying}
                    className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-white/10 disabled:opacity-50"
                  >
                    {replaying ? "replaying…" : "replay"}
                  </button>
                </div>
                <p className="leading-relaxed text-muted-foreground">
                  Spending a nonce twice must fail. We re-send the exact PAYMENT-SIGNATURE we already settled.
                </p>
                {replayMsg ? (
                  <p className="rounded-md border border-red-400/30 bg-red-400/10 px-2 py-1.5 font-mono text-xs text-red-300">
                    {replayMsg}
                  </p>
                ) : null}
              </div>
            ) : null}

            {job ? (
              <div className="flex flex-col gap-2 rounded-xl border border-white/5 bg-card p-4 backdrop-blur">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-medium">Resource body · unlocked after payment</span>
                  <IdentityChip identity={(job as { identity?: IdentityVerification }).identity} />
                </div>
                <pre className="max-h-64 overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
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

          {/* ── Right: payee pool + on-chain ledger ── */}
          <aside id="ledger" className="flex flex-col gap-3">
            <SectionTitle>Payee Pool · on-chain · all time</SectionTitle>
            <div className="flex flex-col gap-2 rounded-xl border border-primary/25 bg-primary/5 p-3 backdrop-blur">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Spend, straight off the chain</span>
                <span className="font-mono font-semibold text-primary">
                  {settledCount} tx · {formatUnits(poolStats.volume, 18)} AGT
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "payments", v: String(poolStats.payments) },
                  { k: "volume", v: `${formatUnits(poolStats.volume, 18)} AGT` },
                  { k: "payers", v: String(poolStats.payers) },
                  { k: "refunded", v: `${poolStats.refundedCount}` },
                ].map((m) => (
                  <div key={m.k} className="rounded-md border border-white/5 bg-background/50 px-2 py-1.5">
                    <div className="font-mono text-xs uppercase tracking-wider text-muted-foreground/70">{m.k}</div>
                    <div className="font-mono text-sm font-semibold text-foreground">{m.v}</div>
                  </div>
                ))}
              </div>
              {volumeSeries.length > 1 ? (
                <div className="rounded-md border border-white/5 bg-background/50 px-2 py-2">
                  <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground/70">
                    <span>cumulative volume · oldest → newest</span>
                    <span className="font-mono">{formatUnits(BigInt(poolStats.volume), 18)} AGT</span>
                  </div>
                  <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="h-8 w-full text-primary">
                    <polyline
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      vectorEffect="non-scaling-stroke"
                      points={volumeSeries
                        .map((v, i) => {
                          const max = Math.max(...volumeSeries, 1);
                          return `${(i / (volumeSeries.length - 1)) * 100},${22 - (v / max) * 20}`;
                        })
                        .join(" ")}
                    />
                  </svg>
                </div>
              ) : null}
              <button
                onClick={exportReceipts}
                disabled={chainLedger.length === 0}
                className="flex items-center justify-center gap-1.5 rounded-md border border-white/10 bg-white/5 px-2 py-1.5 font-mono text-xs text-muted-foreground transition hover:bg-white/10 disabled:opacity-50"
              >
                <FileText className="size-3.5" /> Export receipts (CSV)
              </button>
              <Field label="pool" value={shortenAddress(poolAddress, 12)} mono full={poolAddress} />
              <div className="mt-0.5 rounded-md border border-white/5 bg-background/50 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
                <span className="text-foreground/80">Read PaymentRecorded off Monad with none of our code in the loop</span> — it matches the rows below one for one.
              </div>
            </div>
            <SectionTitle>
              On-chain ledger
              <a
                href={`${EXPLORER}/address/${poolAddress}`}
                target="_blank"
                rel="noreferrer"
                className="ml-2 rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-xs font-normal text-muted-foreground hover:bg-white/10"
              >
                explorer ↗
              </a>
            </SectionTitle>
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-card p-3 backdrop-blur">
              {chainLedger.length === 0 ? (
                <p className="py-6 text-center font-mono text-xs text-muted-foreground">
                  {ledgerError || "No recorded payments yet"}
                </p>
              ) : (
                chainLedger.map((e, i) => {
                  const open = expandedId === e.paymentId;
                  const receipt = receipts[e.paymentId];
                  return (
                    <div
                      key={i}
                      className="flex flex-col gap-1.5 rounded-md border border-white/5 bg-background/40 px-2.5 py-2 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <button
                          onClick={() => void toggleReceipt(e.paymentId)}
                          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                        >
                          {open ? (
                            <ChevronDown className="size-3 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="size-3 shrink-0 text-muted-foreground" />
                          )}
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-mono text-foreground/90">
                              {shortenAddress(e.payer, 8)}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {new Date(e.timestamp * 1000).toLocaleString()}
                            </span>
                          </span>
                        </button>
                        <div className="flex shrink-0 flex-col items-end gap-0.5">
                          <span className="font-mono text-primary">
                            {formatUnits(BigInt(e.amount), 18)} AGT
                          </span>
                          {e.refunded ? (
                            <span className="rounded-full border border-red-400/30 bg-red-400/10 px-1.5 py-0.5 font-mono text-xs text-red-300">
                              REFUNDED
                            </span>
                          ) : (
                            <button
                              onClick={() => void refundPayment(e.paymentId)}
                              disabled={refundingId === e.paymentId}
                              className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-white/10 disabled:opacity-50"
                            >
                              {refundingId === e.paymentId ? "refunding…" : "refund"}
                            </button>
                          )}
                        </div>
                      </div>
                      {open ? (
                        <div className="flex flex-col gap-1.5 rounded border border-white/5 bg-background/60 p-2">
                          <div className="flex flex-wrap items-center gap-2 font-mono text-xs text-muted-foreground">
                            <span className="text-foreground/70">settlements(paymentId) · read from the contract</span>
                            <a
                              className="underline underline-offset-2"
                              href={`${EXPLORER}/tx/${e.tx}`}
                              target="_blank"
                              rel="noreferrer"
                            >
                              tx ↗
                            </a>
                          </div>
                          {receipt === "loading" ? (
                            <span className="font-mono text-xs text-muted-foreground">reading contract…</span>
                          ) : receipt === "error" ? (
                            <span className="font-mono text-xs text-red-300">read failed</span>
                          ) : receipt ? (
                            <pre className="overflow-auto rounded border border-white/5 bg-background/70 p-2 font-mono text-xs leading-relaxed text-foreground/90">
                              {JSON.stringify(receipt, null, 2)}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )}
            </div>
            {refundTx && <a className="break-all rounded-lg border border-primary/30 p-3 font-mono text-xs text-primary" href={`${EXPLORER}/tx/${refundTx}`} target="_blank" rel="noreferrer">PaymentRefunded · {refundTx} ↗</a>}
            <div className="flex flex-col gap-1.5 rounded-xl border border-white/5 bg-card p-3 font-mono text-xs text-muted-foreground backdrop-blur">
              <div className="mb-0.5 text-xs uppercase tracking-wider text-muted-foreground/60">
                Deployed contracts · Monad Testnet
              </div>
              <Field label="token" value={shortenAddress(tokenAddress, 10)} mono />
              <Field label="payments" value={shortenAddress(poolAddress, 10)} mono />
            </div>
          </aside>
        </div>
      )}

      {/* ── A2A: the same purchase, driven by an agent ── */}
      <section className="flex flex-col gap-4 rounded-2xl border border-white/8 bg-card/60 px-6 py-6 backdrop-blur">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Network className="size-4 text-primary" /> Speaks A2A — another agent can buy this, not just a human
            </h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              Same wallet, same receipt, different door. An A2A client fetches the agent card, gets{" "}
              <span className="font-mono text-xs text-foreground/80">input-required</span> back with the x402 terms, and settles with{" "}
              <span className="font-mono text-xs text-foreground/80">message/send</span> — no browser, no checkout page.
            </p>
          </div>
          <Button disabled={a2aBusy || !effectiveAddress} onClick={() => void runA2A()} className="gap-2">
            {a2aBusy ? <Loader2 className="size-4 animate-spin" /> : <Network className="size-4" />}
            Run the A2A purchase
          </Button>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {/* Left — the three wire steps */}
          <div className="flex flex-col gap-2">
            {[
              { key: "task" as const, label: "1 · task", wire: "POST /api/a2a/task" },
              { key: "sign" as const, label: "2 · sign", wire: "EIP-3009 (offline)" },
              { key: "message" as const, label: "3 · message/send", wire: "POST /api/a2a/message" },
            ].map((s) => {
              const value = a2aSteps?.[s.key];
              const done = Boolean(value) && value !== "idle" && value !== "signing…" && value !== "message/send …";
              return (
                <div key={s.key} className="flex items-start gap-2 rounded-lg border border-white/5 bg-background/50 p-3 text-xs">
                  {done ? (
                    <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-primary" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-mono text-foreground/90">{s.label}</span>
                    <span className="break-all text-muted-foreground">{value ?? "—"}</span>
                    <span className="font-mono text-xs text-muted-foreground/60">{s.wire}</span>
                  </div>
                </div>
              );
            })}
            {a2aError ? (
              <p className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-300">
                {a2aError}
              </p>
            ) : null}
            {a2aReceipt ? (
              <div className="flex flex-col gap-1.5 rounded-lg border border-primary/30 bg-primary/6 p-3 text-xs">
                <span className="flex items-center gap-2 text-sm font-medium text-primary">
                  <CheckCircle2 className="size-4" /> x402.payment.receipts
                  <IdentityChip identity={(a2aReceipt as { identity?: IdentityVerification }).identity} />
                </span>
                <Field label="success" value={String(a2aReceipt.success)} mono />
                <Field label="network" value={String(a2aReceipt.network)} mono />
                <Field label="amount" value={String(a2aReceipt.amount)} mono />
                {typeof a2aReceipt.transaction === "string" && a2aReceipt.transaction.length > 10 ? (
                  <a
                    className="text-primary underline"
                    href={`${EXPLORER}/tx/${a2aReceipt.transaction}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Verify the transfer on Monad ↗
                  </a>
                ) : null}
                {a2aOutput ? (
                  <pre className="mt-1 max-h-40 overflow-auto rounded border border-white/5 bg-background/70 p-2 font-mono text-xs leading-relaxed text-foreground/90">
                    {JSON.stringify(a2aOutput, null, 2)}
                  </pre>
                ) : null}
              </div>
            ) : null}
            {a2aTaskId ? (
              <p className="font-mono text-xs text-muted-foreground">
                taskId <span className="text-foreground/80">{a2aTaskId}</span> — the merchant kept the terms it
                advertised keyed by that id, so the submission is validated against what it actually offered.
              </p>
            ) : null}
          </div>

          {/* Right — the discovery document, verbatim */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/70">
              GET /api/a2a/agent-card — discovery, verbatim
            </span>
            <pre className="max-h-72 overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {agentCard ? JSON.stringify(agentCard, null, 2) : "loading agent card…"}
            </pre>
          </div>
        </div>
      </section>

      {/* ── Integrate ── */}
      <section className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-card/60 px-6 py-6 backdrop-blur">
        <div className="flex flex-col gap-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Terminal className="size-4 text-primary" /> Integrate — meter any API in one line
          </h2>
          <p className="text-sm text-muted-foreground">
            The payment loop is a library, not a fork. Wrap your handler and the 402 / sign / settle / receipt path is handled for you.
          </p>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/70">1 · one line to bill per call</span>
            <pre className="overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {INTEGRATE_SNIPPET}
            </pre>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/70">2 · drive it from any MCP client</span>
            <pre className="overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {mcpSnippet(baseUrl)}
            </pre>
          </div>
          <div className="flex flex-col gap-1.5 lg:col-span-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground/70">3 · see the challenge from a shell</span>
            <pre className="overflow-auto rounded-md border border-white/5 bg-background/70 p-3 font-mono text-xs leading-relaxed text-foreground/90">
              {curlSnippet(baseUrl)}
            </pre>
          </div>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          A judge goes from zero to a settled, receipted payment in 30 seconds — one command:{" "}
          <span className="text-foreground/80">node scripts/burner-e2e-v2.mjs</span>
        </p>
      </section>

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
                      ? "flex items-center gap-1.5 rounded-full border border-primary/50 bg-primary/10 px-3 py-1 font-mono text-xs font-semibold text-primary"
                      : done
                        ? "flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 font-mono text-xs text-primary/80"
                        : "flex items-center gap-1.5 rounded-full border border-white/8 bg-white/3 px-3 py-1 font-mono text-xs text-muted-foreground"
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
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="font-mono">
            {step ?? "idle — burner ready, pick a metered API, start the loop"}
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
    <h2 className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
      <span className="size-1 rounded-full bg-primary" />
      {children}
    </h2>
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

/** The payer-identity claim, after the merchant verified it. Settlement never
 *  depends on this — it is additive evidence on the receipt, so "no attestation"
 *  simply renders nothing. `verified` (signature is real) and `trust` (we accept
 *  the attester) are shown as two separate facts, never collapsed into one. */
function IdentityChip({ identity }: { identity?: IdentityVerification }) {
  if (!identity) return null;
  const tone: IdentityTrust = identity.verified ? identity.trust : "none";
  const style: Record<IdentityTrust, string> = {
    allowlisted: "border-primary/40 bg-primary/10 text-primary",
    "self-attested": "border-amber-400/30 bg-amber-400/10 text-amber-300",
    untrusted: "border-red-400/30 bg-red-400/10 text-red-300",
    none: "border-red-400/30 bg-red-400/10 text-red-300",
  };
  const label: Record<IdentityTrust, string> = {
    allowlisted: "identity · allowlisted",
    "self-attested": "identity · self-attested (weak)",
    untrusted: "identity · untrusted attester",
    none: "identity · invalid",
  };
  const title = identity.verified
    ? identity.attester
      ? `attester ${identity.attester}`
      : undefined
    : identity.reason;
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-xs ${style[tone]}`}
    >
      <ShieldCheck className="size-3" />
      {label[tone]}
    </span>
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
