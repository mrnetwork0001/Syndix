import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }): ReactElement {
  return (
    <div
      aria-hidden
      className={cn(
        "relative overflow-hidden rounded-card border border-hairline bg-elevated/60",
        className,
      )}
    >
      <div className="animate-sweep absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-white/[0.055] to-transparent" />
    </div>
  );
}
