import { UPNAME_REGISTRY, UP_ID_METADATA_BASE, GIWA_EXPLORER } from "@/lib/giwa";

/**
 * Reverse resolution for Upbit Web3 Names: address → `alice.up.id`.
 *
 * WHY THIS IS NOT A CONTRACT CALL
 *
 * The live registry is an ERC-721 whose tokenId is the ENS namehash of the
 * name. It is not ERC-721Enumerable - `tokenOfOwnerByIndex` reverts and
 * `supportsInterface(0x780e9d63)` returns false - so there is no view function
 * that maps an address to the token it holds, and a namehash cannot be
 * inverted. The label genuinely lives off-chain, behind `tokenURI`.
 *
 * So the onchain half of identity and the display half are separate concerns,
 * and only the first one carries the security property:
 *
 *   - `UpIdReaderRegistry.isVerified(addr)` → `balanceOf(addr) > 0`. This is
 *     what `SyndixTreasury` gates claims on. Onchain, trustless, and the
 *     only thing that stops a sybil script draining the reward pool.
 *   - `resolveUpIdName(addr)` → the human-readable label, for display only.
 *     A wrong or missing answer here costs nothing but a nicer greeting.
 *
 * The label is found by asking the explorer which UPNAME tokens the address
 * holds, then reading the name from that token's metadata. Indexer-sourced,
 * best-effort, and never used to authorise anything.
 */

const HOLDINGS_ENDPOINT = (address: string) =>
  `${GIWA_EXPLORER}/api/v2/addresses/${address}/nft?type=ERC-721`;

interface BlockscoutNftItem {
  id?: string;
  /**
   * Blockscout renamed this field from `address` to `address_hash`; GIWA's
   * explorer serves the newer shape. Both are read so a future rename in
   * either direction degrades the label rather than breaking the lookup.
   */
  token?: { address?: string; address_hash?: string; symbol?: string };
  metadata?: { name?: string } | null;
}

/** Reads the name straight off the identity service, given a tokenId. */
async function nameFromMetadata(tokenId: string): Promise<string | null> {
  try {
    const response = await fetch(`${UP_ID_METADATA_BASE}/${tokenId}`, {
      signal: AbortSignal.timeout(6_000),
      next: { revalidate: 3_600 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { name?: unknown };
    return typeof body.name === "string" && body.name ? body.name : null;
  } catch {
    return null;
  }
}

/**
 * Returns the `*.up.id` label held by `address`, or null.
 *
 * Null means "could not resolve the label", never "not verified" - those are
 * different questions and only the contract answers the second one.
 */
export async function resolveUpIdName(address: string): Promise<string | null> {
  let items: BlockscoutNftItem[];
  try {
    const response = await fetch(HOLDINGS_ENDPOINT(address), {
      signal: AbortSignal.timeout(8_000),
      next: { revalidate: 300 },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { items?: BlockscoutNftItem[] };
    items = body.items ?? [];
  } catch {
    return null;
  }

  // Match on the contract address, not the symbol - a symbol is not unique and
  // any deployer can mint a token calling itself UPNAME.
  const target = UPNAME_REGISTRY.toLowerCase();
  const held = items.find((item) => {
    const contract = (item.token?.address_hash ?? item.token?.address)?.toLowerCase();
    return contract === target;
  });
  if (!held) return null;

  const indexed = held.metadata?.name;
  if (typeof indexed === "string" && indexed.endsWith(".up.id")) return indexed;

  // The indexer may not have cached metadata yet; go to the source.
  return held.id ? nameFromMetadata(held.id) : null;
}
