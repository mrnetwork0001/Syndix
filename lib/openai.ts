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

  const body = typeof v.body === "string" ? v.body.trim() : "";
  if (body) {
    // Observed from glm-5.2: a schema-valid response whose `body` was a JSON
    // document rather than prose. Every field was present and long enough, so
    // shape checks passed while the article was unpublishable. The schema
    // constrains the envelope; only this constrains the contents.
    if (body.startsWith("{") || body.startsWith("[")) {
      problems.push("body is JSON, not Markdown prose");
    }
    if (!/^##\s/m.test(body)) {
      problems.push("body has no h2 heading, so it is not the requested Markdown structure");
    }
  }

  // Arithmetic the draft shows its working for, checked.
  //
  // The prompt allows a ratio "only if you show the division", which turned out
  // to license the error rather than prevent it: a live draft wrote
  // "2840000000000000 wei / 180362045136 wei per claim = 15.75" - the true
  // answer is 15746 - and then repeated the wrong figure as a conclusion. These
  // models handle 15-digit division badly and state the result with confidence,
  // which is the worst combination.
  //
  // Only expressions the draft itself spells out are checked. Anything it does
  // not show cannot be verified here, which is a reason to forbid unshown
  // arithmetic in the prompt rather than a reason to guess.
  {
    const text = typeof v.body === "string" ? v.body : "";
    const num = String.raw`\d[\d,]*(?:\.\d+)?`;
    const shown = new RegExp(
      String.raw`(${num})\s*(?:wei)?\s*([/*x×])\s*(${num})\s*(?:wei[^=≈]*?)?\s*[=≈]\s*(${num})`,
      "gi",
    );
    for (const m of text.matchAll(shown)) {
      const [, aRaw, op, bRaw, cRaw] = m;
      const a = Number(aRaw.replace(/,/g, ""));
      const b = Number(bRaw.replace(/,/g, ""));
      const c = Number(cRaw.replace(/,/g, ""));
      if (![a, b, c].every(Number.isFinite) || b === 0) continue;
      const expected = op === "/" ? a / b : a * b;
      if (expected === 0) continue;
      // 1% tolerance absorbs honest rounding; the failures seen were 1000x.
      if (Math.abs(expected - c) / Math.abs(expected) > 0.01) {
        problems.push(
          `body shows "${m[0].slice(0, 60).trim()}" but ${aRaw} ${op} ${bRaw} is ${
            expected >= 1000 ? Math.round(expected).toLocaleString("en-US") : expected.toPrecision(6)
          }`,
        );
      }
    }
  }

  // Placeholder or error text where prose belongs. Observed live: a title of
  // "POLL ERROR: No valid title context" and a matching standfirst, in a
  // response whose body was otherwise correct. Length checks passed it because
  // it is a perfectly long string.
  //
  // Anchored deliberately. "Error" can appear legitimately in a headline about
  // errors, so this matches only the shapes a model emits when it has given up:
  // a leading ERROR token, or an explicit "no valid X" admission.
  for (const field of ["title", "standfirst", "subjectLine"]) {
    const text = v[field];
    if (typeof text !== "string") continue;
    if (
      /^\s*(?:\w+\s+)?ERROR\b/i.test(text) ||
      /\bno valid \w+ context\b/i.test(text) ||
      /^\s*(?:N\/A|null|undefined|TODO|PLACEHOLDER)\b/i.test(text)
    ) {
      problems.push(`${field} is placeholder or error text: "${text.slice(0, 44)}"`);
    }
  }

  // A wei amount restated in words. Observed live: 2,840,000,000,000,000 wei
  // described as "2.84 trillion wei", wrong by a factor of a thousand, in a
  // draft whose every other figure was exact. The prompt forbids it and the
  // model did it anyway, which is the argument for checking rather than asking.
  //
  // Safe to match: these issues quote wei as digits, so a magnitude word
  // immediately before "wei" is the error itself and not a false positive.
  for (const field of ["title", "standfirst", "subjectLine", "body"]) {
    const text = v[field];
    if (typeof text !== "string") continue;
    const worded = text.match(
      /\b(?:thousand|million|billion|trillion|quadrillion)\s+wei\b/i,
    );
    if (worded) {
      problems.push(
        `${field} states a wei amount in words ("${worded[0]}") instead of digits`,
      );
    }
  }

  // NOT CHECKED HERE: whitespace collapsing mid-sentence, e.g. the
  // "documentedspecof200ms" a live glm-5.2 run produced. It resists a reliable
  // regex - a length threshold loose enough to catch it also matches every
  // contract address (42 chars), transaction hash (66) and IPFS CID (59), all
  // of which belong in these issues. The first attempt at this check flagged
  // all three and caught neither real defect. Prose quality is a reason to
  // change model, not something to bolt a lossy detector onto.

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

/**
 * Applies house style that a model cannot be relied on to apply itself.
 *
 * The system prompt asks for plain hyphens and "onchain"; gpt-4.1 obeyed,
 * deepseek-v4-pro does not and fills a draft with em dashes. Retrying would
 * spend an attempt on punctuation, which is a waste when the transformation is
 * deterministic and changes no meaning.
 *
 * Strictly cosmetic. Nothing here touches a number, a claim or a citation - it
 * substitutes characters and spelling only, so a normalised issue says exactly
 * what the model said.
 */
export function normalizeIssueProse<T extends object>(issue: T): T {
  const fix = (text: string): string =>
    text
      // Em and en dashes to a spaced hyphen, without disturbing a hyphenated
      // word or a minus sign.
      .replace(/\s*[\u2014\u2013]\s*/g, " - ")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\u2026/g, "...")
      // Non-breaking and other exotic spaces read as normal spaces but break
      // string matching and diffing later.
      .replace(/[\u00A0\u2007\u202F]/g, " ")
      .replace(/\bon-chain\b/g, "onchain")
      .replace(/\bOn-chain\b/g, "Onchain");

  const out = { ...issue } as Record<string, unknown>;
  for (const [key, value] of Object.entries(out)) {
    if (typeof value === "string") out[key] = fix(value);
    else if (Array.isArray(value)) {
      out[key] = value.map((v) => (typeof v === "string" ? fix(v) : v));
    }
  }
  return out as T;
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
