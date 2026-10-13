"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createDynamicClient } from "@dynamic-labs-sdk/client";
import { createWaasWalletAccounts, getChainsMissingWaasWalletAccounts } from "@dynamic-labs-sdk/client/waas";
import { addWaasEvmExtension } from "@dynamic-labs-sdk/evm/waas";
import {
  DynamicProvider,
  useGetWalletAccounts,
  useInitStatus,
  useLogout,
  useOnEvent,
  useSendEmailOTP,
  useUser,
  useVerifyOTP,
} from "@dynamic-labs-sdk/react-hooks";
import { Loader2, Mail, Wallet } from "lucide-react";
import { Component, type ReactNode, useState } from "react";

/**
 * Dynamic embedded (WaaS) wallet — an optional signer for the x402 loop.
 *
 * The whole module is code-split with `ssr: false` and only rendered when
 * `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` is set, so the demo's default path
 * (burner / injected / Web3Auth) is untouched when Dynamic is not configured.
 */
export default function DynamicEmbeddedWallet() {
  const [client] = useState(() => {
    const c = createDynamicClient({
      environmentId: process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID as string,
      metadata: { name: "x402 Agent Gateway", universalLink: window.location.origin },
    });
    // Register the embedded-wallet extension right after client creation.
    addWaasEvmExtension();
    return c;
  });
  const [queryClient] = useState(() => new QueryClient());

  return (
    <CardBoundary>
      <QueryClientProvider client={queryClient}>
        <DynamicProvider client={client}>
          <EmbeddedWalletCard />
        </DynamicProvider>
      </QueryClientProvider>
    </CardBoundary>
  );
}

function EmbeddedWalletCard() {
  const { data: initStatus } = useInitStatus();
  const { data: user } = useUser();
  const { data: accounts = [] } = useGetWalletAccounts();
  const { mutate: sendEmailOTP, data: otpVerification } = useSendEmailOTP();
  const { mutate: verifyOTP } = useVerifyOTP();
  const { mutate: logout } = useLogout();

  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");

  // Wallet creation is not automatic — bootstrap the WaaS account on sign-in.
  useOnEvent({
    event: "userChanged",
    listener: async ({ user }) => {
      if (!user) return;
      const missing = getChainsMissingWaasWalletAccounts();
      if (missing.length > 0) await createWaasWalletAccounts({ chains: missing });
    },
  });

  const address = accounts[0]?.address;

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/8 bg-card px-4 py-3 text-xs backdrop-blur">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Wallet className="size-4 text-primary" />
        Dynamic embedded wallet
        <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-normal text-primary">
          WaaS
        </span>
      </div>

      {initStatus !== "finished" ? (
        <p className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> starting Dynamic…
        </p>
      ) : !user ? (
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground">
            Sign in with email — Dynamic provisions an embedded wallet the agent can sign with.
          </p>
          {!otpVerification ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="rounded-md border border-white/10 bg-background/60 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
              />
              <button
                onClick={() => sendEmailOTP({ email })}
                disabled={!email}
                className="flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
              >
                <Mail className="size-3.5" /> Send code
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                className="w-28 rounded-md border border-white/10 bg-background/60 px-2.5 py-1.5 font-mono text-xs text-foreground outline-none focus:border-primary/50"
              />
              <button
                onClick={() => verifyOTP({ otpVerification, verificationToken: code })}
                disabled={!code}
                className="rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary disabled:opacity-50"
              >
                Verify
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-muted-foreground">
            {user.email} · embedded wallet{" "}
            <span className="font-mono text-foreground">{address ? shorten(address) : "provisioning…"}</span>
          </span>
          <button
            onClick={() => logout()}
            className="rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-muted-foreground hover:bg-white/10"
          >
            sign out
          </button>
        </div>
      )}
    </div>
  );
}

function shorten(addr: string): string {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

/** Keeps a Dynamic failure from taking down the rest of the demo. */
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) {
      return (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-xs text-red-300">
          Dynamic embedded wallet unavailable — the x402 demo above is unaffected.
        </div>
      );
    }
    return this.props.children;
  }
}
