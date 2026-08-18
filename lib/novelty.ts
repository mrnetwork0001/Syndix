import { createPublicClient } from "viem";
import {
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  giwaSepolia,
  giwaServerTransport,
} from "./giwa";
import { syndixTreasuryAbi } from "./abi";
import { ipfsGatewayUrls } from "./ipfs";
import type { ChainTelemetry } from "./telemetry";

/**
 * Whether there is anything new enough to be worth publishing.
 *
 * WHY THIS EXISTS
 *
 * lib/telemetry.ts made every figure in an issue real. It did not make every
 * issue worth writing. Most of what it measures barely moves between runs -
 * gas sat between 1000264 and 1000268 wei across every run of one afternoon,
 * round-trip latency is geography and noise, and the freshness comparison is a
 * property of GIWA rather than news. On a daily timer the agent would emit the
 * same article with a different block number in the headline, which is the
 * failure mode immediately next door to the fabricated benchmark: not false,
 * just empty, and dressed as reporting.
 *
 * So publishing is gated on change rather than on the clock. The probe can run
 * as often as we like - it is cheap and nothing is written. An issue is only
 * produced when the chain actually did something.
 *
 * WHERE THE COMPARISON POINT COMES FROM
 *
 * Each issue pins the snapshot it was written from, so the previous state is
 * carried by the last issue itself. No file on a server, nothing to lose when
 * a box is reimaged, and anyone can fetch the same CID and check the diff we
 * claim to have acted on.
 */

/** The comparable subset of a run's telemetry. Small on purpose - it is pinned. */
export interface TelemetrySnapshot {
  takenAt: string;
  blockNumber: string | null;
  gasPriceWei: string | null;
  articleCount: number | null;
  uniqueReaders: number | null;
  reservedRewardsWei: string | null;
  balanceWei: string | null;
  /** Distinct states seen on the pending tag, or null if the probe was unusable. */
  pendingStates: number | null;
  sealedStates: number | null;
  roundTripP50Ms: number | null;
}

export interface NoveltyVerdict {
  publish: boolean;
  /** Human-readable reasons, in the order they were found. */
  reasons: string[];
  /** Set when there is no previous snapshot to compare against. */
  firstRun: boolean;
}

/** Gas has to move by more than this to count as news rather than jitter. */
const GAS_DRIFT_RATIO = 0.25;

/** Round-trip has to at least double before it is a regression worth reporting. */
const LATENCY_REGRESSION_RATIO = 2;

/**
 * Freshness is a ratio of two counts, both of which are floors under
 * saturation. Requiring a large swing keeps sampling noise out of the feed.
 */
const FRESHNESS_DRIFT_RATIO = 0.4;

export function telemetrySnapshot(t: ChainTelemetry): TelemetrySnapshot {
  const [fb, std] = t.advance;
  // Only usable samples become a snapshot value. A degraded probe records null
  // rather than a low number, otherwise the next run reads an outage as a
  // dramatic change and publishes about nothing.
  const usable = (a: (typeof t.advance)[number] | undefined) =>
    a && a.polls > 0 && a.failures <= a.polls * 0.2 ? a.distinctStates : null;

  const firstLatency = t.latency.find((l) => l.samples >= 5);

  return {
    takenAt: t.takenAt,
    blockNumber: t.blockNumber,
    gasPriceWei: t.gasPriceWei,
    articleCount: t.treasury?.articleCount ?? null,
    uniqueReaders: t.treasury?.uniqueReaders ?? null,
    reservedRewardsWei: t.treasury?.reservedRewardsWei ?? null,
    balanceWei: t.treasury?.balanceWei ?? null,
    pendingStates: usable(fb),
    sealedStates: usable(std),
    roundTripP50Ms: firstLatency?.p50Ms ?? null,
  };
}

/**
 * Reads the snapshot the most recent issue was written from.
 *
 * Returns null when there is no previous issue, when it predates snapshots, or
 * when its CID cannot be fetched. Every one of those is "cannot compare", which
 * the caller treats as permission to publish - refusing to publish because we
 * could not read our own history would be a strange way to fail.
 */
export async function readLastSnapshot(): Promise<TelemetrySnapshot | null> {
  if (SYNDIX_CONTRACTS.treasury === ZERO_ADDRESS) return null;
  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: giwaServerTransport(),
    });
    const base = {
      address: SYNDIX_CONTRACTS.treasury,
      abi: syndixTreasuryAbi,
    } as const;

    const count = await client.readContract({
      ...base,
      functionName: "articleCount",
    });
    if (count === 0n) return null;

    const article = await client.readContract({
      ...base,
      functionName: "articles",
      args: [count],
    });
    // Tuple order matches the Article struct: id, title, contentURI, ...
    const contentURI = (article as unknown as unknown[])[2] as string;
    if (typeof contentURI !== "string" || !contentURI.startsWith("ipfs://")) {
      return null;
    }

    for (const url of ipfsGatewayUrls(contentURI)) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(8_000),
          headers: { accept: "application/json" },
        });
        if (!response.ok) continue;
        const body = (await response.json()) as { telemetry?: TelemetrySnapshot };
        if (body.telemetry && typeof body.telemetry === "object") {
          return body.telemetry;
        }
        // Fetched fine but predates snapshots - no point trying another gateway
        // for the same bytes.
        return null;
      } catch {
        // Try the next gateway.
      }
    }
    return null;
  } catch {
    return null;
  }
}

function ratioChanged(a: number, b: number, threshold: number): boolean {
  if (a === 0 && b === 0) return false;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return Math.abs(a - b) / base > threshold;
}

/**
 * Decides whether this run has news.
 *
 * Reader activity and treasury movement always qualify: those are the protocol
 * doing the thing it exists to do. Infrastructure figures only qualify on a
 * large swing, because small ones are noise and reporting noise as a finding is
 * how a feed becomes worthless.
 *
 * A head block that advanced is deliberately NOT a reason. It advances every
 * second no matter what happens, so treating it as news would make the gate
 * always open and this whole file decorative.
 */
export function assessNovelty(
  current: TelemetrySnapshot,
  previous: TelemetrySnapshot | null,
): NoveltyVerdict {
  if (!previous) {
    return {
      publish: true,
      firstRun: true,
      reasons: ["No previous snapshot to compare against - publishing."],
    };
  }

  const reasons: string[] = [];

  if (
    current.uniqueReaders !== null &&
    previous.uniqueReaders !== null &&
    current.uniqueReaders !== previous.uniqueReaders
  ) {
    reasons.push(
      `Unique readers paid moved ${previous.uniqueReaders} to ${current.uniqueReaders}.`,
    );
  }

  if (
    current.articleCount !== null &&
    previous.articleCount !== null &&
    current.articleCount !== previous.articleCount
  ) {
    reasons.push(
      `Articles published moved ${previous.articleCount} to ${current.articleCount}.`,
    );
  }

  if (
    current.reservedRewardsWei !== null &&
    previous.reservedRewardsWei !== null &&
    current.reservedRewardsWei !== previous.reservedRewardsWei
  ) {
    reasons.push(
      `Reserved rewards moved ${previous.reservedRewardsWei} to ${current.reservedRewardsWei} wei - readers were paid or a pool was funded.`,
    );
  }

  if (
    current.balanceWei !== null &&
    previous.balanceWei !== null &&
    current.balanceWei !== previous.balanceWei
  ) {
    reasons.push(
      `Treasury balance moved ${previous.balanceWei} to ${current.balanceWei} wei.`,
    );
  }

  if (current.gasPriceWei !== null && previous.gasPriceWei !== null) {
    const now = Number(current.gasPriceWei);
    const then = Number(previous.gasPriceWei);
    if (ratioChanged(now, then, GAS_DRIFT_RATIO)) {
      reasons.push(
        `Gas price moved ${previous.gasPriceWei} to ${current.gasPriceWei} wei, past the ${GAS_DRIFT_RATIO * 100}% drift threshold.`,
      );
    }
  }

  if (
    current.roundTripP50Ms !== null &&
    previous.roundTripP50Ms !== null &&
    previous.roundTripP50Ms > 0 &&
    current.roundTripP50Ms / previous.roundTripP50Ms >= LATENCY_REGRESSION_RATIO
  ) {
    reasons.push(
      `Round-trip p50 went ${previous.roundTripP50Ms}ms to ${current.roundTripP50Ms}ms - at least a ${LATENCY_REGRESSION_RATIO}x regression.`,
    );
  }

  const ratio = (s: TelemetrySnapshot) =>
    s.pendingStates !== null && s.sealedStates !== null && s.sealedStates > 0
      ? s.pendingStates / s.sealedStates
      : null;
  const nowRatio = ratio(current);
  const thenRatio = ratio(previous);
  if (
    nowRatio !== null &&
    thenRatio !== null &&
    ratioChanged(nowRatio, thenRatio, FRESHNESS_DRIFT_RATIO)
  ) {
    reasons.push(
      `Flashblocks freshness advantage moved ${thenRatio.toFixed(1)}x to ${nowRatio.toFixed(1)}x.`,
    );
  }

  return {
    publish: reasons.length > 0,
    firstRun: false,
    reasons:
      reasons.length > 0
        ? reasons
        : [
            "Nothing moved beyond noise since the last issue. Head block advances every second and is not news on its own.",
          ],
  };
}
