"use client";

import type { ReactElement, ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";

/**
 * Headline that masks up a line at a time, then hands off to the rest of the
 * hero.
 *
 * The lines are split by hand rather than measured at runtime. Splitting text
 * programmatically means reading layout after paint, which either flashes the
 * unsplit headline first or blocks the first frame - and it breaks every time
 * the copy or a breakpoint changes. Two deliberate spans are stable, and the
 * break lands where the type wants it anyway.
 *
 * Each line sits in its own `overflow-hidden` box, so it rises out of a clipped
 * edge instead of fading in place. That is the difference between text that
 * appears and text that arrives.
 *
 * `HeroSequence` staggers everything after the headline on the same clock, so
 * the block reads top to bottom once and then holds still. It runs on mount
 * rather than on scroll: the hero is above the fold, and a scroll trigger would
 * never fire for the reader who matters most.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

export function HeroLines({
  lines,
  className,
}: {
  lines: string[];
  className?: string;
}): ReactElement {
  const reduce = useReducedMotion();

  if (reduce) {
    return (
      <h1 className={className}>
        {lines.map((line) => (
          <span key={line} className="block">
            {line}
          </span>
        ))}
      </h1>
    );
  }

  return (
    <h1 className={className}>
      {lines.map((line, i) => (
        <span key={line} className="block overflow-hidden pb-[0.08em]">
          <motion.span
            className="block"
            initial={{ y: "108%" }}
            animate={{ y: "0%" }}
            transition={{ duration: 0.72, delay: 0.06 + i * 0.09, ease: EASE }}
          >
            {line}
          </motion.span>
        </span>
      ))}
    </h1>
  );
}

/** Fades and lifts one element into place after the headline has moved. */
export function HeroSequence({
  children,
  delay,
  className,
}: {
  children: ReactNode;
  /** Seconds after mount. Hand-tuned against the headline's timing. */
  delay: number;
  className?: string;
}): ReactElement {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.55, delay, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
