"use client";

import { type WalletAdapter, burnerAdapter, injectedAdapter, toViemChain } from "@avakit/core";
import { monadMainnet } from "@/lib/chain";
import { web3authAdapter } from "@avakit/core/web3auth";
import { AvaKitProvider } from "@avakit/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { type ReactNode, useMemo, useState } from "react";
import { WagmiProvider, http, createConfig } from "wagmi";

// Shared AvaKit demo Web3Auth client ID so social login works with zero setup on
// localhost. It only allows localhost origins — replace it with your own (free at
// dashboard.web3auth.io) before deploying.
const DEMO_WEB3AUTH_CLIENT_ID =
  "BI14QqLFixs0HxS-XPTpHav_oVgLsntWv54Tjz69ruuqP5NP8rdcc0yl1CUKdlu9Nk--sKdQUVV7mOz41lsnhmg";

export function Providers({ children }: { children: ReactNode }) {
  const adapters = useMemo(() => {
    const list: WalletAdapter[] = [];
    // Social login works out of the box on localhost via the bundled demo key;
    // NEXT_PUBLIC_WEB3AUTH_CLIENT_ID overrides it (set your own for deployment).
    list.push(
      web3authAdapter({
        clientId: process.env.NEXT_PUBLIC_WEB3AUTH_CLIENT_ID || DEMO_WEB3AUTH_CLIENT_ID,
        chains: [monadMainnet],
      }),
    );
    // Injected (Core / MetaMask) is always available.
    list.push(injectedAdapter());
    // Zero-config fallback: a temporary in-browser wallet so a new user can try
    // everything with no setup. The wallets above are the bring-your-own upgrade.
    list.push(burnerAdapter({ chain: monadMainnet }));
    return list;
  }, []);

  // wagmi provides an RPC read client for Base Sepolia. Wallet connect/sign
  // goes through AvaKitProvider's adapters (Web3Auth / injected / burner).
  const [wagmiConfig] = useState(() => {
    const viemChain = toViemChain(monadMainnet);
    return createConfig({
      chains: [viemChain],
      transports: { [viemChain.id]: http("https://rpc.monad.xyz") },
    });
  });
  const [queryClient] = useState(() => new QueryClient());

  return (
    <ThemeProvider attribute="class" defaultTheme="dark" forcedTheme="dark" disableTransitionOnChange>
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          <AvaKitProvider chains={[monadMainnet]} adapters={adapters}>
            {children}
          </AvaKitProvider>
        </WagmiProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
