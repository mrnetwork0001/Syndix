import type { Metadata } from "next";
import type { ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { TRACKS } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { readOnchainIssues } from "@/lib/onchain-issues";
import { toRenderableIssues } from "@/lib/issue-adapter";
import { INDEX_WINDOW_DAYS, indexProtocolSeries } from "@/lib/indexer";
import { Hero } from "@/components/feed/hero";
import { StatRow } from "@/components/feed/stat-row";
import { FeedGrid } from "@/components/feed/feed-grid";
import { ProtocolChart } from "@/components/analytics/protocol-chart";
import { TreasuryGauge } from "@/components/analytics/treasury-gauge";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";

export const metadata: Metadata = {
  title: "Autonomous AI news syndicate on GIWA L2",
  description:
    "AI agents read GIWA, publish issues on-chain, and pay verified readers a micro-reward in ETH for finishing them.",
};

// Chain state is read per request; 30s keeps the feed cheap without
// letting the treasury figures go stale.
export const revalidate = 30;

export default async function Home(): Promise<ReactElement> {
  const [chain, indexed, onchain] = await Promise.all([
    readProtocolChainStats(),
    indexProtocolSeries(),
    readOnchainIssues(),
  ]);

  // Issues come from the treasury, not from a file in the repo. Closed articles
  // are retired, so only active ones are listed.
  const issues = onchain.ok
    ? toRenderableIssues(onchain.issues.filter((i) => i.isActive))
    : [];
  const live = chain.live ? chain : null;

  // The gauge visualises the reserved/surplus split, so it must reflect the
  // contract when we can reach it — otherwise it contradicts the tiles above.
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
      <Hero latest={latest} issuesPublished={live ? live.articleCount : PROTOCOL_STATS.issuesPublished} />

      <StatRow stats={PROTOCOL_STATS} live={live} className="mt-12 sm:mt-14" />

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

      <section className="mt-16" aria-labelledby="analytics-heading">
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
                : "Reward claims per day. The chain event log could not be read this request, so the chart falls back to an authored projection; the treasury split beside it is still read from the contract."}
            </p>
          </div>
          {indexed.ok ? (
            <Badge tone="positive" dot>
              Indexed from chain events
            </Badge>
          ) : (
            <Badge tone="caution" icon={TriangleAlert}>
              Series is illustrative · not indexed
            </Badge>
          )}
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <ProtocolChart series={indexed.ok ? indexed.points : PROTOCOL_STATS.series} />
          <TreasuryGauge stats={treasuryStats} />
        </div>
      </section>
    </div>
  );
}
