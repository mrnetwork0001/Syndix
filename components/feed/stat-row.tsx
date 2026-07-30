import type { ReactElement } from "react";
import { Coins, Fingerprint, Landmark, Wallet } from "lucide-react";
import type { ProtocolStats } from "@/lib/types";
import type { LiveProtocolStats } from "@/lib/chain-stats";
import { StatTile } from "@/components/ui/stat-tile";
import { Badge } from "@/components/ui/badge";
import { LiveBlock } from "@/components/shell/live-block";
import { IS_LIVE_CHAIN } from "@/lib/giwa";
import { compact, formatEth, formatInt, formatKrw, formatUsd } from "@/lib/utils";

export interface StatRowProps {
  stats: ProtocolStats;
  /**
   * Live treasury state. When present these numbers win outright - showing a
   * "Live · GIWA Sepolia" badge above the editorial dataset was the app
   * contradicting its own /protocol page.
   */
  live?: LiveProtocolStats | null;
  className?: string;
}

/** Day-over-day change in active wallets, from the tail of the 14-day series. */
function walletTrend(stats: ProtocolStats): number | undefined {
  const series = stats.series;
  if (series.length < 2) return undefined;
  const previous = series[series.length - 2].activeWallets;
  if (previous === 0) return undefined;
  const latest = series[series.length - 1].activeWallets;
  return ((latest - previous) / previous) * 100;
}

export function StatRow({ stats, live, className }: StatRowProps): ReactElement {
  return (
    <section className={className} aria-labelledby="protocol-stats">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="protocol-stats"
          className="text-[11px] tracking-[0.14em] text-ink-faint uppercase"
        >
          Protocol
        </h2>
        {live ? (
          <Badge tone="positive">
            <LiveBlock initialBlock={live.blockNumber.toString()} />
          </Badge>
        ) : (
          <Badge tone="caution">
            {IS_LIVE_CHAIN
              ? "Chain unreachable · showing dataset"
              : "Simulated ledger"}
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {live ? (
          <>
            <StatTile
              label="Protocol volume"
              value={formatUsd(live.totalProtocolVolumeWei)}
              sublabel={`${formatEth(live.totalProtocolVolumeWei, 4)} into the treasury`}
              icon={Landmark}
              accent
            />
            <StatTile
              label="Rewards to readers"
              value={formatUsd(live.totalRewardDistributedWei)}
              sublabel={`${formatKrw(live.totalRewardDistributedWei)} settled onchain`}
              icon={Coins}
            />
            <StatTile
              label="Verified readers"
              value={formatInt(live.uniqueReaders)}
              sublabel="one up.id per wallet"
              icon={Fingerprint}
            />
            <StatTile
              label="Reserved for readers"
              value={formatEth(live.reservedRewardsWei, 4)}
              sublabel="owner cannot withdraw this"
              icon={Wallet}
            />
          </>
        ) : (
          <>
            <StatTile
              label="Protocol volume"
              value={formatUsd(stats.totalProtocolVolumeWei)}
              sublabel={`${formatEth(stats.totalProtocolVolumeWei, 3)} all-time`}
              icon={Landmark}
              accent
            />
            <StatTile
              label="Rewards to readers"
              value={formatUsd(stats.totalRewardDistributedWei)}
              sublabel={`${formatKrw(stats.totalRewardDistributedWei)} distributed`}
              icon={Coins}
            />
            <StatTile
              label="Verified readers"
              value={compact(stats.uniqueReaders)}
              sublabel="one up.id per wallet"
              icon={Fingerprint}
            />
            <StatTile
              label="Daily active wallets"
              value={formatInt(stats.dailyActiveWallets)}
              sublabel="trailing 24h on GIWA Sepolia"
              icon={Wallet}
              trend={walletTrend(stats)}
            />
          </>
        )}
      </div>
    </section>
  );
}

export default StatRow;
