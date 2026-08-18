import { createPublicClient, http } from "viem";
import {
  GIWA_RPC_FLASHBLOCKS,
  GIWA_RPC_HTTP,
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  giwaSepolia,
} from "./giwa";
import { syndixTreasuryAbi } from "./abi";

/**
 * Measurements the agent is allowed to write about.
 *
 * WHY THIS EXISTS
 *
 * The pipeline used to hand the model signals lifted from `lib/data/issues.ts` -
 * hand-authored demo content from months ago. One of them read "1,842 samples of
 * eth_getBlockByNumber('pending') from a single Seoul host: p50 187ms, p95
 * 244ms". The model did exactly what it was told, treated that as a signal
 * gathered this run, and wrote it up as a fresh benchmark. Nobody had measured
 * anything.
 *
 * The system prompt already forbade inventing figures, and the model obeyed it.
 * The defect was that the signals themselves were fiction, so obedience was not
 * enough. A number reaches an issue only if it was measured here, in this file,
 * this run.
 *
 * Everything below is sampled or read from chain at call time. Nothing is
 * remembered between runs and nothing is seeded.
 */

export interface LatencySample {
  label: string;
  endpoint: string;
  samples: number;
  p50Ms: number;
  p95Ms: number;
  failures: number;
}

export interface ChainTelemetry {
  takenAt: string;
  blockNumber: string | null;
  gasPriceWei: string | null;
  /** Cost of a claim at the gas price measured this run. */
  claimCostWei: string | null;
  latency: LatencySample[];
  advance: AdvanceSample[];
  treasury: {
    articleCount: number;
    uniqueReaders: number;
    reservedRewardsWei: string;
    unreservedBalanceWei: string;
    balanceWei: string;
    solvent: boolean;
  } | null;
  errors: string[];
}

/** Measured gas for `claimReaderReward`, from an actual settled claim. */
const CLAIM_GAS = 180_313n;

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return Math.round(sorted[index]);
}

/**
 * Times repeated reads against one endpoint.
 *
 * This is ROUND-TRIP time from wherever this process runs to the RPC host. It
 * is dominated by geography, so it is roughly equal for both endpoints and says
 * nothing about preconfirmation speed - see `sampleAdvance` for that. The
 * distinction matters: a first run of this file measured 352ms against
 * Flashblocks and 349ms against the standard RPC, and reporting that as a
 * Flashblocks benchmark would have been the same fabrication in a new costume.
 *
 * Sequential on purpose: firing them in parallel would measure how well the
 * host handles concurrency, not how long a request takes.
 */
async function sampleEndpoint(
  label: string,
  endpoint: string,
  blockTag: "latest" | "pending",
  samples: number,
): Promise<LatencySample> {
  const durations: number[] = [];
  let failures = 0;

  for (let i = 0; i < samples; i++) {
    const started = performance.now();
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: i,
          method: "eth_getBlockByNumber",
          params: [blockTag, false],
        }),
        signal: AbortSignal.timeout(8_000),
      });
      await response.json();
      if (!response.ok) failures++;
      else durations.push(performance.now() - started);
    } catch {
      failures++;
    }
  }

  const sorted = [...durations].sort((a, b) => a - b);
  return {
    label,
    endpoint,
    samples: durations.length,
    p50Ms: percentile(sorted, 50),
    p95Ms: percentile(sorted, 95),
    failures,
  };
}

export interface AdvanceSample {
  label: string;
  endpoint: string;
  blockTag: "latest" | "pending";
  /** Distinct chain states seen inside the window. */
  distinctStates: number;
  windowMs: number;
  polls: number;
  failures: number;
}

/**
 * Counts how often a block tag actually changes.
 *
 * THIS is what Flashblocks changes. A GIWA block seals about once a second, so
 * `latest` advances at roughly 1Hz no matter how fast the network is. The
 * `pending` tag on the Flashblocks endpoint is rebuilt every ~200ms as each
 * flashblock lands, so the same window should contain several times as many
 * distinct states. Round-trip latency cannot show this; state count can.
 *
 * A state signature is (block number, transaction count, state root). Two polls
 * that return the same tuple observed the same state, whenever they arrived.
 *
 * Polls are staggered rather than sequential. Round trip here is ~350ms, so a
 * sequential loop could not resolve a 200ms cadence at all - it would sample
 * more slowly than the thing it is measuring and report a flat line. Each poll
 * is an independent observation of chain state, so overlapping them costs
 * nothing in correctness; what it must not do is get read as a throughput
 * figure, which is why only distinct-state count is reported.
 */
async function sampleAdvance(
  label: string,
  endpoint: string,
  blockTag: "latest" | "pending",
  windowMs: number,
  pollEveryMs: number,
): Promise<AdvanceSample> {
  const seen = new Set<string>();
  let failures = 0;
  let polls = 0;

  const inFlight: Promise<void>[] = [];
  const started = performance.now();

  while (performance.now() - started < windowMs) {
    polls++;
    inFlight.push(
      (async () => {
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: polls,
              method: "eth_getBlockByNumber",
              params: [blockTag, false],
            }),
            signal: AbortSignal.timeout(8_000),
          });
          const body = await response.json();
          const block = body?.result;
          if (!block) {
            failures++;
            return;
          }
          seen.add(
            `${block.number}:${block.transactions?.length ?? 0}:${block.stateRoot ?? ""}`,
          );
        } catch {
          failures++;
        }
      })(),
    );
    await new Promise((r) => setTimeout(r, pollEveryMs));
  }

  await Promise.all(inFlight);

  return {
    label,
    endpoint,
    blockTag,
    distinctStates: seen.size,
    windowMs: Math.round(performance.now() - started),
    polls,
    failures,
  };
}

/**
 * Gathers everything the agent may cite this run.
 *
 * Never throws: a failed probe is recorded in `errors` and simply absent from
 * the digest, so the model has nothing to cite rather than something wrong.
 */
export async function collectTelemetry(
  samplesPerEndpoint = 20,
): Promise<ChainTelemetry> {
  const errors: string[] = [];
  const takenAt = new Date().toISOString();

  let blockNumber: bigint | null = null;
  let gasPriceWei: bigint | null = null;
  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_FLASHBLOCKS, { timeout: 8_000, retryCount: 1 }),
    });
    [blockNumber, gasPriceWei] = await Promise.all([
      client.getBlockNumber(),
      client.getGasPrice(),
    ]);
  } catch (error) {
    errors.push(`head state: ${error instanceof Error ? error.message : error}`);
  }

  // Both endpoints, same method, same sample count - otherwise the comparison
  // is not a comparison.
  const latency: LatencySample[] = [];
  try {
    latency.push(
      await sampleEndpoint(
        "Flashblocks endpoint",
        GIWA_RPC_FLASHBLOCKS,
        "pending",
        samplesPerEndpoint,
      ),
      await sampleEndpoint(
        "Standard endpoint",
        GIWA_RPC_HTTP,
        "latest",
        samplesPerEndpoint,
      ),
    );
  } catch (error) {
    errors.push(`latency: ${error instanceof Error ? error.message : error}`);
  }

  // The comparison that actually means something. Same window, same poll rate,
  // so the only variable is how fast each tag is rebuilt.
  const advance: AdvanceSample[] = [];
  try {
    advance.push(
      await sampleAdvance(
        "Flashblocks pending",
        GIWA_RPC_FLASHBLOCKS,
        "pending",
        6_000,
        200,
      ),
      await sampleAdvance(
        "Standard sealed",
        GIWA_RPC_HTTP,
        "latest",
        6_000,
        200,
      ),
    );
  } catch (error) {
    errors.push(`advance: ${error instanceof Error ? error.message : error}`);
  }

  let treasury: ChainTelemetry["treasury"] = null;
  if (SYNDIX_CONTRACTS.treasury !== ZERO_ADDRESS) {
    try {
      // The flashblocks host serves plain eth_call too, and during this file's
      // shakedown it stayed up through a slow patch that had the standard RPC
      // timing out 19 of 20 requests. State reads go to the reliable door.
      const client = createPublicClient({
        chain: giwaSepolia,
        transport: http(GIWA_RPC_FLASHBLOCKS, { timeout: 15_000, retryCount: 2 }),
      });
      // Called out individually rather than through a helper: a generic
      // wrapper widens `functionName` to string and loses the ABI's literal
      // union, which is the type safety worth keeping here.
      const base = {
        address: SYNDIX_CONTRACTS.treasury,
        abi: syndixTreasuryAbi,
      } as const;

      const [articleCount, uniqueReaders, reserved, unreserved, balance] =
        await Promise.all([
          client.readContract({ ...base, functionName: "articleCount" }),
          client.readContract({ ...base, functionName: "uniqueReaders" }),
          client.readContract({ ...base, functionName: "reservedRewards" }),
          client.readContract({ ...base, functionName: "unreservedBalance" }),
          client.getBalance({ address: SYNDIX_CONTRACTS.treasury }),
        ]);

      treasury = {
        articleCount: Number(articleCount),
        uniqueReaders: Number(uniqueReaders),
        reservedRewardsWei: reserved.toString(),
        unreservedBalanceWei: unreserved.toString(),
        balanceWei: balance.toString(),
        // Compared, not assumed. This is the invariant the contract exists to
        // hold, so the one place it must never be hardcoded is the file whose
        // whole purpose is to stop unmeasured claims reaching print.
        solvent: balance >= reserved,
      };
    } catch (error) {
      errors.push(`treasury: ${error instanceof Error ? error.message : error}`);
    }
  }

  return {
    takenAt,
    blockNumber: blockNumber?.toString() ?? null,
    gasPriceWei: gasPriceWei?.toString() ?? null,
    claimCostWei: gasPriceWei ? (CLAIM_GAS * gasPriceWei).toString() : null,
    latency,
    advance,
    treasury,
    errors,
  };
}

/**
 * Renders telemetry as the signal list handed to the model.
 *
 * Every line here is something measured this run. If a probe failed, its line is
 * absent - the model cannot cite what it was never given, which is the whole
 * mechanism preventing a repeat of the fabricated benchmark.
 */
export function telemetryDigest(t: ChainTelemetry): string {
  const lines: string[] = [];

  if (t.blockNumber) {
    lines.push(
      `- [chain] GIWA Sepolia head: block ${t.blockNumber}, measured ${t.takenAt}`,
    );
  }
  if (t.gasPriceWei) {
    lines.push(`- [chain] Gas price: ${t.gasPriceWei} wei`);
  }
  if (t.claimCostWei) {
    lines.push(
      `- [chain] A reader claim costs ${CLAIM_GAS} gas = ${t.claimCostWei} wei at that price`,
    );
  }
  for (const l of t.latency) {
    if (l.samples === 0) continue;
    // A percentile needs a distribution. During one live run the standard RPC
    // hit a slow patch, 19 of 20 calls timed out, and the single survivor was
    // rendered as "p50 3463ms" - which the model then cited as a comparative
    // finding. One number is an anecdote; report it as exactly that.
    if (l.samples < 5) {
      lines.push(
        `- [round-trip] ${l.label}: only ${l.samples} of ${l.samples + l.failures} calls succeeded (${l.failures} timed out or failed). Too few samples for percentiles - report only that the endpoint was largely unresponsive from this host during the window. Do not cite a latency figure for it or compare it against the other endpoint.`,
      );
      continue;
    }
    // Explicitly labelled round-trip. Both endpoints sit in the same place, so
    // these two numbers should come out near-identical; that is the expected
    // result, not a finding, and the wording has to stop anyone reporting a
    // few milliseconds of noise as a performance difference.
    lines.push(
      `- [round-trip] ${l.label}: p50 ${l.p50Ms}ms, p95 ${l.p95Ms}ms across ${l.samples} sequential eth_getBlockByNumber calls from this run's host. This is network flight time to the RPC, dominated by distance to Seoul. It is NOT preconfirmation latency and must not be described as one; the two endpoints are expected to match here. NEVER compare this figure against the documented 200ms preconfirmation number - they measure different things, and a round-trip that happens to land under 200ms says nothing whatsoever about whether preconfirmations met their target.`,
    );
  }
  for (const a of t.advance) {
    if (a.polls === 0) continue;
    // When nearly every poll returns something new, the tag is changing at
    // least as fast as we can look at it, so the count is a floor rather than a
    // rate. Saying so is the difference between a measurement and an overclaim.
    const saturated = a.distinctStates >= a.polls * 0.8;
    const degraded = a.failures > a.polls * 0.2;
    lines.push(
      `- [freshness] ${a.label} (${a.blockTag} tag): ${a.distinctStates} distinct chain states observed in ${a.windowMs}ms across ${a.polls} polls${a.failures ? `, ${a.failures} failed` : ""}. A state is (block number, tx count, state root).${saturated ? " NOTE: nearly every poll saw a new state, so this is a LOWER BOUND - the tag changes at least this often and probably faster. Cite it as \"at least N\", never as an exact rate." : ""}${degraded ? " CAUTION: a large share of polls failed, so this count is an undercount of unknown size. It may be mentioned only alongside its failure count and never as a rate." : ""}`,
    );
  }
  const [fb, std] = t.advance;
  const clean = (a: AdvanceSample) => a.polls > 0 && a.failures <= a.polls * 0.2;
  // The head-to-head renders only when both sides sampled cleanly. Comparing a
  // healthy endpoint against one that was dropping polls does not measure
  // Flashblocks; it measures the outage.
  if (fb && std && std.distinctStates > 0 && clean(fb) && clean(std)) {
    lines.push(
      `- [freshness] Over the same window the pending tag produced ${fb.distinctStates} states to the sealed tag's ${std.distinctStates}. This is the only latency comparison in this list that is a real comparison.`,
    );
  }
  if (t.treasury) {
    lines.push(
      `- [treasury] ${t.treasury.articleCount} articles published, ${t.treasury.uniqueReaders} unique readers paid`,
      `- [treasury] Balance ${t.treasury.balanceWei} wei; ${t.treasury.reservedRewardsWei} wei reserved for readers and unreachable by the owner; ${t.treasury.unreservedBalanceWei} wei unreserved`,
      `- [treasury] Solvency invariant (balance >= reserved) checked against those two figures: ${t.treasury.solvent ? "holds" : "VIOLATED - do not publish, report the failure"}`,
    );
  }

  if (lines.length > 0) {
    // Not a measurement - GIWA's own published spec, included so the model has
    // the context without smuggling it in from training data unattributed. A
    // first live run cited "up to 200ms" from its own knowledge in violation of
    // the only-listed-figures rule; the honest fix is to list it, labelled.
    lines.push(
      `- [documented] GIWA's documentation states Flashblocks preconfirmations arrive in up to 200ms. This is GIWA's published claim, not something measured this run - cite it only with that attribution, e.g. "GIWA documents up to 200ms". Nothing in this run measures preconfirmation latency, so you may NOT conclude that the figure was met, missed, or "operated within". State it as context and move on.`,
    );
  }

  return lines.length > 0
    ? lines.join("\n")
    : "- No signals could be measured this run. Do not cite any figure.";
}
