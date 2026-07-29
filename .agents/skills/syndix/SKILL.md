---
name: Syndix GIWA Blueprint
description: Architecture, verified GIWA Sepolia network facts, design tokens, and smart-contract invariants for Syndix. Use when working anywhere in this repo, and especially before writing GIWA chain config, identity/up.id code, reward-claim logic, or new UI surfaces.
---

# Syndix

Autonomous AI news syndicate and reader micro-reward protocol on GIWA (OP Stack L2 by
Dunamu/Upbit). GIWA GASOK accelerator submission — Track 04 (AI/Web3) + Track 02
(Consumer/Social).

The product loop: an agent reads GIWA chain state and ecosystem signals, writes a
newsletter issue, mints it on-chain, and pays verified readers a micro-reward for reading
it. Machine buyers can pay per request for the raw feed over HTTP 402.

## Correct the record before you write chain code

These four errors appear in almost every secondhand description of GIWA, including the
project's own original blueprint. The corrected values are in `lib/giwa.ts`.

1. Chain ID is **91342**, not 919.
2. Identity is **`username.up.id`** (Upbit Web3 Names — ENS subdomains issued as Soul-Bound
   Tokens, one per verified wallet). There is **no `*.giwa.id` namespace**.
3. There is **no first-party "GIWA Paymaster"**. ERC-4337 EntryPoint v0.6 and v0.7 are
   predeployed at genesis; gasless UX means running your own paymaster against them.
4. **Mainnet is not live.** GIWA Sepolia only.

Also frequently missed and worth building on: **Flashblocks** give up to 200ms
preconfirmations on a dedicated RPC (`https://sepolia-rpc-flashblocks.giwa.io`), readable
under the `pending` block tag. That is what makes a "claim your reward" button feel instant
rather than pending, and it is the single most demo-able property of the chain.

Full network table, predeploy addresses and L1 bridge contracts: `CLAUDE.md` and
`lib/giwa.ts`.

## Where things live

| Need | File |
| --- | --- |
| Chain config, predeploys, `up.id` helpers, explorer links | `lib/giwa.ts` |
| Every shared type (import, never redefine) | `lib/types.ts` |
| `cn()`, wei→ETH/USD/KRW formatting, `relativeTime`, `seededRandom` | `lib/utils.ts` |
| Design tokens and utility classes | `app/globals.css` |
| Contract ABIs (generated — run `npm run abi`) | `lib/abi.ts` |
| x402 challenge + payment verification | `lib/x402.ts` |
| Editorial dataset | `lib/data/issues.ts`, `lib/data/protocol.ts` |
| Protocol contracts | `contracts/` |
| Contract tests (33, all passing) | `test/contracts/` |

## Commands

`npm run dev` · `npm run check` (typecheck + lint + build + forge test) ·
`npm run contracts:test` · `npm run contracts:deploy` · `npm run abi`

## Design tokens

Tailwind v4 `@theme` in `app/globals.css`. Never hard-code a hex in a component.

Background `#0b0b0c` (`bg-void`) · card `#141416` (`bg-surface`) · elevated `#1a1a1e` ·
accent `#0066ff` (`bg-accent`) · borders `border-hairline` (white 8%).
Use the `panel` utility class for every card; `glass` for sticky/overlay chrome;
`accent-glow` for the primary CTA; `text-gradient` for hero headings; `markdown` for
rendered issue bodies.

Style is Raycast/Linear: dense, hairline dividers, uppercase micro-labels, mono tabular
numbers, subtle hover lifts, no emoji.

## Contract invariants

`SyndixTreasury` guarantees three properties, each with a regression test:

- **Solvency** — reader-owed ETH sits in `reservedRewards` and the owner cannot touch it;
  `withdrawTreasury` spends only `unreservedBalance()`. Fuzzed over 256 runs.
- **Sybil resistance** — claims require a verified identity through `IReaderRegistry`
  (the `up.id` SBT resolver in production, `MockUpIdRegistry` on testnet).
- **Proof of read** — claims carry an EIP-712 `ReadProof` signed by the attester, and the
  reader submits their own transaction, so the attester never holds funds.

Two of these are regressions against the original blueprint contract, which would fail
them. If you change the treasury, run `npm run contracts:test` before anything else.

ETH transfers use `.call{value:}`, never `.transfer` — recipients may be Safes or 4337
smart accounts.

## Honesty rule

Contracts are not deployed and there is usually no LLM key. Every surface that shows
simulated data must label it: the studio badges live-vs-simulated, the claim modal is
marked simulated, `/api/stats` returns `source`, and x402 reports
`verification: "accepted-unverified"` when it cannot check settlement. Do not render a
fabricated tx hash as a confirmed fact.
