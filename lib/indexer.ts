import { createPublicClient, parseAbiItem } from "viem";
import {
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  giwaSepolia,
  giwaServerTransport,
} from "./giwa";
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
 * a job writing into Postgres - but shipping a fake series in the meantime was
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
/**
 * Blocks per eth_getLogs call.
 *
 * The documented ceiling is 100,000, but measured against GIWA's RPC the
 * practical limit is far lower: 10k returns in 1.7s, 20k in 3.6s, 45k in 7.0s,
 * and 90k does not return at all - it 503s with "no backend is currently
 * healthy to serve traffic" after a hundred seconds. Raising this toward the
 * documented ceiling makes the scan fail, not finish faster.
 */
const LOG_CHUNK = 45_000n;

/**
 * Ranges scanned at once. A public RPC rate-limits a wide fan-out, and one
 * rejected chunk fails the entire scan - so trade a little wall-clock for
 * finishing at all.
 */
const MAX_CONCURRENCY = 4;

/**
 * Block SyndixTreasury was deployed at. Scanning below this is pure waste -
 * there are no events to find - and without the floor a 14-day window on a
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

/** A claim or publish, kept with the timestamp so blocks are fetched once ever. */
interface RawEvent {
  /** `txHash:logIndex` - stable across a rescan, so a merge cannot double-count. */
  key: string;
  blockNumber: bigint;
  seconds: number;
  amount: bigint;
  reader: string;
}

/**
 * Events seen so far, so a later scan only has to cover new blocks.
 *
 * A full window is ~800k blocks and eighteen getLogs calls at roughly seven
 * seconds each. Almost all of that is re-reading blocks that have not changed
 * since the last scan, which is pure waste on a chain producing one block a
 * second.
 */
let eventCache: {
  claims: RawEvent[];
  publishes: RawEvent[];
  scannedTo: bigint;
} | null = null;

/**
 * Blocks re-read on every incremental scan.
 *
 * Resuming from exactly where we stopped assumes the tip never changes, which
 * is not true of any chain. Overlapping by a few hundred blocks means a shallow
 * reorg is picked up rather than baked in, and the `key` dedupe makes
 * re-reading free.
 */
const REORG_REWIND = 300n;

/** Clears the incremental state. Exposed for tests and for after a publish. */
export function clearIndexerCache(): void {
  cached = null;
  eventCache = null;
}

/**
 * Shares one in-flight read among concurrent callers.
 *
 * Without this, every overlapping render fired its own full read set. Under
 * RPC congestion those bursts stacked faster than they drained, the per-origin
 * request queue grew without bound, and the process wedged so thoroughly that
 * only measurements from outside it worked. The cache above handles repeat
 * reads over time; this handles repeat reads at the same moment.
 */
let indexProtocolSeriesInFlight: Promise<IndexResult> | null = null;

export function indexProtocolSeries(): Promise<IndexResult> {
  if (indexProtocolSeriesInFlight) return indexProtocolSeriesInFlight;
  const run = indexProtocolSeriesUncached().finally(() => {
    indexProtocolSeriesInFlight = null;
  });
  indexProtocolSeriesInFlight = run;
  return run;
}

async function indexProtocolSeriesUncached(): Promise<IndexResult> {
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
      transport: giwaServerTransport({ timeout: 25_000 }),
    });

    const head = await client.getBlockNumber();
    const span = BLOCKS_PER_DAY * BigInt(INDEX_WINDOW_DAYS);
    const windowStart = head > span ? head - span : 0n;
    const fromBlock =
      windowStart > TREASURY_DEPLOY_BLOCK ? windowStart : TREASURY_DEPLOY_BLOCK;

    /**
     * Resume from the last scan when we safely can, otherwise scan the window.
     *
     * "Safely" means the cached state still covers the bottom of the current
     * window - if the window has slid past what we hold, the missing blocks
     * were never read and resuming would silently under-report. Falling back to
     * a full scan is always correct, just slower, so every uncertain case takes
     * it.
     */
    const resumable =
      eventCache !== null &&
      eventCache.scannedTo >= fromBlock &&
      eventCache.scannedTo <= head;

    const scanFrom = resumable
      ? (eventCache!.scannedTo - REORG_REWIND > fromBlock
          ? eventCache!.scannedTo - REORG_REWIND
          : fromBlock)
      : fromBlock;

    const carriedClaims = resumable ? eventCache!.claims : [];
    const carriedPublishes = resumable ? eventCache!.publishes : [];

    const ranges: { start: bigint; end: bigint }[] = [];
    for (let start = scanFrom; start <= head; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
      ranges.push({ start, end });
    }

    /**
     * Chunks are independent, but a full fan-out is what broke this: 36
     * simultaneous getLogs against a public RPC gets throttled, and one
     * rejection takes the scan with it. Walk them a few at a time instead.
     *
     * Deliberately still all-or-nothing. A partially scanned window would
     * render missing days as days with no claims, which is a wrong number
     * rather than a missing one - the caller is better served by an honest
     * failure it can label.
     */
    const scanRange = async ({ start, end }: { start: bigint; end: bigint }) => {
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
    };

    const perRange: Awaited<ReturnType<typeof scanRange>>[] = [];
    for (let i = 0; i < ranges.length; i += MAX_CONCURRENCY) {
      const batch = ranges.slice(i, i + MAX_CONCURRENCY);
      const settled = await Promise.all(batch.map(scanRange));
      perRange.push(...settled);
    }

    const scannedClaims = perRange.flatMap((r) =>
      r.claimLogs.map((log) => ({
        key: `${log.transactionHash}:${log.logIndex}`,
        blockNumber: log.blockNumber,
        amount: log.args.amount ?? 0n,
        reader: log.args.reader ?? "0x",
      })),
    );
    const scannedPublishes = perRange.flatMap((r) =>
      r.publishLogs.map((log) => ({
        key: `${log.transactionHash}:${log.logIndex}`,
        blockNumber: log.blockNumber,
        amount: 0n,
        // Publishes carry no reader; the field exists only so both event kinds
        // share one shape and one merge path.
        reader: "0x" as string,
      })),
    );

    // Only fetch timestamps for blocks that actually produced an event.
    const blocks = [
      ...new Set(
        [...scannedClaims, ...scannedPublishes].map((e) => e.blockNumber),
      ),
    ];
    const fetched = await Promise.all(
      blocks.map(async (blockNumber) => {
        const block = await client.getBlock({ blockNumber });
        return [blockNumber, Number(block.timestamp)] as const;
      }),
    );
    const timestamps = new Map<bigint, number>(fetched);

    // Stamp each event so a later scan never re-reads these blocks.
    const stamp = (e: {
      key: string;
      blockNumber: bigint;
      amount: bigint;
      reader: string;
    }): RawEvent => ({
      ...e,
      seconds: timestamps.get(e.blockNumber) ?? 0,
    });

    // Merge with anything already known, dedupe by log identity so the reorg
    // overlap cannot double-count, and drop what has fallen out of the window.
    const merge = (prior: RawEvent[], fresh: RawEvent[]): RawEvent[] => {
      const byKey = new Map<string, RawEvent>();
      for (const e of prior) if (e.blockNumber >= fromBlock) byKey.set(e.key, e);
      for (const e of fresh) byKey.set(e.key, e);
      return [...byKey.values()];
    };

    const claims = merge(carriedClaims, scannedClaims.map(stamp));
    const publishes = merge(carriedPublishes, scannedPublishes.map(stamp));
    eventCache = { claims, publishes, scannedTo: head };

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
      if (!claim.seconds) continue;
      const date = utcDay(claim.seconds);
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
