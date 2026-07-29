import { describe, expect, it } from "vitest";
import {
  ARTICLE_TO_ISSUE_ID,
  ISSUE_TO_ARTICLE_ID,
  issueIdForArticle,
  onchainArticleId,
} from "@/lib/onchain";
import { ISSUES } from "@/lib/data/issues";

/**
 * The dataset id and the on-chain article id are not interchangeable — publish
 * order decides the latter, and a nonce race left issues 2 and 3 swapped. These
 * tests exist so nobody "simplifies" the mapping away.
 */
describe("issue <-> article id mapping", () => {
  it("covers every issue in the dataset", () => {
    for (const issue of ISSUES) {
      expect(
        onchainArticleId(issue.id),
        `issue ${issue.id} has no on-chain article id`,
      ).toBeDefined();
    }
  });

  it("records that issues 2 and 3 are swapped on chain", () => {
    expect(onchainArticleId(2)).toBe(3);
    expect(onchainArticleId(3)).toBe(2);
  });

  it("is a bijection — no two issues share an article id", () => {
    const articles = Object.values(ISSUE_TO_ARTICLE_ID);
    expect(new Set(articles).size).toBe(articles.length);
  });

  it("round-trips in both directions", () => {
    for (const [issue, article] of Object.entries(ISSUE_TO_ARTICLE_ID)) {
      expect(issueIdForArticle(article)).toBe(Number(issue));
      expect(ARTICLE_TO_ISSUE_ID[article]).toBe(Number(issue));
    }
  });

  it("returns undefined for an unpublished issue rather than guessing", () => {
    expect(onchainArticleId(999)).toBeUndefined();
    expect(issueIdForArticle(999)).toBeUndefined();
  });
});
