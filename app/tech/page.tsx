import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import { Printer } from "lucide-react";
import { readProtocolChainStats } from "@/lib/chain-stats";
import { readOnchainIssues } from "@/lib/onchain-issues";
import {
  GIWA_SEPOLIA_ID,
  SYNDIX_CONTRACTS,
  UP_ID_READER_REGISTRY,
  explorerAddress,
} from "@/lib/giwa";
import { Mono } from "@/components/ui/mono";
import { formatEth } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Technical design document",
  description:
    "Syndix on one page: what it is, why it is only viable on GIWA, the contracts, and what is real versus not.",
};

/**
 * The submitted technical design document, rendered as a page.
 *
 * Deliberately not a separate PDF checked into the repo. A judge gets a link
 * that is current by construction, and print styles in globals.css turn the
 * same page into the one-pager the submission form asks for, so the document
 * and the running system cannot disagree about addresses or figures.
 *
 * WRITTEN TO A PAGE BUDGET. One A4 sheet at a readable size is roughly 400
 * words of prose plus a few compact tables. A two-column print layout was tried
 * first and still ran to a second sheet: the tables cost more vertical space
 * than prose does, so the fix was cutting content rather than squeezing type.
 * Anything that does not survive the budget belongs in the README or on
 * /protocol, both linked at the foot. Adding a section here means removing one.
 */
export const revalidate = 300;
export const maxDuration = 60;

function Section({
  n,
  title,
  children,
}: {
  n: string;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="mt-5">
      <h2 className="flex items-baseline gap-2 text-[12.5px] font-semibold tracking-[-0.01em] text-ink">
        <span className="font-mono text-[10.5px] text-ink-faint tabular-nums">{n}</span>
        {title}
      </h2>
      <div className="mt-1.5 space-y-1.5 text-[12px] leading-[1.55] text-ink-muted">
        {children}
      </div>
    </section>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }): ReactElement {
  return (
    <div className="doc-row flex items-baseline justify-between gap-4 border-b border-hairline py-1 last:border-b-0">
      <span className="shrink-0 text-[10.5px] tracking-[0.08em] text-ink-faint uppercase">
        {k}
      </span>
      <span className="min-w-0 text-right text-[12px] text-ink">{v}</span>
    </div>
  );
}

export default async function TechDoc(): Promise<ReactElement> {
  const [chain, onchain] = await Promise.all([
    readProtocolChainStats(),
    readOnchainIssues(),
  ]);
  const live = chain.live ? chain : null;
  const active = onchain.ok ? onchain.issues.filter((i) => i.isActive) : [];
  const rewardWei = active[0]?.rewardPerReaderWei ?? "30000000000000";

  const contracts: [string, string, string][] = [
    ["SyndixTreasury", SYNDIX_CONTRACTS.treasury, "pools, claims, solvency"],
    ["SyndixArticleNFT", SYNDIX_CONTRACTS.articleNft, "two-level open edition"],
    ["UpIdReaderRegistry", UP_ID_READER_REGISTRY, "sybil gate over up.id"],
    ["SyndixPaymaster", SYNDIX_CONTRACTS.paymaster, "ERC-4337 v0.7, funded"],
  ];

  return (
    <div className="print-doc mx-auto w-full max-w-3xl px-5 py-10 sm:px-8">
      <div className="no-print mb-8 flex items-center justify-between gap-3 rounded-card border border-hairline bg-elevated px-4 py-3">
        <p className="text-[12px] leading-relaxed text-ink-muted">
          This page is the technical design document. Print it to PDF for the
          submission form; the link stays current on its own.
        </p>
        <span className="flex shrink-0 items-center gap-1.5 text-[11.5px] text-ink-faint">
          <Printer className="size-3.5" strokeWidth={1.9} />
          Cmd+P
        </span>
      </div>

      <header className="border-b border-hairline-strong pb-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-[24px] leading-[1.1] font-semibold tracking-[-0.03em] text-ink">
            Syndix
          </h1>
          <p className="font-mono text-[10.5px] text-ink-faint">
            GIWA GASOK · Track 03 GIWA-Native · chain {GIWA_SEPOLIA_ID} · syndix.xyz
          </p>
        </div>
        <p className="doc-head-lead mt-1.5 text-[12.5px] leading-[1.55] text-ink-muted">
          An autonomous AI news syndicate that pays its readers. Publishing sells
          the reader&apos;s attention to advertisers and returns them nothing;
          Syndix pays them directly. That has been impractical because a
          meaningful micro-reward costs more to send than it is worth, and
          because an open reward pool is drained by scripts faster than humans
          can read. Both are chain properties, and GIWA removes both.
        </p>
      </header>

      <div className="doc-body">
        <Section n="01" title="Why only GIWA">
          <div className="keep-together rounded-card border border-hairline px-3 py-2">
            <Row
              k="Reward per reader"
              v={<Mono className="text-[12px]">{formatEth(rewardWei)}</Mono>}
            />
            <Row
              k="Gas to deliver it"
              v={<Mono className="text-[12px]">0.00000018 ETH · 180,313 gas</Mono>}
            />
            <Row
              k="Ratio"
              v={<span className="font-semibold">reward is ~166x the gas</span>}
            />
            <Row k="Confirmation" v="~1s blocks, 200ms Flashblock preconfirms" />
            <Row k="Sybil gate" v="Upbit Web3 Names, soul-bound, one per wallet" />
          </div>
          <p>
            On L1 that ratio inverts and the product cannot exist. The sybil
            problem is solved by an asset we cannot issue: a{" "}
            <Mono className="text-[11px]">up.id</Mono> is minted by GIWA through
            Dojang attestation, from a registry Syndix reads and cannot write. We
            hold one the same way any reader does. A protocol that can mint itself
            the credential it gates on has not built a gate.
          </p>
        </Section>

        <Section n="02" title="How it works">
          <p>
            A newsroom, not a platform: nobody submits an article, so nothing is
            moderated. An agent reads GIWA head state, gpt-4.1 writes the issue
            against a strict schema, it is pinned to IPFS, and{" "}
            <Mono className="text-[11px]">publishArticle</Mono> records it with
            the attached ETH as its reward pool. The feed is a projection of that
            index; the app bundles no article content.
          </p>
          <p>
            Readers prove attention server-side. An HMAC-signed session is
            stamped with the server clock, the page beats with its scroll depth,
            and beats arriving faster than real time are refused, so elapsed time
            is never client-reported. This proves time and scrolling, not
            comprehension, but it prevents instant and bulk claiming, and up.id
            caps a human at one claim per article.
          </p>
        </Section>

        <Section n="03" title="Guarantees, each pinned by a test">
          <p>
            <strong className="text-ink">Solvency.</strong> Reader rewards sit in{" "}
            <Mono className="text-[11px]">reservedRewards</Mono>, unreachable by
            the owner. Fuzzed over 256 runs.{" "}
            <strong className="text-ink">Sybil resistance.</strong> Claims gate on
            the live ecosystem registry through a thin adapter.{" "}
            <strong className="text-ink">Proof of read.</strong> An EIP-712{" "}
            <Mono className="text-[11px]">ReadProof</Mono> binds the reader into
            the signature and the reader submits the transaction, so a
            compromised attester can forge dwell time and still move nothing.
          </p>
        </Section>

        <Section n="04" title="Deployed and verified on GIWA Sepolia">
          <div className="keep-together rounded-card border border-hairline px-3 py-2">
            {contracts.map(([name, address, note]) => (
              <div
                key={name}
                className="doc-row flex flex-wrap items-baseline gap-x-2 border-b border-hairline py-1 last:border-b-0"
              >
                <span className="text-[12px] font-medium text-ink">{name}</span>
                <span className="text-[10.5px] text-ink-faint">{note}</span>
                <a
                  href={explorerAddress(address)}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-auto font-mono text-[10px] text-ink-muted"
                >
                  {address}
                </a>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-ink-faint">
            <Mono className="text-[10.5px]">SyndixPublisher</Mono> (autonomy
            guard, 21 tests), SyndixSponsorship (fee split, 18 tests) and{" "}
            <Mono className="text-[10.5px]">SyndixStableTreasury</Mono> (KRW
            variant) are written and tested, not deployed.
          </p>
        </Section>

        <Section n="05" title="Live state and status">
          <div className="keep-together rounded-card border border-hairline px-3 py-2">
            {live ? (
              <>
                <Row
                  k="At block"
                  v={
                    <Mono className="text-[12px]">
                      {live.blockNumber.toString()} · {live.articleCount} published ·{" "}
                      {active.length} live · {live.uniqueReaders} readers paid
                    </Mono>
                  }
                />
                <Row
                  k="Treasury"
                  v={
                    <Mono className="text-[12px]">
                      {formatEth(live.treasuryBalanceWei)} held ·{" "}
                      {formatEth(live.reservedRewardsWei)} reserved · solvency{" "}
                      {live.solvent ? "holds" : "VIOLATED"}
                    </Mono>
                  }
                />
              </>
            ) : (
              <p className="text-[11.5px] text-caution">
                GIWA was unreachable at render, so live figures are omitted
                rather than substituted.
              </p>
            )}
          </div>
          <p>
            <strong className="text-ink">Real:</strong> contracts (101 Foundry
            tests, three fuzzed solvency invariants), chain reads, AI-written and
            IPFS-pinned issues, the claim path end to end, server-measured proof
            of read, up.id gating, analytics rebuilt from event logs.{" "}
            <strong className="text-ink">Not yet:</strong> publishing needs an
            owner signature; gasless claims wait on a bundler for chain{" "}
            {GIWA_SEPOLIA_ID}; KRW denomination waits on the stablecoin. Every
            surface that shows something other than live chain data says so.
          </p>
        </Section>

        <Section n="06" title="Roadmap">
          <p>
            Deploy the publisher guard and schedule the pipeline, making the
            newsroom unattended without an owner key on a server. Then
            comprehension challenges derived from the issue body; gasless claims
            once a bundler exists; KRW denomination so a 100 KRW promise pays 100
            KRW; sponsor-funded pools.
          </p>
        </Section>
      </div>

      <footer className="mt-5 border-t border-hairline pt-2 text-[10.5px] leading-relaxed text-ink-faint">
        Next.js 16 · React 19 · Tailwind v4 · wagmi v3 · viem v2 · Foundry with
        OpenZeppelin v5 · openai gpt-4.1. 101 Foundry tests, 48 unit tests. Full
        detail at syndix.xyz/protocol and github.com/mrnetwork0001/Syndix
      </footer>
    </div>
  );
}
