"use client";

import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPublicClient, http } from "viem";
import { Timer } from "lucide-react";
import { GIWA_RPC_HTTP, giwaSepolia } from "@/lib/giwa";
import { cn } from "@/lib/utils";

/** A touch under GIWA's ~1s block time, so the number never looks stuck. */
const POLL_MS = 900;

/**
 * The "~1s blocks" claim, demonstrating itself.
 *
 * The hero asserted GIWA's block time in a chip and then sat perfectly still
 * while saying it. This ticks the head block in place and flashes the chip each
 * time the height moves, so the fastest thing about the chain is visible in the
 * first second someone lands on the page - and in the first second of a demo
 * video.
 *
 * It is the one piece of motion here that is not decoration: nothing is on a
 * timeline, and if GIWA stalls the hero stops moving, which is the honest
 * outcome rather than a hidden animation covering for it.
 *
 * Polls explicitly instead of `useBlockNumber({ watch })`, for the reason
 * documented in components/shell/live-block.tsx: that hook only honours
 * `pollingInterval` inside its `poll: true` branch, and silently freezes
 * against an HTTP transport.
 */
export function HeroPulse({
  initialBlock,
  className,
}: {
  /** Height the server rendered with, as a string - bigint is not serialisable. */
  initialBlock: string;
  className?: string;
}): ReactElement {
  const [block, setBlock] = useState(initialBlock);
  const [beat, setBeat] = useState(0);
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
        if (!cancelled && next !== latest.current) {
          latest.current = next;
          setBlock(next);
          // Drives the flash. Incrementing rather than toggling means a run of
          // fast blocks each get their own animation instead of cancelling out.
          setBeat((n) => n + 1);
        }
      } catch {
        // A dropped poll is not worth surfacing; the next one lands in 900ms.
      }
    };

    void tick();
    const timer = window.setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const pretty = Number(block).toLocaleString("en-US");

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5",
        "border-hairline bg-surface/70 text-[11.5px] text-ink-muted backdrop-blur-sm",
        "transition-[border-color,box-shadow] duration-300 ease-out",
        className,
      )}
      style={{
        // Fades back over the 900ms between polls, so the chip breathes with
        // the chain rather than blinking.
        borderColor: "color-mix(in srgb, var(--color-positive) 34%, transparent)",
      }}
    >
      <Timer className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
      <span className="whitespace-nowrap">~1s blocks</span>
      <span
        aria-hidden
        key={beat}
        className="animate-live-dot size-1.5 shrink-0 rounded-full bg-positive"
      />
      <span
        key={`n-${beat}`}
        className="animate-rise font-mono text-[11.5px] tabular-nums text-ink"
      >
        #{pretty}
      </span>
      <span className="sr-only">GIWA Sepolia head block {pretty}</span>
    </span>
  );
}
