import { describe, expect, it } from "vitest";
import { isValidUpId, normalizeUpId } from "@/lib/giwa";
import { ISSUES } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";

/**
 * Guards on the project's own honesty rule, which is otherwise enforced only by
 * remembering to care.
 */
describe("dataset integrity", () => {
  it("has no placeholder or repeated mint transaction hashes", () => {
    const hashes = ISSUES.map((i) => i.mintTxHash).filter(Boolean) as string[];
    expect(hashes.length).toBeGreaterThan(0);
    for (const hash of hashes) {
      expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
      // A hash of all one character is the classic fabricated placeholder.
      expect(new Set(hash.slice(2)).size).toBeGreaterThan(4);
    }
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it("only attaches a mint hash to a published issue", () => {
    for (const issue of ISSUES) {
      if (issue.mintTxHash) expect(issue.status).toBe("published");
      if (issue.status !== "published") expect(issue.mintTxHash).toBeUndefined();
    }
  });

  it("never claims more reward than a pool can fund", () => {
    for (const issue of ISSUES) {
      const pool = BigInt(issue.rewardPoolWei);
      const per = BigInt(issue.rewardPerReaderWei);
      expect(per).toBeGreaterThan(0n);
      expect(BigInt(issue.claimedCount) * per).toBeLessThanOrEqual(pool);
    }
  });

  it("keeps reserved rewards within the treasury balance", () => {
    expect(BigInt(PROTOCOL_STATS.reservedRewardsWei)).toBeLessThanOrEqual(
      BigInt(PROTOCOL_STATS.treasuryBalanceWei),
    );
  });

  it("never attributes a seeded issue to a model or a generation run", () => {
    for (const issue of ISSUES) {
      const gen = issue.generation;
      if (gen.provenance !== "editorial-seed") continue;
      // These issues were written by hand. Reporting a model, a token count or
      // a dollar cost for them is inventing telemetry.
      expect(gen.costUsd, `issue ${issue.id} claims a cost`).toBe(0);
      expect(gen.inputTokens, `issue ${issue.id} claims input tokens`).toBe(0);
      expect(gen.outputTokens, `issue ${issue.id} claims output tokens`).toBe(0);
      expect(gen.latencyMs, `issue ${issue.id} claims a latency`).toBe(0);
      expect(gen.model).toBe("editorial-seed");
    }
  });

  it("names no model that is not actually used, anywhere in the dataset", () => {
    const retired = [/claude-opus/i, /anthropic/i, /syndix-diffusion/i];
    for (const issue of ISSUES) {
      const haystack = `${issue.body} ${JSON.stringify(issue.generation)}`;
      for (const pattern of retired) {
        expect(
          pattern.test(haystack),
          `issue ${issue.id} still references ${pattern}`,
        ).toBe(false);
      }
    }
  });

  it("never writes the giwa.id namespace, which does not exist", () => {
    for (const issue of ISSUES) {
      const offenders = issue.body.match(/[a-z0-9]+\.giwa\.id/g) ?? [];
      expect(offenders, `issue ${issue.id} references a giwa.id name`).toEqual([]);
    }
  });
});

describe("up.id handling", () => {
  it("normalises bare names and strips a leading @", () => {
    expect(normalizeUpId("alice")).toBe("alice.up.id");
    expect(normalizeUpId("alice.up.id")).toBe("alice.up.id");
    expect(normalizeUpId("@Alice")).toBe("alice.up.id");
    expect(normalizeUpId("  BOB  ")).toBe("bob.up.id");
  });

  it("returns empty for empty input instead of a bare suffix", () => {
    expect(normalizeUpId("")).toBe("");
    expect(normalizeUpId("   ")).toBe("");
  });

  it("rejects names the registry would refuse", () => {
    expect(isValidUpId("ab.up.id")).toBe(false); // too short
    expect(isValidUpId("-lead.up.id")).toBe(false); // leading hyphen
    expect(isValidUpId("has space.up.id")).toBe(false);
    expect(isValidUpId("alice.giwa.id")).toBe(false);
    expect(isValidUpId("alice.up.id")).toBe(true);
  });
});
