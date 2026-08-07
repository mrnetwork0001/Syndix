import { NextRequest, NextResponse } from "next/server";
import { ISSUES } from "@/lib/data/issues";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import {
  X402_PAYMENT_HEADER,
  X402_PRICE_WEI,
  X402_VERSION,
  X402_SCHEME,
  buildX402Challenge,
  verifyX402Payment,
} from "@/lib/x402";
import { GIWA_SEPOLIA_ID } from "@/lib/giwa";

export const dynamic = "force-dynamic";

const RESOURCE = "/api/x402/feed";

/**
 * The machine-payable alpha feed.
 *
 * No payment proof -> 402 with the full payment requirements, so an agent can
 * settle and retry without any out-of-band documentation.
 * Valid proof -> the structured feed.
 */
export async function GET(request: NextRequest) {
  const proof = request.headers.get(X402_PAYMENT_HEADER);

  if (!proof) {
    return NextResponse.json(buildX402Challenge(RESOURCE), {
      status: 402,
      headers: {
        // WWW-Authenticate lets a generic HTTP client discover the scheme
        // without parsing the body.
        "WWW-Authenticate": `Payment scheme="${X402_SCHEME}", network="eip155:${GIWA_SEPOLIA_ID}", amount="${X402_PRICE_WEI}"`,
        "Cache-Control": "no-store",
      },
    });
  }

  const verdict = await verifyX402Payment(proof);

  if (!verdict.ok) {
    return NextResponse.json(
      {
        x402Version: X402_VERSION,
        error: verdict.reason,
        accepts: buildX402Challenge(RESOURCE).accepts,
      },
      { status: 402, headers: { "Cache-Control": "no-store" } },
    );
  }

  const payload = {
    x402Version: X402_VERSION,
    settlement: {
      txHash: verdict.txHash,
      verification: verdict.mode,
      ...(verdict.note ? { note: verdict.note } : {}),
    },
    generatedAt: new Date().toISOString(),
    network: { name: "GIWA Sepolia", chainId: GIWA_SEPOLIA_ID },
    protocol: {
      issuesPublished: PROTOCOL_STATS.issuesPublished,
      uniqueReaders: PROTOCOL_STATS.uniqueReaders,
      dailyActiveWallets: PROTOCOL_STATS.dailyActiveWallets,
      totalRewardDistributedWei: PROTOCOL_STATS.totalRewardDistributedWei,
    },
    issues: ISSUES.map((issue) => ({
      id: issue.id,
      slug: issue.slug,
      title: issue.title,
      standfirst: issue.standfirst,
      track: issue.track,
      status: issue.status,
      publishedAt: issue.publishedAt,
      contentURI: issue.contentURI,
      executiveSummary: issue.executiveSummary,
      engagementIndex: issue.score.index,
      sentiment: issue.score.sentiment,
      signals: issue.signals.map((signal) => ({
        kind: signal.kind,
        label: signal.label,
        ref: signal.ref,
        confidence: signal.confidence,
      })),
      rewardPerReaderWei: issue.rewardPerReaderWei,
      claimedCount: issue.claimedCount,
      mintTxHash: issue.mintTxHash ?? null,
    })),
  };

  return NextResponse.json(payload, {
    status: 200,
    headers: { "Cache-Control": "no-store" },
  });
}
