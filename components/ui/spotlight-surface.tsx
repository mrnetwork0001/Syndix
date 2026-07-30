"use client";

import type { ReactElement, ReactNode } from "react";
import { useSpotlight } from "@/lib/use-spotlight";

/**
 * A surface that lights up under the cursor.
 *
 * Exists as its own component so the pointer tracking is the only thing that
 * has to be a Client Component. Marking a card itself `"use client"` looks
 * harmless until a Server Component passes it a lucide icon: components cannot
 * cross the server/client boundary as props, and the page fails to prerender
 * with "Functions cannot be passed directly to Client Components". Keeping the
 * interactive shell separate lets StatTile and friends stay on the server and
 * keep taking `icon` props.
 *
 * Renders a plain div, so it can carry the `panel` classes directly rather than
 * adding a wrapper level - `border-radius: inherit` on the highlight depends on
 * this element being the one with the radius.
 */
export function SpotlightSurface({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}): ReactElement {
  const { ref, onPointerMove, onPointerLeave } = useSpotlight<HTMLDivElement>();

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerLeave={onPointerLeave}
      className={className}
    >
      {children}
    </div>
  );
}
