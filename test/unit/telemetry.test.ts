import { describe, it, expect } from "vitest";
import { telemetryDigest, type ChainTelemetry } from "@/lib/telemetry";

/**
 * These guard one specific past defect.
 *
 * The agent once published "1,842 samples ... p50 187ms, p95 244ms" as a fresh
 * benchmark. Nothing had been measured; the figure came from hand-authored demo
 * content in lib/data/issues.ts that was being passed to the model as "signals
 * gathered this run". The model was obeying its instructions - the input lied.
 *
 * The fix is that the digest can only render fields that collectTelemetry
 * actually filled in. So the property worth testing is subtractive: when a
 * probe fails, its numbers must be ABSENT, because the model cannot cite what
 * it was never handed.
 */

const EMPTY: ChainTelemetry = {
  takenAt: "2026-01-01T00:00:00.000Z",
  blockNumber: null,
  gasPriceWei: null,
  claimCostWei: null,
  latency: [],
  advance: [],
  treasury: null,
  errors: ["head state: fetch failed"],
};

describe("telemetryDigest", () => {
  it("emits no figures at all when every probe failed", () => {
    const digest = telemetryDigest(EMPTY);
    expect(digest).toContain("Do not cite any figure");
    expect(digest).not.toMatch(/\d+ms/);
  });

  it("omits latency lines for a probe that returned no samples", () => {
    const digest = telemetryDigest({
      ...EMPTY,
      latency: [
        {
          label: "Flashblocks endpoint",
          endpoint: "https://example.invalid",
          samples: 0,
          p50Ms: 0,
          p95Ms: 0,
          failures: 20,
        },
      ],
    });
    // A zero-sample probe must not render as "p50 0ms" - that is a fabricated
    // measurement wearing the clothes of a real one.
    expect(digest).not.toContain("p50");
  });

  it("labels round-trip as network flight time, never as preconfirmation", () => {
    const digest = telemetryDigest({
      ...EMPTY,
      latency: [
        {
          label: "Flashblocks endpoint",
          endpoint: "https://sepolia-rpc-flashblocks.giwa.io",
          samples: 20,
          p50Ms: 348,
          p95Ms: 418,
          failures: 0,
        },
      ],
    });
    expect(digest).toContain("NOT preconfirmation latency");
  });

  it("marks a saturated freshness sample as a lower bound", () => {
    const digest = telemetryDigest({
      ...EMPTY,
      advance: [
        {
          label: "Flashblocks pending",
          endpoint: "https://sepolia-rpc-flashblocks.giwa.io",
          blockTag: "pending",
          distinctStates: 27,
          windowMs: 10_474,
          polls: 30,
          failures: 0,
        },
      ],
    });
    expect(digest).toContain("LOWER BOUND");
  });

  it("does not mark an unsaturated sample as a lower bound", () => {
    const digest = telemetryDigest({
      ...EMPTY,
      advance: [
        {
          label: "Standard sealed",
          endpoint: "https://sepolia-rpc.giwa.io",
          blockTag: "latest",
          distinctStates: 11,
          windowMs: 10_680,
          polls: 30,
          failures: 0,
        },
      ],
    });
    expect(digest).not.toContain("LOWER BOUND");
  });

  it("refuses percentiles from fewer than five samples", () => {
    const digest = telemetryDigest({
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
    // One surviving call out of twenty is an outage report, not a latency
    // distribution - a live run rendered it as "p50 3463ms" and the model
    // cited it as a comparative finding.
    expect(digest).not.toContain("3463");
    expect(digest).toContain("largely unresponsive");
  });

  it("suppresses the freshness head-to-head when one side dropped polls", () => {
    const healthy = {
      label: "Flashblocks pending",
      endpoint: "https://sepolia-rpc-flashblocks.giwa.io",
      blockTag: "pending" as const,
      distinctStates: 28,
      windowMs: 11_323,
      polls: 30,
      failures: 0,
    };
    const degraded = {
      label: "Standard sealed",
      endpoint: "https://sepolia-rpc.giwa.io",
      blockTag: "latest" as const,
      distinctStates: 4,
      windowMs: 13_868,
      polls: 30,
      failures: 12,
    };
    const digest = telemetryDigest({ ...EMPTY, advance: [healthy, degraded] });
    // 28-vs-4 during a partial outage measures the outage, not Flashblocks.
    expect(digest).not.toContain("real comparison");
    expect(digest).toContain("undercount");

    const both = telemetryDigest({
      ...EMPTY,
      advance: [healthy, { ...degraded, failures: 0, distinctStates: 9 }],
    });
    expect(both).toContain("real comparison");
  });

  it("reports a solvency violation instead of quietly printing the figures", () => {
    const digest = telemetryDigest({
      ...EMPTY,
      treasury: {
        articleCount: 10,
        uniqueReaders: 7,
        reservedRewardsWei: "9000",
        unreservedBalanceWei: "0",
        balanceWei: "1000",
        solvent: false,
      },
    });
    expect(digest).toContain("VIOLATED");
  });
});
