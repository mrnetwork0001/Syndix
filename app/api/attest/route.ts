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
import { readOnchainIssues } from "@/lib/onchain-issues";
import { judgeSession } from "@/lib/read-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issues the EIP-712 ReadProof that SyndixTreasury requires for a claim.
 *
 * The attester key signs; it never holds or moves funds, and the reader still
 * submits their own transaction. That split is deliberate - a compromised
 * attester can mint bogus proofs but cannot drain the treasury, and it cannot
 * claim on somebody else's behalf because `reader` is bound into the signature.
 *
 * Dwell is measured by this server, not reported by the client. The reader
 * presents a signed read session (see lib/read-session.ts) whose elapsed time,
 * heartbeat count and scroll depth this endpoint judges before it will sign.
 *
 * HONEST LIMITATION: this proves time and scrolling, not comprehension. A
 * script that holds a session open and beats on a timer still qualifies. What
 * it cannot do is claim instantly or in bulk - every reward costs the real
 * wall-clock time asked for, and up.id caps it at one claim per human per
 * article, so farming costs more than it pays. Proving a human actually read
 * the words needs content-derived challenges, which is roadmap.
 */

interface Body {
  articleId?: unknown;
  reader?: unknown;
  /** Signed read session issued by /api/read/session. */
  token?: unknown;
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

  // `articleId` is the SyndixTreasury id. The treasury is the only authority on
  // what exists - an earlier version checked it against the bundled dataset,
  // which listed issues 1-6 and therefore 404'd every article the agent has
  // actually published since. The dataset is not the source of truth and must
  // never gate a claim again.
  const articleId = Number(body.articleId);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return bad("articleId must be a positive onchain article id.");
  }
  const index = await readOnchainIssues();
  if (!index.ok) {
    return bad(`Could not read the article index from GIWA: ${index.reason}`, 502);
  }
  const article = index.issues.find((i) => i.articleId === articleId);
  if (!article) {
    return bad(`Article ${articleId} does not exist on SyndixTreasury.`, 404);
  }
  if (!article.isActive) {
    return bad(`Article ${articleId} is closed and no longer pays rewards.`, 409);
  }

  const reader = body.reader;
  if (typeof reader !== "string" || !isAddress(reader)) {
    return bad("reader must be a checksummed address.");
  }

  // The session decides, not the caller. Its elapsed time comes from this
  // server's clock, so `dwellSeconds` can no longer be asserted by a client.
  const verdict = judgeSession(body.token, articleId);
  if (!verdict.ok) {
    return NextResponse.json(
      { error: verdict.reason, dwellSeconds: verdict.dwellSeconds },
      { status: 425 },
    );
  }
  if (verdict.dwellSeconds < MIN_DWELL_SECONDS) {
    return bad(
      `The contract rejects anything shorter than ${MIN_DWELL_SECONDS}s.`,
    );
  }
  // Clamp rather than reject: a long, legitimate read should still settle, and
  // the contract only enforces a floor.
  const dwell = Math.min(verdict.dwellSeconds, MAX_DWELL_SECONDS);

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
