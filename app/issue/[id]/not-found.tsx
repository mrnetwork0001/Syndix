import type { ReactElement } from "react";
import Link from "next/link";
import { ArrowLeft, Newspaper } from "lucide-react";

export default function IssueNotFound(): ReactElement {
  return (
    <main className="flex flex-1 items-center justify-center px-5 py-24 sm:px-8">
      <div className="panel grain relative w-full max-w-md overflow-hidden px-7 py-8">
        <span className="grid size-9 place-items-center rounded-[11px] border border-hairline bg-elevated">
          <Newspaper className="size-4 text-ink-muted" strokeWidth={1.9} />
        </span>

        <p className="mt-5 font-mono text-[11px] tracking-[0.16em] text-ink-faint uppercase">
          404 · issue not found
        </p>

        <h1 className="text-gradient mt-2 text-[26px] leading-tight font-semibold tracking-[-0.025em]">
          No issue at that address
        </h1>

        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-muted">
          The syndicate publishes to a fixed, numbered ledger — this id was never minted,
          or the slug has been rewritten. The full archive is one click away.
        </p>

        <Link
          href="/"
          className="mt-6 inline-flex h-9.5 items-center gap-2 rounded-[11px] border border-hairline bg-elevated px-3.5 text-[13.5px] font-medium text-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.045)] transition-[background-color,border-color] duration-200 ease-out hover:border-hairline-strong hover:bg-overlay"
        >
          <ArrowLeft className="size-4" strokeWidth={2} />
          Back to the feed
        </Link>
      </div>
    </main>
  );
}
