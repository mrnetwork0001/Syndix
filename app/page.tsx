import type { Metadata } from "next";
import type { ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { TRACKS } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { readOnchainIssues } from "@/lib/onchain-issues";
import { readPublishIndex } from "@/lib/publish-tx";
import { toRenderableIssues } from "@/lib/issue-adapter";
import { INDEX_WINDOW_DAYS, indexProtocolSeries } from "@/lib/indexer";
import { MIN_DWELL_SECONDS } from "@/lib/attest";
import { Hero } from "@/components/feed/hero";
import { HowItWorks } from "@/components/feed/how-it-works";
import { StatRow } from "@/components/feed/stat-row";
import { FeedGrid } from "@/components/feed/feed-grid";
import { ProtocolChart } from "@/components/analytics/protocol-chart";
import { TreasuryGauge } from "@/components/analytics/treasury-gauge";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { Reveal } from "@/components/ui/reveal";

export const metadata: Metadata = {
  title: "Autonomous AI news syndicate on GIWA L2",
  description:
    "AI agents read GIWA, publish issues onchain, and pay verified readers a micro-reward in ETH for finishing them.",
};

// Chain state is read per request; 30s keeps the feed cheap without
// letting the treasury figures go stale.
export const revalidate = 30;
/** Chain reads plus IPFS fetches on a cold instance need more than the default. */
export const maxDuration = 60;

export default async function Home(): Promise<ReactElement> {
  const [chain, indexed, onchain, publishIndex] = await Promise.all([
    readProtocolChainStats(),
    indexProtocolSeries(),
    readOnchainIssues(),
    readPublishIndex(),
  ]);

  // Issues come from the treasury, not from a file in the repo. Closed articles
  // are retired, so only active ones are listed.
  const issues = onchain.ok
    ? toRenderableIssues(onchain.issues.filter((i) => i.isActive), publishIndex)
    : [];
  const live = chain.live ? chain : null;

  // Every reward still funded across active articles. Stated on the page so a
  // visitor can see the offer is real before spending twenty seconds on it.
  const active = onchain.ok ? onchain.issues.filter((i) => i.isActive) : [];
  const claimsRemaining = active.reduce((total, issue) => {
    const perReader = BigInt(issue.rewardPerReaderWei);
    if (perReader === 0n) return total;
    const unspent = BigInt(issue.rewardPoolWei) - BigInt(issue.totalClaimedWei);
    return total + Number(unspent / perReader);
  }, 0);

  // The gauge visualises the reserved/surplus split, so it must reflect the
  // contract when we can reach it - otherwise it contradicts the tiles above.
  const treasuryStats = live
    ? {
        ...PROTOCOL_STATS,
        totalProtocolVolumeWei: live.totalProtocolVolumeWei.toString(),
        totalRewardDistributedWei: live.totalRewardDistributedWei.toString(),
        treasuryBalanceWei: live.treasuryBalanceWei.toString(),
        reservedRewardsWei: live.reservedRewardsWei.toString(),
        uniqueReaders: live.uniqueReaders,
        issuesPublished: live.articleCount,
      }
    : PROTOCOL_STATS;
  const latest = issues[0] ?? null;

  return (
    <div className="pt-6 sm:pt-8">
      <Hero
        latest={latest}
        issuesLive={issues.length}
        issuesPublished={live ? live.articleCount : PROTOCOL_STATS.issuesPublished}
        blockNumber={live?.blockNumber.toString()}
      />

      <Reveal className="mt-12 sm:mt-14">
        <StatRow stats={PROTOCOL_STATS} live={live} />
      </Reveal>

      <Reveal className="mt-16">
        <HowItWorks
          rewardPerReaderWei={active[0]?.rewardPerReaderWei}
          minDwellSeconds={MIN_DWELL_SECONDS}
          claimsRemaining={claimsRemaining}
        />
      </Reveal>

      {issues.length > 0 ? (
        <FeedGrid issues={issues} tracks={TRACKS} className="mt-16" />
      ) : (
        <Panel className="mt-16 p-8 text-center">
          <p className="text-[15px] font-medium text-ink">
            No published issues available right now
          </p>
          <p className="mx-auto mt-2 max-w-md text-[13.5px] leading-relaxed text-ink-muted">
            {onchain.ok
              ? "The treasury has no active articles whose content resolves. Generate and publish one from the Agent Studio."
              : `The issue index could not be read from GIWA Sepolia: ${onchain.reason}`}
          </p>
        </Panel>
      )}

      <Reveal as="section" className="mt-16">
        <section aria-labelledby="analytics-heading">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
          <div>
            <h2
              id="analytics-heading"
              className="text-[11px] tracking-[0.14em] text-ink-faint uppercase"
            >
              Protocol analytics
            </h2>
            <p className="mt-1.5 text-sm text-ink-muted">
              {indexed.ok
                ? `Reward claims and distinct claiming wallets per UTC day, reconstructed from RewardClaimed events over the last ${INDEX_WINDOW_DAYS} days (blocks ${indexed.fromBlock}–${indexed.toBlock}). The treasury split beside it is read from the contract.`
                : "Reward claims per day, reconstructed from RewardClaimed events. The chain event log could not be read this request, so there is no series to show; the treasury split beside it is still read from the contract."}
            </p>
          </div>
          {indexed.ok ? (
            <Badge tone="positive" dot>
              Indexed from chain events
            </Badge>
          ) : (
            <Badge tone="caution" icon={TriangleAlert}>
              Chart unavailable · event log unreadable
            </Badge>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          {/*
            No fallback series.
            
            This used to render PROTOCOL_STATS.series when indexing failed - an
            authored dataset showing roughly a thousand claims a day against a
            real total of fifty-two. It carried a badge, but a reader takes the
            shape of a chart in before they read the label above it, and the
            shape was a fabrication. An empty panel says less and claims
            nothing.
          */}
          {indexed.ok ? (
            <ProtocolChart series={indexed.points} indexed />
          ) : (
            <div className="panel flex min-h-[300px] flex-col items-center justify-center gap-2 px-6 text-center">
              <TriangleAlert className="size-5 text-ink-faint" aria-hidden />
              <p className="text-sm text-ink-muted">
                The claim history could not be read from GIWA this request.
              </p>
              <p className="max-w-sm text-[13px] text-ink-faint">
                Nothing is shown rather than an estimate. The treasury figures
                beside this are read straight from the contract and are
                unaffected.
              </p>
              {indexed.reason ? (
                <p className="mt-1 max-w-md font-mono text-[11px] break-words text-ink-faint/70">
                  {indexed.reason.split("\n")[0]}
                </p>
              ) : null}
            </div>
          )}
          <TreasuryGauge stats={treasuryStats} />
        </div>
        </section>
      </Reveal>
    </div>
  );
}
