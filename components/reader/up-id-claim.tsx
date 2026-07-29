"use client";

import { useCallback, useEffect, useState, type ReactElement } from "react";
import { BadgeCheck, Fingerprint, LoaderCircle, TriangleAlert } from "lucide-react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { createPublicClient } from "viem";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Mono } from "@/components/ui/mono";
import { mockUpIdRegistryAbi, syndixTreasuryAbi } from "@/lib/abi";
import { flashblocksTransport } from "@/lib/wagmi";
import {
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  giwaSepolia,
  isValidUpId,
  normalizeUpId,
} from "@/lib/giwa";
import { cn } from "@/lib/utils";

export interface UpIdClaimProps {
  /** Fires with the registered name once the wallet holds a verified identity. */
  onVerified: (name: string | null) => void;
}

/**
 * Identity step for the claim flow.
 *
 * SyndixTreasury refuses any claim from an address without a verified identity,
 * so without a way to obtain one the reward flow dead-ends for every wallet but
 * the one the operator issued a name to by hand. On testnet the registry is
 * MockUpIdRegistry, which exposes self-service `claimName` — the same
 * one-name-per-wallet rule as the real up.id resolver, minus Dojang
 * verification. In production this step is replaced by linking an existing
 * `username.up.id`, since names there are issued to Verified Addresses rather
 * than claimed freely.
 */
export function UpIdClaim({ onVerified }: UpIdClaimProps): ReactElement {
  const { address } = useAccount();
  const [nameInput, setNameInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { writeContractAsync } = useWriteContract();

  // The registry is whatever the treasury is pointed at, so a registry swap
  // does not require a rebuild or another env var.
  const { data: registry } = useReadContract({
    address: SYNDIX_CONTRACTS.treasury,
    abi: syndixTreasuryAbi,
    functionName: "readerRegistry",
    query: { enabled: SYNDIX_CONTRACTS.treasury !== ZERO_ADDRESS },
  });

  const registryAddress =
    registry && registry !== ZERO_ADDRESS ? registry : undefined;

  const { data: verified, refetch: refetchVerified } = useReadContract({
    address: registryAddress,
    abi: mockUpIdRegistryAbi,
    functionName: "isVerified",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(registryAddress && address) },
  });

  const { data: existingName, refetch: refetchName } = useReadContract({
    address: registryAddress,
    abi: mockUpIdRegistryAbi,
    functionName: "nameOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(registryAddress && address && verified) },
  });

  useEffect(() => {
    onVerified(verified && existingName ? existingName : null);
  }, [verified, existingName, onVerified]);

  const normalized = normalizeUpId(nameInput);
  const valid = isValidUpId(normalized);

  const claim = useCallback(async () => {
    if (!registryAddress || !valid) return;
    setPending(true);
    setError(null);
    try {
      const hash = await writeContractAsync({
        address: registryAddress,
        abi: mockUpIdRegistryAbi,
        functionName: "claimName",
        args: [normalized],
      });
      const client = createPublicClient({
        chain: giwaSepolia,
        transport: flashblocksTransport,
      });
      await client.waitForTransactionReceipt({
        hash,
        pollingInterval: 100,
        confirmations: 0,
      });
      await Promise.all([refetchVerified(), refetchName()]);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(
        /NameTaken/.test(message)
          ? "That name is already registered to another wallet."
          : /AlreadyNamed/.test(message)
            ? "This wallet already holds a name."
            : message.split("\n")[0],
      );
    } finally {
      setPending(false);
    }
  }, [registryAddress, valid, normalized, writeContractAsync, refetchVerified, refetchName]);

  if (!address) {
    return (
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        Connect a wallet first — the identity is bound to the address the reward
        settles to.
      </p>
    );
  }

  if (verified && existingName) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="positive" icon={BadgeCheck}>
            Verified
          </Badge>
          <Mono className="text-[12px] text-ink">{existingName}</Mono>
        </div>
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          Soul-bound and capped at one per wallet. That cap is what stops the
          reward pool being drained by generated addresses.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        This wallet has no GIWA identity yet. Claim one to unlock the reward —
        one name per wallet, non-transferable.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="upid-input">
          Choose a name
        </label>
        <div
          className={cn(
            "flex min-w-0 flex-1 items-center rounded-[10px] border bg-elevated px-2.5 py-1.5",
            nameInput && !valid ? "border-critical/50" : "border-hairline",
          )}
        >
          <input
            id="upid-input"
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            placeholder="yourname"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent font-mono text-[12.5px] text-ink outline-none placeholder:text-ink-faint"
          />
          <span className="font-mono text-[12.5px] text-ink-faint">.up.id</span>
        </div>
        <Button
          size="sm"
          variant="secondary"
          icon={pending ? LoaderCircle : Fingerprint}
          disabled={!valid || pending || !registryAddress}
          loading={pending}
          onClick={() => void claim()}
        >
          {pending ? "Registering…" : "Claim name"}
        </Button>
      </div>
      {nameInput && !valid ? (
        <p className="text-[11.5px] text-caution">
          3–31 characters, lowercase letters, digits and hyphens.
        </p>
      ) : null}
      {error ? (
        <p className="flex items-start gap-1.5 text-[11.5px] text-critical">
          <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
          {error}
        </p>
      ) : null}
      {!registryAddress ? (
        <p className="text-[11.5px] text-caution">
          No reader registry is configured on the treasury, so identities cannot
          be issued.
        </p>
      ) : null}
    </div>
  );
}
