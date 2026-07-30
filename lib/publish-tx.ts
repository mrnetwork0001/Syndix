import { createPublicClient, http, parseAbiItem } from "viem";
import { GIWA_RPC_HTTP, SYNDIX_CONTRACTS, ZERO_ADDRESS, giwaSepolia } from "./giwa";

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
 * Publish events are immutable once mined, so this is cached for the process
 * lifetime rather than a short TTL. A newly published article is the only way
 * the map grows, which the studio handles by revalidating the feed.
 */
let cached: { at: number; index: PublishIndex } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function readPublishIndex(): Promise<PublishIndex> {
  if (cached && Date.now() - cached.at < TTL_MS) return cached.index;
  if (SYNDIX_CONTRACTS.treasury === ZERO_ADDRESS) return new Map();

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { timeout: 15_000, retryCount: 1 }),
    });

    const head = await client.getBlockNumber();
    const ranges: { start: bigint; end: bigint }[] = [];
    for (let start = TREASURY_DEPLOY_BLOCK; start <= head; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
      ranges.push({ start, end });
    }

    const perRange = await Promise.all(
      ranges.map(({ start, end }) =>
        client.getLogs({
          address: SYNDIX_CONTRACTS.treasury,
          event: ARTICLE_PUBLISHED,
          fromBlock: start,
          toBlock: end,
        }),
      ),
    );

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
