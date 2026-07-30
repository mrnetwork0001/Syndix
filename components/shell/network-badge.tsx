"use client";

import { useSyncExternalStore, type ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { useGiwaNetwork } from "@/lib/use-giwa-network";
import { Skeleton } from "@/components/ui/skeleton";
import { GIWA_SEPOLIA_ID } from "@/lib/giwa";

const noopSubscribe = () => () => {};
const alwaysTrue = () => true;
const alwaysFalse = () => false;

export function NetworkBadge(): ReactElement {
  const { chainId, onWrongNetwork, pending, switchToGiwa } =
    useGiwaNetwork();
  /** false during SSR and the hydrating render, true from the commit onward. */
  const mounted = useSyncExternalStore(noopSubscribe, alwaysTrue, alwaysFalse);

  if (!mounted) {
    return <Skeleton className="hidden h-8 w-[128px] rounded-full sm:block" />;
  }

  if (onWrongNetwork) {
    return (
      <button
        type="button"
        onClick={() => void switchToGiwa()}
        disabled={pending}
        className="hidden h-8 shrink-0 items-center gap-1.5 rounded-full bg-caution/[0.13] px-2.5 text-[11.5px] font-medium text-caution transition-colors duration-200 hover:bg-caution/20 disabled:opacity-50 sm:inline-flex"
      >
        <TriangleAlert className="size-3.5" strokeWidth={2.1} />
        {pending ? "Switching…" : `Wrong network (${chainId})`}
      </button>
    );
  }

  return (
    <span className="hidden h-8 shrink-0 items-center gap-2 rounded-full bg-white/[0.04] px-3 text-[11.5px] font-medium text-ink-muted sm:inline-flex">
      <span className="animate-live-dot size-1.5 rounded-full bg-positive" />
      GIWA Sepolia
      <span className="font-mono text-[10.5px] tabular-nums text-ink-faint">
        {GIWA_SEPOLIA_ID}
      </span>
    </span>
  );
}
