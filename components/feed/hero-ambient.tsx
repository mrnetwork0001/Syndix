"use client";

import { useCallback, useRef, type ReactElement } from "react";

/**
 * The hero's light, moved by the cursor.
 *
 * The colour fields already drifted on a long loop, which gives depth but is
 * the same whether anyone is there or not. Parallaxing them against the pointer
 * makes the surface respond to the reader: the panel appears to sit behind
 * glass that shifts as they move across it.
 *
 * Displacement is small and inverted - the far field moves least, against the
 * cursor - because parallax reads as depth only when the layers disagree. Push
 * it further and it stops looking like light and starts looking like a
 * following animation.
 *
 * Written straight to CSS custom properties inside a rAF for the same reason as
 * useSpotlight: pointermove fires every frame, and routing it through React
 * would re-render the hero continuously. Here nothing re-renders at all.
 */
export function HeroAmbient(): ReactElement {
  const root = useRef<HTMLDivElement | null>(null);
  const frame = useRef(0);
  const next = useRef({ x: 0, y: 0, gx: 0, gy: 0 });

  const onPointerMove = useCallback((event: PointerEvent) => {
    const node = root.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    // -1..1 from the centre, so the sign carries the direction.
    next.current = {
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 2,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * 2,
      gx: event.clientX - rect.left,
      gy: event.clientY - rect.top,
    };
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = root.current;
      if (!el) return;
      el.style.setProperty("--px", next.current.x.toFixed(3));
      el.style.setProperty("--py", next.current.y.toFixed(3));
      // Pixel coordinates as well: the parallax wants a signed ratio, the grid
      // mask wants a position it can centre a radial gradient on.
      el.style.setProperty("--gx", `${next.current.gx}px`);
      el.style.setProperty("--gy", `${next.current.gy}px`);
    });
  }, []);

  const attach = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = root.current;
      if (previous) {
        previous.parentElement?.removeEventListener("pointermove", onPointerMove);
      }
      root.current = node;
      // Listen on the hero itself, not this overlay: the overlay is
      // pointer-events:none, so it would never see the cursor.
      node?.parentElement?.addEventListener("pointermove", onPointerMove);
    },
    [onPointerMove],
  );

  return (
    <div
      ref={attach}
      aria-hidden
      className="pointer-events-none absolute inset-0 -z-10 [--gx:50%] [--gy:0px] [--px:0] [--py:0]"
    >
      <div
        className="animate-drift-a absolute -top-[26rem] left-1/2 size-[52rem] -translate-x-1/2 rounded-full bg-accent/20 blur-[150px]"
        style={{
          translate: "calc(var(--px) * 26px) calc(var(--py) * 18px)",
          transition: "translate 700ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      <div
        className="animate-drift-b absolute -bottom-40 left-[6%] size-[26rem] rounded-full bg-violet/10 blur-[130px]"
        style={{
          translate: "calc(var(--px) * -40px) calc(var(--py) * -26px)",
          transition: "translate 900ms cubic-bezier(0.22, 1, 0.36, 1)",
        }}
      />
      <div className="absolute inset-0" style={GRID_STYLE} />
      {/* A brighter copy of the same grid, revealed only around the cursor, so
          the backdrop responds to the reader instead of sitting flat. */}
      <div
        className="hero-grid-spot absolute inset-0"
        style={GRID_HIGHLIGHT_STYLE}
      />
    </div>
  );
}

/** Hairline graph paper, faded out toward the edges so it never reads as a table. */
const GRID_STYLE = {
  backgroundImage:
    "linear-gradient(to right, var(--color-hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hairline) 1px, transparent 1px)",
  backgroundSize: "76px 76px",
  maskImage:
    "radial-gradient(120% 80% at 50% 0%, #000 0%, rgba(0,0,0,0.5) 46%, transparent 78%)",
  WebkitMaskImage:
    "radial-gradient(120% 80% at 50% 0%, #000 0%, rgba(0,0,0,0.5) 46%, transparent 78%)",
} as const;

const GRID_HIGHLIGHT_STYLE = {
  backgroundImage:
    "linear-gradient(to right, var(--color-hairline-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hairline-strong) 1px, transparent 1px)",
  backgroundSize: "76px 76px",
} as const;
