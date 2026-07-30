import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  Blocks,
  Bot,
  Clock,
  Cpu,
  FileCode2,
  Hash,
} from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { CoverArt } from "@/components/ui/cover-art";
import { Mono } from "@/components/ui/mono";
import { InlineText } from "@/components/reader/exec-summary";
import { trackMeta } from "@/lib/data/protocol";
import { explorerBlock, explorerTx } from "@/lib/giwa";
import type { Issue, IssueStatus } from "@/lib/types";
import { formatDate, formatInt, shortHash } from "@/lib/utils";

const STATUS: Record<IssueStatus, { tone: BadgeTone; label: string; dot: boolean }> = {
  published: { tone: "positive", label: "Published", dot: false },
  minting: { tone: "caution", label: "Minting", dot: true },
  draft: { tone: "neutral", label: "Draft", dot: false },
  scanning: { tone: "cyan", label: "Scanning", dot: true },
};

function Fact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="shrink-0 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1">{children}</span>
    </div>
  );
}

export function IssueHeader({ issue }: { issue: Issue }): ReactElement {
  const track = trackMeta(issue.track);
  const status = STATUS[issue.status];
  const minted = Boolean(issue.mintTxHash);

  return (
    <header>
      <div className="relative isolate">
        {/* `grain` is deliberately not applied here: it forces position:relative
            from un-layered CSS, and CoverArt already carries its own noise. */}
        <div className="absolute inset-0 -z-10 overflow-hidden">
          <CoverArt seed={issue.coverSeed} title={issue.title} track={issue.track} />
          <div className="absolute inset-0 bg-gradient-to-t from-void via-void/80 to-void/20" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-void to-transparent" />
        </div>

        <div className="mx-auto flex min-h-[460px] w-full max-w-7xl flex-col justify-end px-5 pt-8 pb-10 sm:px-8">
          <Link
            href="/"
            className="inline-flex w-fit items-center gap-1.5 rounded-md text-[12.5px] text-ink-faint transition-colors duration-150 ease-out hover:text-ink"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} />
            All issues
          </Link>

          <div className="mt-auto pt-14">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={track.tone}>{track.label}</Badge>
              <Badge tone={status.tone} dot={status.dot}>
                {status.label}
              </Badge>
              <Badge tone="neutral">Issue #{issue.id}</Badge>
            </div>

            <h1 className="text-gradient mt-5 max-w-4xl text-[30px] leading-[1.08] font-semibold tracking-[-0.03em] text-balance sm:text-[38px] lg:text-[46px]">
              {issue.title}
            </h1>

            <p className="mt-4 max-w-2xl text-[15px] leading-[1.6] text-ink-muted text-pretty sm:text-base">
              <InlineText text={issue.standfirst} />
            </p>

            <div className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2.5 text-[12.5px] text-ink-muted">
              <span className="flex items-center gap-2">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-elevated">
                  <Bot className="size-3.5 text-accent" strokeWidth={1.9} />
                </span>
                {issue.generation.provenance === "agent" ? (
                  <>
                    Written by{" "}
                    <span className="font-medium text-ink">Syndix Agent</span>
                  </>
                ) : (
                  <>
                    Written for the{" "}
                    <span className="font-medium text-ink">editorial seed</span>
                  </>
                )}
              </span>

              {issue.generation.provenance === "agent" ? (
                <span className="flex items-center gap-1.5">
                  <Cpu className="size-3.5 text-ink-faint" strokeWidth={1.9} />
                  <Mono className="text-[11.5px]">{issue.generation.model}</Mono>
                </span>
              ) : null}

              <span className="flex items-center gap-1.5">
                <time dateTime={issue.publishedAt}>{formatDate(issue.publishedAt)}</time>
              </span>

              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5 text-ink-faint" strokeWidth={1.9} />
                {issue.readingMinutes} min read
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="border-y border-hairline bg-surface/60">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-x-8 gap-y-2.5 px-5 py-3 sm:px-8">
          <Fact label="Content URI">
            <FileCode2 className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
            <Mono className="truncate text-[11px]">{issue.contentURI}</Mono>
            <CopyButton value={issue.contentURI} className="px-1" />
          </Fact>

          <Fact label="Mint tx">
            {minted && issue.mintTxHash ? (
              <>
                <Hash className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
                <a
                  href={explorerTx(issue.mintTxHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-md transition-colors duration-150 hover:text-ink"
                >
                  <Mono className="text-[11px]">{shortHash(issue.mintTxHash)}</Mono>
                  <ArrowUpRight className="size-3 shrink-0 text-ink-faint" strokeWidth={2} />
                </a>
                <CopyButton value={issue.mintTxHash} className="px-1" />
              </>
            ) : (
              // Published for certain - this issue was read from the treasury
              // index. Only the log lookup for the hash came up empty.
              <span className="text-[12px] text-ink-faint">Link unresolved</span>
            )}
          </Fact>

          {issue.mintBlock ? (
            <Fact label="Block">
              <Blocks className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
              <a
                href={explorerBlock(issue.mintBlock)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 rounded-md transition-colors duration-150 hover:text-ink"
              >
                <Mono className="text-[11px]">#{formatInt(issue.mintBlock)}</Mono>
                <ArrowUpRight className="size-3 shrink-0 text-ink-faint" strokeWidth={2} />
              </a>
            </Fact>
          ) : null}
        </div>
      </div>

      <p className="mx-auto w-full max-w-7xl px-5 pt-2.5 text-[11px] leading-relaxed text-ink-faint sm:px-8">
        The content URI, mint transaction and block above are real: this issue was
        published to SyndixTreasury on GIWA Sepolia and the explorer links resolve.
      </p>
    </header>
  );
}
