import { NextRequest } from "next/server";
import { GIWA_RPC_FLASHBLOCKS, GIWA_SEPOLIA_ID } from "@/lib/giwa";
import { AGENT_RUN_SCRIPT } from "@/lib/data/protocol";
import {
  ISSUE_JSON_SCHEMA,
  SYSTEM_PROMPT,
  hasOpenAIKey,
  openaiClient,
  openaiModel,
  type GeneratedIssue,
} from "@/lib/openai";
import {
  hasPinataKey,
  ipfsGatewayUrl,
  pinIssueMetadata,
} from "@/lib/ipfs";
import { ISSUES, TRACKS } from "@/lib/data/issues";
import {
  collectTelemetry,
  telemetryDigest,
  type ChainTelemetry,
} from "@/lib/telemetry";
import type { AgentLogLine, AgentStage, TrackId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Syndix ingestion agent.
 *
 * Two modes, and the response always says which one ran:
 *   - live      OPENAI_API_KEY is set: the issue is genuinely written by
 *               the configured OpenAI model from the signals gathered this request.
 *   - simulated no key: the scripted pipeline in lib/data/protocol replays so
 *               the studio still demos end to end.
 *
 * The ecosystem scan is real in both modes - it reads live head state from
 * GIWA Sepolia over the Flashblocks RPC. That part is not a simulation, so the
 * block numbers in the log are ones a reviewer can look up on the explorer.
 */

type Emit = (event: Record<string, unknown>) => void;

let lineCounter = 0;
function makeLine(
  at: number,
  stage: AgentStage,
  level: AgentLogLine["level"],
  message: string,
  meta?: string,
): AgentLogLine {
  lineCounter += 1;
  return { id: `run-${at}-${lineCounter}`, at, stage, level, message, meta };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function resolveTrack(input: unknown): TrackId {
  const ids = TRACKS.map((t) => t.id);
  return typeof input === "string" && (ids as string[]).includes(input)
    ? (input as TrackId)
    : "giwa-l2";
}

async function runLive(
  emit: Emit,
  track: TrackId,
  startedAt: number,
  telemetry: ChainTelemetry,
): Promise<GeneratedIssue> {
  const client = openaiClient();
  const model = openaiModel();
  const trackLabel = TRACKS.find((t) => t.id === track)?.label ?? track;

  emit({
    type: "log",
    line: makeLine(
      Date.now() - startedAt,
      "synthesizing",
      "info",
      `Dispatching synthesis to ${model}`,
      trackLabel,
    ),
  });

  /**
   * Only what was measured this run.
   *
   * This used to splice signals out of lib/data/issues.ts - hand-authored demo
   * content - and the model reported them as fresh findings, because that is
   * exactly what it was told they were. One such line claimed a 1,842-sample
   * latency benchmark nobody had ever run. The prompt already forbade inventing
   * figures and the model was obeying it; the signals were the lie.
   */
  const signalDigest = telemetryDigest(telemetry);

  const headline = telemetry.blockNumber
    ? `Live GIWA Sepolia head: block ${telemetry.blockNumber}, measured at ${telemetry.takenAt}.`
    : "Live head state was unavailable this run; do not cite a block height.";

  const stream = await client.chat.completions.create({
    model,
    stream: true,
    stream_options: { include_usage: true },
    response_format: { type: "json_schema", json_schema: ISSUE_JSON_SCHEMA },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Write today's Syndix issue for the "${trackLabel}" track.

${headline}

Signals measured this run - these are the ONLY figures you may cite. Every one
was sampled or read from chain moments ago. Do not introduce any other number,
benchmark, percentage or measurement from any source, including your own
knowledge. If a claim needs a figure that is not listed below, make the claim
qualitatively or leave it out. Additional rules, each of which a previous draft
broke:

- Copy figures exactly as listed; do not round, adjust or re-derive them.
- Simple ratios of listed figures are allowed only if you show the division.
- Never report a count of polls, failures, duplicates or repeats unless that
  exact count is listed. Not by subtraction, not by estimate. The listed poll
  totals and distinct-state counts are the only poll figures that may appear.
- Name onchain mechanisms only as the signals name them. The reader claim is
  SyndixTreasury's claimReaderReward; do not attribute it to EAS, ERC standards
  or anything else the signals do not say.

${signalDigest}

Return JSON matching the required schema.`,
      },
    ],
  });

  let text = "";
  let chunks = 0;
  let usage = "";
  for await (const part of stream) {
    const delta = part.choices[0]?.delta?.content;
    if (delta) {
      text += delta;
      chunks += 1;
      // Throttle: one line per ~40 deltas keeps the console readable.
      if (chunks % 40 === 0) {
        emit({
          type: "log",
          line: makeLine(
            Date.now() - startedAt,
            "synthesizing",
            "info",
            "Streaming draft...",
            `${text.length} chars`,
          ),
        });
      }
    }
    if (part.usage) {
      usage = `${part.usage.prompt_tokens} in / ${part.usage.completion_tokens} out`;
    }
    const finish = part.choices[0]?.finish_reason;
    if (finish && finish !== "stop") {
      throw new Error(
        `Generation stopped early (finish_reason: ${finish}). Try again or raise the token limit.`,
      );
    }
  }

  let parsed: GeneratedIssue;
  try {
    parsed = JSON.parse(text) as GeneratedIssue;
  } catch {
    throw new Error("Model returned a response that was not valid JSON.");
  }

  emit({
    type: "log",
    line: makeLine(
      Date.now() - startedAt,
      "scoring",
      "ok",
      `Scored subject line: "${parsed.subjectLine}" (${parsed.engagementIndex})`,
      usage || undefined,
    ),
  });

  return parsed;
}

async function runSimulated(
  emit: Emit,
  track: TrackId,
  startedAt: number,
  signal: AbortSignal,
): Promise<void> {
  let previous = 0;
  for (const line of AGENT_RUN_SCRIPT) {
    if (signal.aborted) return;
    // Replay at the scripted cadence, compressed so a demo does not drag.
    const gap = Math.min(1_400, Math.max(120, (line.at - previous) * 0.45));
    previous = line.at;
    await sleep(gap);
    if (signal.aborted) return;
    emit({ type: "log", line: { ...line, at: Date.now() - startedAt } });
  }

  const source =
    ISSUES.find((issue) => issue.track === track) ?? ISSUES[0];

  emit({
    type: "draft",
    draft: {
      title: source.title,
      standfirst: source.standfirst,
      body: source.body,
      executiveSummary: source.executiveSummary,
      track,
    },
  });
}

export async function POST(request: NextRequest) {
  let track: TrackId = "giwa-l2";
  try {
    const body = await request.json();
    track = resolveTrack((body as { track?: unknown })?.track);
  } catch {
    // Empty or malformed body is fine - fall back to the default track.
  }

  const hasKey = hasOpenAIKey();
  const startedAt = Date.now();
  const encoder = new TextEncoder();
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort());

  const stream = new ReadableStream<Uint8Array>({
    async start(streamController) {
      const emit: Emit = (event) => {
        if (controller.signal.aborted) return;
        streamController.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      };

      try {
        emit({
          type: "log",
          line: makeLine(
            0,
            "scanning",
            "info",
            `Opening GIWA Sepolia session (chain ${GIWA_SEPOLIA_ID})`,
            GIWA_RPC_FLASHBLOCKS,
          ),
        });

        // Measures head state, RPC latency on both endpoints, and treasury
        // state. Whatever comes back here is the complete set of figures the
        // issue may contain.
        const telemetry = await collectTelemetry();

        if (telemetry.blockNumber !== null) {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "ok",
              `Head at block ${telemetry.blockNumber}`,
              `gas ${telemetry.gasPriceWei} wei`,
            ),
          });
        }
        for (const l of telemetry.latency) {
          if (l.samples === 0) continue;
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "ok",
              `${l.label}: p50 ${l.p50Ms}ms, p95 ${l.p95Ms}ms`,
              `${l.samples} samples`,
            ),
          });
        }
        for (const a of telemetry.advance) {
          if (a.polls === 0) continue;
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "ok",
              `${a.label}: ${a.distinctStates} distinct states in ${(a.windowMs / 1000).toFixed(1)}s`,
              `${a.blockTag} tag, ${a.polls} polls`,
            ),
          });
        }
        for (const err of telemetry.errors) {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "warn",
              "Probe failed - the issue will not cite it",
              err.slice(0, 120),
            ),
          });
        }

        if (hasKey) {
          const generated = await runLive(emit, track, startedAt, telemetry);

          // Pin before publishing so contentURI points at retrievable content
          // rather than a decorative CID.
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "pinning",
              "info",
              "Pinning issue metadata to IPFS",
              hasPinataKey() ? "pinata" : "no PINATA_JWT",
            ),
          });

          const pin = await pinIssueMetadata(
            {
              name: generated.title,
              description: generated.standfirst,
              content: generated.body,
              executiveSummary: generated.executiveSummary,
              external_url: "https://docs.giwa.io",
              attributes: [
                { trait_type: "Track", value: track },
                { trait_type: "Sentiment", value: generated.sentiment },
                { trait_type: "Engagement index", value: generated.engagementIndex },
                { trait_type: "Model", value: openaiModel() },
                ...(telemetry.blockNumber
                  ? [
                      {
                        trait_type: "Scanned at block",
                        value: telemetry.blockNumber,
                      },
                    ]
                  : []),
              ],
            },
            controller.signal,
          );

          emit({
            type: "log",
            line: pin.ok
              ? makeLine(
                  Date.now() - startedAt,
                  "pinning",
                  "ok",
                  `Pinned ${pin.size} bytes`,
                  pin.cid,
                )
              : makeLine(
                  Date.now() - startedAt,
                  "pinning",
                  "warn",
                  "Not pinned - publishing is disabled for this draft",
                  pin.reason.slice(0, 140),
                ),
          });

          emit({
            type: "draft",
            draft: {
              title: generated.title,
              standfirst: generated.standfirst,
              body: generated.body,
              executiveSummary: generated.executiveSummary,
              track,
            },
            // The studio needs these to publish onchain; a draft with no
            // contentURI must not be publishable.
            contentURI: pin.ok ? pin.uri : null,
            gatewayUrl: pin.ok ? ipfsGatewayUrl(pin.uri) : null,
            subjectLine: generated.subjectLine,
            engagementIndex: generated.engagementIndex,
            sentiment: generated.sentiment,
          });
        } else {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "synthesizing",
              "warn",
              "OPENAI_API_KEY not set - replaying the recorded pipeline",
              "simulated",
            ),
          });
          await runSimulated(emit, track, startedAt, controller.signal);
        }

        emit({
          type: "done",
          runId: `run_${startedAt.toString(36)}`,
          mode: hasKey ? "live" : "simulated",
          latencyMs: Date.now() - startedAt,
        });
      } catch (error) {
        emit({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        streamController.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
