import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  ATTESTATION_TTL_SECONDS,
  MAX_DWELL_SECONDS,
  MIN_DWELL_SECONDS,
  READ_PROOF_TYPES,
  isAttesterConfigured,
  readProofDomain,
  treasuryAddress,
  type AttestationResponse,
} from "@/lib/attest";
import { GIWA_RPC_HTTP, IS_LIVE_CHAIN, ZERO_ADDRESS, giwaSepolia } from "@/lib/giwa";
import { syndixTreasuryAbi } from "@/lib/abi";
import { ISSUES } from "@/lib/data/issues";
import { issueIdForArticle } from "@/lib/onchain";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues the EIP-712 ReadProof that SyndixTreasury requires for a claim.
 *
 * The attester key signs; it never holds or moves funds, and the reader still
 * submits their own transaction. That split is deliberate — a compromised
 * attester can mint bogus proofs but cannot drain the treasury, and it cannot
 * claim on somebody else's behalf because `reader` is bound into the signature.
 *
 * HONEST LIMITATION: dwell time is reported by the client. This endpoint
 * bounds and sanity-checks it, and the contract enforces one claim per
 * identity, but it is not cryptographic proof that a human read the article.
 * Hardening that means server-side reading telemetry or a Dojang attestation,
 * and is out of scope for this build.
 */

interface Body {
  articleId?: unknown;
  reader?: unknown;
  dwellSeconds?: unknown;
}

function bad(reason: string, status = 400) {
  return NextResponse.json({ error: reason }, { status });
}

export async function POST(request: NextRequest) {
  const key = process.env.ATTESTER_PRIVATE_KEY;
  if (!isAttesterConfigured() || !key) {
    return bad(
      "Attester is not configured. Set ATTESTER_PRIVATE_KEY in .env.local to enable real claims.",
      503,
    );
  }

  const treasury = treasuryAddress();
  if (!IS_LIVE_CHAIN || treasury === ZERO_ADDRESS) {
    return bad(
      "SyndixTreasury is not deployed. Run `npm run contracts:deploy` and set NEXT_PUBLIC_SYNDIX_TREASURY.",
      503,
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("Body must be JSON.");
  }

  // `articleId` is the SyndixTreasury id, which publish order decides — not the
  // dataset issue id. Resolve it back to an issue so we only ever attest for
  // something we actually published.
  const articleId = Number(body.articleId);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return bad("articleId must be a positive on-chain article id.");
  }
  const issueId = issueIdForArticle(articleId);
  if (issueId === undefined || !ISSUES.some((issue) => issue.id === issueId)) {
    return bad(`Article ${articleId} is not a published Syndix issue.`, 404);
  }

  const reader = body.reader;
  if (typeof reader !== "string" || !isAddress(reader)) {
    return bad("reader must be a checksummed address.");
  }

  const dwellSeconds = Math.floor(Number(body.dwellSeconds));
  if (!Number.isFinite(dwellSeconds) || dwellSeconds < MIN_DWELL_SECONDS) {
    return bad(
      `dwellSeconds must be at least ${MIN_DWELL_SECONDS} — the contract rejects anything shorter.`,
    );
  }
  // Clamp rather than reject: a long, legitimate read should still settle, and
  // the contract only enforces a floor.
  const dwell = Math.min(dwellSeconds, MAX_DWELL_SECONDS);

  const account = privateKeyToAccount(
    key.startsWith("0x") ? (key as `0x${string}`) : (`0x${key}` as `0x${string}`),
  );

  // Ask the contract whether this claim can actually succeed before spending a
  // signature on it. Saves the reader a guaranteed-revert transaction and gives
  // them the real reason (no up.id, already claimed, pool exhausted).
  try {
    const publicClient = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_HTTP),
    });
    const [claimable, reason] = await publicClient.readContract({
      address: treasury,
      abi: syndixTreasuryAbi,
      functionName: "claimability",
      args: [BigInt(articleId), reader as Address],
    });
    if (!claimable) {
      return NextResponse.json(
        { error: `Not claimable: ${reason}`, reason },
        { status: 409 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return bad(`Could not reach GIWA to check claimability: ${message}`, 502);
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + ATTESTATION_TTL_SECONDS);

  const signature = await account.signTypedData({
    domain: readProofDomain(treasury),
    types: READ_PROOF_TYPES,
    primaryType: "ReadProof",
    message: {
      articleId: BigInt(articleId),
      reader: reader as Address,
      dwellSeconds: dwell,
      deadline,
    },
  });

  const payload: AttestationResponse = {
    signature,
    deadline: deadline.toString(),
    dwellSeconds: dwell,
    attester: account.address,
    verifyingContract: treasury,
    chainId: giwaSepolia.id,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store" },
  });
}
