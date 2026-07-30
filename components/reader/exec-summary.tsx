import type { ReactElement, ReactNode } from "react";
import { Sparkles } from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { Issue } from "@/lib/types";
import { formatMs, compact } from "@/lib/utils";

/**
 * The editorial corpus writes inline code with markdown backticks. The
 * standfirst and the summary bullets are rendered outside the markdown
 * pipeline, so they get this one-token pass rather than raw backticks.
 */
export function InlineText({ text }: { text: string }): ReactElement {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, i): ReactNode => {
        if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
          return (
            <code
              key={i}
              className="rounded-[5px] border border-hairline bg-white/[0.06] px-1 py-px font-mono text-[0.86em] text-ink"
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      })}
    </>
  );
}

export function ExecSummary({ issue }: { issue: Issue }): ReactElement {
  const gen = issue.generation;

  return (
    <Panel className="relative overflow-hidden">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-[2px] bg-gradient-to-b from-accent via-accent/60 to-transparent"
      />

      <PanelHeader
        title="AI executive summary"
        description="Produced by the synthesis pass. No human editor rewrote these."
        icon={Sparkles}
      />

      <ul className="space-y-3.5 px-5 py-4">
        {issue.executiveSummary.map((point, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden
              className="mt-[7px] size-1.5 shrink-0 rounded-full bg-accent/80"
            />
            <span className="text-[13px] leading-[1.65] text-ink-muted">
              <InlineText text={point} />
            </span>
          </li>
        ))}
      </ul>

      {/* Only an agent run has a trace. Seeded issues were written by hand, so
          printing a model, cost and token count for them would be inventing
          telemetry for work no pipeline did. */}
      <footer className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline px-5 py-3">
        {gen.provenance === "agent" ? (
          <>
            <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Run trace
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-muted">
              {gen.model}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              ${gen.costUsd.toFixed(4)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              {formatMs(gen.latencyMs)}
            </span>
            <span className="font-mono text-[11px] tabular-nums text-ink-faint">
              {compact(gen.inputTokens)} in / {compact(gen.outputTokens)} out
            </span>
          </>
        ) : (
          <>
            <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Provenance
            </span>
            <span className="text-[11.5px] text-ink-muted">
              Editorial seed - written by hand, no generation run to report
            </span>
          </>
        )}
      </footer>
    </Panel>
  );
}
