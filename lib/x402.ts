import { createPublicClient, http, isHex, type Hex } from "viem";
import {
  GIWA_RPC_HTTP,
  GIWA_SEPOLIA_ID,
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  giwaSepolia,
  IS_LIVE_CHAIN,
} from "./giwa";
import type { X402Challenge, X402Requirement } from "./types";

/**
 * Nodit x402 - HTTP 402 "Payment Required" for machine buyers.
 *
 * The premise: an autonomous agent that wants Syndix's raw alpha feed should be
 * able to pay for a single request over HTTP instead of signing up for an API
 * key. It requests, gets a 402 describing exactly what to pay and to whom,
 * settles on GIWA, and retries with the transaction hash in `X-PAYMENT`.
 *
 * GIWA is a good settlement layer for this specifically because the payment is
 * worth ~$0.02 - on a chain with 1s blocks and sub-cent fees the gas does not
 * eat the invoice.
 */

export const X402_VERSION = 1;

/** Wei charged per feed request. ~$0.02 at the demo FX rate. */
export const X402_PRICE_WEI = "6250000000000" as const;

export const X402_PAYMENT_HEADER = "x-payment";

/**
 * Scheme identifier. Deliberately NOT "exact".
 *
 * x402's `exact` scheme means the client signs an EIP-3009
 * `transferWithAuthorization` (or a Permit2 equivalent) and the server settles
 * it. That is defined over ERC-20, and native ETH has no EIP-3009 - there is
 * nothing for a compliant client to sign. Advertising `exact` while expecting a
 * transaction hash would send a standard x402 client off to build a signature
 * against the zero address, and fail.
 *
 * What Syndix actually implements is simpler: pay the invoice on chain, then
 * present the transaction hash, which the server verifies against the receipt.
 * That deserves its own name rather than a borrowed one. ERC-20 rails do not
 * meaningfully exist on GIWA Sepolia yet; when they do, `exact` becomes
 * available and this can be offered alongside it.
 */
export const X402_SCHEME = "giwa-native-transfer" as const;

/**
 * Absolute base for the `resource` field. The spec identifies a resource by
 * URL, not by path - a relative value cannot be resolved by a client that
 * followed the 402 from somewhere else.
 */
function siteOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (configured || "http://localhost:3000").replace(/\/+$/, "");
}

/** Turns a path into the absolute URL the challenge should advertise. */
export function x402ResourceUrl(path: string): string {
  return path.startsWith("http") ? path : `${siteOrigin()}${path}`;
}

/** Where an agent should send payment. Falls back to the treasury deployment. */
export function x402PayTo(): string {
  const configured = process.env.NEXT_PUBLIC_X402_PAY_TO;
  if (configured && /^0x[0-9a-fA-F]{40}$/.test(configured)) return configured;
  return SYNDIX_CONTRACTS.treasury;
}

export function buildX402Challenge(resource: string): X402Challenge {
  const requirement: X402Requirement = {
    scheme: X402_SCHEME,
    network: `eip155:${GIWA_SEPOLIA_ID}`,
    maxAmountRequired: X402_PRICE_WEI,
    resource: x402ResourceUrl(resource),
    description:
      "Single-request access to the Syndix raw alpha feed: structured issue JSON with source signals, engagement scoring, and reward economics.",
    mimeType: "application/json",
    payTo: x402PayTo(),
    maxTimeoutSeconds: 120,
    // Native ETH, by the usual zero-address convention. Paired with
    // X402_SCHEME rather than `exact`, since ETH cannot carry an EIP-3009
    // authorization - see the note on X402_SCHEME.
    asset: ZERO_ADDRESS,
    extra: {
      chainName: "GIWA Sepolia",
      rpc: GIWA_RPC_HTTP,
      // Settlement is verified against the Flashblocks `pending` tag first, so a
      // paying agent is unblocked in ~200ms rather than a full block.
      preconfirmationRpc: "https://sepolia-rpc-flashblocks.giwa.io",
      settlementHeader: X402_PAYMENT_HEADER,
      // Spelled out so an agent does not have to infer it from the scheme name.
      settlementFormat:
        "Send maxAmountRequired wei of native ETH to payTo, then retry with the 32-byte transaction hash in the x-payment header.",
      docs: "https://docs.giwa.io",
    },
  };

  return {
    x402Version: X402_VERSION,
    error: "X-PAYMENT header is required",
    accepts: [requirement],
  };
}

export type PaymentVerdict =
  | { ok: true; mode: "onchain" | "accepted-unverified"; txHash: Hex; note?: string }
  | { ok: false; reason: string };

/**
 * Verify the `X-PAYMENT` header.
 *
 * When a treasury is deployed we do the real check: fetch the receipt from the
 * Flashblocks RPC, confirm it succeeded, that it paid `payTo`, and that the
 * value covers the price.
 *
 * When nothing is deployed there is no chain state to check against, so we
 * accept a well-formed hash and label the result `accepted-unverified`. The
 * response carries that label so a caller is never misled into thinking an
 * unverified request was settled.
 */
export async function verifyX402Payment(
  headerValue: string | null,
): Promise<PaymentVerdict> {
  if (!headerValue) return { ok: false, reason: "missing X-PAYMENT header" };

  const txHash = headerValue.trim();
  if (!isHex(txHash) || txHash.length !== 66) {
    return {
      ok: false,
      reason: "X-PAYMENT must be a 32-byte GIWA transaction hash (0x + 64 hex chars)",
    };
  }

  if (!IS_LIVE_CHAIN) {
    return {
      ok: true,
      mode: "accepted-unverified",
      txHash,
      note: "SyndixTreasury is not deployed on GIWA Sepolia, so no settlement check was performed. Set NEXT_PUBLIC_SYNDIX_TREASURY to enable onchain verification.",
    };
  }

  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP),
    });

    const receipt = await client.getTransactionReceipt({ hash: txHash });
    if (receipt.status !== "success") {
      return { ok: false, reason: "payment transaction reverted" };
    }

    const tx = await client.getTransaction({ hash: txHash });
    const expected = x402PayTo().toLowerCase();
    if ((tx.to ?? "").toLowerCase() !== expected) {
      return { ok: false, reason: `payment must be sent to ${expected}` };
    }
    if (tx.value < BigInt(X402_PRICE_WEI)) {
      return {
        ok: false,
        reason: `underpaid: ${tx.value} wei < ${X402_PRICE_WEI} wei required`,
      };
    }

    return { ok: true, mode: "onchain", txHash };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `could not verify payment: ${message}` };
  }
}
