"use client";

import { useEffect, useState } from "react";
import { useReadContract } from "wagmi";
import { mockUpIdRegistryAbi, syndixTreasuryAbi } from "./abi";
import {
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  isRealUpIdRegistry,
} from "./giwa";

export interface UpIdIdentity {
  /**
   * On-chain answer to the only question that authorises anything: does this
   * address hold a verified identity? `undefined` while unknown.
   */
  verified: boolean | undefined;
  /**
   * Display label, or null. Null does NOT mean unverified — the real registry
   * keeps labels off-chain, so a verified reader can legitimately have no
   * resolvable name. Never gate on this.
   */
  name: string | null;
  /** True when the treasury is gating on the real ecosystem registry. */
  isRealRegistry: boolean;
  /** The registry the treasury currently points at, if any. */
  registryAddress: `0x${string}` | undefined;
  refetch: () => void;
}

/**
 * Resolves a wallet's Upbit Web3 Name against whichever registry the treasury
 * is pointed at.
 *
 * `useEnsName` cannot do this. up.id names are ENS subdomains, but GIWA Sepolia
 * has no ENS Universal Resolver deployed at the address viem expects, so that
 * hook fails and every wallet falls back to a raw hex address.
 *
 * Two registries are supported because both are live and the treasury decides
 * at runtime which one binds:
 *
 *   - MockUpIdRegistry stores the label on chain, so `nameOf` answers directly.
 *   - The real UpnameRegistry does not — tokenId is an ENS namehash and the
 *     contract is not enumerable — so the label comes from token metadata via
 *     `/api/up-id/:address`.
 *
 * Verification is always read from the contract; only the label ever touches
 * the network indirectly.
 */
export function useUpIdName(address: `0x${string}` | undefined): UpIdIdentity {
  const [resolved, setResolved] = useState<{
    address: string;
    name: string;
  } | null>(null);

  const { data: registry } = useReadContract({
    address: SYNDIX_CONTRACTS.treasury,
    abi: syndixTreasuryAbi,
    functionName: "readerRegistry",
    query: { enabled: SYNDIX_CONTRACTS.treasury !== ZERO_ADDRESS },
  });

  const registryAddress =
    registry && registry !== ZERO_ADDRESS ? registry : undefined;
  const isRealRegistry = isRealUpIdRegistry(registryAddress);

  const { data: verified, refetch: refetchVerified } = useReadContract({
    address: registryAddress,
    abi: mockUpIdRegistryAbi,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(registryAddress && address) },
  });

  const { data: onchainName, refetch: refetchName } = useReadContract({
    address: registryAddress,
    abi: mockUpIdRegistryAbi,
    functionName: "nameOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(registryAddress && address && verified) },
  });

  useEffect(() => {
    if (!isRealRegistry || !verified || !address) return;
    let live = true;
    void fetch(`/api/up-id/${address}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { name?: string | null } | null) => {
        if (live && typeof body?.name === "string") {
          setResolved({ address, name: body.name });
        }
      })
      .catch(() => {
        /* Cosmetic. A failed lookup must never block a verified reader. */
      });
    return () => {
      live = false;
    };
  }, [isRealRegistry, verified, address]);

  // Keyed by address rather than cleared in the effect, so switching accounts
  // can never flash the previous reader's name.
  const offchainName =
    resolved && resolved.address === address ? resolved.name : null;

  return {
    verified: registryAddress && address ? Boolean(verified) : undefined,
    name: onchainName || offchainName || null,
    isRealRegistry,
    registryAddress,
    refetch: () => {
      void refetchVerified();
      void refetchName();
    },
  };
}
