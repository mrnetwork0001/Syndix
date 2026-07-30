"use client";

import { useCallback, useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * Tracks the pointer across a surface so it can light up under the cursor.
 *
 * Everything interactive in the app was a binary hover: the cursor is either
 * over an element or it is not, and a colour swaps. Nothing responded to *where*
 * the pointer was, which is the difference between a page that reacts and a page
 * that merely acknowledges. This publishes the pointer's position as CSS custom
 * properties on the element, and the `spotlight` utility paints a soft radial
 * highlight there.
 *
 * WHY CSS VARIABLES RATHER THAN STATE
 *
 * A pointermove fires on every frame the cursor is in motion. Routing that
 * through React state would re-render the subtree dozens of times a second, and
 * on the feed that is twelve cards plus their images. Writing a custom property
 * on the node skips React entirely: the browser recomputes one gradient on the
 * compositor and nothing re-renders.
 *
 * Reads are batched into a rAF so a burst of pointer events in a single frame
 * costs one style write rather than twenty.
 */
export function useSpotlight<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const frame = useRef(0);
  const next = useRef({ x: 0, y: 0 });

  const onPointerMove = useCallback((event: ReactPointerEvent<T>) => {
    const node = ref.current;
    if (!node) return;

    const rect = node.getBoundingClientRect();
    next.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };

    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      const el = ref.current;
      if (!el) return;
      el.style.setProperty("--spot-x", `${next.current.x}px`);
      el.style.setProperty("--spot-y", `${next.current.y}px`);
    });
  }, []);

  const onPointerLeave = useCallback(() => {
    if (frame.current) {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
    // Left where it was: the highlight fades out in place rather than snapping
    // back to centre, which would read as a glitch on the way out.
  }, []);

  return { ref, onPointerMove, onPointerLeave };
}
