import type { Address, Hex } from "viem";
import { GIWA_SEPOLIA_ID, SYNDIX_CONTRACTS } from "./giwa";

/**
 * EIP-712 ReadProof — the attestation SyndixTreasury.claimReaderReward verifies.
 *
 * This must match the contract byte for byte. The typehash there is:
 *   keccak256("ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)")
 * and the domain is EIP712("Syndix", "1"), which OpenZeppelin expands with the
 * current chainId and the treasury address. Any drift here produces a signature
 * that recovers to the wrong address and the claim reverts with
 * InvalidAttestation.
 */

export const READ_PROOF_DOMAIN_NAME = "Syndix";
export const READ_PROOF_DOMAIN_VERSION = "1";

export const READ_PROOF_TYPES = {
  ReadProof: [
    { name: "articleId", type: "uint256" },
    { name: "reader", type: "address" },
    { name: "dwellSeconds", type: "uint32" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export interface ReadProofMessage {
  articleId: bigint;
  reader: Address;
  dwellSeconds: number;
  deadline: bigint;
}

export function readProofDomain(verifyingContract: Address) {
  return {
    name: READ_PROOF_DOMAIN_NAME,
    version: READ_PROOF_DOMAIN_VERSION,
    chainId: GIWA_SEPOLIA_ID,
    verifyingContract,
  } as const;
}

/** How long an issued attestation stays valid. Short, because it is bearer-ish. */
export const ATTESTATION_TTL_SECONDS = 600;

/**
 * Mirrors `SyndixTreasury.minDwellSeconds`. Kept here so the API can reject a
 * request before spending a signature on something the contract will refuse.
 */
export const MIN_DWELL_SECONDS = 20;

/** Upper bound so a client cannot claim an implausible dwell. */
export const MAX_DWELL_SECONDS = 3600;

export interface AttestationResponse {
  signature: Hex;
  deadline: string;
  dwellSeconds: number;
  attester: Address;
  verifyingContract: Address;
  chainId: number;
}

export interface AttestationRequest {
  articleId: number;
  reader: Address;
  dwellSeconds: number;
}

export function isAttesterConfigured(): boolean {
  return Boolean(process.env.ATTESTER_PRIVATE_KEY);
}

export function treasuryAddress(): Address {
  return SYNDIX_CONTRACTS.treasury;
}
