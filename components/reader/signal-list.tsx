import type { ReactElement } from "react";
import {
  ArrowUpRight,
  Boxes,
  GitBranch,
  Landmark,
  MessagesSquare,
  Radar,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { Mono } from "@/components/ui/mono";
import { explorerAddress, explorerBlock, explorerTx } from "@/lib/giwa";
import type { SourceSignal } from "@/lib/types";
import { cn, formatInt } from "@/lib/utils";

const KIND_ICON: Record<SourceSignal["kind"], LucideIcon> = {
  onchain: Boxes,
  github: GitBranch,
  governance: Landmark,
  market: TrendingUp,
  social: MessagesSquare,
};

const KIND_LABEL: Record<SourceSignal["kind"], string> = {
  onchain: "Onchain",
  github: "Repo",
  governance: "Governance",
  market: "Market",
  social: "Social",
};

const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const BLOCK = /^\d+$/;
const URL = /^https?:\/\//i;

/**
 * A signal `ref` is a tx hash, a block height, an address, a URL or a repo
 * path depending on `kind`. Anything that resolves on the GIWA explorer gets
 * linked - that is the difference between a citation and a claim.
 */
function refTarget(ref: string): { href: string; external: boolean } | null {
  if (TX_HASH.test(ref)) return { href: explorerTx(ref), external: false };
  if (ADDRESS.test(ref)) return { href: explorerAddress(ref), external: false };
  if (BLOCK.test(ref)) return { href: explorerBlock(Number(ref)), external: false };
  if (URL.test(ref)) return { href: ref, external: true };
  return null;
}

function refLabel(ref: string): string {
  if (TX_HASH.test(ref)) return `tx ${ref.slice(0, 10)}…${ref.slice(-6)}`;
  if (ADDRESS.test(ref)) return `${ref.slice(0, 8)}…${ref.slice(-4)}`;
  if (BLOCK.test(ref)) return `block #${formatInt(Number(ref))}`;
  if (URL.test(ref)) return ref.replace(URL, "").replace(/\/$/, "");
  return ref;
}

function confidenceTone(confidence: number): string {
  if (confidence >= 85) return "bg-positive";
  if (confidence >= 70) return "bg-accent";
  return "bg-caution";
}

function SignalRow({ signal }: { signal: SourceSignal }): ReactElement {
  const Icon = KIND_ICON[signal.kind];
  const target = refTarget(signal.ref);

  return (
    <li className="group flex gap-3 px-5 py-4 transition-colors duration-200 ease-out hover:bg-elevated/60">
      <span className="mt-px grid size-7 shrink-0 place-items-center rounded-[9px] border border-hairline bg-elevated transition-colors duration-200 group-hover:border-hairline-strong">
        <Icon className="size-3.5 text-ink-muted" strokeWidth={1.9} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium tracking-[-0.01em] text-ink">
              {signal.label}
            </p>
            <span className="text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
              {KIND_LABEL[signal.kind]}
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-px">
            <span
              className="h-1 w-12 overflow-hidden rounded-full bg-white/[0.08]"
              role="img"
              aria-label={`Confidence ${signal.confidence} of 100`}
            >
              <span
                className={cn("block h-full rounded-full", confidenceTone(signal.confidence))}
                style={{ width: `${signal.confidence}%` }}
              />
            </span>
            <span className="w-7 text-right font-mono text-[11px] tabular-nums text-ink-muted">
              {signal.confidence}
            </span>
          </div>
        </div>

        <p className="mt-1.5 text-[12.5px] leading-[1.6] text-ink-muted">
          {signal.detail}
        </p>

        {target ? (
          <a
            href={target.href}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md text-ink-faint transition-colors duration-150 hover:text-ink-muted"
          >
            <Mono className="truncate text-[11px] text-inherit">{refLabel(signal.ref)}</Mono>
            <ArrowUpRight className="size-3 shrink-0" strokeWidth={2} />
          </a>
        ) : (
          <Mono className="mt-2 block truncate text-[11px] text-ink-faint">
            {refLabel(signal.ref)}
          </Mono>
        )}
      </div>
    </li>
  );
}

export function SignalList({ signals }: { signals: SourceSignal[] }): ReactElement {
  const onchain = signals.filter((s) => s.kind === "onchain").length;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Source signals"
        description={`What the ingestion pass read before writing. ${onchain} of ${signals.length} came off GIWA directly.`}
        icon={Radar}
      />
      <ul className="divide-y divide-hairline">
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
      </ul>
    </Panel>
  );
}
