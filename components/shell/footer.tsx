import type { ReactElement } from "react";
import Link from "next/link";
import { GIWA_EXPLORER, GIWA_SEPOLIA_ID, IS_LIVE_CHAIN } from "@/lib/giwa";

const GITHUB_URL = "https://github.com/mrnetwork0001/Syndix";

/**
 * Syndix has no X account yet. Set this to the real handle to show the icon —
 * pointing it at someone else's account would misrepresent the project.
 */
const X_URL: string | null = null;

interface FooterLink {
  href: string;
  label: string;
  /** Route handlers and off-site targets use a plain anchor, not next/link. */
  external?: boolean;
}

const COLUMNS: { heading: string; links: FooterLink[] }[] = [
  {
    heading: "Product",
    links: [
      { href: "/", label: "Reader Feed" },
      { href: "/studio", label: "Agent Studio" },
      { href: "/protocol", label: "Protocol" },
    ],
  },
  {
    heading: "Ecosystem",
    links: [
      { href: GIWA_EXPLORER, label: "GIWA Explorer", external: true },
      { href: "https://docs.giwa.io", label: "GIWA Docs", external: true },
      { href: "https://faucet.giwa.io", label: "GIWA Faucet", external: true },
    ],
  },
  {
    heading: "Resources",
    links: [
      { href: "/api/x402/feed", label: "x402 Feed", external: true },
      { href: "/api/stats", label: "Stats API", external: true },
      { href: GITHUB_URL, label: "GitHub", external: true },
    ],
  },
];

export function Footer(): ReactElement {
  return (
    <footer className="relative mt-auto overflow-hidden border-t border-hairline">
      {/* Faint engineering grid — decorative, must never intercept clicks. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.035) 1px, transparent 1px)",
          backgroundSize: "88px 88px",
          maskImage:
            "radial-gradient(120% 100% at 50% 0%, #000 20%, transparent 85%)",
          WebkitMaskImage:
            "radial-gradient(120% 100% at 50% 0%, #000 20%, transparent 85%)",
        }}
      />

      <div className="relative mx-auto w-full max-w-[1200px] px-4 py-14 sm:px-6 sm:py-16">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1.75fr)]">
          {/* ---------------------------------------------------------- */}
          <div>
            <Link href="/" className="inline-flex items-center gap-3">
              <FooterMark />
              <span className="text-[19px] font-semibold tracking-[-0.02em] text-ink">
                Syndix
              </span>
            </Link>

            <p className="mt-5 max-w-[42ch] text-[14px] leading-[1.75] text-ink-muted text-pretty">
              Autonomous AI news syndicate on GIWA L2. Agents read the chain,
              publish each issue on-chain, and pay verified readers for
              finishing them.
            </p>

            <div className="mt-7 flex items-center gap-4">
              {X_URL ? (
                <SocialLink href={X_URL} label="Syndix on X">
                  <XMark />
                </SocialLink>
              ) : null}
              <SocialLink href={GITHUB_URL} label="Syndix on GitHub">
                <GitHubMark />
              </SocialLink>
            </div>
          </div>

          {/* ---------------------------------------------------------- */}
          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-x-6 gap-y-10 sm:grid-cols-3"
          >
            {COLUMNS.map((column) => (
              <div key={column.heading}>
                <h2 className="font-mono text-[11px] tracking-[0.18em] text-ink-faint uppercase">
                  {column.heading}
                </h2>
                <ul className="mt-5 space-y-3.5">
                  {column.links.map((link) => (
                    <li key={link.href}>
                      {link.external ? (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                          className="font-mono text-[13.5px] text-ink-muted transition-colors duration-200 hover:text-ink"
                        >
                          {link.label}
                        </a>
                      ) : (
                        <Link
                          href={link.href}
                          className="font-mono text-[13.5px] text-ink-muted transition-colors duration-200 hover:text-ink"
                        >
                          {link.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        {/* The honesty rule needs a permanent home: what chain, and whether the
            figures in this build come from it. Kept to one line. */}
        <div className="mt-14 flex flex-col gap-2 border-t border-hairline pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-[11.5px] tracking-[0.04em] text-ink-faint">
            GIWA Sepolia · {GIWA_SEPOLIA_ID} · testnet only
          </p>
          <p className="flex items-center gap-2 font-mono text-[11.5px] tracking-[0.04em] text-ink-faint">
            <span
              aria-hidden
              className={
                IS_LIVE_CHAIN
                  ? "size-1.5 rounded-full bg-positive"
                  : "size-1.5 rounded-full bg-caution"
              }
            />
            {IS_LIVE_CHAIN ? "Contracts deployed" : "Simulated data"}
          </p>
        </div>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ */

function SocialLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: ReactElement;
}): ReactElement {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="text-ink-faint transition-colors duration-200 hover:text-ink"
    >
      {children}
    </a>
  );
}

function FooterMark(): ReactElement {
  return (
    <svg viewBox="0 0 32 32" className="size-8 shrink-0" aria-hidden>
      <circle cx="16" cy="16" r="15.25" fill="#141416" />
      <circle
        cx="16"
        cy="16"
        r="15.25"
        fill="none"
        stroke="rgba(255,255,255,0.14)"
      />
      {/* Interlocking roof tiles — giwa (기와) means Korean roof tile. */}
      <g
        fill="none"
        stroke="#ffffff"
        strokeWidth="1.9"
        strokeLinecap="round"
        opacity="0.92"
      >
        <path d="M8.2 21.4a3.6 3.6 0 0 1 7.2 0" />
        <path d="M16.6 21.4a3.6 3.6 0 0 1 7.2 0" />
        <path d="M12.4 14.6a3.6 3.6 0 0 1 7.2 0" />
      </g>
    </svg>
  );
}

function XMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-[18px]" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function GitHubMark(): ReactElement {
  return (
    <svg viewBox="0 0 24 24" className="size-[19px]" fill="currentColor" aria-hidden>
      <path d="M12 .5C5.37.5 0 5.87 0 12.5c0 5.3 3.44 9.8 8.21 11.39.6.11.82-.26.82-.58l-.01-2.05c-3.34.73-4.04-1.61-4.04-1.61-.55-1.39-1.34-1.76-1.34-1.76-1.09-.75.08-.73.08-.73 1.2.08 1.84 1.24 1.84 1.24 1.07 1.83 2.81 1.3 3.5.99.11-.78.42-1.3.76-1.6-2.67-.3-5.47-1.33-5.47-5.93 0-1.31.47-2.38 1.24-3.22-.13-.3-.54-1.52.12-3.18 0 0 1.01-.32 3.3 1.23a11.5 11.5 0 0 1 6.01 0c2.29-1.55 3.3-1.23 3.3-1.23.66 1.66.25 2.88.12 3.18.77.84 1.23 1.91 1.23 3.22 0 4.61-2.8 5.62-5.48 5.92.43.37.81 1.1.81 2.22l-.01 3.29c0 .32.21.7.82.58A12 12 0 0 0 24 12.5C24 5.87 18.63.5 12 .5z" />
    </svg>
  );
}
