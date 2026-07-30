import { createPublicClient, http } from "viem";
import { syndixTreasuryAbi } from "./abi";
import {
  GIWA_RPC_HTTP,
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  giwaSepolia,
} from "./giwa";
import { ipfsGatewayUrl } from "./ipfs";

/**
 * Reads the published issue set from the chain, with bodies fetched from IPFS.
 *
 * This is what makes the pitch literal rather than aspirational: the treasury is
 * the index and IPFS is the store, so the feed is a projection of on-chain
 * state instead of a file in the repo that happens to describe it.
 *
 * A published article whose contentURI does not resolve is surfaced as
 * `unavailable` rather than dropped. Six of the original articles carry
 * fabricated CIDs, and hiding them would misrepresent what the treasury
 * actually holds — the honest presentation is to show the record and say the
 * content is missing.
 */

export interface OnchainIssueMetadata {
  name: string;
  description: string;
  content: string;
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
let cached: { at: number; result: OnchainIssuesResult } | null = null;

/**
 * Fetches one body, distinguishing "no such content" from "slow down".
 *
 * Conflating those two is how you end up telling a reader an article does not
 * exist because a gateway was busy. 429 is retried with backoff; 400/404 is the
 * signal that a CID really has nothing behind it.
 */
async function fetchMetadata(
  contentURI: string,
  attempt = 0,
): Promise<{ metadata: OnchainIssueMetadata | null; reason: string | null }> {
  if (!contentURI.startsWith("ipfs://")) {
    return { metadata: null, reason: `Unsupported contentURI scheme` };
  }
  try {
    const response = await fetch(ipfsGatewayUrl(contentURI), {
      signal: AbortSignal.timeout(15_000),
      headers: { accept: "application/json" },
    });

    if (response.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      return fetchMetadata(contentURI, attempt + 1);
    }

    if (!response.ok) {
      return {
        metadata: null,
        reason:
          response.status === 429
            ? "Gateway is rate limiting this request — content may still exist"
            : response.status === 400 || response.status === 404
              ? "Not pinned — no content behind this CID"
              : response.status >= 500
                ? "Gateway could not resolve this CID — most likely never pinned"
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

    // Sequential on purpose. Six concurrent gateway requests is what tripped
    // the rate limiter and produced misleading "not pinned" diagnoses.
    const issues: OnchainIssue[] = [];
    for (const article of page) {
      const { metadata, reason } = await fetchMetadata(article.contentURI);
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

/** Clears the cache so a fresh publish shows up without waiting out the TTL. */
export function invalidateOnchainIssues(): void {
  cached = null;
}
