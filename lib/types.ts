/** Editorial tracks - drive the feed filter tabs. */
export type TrackId =
  | "giwa-l2"
  | "ai-web3-alpha"
  | "sponsorship"
  | "dev-digest";

export interface Track {
  id: TrackId;
  label: string;
  blurb: string;
  /** Tailwind text colour token used for the track chip. */
  tone: "accent" | "cyan" | "violet" | "positive";
}

export type IssueStatus = "published" | "minting" | "draft" | "scanning";

/** A signal the ingestion agent pulled in before writing the issue. */
export interface SourceSignal {
  id: string;
  kind: "onchain" | "github" | "governance" | "market" | "social";
  label: string;
  detail: string;
  /** Tx hash, block number, repo path, or URL depending on `kind`. */
  ref: string;
  /** Agent's 0-100 confidence that this signal is newsworthy. */
  confidence: number;
}

/** Per-issue quality telemetry produced by the scoring pass. */
export interface EngagementScore {
  /** 0-100 composite the agent optimises subject lines against. */
  index: number;
  subjectLine: string;
  /** Rejected subject-line candidates, kept for the studio's audit trail. */
  rejected: { text: string; score: number }[];
  predictedOpenRate: number;
  sentiment: "bullish" | "neutral" | "cautious";
}

export interface Issue {
  id: number;
  slug: string;
  title: string;
  /** One-line deck shown under the title on cards. */
  standfirst: string;
  track: TrackId;
  status: IssueStatus;
  /** ISO 8601. */
  publishedAt: string;
  readingMinutes: number;
  /** IPFS URI of the markdown body. */
  contentURI: string;
  /** Deterministic seed for the generated cover art. */
  coverSeed: string;
  coverPrompt: string;
  /** Full markdown body rendered by the reader. */
  body: string;
  /** AI executive summary bullets shown in the callout box. */
  executiveSummary: string[];
  score: EngagementScore;
  signals: SourceSignal[];
  /** Reward economics, all wei values as decimal strings for JSON safety. */
  rewardPoolWei: string;
  rewardPerReaderWei: string;
  claimedCount: number;
  /** Distinct up.id holders who have read to completion. */
  readerCount: number;
  /** Set once the issue is minted on GIWA. */
  mintTxHash?: string;
  mintBlock?: number;
  sponsor?: Sponsor;
  /** Model + cost accounting for the generation run. */
  generation: GenerationTrace;
}

export interface Sponsor {
  name: string;
  handle: string;
  /** Wei, decimal string. */
  depositWei: string;
  blurb: string;
}

export interface GenerationTrace {
  /**
   * Where the issue actually came from.
   *
   * `editorial-seed` issues were written by hand for the launch dataset - they
   * have no model, no token count and no cost, and every surface must avoid
   * attributing them to a pipeline run. `agent` issues really were produced by
   * the ingestion agent, so their telemetry is measured.
   */
  provenance: "editorial-seed" | "agent";
  model: string;
  imageModel: string;
  /** Milliseconds of wall-clock for the full pipeline. */
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  /** USD, 4 dp. */
  costUsd: number;
  /** Pipeline stage names in execution order. */
  stages: string[];
}

/* ------------------------------------------------------------------ */
/*  Protocol / treasury                                                */
/* ------------------------------------------------------------------ */

export interface ProtocolStats {
  /** Wei, decimal strings. */
  totalProtocolVolumeWei: string;
  totalRewardDistributedWei: string;
  treasuryBalanceWei: string;
  reservedRewardsWei: string;
  issuesPublished: number;
  uniqueReaders: number;
  /** Distinct wallets active in the trailing 24h. */
  dailyActiveWallets: number;
  /** Rolling 14-day series for the analytics widget. */
  series: DailyPoint[];
}

export interface DailyPoint {
  /** YYYY-MM-DD */
  date: string;
  claims: number;
  /** Wei distributed that day, decimal string. */
  distributedWei: string;
  activeWallets: number;
  x402Calls: number;
}

/* ------------------------------------------------------------------ */
/*  Agent studio                                                       */
/* ------------------------------------------------------------------ */

export type AgentStage =
  | "idle"
  | "scanning"
  | "synthesizing"
  | "scoring"
  | "illustrating"
  | "pinning"
  | "minting"
  | "complete"
  | "failed";

export interface AgentLogLine {
  id: string;
  /** Milliseconds since run start. */
  at: number;
  stage: AgentStage;
  level: "info" | "ok" | "warn" | "error";
  message: string;
  /** Optional monospace detail - tx hash, CID, token count. */
  meta?: string;
}

export interface AgentRun {
  id: string;
  startedAt: string;
  stage: AgentStage;
  log: AgentLogLine[];
  draft?: Pick<
    Issue,
    "title" | "standfirst" | "body" | "executiveSummary" | "track"
  >;
}

/* ------------------------------------------------------------------ */
/*  x402                                                               */
/* ------------------------------------------------------------------ */

export interface X402Requirement {
  /**
   * How payment is made. Not one of x402's built-in scheme names - see
   * X402_SCHEME in lib/x402.ts for why `exact` would be a false advertisement
   * here.
   */
  scheme: string;
  network: string;
  /** Wei, decimal string. */
  maxAmountRequired: string;
  /** Absolute URL of the paid resource, not a path. */
  resource: string;
  description: string;
  mimeType: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Native ETH is represented by the zero address. */
  asset: string;
  extra: Record<string, string>;
}

export interface X402Challenge {
  x402Version: number;
  error: string;
  accepts: X402Requirement[];
}
