import { NextResponse } from "next/server";
import { readAttentionIndex, readCertifiedDwell } from "@/lib/attention";
import { readOnchainIssue } from "@/lib/onchain-issues";
import { GIWA_SEPOLIA_ID, explorerTx } from "@/lib/giwa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Claims we decode calldata for. Beyond this the dwell figures are omitted, not guessed. */
const DWELL_SAMPLE_LIMIT = 25;

/**
 * GET /api/article/:id/receipt - what a sponsor actually bought.
 *
 * An advertiser normally accepts an impression count on trust, which is why ad
 * fraud is a multi-billion-dollar industry. Here the count is the number of
 * distinct verified humans who claimed the reward, derived from settled
 * transactions - anyone can recompute it from the contract without believing us.
 *
 * WHAT THIS PROVES, AND WHAT IT DOES NOT
 *
 * Provable: that N wallets each holding a soul-bound `up.id` claimed this
 * article's reward, one claim apiece, and were paid. That rules out both bot
 * traffic and double-counting, because the treasury enforces the cap.
 *
 * Not provable: that a human read the words. `certifiedDwellSeconds` is decoded
 * from each claim's calldata, so it is publicly checkable - but it is the
 * figure the read-attester signed, not an independent measurement. It is
 * evidence, not proof, and is labelled that way rather than presented as a
 * guarantee.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return NextResponse.json({ error: "invalid article id" }, { status: 400 });
  }

  const [index, article] = await Promise.all([
    readAttentionIndex(),
    readOnchainIssue(articleId),
  ]);

  if (!index) {
    return NextResponse.json(
      { error: "Could not read the claim log from GIWA." },
      { status: 503 },
    );
  }
  if (!article) {
    return NextResponse.json(
      { error: `Article ${articleId} does not exist on SyndixTreasury.` },
      { status: 404 },
    );
  }

  const claims = index.byArticle.get(articleId) ?? [];
  const paidWei = claims.reduce((sum, c) => sum + BigInt(c.amountWei), 0n);

  // Sequential and capped: each one is an extra RPC round trip, and a receipt
  // is not worth hammering the node for.
  const sampled = claims.slice(0, DWELL_SAMPLE_LIMIT);
  const dwells: (number | null)[] = [];
  for (const c of sampled) dwells.push(await readCertifiedDwell(c.txHash));

  const known = dwells.filter((d): d is number => d !== null);
  const medianDwell =
    known.length > 0
      ? [...known].sort((a, b) => a - b)[Math.floor(known.length / 2)]
      : null;

  const pool = BigInt(article.rewardPoolWei);
  const perReader = BigInt(article.rewardPerReaderWei);

  return NextResponse.json(
    {
      network: { name: "GIWA Sepolia", chainId: GIWA_SEPOLIA_ID },
      articleId,
      title: article.title,
      contentURI: article.contentURI,
      publishedAt: article.publishedAt,
      isActive: article.isActive,
      readers: {
        verifiedHumans: claims.length,
        capacity: perReader > 0n ? Number(pool / perReader) : 0,
        totalPaidWei: paidWei.toString(),
        rewardPerReaderWei: article.rewardPerReaderWei,
      },
      attention: {
        certifiedDwellSeconds: sampled.map((c, i) => ({
          reader: c.reader,
          seconds: dwells[i],
          txHash: c.txHash,
        })),
        medianSeconds: medianDwell,
        sampled: sampled.length,
        of: claims.length,
      },
      claims: claims.map((c) => ({
        reader: c.reader,
        identity: c.identity || null,
        amountWei: c.amountWei,
        blockNumber: c.blockNumber,
        txHash: c.txHash,
        explorer: explorerTx(c.txHash),
      })),
      readAtBlock: index.scannedTo,
      provenance: {
        verifiable:
          "Reader count and payouts come from RewardClaimed logs on SyndixTreasury. One claim per verified up.id is enforced by the contract, so the count cannot be inflated by generated addresses.",
        limitation:
          "certifiedDwellSeconds is decoded from each claim's calldata. It is the duration the read-attester signed for, which is evidence rather than independent proof that a human read the article.",
      },
    },
    { headers: { "cache-control": "public, max-age=60, s-maxage=120" } },
  );
}
