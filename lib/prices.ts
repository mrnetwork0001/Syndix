/**
 * Live ETH prices.
 *
 * These were hardcoded at ETH = $3,200 / ₩4,416,000, which overstated every
 * fiat figure in the app by around 67% once the real price moved. A reward
 * protocol that misreports what it pays is worse than one that shows no fiat
 * value at all, so the rates are fetched.
 *
 * Both pairs come from one request so USD and KRW can never disagree with each
 * other — deriving KRW from a separate USD/KRW feed let rounding drift between
 * the two figures shown side by side.
 */

export interface RatesSnapshot {
  ethUsd: number;
  ethKrw: number;
  /** ISO 8601. */
  fetchedAt: string;
  source: "coingecko" | "fallback";
}

/**
 * Used only when the price feed is unreachable. Deliberately labelled `fallback`
 * so the UI can say the figures are indicative rather than quietly presenting
 * them as live.
 */
export const FALLBACK_RATES: RatesSnapshot = {
  ethUsd: 1911,
  ethKrw: 2_760_000,
  fetchedAt: "1970-01-01T00:00:00.000Z",
  source: "fallback",
};

const PRICE_URL =
  "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd,krw";

const CACHE_TTL_MS = 10 * 60 * 1000;
let cached: { at: number; rates: RatesSnapshot } | null = null;

/** Server-side. Cached, and never throws — a failed fetch yields the fallback. */
export async function fetchRates(): Promise<RatesSnapshot> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.rates;

  try {
    const response = await fetch(PRICE_URL, {
      signal: AbortSignal.timeout(8_000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return FALLBACK_RATES;

    const body = (await response.json()) as {
      ethereum?: { usd?: number; krw?: number };
    };
    const ethUsd = body.ethereum?.usd;
    const ethKrw = body.ethereum?.krw;
    if (!ethUsd || !ethKrw || ethUsd <= 0 || ethKrw <= 0) return FALLBACK_RATES;

    const rates: RatesSnapshot = {
      ethUsd,
      ethKrw,
      fetchedAt: new Date().toISOString(),
      source: "coingecko",
    };
    cached = { at: Date.now(), rates };
    return rates;
  } catch {
    return FALLBACK_RATES;
  }
}

/* ------------------------------------------------------------------ */
/*  Ambient snapshot                                                   */
/* ------------------------------------------------------------------ */

/**
 * The rates the synchronous formatters in lib/utils.ts read.
 *
 * Module-level rather than threaded through 34 call sites as a parameter,
 * because the rate is a global fact rather than per-component state. The layout
 * fetches it once per render and hands the same snapshot to the client
 * provider, which installs it before anything paints — so server HTML and
 * client hydration format identical strings. Getting that wrong would show as
 * a hydration mismatch on every price on the page.
 */
let ambient: RatesSnapshot = FALLBACK_RATES;

export function setAmbientRates(rates: RatesSnapshot): void {
  ambient = rates;
}

export function getAmbientRates(): RatesSnapshot {
  return ambient;
}
