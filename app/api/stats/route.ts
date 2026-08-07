import { NextResponse } from "next/server";
import { GIWA_SEPOLIA_ID, SYNDIX_CONTRACTS } from "@/lib/giwa";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { INDEX_WINDOW_DAYS, indexProtocolSeries } from "@/lib/indexer";

export const dynamic = "force-dynamic";

/**
 * Protocol stats, read from chain.
 *
 * This route used to decide `source` from whether a treasury ADDRESS was
 * configured, then return the authored dataset regardless. Once the treasury
 * was deployed it therefore reported `source: "onchain"` while serving 3,284
 * readers and six issues against a chain holding four and ten - a fabricated
 * 14-day series included. Badging invented numbers as live is the exact failure
 * the honesty rule exists to prevent, and it was doing it on a public endpoint.
 *
 * It now reads the treasury. `source` describes what the caller is actually
 * holding, and when the chain cannot be reached the numbers are omitted rather
 * than substituted - a consumer gets nothing and a reason, never a plausible
 * fiction.
 */
export async function GET() {
  const [chain, indexed] = await Promise.all([
    readProtocolChainStats(),
    indexProtocolSeries(),
  ]);

  const body = {
    network: { name: "GIWA Sepolia", chainId: GIWA_SEPOLIA_ID },
    contracts: SYNDIX_CONTRACTS,
  };

  if (!chain.live) {
    return NextResponse.json(
      {
        ...body,
        source: "unavailable",
        reason: chain.reason,
        stats: null,
        series: null,
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  return NextResponse.json(
    {
      ...body,
      source: "onchain",
      readAtBlock: chain.blockNumber.toString(),
      stats: {
        articlesPublished: chain.articleCount,
        uniqueReaders: chain.uniqueReaders,
        totalProtocolVolumeWei: chain.totalProtocolVolumeWei.toString(),
        totalRewardDistributedWei: chain.totalRewardDistributedWei.toString(),
        treasuryBalanceWei: chain.treasuryBalanceWei.toString(),
        reservedRewardsWei: chain.reservedRewardsWei.toString(),
        unreservedBalanceWei: chain.unreservedBalanceWei.toString(),
        gasPriceWei: chain.gasPriceWei.toString(),
        solvent: chain.solvent,
      },
      // Reconstructed from RewardClaimed / ArticlePublished logs. Null rather
      // than an authored stand-in when the log scan fails.
      series: indexed.ok
        ? {
            source: "event-logs",
            windowDays: INDEX_WINDOW_DAYS,
            // bigint is not JSON-serialisable; JSON.stringify throws rather
            // than coercing, so every chain-derived number is stringified at
            // this boundary.
            fromBlock: indexed.fromBlock.toString(),
            toBlock: indexed.toBlock.toString(),
            points: indexed.points,
          }
        : null,
      // Say why, rather than leaving a consumer to guess whether null means
      // "no activity" or "we could not look".
      seriesUnavailableReason: indexed.ok ? undefined : indexed.reason,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
