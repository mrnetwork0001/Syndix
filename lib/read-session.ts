import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Server-measured read sessions.
 *
 * THE PROBLEM THIS SOLVES
 *
 * `/api/attest` used to take the reader's word for how long they had spent on
 * the page: the browser counted seconds and posted the number. Anyone could
 * curl the endpoint with `dwellSeconds: 9999` and never load the article at
 * all, and a reader could open an issue, scroll to the bottom and claim
 * immediately. The dwell figure was decorative.
 *
 * HOW THIS FIXES IT
 *
 * The server issues a signed token when a reader opens an issue, stamped with
 * the server's own clock. The page returns it on a heartbeat every few seconds
 * with its current scroll depth; the server verifies the signature, refuses
 * beats that arrive faster than real time allows, accumulates the count and the
 * deepest scroll reached, and re-issues. At claim time the elapsed time is
 * computed as `now - issuedAt` from the server's clock, not from anything the
 * client asserts.
 *
 * The token chain carries its own state, so this needs no database: each token
 * is a signed snapshot of the session so far, and only this server can mint
 * one. Forging progress requires the HMAC key.
 *
 * WHAT IT STILL DOES NOT PROVE
 *
 * That a human read the words. A script can hold a session open, post
 * heartbeats on a timer and report full scroll depth. What it can no longer do
 * is claim instantly or in bulk: every reward now costs the real wall-clock
 * time the reader was asked to spend, and `up.id` already caps it at one claim
 * per human per article. Together those make farming cost more than the reward
 * is worth, which is the honest bar - not proof of comprehension.
 */

/** Beats are expected on this cadence. */
export const BEAT_INTERVAL_SECONDS = 15;

/**
 * Minimum real seconds between accepted beats. Slightly under the cadence so
 * ordinary timer jitter and a slow network do not cost a reader their session.
 */
const MIN_BEAT_GAP_SECONDS = 10;

/** How long a session may sit idle before it is considered abandoned. */
const SESSION_MAX_AGE_SECONDS = 4 * 60 * 60;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

/**
 * Seconds a reader must actually spend before a proof is signed.
 *
 * Override with READ_MIN_SECONDS. The contract enforces its own floor
 * (`minDwellSeconds`) independently, so lowering this can never take a claim
 * below what the treasury accepts.
 */
export function readMinSeconds(): number {
  return envInt("READ_MIN_SECONDS", 300);
}

/** Fraction of the article that must have been scrolled through, 0..1. */
export function readMinDepth(): number {
  const raw = Number(process.env.READ_MIN_DEPTH);
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 0.85;
}

/**
 * Beats required, derived from the dwell target rather than configured
 * separately so the two can never contradict each other. The 0.6 factor
 * tolerates a backgrounded tab or a dropped request without letting a session
 * through that never checked in.
 */
export function readMinBeats(): number {
  return Math.max(
    2,
    Math.floor((readMinSeconds() / BEAT_INTERVAL_SECONDS) * 0.6),
  );
}

/**
 * HMAC key. A dedicated secret is preferred; absent one it is derived from the
 * attester key, which the app already requires and already keeps server-side.
 * Deriving rather than reusing keeps the signing domains separate.
 */
function sessionKey(): string {
  const explicit = process.env.READ_SESSION_SECRET;
  if (explicit && explicit.length >= 16) return explicit;

  const attester = process.env.ATTESTER_PRIVATE_KEY;
  if (!attester) throw new Error("No READ_SESSION_SECRET or ATTESTER_PRIVATE_KEY");
  return createHmac("sha256", attester).update("syndix:read-session:v1").digest("hex");
}

export interface ReadSession {
  /** SyndixTreasury article id. */
  articleId: number;
  /** Server clock at session start, unix seconds. */
  issuedAt: number;
  /** Server clock at the most recent accepted beat. */
  lastBeat: number;
  /** Accepted beats so far. */
  beats: number;
  /** Deepest scroll fraction reported, 0..1. */
  depth: number;
  /** Random, so two sessions on the same article are never the same token. */
  nonce: string;
}

function encode(session: ReadSession): string {
  const body = Buffer.from(JSON.stringify(session)).toString("base64url");
  const mac = createHmac("sha256", sessionKey()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function startSession(articleId: number): string {
  const now = Math.floor(Date.now() / 1000);
  return encode({
    articleId,
    issuedAt: now,
    lastBeat: now,
    beats: 0,
    depth: 0,
    nonce: randomBytes(9).toString("base64url"),
  });
}

/** Returns the session a token encodes, or null if it is forged or stale. */
export function verifySession(token: unknown): ReadSession | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".", 2);
  if (!body || !mac) return null;

  const expected = createHmac("sha256", sessionKey()).update(body).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let session: ReadSession;
  try {
    session = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as ReadSession;
  } catch {
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  // A token stamped in the future means a tampered clock or a replayed forgery.
  if (session.issuedAt > now + 5) return null;
  if (now - session.issuedAt > SESSION_MAX_AGE_SECONDS) return null;
  return session;
}

export type BeatResult =
  | { ok: true; token: string; session: ReadSession }
  | { ok: false; reason: string };

/**
 * Records a heartbeat.
 *
 * Beats arriving faster than `MIN_BEAT_GAP_SECONDS` are rejected rather than
 * merged - that rate limit is the whole mechanism. Without it a client could
 * post a hundred beats in a millisecond and satisfy the count instantly.
 */
export function beat(token: unknown, reportedDepth: unknown): BeatResult {
  const session = verifySession(token);
  if (!session) return { ok: false, reason: "Invalid or expired read session." };

  const now = Math.floor(Date.now() / 1000);
  if (now - session.lastBeat < MIN_BEAT_GAP_SECONDS) {
    return { ok: false, reason: "Heartbeat too soon." };
  }

  const raw = Number(reportedDepth);
  const depth = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;

  const next: ReadSession = {
    ...session,
    lastBeat: now,
    beats: session.beats + 1,
    // Deepest point reached, so scrolling back up to re-read costs nothing.
    depth: Math.max(session.depth, depth),
  };
  return { ok: true, token: encode(next), session: next };
}

export interface SessionVerdict {
  ok: boolean;
  /** Seconds measured by the server, never by the client. */
  dwellSeconds: number;
  reason?: string;
}

/** Decides whether a session has earned a ReadProof, for a given article. */
export function judgeSession(token: unknown, articleId: number): SessionVerdict {
  const session = verifySession(token);
  if (!session) {
    return {
      ok: false,
      dwellSeconds: 0,
      reason: "No valid read session. Open the issue and read it through.",
    };
  }
  if (session.articleId !== articleId) {
    return { ok: false, dwellSeconds: 0, reason: "Read session is for a different article." };
  }

  const dwellSeconds = Math.floor(Date.now() / 1000) - session.issuedAt;
  const needSeconds = readMinSeconds();
  if (dwellSeconds < needSeconds) {
    return {
      ok: false,
      dwellSeconds,
      reason: `Read for ${needSeconds - dwellSeconds}s longer - the reward needs ${needSeconds}s on the page.`,
    };
  }

  const needBeats = readMinBeats();
  if (session.beats < needBeats) {
    return {
      ok: false,
      dwellSeconds,
      reason: "The page was not open and in front of you for long enough.",
    };
  }

  const needDepth = readMinDepth();
  if (session.depth < needDepth) {
    return {
      ok: false,
      dwellSeconds,
      reason: `Scroll through the whole issue - ${Math.round(session.depth * 100)}% reached, ${Math.round(needDepth * 100)}% needed.`,
    };
  }

  return { ok: true, dwellSeconds };
}
