import type { HTMLAttributes, ReactElement, ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Panel({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>): ReactElement {
  return (
    <div className={cn("panel", className)} {...rest}>
      {children}
    </div>
  );
}

export interface PanelHeaderProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}

export function PanelHeader({
  title,
  description,
  icon: Icon,
  action,
  className,
}: PanelHeaderProps): ReactElement {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-4 border-b border-hairline px-5 py-4",
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {Icon ? (
          <span className="mt-px grid size-7 shrink-0 place-items-center rounded-[9px] border border-hairline bg-elevated">
            <Icon className="size-3.5 text-ink-muted" strokeWidth={1.9} />
          </span>
        ) : null}
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold tracking-[-0.012em] text-ink">
            {title}
          </h3>
          {description ? (
            <p className="mt-1 text-xs leading-relaxed text-ink-muted">
              {description}
            </p>
          ) : null}
        </div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
