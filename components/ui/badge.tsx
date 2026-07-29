import type { ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BadgeTone =
  | "neutral"
  | "accent"
  | "positive"
  | "caution"
  | "critical"
  | "cyan"
  | "violet";

export interface BadgeProps {
  tone?: BadgeTone;
  icon?: LucideIcon;
  dot?: boolean;
  className?: string;
  children: ReactNode;
}

/**
 * `text-accent` (#0066ff) is too dark to read at 11px on the void background,
 * so the accent tone uses a lifted blue while keeping the true accent for the
 * border and fill.
 */
const TONES: Record<BadgeTone, string> = {
  neutral: "border-hairline bg-white/[0.045] text-ink-muted",
  accent: "border-accent/35 bg-accent/[0.14] text-[#7fb2ff]",
  positive: "border-positive/30 bg-positive/[0.12] text-positive",
  caution: "border-caution/30 bg-caution/[0.12] text-caution",
  critical: "border-critical/30 bg-critical/[0.12] text-critical",
  cyan: "border-cyan/30 bg-cyan/[0.12] text-cyan",
  violet: "border-violet/30 bg-violet/[0.12] text-violet",
};

export function Badge({
  tone = "neutral",
  icon: Icon,
  dot = false,
  className,
  children,
}: BadgeProps): ReactElement {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-[3px]",
        "text-[10.5px] leading-none font-medium tracking-[0.09em] uppercase",
        TONES[tone],
        className,
      )}
    >
      {dot ? (
        <span className="animate-live-dot size-1.5 shrink-0 rounded-full bg-current" />
      ) : null}
      {Icon ? <Icon className="size-3 shrink-0" strokeWidth={2.1} /> : null}
      <span className="truncate">{children}</span>
    </span>
  );
}
