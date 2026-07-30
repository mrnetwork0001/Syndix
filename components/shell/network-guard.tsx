"use client";

import type { ReactElement } from "react";
import { Loader2, Plus, TriangleAlert } from "lucide-react";
import { useGiwaNetwork } from "@/lib/use-giwa-network";
import { GIWA_SEPOLIA_ID } from "@/lib/giwa";

/**
 * Sticky banner shown whenever a connected wallet is on the wrong chain.
 *
 * A badge in the header was not enough: nothing on GIWA Sepolia works from
 * another chain, and a first-time wallet does not have the network at all, so
 * this both explains the state and offers the one-click fix. Unlike the badge,
 * it is visible on mobile.
 */
export function NetworkGuard(): ReactElement | null {
  const { onWrongNetwork, chainId, pending, error, switchToGiwa } =
    useGiwaNetwork();

  if (!onWrongNetwork) return null;

  return (
    <div
      role="alert"
      className="sticky top-[57px] z-40 border-b border-caution/25 bg-[#1a1408]/95 backdrop-blur-md"
    >
      <div className="mx-auto flex w-full max-w-[1200px] flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-6">
        <TriangleAlert
          className="size-4 shrink-0 text-caution"
          strokeWidth={2}
        />
        <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-caution">
          Your wallet is on chain{" "}
          <span className="font-mono tabular-nums">{chainId}</span>. Syndix
          settles on GIWA Sepolia ({GIWA_SEPOLIA_ID}) - rewards and claims will
          fail until you switch.
          {error ? (
            <span className="mt-0.5 block text-[11.5px] text-critical">
              {error}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => void switchToGiwa()}
          disabled={pending}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[9px] bg-caution px-3 text-[12px] font-semibold text-[#1a1408] transition-opacity duration-200 hover:opacity-90 disabled:opacity-60"
        >
          {pending ? (
            <>
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2.4} />
              Waiting for wallet…
            </>
          ) : (
            <>
              <Plus className="size-3.5" strokeWidth={2.6} />
              Add / switch to GIWA Sepolia
            </>
          )}
        </button>
      </div>
    </div>
  );
}
