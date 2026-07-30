"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPublicClient, http } from "viem";
import { GIWA_RPC_HTTP, giwaSepolia } from "@/lib/giwa";
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

/** A touch under GIWA's ~1s block time, so the number never looks stuck. */
const POLL_MS = 900;

/**
 * The head block, ticking.
 *
 * Polls explicitly rather than using wagmi's `useBlockNumber({ watch })`. That
 * hook takes `pollingInterval` only inside its `poll: true` branch; passing the
 * interval without the flag lands in the WebSocket-subscription branch, which
 * never fires against GIWA's HTTP transport — the number silently froze. A
 * plain interval is one line longer and has no such failure mode.
 */
export function LiveBlock({
  initialBlock,
  className,
}: LiveBlockProps): ReactElement {
  const [block, setBlock] = useState(initialBlock);
  const latest = useRef(initialBlock);

  useEffect(() => {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { retryCount: 0 }),
    });

    let cancelled = false;

    const tick = async () => {
      try {
        const next = (await client.getBlockNumber({ cacheTime: 0 })).toString();
        // Skip the state write when the height has not moved, so React is not
        // re-rendering the whole badge every second for nothing.
        if (!cancelled && next !== latest.current) {
          latest.current = next;
          setBlock(next);
        }
      } catch {
        // A dropped poll is not worth surfacing; the next one will land.
      }
    };

    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span
        aria-hidden
        className="animate-live-dot size-1.5 shrink-0 rounded-full bg-positive"
      />
      <span className="whitespace-nowrap">
        Live · block{" "}
        {/* Keyed on the height so the CSS rise animation replays each block. */}
        <span key={block} className="animate-rise font-mono tabular-nums">
          {block}
        </span>
      </span>
    </span>
  );
}
