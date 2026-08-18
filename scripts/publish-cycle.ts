/**
 * One unattended publishing cycle. This is what the VPS runs.
 *
 * Order matters, and it is deliberately cheapest-and-most-likely-to-refuse
 * first: measure the chain, ask whether anything changed, and only then spend
 * money on a model, a pinning service and a transaction. Most runs stop at the
 * gate having cost nothing but a handful of RPC calls.
 *
 *   measure -> gate -> generate -> pin -> publish
 *
 * WHAT THIS WILL NOT DO
 *
 * It will not publish an issue nobody read first unless every safeguard agrees
 * it should. There is no human in this loop, so the loop is built to refuse:
 *
 *   - lib/telemetry.ts gives the model only figures measured this run
 *   - lib/novelty.ts refuses when nothing moved beyond noise
 *   - a failed probe is absent from the digest rather than guessed at
 *   - an unpinnable draft is discarded rather than published as a dead CID
 *   - SyndixPublisher caps pool size and publishes per day, on chain, so a bug
 *     here cannot spend more than the cap no matter what this file does
 *
 * That last one is the important one. Everything above is a promise this
 * process makes to itself; the cap is enforced by a contract that does not
 * trust this process at all.
 *
 * Usage:
 *   npm run cycle -- --dry-run     measure and decide, write nothing
 *   npm run cycle                  the real thing
 */

import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { collectTelemetry } from "../lib/telemetry";
import {
  assessNovelty,
  readLastSnapshot,
  telemetrySnapshot,
} from "../lib/novelty";
import { buildIssueUserPrompt } from "../lib/issue-prompt";
import {
  ISSUE_JSON_SCHEMA,
  SYSTEM_PROMPT,
  hasInferenceKey,
  inferenceClient,
  inferenceModel,
  inferenceProviderLabel,
  assertModelSupported,
  validateGeneratedIssue,
  normalizeIssueProse,
  type GeneratedIssue,
} from "../lib/openai";
import { hasPinataKey, pinIssueMetadata } from "../lib/ipfs";
import { GIWA_RPC_FLASHBLOCKS, giwaSepolia } from "../lib/giwa";
import { TRACKS } from "../lib/data/issues";
import type { TrackId } from "../lib/types";

const DRY_RUN = process.argv.includes("--dry-run");

/** Matches the studio's funding shape so automated issues are not second-class. */
const REWARD_PER_READER_WEI = 30_000_000_000_000n;
const CLAIMS_FUNDED = 20n;

const PUBLISHER_ABI = [
  {
    type: "function",
    name: "publish",
    stateMutability: "nonpayable",
    inputs: [
      { name: "title", type: "string" },
      { name: "contentURI", type: "string" },
      { name: "rewardPerReader", type: "uint128" },
      { name: "pool", type: "uint256" },
    ],
    outputs: [{ name: "articleId", type: "uint256" }],
  },
  {
    type: "function",
    name: "remainingToday",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint32" }],
  },
  {
    type: "function",
    name: "maxPoolPerArticle",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint128" }],
  },
] as const;

function log(stage: string, message: string) {
  // One line per event, timestamped, no colour. This lands in journalctl.
  process.stdout.write(
    `${new Date().toISOString()} [${stage}] ${message}\n`,
  );
}

/** Exits non-zero so a failed cycle is visible to systemd rather than silent. */
function die(stage: string, message: string): never {
  process.stderr.write(
    `${new Date().toISOString()} [${stage}] FAILED: ${message}\n`,
  );
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) die("config", `${name} is not set`);
  return value;
}

async function main() {
  if (DRY_RUN) log("start", "dry run - nothing will be written");

  const publisherAddress = requireEnv(
    "NEXT_PUBLIC_SYNDIX_PUBLISHER",
  ) as `0x${string}`;

  /* ---------------------------------------------------------------- */
  /*  1. Measure                                                       */
  /* ---------------------------------------------------------------- */

  log("measure", "sampling GIWA Sepolia");
  const telemetry = await collectTelemetry();
  for (const error of telemetry.errors) {
    log("measure", `probe failed, will not be cited: ${error.split("\n")[0]}`);
  }
  if (telemetry.blockNumber === null) {
    // No head state means no usable signals at all. Refusing here is the
    // difference between skipping a day and publishing an empty issue.
    die("measure", "could not read head state; skipping this cycle");
  }
  log(
    "measure",
    `head ${telemetry.blockNumber}, gas ${telemetry.gasPriceWei} wei, ${telemetry.latency.length} latency and ${telemetry.advance.length} freshness probes`,
  );

  /* ---------------------------------------------------------------- */
  /*  2. Gate                                                          */
  /* ---------------------------------------------------------------- */

  const current = telemetrySnapshot(telemetry);
  const previous = await readLastSnapshot();
  const verdict = assessNovelty(current, previous);

  for (const reason of verdict.reasons) log("gate", reason);
  if (!verdict.publish) {
    log("gate", "no issue this cycle");
    return;
  }
  if (verdict.firstRun && previous === null) {
    log("gate", "no comparison point available - treating as publishable");
  }

  /* ---------------------------------------------------------------- */
  /*  3. Check the on-chain allowance before spending anything         */
  /* ---------------------------------------------------------------- */

  const pool = REWARD_PER_READER_WEI * CLAIMS_FUNDED;
  const publicClient = createPublicClient({
    chain: giwaSepolia,
    transport: http(GIWA_RPC_FLASHBLOCKS, { timeout: 20_000, retryCount: 1 }),
  });

  const [remaining, poolCap] = await Promise.all([
    publicClient.readContract({
      address: publisherAddress,
      abi: PUBLISHER_ABI,
      functionName: "remainingToday",
    }),
    publicClient.readContract({
      address: publisherAddress,
      abi: PUBLISHER_ABI,
      functionName: "maxPoolPerArticle",
    }),
  ]);

  // Asked before generating, not after. The model call and the pin both cost
  // real money, and spending them on an issue the contract will refuse to
  // accept is pure waste.
  if (remaining === 0) {
    // A dry run writes nothing, so the on-chain allowance is information here
    // rather than a limit. Stopping would make the pipeline untestable for the
    // rest of the day every time it publishes, which is exactly when you most
    // want to check it still works.
    if (!DRY_RUN) {
      log("allowance", "daily cap already used; skipping this cycle");
      return;
    }
    log("allowance", "daily cap already used - a real run would stop here");
  }
  if (pool > poolCap) {
    die(
      "allowance",
      `pool ${pool} exceeds the on-chain cap ${poolCap}; lower CLAIMS_FUNDED or raise the cap`,
    );
  }
  const guardBalance = await publicClient.getBalance({
    address: publisherAddress,
  });
  if (guardBalance < pool) {
    die(
      "allowance",
      `SyndixPublisher holds ${guardBalance} wei but needs ${pool}; top it up`,
    );
  }
  log("allowance", `${remaining} publish(es) left today, pool ${pool} wei funded`);

  /* ---------------------------------------------------------------- */
  /*  4. Generate                                                      */
  /* ---------------------------------------------------------------- */

  if (!hasInferenceKey()) die("generate", "OPENAI_API_KEY is not set");

  const track = (process.env.SYNDIX_TRACK ?? "giwa-l2") as TrackId;
  const trackLabel = TRACKS.find((t) => t.id === track)?.label ?? track;

  // Wrong model here means a parse failure one paid request later, and it
  // reads like the model being bad at JSON rather than never having been
  // asked for JSON in a way it understands.
  assertModelSupported();

  log("generate", `dispatching to ${inferenceProviderLabel()} for "${trackLabel}"`);

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: buildIssueUserPrompt(trackLabel, telemetry) },
  ];

  // Three attempts.
  //
  // Measured on the 0G router: `strict: true` is not fully honoured, and a
  // required field - executiveSummary in every observed case - intermittently
  // comes back empty. Retrying clears it; the same prompt succeeded on a later
  // attempt every time it was tried. Three is chosen because each attempt is
  // roughly a minute and a cron has the time, not because the third is
  // special. If all three fail, the day is skipped, which is recoverable in a
  // way that publishing a malformed issue is not.
  let issue: GeneratedIssue | null = null;
  for (let attempt = 1; attempt <= 3 && !issue; attempt++) {
    const completion = await inferenceClient().chat.completions.create({
      model: inferenceModel(),
      response_format: { type: "json_schema", json_schema: ISSUE_JSON_SCHEMA },
      messages,
    });

    const finish = completion.choices[0]?.finish_reason;
    if (finish && finish !== "stop") {
      log("generate", `attempt ${attempt} stopped early (${finish})`);
      continue;
    }
    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      log("generate", `attempt ${attempt} returned no content`);
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      log("generate", `attempt ${attempt} returned invalid JSON`);
      continue;
    }

    const problems = validateGeneratedIssue(parsed);
    if (problems.length > 0) {
      log("generate", `attempt ${attempt} failed validation: ${problems.join("; ")}`);
      continue;
    }
    issue = normalizeIssueProse(parsed as GeneratedIssue);
  }

  if (!issue) die("generate", "no usable issue after 3 attempts; skipping rather than publishing a malformed one");
  log("generate", `"${issue.title}" (${issue.body.length} chars)`);

  if (DRY_RUN) {
    log("dry-run", "stopping before pin and publish");
    process.stdout.write(`\n--- DRAFT ---\n${issue.title}\n\n${issue.standfirst}\n\n${issue.body}\n`);
    return;
  }

  /* ---------------------------------------------------------------- */
  /*  5. Pin                                                           */
  /* ---------------------------------------------------------------- */

  if (!hasPinataKey()) die("pin", "PINATA_JWT is not set");

  const pin = await pinIssueMetadata({
    name: issue.title,
    description: issue.standfirst,
    content: issue.body,
    executiveSummary: issue.executiveSummary,
    external_url: "https://docs.giwa.io",
    attributes: [
      { trait_type: "Track", value: track },
      { trait_type: "Sentiment", value: issue.sentiment },
      { trait_type: "Engagement index", value: issue.engagementIndex },
      { trait_type: "Model", value: inferenceModel() },
              // Which network actually ran the inference. The 0G
              // default is TEE-attested, so this is a claim that can
              // be checked rather than one that must be believed.
              { trait_type: "Inference", value: inferenceProviderLabel() },
      { trait_type: "Published by", value: "autonomous cycle" },
      ...(telemetry.blockNumber
        ? [{ trait_type: "Scanned at block", value: telemetry.blockNumber }]
        : []),
    ],
    // Carried so the next cycle has something to diff against.
    telemetry: current,
  });

  if (!pin.ok) {
    // A contentURI pointing at nothing is worse than no issue: it is a
    // permanent on-chain reference to content that never existed.
    die("pin", `${pin.reason} - not publishing an unresolvable contentURI`);
  }
  log("pin", `${pin.cid} (${pin.size} bytes)`);

  /* ---------------------------------------------------------------- */
  /*  6. Publish                                                       */
  /* ---------------------------------------------------------------- */

  const account = privateKeyToAccount(
    requireEnv("PUBLISHER_PRIVATE_KEY") as `0x${string}`,
  );
  const wallet = createWalletClient({
    account,
    chain: giwaSepolia,
    transport: http(GIWA_RPC_FLASHBLOCKS, { timeout: 20_000, retryCount: 1 }),
  });

  log("publish", `sending from ${account.address}`);
  const hash = await wallet.writeContract({
    address: publisherAddress,
    abi: PUBLISHER_ABI,
    functionName: "publish",
    args: [issue.title, pin.uri, REWARD_PER_READER_WEI, pool],
  });

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 200,
    confirmations: 0,
    timeout: 120_000,
  });
  if (receipt.status !== "success") {
    die("publish", `transaction ${hash} reverted`);
  }

  log("publish", `published in block ${receipt.blockNumber}, tx ${hash}`);
  log("done", `https://sepolia-explorer.giwa.io/tx/${hash}`);
}

main().catch((error) => {
  die("cycle", error instanceof Error ? error.stack ?? error.message : String(error));
});
