import { beforeEach, describe, expect, it } from "vitest";
import {
  FALLBACK_RATES,
  getAmbientRates,
  setAmbientRates,
} from "@/lib/prices";
import { formatKrw, formatUsd, weiToKrw, weiToUsd } from "@/lib/utils";

/**
 * The FX rate was hardcoded at ETH = $3,200 while the real price was ~$1,911,
 * overstating every fiat figure in the app by about 67%. These pin the
 * conversion to whatever snapshot is installed, so a stale constant cannot
 * creep back in unnoticed.
 */

const ONE_ETH = 10n ** 18n;
const REWARD_WEI = "30000000000000"; // 0.00003 ETH, the per-reader reward

describe("fiat conversion", () => {
  beforeEach(() => {
    setAmbientRates({
      ethUsd: 2000,
      ethKrw: 2_800_000,
      fetchedAt: "2026-07-30T00:00:00.000Z",
      source: "coingecko",
    });
  });

  it("converts a whole ETH at the installed rate", () => {
    expect(weiToUsd(ONE_ETH)).toBeCloseTo(2000, 6);
    expect(weiToKrw(ONE_ETH)).toBeCloseTo(2_800_000, 6);
  });

  it("derives KRW from its own feed, not from USD times a guess", () => {
    // 2_800_000 / 2000 = 1400. If KRW were derived through a hardcoded
    // USD->KRW constant this would drift as soon as either rate moved.
    expect(weiToKrw(ONE_ETH) / weiToUsd(ONE_ETH)).toBeCloseTo(1400, 6);
  });

  it("prices the reader reward from live rates", () => {
    // 0.00003 ETH at $2000 is $0.06 — not the $0.10 the old constant implied.
    expect(weiToUsd(REWARD_WEI)).toBeCloseTo(0.06, 6);
    expect(weiToKrw(REWARD_WEI)).toBeCloseTo(84, 6);
    expect(formatUsd(REWARD_WEI)).toBe("$0.06");
    expect(formatKrw(REWARD_WEI)).toBe("₩84");
  });

  it("tracks a rate change instead of caching the first one", () => {
    const before = weiToUsd(ONE_ETH);
    setAmbientRates({
      ethUsd: 4000,
      ethKrw: 5_600_000,
      fetchedAt: "2026-07-30T01:00:00.000Z",
      source: "coingecko",
    });
    expect(weiToUsd(ONE_ETH)).toBeCloseTo(before * 2, 6);
  });

  it("shows sub-won amounts rather than rounding them to zero", () => {
    // A dust amount used to render as "₩0", which reads as broken.
    const dust = "100000000"; // 1e8 wei
    expect(weiToKrw(dust)).toBeLessThan(1);
    expect(formatKrw(dust)).not.toBe("₩0");
    expect(formatKrw(dust)).toMatch(/^₩0\.\d{2}$/);
  });

  it("labels the fallback so the UI can avoid calling it live", () => {
    setAmbientRates(FALLBACK_RATES);
    expect(getAmbientRates().source).toBe("fallback");
    expect(FALLBACK_RATES.ethUsd).toBeGreaterThan(0);
    expect(FALLBACK_RATES.ethKrw).toBeGreaterThan(0);
  });
});
