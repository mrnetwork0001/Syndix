import type { Issue, TrackId } from "./types";
import type { OnchainIssue } from "./onchain-issues";
import type { PublishIndex, PublishRecord } from "./publish-tx";

/**
 * Turns an onchain article + its pinned metadata into the `Issue` shape the
 * reader UI renders.
 *
 * The treasury stores only what it needs to settle rewards - id, title,
 * contentURI, pool, claims. Everything editorial lives in the pinned JSON. This
 * is the seam between the two, and it is deliberately conservative: anything the
 * chain and IPFS cannot tell us is left empty rather than invented, because
 * filling gaps with plausible values is how the old hardcoded dataset came to
 * misreport reader counts and engagement scores.
 */

const TRACK_IDS: TrackId[] = [
  "giwa-l2",
  "ai-web3-alpha",
  "sponsorship",
  "dev-digest",
];

function attribute(
  issue: OnchainIssue,
  trait: string,
): string | number | undefined {
  return issue.metadata?.attributes?.find((a) => a.trait_type === trait)?.value;
}

function resolveTrack(issue: OnchainIssue): TrackId {
  const raw = attribute(issue, "Track");
  const found = TRACK_IDS.find((id) => id === raw);
  return found ?? "giwa-l2";
}

/** ~230 wpm, rounded up. Derived from the body rather than stored. */
function readingMinutes(body: string): number {
  const words = body.trim().split(/\s+/).length;
  return Math.max(1, Math.ceil(words / 230));
}

function sentiment(issue: OnchainIssue): "bullish" | "neutral" | "cautious" {
  const raw = attribute(issue, "Sentiment");
  return raw === "bullish" || raw === "cautious" ? raw : "neutral";
}

/**
 * @returns the issue in render shape, or null when its body never resolved.
 *          Callers decide whether to show the record without content or drop
 *          it; this function will not fabricate a body.
 */
/**
 * House typography, applied to text that arrives from IPFS.
 *
 * Article bodies are pinned content-addressed, so the CID the treasury records
 * is a hash of the exact bytes - editing the published text would change the
 * CID and orphan the onchain record. Older issues were written before the
 * house style ("-" over an em dash, "onchain" over "on-chain"), so the
 * substitution happens at render time instead.
 *
 * Typographic only. It never changes a number, a claim, or a meaning, and the
 * canonical bytes behind the Content URI shown on the page are untouched -
 * anyone fetching the CID gets exactly what was published.
 */
function houseStyle(text: string): string {
  return text
    .replace(/\u2014/g, "-")
    .replace(/On-chain/g, "Onchain")
    .replace(/on-chain/g, "onchain");
}

export function toRenderableIssue(
  issue: OnchainIssue,
  /**
   * The transaction that published this article, recovered from the
   * `ArticlePublished` log. Optional: the article is on chain either way - a
   * missing record only means the link could not be resolved this request.
   */
  publish?: PublishRecord,
): Issue | null {
  const metadata = issue.metadata;
  if (!metadata) return null;

  const engagement = attribute(issue, "Engagement index");
  const model = attribute(issue, "Model");
  const scannedBlock = attribute(issue, "Scanned at block");

  return {
    id: issue.articleId,
    slug: `${issue.articleId}`,
    title: houseStyle(issue.title),
    standfirst: houseStyle(metadata.description),
    track: resolveTrack(issue),
    // Every article read from the treasury is, by definition, published.
    status: "published",
    publishedAt: issue.publishedAt,
    readingMinutes: readingMinutes(metadata.content),
    contentURI: issue.contentURI,
    // Deterministic from the CID, so the cover is stable and unique per issue
    // without storing anything extra.
    coverSeed: issue.contentURI.replace(/^ipfs:\/\//, ""),
    coverPrompt: "",
    body: houseStyle(metadata.content),
    executiveSummary: (metadata.executiveSummary ?? []).map(houseStyle),
    score: {
      index: typeof engagement === "number" ? engagement : 0,
      subjectLine: houseStyle(issue.title),
      // The agent's rejected candidates are not pinned, so there are none to
      // show. An empty list renders as absent rather than as a fake shortlist.
      rejected: [],
      predictedOpenRate: 0,
      sentiment: sentiment(issue),
    },
    // Source signals are not pinned either. The reader hides the panel when
    // empty; inventing entries here would defeat the point of the panel, which
    // is to show what the agent actually read.
    signals: scannedBlock
      ? [
          {
            id: `${issue.articleId}-scan`,
            kind: "onchain",
            label: "GIWA Sepolia head at generation",
            detail:
              "Block height the ingestion agent read when drafting this issue.",
            ref: String(scannedBlock),
            confidence: 100,
          },
        ]
      : [],
    rewardPoolWei: issue.rewardPoolWei,
    rewardPerReaderWei: issue.rewardPerReaderWei,
    claimedCount: issue.claimedCount,
    // Distinct claimers is the only reader figure the chain can support. A
    // separate "readers" number would be unverifiable.
    readerCount: issue.claimedCount,
    generation: {
      provenance: "agent",
      model: typeof model === "string" ? model : "unknown",
      imageModel: "deterministic-svg",
      // Real per-run telemetry is not pinned, so it is reported as zero and the
      // UI omits it rather than showing invented numbers.
      latencyMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      stages: ["ingest", "synthesize", "score", "pin", "publish"],
    },
    mintTxHash: publish?.txHash,
    mintBlock: publish?.blockNumber,
  };
}

/** Renderable issues only, newest first. */
export function toRenderableIssues(
  issues: OnchainIssue[],
  publishIndex?: PublishIndex,
): Issue[] {
  return issues
    .map((issue) => toRenderableIssue(issue, publishIndex?.get(issue.articleId)))
    .filter((issue): issue is Issue => issue !== null)
    .sort((a, b) => b.id - a.id);
}
