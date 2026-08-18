/**
 * The issue-generation contract: schema, system prompt, and validation.
 *
 * Which model runs it and where the request goes lives in lib/inference.ts -
 * Syndix generates through the 0G Compute Router rather than a vendor API, so
 * "the OpenAI client" stopped being an accurate name for that concern.
 */

export {
  hasInferenceKey,
  inferenceClient,
  inferenceModel,
  inferenceProvider,
  inferenceProviderLabel,
  assertModelSupported,
} from "./inference";

/**
 * Structured Outputs schema for a generated issue.
 *
 * `strict: true` requires every property to be listed in `required` and
 * `additionalProperties: false` on every object - OpenAI rejects the request
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
          "The issue as GitHub-flavoured Markdown, 600-900 words, with h2/h3 headings, at least one list, and a table or fenced code block where it earns its place. No h1 - the title renders separately.",
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

/**
 * Checks a parsed response really is an issue.
 *
 * `response_format` constrains the shape but is not a guarantee across every
 * model on the router, and the models that accept it are not all equally
 * literal about it. A missing `body` or an empty `title` that reached IPFS and
 * then a contract would be permanent, so the cheap check happens here instead.
 *
 * Returns the reasons it failed rather than throwing, so the caller can put
 * them in a log line and retry.
 */
export function validateGeneratedIssue(value: unknown): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null) return ["not an object"];
  const v = value as Record<string, unknown>;

  const str = (k: string, min: number) => {
    const s = v[k];
    if (typeof s !== "string") problems.push(`${k} is ${typeof s}, expected string`);
    else if (s.trim().length < min) problems.push(`${k} is shorter than ${min} characters`);
  };

  str("title", 8);
  str("standfirst", 16);
  str("subjectLine", 8);
  // The body is the article. A model that returns a stub has failed, even
  // though a stub is a valid string as far as the schema is concerned.
  str("body", 400);

  if (!["bullish", "neutral", "cautious"].includes(String(v.sentiment))) {
    problems.push(`sentiment "${String(v.sentiment)}" is not one of bullish|neutral|cautious`);
  }
  const idx = v.engagementIndex;
  if (typeof idx !== "number" || !Number.isFinite(idx) || idx < 0 || idx > 100) {
    problems.push("engagementIndex is not a number between 0 and 100");
  }
  const summary = v.executiveSummary;
  if (!Array.isArray(summary) || summary.length === 0) {
    problems.push("executiveSummary is missing or empty");
  } else if (!summary.every((x) => typeof x === "string" && x.trim().length > 0)) {
    problems.push("executiveSummary contains a non-string or blank entry");
  }

  return problems;
}

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

Write like a sharp research newsletter: concrete, technically specific, no hype and no filler. Never invent TVL figures, partnerships, token prices, or launch dates. If a number is not in the signals you were given, either omit it or mark it explicitly as an estimate.

House style, applied to every field you emit:
- Use a plain hyphen "-" for parenthetical dashes. Never use an em dash.
- Write "onchain", never "on-chain".`;
