import type { Issue, TrackId } from "./types";
import type { OnchainIssue } from "./onchain-issues";

/**
 * Turns an on-chain article + its pinned metadata into the `Issue` shape the
 * reader UI renders.
 *
 * The treasury stores only what it needs to settle rewards — id, title,
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
export function toRenderableIssue(issue: OnchainIssue): Issue | null {
  const metadata = issue.metadata;
  if (!metadata) return null;

  const engagement = attribute(issue, "Engagement index");
  const model = attribute(issue, "Model");
  const scannedBlock = attribute(issue, "Scanned at block");

  return {
    id: issue.articleId,
    slug: `${issue.articleId}`,
    title: issue.title,
    standfirst: metadata.description,
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
    body: metadata.content,
    executiveSummary: metadata.executiveSummary ?? [],
    score: {
      index: typeof engagement === "number" ? engagement : 0,
      subjectLine: issue.title,
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
  };
}

/** Renderable issues only, newest first. */
export function toRenderableIssues(issues: OnchainIssue[]): Issue[] {
  return issues
    .map(toRenderableIssue)
    .filter((issue): issue is Issue => issue !== null)
    .sort((a, b) => b.id - a.id);
}
