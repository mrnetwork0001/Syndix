"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactElement } from "react";
import { ArrowUpRight } from "lucide-react";
import { ConnectButton } from "@/components/shell/connect-button";
import { NetworkBadge } from "@/components/shell/network-badge";
import { GIWA_EXPLORER } from "@/lib/giwa";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Feed", matches: ["/", "/issue"] },
  { href: "/studio", label: "Agent Studio", short: "Studio", matches: ["/studio"] },
  { href: "/protocol", label: "Protocol", matches: ["/protocol"] },
] as const;

/**
 * Routes where a wallet is actually used, and so where the header carries the
 * connect button and network badge.
 *
 * The feed and /protocol are read-only, so wallet chrome there is noise that
 * implies a connection is needed to browse. Claiming happens on an issue page
 * and publishing in the studio — and the studio has no connect affordance of
 * its own, so hiding the header control there would leave no way to connect at
 * all. The claim modal does have its own, which is why /issue would survive
 * either choice.
 */
const WALLET_ROUTES = ["/issue", "/studio"] as const;

export function Header(): ReactElement {
  const pathname = usePathname();
  const showWallet = WALLET_ROUTES.some((route) => pathname.startsWith(route));

  return (
    <header className="glass sticky top-0 z-50 border-x-0! border-t-0!">
      <div className="mx-auto flex h-14 w-full max-w-[1200px] items-center gap-1.5 px-4 sm:gap-3 sm:px-6">
        {/* On wallet routes both flanks get an equal flex basis, which is what
            actually centres the nav between them — `mx-auto` would only centre
            it in the leftover space and drift as the wallet label changes
            width. Without wallet chrome there is no right flank to balance
            against, so the nav keeps its right alignment. */}
        <div
          className={cn(
            "flex min-w-0 items-center gap-1.5 sm:gap-3",
            showWallet && "flex-1",
          )}
        >
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 rounded-[10px] transition-opacity duration-200 hover:opacity-80"
            aria-label="Syndix — home"
          >
            <SyndixMark />
            <span className="hidden text-[15px] font-semibold tracking-[-0.028em] text-ink sm:inline">
              Syndix
            </span>
          </Link>

          <span
            aria-hidden
            className="hidden h-4 w-px shrink-0 bg-hairline-strong sm:block"
          />
        </div>

        <nav
          className={cn(
            "flex min-w-0 items-center gap-0.5",
            !showWallet && "ml-auto",
          )}
        >
          {NAV.map((item) => {
            const active = item.matches.some((m) =>
              m === "/" ? pathname === "/" : pathname.startsWith(m),
            );
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-[9px] px-2 py-1.5 text-[13px] font-medium whitespace-nowrap sm:px-2.5",
                  "transition-colors duration-200",
                  active
                    ? "bg-white/[0.07] text-ink"
                    : "text-ink-muted hover:bg-white/[0.045] hover:text-ink",
                )}
              >
                <span className="hidden md:inline">{item.label}</span>
                <span className="md:hidden">
                  {"short" in item ? item.short : item.label}
                </span>
              </Link>
            );
          })}

          <a
            href={GIWA_EXPLORER}
            target="_blank"
            rel="noreferrer"
            className="hidden items-center gap-1 rounded-[9px] px-2.5 py-1.5 text-[13px] font-medium whitespace-nowrap text-ink-muted transition-colors duration-200 hover:bg-white/[0.045] hover:text-ink md:inline-flex"
          >
            Explorer
            <ArrowUpRight className="size-3.5 text-ink-faint" strokeWidth={2} />
          </a>
        </nav>

        {showWallet ? (
          <div className="flex flex-1 items-center justify-end gap-2">
            <NetworkBadge />
            <ConnectButton />
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * "Giwa" (기와) are Korean roof tiles — two interlocking eaves tiles under a
 * ridge tile that bridges the seam. Same idea as an L2 batching two rollups
 * of activity under one settlement layer, which is why it suits the mark.
 */
function SyndixMark(): ReactElement {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-[26px] shrink-0"
      role="img"
      aria-hidden
    >
      <defs>
        <linearGradient id="syndix-mark-hdr" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#4d92ff" />
          <stop offset="100%" stopColor="#0047b3" />
        </linearGradient>
      </defs>
      <rect width="24" height="24" rx="7.5" fill="url(#syndix-mark-hdr)" />
      <rect
        width="23"
        height="23"
        x="0.5"
        y="0.5"
        rx="7"
        fill="none"
        stroke="rgba(255,255,255,0.28)"
      />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.55"
        strokeLinecap="round"
        opacity="0.94"
      >
        <path d="M4.4 17.1a3.6 3.6 0 0 1 7.2 0" />
        <path d="M12.4 17.1a3.6 3.6 0 0 1 7.2 0" />
        <path d="M8.4 10.4a3.6 3.6 0 0 1 7.2 0" />
      </g>
    </svg>
  );
}
