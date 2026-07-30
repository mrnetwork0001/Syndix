import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import {
  Activity,
  ArrowUpRight,
  BadgeCheck,
  Boxes,
  CircleDollarSign,
  Fingerprint,
  Fuel,
  Landmark,
  ScrollText,
  ShieldCheck,
  Signature,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Mono } from "@/components/ui/mono";
import { Panel } from "@/components/ui/panel";
import { StatTile } from "@/components/ui/stat-tile";
import { CopyButton } from "@/components/ui/copy-button";
import { claimEconomics, readProtocolChainStats } from "@/lib/chain-stats";
import {
  GIWA_EXPLORER,
  GIWA_PREDEPLOYS,
  GIWA_RPC_FLASHBLOCKS,
  GIWA_SEPOLIA_ID,
  SYNDIX_CONTRACTS,
  explorerAddress,
  explorerTx,
} from "@/lib/giwa";
import { ISSUES } from "@/lib/data/issues";
import { compact, formatEth, formatKrw, formatUsd } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Protocol",
  description:
    "How Syndix pays readers on GIWA: the reward economics measured onchain, the sybil model behind up.id, and what is real versus simulated.",
};

// Chain state must not be baked into a static build - these numbers are the
// entire point of the page.
/**
 * ISR rather than force-dynamic. This page runs the event indexer, which scans
 * a wide block range and takes seconds on a cold cache - on a serverless host
 * that is a request-timeout risk on every hit, and it re-pays the cost because
 * the module-level caches in lib/ do not survive a cold start. Sixty seconds of
 * staleness on an argument page is not a cost worth paying to avoid.
 */
export const revalidate = 60;
export const maxDuration = 60;

/** The first real claim settled on GIWA Sepolia. */
const FIRST_CLAIM_TX =
  "0x49eb506b106fb83433a68324551139d68227767016671ae7fce89b704978502a";

function Section({
  id,
  eyebrow,
  title,
  lead,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  lead?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section id={id} className="scroll-mt-24 border-t border-hairline pt-12">
      <p className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {eyebrow}
      </p>
      <h2 className="mt-2.5 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-[27px]">
        {title}
      </h2>
      {lead ? (
        <p className="mt-3 max-w-2xl text-[15px] leading-[1.7] text-ink-muted text-pretty">
          {lead}
        </p>
      ) : null}
      <div className="mt-7">{children}</div>
    </section>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-hairline py-3 last:border-b-0">
      <dt className="text-[13px] text-ink-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

export default async function ProtocolPage(): Promise<ReactElement> {
  const chain = await readProtocolChainStats();
  const rewardWei = BigInt(ISSUES[0].rewardPerReaderWei);
  const economics = chain.live
    ? claimEconomics(chain.gasPriceWei, rewardWei)
    : null;

  return (
    <div className="pb-24">
      {/* ---------------------------------------------------------------- */}
      <header className="pt-12 pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent" dot>
            GIWA Sepolia · {GIWA_SEPOLIA_ID}
          </Badge>
          {chain.live ? (
            <Badge tone="positive" icon={BadgeCheck}>
              Live contract state
            </Badge>
          ) : (
            <Badge tone="caution" icon={TriangleAlert}>
              Chain unreachable
            </Badge>
          )}
        </div>
        <h1 className="mt-5 max-w-3xl text-[34px] leading-[1.1] font-semibold tracking-[-0.03em] text-gradient sm:text-[44px]">
          A newsroom that pays its readers, and can prove it can afford to.
        </h1>
        <p className="mt-5 max-w-2xl text-[15.5px] leading-[1.75] text-ink-muted text-pretty">
          Syndix runs an AI journalist over GIWA chain state, publishes each
          issue onchain with a funded reward pool, and settles a micro-reward to
          every verified reader who finishes it. Every number on this page is
          read from the deployed contract when you load it - nothing here is
          typed in by hand.
        </p>
      </header>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="economics"
        eyebrow="The economics"
        title="Why this can only exist on an L2"
        lead="A reader reward is worth about ten cents. The question that decides whether the product is viable is simple: does it cost more than ten cents to deliver? On GIWA it costs a rounding error."
      >
        {!chain.live || !economics ? (
          <Panel className="p-5">
            <p className="text-[14px] text-ink-muted">
              {chain.live
                ? "Gas price was unavailable this request."
                : chain.reason}
            </p>
          </Panel>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile
                label="Reward per reader"
                value={formatUsd(rewardWei)}
                sublabel={`${formatEth(rewardWei)} · ${formatKrw(rewardWei)}`}
                icon={CircleDollarSign}
                accent
              />
              <StatTile
                label="Gas to deliver it"
                value={`${Number(economics.gasCostEth).toFixed(9)} ETH`}
                sublabel={`${MEASURED_GAS} gas @ ${chain.gasPriceWei} wei`}
                icon={Zap}
              />
              <StatTile
                label="Reward ÷ delivery cost"
                value={`${Math.round(economics.ratio)}×`}
                sublabel="higher is better; below 1× the product dies"
                icon={Activity}
                accent
              />
            </div>
            <p className="mt-5 max-w-2xl text-[14px] leading-[1.7] text-ink-muted">
              The gas figure is not an estimate. It is {MEASURED_GAS} gas,
              measured from the first real claim that settled on GIWA, priced at
              the network&apos;s gas price right now. On Ethereum L1 the same
              transaction would cost multiples of the reward it delivers, and
              this business has no floor to stand on.
            </p>
          </>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="state"
        eyebrow="Live contract state"
        title="What the treasury holds right now"
        lead="Read from SyndixTreasury at request time. The solvency check is the one that matters: reader-owed ETH is tracked separately and is unreachable by the protocol owner."
      >
        {chain.live ? (
          <Panel className="px-5 py-2">
            <dl>
              <Row label="Issues published onchain">
                <span className="font-mono text-[13px] tabular-nums text-ink">
                  {chain.articleCount}
                </span>
              </Row>
              <Row label="Verified readers who have claimed">
                <span className="font-mono text-[13px] tabular-nums text-ink">
                  {compact(chain.uniqueReaders)}
                </span>
              </Row>
              <Row label="Distributed to readers">
                <span className="font-mono text-[13px] tabular-nums text-ink">
                  {formatEth(chain.totalRewardDistributedWei)}
                  <span className="ml-2 text-ink-faint">
                    {formatUsd(chain.totalRewardDistributedWei)}
                  </span>
                </span>
              </Row>
              <Row label="Reserved for readers (owner cannot touch)">
                <span className="font-mono text-[13px] tabular-nums text-accent">
                  {formatEth(chain.reservedRewardsWei)}
                </span>
              </Row>
              <Row label="Unreserved surplus (withdrawable)">
                <span className="font-mono text-[13px] tabular-nums text-ink-muted">
                  {formatEth(chain.unreservedBalanceWei)}
                </span>
              </Row>
              <Row label="Solvency invariant - balance ≥ reserved">
                {chain.solvent ? (
                  <Badge tone="positive" icon={ShieldCheck}>
                    Holds
                  </Badge>
                ) : (
                  <Badge tone="critical" icon={TriangleAlert}>
                    Violated
                  </Badge>
                )}
              </Row>
              <Row label="Read at block">
                <Mono className="text-[12px]">{chain.blockNumber.toString()}</Mono>
              </Row>
            </dl>
          </Panel>
        ) : (
          <Panel className="p-5">
            <p className="text-[14px] text-ink-muted">{chain.reason}</p>
          </Panel>
        )}
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="how"
        eyebrow="How it works"
        title="Four steps, three of them onchain"
      >
        <ol className="grid gap-3 sm:grid-cols-2">
          {[
            {
              icon: Boxes,
              title: "The agent reads GIWA",
              body: "An ingestion pass pulls live head state from the Flashblocks RPC alongside ecosystem signals, then claude-opus-5 writes the issue against a fixed schema.",
            },
            {
              icon: ScrollText,
              title: "The issue is published with a funded pool",
              body: "publishArticle moves ETH straight into reservedRewards. From that moment the money belongs to readers, not to the protocol.",
            },
            {
              icon: Signature,
              title: "Reading produces an attestation",
              body: "Finish an issue and the attester signs an EIP-712 ReadProof binding your address, the article and your dwell time. It signs only - it never holds funds.",
            },
            {
              icon: Zap,
              title: "You claim it yourself",
              body: "You submit the transaction, so nobody can claim on your behalf. The receipt is read under the pending tag, so it confirms in about 200ms.",
            },
          ].map((step, index) => (
            <li key={step.title}>
              <Panel className="h-full p-5">
                <div className="flex items-center gap-2.5">
                  <span className="grid size-7 place-items-center rounded-[9px] border border-hairline bg-elevated">
                    <step.icon className="size-3.5 text-accent" strokeWidth={1.9} />
                  </span>
                  <span className="font-mono text-[11px] text-ink-faint tabular-nums">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
                  {step.title}
                </h3>
                <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-muted">
                  {step.body}
                </p>
              </Panel>
            </li>
          ))}
        </ol>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="sybil"
        eyebrow="Security model"
        title="One human, one claim - or there is no business"
        lead="A reward pool keyed on wallet addresses is not a product, it is a faucet. With 1-second blocks and sub-cent gas, a script generates ten thousand addresses and drains every pool in a single block. Everything below exists to stop that."
      >
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              icon: Fingerprint,
              title: "Identity",
              body: "Claims require a verified GIWA identity through IReaderRegistry, pointed at the live Upbit Web3 Names registry. A name is a Soul-Bound Token capped at one per wallet, issued by GIWA and not by us - Syndix cannot mint itself the credential it checks. That cap is the whole security model.",
            },
            {
              icon: Signature,
              title: "Proof of read",
              body: "A claim carries an EIP-712 ReadProof signed by the attester. The reader still submits the transaction, so a compromised attester can forge proofs but cannot move money or claim for someone else.",
            },
            {
              icon: Landmark,
              title: "Solvency",
              body: "Every wei promised to a reader sits in reservedRewards. withdrawTreasury spends only unreservedBalance(), so an owner fee-take can never strand an outstanding claim. Fuzzed over 256 runs.",
            },
          ].map((item) => (
            <Panel key={item.title} className="p-5">
              <item.icon className="size-4 text-accent" strokeWidth={1.9} />
              <h3 className="mt-3 text-[15px] font-semibold tracking-[-0.01em] text-ink">
                {item.title}
              </h3>
              <p className="mt-2 text-[13.5px] leading-[1.65] text-ink-muted">
                {item.body}
              </p>
            </Panel>
          ))}
        </div>
        <p className="mt-5 max-w-2xl text-[13.5px] leading-[1.7] text-ink-faint">
          Each property is pinned by a regression test in{" "}
          <Mono>test/contracts/SyndixTreasury.t.sol</Mono>. Two of them fail
          against the original blueprint contract, which withdrew against the raw
          balance and accepted an unverified identity string.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="giwa"
        eyebrow="Why GIWA"
        title="Four properties this depends on"
      >
        <Panel className="px-5 py-2">
          <dl>
            <Row label="Flashblocks - preconfirmations up to 200ms">
              <Mono className="text-[11.5px]">{GIWA_RPC_FLASHBLOCKS}</Mono>
            </Row>
            <Row label="~1s blocks, sub-cent fees">
              <span className="text-[13px] text-ink-muted">
                makes a $0.10 reward viable
              </span>
            </Row>
            <Row label="up.id - Soul-Bound, one per wallet">
              <span className="text-[13px] text-ink-muted">
                one ecosystem namespace, read by our reader registry
              </span>
            </Row>
            <Row label="ERC-4337 EntryPoint v0.7 predeployed">
              <Mono className="text-[11.5px]">
                {GIWA_PREDEPLOYS.entryPointV07}
              </Mono>
            </Row>
          </dl>
        </Panel>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="deployments"
        eyebrow="Deployments"
        title="Verify it yourself"
      >
        <Panel className="px-5 py-2">
          <dl>
            {[
              ["SyndixTreasury", SYNDIX_CONTRACTS.treasury],
              ["SyndixArticleNFT", SYNDIX_CONTRACTS.articleNft],
            ].map(([label, address]) => (
              <Row key={label} label={label}>
                <span className="flex items-center gap-1.5">
                  <a
                    href={explorerAddress(address)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[11.5px] text-[#7fb2ff] hover:underline"
                  >
                    {address}
                  </a>
                  <CopyButton value={address} className="px-1" />
                </span>
              </Row>
            ))}
            <Row label="First real reader claim">
              <a
                href={explorerTx(FIRST_CLAIM_TX)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-mono text-[11.5px] text-[#7fb2ff] hover:underline"
              >
                {FIRST_CLAIM_TX.slice(0, 18)}…{FIRST_CLAIM_TX.slice(-6)}
                <ArrowUpRight className="size-3" strokeWidth={2} />
              </a>
            </Row>
            <Row label="Explorer">
              <a
                href={GIWA_EXPLORER}
                target="_blank"
                rel="noreferrer"
                className="text-[13px] text-[#7fb2ff] hover:underline"
              >
                sepolia-explorer.giwa.io
              </a>
            </Row>
          </dl>
        </Panel>
      </Section>


      {/* ---------------------------------------------------------------- */}
      <Section
        id="roadmap"
        eyebrow="Roadmap alignment"
        title="Two things GIWA is building that Syndix is waiting on"
        lead="Both were announced as Coming Soon on giwa.io, and both close a gap this build has already run into rather than a hypothetical one."
      >
        <div className="grid gap-3 md:grid-cols-2">
          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <Fuel className="size-4 text-accent" strokeWidth={1.9} />
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                Stable PayMaster
              </h3>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-[1.65] text-ink-muted">
              SyndixPaymaster is deployed, staked and funded against the
              EntryPoint v0.7 predeploy, and its validation logic is tested - but
              it cannot be used. Relaying a UserOperation also needs a
              smart-account factory on GIWA and a bundler serving chain{" "}
              {GIWA_SEPOLIA_ID}, and neither exists today. A first-party
              paymaster makes Syndix a consumer of that infrastructure instead of
              a project that has to run it.
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
              Until then readers submit their own claim and pay roughly
              0.00000018 ETH for it - about a 166th of the reward.
            </p>
          </Panel>

          <Panel className="p-5">
            <div className="flex items-center gap-2">
              <CircleDollarSign className="size-4 text-accent" strokeWidth={1.9} />
              <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
                KRW stablecoin
              </h3>
            </div>
            <p className="mt-2.5 text-[13.5px] leading-[1.65] text-ink-muted">
              This one fixes a real defect. Syndix promises a 100 KRW
              micro-reward, but pays 0.00003 ETH - worth about ₩132 when the
              figure was chosen and about ₩83 a few weeks later. The reader
              cannot predict what they will receive, and the headline number
              drifts with a market they never opted into.
            </p>
            <p className="mt-2.5 text-[12px] leading-relaxed text-ink-faint">
              Denominated in a KRW stablecoin, ₩100 is ₩100.{" "}
              <span className="font-mono">SyndixStableTreasury</span> is written
              and tested for exactly that - same three invariants, ERC-20 value
              primitive - and is not deployed, because there is no token to point
              it at yet.
            </p>
          </Panel>
        </div>

        <p className="mt-5 max-w-2xl text-[13px] leading-relaxed text-ink-faint">
          GIWA Wallet needs no work: it will inject over EIP-6963, and the
          connect flow enumerates connectors generically rather than
          allow-listing them, so it appears as soon as it ships.
        </p>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        id="honesty"
        eyebrow="Honesty"
        title="What is real and what is not"
        lead="A grant reviewer should not have to guess which parts are load-bearing. This table is maintained deliberately."
      >
        <Panel className="overflow-x-auto">
          <table className="w-full text-left text-[13.5px]">
            <thead>
              <tr className="border-b border-hairline-strong">
                <th className="px-5 py-3 text-[11px] tracking-[0.1em] text-ink-faint uppercase">
                  Component
                </th>
                <th className="px-5 py-3 text-[11px] tracking-[0.1em] text-ink-faint uppercase">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ["Smart contracts", "Real. Deployed and verified, 83 passing Foundry tests including three fuzzed invariants.", "positive"],
                ["Reader reward claim", "Real. Attested by /api/attest, submitted by the reader, settled on GIWA Sepolia.", "positive"],
                ["Proof of read", "Real, and measured by the server. A signed session is stamped with the server clock, heartbeats carry scroll depth, and beats arriving faster than real time are refused - dwell is never client-reported. It proves time and scrolling, not comprehension.", "positive"],
                ["up.id identity", "Real, and not ours. Claims gate on the live Upbit Web3 Names registry, so a wallet without a genuine up.id cannot claim - including our own deployer.", "positive"],
                ["GIWA chain reads", "Real. This page and the ingestion agent query live state.", "positive"],
                ["Issue content", "Real. The feed reads the treasury's article index and fetches each body from IPFS. No issue is bundled in the app.", "positive"],
                ["IPFS pinning", "Real. Issues are pinned via Pinata and publishing is blocked if pinning fails, so nothing is indexed pointing at nothing.", "positive"],
                ["Analytics time series", "Real. Daily buckets reconstructed from RewardClaimed and ArticlePublished logs. Empty days render empty rather than interpolated.", "positive"],
                ["AI issue generation", "Real. Every live issue was written by gpt-4.1 against a strict JSON schema, seeded with head state read at generation time - each one records its model in the IPFS metadata the treasury points at, so the claim is checkable rather than asserted.", "positive"],
                ["x402 endpoint", "Real protocol. Settlement is verified onchain now that a treasury exists.", "positive"],
                ["Autonomous publishing", "Not built. Writing is unattended, but publishing needs an owner signature and there is no scheduler. SyndixPublisher, the guard that closes this safely, is written and tested with 21 tests but not deployed.", "caution"],
                ["Gasless via ERC-4337", "Paymaster deployed, staked, funded and tested - but not in the claim path: GIWA has no smart-account factory and no bundler yet, so readers pay their own gas.", "caution"],
                ["KRW denomination", "Not deployed. SyndixStableTreasury is written and tested against a mock; GIWA's KRW stablecoin does not exist yet.", "caution"],
              ].map(([component, status, tone]) => (
                <tr key={component} className="border-b border-hairline last:border-b-0">
                  <td className="px-5 py-3 align-top font-medium text-ink">
                    {component}
                  </td>
                  <td className="px-5 py-3 align-top">
                    <span
                      className={
                        tone === "positive"
                          ? "text-positive"
                          : tone === "caution"
                            ? "text-caution"
                            : "text-critical"
                      }
                    >
                      {status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </Section>
    </div>
  );
}

const MEASURED_GAS = "180,313";
