"use client";

import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  ArrowDown,
  Check,
  ChevronRight,
  CircleCheck,
  Gauge,
  ImageIcon,
  Layers,
  OctagonX,
  PenLine,
  Pin,
  Radar,
  Terminal,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { AgentLogLine, AgentStage } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface AgentConsoleProps {
  log: AgentLogLine[];
  stage: AgentStage;
  running: boolean;
}

/** The seven stages the pipeline actually walks through, in execution order. */
const PIPELINE: { id: AgentStage; label: string; icon: LucideIcon }[] = [
  { id: "scanning", label: "Scan", icon: Radar },
  { id: "synthesizing", label: "Synthesize", icon: PenLine },
  { id: "scoring", label: "Score", icon: Gauge },
  { id: "illustrating", label: "Illustrate", icon: ImageIcon },
  { id: "pinning", label: "Pin", icon: Pin },
  { id: "minting", label: "Mint", icon: Layers },
  { id: "complete", label: "Complete", icon: CircleCheck },
];

const LEVEL_GLYPH: Record<AgentLogLine["level"], LucideIcon> = {
  info: ChevronRight,
  ok: Check,
  warn: TriangleAlert,
  error: OctagonX,
};

const LEVEL_TONE: Record<AgentLogLine["level"], string> = {
  info: "text-ink-faint",
  ok: "text-positive",
  warn: "text-caution",
  error: "text-critical",
};

const MESSAGE_TONE: Record<AgentLogLine["level"], string> = {
  info: "text-ink-muted",
  ok: "text-ink",
  warn: "text-caution",
  error: "text-critical",
};

/** Below this many pixels from the bottom the view counts as "pinned". */
const STICK_THRESHOLD = 40;

function stamp(ms: number): string {
  return `+${(ms / 1000).toFixed(1)}s`;
}

export function AgentConsole({
  log,
  stage,
  running,
}: AgentConsoleProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Reset per run by the `key` the parent passes, so scrolling up during one
  // run never leaves the next one detached from the tail.
  const [pinned, setPinned] = useState(true);

  const failed = stage === "failed";
  const activeStage: AgentStage = failed
    ? (log[log.length - 1]?.stage ?? "idle")
    : stage;
  const activeIndex = PIPELINE.findIndex((s) => s.id === activeStage);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setPinned(true);
  }, []);

  // Layout effect so the jump happens in the same frame the row is painted.
  useLayoutEffect(() => {
    if (!pinned) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [log, pinned]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distance <= STICK_THRESHOLD);
  }, []);

  return (
    <div className="panel overflow-hidden">
      {/* Stage tracker */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-hairline px-4 py-3">
        {PIPELINE.map((step, index) => {
          const done = activeIndex > index || activeStage === "complete";
          const current = activeIndex === index;
          const Icon = step.icon;
          return (
            <div key={step.id} className="flex shrink-0 items-center gap-1">
              <div
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 transition-colors duration-200",
                  current && failed && "border-critical/40 bg-critical/[0.12]",
                  current && !failed && "border-accent/40 bg-accent/[0.14]",
                  !current && done && "border-hairline bg-white/[0.04]",
                  !current && !done && "border-transparent",
                )}
              >
                <span className="relative grid size-3.5 place-items-center">
                  <Icon
                    className={cn(
                      "size-3.5",
                      current && failed && "text-critical",
                      current && !failed && "text-[#7fb2ff]",
                      !current && done && "text-positive",
                      !current && !done && "text-ink-faint/70",
                      current && running && !failed && "animate-live-dot",
                    )}
                    strokeWidth={2}
                  />
                </span>
                <span
                  className={cn(
                    "text-[10.5px] font-medium tracking-[0.1em] uppercase",
                    current && failed && "text-critical",
                    current && !failed && "text-[#7fb2ff]",
                    !current && done && "text-ink-muted",
                    !current && !done && "text-ink-faint/70",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {index < PIPELINE.length - 1 ? (
                <span
                  className={cn(
                    "h-px w-3 shrink-0",
                    done ? "bg-hairline-strong" : "bg-hairline",
                  )}
                />
              ) : null}
            </div>
          );
        })}
      </div>

      {/* Console chrome */}
      <div className="flex items-center justify-between gap-3 border-b border-hairline bg-void/40 px-4 py-2">
        <span className="inline-flex items-center gap-2 font-mono text-[11px] text-ink-faint">
          <Terminal className="size-3.5" strokeWidth={1.9} />
          agent@syndix — pipeline
        </span>
        <span className="inline-flex items-center gap-3 font-mono text-[11px] text-ink-faint tabular-nums">
          <span>{log.length} lines</span>
          {running ? (
            <span className="inline-flex items-center gap-1.5 text-[#7fb2ff]">
              <span className="animate-live-dot size-1.5 rounded-full bg-current" />
              streaming
            </span>
          ) : null}
        </span>
      </div>

      {/* Log */}
      <div className="relative">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          role="log"
          aria-live="polite"
          aria-label="Agent pipeline log"
          className="h-[22rem] overflow-y-auto bg-void/70 py-2 font-mono text-xs"
        >
          {log.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2.5 px-6 text-center">
              <span className="grid size-9 place-items-center rounded-card border border-hairline bg-elevated">
                <Terminal className="size-4 text-ink-faint" strokeWidth={1.7} />
              </span>
              <p className="font-sans text-[13px] text-ink-muted">
                No run yet.
              </p>
              <p className="max-w-xs font-sans text-xs leading-relaxed text-ink-faint">
                Pick a track and start a stage. Every line is timestamped from
                the moment the run opened.
              </p>
            </div>
          ) : (
            log.map((line, index) => {
              const Glyph = LEVEL_GLYPH[line.level];
              return (
                <div
                  key={`${line.id}-${index}`}
                  className="flex items-start gap-2.5 px-4 py-[3px] transition-colors duration-150 hover:bg-white/[0.022]"
                >
                  <span className="w-11 shrink-0 pt-px text-right text-ink-faint/80 tabular-nums">
                    {stamp(line.at)}
                  </span>
                  <Glyph
                    className={cn(
                      "mt-[3px] size-3 shrink-0",
                      LEVEL_TONE[line.level],
                    )}
                    strokeWidth={2.2}
                  />
                  <div className="min-w-0 flex-1">
                    <span
                      className={cn(
                        "break-words",
                        MESSAGE_TONE[line.level],
                      )}
                    >
                      {line.message}
                    </span>
                    {line.meta ? (
                      <span className="mt-0.5 block truncate text-ink-faint/80 md:hidden">
                        {line.meta}
                      </span>
                    ) : null}
                  </div>
                  {line.meta ? (
                    <span className="hidden max-w-[36%] shrink-0 truncate pt-px text-right text-ink-faint/80 md:block">
                      {line.meta}
                    </span>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {!pinned && log.length > 0 ? (
          <button
            type="button"
            onClick={scrollToLatest}
            className={cn(
              "glass absolute bottom-3 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5",
              "rounded-full px-3 py-1.5 text-[11px] font-medium tracking-[0.04em] text-ink-muted",
              "transition-colors duration-150 hover:border-hairline-strong hover:text-ink",
            )}
          >
            <ArrowDown className="size-3.5" strokeWidth={2.1} />
            Jump to latest
          </button>
        ) : null}
      </div>
    </div>
  );
}
