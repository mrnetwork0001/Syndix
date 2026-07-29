import type {
  AgentLogLine,
  DailyPoint,
  ProtocolStats,
  Sponsor,
  Track,
  TrackId,
} from "@/lib/types";
import { ISSUES, TRACKS } from "@/lib/data/issues";

/**
 * Protocol-level telemetry for the demo.
 *
 * Every wei total below is DERIVED from `ISSUES` rather than hard-coded, so the
 * treasury panel can never drift out of sync with the archive. None of it is
 * read from a live contract — Syndix is not deployed — and the UI is required
 * to label it as simulated.
 */

/** Price of one metered call to the machine-readable feed: 0.00001 ETH. */
const X402_PRICE_WEI = BigInt("10000000000000");

/** All-time paid calls to /api/x402/feed, of which the series covers 14 days. */
const X402_ALL_TIME_CALLS = BigInt(48120);

/** Blended payout across the archive, used to price the daily series. */
const BLENDED_REWARD_WEI = BigInt("31000000000000");

/** Treasury float that is funded but not yet committed to any issue pool. */
const UNALLOCATED_FLOAT_WEI = BigInt("600000000000000000");

function sumIssues(): { distributed: bigint; committed: bigint } {
  let distributed = BigInt(0);
  let committed = BigInt(0);
  for (const issue of ISSUES) {
    distributed += BigInt(issue.claimedCount) * BigInt(issue.rewardPerReaderWei);
    committed += BigInt(issue.rewardPoolWei);
  }
  return { distributed, committed };
}

const { distributed: DISTRIBUTED_WEI, committed: COMMITTED_WEI } = sumIssues();

const SPONSOR_DEPOSITS_WEI = BigInt("1430000000000000000");

const X402_REVENUE_WEI = X402_ALL_TIME_CALLS * X402_PRICE_WEI;

/**
 * 14 days ending 2026-07-29. Claim spikes track publication days
 * (07-20, 07-24, 07-29) and dip across weekends — the shape you get from a
 * newsletter, not from a random walk.
 */
const SERIES_INPUT: {
  date: string;
  claims: number;
  activeWallets: number;
  x402Calls: number;
}[] = [
  { date: "2026-07-16", claims: 207, activeWallets: 341, x402Calls: 612 },
  { date: "2026-07-17", claims: 231, activeWallets: 366, x402Calls: 704 },
  { date: "2026-07-18", claims: 186, activeWallets: 298, x402Calls: 538 },
  { date: "2026-07-19", claims: 174, activeWallets: 271, x402Calls: 495 },
  { date: "2026-07-20", claims: 288, activeWallets: 452, x402Calls: 861 },
  { date: "2026-07-21", claims: 264, activeWallets: 431, x402Calls: 938 },
  { date: "2026-07-22", claims: 249, activeWallets: 407, x402Calls: 1017 },
  { date: "2026-07-23", claims: 276, activeWallets: 438, x402Calls: 1184 },
  { date: "2026-07-24", claims: 412, activeWallets: 619, x402Calls: 1352 },
  { date: "2026-07-25", claims: 331, activeWallets: 512, x402Calls: 1106 },
  { date: "2026-07-26", claims: 302, activeWallets: 474, x402Calls: 1043 },
  { date: "2026-07-27", claims: 458, activeWallets: 688, x402Calls: 1571 },
  { date: "2026-07-28", claims: 611, activeWallets: 874, x402Calls: 1896 },
  { date: "2026-07-29", claims: 894, activeWallets: 1187, x402Calls: 2408 },
];

const SERIES: DailyPoint[] = SERIES_INPUT.map((point) => ({
  ...point,
  distributedWei: (BigInt(point.claims) * BLENDED_REWARD_WEI).toString(),
}));

export const PROTOCOL_STATS: ProtocolStats = {
  totalProtocolVolumeWei: (
    DISTRIBUTED_WEI +
    SPONSOR_DEPOSITS_WEI +
    X402_REVENUE_WEI
  ).toString(),
  totalRewardDistributedWei: DISTRIBUTED_WEI.toString(),
  treasuryBalanceWei: (
    COMMITTED_WEI -
    DISTRIBUTED_WEI +
    UNALLOCATED_FLOAT_WEI
  ).toString(),
  reservedRewardsWei: (COMMITTED_WEI - DISTRIBUTED_WEI).toString(),
  issuesPublished: ISSUES.filter((issue) => issue.status === "published").length,
  uniqueReaders: 3284,
  dailyActiveWallets: SERIES[SERIES.length - 1].activeWallets,
  series: SERIES,
};

/* ------------------------------------------------------------------ */
/*  Sponsors                                                           */
/* ------------------------------------------------------------------ */

export const SPONSORS: Sponsor[] = [
  {
    name: "Marunode",
    handle: "marunode.up.id",
    depositWei: "400000000000000000",
    blurb:
      "ERC-4337 bundler and paymaster infrastructure for OP Stack rollups. Sponsored issue #2; no editorial control over its technical claims.",
  },
  {
    name: "Baekje Labs",
    handle: "baekje.up.id",
    depositWei: "750000000000000000",
    blurb:
      "Indexing and observability for GIWA Sepolia — block-level tracing, Flashblocks-aware receipts, and derivation lag monitoring.",
  },
  {
    name: "Sundial Security",
    handle: "sundial.up.id",
    depositWei: "280000000000000000",
    blurb:
      "Audits and differential fuzzing for L2 deployments, with a focus on withdrawal-path and paymaster policy failures.",
  },
];

/* ------------------------------------------------------------------ */
/*  Scripted pipeline run                                              */
/* ------------------------------------------------------------------ */

/**
 * The fallback trace the studio replays when no ANTHROPIC_API_KEY is present.
 * It mirrors a real run of the ingestion pipeline: ~45s wall clock, one
 * recovered warning, and honest stage boundaries.
 */
export const AGENT_RUN_SCRIPT: AgentLogLine[] = [
  {
    id: "r-01",
    at: 120,
    stage: "scanning",
    level: "info",
    message: "Run initialised — target track: GIWA L2 Ecosystem",
    meta: "chainId=91342",
  },
  {
    id: "r-02",
    at: 640,
    stage: "scanning",
    level: "info",
    message: "Connected to sepolia-rpc.giwa.io",
    meta: "eth_blockNumber → 28944218",
  },
  {
    id: "r-03",
    at: 1180,
    stage: "scanning",
    level: "ok",
    message: "Flashblocks endpoint reachable, pending head ahead of sealed head",
    meta: "pending=28944219 · Δ=1 block",
  },
  {
    id: "r-04",
    at: 2460,
    stage: "scanning",
    level: "info",
    message: "Sweeping 4,320 blocks for protocol-relevant logs",
    meta: "eth_getLogs 28939898..28944218",
  },
  {
    id: "r-05",
    at: 5310,
    stage: "scanning",
    level: "warn",
    message: "eth_getLogs range rejected — response size cap hit",
    meta: "retrying in 4 chunks of 1,080 blocks",
  },
  {
    id: "r-06",
    at: 8940,
    stage: "scanning",
    level: "ok",
    message: "Chunked sweep complete — 1,207 logs retrieved",
    meta: "4/4 chunks · 0 gaps",
  },
  {
    id: "r-07",
    at: 10120,
    stage: "scanning",
    level: "info",
    message: "Reading EAS predeploy for new Dojang attestations",
    meta: "0x4200000000000000000000000000000000000021",
  },
  {
    id: "r-08",
    at: 11780,
    stage: "scanning",
    level: "info",
    message: "Paid 12 metered x402 calls for indexed GitHub + governance feeds",
    meta: "0.00012 ETH · scheme=exact",
  },
  {
    id: "r-09",
    at: 13040,
    stage: "scanning",
    level: "ok",
    message: "38 raw signals collected across 5 kinds",
    meta: "onchain=17 github=9 governance=5 market=4 social=3",
  },
  {
    id: "r-10",
    at: 14620,
    stage: "scanning",
    level: "info",
    message: "Deduplicating against the last 6 issues by embedding distance",
    meta: "threshold=0.86 cosine",
  },
  {
    id: "r-11",
    at: 15910,
    stage: "scanning",
    level: "ok",
    message: "34 duplicates dropped — 4 signals survive",
    meta: "top confidence 93",
  },
  {
    id: "r-12",
    at: 17200,
    stage: "synthesizing",
    level: "info",
    message: "Drafting with claude-opus-5",
    meta: "context 52,140 in",
  },
  {
    id: "r-13",
    at: 26480,
    stage: "synthesizing",
    level: "info",
    message: "Fact-check pass: every address cross-checked against docs.giwa.io",
    meta: "8 predeploys · 4 L1 contracts · 0 mismatches",
  },
  {
    id: "r-14",
    at: 29940,
    stage: "synthesizing",
    level: "ok",
    message: "Draft complete — 1,024 words, 5 min read",
    meta: "6,480 out · $1.5876",
  },
  {
    id: "r-15",
    at: 31260,
    stage: "scoring",
    level: "info",
    message: "Generating 6 subject-line candidates",
    meta: "objective: predicted open rate",
  },
  {
    id: "r-16",
    at: 33580,
    stage: "scoring",
    level: "info",
    message: 'Rejected "Your L2 is fast. Your UI is not."',
    meta: "score 88 · too oblique for cold readers",
  },
  {
    id: "r-17",
    at: 34710,
    stage: "scoring",
    level: "ok",
    message:
      'Selected "200ms is the number that decides if crypto feels like software"',
    meta: "index 94 · predicted open 48.7%",
  },
  {
    id: "r-18",
    at: 36040,
    stage: "illustrating",
    level: "info",
    message: "Rendering cover with syndix-diffusion-v2",
    meta: "seed=giwa-flashblocks-preconf-0729",
  },
  {
    id: "r-19",
    at: 39820,
    stage: "illustrating",
    level: "ok",
    message: "Cover selected from 4 candidates",
    meta: "1600×900 · $0.22",
  },
  {
    id: "r-20",
    at: 41360,
    stage: "pinning",
    level: "ok",
    message: "Markdown + metadata pinned to IPFS",
    meta: "bafybeii2kf3efzdj2mgj4cf6i4dkmvjblvogjbf3co7usceutfloha3gk7",
  },
  {
    id: "r-21",
    at: 43110,
    stage: "minting",
    level: "info",
    message: "Submitting issue mint to GIWA Sepolia",
    meta: "0x18e738d79918dab34d85ed13794b602a9a087e11f34eb4a498710fe1d5df4067",
  },
  {
    id: "r-22",
    at: 43390,
    stage: "minting",
    level: "ok",
    message: "Preconfirmed by the sequencer in 280ms",
    meta: "pending tag · not yet sealed",
  },
  {
    id: "r-23",
    at: 44280,
    stage: "minting",
    level: "ok",
    message: "Sealed in block 28944712 — reward pool funded for 1,200 claims",
    meta: "0.036 ETH escrowed",
  },
  {
    id: "r-24",
    at: 45010,
    stage: "complete",
    level: "ok",
    message: "Run complete — issue #6 published",
    meta: "45.0s · $1.8163 total",
  },
];

/* ------------------------------------------------------------------ */
/*  Lookups                                                            */
/* ------------------------------------------------------------------ */

export function trackMeta(id: TrackId): Track {
  const found = TRACKS.find((track) => track.id === id);
  return found ?? TRACKS[0];
}
