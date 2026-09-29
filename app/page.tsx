"use client";

import { AgentPaymentsDemo } from "@/components/agent-payments-demo";
import { Demo as EercDemo } from "@/components/demo";
import { useState } from "react";

/**
 * Home: the x402 payment base is the primary experience; the original eERC
 * confidential-token panel stays as a second tab (it powers the privacy layer
 * this base can optionally settle with).
 */
export default function Home() {
  const [tab, setTab] = useState<"x402" | "eerc">("x402");
  return (
    <div className="min-h-dvh">
      <nav className="sticky top-0 z-20 border-b border-white/5 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-primary shadow-[0_0_14px_2px_var(--color-primary)]" />
            <span className="font-mono text-sm font-semibold tracking-tight">
              x402 Agent Gateway
            </span>
            <span className="hidden rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary sm:inline-block">
              ● LIVE
            </span>
            <span className="hidden rounded-full border border-white/10 bg-white/5 px-2 py-0.5 font-mono text-[10px] text-muted-foreground md:inline-block">
              FUJI · 43113
            </span>
          </div>
          <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/5 p-1">
            <TabButton active={tab === "x402"} onClick={() => setTab("x402")}>
              x402 支付底座
            </TabButton>
            <TabButton active={tab === "eerc"} onClick={() => setTab("eerc")}>
              隐私代币 eERC
            </TabButton>
          </div>
        </div>
      </nav>
      <main className="mx-auto max-w-[1440px] px-6 py-6">
        {tab === "x402" ? <AgentPaymentsDemo /> : <EercDemo />}
      </main>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-[0_0_16px_-2px_var(--color-primary)]"
          : "rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
      }
    >
      {children}
    </button>
  );
}
