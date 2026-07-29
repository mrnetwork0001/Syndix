"use client";

import { useRef, type KeyboardEvent, type ReactElement } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { Track, TrackId } from "@/lib/types";
import { cn } from "@/lib/utils";

export type FeedFilter = TrackId | "all";

export interface FilterTabsProps {
  active: FeedFilter;
  onChange: (next: FeedFilter) => void;
  counts: Record<string, number>;
  tracks: Track[];
  className?: string;
}

const PILL_ID = "syndix-feed-filter-pill";

export function FilterTabs({
  active,
  onChange,
  counts,
  tracks,
  className,
}: FilterTabsProps): ReactElement {
  const reduce = useReducedMotion();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const items: { value: FeedFilter; label: string }[] = [
    { value: "all", label: "All Issues" },
    ...tracks.map((track) => ({ value: track.id as FeedFilter, label: track.label })),
  ];

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.value === active);
    if (index < 0) return;

    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + items.length) % items.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else return;

    event.preventDefault();
    onChange(items[next].value);
    tabRefs.current[next]?.focus();
  }

  return (
    <div
      role="tablist"
      aria-label="Filter issues by track"
      onKeyDown={onKeyDown}
      className={cn(
        "-mx-4 flex max-w-full items-center gap-1 overflow-x-auto px-4 py-1 sm:mx-0 sm:px-0",
        "[scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
      )}
    >
      {items.map((item, index) => {
        const selected = item.value === active;
        const count = counts[item.value] ?? 0;

        return (
          <button
            key={item.value}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(item.value)}
            className={cn(
              "relative shrink-0 rounded-[11px] px-3 py-2 text-[13px] font-medium whitespace-nowrap",
              "transition-colors duration-200 ease-out",
              selected ? "text-ink" : "text-ink-faint hover:text-ink-muted",
            )}
          >
            {selected ? (
              <motion.span
                layoutId={reduce ? undefined : PILL_ID}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { type: "spring", stiffness: 520, damping: 42, mass: 0.7 }
                }
                className="absolute inset-0 -z-10 rounded-[11px] border border-hairline-strong bg-elevated shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
              />
            ) : null}

            <span className="flex items-center gap-2">
              {item.label}
              <span
                className={cn(
                  "font-mono text-[11px] leading-none tabular-nums",
                  selected ? "text-ink-muted" : "text-ink-faint/70",
                )}
              >
                {count}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default FilterTabs;
