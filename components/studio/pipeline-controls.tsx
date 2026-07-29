"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import {
  Cpu,
  ImageIcon,
  Info,
  Layers,
  PenLine,
  Radar,
  Square,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import type { AgentLogLine, AgentStage, TrackId } from "@/lib/types";
import { TRACKS } from "@/lib/data/issues";
import { AGENT_RUN_SCRIPT } from "@/lib/data/protocol";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { AgentConsole } from "@/components/studio/agent-console";
import { DraftPreview, type DraftIssue } from "@/components/studio/draft-preview";

/**
 * Everything the studio needs to know about the archive. Deliberately not the
 * whole `Issue[]` — this is a client component, so every field would be
 * serialised into the RSC payload, and the markdown bodies alone are tens of
 * kilobytes the studio never reads.
 */
export interface ArchiveSummary {
  count: number;
  /** The id the next published issue would take. */
  nextIssueId: number;
}

type ActionId = "scan" | "draft" | "cover" | "publish";

type RunMode = "live" | "simulated" | "scripted";

type RunEvent =
  | { type: "log"; line: AgentLogLine }
  | { type: "draft"; draft: DraftIssue }
  | { type: "done"; runId: string; mode: "live" | "simulated"; latencyMs: number }
  | { type: "error"; message: string };

interface ActionSpec {
  id: ActionId;
  label: string;
  icon: LucideIcon;
  /** Which pipeline stages this action is responsible for. */
  stages: AgentStage[];
  source: string;
  primary?: boolean;
}

const ACTIONS: ActionSpec[] = [
  {
    id: "scan",
    label: "Run ecosystem scan",
    icon: Radar,
    stages: ["scanning"],
    source: "Scripted replay",
  },
  {
    id: "draft",
    label: "Generate draft issue",
    icon: PenLine,
    stages: ["synthesizing", "scoring"],
    source: "Live route · POST /api/agent/run",
    primary: true,
  },
  {
    id: "cover",
    label: "Generate cover art",
    icon: ImageIcon,
    stages: ["illustrating"],
    source: "Scripted replay",
  },
  {
    id: "publish",
    label: "Mint & publish to GIWA Sepolia",
    icon: Layers,
    stages: ["pinning", "minting", "complete"],
    source: "Scripted replay",
  },
];

/**
 * Selected-chip fills, one per track. `giwa-l2` uses the same lifted blue the
 * Badge primitive does: the true accent (#0066ff) is too dark to read as text
 * at this size, so it stays on the border and fill only.
 */
const TRACK_TONE: Record<TrackId, string> = {
  "giwa-l2": "border-accent/45 bg-accent/[0.14] text-[#7fb2ff]",
  "ai-web3-alpha": "border-violet/40 bg-violet/[0.12] text-violet",
  "dev-digest": "border-cyan/40 bg-cyan/[0.12] text-cyan",
  sponsorship: "border-positive/40 bg-positive/[0.12] text-positive",
};

/** Resolves as soon as `ms` elapses, or immediately if the run is aborted. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish);
  });
}

function parseEvent(raw: string): RunEvent | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const type = (value as { type?: unknown }).type;
  if (type === "log" || type === "draft" || type === "done" || type === "error") {
    return value as RunEvent;
  }
  return null;
}

export function PipelineControls({
  archive,
}: {
  archive: ArchiveSummary;
}): ReactElement {
  const [track, setTrack] = useState<TrackId>("giwa-l2");
  const [log, setLog] = useState<AgentLogLine[]>([]);
  const [stage, setStage] = useState<AgentStage>("idle");
  const [draft, setDraft] = useState<DraftIssue | null>(null);
  const [active, setActive] = useState<ActionId | null>(null);
  const [mode, setMode] = useState<RunMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  /** Bumped per run; used as the console's key so its scroll state resets. */
  const [runSeq, setRunSeq] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const startedAtRef = useRef(0);

  const running = active !== null;

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Elapsed clock, driven only while a run is open so idle renders stay stable.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => {
      setElapsed(Date.now() - startedAtRef.current);
    }, 100);
    return () => clearInterval(id);
  }, [running]);

  const push = useCallback((line: AgentLogLine) => {
    setLog((previous) => [...previous, line]);
    setStage(line.stage);
  }, []);

  const beginRun = useCallback((id: ActionId) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    startedAtRef.current = Date.now();
    setActive(id);
    setLog([]);
    setStage("idle");
    setError(null);
    setMode(null);
    setElapsed(0);
    setRunSeq((previous) => previous + 1);
    return controller;
  }, []);

  const endRun = useCallback(() => {
    setActive(null);
    setElapsed(Date.now() - startedAtRef.current);
  }, []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  /** Replays the recorded trace for a set of stages, on the scripted cadence. */
  const replay = useCallback(
    async (stages: AgentStage[], signal: AbortSignal) => {
      const slice = AGENT_RUN_SCRIPT.filter((line) =>
        stages.includes(line.stage),
      );
      let previous = slice[0]?.at ?? 0;
      for (const line of slice) {
        const gap = Math.min(1_100, Math.max(140, (line.at - previous) * 0.4));
        previous = line.at;
        await wait(gap, signal);
        if (signal.aborted) return;
        push({ ...line, at: Date.now() - startedAtRef.current });
      }
    },
    [push],
  );

  const runScripted = useCallback(
    async (spec: ActionSpec) => {
      const controller = beginRun(spec.id);
      setMode("scripted");
      try {
        await replay(spec.stages, controller.signal);
        if (controller.signal.aborted) {
          setStage("failed");
          setError("Run stopped.");
        }
      } finally {
        endRun();
      }
    },
    [beginRun, endRun, replay],
  );

  const runDraft = useCallback(async () => {
    const controller = beginRun("draft");
    try {
      const response = await fetch("/api/agent/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ track }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new Error(
          `Pipeline route returned ${response.status} ${response.statusText || ""}`.trim(),
        );
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      const dispatch = (raw: string) => {
        const event = parseEvent(raw);
        if (!event) return;
        switch (event.type) {
          case "log":
            push(event.line);
            break;
          case "draft":
            setDraft(event.draft);
            break;
          case "done":
            setMode(event.mode);
            setStage("complete");
            break;
          case "error":
            setError(event.message);
            setStage("failed");
            break;
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n");
        // The last element is either "" or a partial line — keep it buffered.
        buffer = parts.pop() ?? "";
        for (const part of parts) dispatch(part);
      }

      buffer += decoder.decode();
      if (buffer.trim()) dispatch(buffer);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStage("failed");
        setError("Run stopped.");
      } else {
        setStage("failed");
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      endRun();
    }
  }, [beginRun, endRun, push, track]);

  const onAction = useCallback(
    (spec: ActionSpec) => {
      if (spec.id === "draft") {
        void runDraft();
        return;
      }
      void runScripted(spec);
    },
    [runDraft, runScripted],
  );

  const modeBadge = useMemo(() => {
    if (mode === "live") {
      return (
        <Badge tone="positive" dot>
          Live — claude-opus-5
        </Badge>
      );
    }
    if (mode === "simulated")
      return <Badge tone="caution">Simulated pipeline</Badge>;
    if (mode === "scripted") return <Badge tone="caution">Scripted replay</Badge>;
    if (running)
      return (
        <Badge tone="accent" dot>
          Running
        </Badge>
      );
    if (stage === "failed") return <Badge tone="critical">Stopped</Badge>;
    return <Badge tone="neutral">Idle</Badge>;
  }, [mode, running, stage]);

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <Panel>
        <PanelHeader
          title="Pipeline"
          description={`The four stages of the Syndix ingestion agent. ${archive.count} issues in the archive — the next run drafts #${archive.nextIssueId}.`}
          icon={Cpu}
          action={
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-ink-faint tabular-nums">
                {(elapsed / 1000).toFixed(1)}s
              </span>
              {modeBadge}
            </div>
          }
        />

        <div className="px-5 py-4">
          <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            Track
          </span>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {TRACKS.map((option) => {
              const selected = option.id === track;
              return (
                <button
                  key={option.id}
                  type="button"
                  disabled={running}
                  onClick={() => setTrack(option.id)}
                  aria-pressed={selected}
                  title={option.blurb}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-[12px] font-medium",
                    "transition-colors duration-200 ease-out",
                    "disabled:pointer-events-none disabled:opacity-45",
                    selected
                      ? TRACK_TONE[option.id]
                      : "border-hairline bg-elevated text-ink-muted hover:border-hairline-strong hover:bg-overlay hover:text-ink",
                  )}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-x-2 gap-y-3 border-t border-hairline px-5 py-4 sm:grid-cols-2">
          {ACTIONS.map((spec) => (
            <div key={spec.id} className="min-w-0">
              <Button
                variant={spec.primary ? "primary" : "secondary"}
                icon={spec.icon}
                full
                loading={active === spec.id}
                disabled={running && active !== spec.id}
                onClick={() => onAction(spec)}
              >
                {spec.label}
              </Button>
              <p className="mt-1.5 truncate px-1 text-[10.5px] tracking-[0.1em] text-ink-faint uppercase">
                {spec.source}
              </p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-hairline px-5 py-3.5">
          <p className="flex min-w-0 items-start gap-2 text-[11px] leading-relaxed text-ink-faint">
            <Info className="mt-px size-3.5 shrink-0" strokeWidth={1.9} />
            <span>
              Only <span className="text-ink-muted">Generate draft issue</span>{" "}
              hits the pipeline route. The other three replay the recorded trace
              in{" "}
              <span className="font-mono">lib/data/protocol.ts</span> so the
              studio demos without an API key.
            </span>
          </p>
          {running ? (
            <Button variant="danger" size="sm" icon={Square} onClick={stop}>
              Stop
            </Button>
          ) : null}
        </div>

        <div className="border-t border-hairline px-5 py-3.5">
          <p className="text-[11px] leading-relaxed text-ink-faint">
            {mode === "live"
              ? "ANTHROPIC_API_KEY is set — this issue was written by claude-opus-5 against live GIWA Sepolia head state."
              : "Set ANTHROPIC_API_KEY in .env.local to switch the studio from the recorded trace to real generation with claude-opus-5. The chain scan reads live head state either way."}
          </p>
        </div>

        {error ? (
          <div className="mx-5 mb-5 flex items-start gap-2 rounded-card border border-critical/30 bg-critical/[0.1] px-3.5 py-2.5">
            <TriangleAlert
              className="mt-px size-3.5 shrink-0 text-critical"
              strokeWidth={2}
            />
            <span className="text-xs leading-relaxed text-critical">{error}</span>
          </div>
        ) : null}
      </Panel>

      <AgentConsole key={runSeq} log={log} stage={stage} running={running} />

      <DraftPreview draft={draft} />
    </div>
  );
}
