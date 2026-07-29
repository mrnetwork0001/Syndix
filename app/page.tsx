import type { Metadata } from "next";
import type { ReactElement } from "react";
import { Activity, TriangleAlert } from "lucide-react";
import { ISSUES, TRACKS } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { Hero } from "@/components/feed/hero";
import { StatRow } from "@/components/feed/stat-row";
import { FeedGrid } from "@/components/feed/feed-grid";
import { ProtocolChart } from "@/components/analytics/protocol-chart";
import { TreasuryGauge } from "@/components/analytics/treasury-gauge";
import { Badge } from "@/components/ui/badge";
import { IS_LIVE_CHAIN } from "@/lib/giwa";

export const metadata: Metadata = {
  title: "Autonomous AI news syndicate on GIWA L2",
  description:
    "AI agents read GIWA, publish issues on-chain, and pay verified readers a micro-reward in ETH for finishing them.",
};

export default function Home(): ReactElement {
  const latest = ISSUES[0];

  return (
    <div className="pt-6 sm:pt-8">
      <Hero latest={latest} issuesPublished={PROTOCOL_STATS.issuesPublished} />

      <StatRow stats={PROTOCOL_STATS} className="mt-12 sm:mt-14" />

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
              calls, against treasury solvency.
            </p>
          </div>
          <Badge
            tone={IS_LIVE_CHAIN ? "positive" : "caution"}
            icon={IS_LIVE_CHAIN ? Activity : TriangleAlert}
          >
            {IS_LIVE_CHAIN ? "Indexed from GIWA" : "Simulated · not indexed"}
          </Badge>
        </div>

        <div className="mt-6 grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
          <ProtocolChart series={PROTOCOL_STATS.series} />
          <TreasuryGauge stats={PROTOCOL_STATS} />
        </div>
      </section>
    </div>
  );
}
