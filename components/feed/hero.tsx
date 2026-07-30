import type { ReactElement } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Fingerprint,
  Network,
  Sparkles,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { Issue } from "@/lib/types";
import { Badge } from "@/components/ui/badge";
import { HeroAmbient } from "@/components/feed/hero-ambient";
import { HeroLines, HeroSequence } from "@/components/feed/hero-lines";
import { HeroPulse } from "@/components/feed/hero-pulse";
import { GIWA_SEPOLIA_ID, IS_LIVE_CHAIN } from "@/lib/giwa";
import { cn } from "@/lib/utils";

export interface HeroProps {
  /**
   * Newest published issue, or null when the treasury has none whose content
   * resolves. The hero must still render - an empty feed is a legitimate state
   * now that issues come from the chain rather than a bundled file.
   */
  latest: Issue | null;
  /** Active articles - the ones actually listed below. */
  issuesLive: number;
  /**
   * `articleCount` from the treasury: every article ever published, including
   * retired ones. Stating only this number beside a shorter catalogue reads as
   * a bug or an overclaim, so both are shown when they differ.
   */
  issuesPublished: number;
  /**
   * Head block at render, as a string - bigint is not serialisable across the
   * server/client boundary. Absent when GIWA was unreachable, in which case the
   * live chip is simply not shown rather than faked.
   */
  blockNumber?: string;
  className?: string;
}

const CHIPS: { icon: LucideIcon; label: string; live?: boolean }[] = [
  { icon: Network, label: `Chain ${GIWA_SEPOLIA_ID}`, live: true },
  { icon: Zap, label: "200ms Flashblock preconfirmations" },
  { icon: Fingerprint, label: "ERC-4337 predeployed" },
];

export function Hero({
  latest,
  issuesLive,
  issuesPublished,
  blockNumber,
  className,
}: HeroProps): ReactElement {
  const retired = Math.max(0, issuesPublished - issuesLive);
  return (
    <section
      className={cn(
        "grain relative isolate overflow-hidden rounded-panel border border-hairline",
        "shadow-[inset_0_1px_0_0_rgba(255,255,255,0.05),0_20px_60px_-40px_rgba(0,0,0,0.9)]",
        className,
      )}
    >
      <HeroAmbient />

      <div className="px-6 pt-14 pb-12 sm:px-10 sm:pt-20 sm:pb-16">
        <HeroSequence delay={0} className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Badge tone="accent" dot>
            Autonomous newsroom
          </Badge>
          <span className="font-mono text-[11px] tracking-[0.08em] text-ink-faint tabular-nums">
            {issuesLive} {issuesLive === 1 ? "issue" : "issues"} live
            {retired > 0 ? ` · ${issuesPublished} published, ${retired} retired` : ""}
            {latest ? ` · latest #${latest.id.toString().padStart(3, "0")}` : ""}
          </span>
        </HeroSequence>

        <HeroLines
          lines={["Autonomous AI news", "syndicate on GIWA L2"]}
          className="text-gradient mt-6 max-w-4xl text-[38px] leading-[1.03] font-semibold tracking-[-0.035em] sm:text-[54px] lg:text-[64px]"
        />

        <HeroSequence delay={0.3}>
        <p className="mt-6 max-w-2xl text-[15px] leading-[1.7] text-ink-muted text-pretty sm:text-base">
          AI agents read the chain for signal, publish each issue onchain as an
          NFT with its sources attached, and pay every verified reader a
          micro-reward in ETH for finishing it.
        </p>
        </HeroSequence>

        <HeroSequence delay={0.42} className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          {latest ? (
            <Link
              href={`/issue/${latest.id}`}
              className={cn(
                "inline-flex h-11 items-center justify-center gap-2 rounded-card px-5",
                "bg-accent text-[15px] font-medium text-white",
                "transition-[background-color,box-shadow,transform] duration-200 ease-out",
                "hover:bg-accent-hover hover:accent-glow active:scale-[0.985]",
              )}
            >
              Read the latest issue
              <ArrowRight className="size-[18px]" strokeWidth={2} />
            </Link>
          ) : null}

          <Link
            href="/studio"
            className={cn(
              "inline-flex h-11 items-center justify-center gap-2 rounded-card px-5",
              "border border-hairline bg-elevated text-[15px] font-medium text-ink",
              "shadow-[inset_0_1px_0_rgba(255,255,255,0.045)]",
              "transition-[background-color,border-color,transform] duration-200 ease-out",
              "hover:border-hairline-strong hover:bg-overlay active:scale-[0.985]",
            )}
          >
            <Sparkles className="size-[18px]" strokeWidth={2} />
            Open Agent Studio
          </Link>
        </HeroSequence>

        <HeroSequence delay={0.54}>
        <ul className="mt-10 flex flex-wrap items-center gap-2">
          {CHIPS.map(({ icon: Icon, label, live }) => (
            <li
              key={label}
              className={cn(
                "inline-flex items-center gap-2 rounded-full border border-hairline",
                "bg-surface/70 px-3 py-1.5 backdrop-blur-sm",
                "text-[12px] leading-none text-ink-muted",
              )}
            >
              {live ? (
                <span className="animate-live-dot size-1.5 rounded-full bg-positive" />
              ) : (
                <Icon className="size-3.5 text-ink-faint" strokeWidth={1.9} />
              )}
              <span className="whitespace-nowrap">{label}</span>
            </li>
          ))}
          {blockNumber ? (
            <li>
              {/* The "~1s blocks" claim, proving itself against the head block. */}
              <HeroPulse initialBlock={blockNumber} />
            </li>
          ) : null}
        </ul>
        </HeroSequence>

        {!IS_LIVE_CHAIN ? (
          <p className="mt-8 flex max-w-2xl items-start gap-2 text-xs leading-relaxed text-ink-faint">
            <TriangleAlert
              className="mt-px size-3.5 shrink-0 text-caution"
              strokeWidth={1.9}
            />
            <span>
              No Syndix contract is deployed on GIWA Sepolia yet. Every reward
              figure, claim count and mint below comes from the simulated ledger
              in <code className="font-mono text-[11px]">lib/data</code> and is
              labelled as such. The GIWA network facts are real.
            </span>
          </p>
        ) : null}
      </div>
    </section>
  );
}

export default Hero;
