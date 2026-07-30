/**
 * IPFS pinning via Pinata.
 *
 * Until this existed, `contentURI` values were authored CIDs that resolved to
 * nothing — the on-chain pointer was decorative. Now a generated issue is
 * actually pinned before it is published, so `contentURI` and `tokenURI` point
 * at retrievable content.
 *
 * Returns a discriminated union rather than throwing: a pinning outage should
 * degrade the studio to "generated but not pinned" with the reason shown, not
 * fail the whole run.
 */

const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

/** Public gateway used only for display/verification links. */
export const IPFS_GATEWAY = "https://gateway.pinata.cloud/ipfs";

export function hasPinataKey(): boolean {
  return Boolean(process.env.PINATA_JWT?.trim());
}

export function ipfsGatewayUrl(uri: string): string {
  const cid = uri.replace(/^ipfs:\/\//, "");
  return `${IPFS_GATEWAY}/${cid}`;
}

export interface IssueMetadata {
  name: string;
  description: string;
  /** Markdown body — the actual issue. */
  content: string;
  attributes: { trait_type: string; value: string | number }[];
  external_url?: string;
}

export type PinResult =
  | { ok: true; cid: string; uri: string; size: number }
  | { ok: false; reason: string };

/**
 * Pins issue metadata as JSON and returns an `ipfs://` URI.
 *
 * The shape is deliberately NFT-metadata-compatible (`name`, `description`,
 * `attributes`) because SyndixArticleNFT serves the same URI as its tokenURI,
 * so a marketplace should be able to read it.
 */
export async function pinIssueMetadata(
  metadata: IssueMetadata,
  signal?: AbortSignal,
): Promise<PinResult> {
  const jwt = process.env.PINATA_JWT?.trim();
  if (!jwt) {
    return {
      ok: false,
      reason:
        "PINATA_JWT is not set, so the issue was generated but not pinned. Add it to .env.local to publish a resolvable contentURI.",
    };
  }

  try {
    const response = await fetch(PINATA_JSON_ENDPOINT, {
      method: "POST",
      signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({
        pinataOptions: { cidVersion: 1 },
        pinataMetadata: {
          name: `syndix-${metadata.name.slice(0, 60)}`,
          keyvalues: { project: "syndix", network: "giwa-sepolia" },
        },
        pinataContent: metadata,
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return {
        ok: false,
        reason: `Pinata returned ${response.status}: ${detail.slice(0, 160)}`,
      };
    }

    const body = (await response.json()) as {
      IpfsHash?: string;
      PinSize?: number;
    };
    if (!body.IpfsHash) {
      return { ok: false, reason: "Pinata response contained no IpfsHash." };
    }

    return {
      ok: true,
      cid: body.IpfsHash,
      uri: `ipfs://${body.IpfsHash}`,
      size: body.PinSize ?? 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `Pinning failed: ${message}` };
  }
}
