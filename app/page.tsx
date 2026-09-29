"use client";

import { AgentPaymentsDemo } from "@/components/agent-payments-demo";

/**
 * Home: the x402 AI-agent micropayment base — a single-product page.
 * (The template's eERC panel was removed: it was an un-branded scaffold
 * that diluted the product story and confused first-time visitors.)
 */
export default function Home() {
  return (
    <div className="min-h-dvh">
      <nav className="sticky top-0 z-20 border-b border-white/5 bg-background/70 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center justify-between gap-4 px-6">
          <div className="flex items-center gap-3">
            <span className="size-2 rounded-full bg-primary" />
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
        </div>
      </nav>
      <main className="mx-auto max-w-[1440px] px-6 py-6">
        <AgentPaymentsDemo />
      </main>
    </div>
  );
}
