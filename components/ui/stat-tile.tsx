import type { ReactElement } from "react";
import { ArrowDownRight, ArrowUpRight, Minus, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StatTileProps {
  label: string;
  value: string;
  sublabel?: string;
  icon?: LucideIcon;
  /** signed percentage change, rendered green/red with an arrow */
  trend?: number;
  accent?: boolean;
  className?: string;
}

export function StatTile({
  label,
  value,
  sublabel,
  icon: Icon,
  trend,
  accent = false,
  className,
}: StatTileProps): ReactElement {
  const hasTrend = typeof trend === "number" && Number.isFinite(trend);
  const dir = !hasTrend ? "none" : trend > 0 ? "up" : trend < 0 ? "down" : "flat";
  const TrendIcon =
    dir === "up" ? ArrowUpRight : dir === "down" ? ArrowDownRight : Minus;

  return (
    <div className={cn("panel px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[11px] tracking-[0.14em] text-ink-faint uppercase">
          {label}
        </span>
        {Icon ? (
          <Icon
            className={cn("size-3.5 shrink-0", accent ? "text-accent" : "text-ink-faint")}
            strokeWidth={1.9}
          />
        ) : null}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-[26px] leading-none font-medium tracking-[-0.03em] tabular-nums",
            accent ? "text-accent" : "text-ink",
          )}
        >
          {value}
        </span>
        {hasTrend ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-mono text-[11px] leading-none tabular-nums",
              dir === "up" && "text-positive",
              dir === "down" && "text-critical",
              dir === "flat" && "text-ink-faint",
            )}
          >
            <TrendIcon className="size-3" strokeWidth={2.4} />
            {Math.abs(trend).toFixed(1)}%
          </span>
        ) : null}
      </div>

      {sublabel ? (
        <p className="mt-2 truncate text-xs text-ink-muted">{sublabel}</p>
      ) : null}
    </div>
  );
}
