"use client";

import { useCallback, useState, type ReactElement } from "react";
import { Braces, CreditCard, Send, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Panel, PanelHeader } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

const RESOURCE = "/api/x402/feed";

/**
 * Mirrors `X402_PAYMENT_HEADER` in lib/x402. Declared locally so the browser
 * bundle does not drag in the server-side settlement verifier and its viem
 * public client.
 */
const PAYMENT_HEADER = "x-payment";

/**
 * A well-formed GIWA Sepolia tx hash used as the demo payment proof. With no
 * treasury deployed there is nothing to settle against, so the route answers
 * `accepted-unverified` and the panel says so rather than implying a payment
 * landed on-chain.
 */
const DEMO_PAYMENT_TX =
  "0x18e738d79918dab34d85ed13794b602a9a087e11f34eb4a498710fe1d5df4067";

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  402: "Payment Required",
  500: "Internal Server Error",
};

type Attempt = {
  paid: boolean;
  status: number;
  statusText: string;
  body: string;
  settlement: string | null;
  durationMs: number;
  /** Captured at request time — reading it during render would break SSR. */
  origin: string;
};

function readSettlementMode(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const settlement = (payload as { settlement?: unknown }).settlement;
  if (typeof settlement !== "object" || settlement === null) return null;
  const verification = (settlement as { verification?: unknown }).verification;
  return typeof verification === "string" ? verification : null;
}

export function X402Panel(): ReactElement {
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [pending, setPending] = useState<"unpaid" | "paid" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = useCallback(async (paid: boolean) => {
    setPending(paid ? "paid" : "unpaid");
    setError(null);
    const startedAt = performance.now();
    try {
      const response = await fetch(RESOURCE, {
        headers: paid ? { [PAYMENT_HEADER]: DEMO_PAYMENT_TX } : undefined,
        cache: "no-store",
      });
      const raw = await response.text();
      let parsed: unknown = null;
      let body = raw;
      try {
        parsed = JSON.parse(raw);
        body = JSON.stringify(parsed, null, 2);
      } catch {
        // Non-JSON responses are shown verbatim.
      }
      setAttempt({
        paid,
        status: response.status,
        statusText:
          response.statusText || STATUS_TEXT[response.status] || "Response",
        body,
        settlement: readSettlementMode(parsed),
        durationMs: Math.round(performance.now() - startedAt),
        origin: window.location.origin,
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(null);
    }
  }, []);

  const curl = !attempt
    ? ""
    : attempt.paid
      ? `curl -i -H "${PAYMENT_HEADER}: ${DEMO_PAYMENT_TX}" \\\n  ${attempt.origin}${RESOURCE}`
      : `curl -i ${attempt.origin}${RESOURCE}`;

  const ok = attempt?.status === 200;

  return (
    <Panel>
      <PanelHeader
        title="x402 machine payments"
        description="HTTP 402 Payment Required, answered with the exact settlement terms."
        icon={CreditCard}
        action={<Badge tone="violet">Nodit x402</Badge>}
      />

      <div className="space-y-3 px-5 py-4">
        <p className="text-xs leading-relaxed text-ink-muted">
          An AI agent that wants Syndix&rsquo;s raw alpha feed pays per request
          over HTTP instead of signing up for an API key.
        </p>
        <p className="text-xs leading-relaxed text-ink-muted">
          The 402 body carries the price, the asset, the payee and the network,
          so the buyer can settle on GIWA and retry without reading any docs.
        </p>
      </div>

      <div className="grid gap-2 border-t border-hairline px-5 py-4 sm:grid-cols-2">
        <Button
          icon={Send}
          full
          loading={pending === "unpaid"}
          disabled={pending !== null}
          onClick={() => send(false)}
        >
          Send unpaid request
        </Button>
        <Button
          variant="primary"
          icon={CreditCard}
          full
          loading={pending === "paid"}
          disabled={pending !== null}
          onClick={() => send(true)}
        >
          Retry with payment proof
        </Button>
      </div>

      {error ? (
        <div className="mx-5 mb-4 flex items-start gap-2 rounded-card border border-critical/30 bg-critical/[0.1] px-3.5 py-2.5">
          <TriangleAlert
            className="mt-px size-3.5 shrink-0 text-critical"
            strokeWidth={2}
          />
          <span className="text-xs leading-relaxed text-critical">{error}</span>
        </div>
      ) : null}

      {attempt ? (
        <div className="animate-rise space-y-3 border-t border-hairline px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span
              className={cn(
                "font-mono text-xs tabular-nums",
                ok ? "text-positive" : "text-caution",
              )}
            >
              HTTP/1.1 {attempt.status} {attempt.statusText}
            </span>
            <span className="font-mono text-[11px] text-ink-faint tabular-nums">
              {attempt.paid ? `${PAYMENT_HEADER} sent` : "no payment header"}{" "}
              · {attempt.durationMs}ms
            </span>
          </div>

          <div className="overflow-hidden rounded-card border border-hairline bg-void/70">
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
              <span className="inline-flex items-center gap-1.5 text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
                <Braces className="size-3" strokeWidth={2} />
                {attempt.status === 402 ? "X402Challenge" : "Response body"}
              </span>
              <CopyButton value={attempt.body} label="Copy" />
            </div>
            <pre className="max-h-64 overflow-auto px-3.5 py-3 font-mono text-[11px] leading-[1.65] text-ink-muted">
              {attempt.body}
            </pre>
          </div>

          {attempt.settlement === "accepted-unverified" ? (
            <p className="text-[11px] leading-relaxed text-caution">
              Settlement reported as{" "}
              <span className="font-mono">accepted-unverified</span> — the header
              is well-formed but no treasury is deployed, so nothing was checked
              on-chain. Deploy SyndixTreasury to switch this to{" "}
              <span className="font-mono">onchain</span>.
            </p>
          ) : null}

          <div className="overflow-hidden rounded-card border border-hairline bg-void/70">
            <div className="flex items-center justify-between gap-2 border-b border-hairline px-3 py-1.5">
              <span className="text-[10.5px] tracking-[0.14em] text-ink-faint uppercase">
                Equivalent request
              </span>
              <CopyButton value={curl} label="Copy" />
            </div>
            <pre className="overflow-x-auto px-3.5 py-3 font-mono text-[11px] leading-[1.65] text-ink-muted">
              {curl}
            </pre>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}
