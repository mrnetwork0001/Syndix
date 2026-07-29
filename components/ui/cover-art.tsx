import type { ReactElement } from "react";
import type { TrackId } from "@/lib/types";
import { cn, seededRandom } from "@/lib/utils";

export interface CoverArtProps {
  seed: string;
  title: string;
  track: TrackId;
  className?: string;
}

const W = 1600;
const H = 900;

interface Palette {
  /** Darkest corner of the background wash. */
  base: string;
  /** Lit corner of the background wash. */
  deep: string;
  primary: string;
  secondary: string;
  highlight: string;
}

const PALETTES: Record<TrackId, Palette> = {
  "giwa-l2": {
    base: "#05070e",
    deep: "#0b1c3a",
    primary: "#0066ff",
    secondary: "#4d92ff",
    highlight: "#cfe0ff",
  },
  "ai-web3-alpha": {
    base: "#08050f",
    deep: "#1d1240",
    primary: "#7c4ff2",
    secondary: "#a78bfa",
    highlight: "#e4dbff",
  },
  "dev-digest": {
    base: "#031014",
    deep: "#06303f",
    primary: "#12a8c4",
    secondary: "#22d3ee",
    highlight: "#c8f6fd",
  },
  sponsorship: {
    base: "#120a02",
    deep: "#3d2708",
    primary: "#d97f06",
    secondary: "#f5b32b",
    highlight: "#fce6b8",
  },
};

/** Each track gets a different structural emphasis so the four feels distinct. */
const DENSITY: Record<TrackId, { arcs: number; ridges: number; nodes: number }> = {
  "giwa-l2": { arcs: 13, ridges: 6, nodes: 12 },
  "ai-web3-alpha": { arcs: 8, ridges: 5, nodes: 17 },
  "dev-digest": { arcs: 11, ridges: 8, nodes: 10 },
  sponsorship: { arcs: 10, ridges: 6, nodes: 9 },
};

const r2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** FNV-1a — namespaces every gradient/mask id so cards never collide. */
function hashId(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const x0 = r2(cx + r * Math.cos(a0));
  const y0 = r2(cy + r * Math.sin(a0));
  const x1 = r2(cx + r * Math.cos(a1));
  const y1 = r2(cy + r * Math.sin(a1));
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

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

/**
 * Deterministic generative cover art. Every geometric value is drawn from
 * `seededRandom(seed)` in a fixed order, so the server HTML and the client
 * hydration produce byte-identical markup. Nothing here touches the network.
 */
export function CoverArt({
  seed,
  title,
  track,
  className,
}: CoverArtProps): ReactElement {
  const pal = PALETTES[track];
  const den = DENSITY[track];
  const rnd = seededRandom(`${seed}|${track}`);
  const uid = `ca${hashId(`${seed}|${track}`)}`;

  /* ---- background glows ---------------------------------------------- */
  const glowA = {
    x: r2(W * (0.14 + rnd() * 0.3)),
    y: r2(H * (0.08 + rnd() * 0.34)),
    r: r2(W * (0.44 + rnd() * 0.2)),
  };
  const glowB = {
    x: r2(W * (0.6 + rnd() * 0.34)),
    y: r2(H * (0.52 + rnd() * 0.44)),
    r: r2(W * (0.3 + rnd() * 0.18)),
  };

  /* ---- concentric arc field ------------------------------------------ */
  const leftSide = rnd() < 0.5;
  const arcCx = r2(W * (leftSide ? 0.1 + rnd() * 0.16 : 0.74 + rnd() * 0.16));
  const arcCy = r2(H * (0.18 + rnd() * 0.64));

  // The outermost ring is pinned near the frame width so the field always
  // reaches across the canvas, whatever the per-track arc count.
  const arcInner = 78 + rnd() * 54;
  const arcOuter = W * (0.72 + rnd() * 0.42);
  const arcGrowth = (arcOuter / arcInner) ** (1 / Math.max(1, den.arcs - 1));

  const arcs: { d: string; w: number; o: number; c: string }[] = [];
  let radius = arcInner;
  for (let i = 0; i < den.arcs; i++) {
    const a0 = rnd() * Math.PI * 2;
    const span = Math.PI * (0.5 + rnd() * 1.05);
    arcs.push({
      d: arcPath(arcCx, arcCy, r2(radius), a0, a0 + span),
      w: r2(0.9 + rnd() * 2.1),
      o: r2(clamp(0.42 - i * 0.022 + rnd() * 0.08, 0.07, 0.46)),
      c: i % 3 === 0 ? pal.secondary : pal.primary,
    });
    radius *= arcGrowth;
  }

  /* ---- topographic ridges -------------------------------------------- */
  const ridges: { d: string; w: number; o: number; c: string }[] = [];
  for (let i = 0; i < den.ridges; i++) {
    const t = den.ridges === 1 ? 0.5 : i / (den.ridges - 1);
    const baseY = H * (0.29 + 0.6 * t);
    const a1 = 24 + rnd() * 56;
    const a2 = 8 + rnd() * 26;
    const f1 = 0.9 + rnd() * 1.3;
    const f2 = 2.3 + rnd() * 2.6;
    const p1 = rnd() * Math.PI * 2;
    const p2 = rnd() * Math.PI * 2;

    const pts: { x: number; y: number }[] = [];
    for (let x = -60; x <= W + 60; x += 40) {
      const u = x / W;
      pts.push({
        x,
        y:
          baseY +
          a1 * Math.sin(f1 * Math.PI * 2 * u + p1) +
          a2 * Math.sin(f2 * Math.PI * 2 * u + p2),
      });
    }

    ridges.push({
      d: smooth(pts),
      w: r2(1.1 + t * 1.5),
      o: r2(0.12 + t * 0.3),
      c: i % 2 === 0 ? pal.secondary : pal.highlight,
    });
  }

  /* ---- transaction-graph scatter ------------------------------------- */
  const COLS = 6;
  const ROWS = 3;
  const cells: { cx: number; cy: number }[] = [];
  for (let cy = 0; cy < ROWS; cy++) {
    for (let cx = 0; cx < COLS; cx++) cells.push({ cx, cy });
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = cells[i];
    cells[i] = cells[j];
    cells[j] = tmp;
  }

  // Fixed hot count rather than a per-node coin flip: a probability roll can
  // leave a cover with zero accents or half the graph lit.
  const hotCount = 2 + Math.floor(rnd() * 2);

  const nodes = cells.slice(0, Math.min(den.nodes, cells.length)).map((c, i) => ({
    x: r2(((c.cx + 0.16 + rnd() * 0.68) / COLS) * W),
    y: r2(((c.cy + 0.14 + rnd() * 0.72) / ROWS) * H),
    r: r2(2.4 + rnd() * 4.4),
    hot: i < hotCount,
  }));

  const seen = new Set<string>();
  const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
  nodes.forEach((n, i) => {
    const near = nodes
      .map((m, j) => ({ j, d: (m.x - n.x) ** 2 + (m.y - n.y) ** 2 }))
      .filter((o) => o.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, 2);
    for (const o of near) {
      const key = i < o.j ? `${i}:${o.j}` : `${o.j}:${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ x1: n.x, y1: n.y, x2: nodes[o.j].x, y2: nodes[o.j].y });
    }
  });

  const noiseSeed = Math.floor(rnd() * 9000) + 1;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      className={cn("block h-full w-full", className)}
    >
      <title>{title}</title>

      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={pal.deep} />
          <stop offset="55%" stopColor={pal.base} />
          <stop offset="100%" stopColor="#050507" />
        </linearGradient>

        <radialGradient id={`${uid}-glowA`}>
          <stop offset="0%" stopColor={pal.primary} stopOpacity="0.55" />
          <stop offset="45%" stopColor={pal.primary} stopOpacity="0.16" />
          <stop offset="100%" stopColor={pal.primary} stopOpacity="0" />
        </radialGradient>

        <radialGradient id={`${uid}-glowB`}>
          <stop offset="0%" stopColor={pal.secondary} stopOpacity="0.3" />
          <stop offset="100%" stopColor={pal.secondary} stopOpacity="0" />
        </radialGradient>

        <radialGradient id={`${uid}-node`}>
          <stop offset="0%" stopColor={pal.highlight} stopOpacity="0.5" />
          <stop offset="55%" stopColor={pal.secondary} stopOpacity="0.14" />
          <stop offset="100%" stopColor={pal.secondary} stopOpacity="0" />
        </radialGradient>

        <linearGradient id={`${uid}-sheen`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0.055" />
          <stop offset="66%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>

        <radialGradient id={`${uid}-vig`} cx="0.5" cy="0.44" r="0.78">
          <stop offset="40%" stopColor="#000000" stopOpacity="0" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.62" />
        </radialGradient>

        <pattern
          id={`${uid}-grid`}
          width="100"
          height="100"
          patternUnits="userSpaceOnUse"
        >
          <path
            d="M 100 0 L 0 0 0 100"
            fill="none"
            stroke="#ffffff"
            strokeOpacity="0.035"
            strokeWidth="1"
          />
        </pattern>

        <filter id={`${uid}-noise`} x="0" y="0" width="100%" height="100%">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.82"
            numOctaves={3}
            stitchTiles="stitch"
            seed={noiseSeed}
          />
        </filter>

        <pattern
          id={`${uid}-grain`}
          width="200"
          height="200"
          patternUnits="userSpaceOnUse"
        >
          <rect width="200" height="200" filter={`url(#${uid}-noise)`} />
        </pattern>

        {/* Fades the arc field radially out of the frame. */}
        <radialGradient
          id={`${uid}-arcfade`}
          gradientUnits="userSpaceOnUse"
          cx={arcCx}
          cy={arcCy}
          r={W * 0.92}
        >
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="58%" stopColor="#ffffff" stopOpacity="0.65" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${uid}-arcmask`}>
          <rect width={W} height={H} fill={`url(#${uid}-arcfade)`} />
        </mask>

        {/* Contour lines bleed off softly at the left and right edges. */}
        <linearGradient id={`${uid}-hfade`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="14%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="84%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <mask id={`${uid}-ridgemask`}>
          <rect width={W} height={H} fill={`url(#${uid}-hfade)`} />
        </mask>
      </defs>

      <rect width={W} height={H} fill={`url(#${uid}-bg)`} />
      <ellipse
        cx={glowA.x}
        cy={glowA.y}
        rx={glowA.r}
        ry={glowA.r * 0.82}
        fill={`url(#${uid}-glowA)`}
      />
      <ellipse
        cx={glowB.x}
        cy={glowB.y}
        rx={glowB.r}
        ry={glowB.r * 0.7}
        fill={`url(#${uid}-glowB)`}
      />

      <rect width={W} height={H} fill={`url(#${uid}-grid)`} />

      <g mask={`url(#${uid}-arcmask)`} fill="none" strokeLinecap="round">
        {arcs.map((a, i) => (
          <path
            key={`arc-${i}`}
            d={a.d}
            stroke={a.c}
            strokeOpacity={a.o}
            strokeWidth={a.w}
          />
        ))}
      </g>

      <g mask={`url(#${uid}-ridgemask)`} fill="none" strokeLinecap="round">
        {ridges.map((r, i) => (
          <path
            key={`ridge-${i}`}
            d={r.d}
            stroke={r.c}
            strokeOpacity={r.o}
            strokeWidth={r.w}
          />
        ))}
      </g>

      <g>
        {edges.map((e, i) => (
          <line
            key={`edge-${i}`}
            x1={e.x1}
            y1={e.y1}
            x2={e.x2}
            y2={e.y2}
            stroke={pal.secondary}
            strokeOpacity="0.18"
            strokeWidth="1"
          />
        ))}
        {nodes.map((n, i) => (
          <g key={`node-${i}`}>
            <circle
              cx={n.x}
              cy={n.y}
              r={r2(n.r * (n.hot ? 7.5 : 5))}
              fill={`url(#${uid}-node)`}
            />
            {n.hot ? (
              <circle
                cx={n.x}
                cy={n.y}
                r={r2(n.r * 3.1)}
                fill="none"
                stroke={pal.secondary}
                strokeOpacity="0.34"
                strokeWidth="1.1"
              />
            ) : null}
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.hot ? pal.highlight : pal.secondary}
              fillOpacity={n.hot ? 0.95 : 0.62}
            />
          </g>
        ))}
      </g>

      <rect width={W} height={H} fill={`url(#${uid}-sheen)`} />
      <rect width={W} height={H} fill={`url(#${uid}-vig)`} />
      <rect
        width={W}
        height={H}
        fill={`url(#${uid}-grain)`}
        opacity="0.16"
        style={{ mixBlendMode: "overlay" }}
      />
    </svg>
  );
}
