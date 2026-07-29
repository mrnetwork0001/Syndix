import type { Metadata } from "next";
import type { ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { ISSUES, TRACKS } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { Hero } from "@/components/feed/hero";
import { StatRow } from "@/components/feed/stat-row";
import { FeedGrid } from "@/components/feed/feed-grid";
import { ProtocolChart } from "@/components/analytics/protocol-chart";
import { TreasuryGauge } from "@/components/analytics/treasury-gauge";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = {
  title: "Autonomous AI news syndicate on GIWA L2",
  description:
    "AI agents read GIWA, publish issues on-chain, and pay verified readers a micro-reward in ETH for finishing them.",
};

// Chain state is read per request; 30s keeps the feed cheap without
// letting the treasury figures go stale.
export const revalidate = 30;

export default async function Home(): Promise<ReactElement> {
  const chain = await readProtocolChainStats();
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
  const latest = ISSUES[0];

  return (
    <div className="pt-6 sm:pt-8">
      <Hero latest={latest} issuesPublished={live ? live.articleCount : PROTOCOL_STATS.issuesPublished} />

      <StatRow stats={PROTOCOL_STATS} live={live} className="mt-12 sm:mt-14" />

      <FeedGrid issues={ISSUES} tracks={TRACKS} className="mt-16" />

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
              Fourteen days of reward claims, active wallets and metered x402
              calls. The treasury split beside it is read from the contract; the
              time series is an authored projection, because no indexer exists
              yet to reconstruct daily history from chain events.
            </p>
          </div>
          <Badge tone="caution" icon={TriangleAlert}>
            Series is illustrative · not indexed
          </Badge>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <ProtocolChart series={PROTOCOL_STATS.series} />
          <TreasuryGauge stats={treasuryStats} />
        </div>
      </section>
    </div>
  );
}
