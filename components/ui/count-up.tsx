"use client";

import { useEffect, useLayoutEffect, useRef, type ReactElement } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";

/**
 * Counts a formatted figure up to its value when it scrolls into view.
 *
 * Takes the already-formatted string rather than a number, so every caller
 * keeps whatever formatter it already uses - `formatEth`, `formatUsd`,
 * `formatKrw`, `formatInt` - and this never has to know about currency, wei or
 * locale. It finds the numeric run inside the string, animates that, and puts
 * the prefix and suffix back untouched. "0.006 ETH" stays "0.006 ETH";
 * "$1,234" keeps its comma and its dollar sign.
 *
 * WHY IT LOOKS THE WAY IT DOES
 *
 * Protocol figures are the one place on the page where motion is doing more
 * than decoration: a number arriving at rest reads as a measurement being
 * taken, which is exactly what these are. It runs once, on entry, over 900ms.
 *
 * SSR renders the final value, so the markup is correct with JavaScript off and
 * for anything reading the page. The reset to zero happens in a layout effect,
 * before the browser paints, so the reader never sees the final figure flash
 * and jump backwards.
 */
export interface CountUpProps {
  /** The finished, formatted string. Rendered verbatim if it holds no number. */
  value: string;
  /** Seconds. */
  duration?: number;
  className?: string;
}

/** Runs before paint on the client, and does not warn during SSR. */
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

const NUMBER = /-?\d[\d,]*\.?\d*/;

export function CountUp({
  value,
  duration = 0.9,
  className,
}: CountUpProps): ReactElement {
  const match = value.match(NUMBER);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLSpanElement | null>(null);
  const inView = useInView(ref, { once: true, margin: "-32px 0px" });

  const raw = match?.[0] ?? "";
  const target = raw ? Number(raw.replace(/,/g, "")) : 0;
  const decimals = raw.includes(".") ? (raw.split(".")[1]?.length ?? 0) : 0;
  const grouped = raw.includes(",");
  const prefix = match ? value.slice(0, match.index) : value;
  const suffix = match ? value.slice((match.index ?? 0) + raw.length) : "";

  const progress = useMotionValue(target);
  const text = useTransform(progress, (n) => {
    const fixed = n.toFixed(decimals);
    return grouped
      ? fixed.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
      : fixed;
  });

  useIsomorphicLayoutEffect(() => {
    if (reduce || !match) return;
    // Held at zero until it is on screen, so a figure below the fold still
    // animates when the reader reaches it rather than finishing unseen.
    progress.set(0);
  }, [reduce, match, progress]);

  useEffect(() => {
    if (reduce || !match || !inView) return;
    const controls = animate(progress, target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
    });
    return () => controls.stop();
  }, [inView, target, duration, reduce, match, progress]);

  // Nothing numeric to animate: render it as given.
  if (!match || !Number.isFinite(target)) {
    return <span className={className}>{value}</span>;
  }

  if (reduce) {
    return (
      <span ref={ref} className={className}>
        {value}
      </span>
    );
  }

  return (
    <span ref={ref} className={className}>
      {prefix}
      <motion.span>{text}</motion.span>
      {suffix}
    </span>
  );
}
