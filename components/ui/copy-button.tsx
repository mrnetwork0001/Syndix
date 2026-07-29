"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label,
  className,
}: {
  value: string;
  label?: string;
  className?: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const onCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <button
      type="button"
      onClick={onCopy}
      aria-label={copied ? "Copied" : `Copy ${label ?? value}`}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-transparent px-2",
        "text-[11px] font-medium tracking-[0.04em] text-ink-faint",
        "transition-colors duration-150 ease-out",
        "hover:border-hairline hover:bg-elevated hover:text-ink-muted",
        copied && "text-positive",
        className,
      )}
    >
      {copied ? (
        <Check className="size-3.5" strokeWidth={2.2} />
      ) : (
        <Copy className="size-3.5" strokeWidth={2} />
      )}
      {label ? <span>{copied ? "Copied" : label}</span> : null}
    </button>
  );
}
