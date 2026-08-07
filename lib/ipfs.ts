/**
 * IPFS pinning via Pinata.
 *
 * Until this existed, `contentURI` values were authored CIDs that resolved to
 * nothing - the onchain pointer was decorative. Now a generated issue is
 * actually pinned before it is published, so `contentURI` and `tokenURI` point
 * at retrievable content.
 *
 * Returns a discriminated union rather than throwing: a pinning outage should
 * degrade the studio to "generated but not pinned" with the reason shown, not
 * fail the whole run.
 */

const PINATA_JSON_ENDPOINT = "https://api.pinata.cloud/pinning/pinJSONToIPFS";

/**
 * Read gateway.
 *
 * Deliberately not Pinata's: their public gateway rate-limits CIDs that are not
 * pinned to the calling account, returning 429 for both real and missing
 * content - which makes it impossible to tell "busy" from "does not exist".
 * ipfs.io serves any CID and answers 200 vs 5xx, so a failure is diagnosable.
 * Pinata is still the write path in `pinIssueMetadata`.
 */
export const IPFS_GATEWAY = "https://ipfs.io/ipfs";

/**
 * Gateways tried in order, fastest first.
 *
 * The public ipfs.io gateway takes ~9s on a CID it has not seen and ~0.8s once
 * warm, which is most of why an issue page felt broken on a first visit. A
 * Pinata dedicated gateway serves what we pinned directly and is far quicker,
 * so it goes first when configured. ipfs.io stays as the fallback: it is the
 * one that works without any credential, which matters for anyone running this
 * from a clone.
 *
 * Set PINATA_GATEWAY to the host only, e.g. "mycrew.mypinata.cloud".
 */
export function ipfsGateways(): string[] {
  const dedicated = process.env.PINATA_GATEWAY?.trim().replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return dedicated
    ? [`https://${dedicated}/ipfs`, IPFS_GATEWAY]
    : [IPFS_GATEWAY];
}

/** Every candidate URL for a CID, in preference order. */
export function ipfsGatewayUrls(uri: string): string[] {
  const cid = uri.replace(/^ipfs:\/\//, "");
  return ipfsGateways().map((base) => `${base}/${cid}`);
}

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
  /** Markdown body - the actual issue. */
  content: string;
  /** Takeaway bullets. Pinned because the reader renders them as a panel and
   *  there is nowhere else to recover them from once the run is over. */
  executiveSummary?: string[];
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
