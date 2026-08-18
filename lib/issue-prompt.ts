import { telemetryDigest, type ChainTelemetry } from "./telemetry";

/**
 * The contract handed to the model when it writes an issue.
 *
 * WHY THIS IS ITS OWN FILE
 *
 * Two callers generate issues: the studio route, where a human reads the draft
 * before anything is published, and the unattended cycle on a server, where
 * nobody does. If each built its own prompt they would drift, and the one that
 * drifts unwatched is the one publishing without review. Every rule below was
 * added because a live draft broke it, so a weaker copy of this text running on
 * a timer is precisely the failure worth designing out.
 *
 * The rules are negative on purpose. lib/telemetry.ts already guarantees the
 * signals are real; this guarantees the model does not embellish them.
 */
export function buildIssueUserPrompt(
  trackLabel: string,
  telemetry: ChainTelemetry,
): string {
  const headline = telemetry.blockNumber
    ? `Live GIWA Sepolia head: block ${telemetry.blockNumber}, measured at ${telemetry.takenAt}.`
    : "Live head state was unavailable this run; do not cite a block height.";

  return `Write today's Syndix issue for the "${trackLabel}" track.

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
- Write wei amounts as the digits given. Never restate one in words - not
  "2.84 trillion wei", not "6.5 quadrillion", not "roughly 0.0028 ETH". A draft
  called 2,840,000,000,000,000 wei "2.84 trillion" and was wrong by a factor of
  a thousand. If a magnitude helps the reader, give the digits and say what it
  buys instead.
- Do not judge whether a documented figure was met. This run measures network
  round-trip time and state freshness; neither is preconfirmation latency, so
  no combination of them supports "within the documented window", "meeting its
  target" or any equivalent. Report what was measured and attribute what was
  documented, separately.

${telemetryDigest(telemetry)}

Format of the "body" field - this is the article itself:

- It is GitHub-flavoured MARKDOWN PROSE. It is NOT JSON. Do not put an object,
  an array, or key/value pairs inside it. The surrounding response is JSON; the
  body field's contents are the rendered article a person reads.
- Open with an "## " heading and use "## " and "### " headings throughout.
  Never use "# " - the title renders separately above the body.
- 600-900 words, with at least one list, and a table or fenced code block where
  it earns its place.
- Ordinary sentences with spaces between words.

Return JSON matching the required schema.`;
}
