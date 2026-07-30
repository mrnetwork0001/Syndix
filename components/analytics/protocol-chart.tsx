"use client";

import {
  useMemo,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
} from "recharts";
import type { DailyPoint } from "@/lib/types";
import { IS_LIVE_CHAIN } from "@/lib/giwa";
import { formatEth, formatInt } from "@/lib/utils";

const ACCENT = "#0066ff";
const ACCENT_LIFT = "#4d92ff";
const CYAN = "#22d3ee";
const AXIS = "#6b6b74";
const GRID = "rgba(255,255,255,0.055)";

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Formats "2026-07-14" without touching Date - no timezone drift on the axis. */
function shortDate(iso: string): string {
  const [, month, day] = iso.split("-");
  const index = Number(month) - 1;
  if (!MONTHS[index] || !day) return iso;
  return `${MONTHS[index]} ${Number(day)}`;
}

export function ProtocolChart({
  series,
}: {
  series: DailyPoint[];
}): ReactElement {
  const byDate = useMemo(() => {
    const map = new Map<string, DailyPoint>();
    for (const point of series) map.set(point.date, point);
    return map;
  }, [series]);

  const renderTooltip = (props: TooltipContentProps): ReactNode => {
    if (!props.active || typeof props.label !== "string") return null;
    const point = byDate.get(props.label);
    if (!point) return null;

    return (
      <div className="panel min-w-[188px] px-3 py-2.5">
        <p className="text-[11px] tracking-[0.12em] text-ink-faint uppercase">
          {shortDate(point.date)}
        </p>
        <dl className="mt-2 space-y-1.5">
          <TooltipRow color={ACCENT_LIFT} label="Claims">
            {formatInt(point.claims)}
          </TooltipRow>
          <TooltipRow color={CYAN} label="Active wallets">
            {formatInt(point.activeWallets)}
          </TooltipRow>
          <TooltipRow label="Distributed">
            {formatEth(point.distributedWei, 3)}
          </TooltipRow>
          <TooltipRow label="x402 calls">
            {formatInt(point.x402Calls)}
          </TooltipRow>
        </dl>
      </div>
    );
  };

  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 pb-3">
        <LegendKey color={ACCENT_LIFT} label="Reward claims" />
        <LegendKey color={CYAN} label="Active wallets" dashed />
        <span className="ml-auto text-[11px] tracking-[0.12em] text-ink-faint uppercase">
          {IS_LIVE_CHAIN ? "Indexed from GIWA Sepolia" : "Simulated series"}
        </span>
      </div>

      <div className="h-[248px] w-full min-w-0 sm:h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={series}
            margin={{ top: 6, right: 4, bottom: 0, left: 0 }}
          >
            <defs>
              <linearGradient id="syndix-claims-fill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={ACCENT} stopOpacity={0.42} />
                <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid stroke={GRID} strokeDasharray="0" vertical={false} />

            <XAxis
              dataKey="date"
              tickFormatter={shortDate}
              axisLine={false}
              tickLine={false}
              minTickGap={18}
              tickMargin={10}
              tick={{ fill: AXIS, fontSize: 10.5 }}
            />
            <YAxis
              yAxisId="claims"
              axisLine={false}
              tickLine={false}
              width={38}
              tickMargin={6}
              tick={{ fill: AXIS, fontSize: 10.5 }}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="wallets"
              orientation="right"
              axisLine={false}
              tickLine={false}
              width={38}
              tickMargin={6}
              tick={{ fill: AXIS, fontSize: 10.5 }}
              allowDecimals={false}
            />

            {/* recharts v3 types `content` against its own ValueType/NameType
                generics, which are not assignable from a narrowed handler.
                The cast keeps our precise props without reaching for `any`. */}
            <Tooltip
              content={
                renderTooltip as ComponentProps<typeof Tooltip>["content"]
              }
              cursor={{ stroke: "rgba(255,255,255,0.16)", strokeWidth: 1 }}
            />

            <Area
              yAxisId="claims"
              type="monotone"
              dataKey="claims"
              stroke={ACCENT_LIFT}
              strokeWidth={2}
              fill="url(#syndix-claims-fill)"
              dot={false}
              activeDot={{ r: 3.5, fill: ACCENT_LIFT, stroke: "#0b0b0c", strokeWidth: 2 }}
            />
            <Line
              yAxisId="wallets"
              type="monotone"
              dataKey="activeWallets"
              stroke={CYAN}
              strokeWidth={1.5}
              strokeDasharray="4 4"
              dot={false}
              activeDot={{ r: 3, fill: CYAN, stroke: "#0b0b0c", strokeWidth: 2 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function LegendKey({
  color,
  label,
  dashed = false,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-2 text-[12px] text-ink-muted">
      <span
        aria-hidden
        className="h-[2px] w-4 shrink-0 rounded-full"
        style={
          dashed
            ? {
                backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`,
              }
            : { backgroundColor: color }
        }
      />
      {label}
    </span>
  );
}

function TooltipRow({
  color,
  label,
  children,
}: {
  color?: string;
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-6">
      <dt className="flex items-center gap-1.5 text-[11.5px] text-ink-muted">
        {color ? (
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: color }}
          />
        ) : (
          <span aria-hidden className="size-1.5 shrink-0" />
        )}
        {label}
      </dt>
      <dd className="font-mono text-[12px] tabular-nums text-ink">{children}</dd>
    </div>
  );
}

export default ProtocolChart;
