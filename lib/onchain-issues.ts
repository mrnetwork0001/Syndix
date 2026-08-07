import { createPublicClient, http } from "viem";
import { syndixTreasuryAbi } from "./abi";
import {
  GIWA_RPC_HTTP,
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  giwaSepolia,
  ZERO_ADDRESS,
} from "./giwa";
import { ipfsGatewayUrls } from "./ipfs";

/**
 * Reads the published issue set from the chain, with bodies fetched from IPFS.
 *
 * This is what makes the pitch literal rather than aspirational: the treasury is
 * the index and IPFS is the store, so the feed is a projection of onchain
 * state instead of a file in the repo that happens to describe it.
 *
 * A published article whose contentURI does not resolve is surfaced as
 * `unavailable` rather than dropped. Six of the original articles carry
 * fabricated CIDs, and hiding them would misrepresent what the treasury
 * actually holds - the honest presentation is to show the record and say the
 * content is missing.
 */

export interface OnchainIssueMetadata {
  name: string;
  description: string;
  content: string;
  /** Absent on issues pinned before the summary was added to the metadata. */
  executiveSummary?: string[];
  attributes?: { trait_type: string; value: string | number }[];
}

export interface OnchainIssue {
  /** SyndixTreasury article id. */
  articleId: number;
  title: string;
  contentURI: string;
  rewardPoolWei: string;
  rewardPerReaderWei: string;
  totalClaimedWei: string;
  claimedCount: number;
  publishedAt: string;
  isActive: boolean;
  /** Present when the contentURI resolved. */
  metadata: OnchainIssueMetadata | null;
  /** Why the body is missing, when it is. */
  unavailableReason: string | null;
}

export type OnchainIssuesResult =
  | { ok: true; issues: OnchainIssue[]; articleCount: number }
  | { ok: false; reason: string };

const CACHE_TTL_MS = 60 * 1000;

/** Gateway requests in flight at once. Enough to be quick, few enough not to be throttled. */
const METADATA_CONCURRENCY = 4;

/**
 * Bodies, keyed by CID, cached for the life of the process.
 *
 * A CID is a hash of its content, so what it points at can never change. There
 * is no correctness reason to ever re-fetch one, and re-fetching is what made a
 * cold issue page take thirty-five seconds. The index TTL above still governs
 * how quickly a *new* article appears; this only stops us paying for the same
 * bytes twice.
 */
const bodyCache = new Map<
  string,
  { metadata: OnchainIssueMetadata | null; reason: string | null }
>();
let cached: { at: number; result: OnchainIssuesResult } | null = null;

/**
 * Fetches one body, distinguishing "no such content" from "slow down".
 *
 * Conflating those two is how you end up telling a reader an article does not
 * exist because a gateway was busy. 429 is retried with backoff; 400/404 is the
 * signal that a CID really has nothing behind it.
 */
/** Cached wrapper. Only a successful body is remembered - a failure may be transient. */
async function fetchMetadata(
  contentURI: string,
): Promise<{ metadata: OnchainIssueMetadata | null; reason: string | null }> {
  const hit = bodyCache.get(contentURI);
  if (hit) return hit;

  // Preferred gateway first, public one as fallback. A CID that 404s on a
  // dedicated gateway may still resolve on the public network.
  let last = { metadata: null as OnchainIssueMetadata | null, reason: "no gateway configured" as string | null };
  for (const url of ipfsGatewayUrls(contentURI)) {
    last = await fetchFromGateway(contentURI, url);
    if (last.metadata) break;
  }
  if (last.metadata) bodyCache.set(contentURI, last);
  return last;
}

async function fetchFromGateway(
  contentURI: string,
  url: string,
  attempt = 0,
): Promise<{ metadata: OnchainIssueMetadata | null; reason: string | null }> {
  if (!contentURI.startsWith("ipfs://")) {
    return { metadata: null, reason: `Unsupported contentURI scheme` };
  }
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });

    if (response.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return fetchFromGateway(contentURI, url, attempt + 1);
    }

    if (!response.ok) {
      return {
        metadata: null,
        reason:
          response.status === 429
            ? "Gateway is rate limiting this request - content may still exist"
            : response.status === 400 || response.status === 404
              ? "Not pinned - no content behind this CID"
              : response.status >= 500
                ? "Gateway could not resolve this CID - most likely never pinned"
                : `Gateway returned ${response.status}`,
      };
    }
    const body = (await response.json()) as Partial<OnchainIssueMetadata>;
    if (typeof body.content !== "string" || body.content.length === 0) {
      return { metadata: null, reason: "Pinned JSON has no `content` field" };
    }
    return {
      metadata: {
        name: body.name ?? "Untitled",
        description: body.description ?? "",
        content: body.content,
        executiveSummary: Array.isArray(body.executiveSummary)
          ? body.executiveSummary
          : undefined,
        attributes: body.attributes ?? [],
      },
      reason: null,
    };
  } catch (error) {
    return {
      metadata: null,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function readOnchainIssues(): Promise<OnchainIssuesResult> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  if (!IS_LIVE_CHAIN) {
    return { ok: false, reason: "No treasury address configured." };
  }

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { timeout: 15_000, retryCount: 1 }),
    });

    const count = await client.readContract({
      address: SYNDIX_CONTRACTS.treasury,
      abi: syndixTreasuryAbi,
      functionName: "articleCount",
    });
    const articleCount = Number(count);
    if (articleCount === 0) {
      const empty = { ok: true as const, issues: [], articleCount: 0 };
      cached = { at: Date.now(), result: empty };
      return empty;
    }

    // One paginated read rather than N calls.
    const page = await client.readContract({
      address: SYNDIX_CONTRACTS.treasury,
      abi: syndixTreasuryAbi,
      functionName: "listArticles",
      args: [0n, BigInt(articleCount)],
    });

    // Bounded concurrency rather than strictly sequential. Fetching all ten
    // bodies one after another is what made a cold feed slow; firing all ten at
    // once is what tripped the gateway's rate limiter and produced misleading
    // "not pinned" diagnoses. Four at a time satisfies both.
    const bodies = new Map<string, Awaited<ReturnType<typeof fetchMetadata>>>();
    for (let i = 0; i < page.length; i += METADATA_CONCURRENCY) {
      const batch = page.slice(i, i + METADATA_CONCURRENCY);
      const settled = await Promise.all(
        batch.map(async (a) => [a.contentURI, await fetchMetadata(a.contentURI)] as const),
      );
      for (const [uri, result] of settled) bodies.set(uri, result);
    }

    const issues: OnchainIssue[] = [];
    for (const article of page) {
      const { metadata, reason } = bodies.get(article.contentURI) ?? {
        metadata: null,
        reason: "not fetched",
      };
      const perReader = article.rewardPerReader;
      issues.push(
        {
          articleId: Number(article.id),
          title: article.title,
          contentURI: article.contentURI,
          rewardPoolWei: article.rewardPool.toString(),
          rewardPerReaderWei: perReader.toString(),
          totalClaimedWei: article.totalClaimed.toString(),
          claimedCount:
            perReader > 0n ? Number(article.totalClaimed / perReader) : 0,
          publishedAt: new Date(
            Number(article.publishedAt) * 1000,
          ).toISOString(),
          isActive: article.isActive,
          metadata,
          unavailableReason: reason,
        } satisfies OnchainIssue,
      );
    }

    // Newest first, matching how a reader expects a feed to be ordered.
    issues.sort((a, b) => b.articleId - a.articleId);

    const result = { ok: true as const, issues, articleCount };
    cached = { at: Date.now(), result };
    return result;
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * One article, with only its own body fetched.
 *
 * `readOnchainIssues` walks the whole index and resolves every body, which is
 * right for the feed and badly wrong for a single issue page: rendering one
 * article meant ten sequential gateway round trips and then discarding nine of
 * them. That was most of a thirty-five second cold render.
 *
 * This reads the index (cheap, and usually already cached) and fetches exactly
 * the one body it needs.
 */
export async function readOnchainIssue(
  articleId: number,
): Promise<OnchainIssue | null> {
  if (!Number.isInteger(articleId) || articleId <= 0) return null;
  if (SYNDIX_CONTRACTS.treasury === ZERO_ADDRESS) return null;

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP, { timeout: 15_000, retryCount: 1 }),
    });

    const article = await client.readContract({
      address: SYNDIX_CONTRACTS.treasury,
      abi: syndixTreasuryAbi,
      functionName: "articles",
      args: [BigInt(articleId)],
    });

    // articles() returns the zero struct for an id that was never published.
    const [id, title, contentURI, rewardPool, rewardPerReader, totalClaimed, publishedAt, isActive] =
      article as unknown as [bigint, string, string, bigint, bigint, bigint, bigint, boolean];
    if (id === 0n) return null;

    const { metadata, reason } = await fetchMetadata(contentURI);

    return {
      articleId: Number(id),
      title,
      contentURI,
      rewardPoolWei: rewardPool.toString(),
      rewardPerReaderWei: rewardPerReader.toString(),
      totalClaimedWei: totalClaimed.toString(),
      claimedCount: rewardPerReader > 0n ? Number(totalClaimed / rewardPerReader) : 0,
      publishedAt: new Date(Number(publishedAt) * 1000).toISOString(),
      isActive,
      metadata,
      unavailableReason: reason,
    } satisfies OnchainIssue;
  } catch {
    return null;
  }
}

/** Clears the cache so a fresh publish shows up without waiting out the TTL. */
export function invalidateOnchainIssues(): void {
  cached = null;
}
