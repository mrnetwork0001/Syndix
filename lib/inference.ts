import OpenAI from "openai";

/**
 * Which model writes the issues, and where the request goes.
 *
 * WHY THIS IS NOT JUST AN OPENAI CLIENT
 *
 * Syndix generates through the 0G Compute Router, a decentralised inference
 * network, rather than calling a model vendor directly. The router speaks the
 * OpenAI wire format, so the `openai` package still does the talking - only the
 * base URL, key and model change.
 *
 * The reason is verifiability, which is the same reason the rest of this
 * codebase looks the way it does. The default model is TEE-attested: inference
 * runs inside a hardware enclave and the network can attest to which model
 * produced a given response. A project whose whole argument is "do not trust
 * us, check the chain" should not have an unverifiable black box at the point
 * where the words are actually written.
 *
 * CHOOSING A MODEL
 *
 * The router's catalogue is live at GET /v1/models and every entry declares
 * which parameters it accepts. Issue generation depends on `response_format`
 * with a JSON schema, and NOT every model on the router supports it - notably
 * the hosted GPT and Claude models expose `tools` but not `response_format`.
 * Picking one of those silently breaks generation, so `assertModelSupported`
 * exists to turn that into an early, obvious failure.
 *
 * Verified against the live catalogue on 2026-08-18:
 *
 *   glm-5.2          response_format yes   TEE TeeML    $0.90/$3.00 per 1M
 *   deepseek-v4-pro  response_format yes   TEE TeeTLS   $1.45/$2.90
 *   qwen3.8-max      response_format yes   TEE TeeTLS   $1.65/$4.95
 *   gpt-5.6-terra    response_format NO    no TEE       $2.00/$12.00
 *   gpt-5.5          response_format NO    no TEE       $5.00/$30.00
 */

/** 0G Compute Router. OpenAI-compatible, so the same SDK works unchanged. */
export const ZG_ROUTER_BASE_URL = "https://router-api.0g.ai/v1";

/**
 * Chosen by measurement, not by price.
 *
 * glm-5.2 was the first default because it is cheapest, and it did not hold up:
 * across live runs it returned a JSON document in the `body` field, then an
 * empty `executiveSummary`, then an out-of-range `engagementIndex`, and it
 * burned 11k reasoning tokens taking 170s to do it. glm-5.3 returned
 * unparseable output.
 *
 * deepseek-v4-pro produced a clean, correct issue - every figure reconciled
 * against the treasury, the documented 200ms properly attributed to GIWA
 * rather than claimed as measured - in ~60s using no reasoning tokens, which
 * makes it both more reliable and cheaper per issue despite the higher headline
 * rate.
 *
 * It is not perfect: `strict: true` is not fully honoured by the router, and a
 * required field intermittently comes back empty, which is why the cycle
 * retries. Override with SYNDIX_MODEL - but check the catalogue first, and
 * measure before trusting a cheaper number.
 */
export const DEFAULT_MODEL = "deepseek-v4-pro";

/**
 * Models confirmed to accept `response_format` from the live catalogue.
 *
 * Not exhaustive and not a substitute for checking - it exists so that the
 * common mistake (pointing this at a GPT model because the name is familiar)
 * fails with an explanation instead of a stream of unparseable prose.
 */
const KNOWN_STRUCTURED_OUTPUT_MODELS = new Set([
  "glm-5",
  "glm-5.1",
  "glm-5.2",
  "glm-5.3",
  "deepseek-v4-pro",
  "deepseek-v4-flash",
  "qwen3.6-plus",
  "qwen3.7-plus",
  "qwen3.7-max",
  "qwen3.8-max",
  "kimi-k3",
  "hy3",
  "0gm-1.0-35b-a3b",
]);

/** Models on the router that are known NOT to accept `response_format`. */
const KNOWN_UNSUPPORTED = new Set([
  "gpt-5.5",
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "claude-opus-5",
  "claude-sonnet-5",
  "claude-fable-5",
  "claude-opus-4-8",
  "minimax-m3",
  "minimax-h3",
  "kimi-k2.7-code",
]);

export type InferenceProvider = "0g" | "openai";

/**
 * 0G when a router key is present, OpenAI when only an OpenAI key is.
 *
 * Explicit rather than clever: whichever key is configured decides, and
 * `inferenceProviderLabel` puts the answer in the studio and the logs so a run
 * never leaves you guessing which network wrote the issue.
 */
export function inferenceProvider(): InferenceProvider {
  return process.env.ZG_API_KEY?.trim() ? "0g" : "openai";
}

export function inferenceModel(): string {
  const explicit = process.env.SYNDIX_MODEL?.trim();
  if (explicit) return explicit;

  if (inferenceProvider() === "0g") {
    // Deliberately NOT falling back to OPENAI_MODEL here. That variable names
    // a model in OpenAI's catalogue, and an existing OPENAI_MODEL=gpt-4.1 left
    // in a .env from before the switch would otherwise be sent to the 0G
    // router, which has no such model. SYNDIX_MODEL is the only override that
    // crosses providers.
    return DEFAULT_MODEL;
  }
  return process.env.OPENAI_MODEL?.trim() || "gpt-4.1";
}

export function hasInferenceKey(): boolean {
  return Boolean(
    process.env.ZG_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim(),
  );
}

/** Human-readable provenance, e.g. "glm-5.2 via 0G Compute". */
export function inferenceProviderLabel(): string {
  return inferenceProvider() === "0g"
    ? `${inferenceModel()} via 0G Compute`
    : `${inferenceModel()} via OpenAI`;
}

/**
 * Fails early when the configured model cannot do structured outputs.
 *
 * Without this the failure is a parse error several seconds and one paid
 * request later, and it looks like the model being bad at JSON rather than the
 * model never having been asked for JSON in a way it understands.
 */
export function assertModelSupported(model = inferenceModel()): void {
  if (inferenceProvider() !== "0g") return;
  if (KNOWN_UNSUPPORTED.has(model)) {
    throw new Error(
      `Model "${model}" does not support response_format on the 0G router, and issue generation requires it. ` +
        `Use one of: ${[...KNOWN_STRUCTURED_OUTPUT_MODELS].slice(0, 5).join(", ")}. ` +
        `Check the live catalogue at ${ZG_ROUTER_BASE_URL}/models - each entry lists supported_parameters.`,
    );
  }
}

export function inferenceClient(): OpenAI {
  const zgKey = process.env.ZG_API_KEY?.trim();
  if (zgKey) {
    return new OpenAI({
      apiKey: zgKey,
      baseURL: process.env.ZG_ROUTER_URL?.trim() || ZG_ROUTER_BASE_URL,
    });
  }
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}
