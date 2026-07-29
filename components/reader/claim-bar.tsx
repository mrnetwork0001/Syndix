"use client";

import {
  useCallback,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { ArrowUpRight, BookOpenCheck, Check, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Mono } from "@/components/ui/mono";
import { ClaimModal } from "@/components/reader/claim-modal";
import { explorerTx } from "@/lib/giwa";
import type { Issue } from "@/lib/types";
import { cn, formatEth, formatKrw, formatUsd, shortHash } from "@/lib/utils";

/** Kept in sync with the `id` on the <article> in app/issue/[id]/page.tsx. */
const ARTICLE_ID = "issue-article";

/** Proof-of-read gate: the claim unlocks once this much of the body is behind you. */
const GATE = 0.6;

/** Distance from the document bottom at which the bar yields to the footer. */
const FOOTER_MARGIN = 140;

/* ------------------------------------------------------------------ */
/*  Session claim ledger                                               */
/* ------------------------------------------------------------------ */

/**
 * Claims live in sessionStorage so a reload inside the same tab does not offer
 * a second reward. It is a tiny external store rather than component state
 * because the server render must not read it, and an in-memory mirror keeps
 * the UI correct when storage is blocked (private mode, strict browsers).
 */
const claimMemory = new Map<string, string>();
const claimListeners = new Set<() => void>();

const claimKey = (issueId: number) => `syndix:claim:${issueId}`;

function subscribeClaims(onStoreChange: () => void): () => void {
  claimListeners.add(onStoreChange);
  return () => {
    claimListeners.delete(onStoreChange);
  };
}

function readClaim(key: string): string | null {
  const mirrored = claimMemory.get(key);
  if (mirrored) return mirrored;
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeClaim(key: string, hash: string): void {
  claimMemory.set(key, hash);
  try {
    sessionStorage.setItem(key, hash);
  } catch {
    /* Non-fatal: the in-memory mirror still drives this tab. */
  }
  for (const listener of claimListeners) listener();
}

export function ClaimBar({ issue }: { issue: Issue }): ReactElement {
  const [progress, setProgress] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  const [dwell, setDwell] = useState(0);
  const [open, setOpen] = useState(false);

  const key = claimKey(issue.id);
  const claimedHash = useSyncExternalStore(
    subscribeClaims,
    () => readClaim(key),
    () => null,
  );

  /* Dwell only accrues while the tab is actually in front of the reader. */
  useEffect(() => {
    const timer = setInterval(() => {
      if (!document.hidden) setDwell((seconds) => seconds + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const article = document.getElementById(ARTICLE_ID);
    let frame = 0;

    const measure = () => {
      frame = 0;
      const doc = document.documentElement;
      const viewport = window.innerHeight;
      const scrolled = window.scrollY;

      let depth: number;
      if (article) {
        const rect = article.getBoundingClientRect();
        const top = rect.top + scrolled;
        depth = (scrolled + viewport - top) / Math.max(1, rect.height);
      } else {
        depth = scrolled / Math.max(1, doc.scrollHeight - viewport);
      }

      setProgress(Math.min(1, Math.max(0, depth)));
      setAtEnd(scrolled + viewport >= doc.scrollHeight - FOOTER_MARGIN);
    };

    const onScroll = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);

    return () => {
      if (frame !== 0) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);

  const handleClaimed = useCallback(
    (hash: string) => {
      writeClaim(key, hash);
    },
    [key],
  );

  const unlocked = progress >= GATE;
  const visible = unlocked && !atEnd;

  return (
    <>
      <div
        inert={!visible}
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 transition-[transform,opacity] duration-300",
          "ease-[cubic-bezier(0.16,1,0.3,1)]",
          visible
            ? "translate-y-0 opacity-100"
            : "pointer-events-none translate-y-full opacity-0",
        )}
      >
        <div className="glass border-t border-hairline">
          <div
            aria-hidden
            className="h-px bg-accent/60 transition-[width] duration-150"
            style={{ width: `${Math.round(progress * 100)}%` }}
          />

          <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-5 py-3 sm:px-8">
            {claimedHash ? (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-positive/35 bg-positive/12 text-positive">
                    <Check className="size-4" strokeWidth={2.6} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink">
                      Reward claimed —{" "}
                      <span className="font-mono tabular-nums">
                        {formatKrw(issue.rewardPerReaderWei)}
                      </span>
                    </p>
                    <div className="mt-0.5 flex min-w-0 items-center gap-1.5">
                      <Mono className="truncate text-[11px]">{shortHash(claimedHash)}</Mono>
                      <CopyButton value={claimedHash} className="px-1" />
                      <a
                        href={explorerTx(claimedHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-0.5 rounded-md text-[11px] text-ink-faint transition-colors duration-150 hover:text-ink-muted"
                      >
                        Explorer
                        <ArrowUpRight className="size-3" strokeWidth={2} />
                      </a>
                    </div>
                  </div>
                </div>
                <Badge tone="caution">Simulated — not broadcast</Badge>
              </>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full border border-hairline bg-elevated text-accent">
                    <BookOpenCheck className="size-4" strokeWidth={1.9} />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="positive" dot>
                        Reading verified
                      </Badge>
                      <span className="font-mono text-[11.5px] tabular-nums text-ink-muted">
                        {dwell}s dwell · {Math.round(progress * 100)}% depth
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-faint">
                      Proof-of-read gate — the claim unlocks past {Math.round(GATE * 100)}%
                      of the article and is attested off-chain before settlement.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="hidden text-right sm:block">
                    <p className="font-mono text-[15px] leading-none font-medium tabular-nums text-ink">
                      {formatKrw(issue.rewardPerReaderWei)}
                    </p>
                    <p className="mt-1 font-mono text-[11px] tabular-nums text-ink-faint">
                      {formatUsd(issue.rewardPerReaderWei)} ·{" "}
                      {formatEth(issue.rewardPerReaderWei)}
                    </p>
                  </div>
                  <Button variant="primary" icon={Zap} onClick={() => setOpen(true)}>
                    Claim micro-reward
                  </Button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {open ? (
        <ClaimModal
          issue={issue}
          open
          onClose={() => setOpen(false)}
          dwellSeconds={dwell}
          onClaimed={handleClaimed}
        />
      ) : null}
    </>
  );
}
