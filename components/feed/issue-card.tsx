"use client";

import type { ReactElement } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  CircleDashed,
  Clock,
  Gauge,
  Radar,
  ShieldCheck,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { Issue, IssueStatus } from "@/lib/types";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CoverArt } from "@/components/ui/cover-art";
import { trackMeta } from "@/lib/data/protocol";
import {
  cn,
  compact,
  formatInt,
  formatKrw,
  formatUsd,
  relativeTime,
} from "@/lib/utils";
import { useSpotlight } from "@/lib/use-spotlight";

export interface IssueCardProps {
  issue: Issue;
  /** Epoch ms. 0 means "not resolved yet" - see FeedGrid; renders a neutral stamp. */
  now: number;
  featured?: boolean;
}

interface StatusMeta {
  label: string;
  tone: BadgeTone;
  icon?: LucideIcon;
  dot?: boolean;
}

/**
 * `published` is deliberately labelled as simulated: the dataset carries
 * well-formed mint hashes but no Syndix contract is deployed, so an unqualified
 * "Minted" chip would be a claim the chain cannot back.
 */
const STATUS: Record<IssueStatus, StatusMeta> = {
  published: { label: "Minted · sim", tone: "positive", icon: ShieldCheck },
  minting: { label: "Minting", tone: "caution", dot: true },
  scanning: { label: "Scanning", tone: "cyan", icon: Radar },
  draft: { label: "Draft", tone: "neutral", icon: CircleDashed },
};

/** Standfirsts are markdown; strip inline markers rather than print them raw. */
function plain(text: string): string {
  return text.replace(/[`*_]/g, "");
}

/** How many readers the funded pool can still pay at the current unit reward. */
function poolCapacity(issue: Issue): number {
  const perReader = BigInt(issue.rewardPerReaderWei);
  if (perReader <= BigInt(0)) return 0;
  return Number(BigInt(issue.rewardPoolWei) / perReader);
}

export function IssueCard({
  issue,
  now,
  featured = false,
}: IssueCardProps): ReactElement {
  const {
    ref: spotRef,
    onPointerMove,
    onPointerLeave,
  } = useSpotlight<HTMLAnchorElement>();
  const track = trackMeta(issue.track);
  const status = STATUS[issue.status];
  const published = issue.status === "published";

  const capacity = poolCapacity(issue);
  const claimed = Math.min(issue.claimedCount, capacity);
  const exhausted = capacity > 0 && issue.claimedCount >= capacity;
  const pct = capacity > 0 ? Math.round((claimed / capacity) * 100) : 0;

  const stamp = now === 0 ? "-" : relativeTime(issue.publishedAt, now);

  return (
    <Link
      href={`/issue/${issue.id}`}
      aria-label={`Issue ${issue.id}: ${issue.title}`}
      ref={spotRef}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={cn(
        "panel panel-interactive spotlight hover:panel-interactive-hover",
        "group relative isolate flex w-full overflow-hidden",
        "transition-[border-color,box-shadow] duration-200 ease-out",
        "hover:border-hairline-strong",
        featured
          ? "flex-col md:grid md:grid-cols-[minmax(0,1.08fr)_minmax(0,1fr)]"
          : "flex-col",
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden bg-void",
          featured
            ? "aspect-[16/9] border-b border-hairline md:aspect-auto md:min-h-[320px] md:border-r md:border-b-0"
            : "aspect-[16/9] border-b border-hairline",
        )}
      >
        <CoverArt
          seed={issue.coverSeed}
          title={issue.coverPrompt}
          track={issue.track}
          className="transition-transform duration-[600ms] ease-out group-hover:scale-[1.05]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void/70 via-transparent to-void/25"
        />
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2">
          <Badge tone={track.tone}>{track.label}</Badge>
          <Badge tone={status.tone} icon={status.icon} dot={status.dot}>
            {status.label}
          </Badge>
        </div>
        {featured ? (
          <div className="absolute bottom-3 left-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-void/70 px-2.5 py-1 text-[10.5px] tracking-[0.14em] text-ink-muted uppercase backdrop-blur-sm">
              <span className="animate-live-dot size-1.5 rounded-full bg-accent" />
              Latest issue
            </span>
          </div>
        ) : null}
      </div>

      <div className={cn("flex min-w-0 flex-1 flex-col", featured ? "p-6 sm:p-7" : "p-5")}>
        <div className="flex items-center gap-2 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
          <time dateTime={issue.publishedAt} className="tabular-nums">
            {stamp}
          </time>
          <span aria-hidden className="size-[3px] rounded-full bg-ink-faint/70" />
          <span className="font-mono tracking-[0.08em]">
            #{issue.id.toString().padStart(3, "0")}
          </span>
          <ArrowUpRight
            className="ml-auto size-4 shrink-0 text-ink-faint opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            strokeWidth={2}
          />
        </div>

        <h3
          className={cn(
            "mt-3 line-clamp-2 font-semibold tracking-[-0.025em] text-ink text-balance",
            featured
              ? "text-[24px] leading-[1.15] lg:text-[28px]"
              : "text-[17px] leading-[1.28]",
          )}
        >
          {issue.title}
        </h3>

        <p
          className={cn(
            "mt-2.5 text-ink-muted text-pretty",
            featured
              ? "line-clamp-3 text-[14.5px] leading-[1.65]"
              : "line-clamp-2 text-[13.5px] leading-[1.6]",
          )}
        >
          {plain(issue.standfirst)}
        </p>

        <div className="mt-5 flex-1" />

        {published ? (
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={cn(
                  "text-[11px] tracking-[0.14em] uppercase",
                  exhausted ? "text-caution" : "text-ink-faint",
                )}
              >
                {exhausted ? "Pool exhausted" : "Reward pool claimed"}
              </span>
              <span className="font-mono text-[11px] tracking-[0.04em] text-ink-muted tabular-nums">
                {formatInt(claimed)}
                <span className="text-ink-faint">/{formatInt(capacity)}</span>
              </span>
            </div>
            <div className="mt-2 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn(
                  "h-full rounded-full",
                  exhausted ? "bg-caution" : "bg-accent",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 rounded-[10px] border border-dashed border-hairline-strong px-3 py-2">
            <CircleDashed className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
            <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Not yet minted · claims closed
            </span>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-hairline pt-4">
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <Clock className="size-3.5 text-ink-faint" strokeWidth={1.9} />
            <span className="tabular-nums">{issue.readingMinutes} min</span>
          </span>
          <span className="inline-flex items-center gap-1.5 text-[12px] text-ink-muted">
            <UsersRound className="size-3.5 text-ink-faint" strokeWidth={1.9} />
            <span className="tabular-nums">{compact(issue.readerCount)}</span>
          </span>
          <Badge tone="accent" icon={Gauge}>
            {issue.score.index} AI index
          </Badge>

          <span className="ml-auto flex items-baseline gap-1.5 whitespace-nowrap">
            <span className="text-[10px] tracking-[0.14em] text-ink-faint uppercase">
              per reader
            </span>
            <span className="font-mono text-[13px] font-medium text-ink tabular-nums">
              {formatKrw(issue.rewardPerReaderWei)}
            </span>
            <span className="font-mono text-[11px] text-ink-faint tabular-nums">
              {formatUsd(issue.rewardPerReaderWei)}
            </span>
          </span>
        </div>
      </div>
    </Link>
  );
}

export default IssueCard;
