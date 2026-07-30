import { describe, expect, it } from "vitest";
import { formatEth } from "@/lib/utils";

/**
 * The reward a reader is promised is 0.00003 ETH and gas is ~0.00000018 ETH.
 * An earlier `formatEth` floored anything under 0.0001 to "<0.0001 ETH", which
 * put a placeholder where the product's headline number should be — on the
 * feed, in the claim bar, and in the claim receipt. These pin the exact
 * strings so that never comes back.
 */
describe("formatEth", () => {
  it("shows a micro-reward exactly, not as a floor", () => {
    expect(formatEth("30000000000000")).toBe("0.00003 ETH");
    expect(formatEth("30000000000000")).not.toContain("<");
  });

  it("shows a gas-sized amount exactly", () => {
    expect(formatEth("180000000000")).toBe("0.00000018 ETH");
  });

  it("leaves ordinary treasury amounts on the requested precision", () => {
    expect(formatEth("2400000000000000")).toBe("0.0024 ETH");
    expect(formatEth("5980000000000000")).toBe("0.006 ETH");
    expect(formatEth("1000000000000000000")).toBe("1 ETH");
  });

  it("honours an explicit decimal count for larger values", () => {
    expect(formatEth("1234500000000000000", 2)).toBe("1.23 ETH");
  });

  it("handles the boundary and the extremes without producing '0 ETH'", () => {
    expect(formatEth("100000000000000")).toBe("0.0001 ETH"); // exactly 1e-4
    expect(formatEth("1")).toBe("0.000000000000000001 ETH"); // one wei
    expect(formatEth("0")).toBe("0 ETH");
  });
});
