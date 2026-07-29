"use client";

import {
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  ArrowUpRight,
  BadgeCheck,
  Check,
  Fingerprint,
  Fuel,
  LoaderCircle,
  Signature,
  TriangleAlert,
  Wallet,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { WagmiContext, useAccount, useConnect, useConnectors } from "wagmi";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Mono } from "@/components/ui/mono";
import {
  GIWA_PREDEPLOYS,
  GIWA_SEPOLIA_ID,
  explorerTx,
  isValidUpId,
  normalizeUpId,
  shortenAddress,
} from "@/lib/giwa";
import type { Issue } from "@/lib/types";
import {
  cn,
  formatEth,
  formatInt,
  formatKrw,
  formatUsd,
  seededRandom,
} from "@/lib/utils";

/** Dwell floor the attester would sign for. Deliberately conservative. */
const MIN_DWELL_SECONDS = 15;

const PRECONFIRM_MS = 187;
const SEAL_MS = 1010;

type Stage = "idle" | "attesting" | "sponsoring" | "preconfirmed" | "sealed";

const STAGE_ORDER: Stage[] = [
  "idle",
  "attesting",
  "sponsoring",
  "preconfirmed",
  "sealed",
];

const rank = (stage: Stage) => STAGE_ORDER.indexOf(stage);

type StepState = "todo" | "active" | "done" | "blocked";

/**
 * A 32-byte hash shaped like a GIWA tx hash, derived deterministically from
 * the claim inputs. It is NOT a transaction — nothing is broadcast — and every
 * surface that shows it is required to say so.
 */
function simulatedHash(seed: string): string {
  const rnd = seededRandom(seed);
  let out = "0x";
  for (let i = 0; i < 64; i++) {
    out += "0123456789abcdef"[Math.floor(rnd() * 16)];
  }
  return out;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/* ------------------------------------------------------------------ */
/*  Step scaffold                                                      */
/* ------------------------------------------------------------------ */

function StepMarker({ index, state }: { index: number; state: StepState }): ReactElement {
  if (state === "done") {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-positive/40 bg-positive/15 text-positive">
        <Check className="size-3.5" strokeWidth={2.6} />
      </span>
    );
  }
  if (state === "active") {
    return (
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-accent/50 bg-accent/15 text-accent">
        <LoaderCircle className="size-3.5 animate-spin" strokeWidth={2.4} />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[11px] tabular-nums",
        state === "blocked"
          ? "border-caution/35 bg-caution/10 text-caution"
          : "border-hairline bg-elevated text-ink-faint",
      )}
    >
      {index}
    </span>
  );
}

function Step({
  index,
  title,
  icon: Icon,
  state,
  last = false,
  children,
}: {
  index: number;
  title: string;
  icon: LucideIcon;
  state: StepState;
  last?: boolean;
  children: ReactNode;
}): ReactElement {
  return (
    <li className="relative flex gap-3.5">
      {last ? null : (
        <span
          aria-hidden
          className="absolute top-7 bottom-0 left-3 w-px bg-hairline"
        />
      )}
      <StepMarker index={index} state={state} />
      <div className={cn("min-w-0 flex-1", last ? "pb-0" : "pb-5")}>
        <div className="flex items-center gap-2">
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              state === "todo" ? "text-ink-faint" : "text-ink-muted",
            )}
            strokeWidth={1.9}
          />
          <h3
            className={cn(
              "text-[13px] font-medium tracking-[-0.01em]",
              state === "todo" ? "text-ink-muted" : "text-ink",
            )}
          >
            {title}
          </h3>
        </div>
        <div className="mt-2">{children}</div>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Wallet — isolated so the modal still renders without a provider    */
/* ------------------------------------------------------------------ */

function WalletIdentity({
  onAddress,
}: {
  onAddress: (address: string | undefined) => void;
}): ReactElement {
  const { address, chainId, isConnected, isConnecting, isReconnecting } = useAccount();
  const connectors = useConnectors();
  const { mutate: connect, isPending, error } = useConnect();

  useEffect(() => {
    onAddress(address);
  }, [address, onAddress]);

  if (!isConnected || !address) {
    const connector = connectors[0];
    return (
      <div className="space-y-2">
        <p className="text-[12.5px] leading-relaxed text-ink-muted">
          Connect a wallet to prove which address the reward settles to. Syndix never
          takes custody and never signs on your behalf.
        </p>
        <Button
          size="sm"
          variant="secondary"
          icon={Wallet}
          loading={isPending || isConnecting || isReconnecting}
          disabled={!connector}
          onClick={() => {
            if (connector) connect({ connector });
          }}
        >
          {connector ? "Connect wallet" : "No wallet detected"}
        </Button>
        {error ? (
          <p className="text-[11.5px] text-critical">{error.message}</p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="positive" icon={BadgeCheck}>
          Connected
        </Badge>
        <Mono className="text-[11.5px]">{shortenAddress(address)}</Mono>
      </div>
      {chainId !== undefined && chainId !== GIWA_SEPOLIA_ID ? (
        <p className="text-[11.5px] leading-relaxed text-caution">
          Wallet is on chain {chainId}. Claims settle on GIWA Sepolia ({GIWA_SEPOLIA_ID}).
        </p>
      ) : null}
      <p className="text-[11.5px] leading-relaxed text-ink-faint">
        The reward is sent to this address; the up.id below is what caps it at one claim.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Modal                                                              */
/* ------------------------------------------------------------------ */

export interface ClaimModalProps {
  issue: Issue;
  open: boolean;
  onClose: () => void;
  dwellSeconds: number;
  onClaimed: (hash: string) => void;
}

/**
 * Mount this only while it is open — a fresh mount per open is what resets the
 * flow, rather than an effect reaching back into state.
 */

export function ClaimModal({
  issue,
  open,
  onClose,
  dwellSeconds,
  onClaimed,
}: ClaimModalProps): ReactElement | null {
  const titleId = useId();
  const inputId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const hasWagmi = useContext(WagmiContext) !== undefined;

  const [address, setAddress] = useState<string | undefined>(undefined);
  const [nameInput, setNameInput] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);

  const normalized = normalizeUpId(nameInput);
  const nameValid = isValidUpId(normalized);
  const identityReady = Boolean(address) && nameValid;
  const dwellReady = dwellSeconds >= MIN_DWELL_SECONDS;
  const running = stage !== "idle" && stage !== "sealed";
  const canClaim = identityReady && dwellReady && stage === "idle";

  const settledBlock = (issue.mintBlock ?? 28_900_000) + 1_284;

  const clearTimers = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer);
    timers.current = [];
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  /**
   * The dialog effect must run exactly once per open. `onClose` is usually an
   * inline arrow from the caller, and this component re-renders every second
   * while dwell ticks — depending on it directly would tear the trap down and
   * yank focus back to the trigger on every tick.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  /* Dialog behaviour: scroll lock, focus trap, focus restore, Escape. */
  useEffect(() => {
    if (!open) return;

    const restoreTo =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const { body } = document;
    const previousOverflow = body.style.overflow;
    body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    const frame = requestAnimationFrame(() => {
      (inputRef.current ?? panelRef.current)?.focus();
    });

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      cancelAnimationFrame(frame);
      body.style.overflow = previousOverflow;
      restoreTo?.focus();
    };
  }, [open]);

  const start = useCallback(() => {
    if (!canClaim || !address) return;
    const hash = simulatedHash(`${issue.id}|${normalized}|${address}|${dwellSeconds}`);

    const attested = 720;
    const sponsored = attested + 520;
    const preconfirmed = sponsored + PRECONFIRM_MS;

    setStage("attesting");
    timers.current.push(setTimeout(() => setStage("sponsoring"), attested));
    timers.current.push(
      setTimeout(() => {
        setTxHash(hash);
        setStage("preconfirmed");
      }, preconfirmed),
    );
    timers.current.push(
      setTimeout(() => {
        setStage("sealed");
        onClaimed(hash);
      }, preconfirmed + SEAL_MS),
    );
  }, [canClaim, address, issue.id, normalized, dwellSeconds, onClaimed]);

  const stepState = useMemo<Record<1 | 2 | 3 | 4, StepState>>(() => {
    const r = rank(stage);
    return {
      1: identityReady ? "done" : "todo",
      2: r >= rank("sponsoring") ? "done" : r === rank("attesting") ? "active" : dwellReady ? "todo" : "blocked",
      3: r >= rank("preconfirmed") ? "done" : r === rank("sponsoring") ? "active" : "todo",
      4: stage === "sealed" ? "done" : r >= rank("preconfirmed") ? "active" : "todo",
    };
  }, [stage, identityReady, dwellReady]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/70 backdrop-blur-[3px]"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="panel animate-rise relative flex max-h-[88dvh] w-full max-w-[520px] flex-col overflow-hidden"
      >
        <header className="flex items-start justify-between gap-4 border-b border-hairline px-5 py-4">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="text-[15px] font-semibold tracking-[-0.015em] text-ink"
            >
              Claim micro-reward
            </h2>
            <p className="mt-1 truncate text-xs text-ink-muted">
              Issue #{issue.id} · {issue.title}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="grid size-7 shrink-0 place-items-center rounded-lg border border-transparent text-ink-faint transition-colors duration-150 ease-out hover:border-hairline hover:bg-elevated hover:text-ink"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        </header>

        <div className="flex items-start gap-2.5 border-b border-hairline bg-caution/[0.07] px-5 py-3">
          <TriangleAlert className="mt-px size-4 shrink-0 text-caution" strokeWidth={1.9} />
          <p className="text-[11.5px] leading-relaxed text-caution">
            Simulated — contracts not yet deployed to GIWA Sepolia. Nothing below is
            signed, submitted or broadcast, and the resulting hash is fabricated.
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <ol>
            <Step index={1} title="Identity" icon={Fingerprint} state={stepState[1]}>
              <div className="space-y-3">
                {hasWagmi ? (
                  <WalletIdentity onAddress={setAddress} />
                ) : (
                  <p className="text-[12.5px] leading-relaxed text-caution">
                    Wallet provider unavailable in this render — connect from the app
                    shell to continue.
                  </p>
                )}

                <div>
                  <label
                    htmlFor={inputId}
                    className="text-[11px] tracking-[0.14em] text-ink-faint uppercase"
                  >
                    Your up.id
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input
                      id={inputId}
                      ref={inputRef}
                      value={nameInput}
                      onChange={(event) => setNameInput(event.target.value)}
                      disabled={running || stage === "sealed"}
                      placeholder="alice or alice.up.id"
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={nameInput.length > 0 && !nameValid}
                      aria-describedby={`${inputId}-help`}
                      className={cn(
                        "h-9 w-full rounded-[11px] border bg-elevated px-3 font-mono text-[13px] text-ink",
                        "placeholder:font-sans placeholder:text-ink-faint",
                        "transition-colors duration-150 ease-out outline-none",
                        "disabled:opacity-50",
                        nameInput.length > 0 && !nameValid
                          ? "border-critical/50"
                          : "border-hairline focus:border-hairline-strong",
                      )}
                    />
                    {nameValid ? (
                      <Check className="size-4 shrink-0 text-positive" strokeWidth={2.4} />
                    ) : null}
                  </div>
                  <p id={`${inputId}-help`} className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                    {nameInput.length > 0 && !nameValid ? (
                      <span className="text-critical">
                        3–31 characters, lowercase letters, digits and hyphens.
                      </span>
                    ) : (
                      <>
                        Resolves to{" "}
                        <span className="font-mono text-ink-muted">
                          {normalized || "name.up.id"}
                        </span>{" "}
                        — a Soul-Bound ENS subdomain of{" "}
                        <span className="font-mono">up.id</span>, capped at one per
                        wallet. That cap is what makes the reward pool sybil-resistant.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </Step>

            <Step index={2} title="Proof of read" icon={Signature} state={stepState[2]}>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                The client requests an EIP-712{" "}
                <span className="font-mono text-[12px] text-ink">ReadProof</span>{" "}
                attestation from the Syndix attester certifying dwell time. You still
                submit the claim yourself, so the attester never custodies funds.
              </p>
              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                <Badge tone={dwellReady ? "positive" : "caution"}>
                  {dwellSeconds}s dwell
                </Badge>
                <span className="font-mono text-[11px] tabular-nums text-ink-faint">
                  min {MIN_DWELL_SECONDS}s
                </span>
              </div>
              {dwellReady ? null : (
                <p className="mt-2 text-[11.5px] leading-relaxed text-caution">
                  Keep reading — the attester will not sign below the dwell floor.
                </p>
              )}
            </Step>

            <Step index={3} title="Sponsored gas" icon={Fuel} state={stepState[3]}>
              <p className="text-[12.5px] leading-relaxed text-ink-muted">
                The claim is submitted as an ERC-4337 UserOperation through the
                EntryPoint v0.7 predeployed on GIWA, with a Syndix paymaster covering
                gas. You need no ETH and never see a gas prompt.
              </p>
              <div className="mt-2.5 flex items-center gap-2">
                <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                  EntryPoint
                </span>
                <Mono className="truncate text-[11px]">
                  {GIWA_PREDEPLOYS.entryPointV07}
                </Mono>
              </div>
              <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-faint">
                The EntryPoint is a GIWA genesis predeploy. The paymaster is ours — GIWA
                ships no first-party paymaster product.
              </p>
            </Step>

            <Step index={4} title="Settlement" icon={Zap} state={stepState[4]} last>
              {stage === "idle" ? (
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  Reads back from the Flashblocks endpoint under the{" "}
                  <span className="font-mono text-[12px] text-ink">pending</span> tag for
                  a preconfirmation, then confirms against the sealed block.
                </p>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    {rank(stage) >= rank("preconfirmed") ? (
                      <Check className="size-3.5 shrink-0 text-positive" strokeWidth={2.4} />
                    ) : (
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-accent" strokeWidth={2.2} />
                    )}
                    <span className="text-[12.5px] text-ink-muted">
                      {rank(stage) >= rank("preconfirmed")
                        ? `Preconfirmed in ${PRECONFIRM_MS}ms`
                        : "Awaiting preconfirmation…"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {stage === "sealed" ? (
                      <Check className="size-3.5 shrink-0 text-positive" strokeWidth={2.4} />
                    ) : (
                      <LoaderCircle className="size-3.5 shrink-0 animate-spin text-ink-faint" strokeWidth={2.2} />
                    )}
                    <span className="text-[12.5px] text-ink-muted">
                      {stage === "sealed"
                        ? `Sealed in block #${formatInt(settledBlock)}`
                        : "Awaiting sealed block…"}
                    </span>
                  </div>
                </div>
              )}

              {txHash ? (
                <div className="mt-3 rounded-card border border-hairline bg-elevated/70 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                      Tx hash
                    </span>
                    <Badge tone="caution">Simulated</Badge>
                  </div>
                  <div className="mt-2 flex items-center gap-1">
                    <Mono className="truncate text-[11px]">{txHash}</Mono>
                    <CopyButton value={txHash} className="px-1" />
                  </div>
                  <a
                    href={explorerTx(txHash)}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1 rounded-md text-[11.5px] text-ink-faint transition-colors duration-150 hover:text-ink-muted"
                  >
                    Open on GIWA explorer
                    <ArrowUpRight className="size-3" strokeWidth={2} />
                  </a>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                    This hash was generated locally and never broadcast — the explorer
                    will not find it.
                  </p>
                </div>
              ) : null}
            </Step>
          </ol>
        </div>

        <footer className="border-t border-hairline px-5 py-4">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
              Reward
            </span>
            <span className="flex items-baseline gap-2">
              <span className="font-mono text-[17px] leading-none font-medium tabular-nums text-ink">
                {formatKrw(issue.rewardPerReaderWei)}
              </span>
              <span className="font-mono text-[11.5px] tabular-nums text-ink-faint">
                {formatUsd(issue.rewardPerReaderWei)} · {formatEth(issue.rewardPerReaderWei)}
              </span>
            </span>
          </div>

          {stage === "sealed" ? (
            <Button variant="primary" size="lg" full icon={Check} onClick={onClose}>
              Done
            </Button>
          ) : (
            <Button
              variant="primary"
              size="lg"
              full
              icon={Zap}
              loading={running}
              disabled={!canClaim}
              onClick={start}
            >
              {running ? "Settling…" : "Claim micro-reward"}
            </Button>
          )}

          {!canClaim && stage === "idle" ? (
            <p className="mt-2 text-center text-[11.5px] text-ink-faint">
              {!address
                ? "Connect a wallet to continue."
                : !nameValid
                  ? "Enter your up.id to continue."
                  : `Read for ${MIN_DWELL_SECONDS - dwellSeconds}s more to continue.`}
            </p>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
