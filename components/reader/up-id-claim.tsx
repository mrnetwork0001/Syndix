"use client";

import { useEffect, type ReactElement } from "react";
import { ArrowUpRight, BadgeCheck, Fingerprint, TriangleAlert } from "lucide-react";
import { useAccount } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Mono } from "@/components/ui/mono";
import { UP_ID_PLAYGROUND } from "@/lib/giwa";
import { useUpIdName } from "@/lib/use-up-id";

export interface UpIdClaimProps {
  /**
   * Fires with the reader's verified status and label.
   *
   * `verified` is the onchain answer and the only thing the claim depends on.
   * `name` is cosmetic and may be null even when verified - see below.
   */
  onVerified: (identity: { verified: boolean; name: string | null }) => void;
}

/**
 * Identity step for the claim flow.
 *
 * SyndixTreasury refuses any claim from an address without a verified identity,
 * so this step is load-bearing. It offers no way to obtain one, deliberately:
 * `up.id` names are issued by GIWA through Dojang attestation, and the only
 * honest thing to render for a wallet without one is a pointer at the
 * playground.
 *
 * This component previously offered a self-service "claim any name" form
 * against MockUpIdRegistry. That is gone. A protocol that can issue itself the
 * credential it checks has not built a sybil gate, and a form implying
 * otherwise misrepresents the security model even when the treasury is bound
 * to the real registry.
 *
 * If the treasury is ever pointed at some other IReaderRegistry, the step says
 * so rather than presenting a test gate as the production one.
 */
export function UpIdClaim({ onVerified }: UpIdClaimProps): ReactElement {
  const { address } = useAccount();
  const { verified, name, isRealRegistry, registryAddress } = useUpIdName(address);

  useEffect(() => {
    onVerified({ verified: Boolean(verified), name });
  }, [verified, name, onVerified]);

  if (!address) {
    return (
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        Connect a wallet first - the identity is bound to the address the reward
        settles to.
      </p>
    );
  }

  if (!registryAddress) {
    return (
      <p className="flex items-start gap-1.5 text-[11.5px] text-caution">
        <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
        No reader registry is configured on the treasury, so identities cannot be
        verified.
      </p>
    );
  }

  const registryNotice = isRealRegistry ? null : (
    <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-caution">
      <TriangleAlert className="mt-px size-3.5 shrink-0" strokeWidth={2} />
      The treasury is bound to a non-production reader registry, so this gate is
      not the live Upbit Web3 Names one.
    </p>
  );

  if (verified) {
    return (
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="positive" icon={BadgeCheck}>
            Verified
          </Badge>
          {name ? (
            <Mono className="text-[12px] text-ink">{name}</Mono>
          ) : (
            <Mono className="text-[12px] text-ink-faint">up.id held</Mono>
          )}
        </div>
        <p className="text-[11.5px] leading-relaxed text-ink-faint">
          Verified against the Upbit Web3 Names registry - the same identity used
          across GIWA, soul-bound and one per wallet. That cap is what stops the
          reward pool being drained by generated addresses.
        </p>
        {registryNotice}
      </div>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-[12.5px] leading-relaxed text-ink-muted">
        This wallet holds no <span className="font-mono text-ink">up.id</span>, so
        the treasury will refuse the claim. Names are issued by GIWA, not by
        Syndix - mint one on the playground, then reload this page.
      </p>
      <a
        href={UP_ID_PLAYGROUND}
        target="_blank"
        rel="noreferrer"
        className="inline-flex h-8 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-elevated px-2.5 text-[12.5px] font-medium text-ink transition-colors duration-150 hover:border-white/20 hover:bg-white/[0.06]"
      >
        <Fingerprint className="size-3.5" strokeWidth={2} />
        Get a name on GIWA
        <ArrowUpRight className="size-3.5 text-ink-faint" strokeWidth={2} />
      </a>
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        The flow is a Dojang attestation, then a VerifiedToken, then
        registration. Syndix only reads the result - it deliberately has no power
        to issue an identity to itself.
      </p>
      {registryNotice}
    </div>
  );
}
