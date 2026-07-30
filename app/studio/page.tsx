import type { Metadata } from "next";
import { Bot } from "lucide-react";
import { ISSUES } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { Badge } from "@/components/ui/badge";
import { PipelineControls } from "@/components/studio/pipeline-controls";
import { TreasuryWidget } from "@/components/studio/treasury-widget";
import { X402Panel } from "@/components/studio/x402-panel";

export const metadata: Metadata = {
  title: "Agent Studio · Syndix",
  description:
    "Watch the Syndix ingestion agent scan GIWA Sepolia, draft an issue, illustrate it, and publish - with the treasury and x402 machine-payment surfaces alongside.",
};

export default async function StudioPage() {
  const chain = await readProtocolChainStats();
  const live = chain.live ? chain : null;
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
  return (
    <main className="mx-auto w-full max-w-[1440px] px-5 py-10 sm:px-6 lg:px-8">
      <header className="max-w-2xl">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            <Bot className="size-3.5" strokeWidth={1.9} />
            Newsroom control
          </span>
          <Badge tone="positive" dot>Live on GIWA Sepolia</Badge>
        </div>
        <h1 className="text-gradient mt-3 text-[32px] leading-[1.1] font-semibold tracking-[-0.03em] sm:text-[38px]">
          Agent Studio
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-muted text-pretty">
          Drive the Syndix ingestion agent end to end - scan GIWA Sepolia, draft
          the issue, generate the cover, and publish it onchain.
        </p>
      </header>

      <div className="mt-8 grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_356px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <PipelineControls
          archive={{
            count: ISSUES.length,
            nextIssueId: Math.max(...ISSUES.map((issue) => issue.id)) + 1,
          }}
        />

        <aside className="flex min-w-0 flex-col gap-5">
          <TreasuryWidget stats={treasuryStats} live={Boolean(live)} />
          <X402Panel />
        </aside>
      </div>
    </main>
  );
}
