import type { ReactElement } from "react";
import { ArrowUpRight, Coins, Fingerprint, Timer } from "lucide-react";
import { Panel } from "@/components/ui/panel";
import { Mono } from "@/components/ui/mono";
import { UP_ID_PLAYGROUND } from "@/lib/giwa";
import { cn, formatEth, formatUsd } from "@/lib/utils";

export interface HowItWorksProps {
  /** `rewardPerReader` from the newest article, in wei. */
  rewardPerReaderWei?: string;
  /** `minDwellSeconds` from the treasury — the contract rejects anything shorter. */
  minDwellSeconds: number;
  /** Claims still funded across every active article. */
  claimsRemaining?: number;
  className?: string;
}

/**
 * The reader's path, stated on the page they land on.
 *
 * Syndix reads as a publishing platform to a first-time visitor, and it is not
 * one — nobody submits an article and nothing is moderated. What a visitor can
 * actually do is get paid to read, and every requirement for that is on chain
 * and checkable: hold a `up.id`, dwell past `minDwellSeconds`, receive
 * `rewardPerReader`. Those three numbers are read from the contract rather than
 * written here, so this panel cannot drift away from what the treasury enforces.
 *
 * The identity step points off-site on purpose. Names are issued by GIWA, not by
 * Syndix, and pretending otherwise would be the exact overclaim the honesty rule
 * exists to prevent.
 */
export function HowItWorks({
  rewardPerReaderWei,
  minDwellSeconds,
  claimsRemaining,
  className,
}: HowItWorksProps): ReactElement {
  // Lead with fiat and keep ETH secondary, the same way the claim bar does —
  // a reader decides on "six cents", not on a wei count.
  const rewardFiat = rewardPerReaderWei ? formatUsd(rewardPerReaderWei) : null;
  const rewardEth = rewardPerReaderWei ? formatEth(rewardPerReaderWei) : null;

  const steps = [
    {
      icon: Fingerprint,
      label: "Get a up.id",
      body: (
        <>
          One soul-bound name per wallet, issued by GIWA — this is what caps the
          reward at one claim per human. Syndix cannot mint you one; it only
          checks that you hold it.
        </>
      ),
      action: (
        <a
          href={UP_ID_PLAYGROUND}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium text-accent transition-opacity duration-150 hover:opacity-80"
        >
          Mint one on GIWA
          <ArrowUpRight className="size-3.5" strokeWidth={2} />
        </a>
      ),
    },
    {
      icon: Timer,
      label: `Read for ${minDwellSeconds}s`,
      body: (
        <>
          Open any issue and read it. Past{" "}
          <Mono className="text-[11.5px] text-ink-muted">{`${minDwellSeconds}s`}</Mono>{" "}
          the attester signs an EIP-712 proof of your dwell time. It is a
          signature, not an approval — no human reviews your claim.
        </>
      ),
      action: null,
    },
    {
      icon: Coins,
      label: rewardFiat ? `Claim ${rewardFiat}` : "Claim your reward",
      body: (
        <>
          You send the transaction yourself and the treasury pays you{" "}
          {rewardEth ? (
            <Mono className="text-[11.5px] text-ink-muted">{rewardEth}</Mono>
          ) : (
            "the reward"
          )}
          {", settled in about a second. Syndix never takes custody and cannot claim on your behalf."}
        </>
      ),
      action: null,
    },
  ];

  return (
    <section className={cn(className)} aria-labelledby="how-it-works">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-hairline pb-4">
        <div>
          <h2
            id="how-it-works"
            className="text-[11px] tracking-[0.14em] text-ink-faint uppercase"
          >
            Get paid to read
          </h2>
          <p className="mt-1.5 text-sm text-ink-muted">
            AI agents write these issues; you get paid to finish them. Three
            steps, no application, no approval.
          </p>
        </div>
        {claimsRemaining !== undefined && claimsRemaining > 0 ? (
          <p className="font-mono text-[11.5px] text-ink-faint tabular-nums">
            {claimsRemaining} rewards funded and unclaimed
          </p>
        ) : null}
      </div>

      <ol className="mt-6 grid gap-3 md:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.label}>
            <Panel className="flex h-full flex-col p-5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-hairline bg-elevated font-mono text-[11px] text-ink-faint tabular-nums">
                  {index + 1}
                </span>
                <step.icon
                  className="size-3.5 shrink-0 text-ink-muted"
                  strokeWidth={1.9}
                />
                <h3 className="text-[13.5px] font-medium tracking-[-0.01em] text-ink">
                  {step.label}
                </h3>
              </div>
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-ink-muted">
                {step.body}
              </p>
              {step.action}
            </Panel>
          </li>
        ))}
      </ol>
    </section>
  );
}
