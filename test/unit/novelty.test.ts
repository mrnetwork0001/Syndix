import { describe, it, expect } from "vitest";
import {
  assessNovelty,
  telemetrySnapshot,
  type TelemetrySnapshot,
} from "@/lib/novelty";
import type { ChainTelemetry } from "@/lib/telemetry";

/**
 * The gate exists to say no.
 *
 * Publishing when something happened is the easy half and mostly takes care of
 * itself. The half worth testing is refusal: an agent on a timer with nothing
 * to report will otherwise emit the same article daily with a new block number
 * in the headline, which is not false but is empty, and empty dressed as
 * reporting is the failure mode next door to the one lib/telemetry.ts fixed.
 */

const BASE: TelemetrySnapshot = {
  takenAt: "2026-08-17T20:00:00.000Z",
  blockNumber: "33653201",
  gasPriceWei: "1000265",
  articleCount: 11,
  uniqueReaders: 7,
  reservedRewardsWei: "2040000000000000",
  balanceWei: "5620000000000000",
  pendingStates: 28,
  sealedStates: 9,
  roundTripP50Ms: 356,
};

describe("assessNovelty", () => {
  it("refuses when only the head block advanced", () => {
    const later: TelemetrySnapshot = {
      ...BASE,
      takenAt: "2026-08-18T20:00:00.000Z",
      blockNumber: "33740000",
    };
    const v = assessNovelty(later, BASE);
    expect(v.publish).toBe(false);
    expect(v.reasons[0]).toContain("Nothing moved beyond noise");
  });

  it("refuses on gas jitter inside the drift threshold", () => {
    // The real spread across one afternoon of live runs was 1000264-1000268.
    const v = assessNovelty({ ...BASE, gasPriceWei: "1000268" }, BASE);
    expect(v.publish).toBe(false);
  });

  it("publishes when a reader was paid", () => {
    const v = assessNovelty({ ...BASE, uniqueReaders: 8 }, BASE);
    expect(v.publish).toBe(true);
    expect(v.reasons.join(" ")).toContain("Unique readers paid moved 7 to 8");
  });

  it("publishes when reserved rewards moved", () => {
    const v = assessNovelty(
      { ...BASE, reservedRewardsWei: "2010000000000000" },
      BASE,
    );
    expect(v.publish).toBe(true);
    expect(v.reasons.join(" ")).toContain("readers were paid");
  });

  it("publishes on a real gas move but not a small one", () => {
    expect(assessNovelty({ ...BASE, gasPriceWei: "1400000" }, BASE).publish).toBe(true);
    expect(assessNovelty({ ...BASE, gasPriceWei: "1100000" }, BASE).publish).toBe(false);
  });

  it("publishes on a latency regression but not an improvement", () => {
    expect(assessNovelty({ ...BASE, roundTripP50Ms: 900 }, BASE).publish).toBe(true);
    // Getting faster is good news for users and no news for readers.
    expect(assessNovelty({ ...BASE, roundTripP50Ms: 120 }, BASE).publish).toBe(false);
  });

  it("publishes on the first run, when there is nothing to compare against", () => {
    const v = assessNovelty(BASE, null);
    expect(v.publish).toBe(true);
    expect(v.firstRun).toBe(true);
  });

  it("does not treat a missing figure as a change", () => {
    // A failed treasury probe must not read as "readers went from 7 to none".
    const degraded: TelemetrySnapshot = {
      ...BASE,
      uniqueReaders: null,
      articleCount: null,
      reservedRewardsWei: null,
      balanceWei: null,
    };
    expect(assessNovelty(degraded, BASE).publish).toBe(false);
    expect(assessNovelty(BASE, degraded).publish).toBe(false);
  });
});

describe("telemetrySnapshot", () => {
  const EMPTY: ChainTelemetry = {
    takenAt: "2026-08-17T20:00:00.000Z",
    blockNumber: "33653201",
    gasPriceWei: "1000265",
    claimCostWei: "180360602632",
    latency: [],
    advance: [],
    treasury: null,
    errors: [],
  };

  it("records null for a freshness probe that dropped polls", () => {
    const snap = telemetrySnapshot({
      ...EMPTY,
      advance: [
        {
          label: "Flashblocks pending",
          endpoint: "https://sepolia-rpc-flashblocks.giwa.io",
          blockTag: "pending",
          distinctStates: 4,
          windowMs: 11_000,
          polls: 30,
          failures: 26,
        },
      ],
    });
    // An outage recorded as "4 states" would read next run as a collapse in
    // Flashblocks performance and trigger an article about nothing.
    expect(snap.pendingStates).toBeNull();
  });

  it("records null for a latency probe with too few samples", () => {
    const snap = telemetrySnapshot({
      ...EMPTY,
      latency: [
        {
          label: "Standard endpoint",
          endpoint: "https://sepolia-rpc.giwa.io",
          samples: 1,
          p50Ms: 3463,
          p95Ms: 3463,
          failures: 19,
        },
      ],
    });
    expect(snap.roundTripP50Ms).toBeNull();
  });
});
