"use client";

import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider } from "wagmi";
import { createWagmiConfig } from "@/lib/wagmi";
import { setAmbientRates, type RatesSnapshot } from "@/lib/prices";

export function Providers({
  children,
  rates,
}: {
  children: ReactNode;
  rates: RatesSnapshot;
}) {
  // Both are created lazily inside useState so they survive Fast Refresh and
  // are never re-instantiated on re-render — a new QueryClient per render would
  // silently discard every cached balance and stats query.
  const [config] = useState(() => createWagmiConfig());
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Synchronous, not in an effect: the first client render must format prices
  // identically to the server HTML or every price is a hydration mismatch.
  setAmbientRates(rates);

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
