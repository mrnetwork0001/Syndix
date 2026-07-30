import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These pin the properties the reward depends on. Before this existed,
 * `/api/attest` believed whatever `dwellSeconds` the caller posted, so a claim
 * cost one HTTP request and no reading at all.
 */

const ORIGINAL_ENV = { ...process.env };

async function load() {
  vi.resetModules();
  return import("@/lib/read-session");
}

beforeEach(() => {
  process.env.ATTESTER_PRIVATE_KEY =
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
  process.env.READ_MIN_SECONDS = "300";
  process.env.READ_MIN_DEPTH = "0.85";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  process.env = { ...ORIGINAL_ENV };
});

describe("read session integrity", () => {
  it("accepts a token it issued", async () => {
    const { startSession, verifySession } = await load();
    const session = verifySession(startSession(9));
    expect(session?.articleId).toBe(9);
    expect(session?.beats).toBe(0);
  });

  /** The whole point: progress must be unforgeable without the server key. */
  it("rejects a token whose payload was edited", async () => {
    const { startSession, verifySession } = await load();
    const [body, mac] = startSession(9).split(".");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    payload.issuedAt -= 100_000;
    payload.beats = 999;
    payload.depth = 1;
    const forged = `${Buffer.from(JSON.stringify(payload)).toString("base64url")}.${mac}`;

    expect(verifySession(forged)).toBeNull();
  });

  it("rejects a token signed with a different key", async () => {
    const { startSession } = await load();
    const token = startSession(9);
    process.env.ATTESTER_PRIVATE_KEY = "0x" + "ab".repeat(32);
    const { verifySession } = await load();
    expect(verifySession(token)).toBeNull();
  });

  it("rejects garbage and missing tokens", async () => {
    const { verifySession } = await load();
    for (const bad of [undefined, null, "", "nodot", "a.b", 42]) {
      expect(verifySession(bad)).toBeNull();
    }
  });
});

describe("heartbeat rate limiting", () => {
  /** Without this a client posts 20 beats instantly and satisfies the count. */
  it("refuses beats that arrive faster than real time", async () => {
    const { startSession, beat } = await load();
    const token = startSession(9);
    expect(beat(token, 1).ok).toBe(false);

    vi.advanceTimersByTime(11_000);
    const first = beat(token, 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // Immediately again on the new token: still too soon.
    expect(beat(first.token, 1).ok).toBe(false);
  });

  it("keeps the deepest scroll reached, so re-reading costs nothing", async () => {
    const { startSession, beat } = await load();
    let token = startSession(9);
    vi.advanceTimersByTime(11_000);
    const deep = beat(token, 0.9);
    expect(deep.ok).toBe(true);
    if (!deep.ok) return;
    token = deep.token;

    vi.advanceTimersByTime(11_000);
    const back = beat(token, 0.2);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.session.depth).toBe(0.9);
  });

  it("clamps a depth outside 0..1", async () => {
    const { startSession, beat } = await load();
    const token = startSession(9);
    vi.advanceTimersByTime(11_000);
    const r = beat(token, 42);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.session.depth).toBe(1);
  });
});

describe("judging a session", () => {
  async function ripen(articleId = 9, depth = 1) {
    const mod = await load();
    let token = mod.startSession(articleId);
    // 20 beats over 5+ minutes of real elapsed time.
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(16_000);
      const r = mod.beat(token, depth);
      if (r.ok) token = r.token;
    }
    return { mod, token };
  }

  it("signs off once time, beats and depth are all satisfied", async () => {
    const { mod, token } = await ripen();
    const verdict = mod.judgeSession(token, 9);
    expect(verdict.ok).toBe(true);
    expect(verdict.dwellSeconds).toBeGreaterThanOrEqual(300);
  });

  it("refuses a session that has not run long enough", async () => {
    const mod = await load();
    const token = mod.startSession(9);
    vi.advanceTimersByTime(60_000);
    const verdict = mod.judgeSession(token, 9);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/longer/);
  });

  /** Scrolling to the bottom instantly was the exact hole reported. */
  it("refuses a full-depth session that skipped the time", async () => {
    const mod = await load();
    let token = mod.startSession(9);
    vi.advanceTimersByTime(11_000);
    const r = mod.beat(token, 1);
    if (r.ok) token = r.token;
    expect(mod.judgeSession(token, 9).ok).toBe(false);
  });

  it("refuses a long session that never scrolled", async () => {
    const { mod, token } = await ripen(9, 0.1);
    const verdict = mod.judgeSession(token, 9);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/Scroll/);
  });

  /** A proof earned on one article must not settle another. */
  it("refuses a session belonging to a different article", async () => {
    const { mod, token } = await ripen(9);
    const verdict = mod.judgeSession(token, 10);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toMatch(/different article/);
  });

  it("refuses an absent session outright", async () => {
    const mod = await load();
    expect(mod.judgeSession(undefined, 9).ok).toBe(false);
  });
});
