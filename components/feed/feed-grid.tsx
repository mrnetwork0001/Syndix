"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { SearchX } from "lucide-react";
import type { Issue, Track } from "@/lib/types";
import { FilterTabs, type FeedFilter } from "@/components/feed/filter-tabs";
import { IssueCard } from "@/components/feed/issue-card";

export interface FeedGridProps {
  issues: Issue[];
  tracks: Track[];
  className?: string;
}

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const CONTAINER: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.035, delayChildren: 0.02 } },
  exit: { opacity: 0, y: -6, transition: { duration: 0.12, ease: EASE } },
};

const ITEM: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.22, ease: EASE } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
};

const STILL: Variants = { hidden: {}, show: {}, exit: {} };

export function FeedGrid({ issues, tracks, className }: FeedGridProps): ReactElement {
  const [active, setActive] = useState<FeedFilter>("all");
  const [now, setNow] = useState(0);

  /**
   * `now` stays 0 through the server render and the hydrating render, so the
   * two markups agree; the first frame after mount resolves the real clock and
   * a slow interval keeps the relative stamps honest on a long-lived tab.
   */
  useEffect(() => {
    const frame = requestAnimationFrame(() => setNow(Date.now()));
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      cancelAnimationFrame(frame);
      window.clearInterval(timer);
    };
  }, []);

  const counts = useMemo(() => {
    const next: Record<string, number> = { all: issues.length };
    for (const track of tracks) next[track.id] = 0;
    for (const issue of issues) next[issue.track] = (next[issue.track] ?? 0) + 1;
    return next;
  }, [issues, tracks]);

  const filtered = useMemo(
    () => (active === "all" ? issues : issues.filter((issue) => issue.track === active)),
    [issues, active],
  );

  const reduce = useReducedMotion();
  const container = reduce ? STILL : CONTAINER;
  const item = reduce ? STILL : ITEM;

  const [featured, ...rest] = filtered;

  return (
    <section className={className} aria-labelledby="feed-heading">
      <div className="flex flex-col gap-4 border-b border-hairline pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2
            id="feed-heading"
            className="text-[11px] tracking-[0.14em] text-ink-faint uppercase"
          >
            The Feed
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            Every issue is written, scored and illustrated by the agent pipeline.
          </p>
        </div>
        <FilterTabs
          active={active}
          onChange={setActive}
          counts={counts}
          tracks={tracks}
        />
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={active}
          variants={container}
          initial="hidden"
          animate="show"
          exit="exit"
          className="mt-6"
        >
          {featured ? (
            <>
              <motion.div variants={item}>
                <IssueCard issue={featured} now={now} featured />
              </motion.div>

              {rest.length > 0 ? (
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {rest.map((issue) => (
                    <motion.div key={issue.id} variants={item} className="flex">
                      <IssueCard issue={issue} now={now} />
                    </motion.div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <motion.div
              variants={item}
              className="panel flex flex-col items-center justify-center px-6 py-16 text-center"
            >
              <span className="grid size-10 place-items-center rounded-[12px] border border-hairline bg-elevated">
                <SearchX className="size-[18px] text-ink-faint" strokeWidth={1.8} />
              </span>
              <p className="mt-4 text-sm font-medium text-ink">
                No issues in this track yet
              </p>
              <p className="mt-1.5 max-w-sm text-[13px] leading-relaxed text-ink-muted">
                The agent publishes on signal, not on a schedule. Pick another
                track, or run the pipeline yourself in the Agent Studio.
              </p>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

export default FeedGrid;
