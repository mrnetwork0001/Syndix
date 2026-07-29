"use client";

import type { ButtonHTMLAttributes, ReactElement } from "react";
import { LoaderCircle, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
  full?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white shadow-[0_1px_2px_rgba(0,0,0,0.4)] hover:bg-accent-hover hover:accent-glow",
  secondary:
    "border border-hairline bg-elevated text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] hover:border-hairline-strong hover:bg-overlay",
  ghost: "text-ink-muted hover:bg-elevated hover:text-ink",
  danger:
    "border border-critical/30 bg-critical/[0.12] text-critical hover:border-critical/55 hover:bg-critical/[0.18]",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-[10px] px-2.5 text-[12.5px]",
  md: "h-9.5 gap-2 rounded-[11px] px-3.5 text-[13.5px]",
  lg: "h-11 gap-2 rounded-card px-5 text-[15px]",
};

const ICON_SIZES: Record<ButtonSize, string> = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-[18px]",
};

export function Button({
  variant = "secondary",
  size = "md",
  loading = false,
  icon: Icon,
  iconRight: IconRight,
  full = false,
  className,
  children,
  disabled,
  type,
  ...rest
}: ButtonProps): ReactElement {
  const iconClass = ICON_SIZES[size];

  return (
    <button
      type={type ?? "button"}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap select-none",
        "transition-[background-color,border-color,box-shadow,color,transform] duration-200 ease-out",
        "active:scale-[0.985] disabled:pointer-events-none disabled:opacity-45",
        SIZES[size],
        VARIANTS[variant],
        full && "w-full",
        className,
      )}
      {...rest}
    >
      {loading ? (
        <LoaderCircle className={cn(iconClass, "animate-spin")} strokeWidth={2.2} />
      ) : Icon ? (
        <Icon className={iconClass} strokeWidth={2} />
      ) : null}
      {children}
      {IconRight && !loading ? (
        <IconRight className={iconClass} strokeWidth={2} />
      ) : null}
    </button>
  );
}
