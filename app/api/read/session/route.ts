import { NextRequest, NextResponse } from "next/server";
import {
  BEAT_INTERVAL_SECONDS,
  beat,
  readMinDepth,
  readMinSeconds,
  startSession,
} from "@/lib/read-session";
import { readOnchainIssues } from "@/lib/onchain-issues";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-session endpoint. Two actions on one route:
 *
 *   { articleId }        -> starts a session, stamped with the server clock
 *   { token, depth }     -> records a heartbeat and re-issues the token
 *
 * The token is the entire state, signed - see lib/read-session.ts. Nothing here
 * grants a reward; it only produces the evidence `/api/attest` weighs.
 */
export async function POST(request: NextRequest) {
  let body: { articleId?: unknown; token?: unknown; depth?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body must be JSON." }, { status: 400 });
  }

  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (body.token !== undefined) {
    const result = beat(body.token, body.depth);
    if (!result.ok) {
      return NextResponse.json({ error: result.reason }, { status: 400, ...noStore });
    }
    return NextResponse.json(
      {
        token: result.token,
        beats: result.session.beats,
        depth: result.session.depth,
        dwellSeconds: Math.floor(Date.now() / 1000) - result.session.issuedAt,
      },
      noStore,
    );
  }

  const articleId = Number(body.articleId);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    return NextResponse.json(
      { error: "articleId must be a positive onchain article id." },
      { status: 400, ...noStore },
    );
  }

  // Only start sessions for articles that actually pay. Otherwise a reader
  // spends five minutes earning a proof the treasury was always going to refuse.
  const index = await readOnchainIssues();
  if (index.ok) {
    const article = index.issues.find((i) => i.articleId === articleId);
    if (!article) {
      return NextResponse.json(
        { error: `Article ${articleId} does not exist.` },
        { status: 404, ...noStore },
      );
    }
    if (!article.isActive) {
      return NextResponse.json(
        { error: `Article ${articleId} is closed.` },
        { status: 409, ...noStore },
      );
    }
  }

  return NextResponse.json(
    {
      token: startSession(articleId),
      requiredSeconds: readMinSeconds(),
      requiredDepth: readMinDepth(),
      beatIntervalSeconds: BEAT_INTERVAL_SECONDS,
    },
    noStore,
  );
}
