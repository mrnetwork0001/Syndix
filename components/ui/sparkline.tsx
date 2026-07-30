import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

const W = 100;
const H = 32;
const PAD = 3;

const TONES = {
  accent: "#4d92ff",
  positive: "#22c55e",
  cyan: "#22d3ee",
} as const;

/** FNV-1a - gives each instance a stable, collision-free gradient id. */
function hashId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function smooth(pts: { x: number; y: number }[]): string {
  let d = `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${r2(pts[i].x)} ${r2(pts[i].y)} ${r2(mx)} ${r2(my)}`;
  }
  const last = pts[pts.length - 1];
  return `${d} L ${r2(last.x)} ${r2(last.y)}`;
}

export function Sparkline({
  points,
  className,
  tone = "accent",
}: {
  points: number[];
  className?: string;
  tone?: "accent" | "positive" | "cyan";
}): ReactElement {
  const vals =
    points.length >= 2
      ? points
      : points.length === 1
        ? [points[0], points[0]]
        : [0, 0];

  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const n = vals.length;

  const pts = vals.map((v, i) => ({
    x: (i / (n - 1)) * W,
    y: H - PAD - ((v - min) / span) * (H - PAD * 2),
  }));

  const line = smooth(pts);
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  const colour = TONES[tone];
  const gid = `spark-${hashId(`${tone}:${vals.join(",")}`)}`;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden
      className={cn("block h-8 w-full", className)}
    >
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={colour} stopOpacity="0.26" />
          <stop offset="100%" stopColor={colour} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path
        d={line}
        fill="none"
        stroke={colour}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
