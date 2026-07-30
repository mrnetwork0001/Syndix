import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { notFound } from "next/navigation";
import { ArrowUpRight, Coins, FileCode2, Handshake, Landmark, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { CopyButton } from "@/components/ui/copy-button";
import { Mono } from "@/components/ui/mono";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { ClaimBar } from "@/components/reader/claim-bar";
import { ExecSummary } from "@/components/reader/exec-summary";
import { IssueHeader } from "@/components/reader/issue-header";
import { MarkdownBody } from "@/components/reader/markdown-body";
import { ScorePanel } from "@/components/reader/score-panel";
import { SignalList } from "@/components/reader/signal-list";
import { ISSUES, getIssue } from "@/lib/data/issues";
import { explorerBlock, explorerTx } from "@/lib/giwa";
import type { Issue } from "@/lib/types";
import { formatEth, formatInt, formatKrw, formatUsd, shortHash } from "@/lib/utils";

interface PageProps {
  params: Promise<{ id: string }>;
}

export async function generateStaticParams(): Promise<{ id: string }[]> {
  return ISSUES.map((issue) => ({ id: String(issue.id) }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { id } = await params;
  const issue = getIssue(id);

  if (!issue) {
    return {
      title: "Issue not found",
      description: "This Syndix issue does not exist.",
    };
  }

  // The root layout owns the "%s · Syndix" title template.
  const description = issue.standfirst.replace(/`/g, "");

  return {
    title: issue.title,
    description,
    openGraph: {
      type: "article",
      title: issue.title,
      description,
      publishedTime: issue.publishedAt,
      authors: ["Syndix Agent"],
    },
    twitter: {
      card: "summary_large_image",
      title: issue.title,
      description,
    },
  };
}

function RecordRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <span className="shrink-0 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      <span className="flex min-w-0 items-center justify-end gap-1">{children}</span>
    </div>
  );
}

/** The rail's on-chain facts: everything the protocol would record for this issue. */
function ProtocolRecord({ issue }: { issue: Issue }): ReactElement {
  const remaining =
    BigInt(issue.rewardPoolWei) -
    BigInt(issue.rewardPerReaderWei) * BigInt(issue.claimedCount);
  const poolLeft = remaining > BigInt(0) ? remaining.toString() : "0";

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="On-chain record"
        description="What SyndixArticleNFT and SyndixTreasury would hold for this issue."
        icon={Landmark}
        action={<Badge tone="caution">Simulated</Badge>}
      />

      <div className="divide-y divide-hairline">
        <RecordRow label="Content URI">
          <FileCode2 className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <Mono className="truncate text-[11px]">{issue.contentURI}</Mono>
          <CopyButton value={issue.contentURI} className="px-1" />
        </RecordRow>

        <RecordRow label="Mint tx">
          {issue.mintTxHash ? (
            <>
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
            <span className="text-[12px] text-caution">Pending mint</span>
          )}
        </RecordRow>

        {issue.mintBlock ? (
          <RecordRow label="Block">
            <a
              href={explorerBlock(issue.mintBlock)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-md transition-colors duration-150 hover:text-ink"
            >
              <Mono className="text-[11px]">#{formatInt(issue.mintBlock)}</Mono>
              <ArrowUpRight className="size-3 shrink-0 text-ink-faint" strokeWidth={2} />
            </a>
          </RecordRow>
        ) : null}

        <RecordRow label="Reward pool">
          <Coins className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <Mono className="text-[11px] text-ink">{formatEth(issue.rewardPoolWei)}</Mono>
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            ({formatUsd(issue.rewardPoolWei)})
          </span>
        </RecordRow>

        <RecordRow label="Per reader">
          <Mono className="text-[11px] text-ink">
            {formatKrw(issue.rewardPerReaderWei)}
          </Mono>
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            ({formatEth(issue.rewardPerReaderWei)})
          </span>
        </RecordRow>

        <RecordRow label="Unreserved">
          <Mono className="text-[11px]">{formatEth(poolLeft)}</Mono>
        </RecordRow>

        <RecordRow label="Readers">
          <Users className="size-3.5 shrink-0 text-ink-faint" strokeWidth={1.9} />
          <span className="font-mono text-[11.5px] tabular-nums text-ink">
            {formatInt(issue.claimedCount)}
          </span>
          <span className="font-mono text-[11.5px] tabular-nums text-ink-faint">
            / {formatInt(issue.readerCount)} claimed
          </span>
        </RecordRow>
      </div>
    </Panel>
  );
}

function SponsorDisclosure({ issue }: { issue: Issue }): ReactElement | null {
  if (!issue.sponsor) return null;
  const { sponsor } = issue;

  return (
    <Panel className="mb-10 overflow-hidden">
      <PanelHeader
        title={`Sponsored by ${sponsor.name}`}
        description={sponsor.blurb}
        icon={Handshake}
        action={<Badge tone="positive">Paid placement</Badge>}
      />
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-3">
        <span className="flex items-center gap-2">
          <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Sponsor
          </span>
          <Mono className="text-[11.5px]">{sponsor.handle}</Mono>
        </span>
        <span className="flex items-center gap-2">
          <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Deposit
          </span>
          <Mono className="text-[11.5px] text-ink">{formatEth(sponsor.depositWei)}</Mono>
          <span className="font-mono text-[11px] tabular-nums text-ink-faint">
            ({formatUsd(sponsor.depositWei)})
          </span>
        </span>
      </div>
    </Panel>
  );
}

export default async function IssuePage({ params }: PageProps): Promise<ReactElement> {
  const { id } = await params;
  const issue = getIssue(id);

  if (!issue) notFound();

  return (
    <div className="flex flex-1 flex-col">
      <IssueHeader issue={issue} />

      <div className="mx-auto w-full max-w-7xl flex-1 px-5 pb-32 sm:px-8">
        <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_368px] xl:gap-14">
          <article id="issue-article" className="min-w-0 py-10">
            <SponsorDisclosure issue={issue} />
            <MarkdownBody markdown={issue.body} />

            <footer className="mt-14 border-t border-hairline pt-6">
              <p className="text-[12px] leading-relaxed text-ink-faint">
                {issue.generation.provenance === "agent" ? (
                  <>
                    Issue #{issue.id} was drafted, scored, illustrated and pinned by
                    the Syndix agent using {issue.generation.model}. Pipeline stages:{" "}
                    <span className="font-mono">
                      {issue.generation.stages.join(" → ")}
                    </span>
                    .
                  </>
                ) : (
                  <>
                    Issue #{issue.id} was written for the Syndix editorial seed — the
                    launch set that existed before the ingestion agent ran — so it
                    carries no model attribution or generation telemetry. Issues
                    produced by the agent report both. Its cover art is generated
                    deterministically from a seed, and it is published on-chain with a
                    funded reward pool like any other issue.
                  </>
                )}
              </p>
            </footer>
          </article>

          <aside className="min-w-0 pb-10 xl:py-10">
            <div className="flex flex-col gap-5 xl:sticky xl:top-6 xl:max-h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:pr-1">
              <ExecSummary issue={issue} />
              <ScorePanel score={issue.score} />
              <SignalList signals={issue.signals} />
              <ProtocolRecord issue={issue} />
            </div>
          </aside>
        </div>
      </div>

      <ClaimBar issue={issue} />
    </div>
  );
}
