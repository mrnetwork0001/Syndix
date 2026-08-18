import { createPublicClient, parseAbiItem } from "viem";
import {
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  giwaSepolia,
  giwaServerTransport,
} from "./giwa";

/**
 * Resolves the transaction that published each article.
 *
 * `listArticles()` returns the stored struct, which has no transaction hash —
 * a contract cannot record the hash of the transaction currently executing.
 * So an issue read from the treasury index arrives with no `mintTxHash`, and
 * the issue page used to read that absence as "not published" and badge a
 * genuinely on-chain article as pending. Backwards: presence in the index *is*
 * publication.
 *
 * The hash is recoverable from the `ArticlePublished` log, which is what this
 * does. That keeps the honesty rule intact — the link points at the real
 * transaction that published the article, never a fabricated one — while
 * letting the UI state the truth about publication status.
 */

const ARTICLE_PUBLISHED = parseAbiItem(
  "event ArticlePublished(uint256 indexed id, string title, string contentURI, uint256 rewardPool, uint256 rewardPerReader)",
);

/** Matches the indexer: scanning below the deploy block finds nothing. */
const TREASURY_DEPLOY_BLOCK = 31_963_000n;

/** The public RPC rejects very wide `eth_getLogs` spans. */
const LOG_CHUNK = 45_000n;

export interface PublishRecord {
  txHash: `0x${string}`;
  blockNumber: number;
}

export type PublishIndex = Map<number, PublishRecord>;

/**
 * Publish events are immutable once mined, and only a new publish grows the map
 * - a manual, rare action. The comment here used to claim a process-lifetime
 * cache while the constant said five minutes, so an issue page paid a full
 * 800k-block log scan every five minutes for a detail that had not changed.
 * Long TTL, and `clearPublishIndexCache()` for when a publish does land.
 */
let cached: { at: number; index: PublishIndex } | null = null;
const TTL_MS = 60 * 60 * 1000;

/** Called after a publish so the new article's transaction resolves immediately. */
export function clearPublishIndexCache(): void {
  cached = null;
}

/** Ranges scanned at once. A wide fan-out gets throttled and one rejection loses the scan. */
const MAX_CONCURRENCY = 4;

export async function readPublishIndex(): Promise<PublishIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  if (SYNDIX_CONTRACTS.treasury === ZERO_ADDRESS) return new Map();

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: giwaServerTransport(),
    });

    const head = await client.getBlockNumber();
    const ranges: { start: bigint; end: bigint }[] = [];
    for (let start = TREASURY_DEPLOY_BLOCK; start <= head; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
      ranges.push({ start, end });
    }

    // Batched rather than fanned out, for the reason documented in lib/indexer.ts:
    // eighteen simultaneous getLogs against the public RPC gets throttled, and
    // Promise.all means one rejection discards the whole scan.
    const scan = ({ start, end }: { start: bigint; end: bigint }) =>
      client.getLogs({
        address: SYNDIX_CONTRACTS.treasury,
        event: ARTICLE_PUBLISHED,
        fromBlock: start,
        toBlock: end,
      });

    const perRange: Awaited<ReturnType<typeof scan>>[] = [];
    for (let i = 0; i < ranges.length; i += MAX_CONCURRENCY) {
      perRange.push(
        ...(await Promise.all(ranges.slice(i, i + MAX_CONCURRENCY).map(scan))),
      );
    }

    const index: PublishIndex = new Map();
    for (const log of perRange.flat()) {
      const id = log.args.id;
      if (id === undefined || !log.transactionHash) continue;
      index.set(Number(id), {
        txHash: log.transactionHash,
        blockNumber: Number(log.blockNumber),
      });
    }

    cached = { at: Date.now(), index };
    return index;
  } catch {
    // A missing hash degrades the link, never the publication status — the
    // caller already knows the article is on chain because it read it there.
    return cached?.index ?? new Map();
  }
}
