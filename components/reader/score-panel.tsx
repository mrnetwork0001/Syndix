import type { ReactElement } from "react";
import { Ban, Gauge, Minus, Target, TrendingUp, TriangleAlert } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { Panel, PanelHeader } from "@/components/ui/panel";
import type { EngagementScore } from "@/lib/types";
import { cn, formatPct } from "@/lib/utils";

const SENTIMENT: Record<
  EngagementScore["sentiment"],
  { tone: BadgeTone; icon: typeof TrendingUp; label: string }
> = {
  bullish: { tone: "positive", icon: TrendingUp, label: "Bullish" },
  neutral: { tone: "neutral", icon: Minus, label: "Neutral" },
  cautious: { tone: "caution", icon: TriangleAlert, label: "Cautious" },
};

const RADIUS = 34;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

function Arc({ value }: { value: number }): ReactElement {
  const pct = Math.min(100, Math.max(0, value));
  const filled = (pct / 100) * CIRCUMFERENCE;

  return (
    <div className="relative size-[92px] shrink-0">
      <svg viewBox="0 0 92 92" className="size-full -rotate-90" aria-hidden>
        <circle
          cx="46"
          cy="46"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          className="stroke-hairline-strong"
        />
        <circle
          cx="46"
          cy="46"
          r={RADIUS}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-accent"
          strokeDasharray={`${filled.toFixed(2)} ${(CIRCUMFERENCE - filled).toFixed(2)}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-mono text-[28px] leading-none font-medium tracking-[-0.04em] tabular-nums text-ink">
          {pct}
        </span>
        <span className="mt-1 text-[9.5px] tracking-[0.16em] text-ink-faint uppercase">
          / 100
        </span>
      </div>
    </div>
  );
}

export function ScorePanel({ score }: { score: EngagementScore }): ReactElement {
  const sentiment = SENTIMENT[score.sentiment];
  const SentimentIcon = sentiment.icon;

  return (
    <Panel className="overflow-hidden">
      <PanelHeader
        title="Engagement index"
        description="The scoring pass optimises the subject line against this composite before the issue is minted."
        icon={Gauge}
      />

      <div className="flex items-center gap-5 px-5 py-5">
        <Arc value={score.index} />

        <dl className="min-w-0 flex-1 space-y-3.5">
          <div>
            <dt className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              <Target className="size-3" strokeWidth={2} />
              Predicted open rate
            </dt>
            <dd className="mt-1 font-mono text-[19px] leading-none font-medium tabular-nums text-ink">
              {formatPct(score.predictedOpenRate * 100, 1)}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Sentiment
            </dt>
            <dd className="mt-1.5">
              <Badge tone={sentiment.tone} icon={SentimentIcon}>
                {sentiment.label}
              </Badge>
            </dd>
          </div>
        </dl>
      </div>

      <div className="border-t border-hairline px-5 py-4">
        <p className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
          Chosen subject line
        </p>
        <p className="mt-2 text-[13.5px] leading-relaxed font-medium tracking-[-0.012em] text-ink">
          “{score.subjectLine}”
        </p>
      </div>

      {score.rejected.length > 0 ? (
        <div className="border-t border-hairline px-5 py-4">
          <p className="flex items-center gap-1.5 text-[11px] tracking-[0.14em] text-ink-faint uppercase">
            <Ban className="size-3" strokeWidth={2} />
            Rejected candidates
          </p>
          <ul className="mt-2.5 space-y-2">
            {score.rejected.map((candidate) => (
              <li key={candidate.text} className="flex items-start justify-between gap-3">
                <span
                  className={cn(
                    "min-w-0 text-[12.5px] leading-snug text-ink-faint line-through",
                    "decoration-ink-faint/60",
                  )}
                >
                  {candidate.text}
                </span>
                <span className="shrink-0 pt-px font-mono text-[11px] tabular-nums text-ink-faint">
                  {candidate.score}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}
