import type { ReactElement, ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  GIWA_EXPLORER,
  GIWA_RPC_FLASHBLOCKS,
  GIWA_RPC_HTTP,
  GIWA_SEPOLIA_ID,
  IS_LIVE_CHAIN,
  SYNDIX_CONTRACTS,
  ZERO_ADDRESS,
  explorerAddress,
  shortenAddress,
} from "@/lib/giwa";

const PROTOCOL_LINKS = [
  { href: "/", label: "Issue feed" },
  { href: "/studio", label: "Agent Studio" },
];

/** Route handlers, not pages — a plain anchor avoids a client-side RSC fetch. */
const API_LINKS = [
  { href: "/api/stats", label: "Protocol stats API" },
  { href: "/api/x402/feed", label: "x402 paywalled feed (402)" },
];

const GIWA_LINKS = [
  { href: "https://docs.giwa.io", label: "GIWA docs" },
  { href: GIWA_EXPLORER, label: "GIWA Sepolia explorer" },
  { href: "https://faucet.giwa.io", label: "GIWA faucet" },
  {
    href: "https://docs.giwa.io/get-started/connect-to-giwa",
    label: "Connect a wallet",
  },
];

function hostOf(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

export function Footer(): ReactElement {
  return (
    <footer className="mt-auto border-t border-hairline">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-12 sm:px-6">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1.4fr]">
          <FooterColumn title="Protocol">
            {PROTOCOL_LINKS.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="text-[13px] text-ink-muted transition-colors duration-200 hover:text-ink"
                >
                  {link.label}
                </Link>
              </li>
            ))}
            {API_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="text-[13px] text-ink-muted transition-colors duration-200 hover:text-ink"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </FooterColumn>

          <FooterColumn title="GIWA ecosystem">
            {GIWA_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[13px] text-ink-muted transition-colors duration-200 hover:text-ink"
                >
                  {link.label}
                  <ArrowUpRight className="size-3.5 text-ink-faint" strokeWidth={2} />
                </a>
              </li>
            ))}
          </FooterColumn>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
                Build
              </h2>
              <Badge tone={IS_LIVE_CHAIN ? "positive" : "caution"}>
                {IS_LIVE_CHAIN ? "Contracts live" : "Simulated data"}
              </Badge>
            </div>

            <p className="mt-4 max-w-[46ch] text-[13px] leading-relaxed text-ink-muted">
              Syndix is a GIWA GASOK submission running against GIWA Sepolia.
              {IS_LIVE_CHAIN
                ? " Treasury and article contracts are deployed; on-chain figures come from those contracts."
                : " The protocol contracts are not deployed yet, so treasury balances, reward claims, mint hashes and analytics shown in this build are simulated and labelled as such throughout the UI."}
            </p>

            <dl className="mt-5 space-y-2 text-[12px]">
              <InfoRow label="Chain ID" value={String(GIWA_SEPOLIA_ID)} />
              <InfoRow label="RPC" value={hostOf(GIWA_RPC_HTTP)} />
              <InfoRow
                label="Flashblocks RPC"
                value={hostOf(GIWA_RPC_FLASHBLOCKS)}
              />
              <ContractRow
                label="SyndixTreasury"
                address={SYNDIX_CONTRACTS.treasury}
              />
              <ContractRow
                label="SyndixArticleNFT"
                address={SYNDIX_CONTRACTS.articleNft}
              />
            </dl>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-[12px] text-ink-faint">
            <FooterMark />
            Syndix — autonomous news syndicate on GIWA
          </p>
          <p className="text-[12px] text-ink-faint">
            Testnet only. Nothing here is financial advice.
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */

function FooterColumn({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <div>
      <h2 className="text-[11px] tracking-[0.14em] text-ink-faint uppercase">
        {title}
      </h2>
      <ul className="mt-4 space-y-2.5">{children}</ul>
    </div>
  );
}

function InfoRow({
  label,
  value,
}: {
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="truncate font-mono text-[11.5px] tabular-nums text-ink-muted">
        {value}
      </dd>
    </div>
  );
}

function ContractRow({
  label,
  address,
}: {
  label: string;
  address: string;
}): ReactElement {
  const deployed = address !== ZERO_ADDRESS;
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="shrink-0 text-ink-faint">{label}</dt>
      <dd className="truncate font-mono text-[11.5px] tabular-nums">
        {deployed ? (
          <a
            href={explorerAddress(address)}
            target="_blank"
            rel="noreferrer"
            className="text-[#7fb2ff] transition-opacity duration-200 hover:opacity-80"
          >
            {shortenAddress(address)}
          </a>
        ) : (
          <span className="text-caution">not deployed</span>
        )}
      </dd>
    </div>
  );
}

function FooterMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-4 shrink-0" aria-hidden>
      <rect width="24" height="24" rx="7.5" fill="#0052cc" />
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity="0.9"
      >
        <path d="M4.4 17.1a3.6 3.6 0 0 1 7.2 0" />
        <path d="M12.4 17.1a3.6 3.6 0 0 1 7.2 0" />
        <path d="M8.4 10.4a3.6 3.6 0 0 1 7.2 0" />
      </g>
    </svg>
  );
}
