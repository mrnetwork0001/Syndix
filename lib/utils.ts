import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatEther } from "viem";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/* ------------------------------------------------------------------ */
/*  Money                                                              */
/* ------------------------------------------------------------------ */

/**
 * Demo FX rates. A production deployment reads ETH/KRW from the Upbit Oracle
 * on GIWA rather than hard-coding — see docs.giwa.io/giwa-ecosystem/upbit-oracle.
 */
export const ETH_USD = 3200;
export const USD_KRW = 1380;

export function weiToEth(wei: string | bigint): number {
  return Number(formatEther(typeof wei === "string" ? BigInt(wei) : wei));
}

export function formatEth(wei: string | bigint, dp = 4): string {
  const eth = weiToEth(wei);
  if (eth === 0) return "0 ETH";
  if (eth < 0.0001) return "<0.0001 ETH";
  return `${eth.toFixed(dp).replace(/\.?0+$/, "")} ETH`;
}

export function weiToUsd(wei: string | bigint): number {
  return weiToEth(wei) * ETH_USD;
}

export function formatUsd(wei: string | bigint): string {
  const usd = weiToUsd(wei);
  if (usd < 0.01 && usd > 0) return "<$0.01";
  return usd.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: usd < 100 ? 2 : 0,
  });
}

export function formatKrw(wei: string | bigint): string {
  const krw = weiToUsd(wei) * USD_KRW;
  return `₩${Math.round(krw).toLocaleString("ko-KR")}`;
}

/** Compact display used on stat tiles: "12.4K", "1.8M". */
export function compact(n: number): string {
  return Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

export function formatInt(n: number): string {
  return n.toLocaleString("en-US");
}

export function formatPct(n: number, dp = 0): string {
  return `${n.toFixed(dp)}%`;
}

/* ------------------------------------------------------------------ */
/*  Time                                                               */
/* ------------------------------------------------------------------ */

/**
 * Deterministic relative time. Takes `now` explicitly so server and client
 * renders agree — passing Date.now() implicitly is the classic source of
 * React hydration mismatches on timestamps.
 */
export function relativeTime(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const diff = Math.max(0, now - then);
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export function formatMs(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/* ------------------------------------------------------------------ */
/*  Misc                                                               */
/* ------------------------------------------------------------------ */

export function shortHash(hash?: string): string {
  if (!hash) return "—";
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`;
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Small deterministic PRNG (mulberry32) seeded from a string. Used for cover
 * art and simulated telemetry so every render — server or client — is stable.
 */
export function seededRandom(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
