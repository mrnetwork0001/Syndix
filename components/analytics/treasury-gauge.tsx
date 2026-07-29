"use client";

import type { ReactElement } from "react";
import { Lock, ShieldAlert, ShieldCheck } from "lucide-react";
import type { ProtocolStats } from "@/lib/types";
import { IS_LIVE_CHAIN } from "@/lib/giwa";
import { formatEth, formatKrw, formatUsd } from "@/lib/utils";

const RESERVED_COLOR = "#4d92ff";
const SURPLUS_COLOR = "#3f3f47";

export function TreasuryGauge({
  stats,
}: {
  stats: ProtocolStats;
}): ReactElement {
  const ZERO = BigInt(0);
  const balance = BigInt(stats.treasuryBalanceWei);
  const reserved = BigInt(stats.reservedRewardsWei);
  const solvent = balance >= reserved;
  const surplus = solvent ? balance - reserved : ZERO;

  // Basis points keep the split exact for wei-scale numbers that would lose
  // precision as JS floats.
  const reservedBps =
    balance === ZERO
      ? 0
      : Number((reserved * BigInt(10_000)) / balance) / 100;
  const reservedPct = Math.min(100, reservedBps);
  const surplusPct = Math.max(0, 100 - reservedPct);

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div>
          <p className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Treasury balance
          </p>
          <p className="mt-1 font-mono text-[26px] leading-none tabular-nums text-ink">
            {formatEth(stats.treasuryBalanceWei)}
          </p>
          <p className="mt-1.5 text-[12px] text-ink-faint">
            {formatUsd(stats.treasuryBalanceWei)} · {formatKrw(stats.treasuryBalanceWei)}
          </p>
        </div>

        <span
          className={
            solvent
              ? "inline-flex items-center gap-1.5 rounded-full bg-positive/[0.12] px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] text-positive uppercase"
              : "inline-flex items-center gap-1.5 rounded-full bg-critical/[0.12] px-2.5 py-1 text-[11px] font-medium tracking-[0.06em] text-critical uppercase"
          }
        >
          {solvent ? (
            <ShieldCheck className="size-3.5" strokeWidth={2.1} />
          ) : (
            <ShieldAlert className="size-3.5" strokeWidth={2.1} />
          )}
          {solvent ? "Fully collateralised" : "Under-collateralised"}
        </span>
      </div>

      <div
        className="mt-5 flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]"
        role="img"
        aria-label={`${reservedPct.toFixed(1)} percent of the treasury is reserved for reader rewards`}
      >
        <span
          className="h-full shrink-0 transition-[width] duration-300 ease-out"
          style={{ width: `${reservedPct}%`, backgroundColor: RESERVED_COLOR }}
        />
        <span
          className="h-full shrink-0 transition-[width] duration-300 ease-out"
          style={{ width: `${surplusPct}%`, backgroundColor: SURPLUS_COLOR }}
        />
      </div>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <LegendItem
          color={RESERVED_COLOR}
          label="Reserved for readers"
          value={formatEth(reserved)}
          note={`${reservedPct.toFixed(1)}% · ${formatUsd(reserved)}`}
        />
        <LegendItem
          color={SURPLUS_COLOR}
          label="Unreserved surplus"
          value={formatEth(surplus)}
          note={`${surplusPct.toFixed(1)}% · ${formatUsd(surplus)}`}
        />
      </dl>

      <p className="mt-4 flex items-start gap-2 border-t border-hairline pt-3.5 text-[12px] leading-relaxed text-ink-muted">
        <Lock className="mt-px size-3.5 shrink-0 text-ink-faint" strokeWidth={2} />
        <span>
          Reserved funds are escrowed per issue and are not reachable by the
          protocol owner — <code className="font-mono text-[11.5px] text-[#c9d7ff]">SyndixTreasury.sol</code>{" "}
          reverts any owner withdrawal that would drop the balance below{" "}
          <code className="font-mono text-[11.5px] text-[#c9d7ff]">totalReserved</code>,
          so every unclaimed reward stays payable.
          {IS_LIVE_CHAIN
            ? ""
            : " Contracts are not deployed in this build, so the figures above are simulated."}
        </span>
      </p>
    </div>
  );
}

function LegendItem({
  color,
  label,
  value,
  note,
}: {
  color: string;
  label: string;
  value: string;
  note: string;
}): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-2 text-[12px] text-ink-muted">
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-[3px]"
          style={{ backgroundColor: color }}
        />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 pl-4">
        <span className="font-mono text-[15px] tabular-nums text-ink">
          {value}
        </span>
        <span className="mt-0.5 block font-mono text-[11px] tabular-nums text-ink-faint">
          {note}
        </span>
      </dd>
    </div>
  );
}

export default TreasuryGauge;
