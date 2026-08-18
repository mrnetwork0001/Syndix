import { createPublicClient, parseAbiItem, decodeFunctionData } from "viem";
import {
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  giwaSepolia,
  giwaServerTransport,
} from "./giwa";
import { syndixTreasuryAbi } from "./abi";

/**
 * The attention ledger.
 *
 * Every reward claim emits `RewardClaimed(articleId, reader, identity, amount)`,
 * so the full record of who read what already exists on chain - it has simply
 * never been read back. Two things fall out of it, and they are the same data
 * seen from opposite sides:
 *
 *   A READER'S RECORD - which issues this wallet has finished. Because claims
 *   are gated on a soul-bound `up.id` and capped at one per article, this is a
 *   history that cannot be inflated by generating addresses. It is proof of
 *   attention rather than a self-reported profile, and it belongs to the reader:
 *   any other application can read it without asking us.
 *
 *   A SPONSOR'S RECEIPT - how many distinct verified humans finished a given
 *   issue. An advertiser normally takes impression counts on trust; here the
 *   count is derived from settled transactions and anyone can recompute it.
 *
 * DWELL TIME IS RECOVERABLE, WITH A CAVEAT
 *
 * The contract verifies dwell but does not store it - it is not in the event.
 * It is, however, an argument to `claimReaderReward`, so it can be decoded from
 * the claim transaction's calldata. That makes it publicly checkable, but it is
 * the figure the attester signed rather than an independent measurement: it is
 * evidence the server judged this reader to have spent that long, not proof
 * they did. `/protocol` says as much, and so does this.
 */

const REWARD_CLAIMED = parseAbiItem(
  "event RewardClaimed(uint256 indexed articleId, address indexed reader, string identity, uint256 amount)",
);

/** Matches lib/indexer.ts - the measured ceiling for this RPC, not the documented one. */
const LOG_CHUNK = 45_000n;
const MAX_CONCURRENCY = 4;
const TREASURY_DEPLOY_BLOCK = 31_963_000n;

/** Claims are immutable once mined, so this only ever grows. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface ClaimRecord {
  articleId: number;
  reader: `0x${string}`;
  /** up.id label recorded at claim time, or empty - the live registry stores none. */
  identity: string;
  amountWei: string;
  blockNumber: string;
  txHash: `0x${string}`;
}

export interface AttentionIndex {
  claims: ClaimRecord[];
  /** Lower-cased address to that reader's claims, newest first. */
  byReader: Map<string, ClaimRecord[]>;
  byArticle: Map<number, ClaimRecord[]>;
  scannedTo: string;
}

let cached: { at: number; index: AttentionIndex } | null = null;

/** Drops the cache so a fresh claim shows up without waiting out the TTL. */
export function clearAttentionCache(): void {
  cached = null;
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
let readAttentionIndexInFlight: Promise<AttentionIndex | null> | null = null;

export function readAttentionIndex(): Promise<AttentionIndex | null> {
  if (readAttentionIndexInFlight) return readAttentionIndexInFlight;
  const run = readAttentionIndexUncached().finally(() => {
    readAttentionIndexInFlight = null;
  });
  readAttentionIndexInFlight = run;
  return run;
}

async function readAttentionIndexUncached(): Promise<AttentionIndex | null> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.index;
  if (!IS_LIVE_CHAIN) return null;

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: giwaServerTransport({ timeout: 25_000 }),
    });

    const head = await client.getBlockNumber();
    const ranges: { start: bigint; end: bigint }[] = [];
    for (let start = TREASURY_DEPLOY_BLOCK; start <= head; start += LOG_CHUNK) {
      const end = start + LOG_CHUNK - 1n > head ? head : start + LOG_CHUNK - 1n;
      ranges.push({ start, end });
    }

    const scan = ({ start, end }: { start: bigint; end: bigint }) =>
      client.getLogs({
        address: SYNDIX_CONTRACTS.treasury,
        event: REWARD_CLAIMED,
        fromBlock: start,
        toBlock: end,
      });

    // Batched, not fanned out - see the note in lib/indexer.ts.
    const perRange: Awaited<ReturnType<typeof scan>>[] = [];
    for (let i = 0; i < ranges.length; i += MAX_CONCURRENCY) {
      perRange.push(
        ...(await Promise.all(ranges.slice(i, i + MAX_CONCURRENCY).map(scan))),
      );
    }

    const claims: ClaimRecord[] = perRange.flat().map((log) => ({
      articleId: Number(log.args.articleId ?? 0n),
      reader: (log.args.reader ?? "0x") as `0x${string}`,
      identity: log.args.identity ?? "",
      amountWei: (log.args.amount ?? 0n).toString(),
      blockNumber: (log.blockNumber ?? 0n).toString(),
      txHash: (log.transactionHash ?? "0x") as `0x${string}`,
    }));

    // Newest first, which is how both views want to read.
    claims.sort((a, b) => Number(BigInt(b.blockNumber) - BigInt(a.blockNumber)));

    const byReader = new Map<string, ClaimRecord[]>();
    const byArticle = new Map<number, ClaimRecord[]>();
    for (const c of claims) {
      const key = c.reader.toLowerCase();
      (byReader.get(key) ?? byReader.set(key, []).get(key)!).push(c);
      (
        byArticle.get(c.articleId) ??
        byArticle.set(c.articleId, []).get(c.articleId)!
      ).push(c);
    }

    const index: AttentionIndex = {
      claims,
      byReader,
      byArticle,
      scannedTo: head.toString(),
    };
    cached = { at: Date.now(), index };
    return index;
  } catch {
    return null;
  }
}

/**
 * Dwell seconds the attester certified for a claim, decoded from its calldata.
 *
 * Returns null when the transaction cannot be read or decoded, which is treated
 * as "unknown" rather than zero - a missing figure must never render as a
 * reader who spent no time.
 */
export async function readCertifiedDwell(
  txHash: `0x${string}`,
): Promise<number | null> {
  if (!IS_LIVE_CHAIN) return null;
  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: giwaServerTransport(),
    });
    const tx = await client.getTransaction({ hash: txHash });
    const { functionName, args } = decodeFunctionData({
      abi: syndixTreasuryAbi,
      data: tx.input,
    });
    if (functionName !== "claimReaderReward" || !args) return null;
    // claimReaderReward(articleId, dwellSeconds, deadline, signature)
    const dwell = Number(args[1]);
    return Number.isFinite(dwell) ? dwell : null;
  } catch {
    return null;
  }
}
