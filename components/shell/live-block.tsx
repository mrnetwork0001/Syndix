"use client";

import type { ReactElement } from "react";
import { useBlockNumber } from "wagmi";
import { GIWA_SEPOLIA_ID } from "@/lib/giwa";
import { cn } from "@/lib/utils";

export interface LiveBlockProps {
  /**
   * Block height the server rendered with, as a string — bigint is not
   * serialisable across the server/client boundary. Shown until the first
   * client poll lands, so the number never flashes empty.
   */
  initialBlock: string;
  className?: string;
}

/**
 * The head block, ticking.
 *
 * GIWA produces a block roughly every second, so a height captured at render
 * time is stale before the page finishes painting. Polling a little under the
 * block time keeps it honest and makes the chain's speed visible, which is most
 * of the point of building here.
 */
export function LiveBlock({
  initialBlock,
  className,
}: LiveBlockProps): ReactElement {
  const { data: blockNumber } = useBlockNumber({
    chainId: GIWA_SEPOLIA_ID,
    watch: { pollingInterval: 900 },
  });

  const current = blockNumber?.toString() ?? initialBlock;

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className="animate-live-dot size-1.5 shrink-0 rounded-full bg-positive"
      />
      <span className="whitespace-nowrap">
        Live · block{" "}
        {/*
          Keying on the height remounts this span every block, which replays the
          CSS animation. A useEffect + setState flash would fire setState
          synchronously inside an effect — a cascading render the lint rule
          rightly rejects — and this needs no state at all.
        */}
        <span key={current} className="animate-rise font-mono tabular-nums">
          {current}
        </span>
      </span>
    </span>
  );
}
