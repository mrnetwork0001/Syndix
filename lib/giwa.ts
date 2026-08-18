import { defineChain, fallback, http } from "viem";

/**
 * GIWA Sepolia - the OP Stack L2 operated by Dunamu / Upbit.
 *
 * Verified against https://docs.giwa.io/get-started/connect-to-giwa
 *   Chain ID ........ 91342   (NOT 919 - that value is a common mis-quote)
 *   L1 .............. Ethereum Sepolia (11155111)
 *   Block time ...... ~1s, with <=200ms Flashblock preconfirmations
 *   Mainnet ......... still under development as of this build
 */
export const GIWA_SEPOLIA_ID = 91342 as const;

export const GIWA_RPC_HTTP = "https://sepolia-rpc.giwa.io";

/**
 * Flashblocks-aware RPC. Serves preconfirmed state under the `pending` block
 * tag roughly 5x faster than a sealed block. Syndix reads reward-claim
 * receipts from here so the UI can confirm in ~200ms instead of ~1s.
 */
export const GIWA_RPC_FLASHBLOCKS = "https://sepolia-rpc-flashblocks.giwa.io";

export const GIWA_EXPLORER = "https://sepolia-explorer.giwa.io";

/**
 * Transport for server-side reads: try the standard RPC, fail over to the
 * flashblocks host.
 *
 * Both hosts serve the full RPC surface; the flashblocks one additionally
 * serves preconfirmed `pending` state. On 2026-08-17 the standard RPC spent
 * over an hour timing out every eth_call while the flashblocks host answered
 * the same calls in under a second - and because every server-side reader
 * pinned itself to the one degraded endpoint, the whole app read as offline
 * while a working door stood open next to it.
 *
 * Standard stays first: it is the documented default, and the ranked fallback
 * only pays the failover cost while it is actually down. The short first-try
 * timeout is the point - failing over at 6s beats being "honest but dead" for
 * 25s. Callers needing getLogs keep their own longer timeouts via opts.
 */
export function giwaServerTransport(opts?: { timeout?: number }) {
  const timeout = opts?.timeout ?? 6_000;
  // retryCount 0 everywhere: the failover IS the retry. With fallback's
  // default of 3 whole-chain retries on top of per-transport retries, one
  // logical read could emit a dozen physical requests - and under RPC
  // congestion that amplification fed a request queue that outgrew the
  // node's recovery and wedged the process permanently.
  return fallback(
    [
      http(GIWA_RPC_HTTP, { timeout, retryCount: 0 }),
      http(GIWA_RPC_FLASHBLOCKS, { timeout: Math.max(timeout, 10_000), retryCount: 0 }),
    ],
    { rank: false, retryCount: 0 },
  );
}

export const giwaSepolia = defineChain({
  id: GIWA_SEPOLIA_ID,
  name: "GIWA Sepolia",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: {
    default: { http: [GIWA_RPC_HTTP] },
    flashblocks: { http: [GIWA_RPC_FLASHBLOCKS] },
  },
  blockExplorers: {
    default: { name: "GIWA Explorer", url: GIWA_EXPLORER },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
      blockCreated: 0,
    },
  },
  testnet: true,
});

/**
 * Contracts predeployed on GIWA at genesis, plus the L1 Sepolia bridge set.
 * Sourced from https://docs.giwa.io/network-information/contracts
 */
export const GIWA_PREDEPLOYS = {
  /** Standard ERC-4337 v0.7 EntryPoint - how Syndix sponsors gasless claims. */
  entryPointV07: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  entryPointV06: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
  /** Ethereum Attestation Service - backs Dojang proof-of-read attestations. */
  eas: "0x4200000000000000000000000000000000000021",
  multicall3: "0xcA11bde05977b3631167028862bE2a173976CA11",
  permit2: "0x000000000022D473030F116dDEE9F6B43aC78BA3",
  safe: "0x69f4D1788e39c87893C980c06EdF4b7f686e2938",
  weth9: "0x4200000000000000000000000000000000000006",
  l2StandardBridge: "0x4200000000000000000000000000000000000010",
  gasPriceOracle: "0x420000000000000000000000000000000000000F",
} as const;

export const GIWA_L1_CONTRACTS = {
  optimismPortal: "0x956962C34687A954e611A83619ABaA37Ce6bC78A",
  l1StandardBridge: "0x77b2ffc0F57598cAe1DB76cb398059cF5d10A7E7",
  l1CrossDomainMessenger: "0x23ce19ED800fbbC964B9350b01B9113a8508D3F1",
  systemConfig: "0x8352825bA56C32d816Dd906Ad4A392B5BC9eC984",
} as const;

/** Zero address sentinel - means "contract not deployed yet, run in demo mode". */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

function envAddress(value: string | undefined): `0x${string}` {
  if (value && /^0x[0-9a-fA-F]{40}$/.test(value)) return value as `0x${string}`;
  return ZERO_ADDRESS;
}

/**
 * Syndix protocol deployments. Populate via .env.local after `forge script`;
 * until then the app runs against the simulated ledger in `lib/data`.
 */
export const SYNDIX_CONTRACTS = {
  treasury: envAddress(process.env.NEXT_PUBLIC_SYNDIX_TREASURY),
  articleNft: envAddress(process.env.NEXT_PUBLIC_SYNDIX_ARTICLE_NFT),
  paymaster: envAddress(process.env.NEXT_PUBLIC_SYNDIX_PAYMASTER),
} as const;

/**
 * Gasless claims additionally need a bundler that serves chain 91342 and a
 * smart-account factory. The paymaster being deployed is not sufficient - see
 * the note in components/reader/claim-modal.tsx.
 */
export const BUNDLER_URL = process.env.NEXT_PUBLIC_BUNDLER_URL?.trim() || "";
export const IS_GASLESS_READY =
  BUNDLER_URL !== "" && envAddress(process.env.NEXT_PUBLIC_SYNDIX_PAYMASTER) !== ZERO_ADDRESS;

export const IS_LIVE_CHAIN = SYNDIX_CONTRACTS.treasury !== ZERO_ADDRESS;

/* ------------------------------------------------------------------ */
/*  Explorer helpers                                                   */
/* ------------------------------------------------------------------ */

export const explorerTx = (hash: string) => `${GIWA_EXPLORER}/tx/${hash}`;
export const explorerAddress = (address: string) =>
  `${GIWA_EXPLORER}/address/${address}`;
export const explorerBlock = (block: number | bigint) =>
  `${GIWA_EXPLORER}/block/${block.toString()}`;

/* ------------------------------------------------------------------ */
/*  Upbit Web3 Names (up.id)                                           */
/* ------------------------------------------------------------------ */

/**
 * GIWA's identity primitive is `username.up.id` - ENS subdomains of the
 * `up.id` parent, issued as Soul-Bound Tokens to Dojang Verified Addresses,
 * capped at one per wallet.
 *
 * That cap is what makes Syndix's reward economics work: one human, one
 * claim. A raw-address reward pool would be drained by a sybil script in
 * a single block.
 */
export const UP_ID_SUFFIX = ".up.id";

export const UP_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,30}\.up\.id$/;

/**
 * The live Upbit Web3 Names registry on GIWA Sepolia - one namespace for the
 * whole ecosystem, not a per-app one.
 *
 * ERC-1967 proxy over `UpnameRegistry`; ERC-721 "Upbit Web3 Names" (UPNAME).
 * `balanceOf(addr) > 0` means the address holds a verified identity, which is
 * the sybil property Syndix's reward pool depends on.
 *
 * It is deliberately NOT ERC-721Enumerable (`tokenOfOwnerByIndex` reverts,
 * `supportsInterface(0x780e9d63)` is false), so there is no onchain path from
 * an address to the name it holds. The label lives behind `tokenURI`, served
 * from `UP_ID_METADATA_BASE`.
 */
export const UPNAME_REGISTRY =
  "0x091D00004f21eb2Fc30964A8a4995692d9b49628" as const;

/** `UpIdReaderRegistry` - the IReaderRegistry adapter over UPNAME_REGISTRY. */
export const UP_ID_READER_REGISTRY =
  "0xa316Bb7762c5689ec905b2dec2899Ded93557941" as const;

/** Where `tokenURI` resolves. Returns `{ name: "alice.up.id", … }`. */
export const UP_ID_METADATA_BASE = "https://sepolia-id.giwa.io/metadata";

/** Names are minted here - via Dojang attestation, not by our contracts. */
export const UP_ID_PLAYGROUND = "https://sepolia-playground.giwa.io";

/** True when the treasury is gating on the real ecosystem registry. */
export function isRealUpIdRegistry(address?: string): boolean {
  return address?.toLowerCase() === UP_ID_READER_REGISTRY.toLowerCase();
}

export function isValidUpId(name: string): boolean {
  return UP_ID_PATTERN.test(name.trim().toLowerCase());
}

/** Accepts "alice" or "alice.up.id" and normalises to "alice.up.id". */
export function normalizeUpId(input: string): string {
  const raw = input.trim().toLowerCase().replace(/^@/, "");
  if (!raw) return "";
  return raw.endsWith(UP_ID_SUFFIX) ? raw : `${raw}${UP_ID_SUFFIX}`;
}

export function shortenAddress(address?: string, chars = 4): string {
  if (!address) return "";
  if (address.length < 2 * chars + 3) return address;
  return `${address.slice(0, chars + 2)}…${address.slice(-chars)}`;
}
