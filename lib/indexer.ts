import { createPublicClient, http, parseAbiItem } from "viem";
import { GIWA_RPC_HTTP, IS_LIVE_CHAIN, SYNDIX_CONTRACTS, giwaSepolia } from "./giwa";
import type { DailyPoint } from "./types";

/**
 * A real indexer, in the smallest form that tells the truth.
 *
 * The analytics chart used to plot an authored 14-day series because nothing
 * reconstructed history from chain state. This reads the treasury's own event
 * log and buckets it by UTC day, so the chart plots what actually happened.
 *
 * Deliberately not a full indexing service: there is no database and no
 * backfill worker. It queries a bounded recent window on each request and is
 * honest about that bound. If Syndix ever needs months of history, this becomes
 * a job writing into Postgres — but shipping a fake series in the meantime was
 * the wrong trade.
 */

const REWARD_CLAIMED = parseAbiItem(
  "event RewardClaimed(uint256 indexed articleId, address indexed reader, string identity, uint256 amount)",
);
const ARTICLE_PUBLISHED = parseAbiItem(
  "event ArticlePublished(uint256 indexed id, string title, string contentURI, uint256 rewardPool, uint256 rewardPerReader)",
);

/** GIWA produces ~1 block/s, so a day is ~86,400 blocks. */
const BLOCKS_PER_DAY = 86_400n;

/**
 * How many days of history to reconstruct. Kept modest because each day is a
 * large block range and the public RPC caps `eth_getLogs` spans.
 */
export const INDEX_WINDOW_DAYS = 14;

/** Chunk size for getLogs. The public RPC rejects very wide ranges. */
const LOG_CHUNK = 45_000n;

/**
 * Block SyndixTreasury was deployed at. Scanning below this is pure waste —
 * there are no events to find — and without the floor a 14-day window on a
 * 1-second chain is ~1.2M blocks, which took the homepage over a minute to
 * render on a cold cache.
 */
const TREASURY_DEPLOY_BLOCK = 31_963_000n;

export interface IndexedSeries {
  ok: true;
  points: DailyPoint[];
  /** Blocks actually scanned, so the UI can state the window it covers. */
  fromBlock: bigint;
  toBlock: bigint;
  claimsTotal: number;
  publishedTotal: number;
}

export interface IndexerFailure {
  ok: false;
  reason: string;
}

export type IndexResult = IndexedSeries | IndexerFailure;

function utcDay(timestampSeconds: number): string {
  return new Date(timestampSeconds * 1000).toISOString().slice(0, 10);
}

/**
 * Reconstructing the window costs ~50 RPC calls, which is far too much to do on
 * every page render. Cached per server instance; the underlying data changes on
 * the order of claims per hour, so five minutes of staleness is invisible.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: { at: number; result: IndexResult } | null = null;

export async function indexProtocolSeries(): Promise<IndexResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;
  const result = await computeProtocolSeries();
  // Only cache success: a transient RPC failure should be retried, not pinned
  // for five minutes.
  if (result.ok) cached = { at: Date.now(), result };
  return result;
}

async function computeProtocolSeries(): Promise<IndexResult> {
  if (!IS_LIVE_CHAIN) {
    return { ok: false, reason: "No treasury address configured." };
  }

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { timeout: 15_000, retryCount: 1 }),
    });

    const head = await client.getBlockNumber();
    const span = BLOCKS_PER_DAY * BigInt(INDEX_WINDOW_DAYS);
    const windowStart = head > span ? head - span : 0n;
    const fromBlock =
      windowStart > TREASURY_DEPLOY_BLOCK ? windowStart : TREASURY_DEPLOY_BLOCK;

    const ranges: { start: bigint; end: bigint }[] = [];
    for (let start = fromBlock; start <= head; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
      ranges.push({ start, end });
    }

    // Chunks are independent, so fan them out rather than walking them.
    const perRange = await Promise.all(
      ranges.map(async ({ start, end }) => {
        const [claimLogs, publishLogs] = await Promise.all([
          client.getLogs({
            address: SYNDIX_CONTRACTS.treasury,
            event: REWARD_CLAIMED,
            fromBlock: start,
            toBlock: end,
          }),
          client.getLogs({
            address: SYNDIX_CONTRACTS.treasury,
            event: ARTICLE_PUBLISHED,
            fromBlock: start,
            toBlock: end,
          }),
        ]);
        return { claimLogs, publishLogs };
      }),
    );

    const claims = perRange.flatMap((r) =>
      r.claimLogs.map((log) => ({
        blockNumber: log.blockNumber,
        amount: log.args.amount ?? 0n,
        reader: log.args.reader ?? "0x",
      })),
    );
    const publishes = perRange.flatMap((r) =>
      r.publishLogs.map((log) => ({ blockNumber: log.blockNumber })),
    );

    // Only fetch timestamps for blocks that actually produced an event.
    const blocks = [
      ...new Set([...claims, ...publishes].map((e) => e.blockNumber)),
    ];
    const fetched = await Promise.all(
      blocks.map(async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber, Number(block.timestamp)] as const;
      }),
    );
    const timestamps = new Map<bigint, number>(fetched);

    // Seed every day in the window so the chart has no gaps.
    const buckets = new Map<string, DailyPoint>();
    const headBlock = await client.getBlock({ blockNumber: head });
    const headSeconds = Number(headBlock.timestamp);
    for (let i = INDEX_WINDOW_DAYS - 1; i >= 0; i--) {
      const date = utcDay(headSeconds - i * 86_400);
      buckets.set(date, {
        date,
        claims: 0,
        distributedWei: "0",
        activeWallets: 0,
        x402Calls: 0,
      });
    }

    const walletsPerDay = new Map<string, Set<string>>();

    for (const claim of claims) {
      const seconds = timestamps.get(claim.blockNumber);
      if (seconds === undefined) continue;
      const date = utcDay(seconds);
      const bucket = buckets.get(date);
      if (!bucket) continue;
      bucket.claims += 1;
      bucket.distributedWei = (
        BigInt(bucket.distributedWei) + claim.amount
      ).toString();
      const set = walletsPerDay.get(date) ?? new Set<string>();
      set.add(claim.reader.toLowerCase());
      walletsPerDay.set(date, set);
    }

    for (const [date, wallets] of walletsPerDay) {
      const bucket = buckets.get(date);
      if (bucket) bucket.activeWallets = wallets.size;
    }

    return {
      ok: true,
      points: [...buckets.values()],
      fromBlock,
      toBlock: head,
      claimsTotal: claims.length,
      publishedTotal: publishes.length,
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
