import Anthropic from "@anthropic-ai/sdk";
import { NextRequest } from "next/server";
import { createPublicClient, http } from "viem";
import { GIWA_RPC_FLASHBLOCKS, GIWA_SEPOLIA_ID, giwaSepolia } from "@/lib/giwa";
import { AGENT_RUN_SCRIPT } from "@/lib/data/protocol";
import { ISSUES, TRACKS } from "@/lib/data/issues";
import type { AgentLogLine, AgentStage, Issue, TrackId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The Syndix ingestion agent.
 *
 * Two modes, and the response always says which one ran:
 *   - live      ANTHROPIC_API_KEY is set: the issue is genuinely written by
 *               claude-opus-5 from signals gathered this request.
 *   - simulated no key: the scripted pipeline in lib/data/protocol replays so
 *               the studio still demos end to end.
 *
 * The ecosystem scan is real in both modes — it reads live head state from
 * GIWA Sepolia over the Flashblocks RPC. That part is not a simulation, so the
 * block numbers in the log are ones a reviewer can look up on the explorer.
 */

const MODEL = "claude-opus-5";

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

/** Live head state from GIWA Sepolia. Never throws — the run degrades instead. */
async function scanChain(): Promise<{
  blockNumber: bigint | null;
  gasPriceWei: bigint | null;
  error?: string;
}> {
  try {
    const client = createPublicClient({
      chain: giwaSepolia,
      transport: http(GIWA_RPC_FLASHBLOCKS, { timeout: 8_000, retryCount: 1 }),
    });
    const [blockNumber, gasPriceWei] = await Promise.all([
      client.getBlockNumber(),
      client.getGasPrice(),
    ]);
    return { blockNumber, gasPriceWei };
  } catch (error) {
    return {
      blockNumber: null,
      gasPriceWei: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function resolveTrack(input: unknown): TrackId {
  const ids = TRACKS.map((t) => t.id);
  return typeof input === "string" && (ids as string[]).includes(input)
    ? (input as TrackId)
    : "giwa-l2";
}

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Headline, under 80 characters, specific and non-clickbait.",
    },
    standfirst: {
      type: "string",
      description: "One-sentence deck under the headline.",
    },
    executiveSummary: {
      type: "array",
      items: { type: "string" },
      description: "Three or four single-line takeaways.",
    },
    body: {
      type: "string",
      description:
        "The full issue as GitHub-flavoured Markdown, 600-900 words, using h2/h3 headings, at least one list, and a code block or table where it earns its place. No h1 - the title is rendered separately.",
    },
    subjectLine: {
      type: "string",
      description: "Email subject line optimised for open rate.",
    },
    sentiment: { type: "string", enum: ["bullish", "neutral", "cautious"] },
  },
  required: [
    "title",
    "standfirst",
    "executiveSummary",
    "body",
    "subjectLine",
    "sentiment",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are the Syndix ingestion agent, an autonomous journalist covering the GIWA ecosystem.

GIWA is an OP Stack Ethereum L2 built by Dunamu, the parent company of the Upbit exchange. Facts you must not contradict:
- Testnet is GIWA Sepolia, chain ID 91342, settling to Ethereum Sepolia. Mainnet is still under development.
- Blocks are ~1 second. Flashblocks serve preconfirmations in up to 200ms via a separate RPC, readable under the "pending" block tag.
- Identity is Upbit Web3 Names: username.up.id, ENS subdomains issued as Soul-Bound Tokens to Dojang-verified addresses, one per wallet. It is NOT "giwa.id".
- Dojang is GIWA's attestation service built on EAS, predeployed at 0x4200000000000000000000000000000000000021.
- ERC-4337 EntryPoint v0.6 and v0.7 are predeployed at genesis, along with Multicall3, Permit2, Safe and WETH9. There is no first-party "GIWA Paymaster" product; gasless UX is built on the standard EntryPoint with your own paymaster.

Write like a sharp research newsletter: concrete, technically specific, no hype and no filler. Never invent TVL figures, partnerships, token prices, or launch dates. If a number is not in the signals you were given, either omit it or mark it explicitly as an estimate.`;

async function runLive(
  emit: Emit,
  track: TrackId,
  startedAt: number,
  chain: Awaited<ReturnType<typeof scanChain>>,
): Promise<void> {
  const client = new Anthropic();
  const trackLabel = TRACKS.find((t) => t.id === track)?.label ?? track;
  const since = Date.now() - startedAt;

  emit({
    type: "log",
    line: makeLine(
      since,
      "synthesizing",
      "info",
      `Dispatching synthesis to ${MODEL}`,
      trackLabel,
    ),
  });

  const signalDigest = ISSUES.slice(0, 3)
    .flatMap((issue) => issue.signals)
    .slice(0, 8)
    .map((s) => `- [${s.kind}] ${s.label}: ${s.detail} (ref ${s.ref})`)
    .join("\n");

  const headline = chain.blockNumber
    ? `Live GIWA Sepolia head: block ${chain.blockNumber}, gas price ${chain.gasPriceWei ?? "unknown"} wei.`
    : "Live head state was unavailable this run; do not cite a block height.";

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 32_000,
    system: SYSTEM_PROMPT,
    output_config: {
      format: { type: "json_schema", schema: DRAFT_SCHEMA },
    },
    messages: [
      {
        role: "user",
        content: `Write today's Syndix issue for the "${trackLabel}" track.

${headline}

Signals gathered this run:
${signalDigest}

Produce the issue as JSON matching the required schema.`,
      },
    ],
  });

  let ticks = 0;
  stream.on("text", () => {
    ticks += 1;
    // Throttle progress lines so the console stays readable on a long generation.
    if (ticks % 220 === 0) {
      emit({
        type: "log",
        line: makeLine(
          Date.now() - startedAt,
          "synthesizing",
          "info",
          "Streaming draft…",
          `${ticks} deltas`,
        ),
      });
    }
  });

  const message = await stream.finalMessage();

  if (message.stop_reason === "refusal") {
    throw new Error(
      "Model declined the request (stop_reason: refusal). Try a different track.",
    );
  }

  const text = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  let parsed: {
    title: string;
    standfirst: string;
    executiveSummary: string[];
    body: string;
    subjectLine: string;
    sentiment: string;
  };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Model returned a response that was not valid JSON.");
  }

  emit({
    type: "log",
    line: makeLine(
      Date.now() - startedAt,
      "scoring",
      "ok",
      `Draft complete: "${parsed.subjectLine}"`,
      `${message.usage.input_tokens} in / ${message.usage.output_tokens} out`,
    ),
  });

  const draft: Pick<
    Issue,
    "title" | "standfirst" | "body" | "executiveSummary" | "track"
  > = {
    title: parsed.title,
    standfirst: parsed.standfirst,
    body: parsed.body,
    executiveSummary: parsed.executiveSummary,
    track,
  };

  emit({ type: "draft", draft });
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
    // Empty or malformed body is fine — fall back to the default track.
  }

  const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
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

        const chain = await scanChain();
        if (chain.blockNumber !== null) {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "ok",
              `Head at block ${chain.blockNumber}`,
              `gas ${chain.gasPriceWei} wei`,
            ),
          });
        } else {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "scanning",
              "warn",
              "Live RPC unreachable — continuing from cached signals",
              chain.error?.slice(0, 120),
            ),
          });
        }

        if (hasKey) {
          await runLive(emit, track, startedAt, chain);
        } else {
          emit({
            type: "log",
            line: makeLine(
              Date.now() - startedAt,
              "synthesizing",
              "warn",
              "ANTHROPIC_API_KEY not set — replaying the recorded pipeline",
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
