import { NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { resolveUpIdName } from "@/lib/up-id";

/**
 * GET /api/up-id/:address → `{ name: "alice.up.id" | null }`
 *
 * Display-name lookup only. Verification is a contract call the browser makes
 * itself against `UpIdReaderRegistry` - this route is deliberately incapable of
 * authorising anything, so a compromised or unreachable explorer can degrade
 * the greeting but never mint a claim.
 *
 * Proxied server-side because the explorer sends no CORS headers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const { address } = await params;

  // Not strict: a lookup should not fail over EIP-55 casing. `getAddress`
  // normalises to the checksummed form the explorer expects.
  if (!isAddress(address, { strict: false })) {
    return NextResponse.json({ error: "invalid address" }, { status: 400 });
  }

  const name = await resolveUpIdName(getAddress(address));

  return NextResponse.json(
    { name, source: name ? "upname-registry" : "unresolved" },
    { headers: { "cache-control": "public, max-age=120, s-maxage=300" } },
  );
}
