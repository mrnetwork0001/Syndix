/**
 * Dataset issue id -> SyndixTreasury article id.
 *
 * The contract assigns article ids sequentially from `++articleCount`, so the
 * on-chain id is decided by publish order, not by anything in the dataset. Our
 * first deployment publish run hit a nonce race that dropped one transaction
 * and re-ordered the rest, so issues 2 and 3 landed swapped.
 *
 * Rather than pretend the ids line up — a mismatch here means signing an
 * attestation for the wrong article and reverting on claim — the mapping is
 * explicit and checked. Regenerate it if you redeploy: read `articles(i).title`
 * for i in 1..articleCount and match against ISSUES.
 */
export const ISSUE_TO_ARTICLE_ID: Readonly<Record<number, number>> = {
  1: 1,
  2: 3,
  3: 2,
  4: 4,
  5: 5,
  6: 6,
};

/** Reverse lookup, for turning a chain event back into a dataset issue. */
export const ARTICLE_TO_ISSUE_ID: Readonly<Record<number, number>> =
  Object.fromEntries(
    Object.entries(ISSUE_TO_ARTICLE_ID).map(([issue, article]) => [
      article,
      Number(issue),
    ]),
  );

/**
 * @returns the on-chain article id for a dataset issue, or `undefined` when the
 *          issue has never been published. Callers must handle `undefined`
 *          rather than defaulting to the issue id — that default is exactly the
 *          bug this module exists to prevent.
 */
export function onchainArticleId(issueId: number): number | undefined {
  return ISSUE_TO_ARTICLE_ID[issueId];
}

export function issueIdForArticle(articleId: number): number | undefined {
  return ARTICLE_TO_ISSUE_ID[articleId];
}

/**
 * SyndixArticleNFT editions are keyed by the DATASET issue id, not the treasury
 * article id.
 *
 * These are two different numbering schemes and it is worth being explicit:
 * the treasury assigns its ids from publish order (`++articleCount`), whereas
 * `registerEdition(issueId, …)` takes the key as a free parameter, so editions
 * were registered under the dataset id directly. Use this function for anything
 * touching the NFT, and `onchainArticleId` for anything touching the treasury.
 */
export function editionIdForIssue(issueId: number): number {
  return issueId;
}
