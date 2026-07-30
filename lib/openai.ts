import OpenAI from "openai";

/**
 * OpenAI client + the issue-generation contract.
 *
 * The model is configurable because model ids move faster than this repo does.
 * `OPENAI_MODEL` overrides the default; if the default is ever retired the
 * agent route surfaces the API's own error rather than silently degrading.
 */

export const DEFAULT_OPENAI_MODEL = "gpt-4.1";

export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function hasOpenAIKey(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export function openaiClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

/**
 * Structured Outputs schema for a generated issue.
 *
 * `strict: true` requires every property to be listed in `required` and
 * `additionalProperties: false` on every object — OpenAI rejects the request
 * otherwise, so do not "tidy" this by making fields optional.
 */
export const ISSUE_JSON_SCHEMA = {
  name: "syndix_issue",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      title: {
        type: "string",
        description: "Headline under 80 characters. Specific, not clickbait.",
      },
      standfirst: {
        type: "string",
        description: "One-sentence deck rendered under the headline.",
      },
      subjectLine: {
        type: "string",
        description: "Email subject line optimised for open rate.",
      },
      sentiment: {
        type: "string",
        enum: ["bullish", "neutral", "cautious"],
      },
      engagementIndex: {
        type: "integer",
        description: "Self-assessed 0-100 engagement score for the subject line.",
      },
      executiveSummary: {
        type: "array",
        description: "Three or four single-line takeaways.",
        items: { type: "string" },
      },
      body: {
        type: "string",
        description:
          "The issue as GitHub-flavoured Markdown, 600-900 words, with h2/h3 headings, at least one list, and a table or fenced code block where it earns its place. No h1 — the title renders separately.",
      },
    },
    required: [
      "title",
      "standfirst",
      "subjectLine",
      "sentiment",
      "engagementIndex",
      "executiveSummary",
      "body",
    ],
  },
} as const;

export interface GeneratedIssue {
  title: string;
  standfirst: string;
  subjectLine: string;
  sentiment: "bullish" | "neutral" | "cautious";
  engagementIndex: number;
  executiveSummary: string[];
  body: string;
}

export const SYSTEM_PROMPT = `You are the Syndix ingestion agent, an autonomous journalist covering the GIWA ecosystem.

GIWA is an OP Stack Ethereum L2 built by Dunamu, the parent company of the Upbit exchange. Facts you must not contradict:
- Testnet is GIWA Sepolia, chain ID 91342, settling to Ethereum Sepolia. Mainnet is still under development.
- Blocks are ~1 second. Flashblocks serve preconfirmations in up to 200ms via a separate RPC, readable under the "pending" block tag.
- Identity is Upbit Web3 Names: username.up.id, ENS subdomains issued as Soul-Bound Tokens to Dojang-verified addresses, one per wallet. It is NOT "giwa.id".
- Dojang is GIWA's attestation service built on EAS, predeployed at 0x4200000000000000000000000000000000000021.
- ERC-4337 EntryPoint v0.6 and v0.7 are predeployed at genesis, along with Multicall3, Permit2, Safe and WETH9. There is no first-party "GIWA Paymaster" product; gasless UX means running your own paymaster against the standard EntryPoint.

Write like a sharp research newsletter: concrete, technically specific, no hype and no filler. Never invent TVL figures, partnerships, token prices, or launch dates. If a number is not in the signals you were given, either omit it or mark it explicitly as an estimate.`;
