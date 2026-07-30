"use client";

import { useMemo, type ReactElement } from "react";
import { HandCoins, Lock, ShieldCheck, Wallet } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ProtocolStats } from "@/lib/types";
import { IS_LIVE_CHAIN } from "@/lib/giwa";
import { formatEth, formatKrw, formatUsd } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Mono } from "@/components/ui/mono";

export function TreasuryWidget({
  live = false,
  stats,
}: {
  stats: ProtocolStats;
  /** True when `stats` came from the contract rather than the dataset. */
  live?: boolean;
}): ReactElement {
  const { unreservedWei, reservedWei, reservedShare } = useMemo(() => {
    const balance = BigInt(stats.treasuryBalanceWei);
    const reserved = BigInt(stats.reservedRewardsWei);
    const unreserved = balance > reserved ? balance - reserved : BigInt(0);
    const share =
      balance > BigInt(0)
        ? Number((reserved * BigInt(10_000)) / balance) / 100
        : 0;
    return {
      unreservedWei: unreserved.toString(),
      reservedWei: reserved.toString(),
      reservedShare: share,
    };
  }, [stats.treasuryBalanceWei, stats.reservedRewardsWei]);

  return (
    <Panel>
      <PanelHeader
        title="Treasury"
        description="SyndixTreasury balance, split between what the owner can move and what readers are owed."
        icon={Wallet}
        action={
          live ? (
            <Badge tone="positive" dot>
              Live
            </Badge>
          ) : (
            <Badge tone="caution">Simulated</Badge>
          )
        }
      />

      <div className="px-5 pt-4">
        <div className="flex h-1.5 overflow-hidden rounded-full bg-elevated">
          <span
            className="h-full bg-accent"
            style={{ width: `${Math.min(100, reservedShare)}%` }}
          />
          <span className="h-full flex-1 bg-white/15" />
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10.5px] text-ink-faint tabular-nums">
          <span>{reservedShare.toFixed(1)}% reserved for readers</span>
          <span>{(100 - reservedShare).toFixed(1)}% withdrawable</span>
        </div>
      </div>

      <div className="divide-y divide-hairline px-5 pt-2 pb-1">
        <Figure
          icon={Wallet}
          label="Sponsor treasury"
          hint="unreservedBalance() - the only wei the owner can withdraw"
          wei={unreservedWei}
        />
        <Figure
          icon={Lock}
          label="Reader reward pool"
          hint="reservedRewards - escrowed against unclaimed reads"
          wei={reservedWei}
          accent
        />
        <Figure
          icon={HandCoins}
          label="Lifetime distributed"
          hint="Paid out to verified up.id readers since genesis"
          wei={stats.totalRewardDistributedWei}
        />
      </div>

      <div className="px-5 pb-5">
        <div className="rounded-card border border-hairline bg-elevated/60 px-3.5 py-3">
          <span className="inline-flex items-center gap-2 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            <ShieldCheck className="size-3.5" strokeWidth={1.9} />
            Solvency invariant
          </span>
          <p className="mt-2 text-xs leading-relaxed text-ink-muted">
            Reserved rewards are unreachable by the owner:{" "}
            <code className="rounded border border-hairline bg-white/[0.05] px-1 py-px font-mono text-[11px] text-ink">
              withdrawTreasury
            </code>{" "}
            spends only{" "}
            <code className="rounded border border-hairline bg-white/[0.05] px-1 py-px font-mono text-[11px] text-ink">
              unreservedBalance()
            </code>
            , so{" "}
            <span className="font-mono text-[11px] text-ink">
              balance &gt;= reservedRewards
            </span>{" "}
            holds for every reachable state. Fuzzed in{" "}
            <span className="font-mono text-[11px]">
              test/contracts/SyndixTreasury.t.sol
            </span>
            .
          </p>
        </div>

        <div className="mt-3">
          <Button
            variant="primary"
            full
            icon={HandCoins}
            disabled={!IS_LIVE_CHAIN}
            title={
              IS_LIVE_CHAIN
                ? "Deposit sponsorship into SyndixTreasury"
                : "Contract not deployed"
            }
          >
            Deposit sponsorship
          </Button>
          {!IS_LIVE_CHAIN ? (
            <p className="mt-2 text-center text-[11px] text-ink-faint">
              Contract not deployed - set{" "}
              <span className="font-mono">NEXT_PUBLIC_SYNDIX_TREASURY</span> to
              enable deposits.
            </p>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}

function Figure({
  icon: Icon,
  label,
  hint,
  wei,
  accent = false,
}: {
  icon: LucideIcon;
  label: string;
  hint: string;
  wei: string;
  accent?: boolean;
}): ReactElement {
  return (
    <div className="py-3.5">
      <div className="flex items-center gap-2">
        <Icon
          className={accent ? "size-3.5 text-accent" : "size-3.5 text-ink-faint"}
          strokeWidth={1.9}
        />
        <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
          {label}
        </span>
      </div>
      <div
        className={
          accent
            ? "mt-2 font-mono text-[19px] leading-none font-medium tracking-[-0.025em] text-accent tabular-nums"
            : "mt-2 font-mono text-[19px] leading-none font-medium tracking-[-0.025em] text-ink tabular-nums"
        }
      >
        {formatEth(wei)}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Mono className="text-[11px]">{formatUsd(wei)}</Mono>
        <span className="text-ink-faint/50">·</span>
        <Mono className="text-[11px]">{formatKrw(wei)}</Mono>
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{hint}</p>
    </div>
  );
}
