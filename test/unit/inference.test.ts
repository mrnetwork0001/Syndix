import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateGeneratedIssue, normalizeIssueProse } from "@/lib/openai";

/**
 * Two concerns, both about not publishing something broken.
 *
 * Generation moved to the 0G Compute Router, where the model is one of several
 * open-weight models rather than a single vendor endpoint. `response_format`
 * constrains the shape, but not every model on that router accepts it and the
 * ones that do are not equally literal about it. Anything that gets past this
 * check is pinned to IPFS and referenced by a contract permanently, so the
 * cheap validation happens before either of those.
 */

const VALID = {
  title: "GIWA Sepolia: Flashblocks freshness holds at 3x sealed",
  standfirst: "Pending tag produced 28 distinct states to the sealed tag's 9.",
  subjectLine: "Flashblocks holds a 3x freshness lead",
  sentiment: "neutral",
  engagementIndex: 72,
  executiveSummary: ["Pending tag led sealed 28 to 9.", "Treasury solvent."],
  body: [
    "## Flashblocks freshness",
    "",
    "Over the same polling window the pending tag produced 28 distinct chain",
    "states to the sealed tag's 9. A state is a block number, transaction count",
    "and state root taken together.",
    "",
    "### Treasury",
    "",
    "The solvency invariant holds: balance exceeds the amount reserved for",
    "readers, which the owner cannot reach. " + "Reader claims settle onchain. ".repeat(6),
  ].join("\n"),
};

describe("validateGeneratedIssue", () => {
  it("accepts a well-formed issue", () => {
    expect(validateGeneratedIssue(VALID)).toEqual([]);
  });

  it("rejects a stub body that is technically a valid string", () => {
    // The schema is satisfied by "ok". A published issue is not.
    const problems = validateGeneratedIssue({ ...VALID, body: "ok" });
    expect(problems.join(" ")).toContain("body");
  });

  it("rejects a missing field rather than letting undefined through", () => {
    const { body, ...withoutBody } = VALID;
    void body;
    expect(validateGeneratedIssue(withoutBody).join(" ")).toContain("body");
  });

  it("rejects a sentiment outside the enum", () => {
    const problems = validateGeneratedIssue({ ...VALID, sentiment: "euphoric" });
    expect(problems.join(" ")).toContain("sentiment");
  });

  it("rejects an out-of-range engagement index", () => {
    expect(validateGeneratedIssue({ ...VALID, engagementIndex: 340 }).join(" ")).toContain("engagementIndex");
    expect(validateGeneratedIssue({ ...VALID, engagementIndex: "72" }).join(" ")).toContain("engagementIndex");
  });

  it("rejects an empty or blank executive summary", () => {
    expect(validateGeneratedIssue({ ...VALID, executiveSummary: [] }).join(" ")).toContain("executiveSummary");
    expect(validateGeneratedIssue({ ...VALID, executiveSummary: ["  "] }).join(" ")).toContain("executiveSummary");
  });

  it("rejects a non-object without throwing", () => {
    expect(validateGeneratedIssue(null)).toEqual(["not an object"]);
    expect(validateGeneratedIssue("a string")).toEqual(["not an object"]);
  });

  it("rejects a body that is JSON rather than Markdown", () => {
    // Seen live from glm-5.2: every field present and long enough, so the
    // shape checks passed while the article itself was a JSON document.
    const problems = validateGeneratedIssue({
      ...VALID,
      body: JSON.stringify({ headline: "x", sections: [{ title: "a", body: "b".repeat(500) }] }),
    });
    expect(problems.join(" ")).toContain("JSON, not Markdown");
  });

  it("accepts a body full of addresses, hashes and CIDs", () => {
    // Guards a check that was removed: a length-based run-together detector
    // flagged every contract address, transaction hash and IPFS CID while
    // missing the corruption it was written for. These belong in issues.
    const problems = validateGeneratedIssue({
      ...VALID,
      body:
        VALID.body +
        "\n\nTreasury 0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee, published in " +
        "0x8f4d81ed9950353a94a6dd928a1192b854aca6b8d781556445f213309e284ff4, body at " +
        "ipfs://bafkreifp4zjnndgnbxyrm43yozpobsyc6kjxgpdzirblrkaqbhgnoj3n4i.",
    });
    expect(problems).toEqual([]);
  });

  it("collects every problem rather than stopping at the first", () => {
    const problems = validateGeneratedIssue({ title: "x", sentiment: "nope" });
    expect(problems.length).toBeGreaterThan(3);
  });
});

describe("model selection", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.ZG_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.SYNDIX_MODEL;
    delete process.env.OPENAI_MODEL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("refuses a router model that cannot do structured outputs", async () => {
    // Verified against the live catalogue: the hosted GPT models expose tools
    // but not response_format, so picking one because the name is familiar
    // silently breaks generation. Fail loudly instead.
    const { assertModelSupported } = await import("@/lib/inference");
    process.env.ZG_API_KEY = "test";
    process.env.SYNDIX_MODEL = "gpt-5.6-terra";
    expect(() => assertModelSupported()).toThrow(/response_format/);
  });

  it("allows a router model that does", async () => {
    const { assertModelSupported } = await import("@/lib/inference");
    process.env.ZG_API_KEY = "test";
    process.env.SYNDIX_MODEL = "glm-5.2";
    expect(() => assertModelSupported()).not.toThrow();
  });

  it("does not second-guess the model when talking to OpenAI directly", async () => {
    const { assertModelSupported } = await import("@/lib/inference");
    process.env.OPENAI_API_KEY = "test";
    process.env.SYNDIX_MODEL = "gpt-4.1";
    expect(() => assertModelSupported()).not.toThrow();
  });

  it("ignores OPENAI_MODEL when routing through 0G", async () => {
    const { inferenceModel } = await import("@/lib/inference");
    // A leftover OPENAI_MODEL from before the switch names a model that does
    // not exist on the router, and sending it there fails at request time.
    process.env.ZG_API_KEY = "test";
    process.env.OPENAI_MODEL = "gpt-4.1";
    expect(inferenceModel()).toBe("deepseek-v4-pro");
  });

  it("still honours OPENAI_MODEL when talking to OpenAI", async () => {
    const { inferenceModel } = await import("@/lib/inference");
    process.env.OPENAI_API_KEY = "test";
    process.env.OPENAI_MODEL = "gpt-4.1";
    expect(inferenceModel()).toBe("gpt-4.1");
  });

  it("picks the provider from whichever key is set", async () => {
    const { inferenceProvider, inferenceModel } = await import("@/lib/inference");
    process.env.OPENAI_API_KEY = "test";
    expect(inferenceProvider()).toBe("openai");
    process.env.ZG_API_KEY = "test";
    expect(inferenceProvider()).toBe("0g");
    expect(inferenceModel()).toBe("deepseek-v4-pro");
  });
});

describe("normalizeIssueProse", () => {
  it("replaces em dashes with a spaced hyphen", () => {
    // The system prompt forbids them and deepseek-v4-pro uses them anyway.
    // Retrying on punctuation wastes an attempt; the fix is deterministic.
    const out = normalizeIssueProse({
      body: "Flashblocks preconfirm in 200ms\u2014per GIWA's docs\u2014not measured here.",
    });
    expect(out.body).not.toMatch(/[\u2014\u2013]/);
    expect(out.body).toContain("200ms - per GIWA");
  });

  it("normalises smart quotes and on-chain spelling", () => {
    const out = normalizeIssueProse({
      standfirst: "GIWA\u2019s on-chain record \u201Cholds\u201D today\u2026",
    });
    expect(out.standfirst).toBe("GIWA's onchain record \"holds\" today...");
  });

  it("normalises inside arrays as well as strings", () => {
    const out = normalizeIssueProse({
      executiveSummary: ["Treasury solvent\u2014invariant holds.", "Second point."],
    });
    expect(out.executiveSummary[0]).toBe("Treasury solvent - invariant holds.");
  });

  it("leaves hyphenated words and numbers alone", () => {
    const out = normalizeIssueProse({
      body: "A well-known 180313-gas claim costs 180,361,684,510 wei at 1,000,270 wei/gas.",
    });
    expect(out.body).toBe(
      "A well-known 180313-gas claim costs 180,361,684,510 wei at 1,000,270 wei/gas.",
    );
  });
});
