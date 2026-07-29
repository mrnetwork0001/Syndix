import type { ReactElement, ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Mono({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}): ReactElement {
  return (
    <span
      className={cn(
        "font-mono text-xs tabular-nums tracking-[-0.01em] text-ink-muted",
        className,
      )}
    >
      {children}
    </span>
  );
}
