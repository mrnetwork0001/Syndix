import { NextResponse } from "next/server";
import { PROTOCOL_STATS } from "@/lib/data/protocol";
import { GIWA_SEPOLIA_ID, IS_LIVE_CHAIN, SYNDIX_CONTRACTS } from "@/lib/giwa";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    {
      network: { name: "GIWA Sepolia", chainId: GIWA_SEPOLIA_ID },
      // `source` is the honest bit: until a treasury is deployed these numbers
      // come from the local dataset, not from chain state.
      source: IS_LIVE_CHAIN ? "onchain" : "simulated",
      contracts: SYNDIX_CONTRACTS,
      stats: PROTOCOL_STATS,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
