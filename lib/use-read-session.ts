"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Drives a server-measured read session from the issue page.
 *
 * The browser no longer decides how long the reader has been here - it opens a
 * session, then checks in on a fixed cadence with how far it has scrolled. The
 * server keeps the clock and signs each snapshot, so the token this returns is
 * the only thing `/api/attest` will accept as evidence.
 *
 * Beats pause while the tab is hidden, so leaving an issue open in a background
 * tab does not earn a reward. That is the same rule the old client-side timer
 * used; the difference is that it is now enforced by something the reader
 * cannot edit.
 */

export interface ReadSessionState {
  /** Latest signed session token, or null before the session starts. */
  token: string | null;
  /** Seconds the server has measured. */
  dwellSeconds: number;
  /** Seconds the server requires before it will sign. */
  requiredSeconds: number;
  /** Scroll fraction required, 0..1. */
  requiredDepth: number;
  /** Deepest scroll fraction the server has recorded. */
  depth: number;
  /** True once time and depth both satisfy the server's thresholds. */
  ready: boolean;
  error: string | null;
}

const FALLBACK_INTERVAL = 15;

export function useReadSession(
  articleId: number | undefined,
  /** Live scroll fraction, 0..1, read on each beat. */
  depthRef: { current: number },
): ReadSessionState {
  const [token, setToken] = useState<string | null>(null);
  const [dwellSeconds, setDwell] = useState(0);
  const [depth, setDepth] = useState(0);
  const [requiredSeconds, setRequiredSeconds] = useState(0);
  const [requiredDepth, setRequiredDepth] = useState(1);
  const [interval, setBeatInterval] = useState(FALLBACK_INTERVAL);
  const [error, setError] = useState<string | null>(null);

  // Held in a ref as well so the beat timer never closes over a stale token.
  const tokenRef = useRef<string | null>(null);
  const setBoth = useCallback((next: string) => {
    tokenRef.current = next;
    setToken(next);
  }, []);

  useEffect(() => {
    if (!articleId) return;
    let live = true;

    void fetch("/api/read/session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ articleId }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (!live) return;
        setBoth(data.token as string);
        setRequiredSeconds(Number(data.requiredSeconds) || 0);
        setRequiredDepth(Number(data.requiredDepth) || 1);
        setBeatInterval(Number(data.beatIntervalSeconds) || FALLBACK_INTERVAL);
      })
      .catch(() => {
        if (live) setError("Could not start a read session.");
      });

    return () => {
      live = false;
    };
  }, [articleId, setBoth]);

  useEffect(() => {
    if (!token) return;
    const timer = setInterval(() => {
      // Same rule as before: a backgrounded tab is not reading.
      if (document.hidden || !tokenRef.current) return;
      void fetch("/api/read/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          token: tokenRef.current,
          depth: depthRef.current,
        }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.token) return;
          setBoth(data.token as string);
          setDwell(Number(data.dwellSeconds) || 0);
          setDepth(Number(data.depth) || 0);
        })
        .catch(() => {
          /* A dropped beat costs one interval, not the session. */
        });
    }, interval * 1000);

    return () => clearInterval(timer);
  }, [token, interval, depthRef, setBoth]);

  return {
    token,
    dwellSeconds,
    requiredSeconds,
    requiredDepth,
    depth,
    ready:
      requiredSeconds > 0 &&
      dwellSeconds >= requiredSeconds &&
      depth >= requiredDepth,
    error,
  };
}
