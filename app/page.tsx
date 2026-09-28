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
    <div>
      <div className="fixed inset-x-0 top-0 z-10 flex justify-center gap-1 border-b bg-background/80 py-2 backdrop-blur">
        <TabButton active={tab === "x402"} onClick={() => setTab("x402")}>
          x402 支付底座
        </TabButton>
        <TabButton active={tab === "eerc"} onClick={() => setTab("eerc")}>
          隐私代币 eERC
        </TabButton>
      </div>
      <div className="pt-12">
        {tab === "x402" ? <AgentPaymentsDemo /> : <EercDemo />}
      </div>
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
          ? "rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background"
          : "rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
      }
    >
      {children}
    </button>
  );
}
