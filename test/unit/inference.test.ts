import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { validateGeneratedIssue } from "@/lib/openai";

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
  body: "x".repeat(500),
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
    expect(validateGeneratedIssue({ ...VALID, engagementIndex: 340 }).length).toBe(1);
    expect(validateGeneratedIssue({ ...VALID, engagementIndex: "72" }).length).toBe(1);
  });

  it("rejects an empty or blank executive summary", () => {
    expect(validateGeneratedIssue({ ...VALID, executiveSummary: [] }).length).toBe(1);
    expect(validateGeneratedIssue({ ...VALID, executiveSummary: ["  "] }).length).toBe(1);
  });

  it("rejects a non-object without throwing", () => {
    expect(validateGeneratedIssue(null)).toEqual(["not an object"]);
    expect(validateGeneratedIssue("a string")).toEqual(["not an object"]);
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

  it("picks the provider from whichever key is set", async () => {
    const { inferenceProvider, inferenceModel } = await import("@/lib/inference");
    process.env.OPENAI_API_KEY = "test";
    expect(inferenceProvider()).toBe("openai");
    process.env.ZG_API_KEY = "test";
    expect(inferenceProvider()).toBe("0g");
    expect(inferenceModel()).toBe("glm-5.2");
  });
});
