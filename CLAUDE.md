@AGENTS.md

# Syndix — Development Guidelines

Autonomous AI news syndicate and reader micro-reward protocol on **GIWA**, the OP Stack
Ethereum L2 built by Dunamu (Upbit's parent). Built for the GIWA GASOK accelerator,
targeting Track 04 (AI/Web3) and Track 02 (Consumer/Social).

## Verified GIWA facts — do not contradict these

Several of these correct widely-circulated errors. Check here before writing chain code.

| Thing | Correct value |
| --- | --- |
| Testnet | GIWA Sepolia, **chain ID 91342** (not 919), settles to Ethereum Sepolia |
| RPC | `https://sepolia-rpc.giwa.io` |
| Flashblocks RPC | `https://sepolia-rpc-flashblocks.giwa.io` — preconfirmations up to 200ms, read under the `pending` block tag |
| Explorer | `https://sepolia-explorer.giwa.io` |
| Block time | ~1 second |
| Mainnet | **Still under development.** Do not write mainnet config. |
| Identity | **Upbit Web3 Names: `username.up.id`** — ENS subdomains of the `up.id` parent, issued as Soul-Bound Tokens, **one per verified wallet**. There is no `*.giwa.id` namespace. |
| Attestations | **Dojang**, built on EAS (predeployed `0x4200000000000000000000000000000000000021`). Issues Verified Address / Balance Root / Verified Balance / Verified Code. Upbit Korea is the primary issuer. |
| Gasless | **No first-party "GIWA Paymaster" product exists.** ERC-4337 EntryPoint v0.6 (`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789`) and v0.7 (`0x0000000071727De22E5E9d8BAf0edAc6f37da032`) are predeployed at genesis; you bring your own paymaster. |
| Other predeploys | Multicall3 `0xcA11...CA11`, Permit2 `0x0000...78A3`, Safe, WETH9 `0x42..06`, L2StandardBridge `0x42..10`, GasPriceOracle `0x42..0F` |
| L1 Sepolia | OptimismPortal `0x956962C34687A954e611A83619ABaA37Ce6bC78A`, L1StandardBridge `0x77b2ffc0F57598cAe1DB76cb398059cF5d10A7E7` |

All of the above live in `lib/giwa.ts` — import from there rather than re-typing addresses.

## Commands

```bash
npm run dev               # Next dev server
npm run build             # production build
npm run typecheck         # tsc --noEmit
npm run lint              # eslint (build fails on unused vars/imports)
npm run contracts:test    # forge test  (34 tests)
npm run contracts:deploy  # forge script Deploy --rpc-url giwa_sepolia --broadcast
npm run abi               # regenerate lib/abi.ts from forge artifacts
npm run check             # typecheck + lint + build + contracts:test
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · wagmi v3 · viem v2 ·
motion v12 (`import { motion } from "motion/react"`) · lucide-react · recharts ·
react-markdown + remark-gfm · Foundry (Solidity 0.8.24, OpenZeppelin v5) ·
`@anthropic-ai/sdk` with **`claude-opus-5`**.

Next 16 specifics that bite: dynamic route `params` and `searchParams` are **Promises**
(`await params`); `themeColor` belongs in `export const viewport`, not `metadata`.

## Layout

```
app/
  page.tsx                    reader feed
  issue/[id]/page.tsx         issue reader + claim flow
  studio/page.tsx             AI agent studio
  api/agent/run/route.ts      NDJSON pipeline stream (live claude-opus-5, or simulated)
  api/x402/feed/route.ts      HTTP 402 machine-payable alpha feed
  api/attest/route.ts         EIP-712 ReadProof signer (the claim gate)
  api/stats/route.ts          protocol stats
  protocol/page.tsx           the argument, with numbers read live from chain
  globals.css                 THE design system — all tokens and utilities
components/{ui,shell,feed,reader,studio,analytics}/
lib/
  giwa.ts     chain config, predeploys, up.id helpers, explorer links
  types.ts    every shared type — import, never redefine
  utils.ts    cn(), wei formatting (ETH/USD/KRW), relativeTime, seededRandom
  wagmi.ts    wagmi config + flashblocks transport
  abi.ts      GENERATED — edit contracts and run `npm run abi`
  x402.ts     402 challenge construction + on-chain payment verification
  attest.ts   EIP-712 domain/types — must match SyndixTreasury byte for byte
  onchain.ts  dataset issue id <-> on-chain article id mapping
  chain-stats.ts  live treasury reads; returns a live|offline union
  data/       the editorial dataset (issues, protocol stats, agent run script)
contracts/    SyndixTreasury.sol, SyndixArticleNFT.sol, mocks/, interfaces/
test/contracts/  Foundry tests
script/Deploy.s.sol
```

Foundry's `forge-std` lives in `contracts/lib/`, not the repo-root `lib/` — that one is the
app's TypeScript module directory. `foundry.toml` and `remappings.txt` are configured for it.

## Design system

Defined entirely in `app/globals.css` via Tailwind v4 `@theme`. Never hard-code a hex value
in a component.

- Surfaces `bg-void` `#0b0b0c` · `bg-surface` `#141416` · `bg-elevated` `#1a1a1e`
- Accent `text-accent`/`bg-accent` `#0066ff`, plus `accent-hover`, `accent-soft`, `accent-dim`
- Text `text-ink` / `text-ink-muted` / `text-ink-faint`
- Hairlines `border-hairline` (white 8%) / `border-hairline-strong` (white 14%)
- Radii `rounded-card` (14px) / `rounded-panel` (18px)
- Utility classes: **`panel`** (the standard card — use it for all cards), `glass`,
  `accent-glow`, `text-gradient`, `grain`, `markdown`
- Animations: `animate-live-dot`, `animate-sweep`, `animate-rise`, `animate-slow-spin`

Aesthetic: Raycast/Linear. Dense and information-rich, uppercase micro-labels
(`text-[11px] uppercase tracking-[0.14em] text-ink-faint`), hairline dividers over heavy
borders, numbers in `font-mono tabular-nums`, subtle hover lifts, 150–250ms transitions.
No emoji in the UI — use lucide icons.

## Contract invariants — do not regress these

`SyndixTreasury` exists to guarantee three things, each pinned by a test in
`test/contracts/SyndixTreasury.t.sol`:

1. **Solvency.** Every wei promised to a reader is tracked in `reservedRewards` and is
   unreachable by the owner; `withdrawTreasury` spends only `unreservedBalance()`.
   `address(this).balance >= reservedRewards` always holds (fuzzed, 256 runs).
2. **Sybil resistance.** Claims require a verified identity via `IReaderRegistry` — in
   production the `up.id` SBT resolver, one name per wallet. Without this the reward pool
   is a faucet that a script drains in one block.
3. **Proof of read.** A claim carries an EIP-712 `ReadProof` signed by `readAttester`,
   certifying dwell time. The reader still submits the transaction, so the attester never
   custodies funds and cannot claim on a reader's behalf.

Use `.call{value:}` for ETH transfers, never `.transfer` — recipients may be Safes or 4337
smart accounts.

## Deployed on GIWA Sepolia

```
SyndixTreasury    0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee
SyndixArticleNFT  0xA0D49A6C4Ac081a2de9af2f422EdfffB8f41190e
MockUpIdRegistry  0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d
```

Six issues are published with funded pools and real reader claims settle. Addresses come
from `.env.local` (`NEXT_PUBLIC_SYNDIX_*`); with them unset the app falls back to the
dataset and says so.

**On-chain article ids are not dataset issue ids.** `publishArticle` assigns ids from
publish order, and a nonce race during the first deploy left issues 2 and 3 swapped.
`lib/onchain.ts` holds the mapping and returns `undefined` for unpublished issues — never
default to the issue id, that signs an attestation for the wrong article.

## Honesty rule

**Anywhere the UI shows data that is not what it claims to be, it must say so.** This is a
grant submission; a smaller honest demo beats an overclaiming one.

Currently real: contracts, reader claims, chain reads, x402 settlement verification.
Currently not: the 14-day analytics series (authored — no indexer exists), ERC-4337
gasless (readers pay their own gas), IPFS pinning (CIDs do not resolve).

Concrete rules:
- Never render a fabricated tx hash as a confirmed on-chain fact. The dataset's
  `mintTxHash` values are now genuine publish transactions; if you regenerate the dataset,
  either use real hashes or badge them.
- Chain reads use a discriminated union (`lib/chain-stats.ts`). When GIWA is unreachable,
  state the reason — do **not** silently substitute the dataset behind a "Live" badge.
- The studio badges its run mode; `/api/stats` reports `source`; x402 labels unverified
  settlement `accepted-unverified`.
- `/protocol` carries the honesty table and must be updated when any of this changes.
