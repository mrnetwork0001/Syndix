"use client";

import { useRef, type ReactElement, type ReactNode } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Scroll-triggered entrance.
 *
 * The app leaned almost entirely on `transition-colors`, so surfaces changed
 * tint on hover but nothing ever arrived - which is what made dense pages read
 * as static. This gives content a short rise and fade as it enters the
 * viewport, once, and never again.
 *
 * Deliberately small numbers. The house aesthetic is Raycast/Linear, where
 * motion signals hierarchy rather than asking to be watched: 14px of travel
 * over 480ms on an ease-out curve, not a slide across the page.
 *
 * Fires once (`once: true`) because re-animating on every scroll past is the
 * single most common way this technique starts to feel cheap.
 */
export interface RevealProps {
  children: ReactNode;
  /** Seconds to wait before starting. Use for hand-tuned sequencing. */
  delay?: number;
  /** Distance to travel, px. Larger for hero-scale blocks. */
  y?: number;
  className?: string;
  as?: "div" | "section" | "li";
}

export function Reveal({
  children,
  delay = 0,
  y = 14,
  className,
  as = "div",
}: RevealProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const reduce = useReducedMotion();
  // Start slightly before the element is fully on screen, so the motion is
  // finishing as the reader's eye arrives rather than starting then.
  const inView = useInView(ref, { once: true, margin: "-64px 0px -64px 0px" });

  const Component = motion[as];

  if (reduce) {
    const Plain = as;
    return <Plain className={className}>{children}</Plain>;
  }

  return (
    <Component
      ref={ref as never}
      className={cn(className)}
      initial={{ opacity: 0, y }}
      animate={inView ? { opacity: 1, y: 0 } : { opacity: 0, y }}
      transition={{
        duration: 0.48,
        delay,
        ease: [0.22, 1, 0.36, 1],
      }}
    >
      {children}
    </Component>
  );
}

/**
 * Reveals children in sequence.
 *
 * Stagger is what turns a grid of cards from "a page loaded" into "a page
 * assembled". Kept at 60ms: enough to read as ordered, short enough that a
 * twelve-card feed finishes well under a second.
 */
export function RevealGroup({
  children,
  className,
  stagger = 0.06,
}: {
  children: ReactNode;
  className?: string;
  /** Seconds between each child. Travel distance belongs to RevealItem. */
  stagger?: number;
}): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduce = useReducedMotion();
  const inView = useInView(ref, { once: true, margin: "-48px 0px" });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      ref={ref}
      className={className}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: stagger } },
      }}
    >
      {children}
    </motion.div>
  );
}

/** A child of RevealGroup. Inherits the group's timing. */
export function RevealItem({
  children,
  className,
  y = 14,
}: {
  children: ReactNode;
  className?: string;
  y?: number;
}): ReactElement {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      variants={{
        hidden: { opacity: 0, y },
        show: {
          opacity: 1,
          y: 0,
          transition: { duration: 0.48, ease: [0.22, 1, 0.36, 1] },
        },
      }}
    >
      {children}
    </motion.div>
  );
}
