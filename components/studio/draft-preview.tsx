"use client";

import { useMemo, type ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { BookOpen, FileText, Sparkles, Type, type LucideIcon } from "lucide-react";
import type { Issue } from "@/lib/types";
import { trackMeta } from "@/lib/data/protocol";
import { Badge } from "@/components/ui/badge";
import { CoverArt } from "@/components/ui/cover-art";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

export type DraftIssue = Pick<
  Issue,
  "title" | "standfirst" | "body" | "executiveSummary" | "track"
>;

const WORDS_PER_MINUTE = 220;

function measure(body: string): { words: number; minutes: number } {
  const words = body.trim().split(/\s+/).filter(Boolean).length;
  return { words, minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)) };
}

export function DraftPreview({
  draft,
}: {
  draft: DraftIssue | null;
}): ReactElement {
  const stats = useMemo(
    () => (draft ? measure(draft.body) : { words: 0, minutes: 0 }),
    [draft],
  );

  if (!draft) {
    return (
      <Panel>
        <PanelHeader
          title="Draft preview"
          description="The generated issue lands here — cover, deck, summary and full markdown body."
          icon={FileText}
        />
        <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
          <span className="grid size-10 place-items-center rounded-card border border-hairline bg-elevated">
            <Sparkles className="size-4 text-ink-faint" strokeWidth={1.7} />
          </span>
          <p className="max-w-xs text-[13px] leading-relaxed text-ink-muted">
            No draft yet. Run{" "}
            <span className="text-ink">Generate draft issue</span> to stream one
            out of the pipeline.
          </p>
        </div>
      </Panel>
    );
  }

  const track = trackMeta(draft.track);

  return (
    <Panel className="animate-rise overflow-hidden">
      <PanelHeader
        title="Draft preview"
        description="Not pinned to IPFS and not minted — this is the agent's output before the publish step."
        icon={FileText}
        action={
          <Badge tone={track.tone}>{track.label}</Badge>
        }
      />

      <div className="px-5 pt-5">
        <div className="relative aspect-[16/9] w-full overflow-hidden rounded-card border border-hairline">
          <CoverArt seed={draft.title} title={draft.title} track={draft.track} />
        </div>
      </div>

      <div className="px-5 pt-5">
        <h2 className="text-gradient text-[22px] leading-[1.22] font-semibold tracking-[-0.025em] text-balance">
          {draft.title}
        </h2>
        <p className="mt-2.5 text-[14px] leading-relaxed text-ink-muted text-pretty">
          {draft.standfirst}
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-y border-hairline py-2.5">
          <Metric icon={Type} label="Words" value={stats.words.toLocaleString("en-US")} />
          <Metric icon={BookOpen} label="Read" value={`${stats.minutes} min`} />
          <Metric
            icon={Sparkles}
            label="Summary"
            value={`${draft.executiveSummary.length} points`}
          />
        </div>
      </div>

      {draft.executiveSummary.length > 0 ? (
        <div className="px-5 pt-5">
          <div className="rounded-card border border-accent/25 bg-accent-soft/50 px-4 py-3.5">
            <span className="text-[11px] tracking-[0.14em] text-[#7fb2ff] uppercase">
              Executive summary
            </span>
            <ul className="mt-2.5 space-y-2">
              {draft.executiveSummary.map((point, index) => (
                <li
                  key={`${index}-${point.slice(0, 24)}`}
                  className="flex gap-2.5 text-[13px] leading-relaxed text-ink-muted"
                >
                  <span className="mt-[7px] size-1 shrink-0 rounded-full bg-accent" />
                  <span className="text-pretty">{point}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      <div className="px-5 py-5">
        <div className="flex items-center justify-between gap-3 pb-2">
          <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Markdown body
          </span>
          <span className="font-mono text-[11px] text-ink-faint tabular-nums">
            {stats.words.toLocaleString("en-US")} w
          </span>
        </div>
        <div
          className={cn(
            "max-h-[26rem] overflow-y-auto rounded-card border border-hairline bg-void/60",
            "px-5 py-4",
          )}
        >
          <div className="markdown text-[15px]">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {draft.body}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </Panel>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-2">
      <Icon className="size-3.5 text-ink-faint" strokeWidth={1.8} />
      <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {label}
      </span>
      <span className="font-mono text-xs text-ink tabular-nums">{value}</span>
    </span>
  );
}
