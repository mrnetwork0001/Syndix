import { NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { readAttentionIndex } from "@/lib/attention";
import { resolveUpIdName } from "@/lib/up-id";
import { GIWA_SEPOLIA_ID, explorerTx } from "@/lib/giwa";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/reader/:address - a wallet's proven reading record.
 *
 * Every entry is a settled transaction anyone can verify. Because claims are
 * gated on a soul-bound `up.id` and capped at one per article, this is a
 * history that cannot be inflated by generating addresses - which is what
 * separates it from any self-reported profile.
 *
 * Deliberately public and unauthenticated. The record belongs to the reader,
 * not to us; another application should be able to read it without asking.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;
  if (!isAddress(address, { strict: false })) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  const index = await readAttentionIndex();
  if (!index) {
    return NextResponse.json(
      { error: "Could not read the claim log from GIWA." },
      { status: 503 },
    );
  }

  const checksummed = getAddress(address);
  const claims = index.byReader.get(checksummed.toLowerCase()) ?? [];

  // The label is cosmetic and resolved off chain; a failure here must not
  // suppress a record that the chain plainly holds.
  const name = await resolveUpIdName(checksummed).catch(() => null);

  const totalWei = claims.reduce((sum, c) => sum + BigInt(c.amountWei), 0n);

  return NextResponse.json(
    {
      network: { name: "GIWA Sepolia", chainId: GIWA_SEPOLIA_ID },
      reader: checksummed,
      upId: name,
      verified: claims.length > 0 || name !== null,
      issuesRead: claims.length,
      totalEarnedWei: totalWei.toString(),
      readAtBlock: index.scannedTo,
      history: claims.map((c) => ({
        articleId: c.articleId,
        amountWei: c.amountWei,
        blockNumber: c.blockNumber,
        txHash: c.txHash,
        explorer: explorerTx(c.txHash),
      })),
      note: "Derived from RewardClaimed logs on SyndixTreasury. Every entry is a settled transaction; recompute it yourself from the contract.",
    },
    { headers: { "cache-control": "public, max-age=60, s-maxage=120" } },
  );
}
