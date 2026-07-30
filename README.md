# Syndix

**An autonomous AI news syndicate that pays its readers, on GIWA L2.**

Syndix runs an AI journalist over GIWA chain state and ecosystem signals, publishes the
result as an on-chain newsletter issue, and settles a micro-reward to every verified reader
who actually reads it. Machine buyers can pay per request for the raw feed over HTTP 402.

Built for the **GIWA GASOK** accelerator — Track 04 (AI / Web3) and Track 02 (Consumer /
Social). GIWA is the OP Stack Ethereum L2 built by Dunamu, Upbit's parent company.

---

## Why GIWA specifically

This is not a generic dApp with a chain swapped in. Four GIWA properties are load-bearing:

| GIWA property | What Syndix does with it |
| --- | --- |
| **Flashblocks — up to 200ms preconfirmations** | A reward claim confirms while the reader is still looking at the button. `lib/wagmi.ts` keeps a separate transport pointed at the Flashblocks RPC and reads receipts under the `pending` tag, so the claim UX is instant rather than pending. |
| **~1s blocks, sub-cent fees** | A $0.10 reward is economically viable. On L1 the gas would cost 40× the reward; here the reward dominates the cost, which is the whole premise. |
| **`username.up.id` — Soul-Bound, one per wallet** | This is the sybil gate. A reward pool keyed on raw addresses is a faucet; a script drains it in one block. One-human-one-name is what makes reader rewards a business rather than an exploit. |
| **ERC-4337 EntryPoint predeployed at genesis** | The path to removing gas from the reader's experience entirely, by routing claims as UserOperations through the v0.7 EntryPoint with a Syndix paymaster. *Not built yet* — today readers submit their own transaction and pay ~0.00000018 ETH for it. |

Correcting four things that circulate widely about GIWA (and that the project's own first
draft had wrong): the chain ID is **91342**, identity is **`up.id`** and not `giwa.id`,
there is **no first-party "GIWA Paymaster" product** (you run your own against the
predeployed EntryPoint), and **mainnet is not live yet**. See `CLAUDE.md` for the full
verified table.

---

## Live on GIWA Sepolia

Deployed and verified working — a reader claim has settled end to end on chain.

| Contract | Address |
| --- | --- |
| `SyndixTreasury` | [`0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee`](https://sepolia-explorer.giwa.io/address/0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee) |
| `SyndixArticleNFT` | [`0xA0D49A6C4Ac081a2de9af2f422EdfffB8f41190e`](https://sepolia-explorer.giwa.io/address/0xA0D49A6C4Ac081a2de9af2f422EdfffB8f41190e) |
| `MockUpIdRegistry` | [`0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d`](https://sepolia-explorer.giwa.io/address/0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d) |
| `SyndixPaymaster` | [`0x3B13186a1E4b1108eA5CB2f8853D84A2aeD71Cc5`](https://sepolia-explorer.giwa.io/address/0x3B13186a1E4b1108eA5CB2f8853D84A2aeD71Cc5) |

All four are verified on the GIWA explorer.

Issues are published on chain with funded reward pools, and the feed is a
projection of that index — the app bundles no article content at all. The first
real claim — attestation signed by `/api/attest`, transaction submitted by the
reader — is
[`0x49eb506b…78502a`](https://sepolia-explorer.giwa.io/tx/0x49eb506b106fb83433a68324551139d68227767016671ae7fce89b704978502a).

### The publishing loop, end to end

Every live issue went through this path, with no hand-authored step:

1. **Scan** — read GIWA head state and gas price from the Flashblocks RPC
2. **Generate** — `gpt-4.1` writes the issue against a strict JSON schema, seeded
   with real measured on-chain signals
3. **Pin** — the body and metadata go to IPFS via Pinata, yielding a real CID.
   Publishing is *blocked* if pinning fails: an on-chain pointer to nothing is
   worse than no pointer
4. **Publish** — `publishArticle` writes the title and `contentURI` and funds the
   reward pool
5. **Read** — the feed reads `articleCount` / `listArticles` from the treasury and
   fetches each body from IPFS

### SyndixPaymaster

An ERC-4337 v0.7 paymaster that sponsors reader claims, so a first-time reader
needs no ETH at all. Deployed, staked (0.0005 ETH) and funded (0.001 ETH)
against the EntryPoint predeploy, with 11 tests.

Scope is deliberately narrow — it sponsors **one target and one selector**,
`SyndixTreasury.claimReaderReward`. An open paymaster is a faucet for anyone who
can craft a UserOperation, and the deposit would be drained by unrelated calls.
There is also a per-sender cap.

**It is not in the claim path, and cannot be yet.** Relaying a UserOperation also
requires a smart-account factory on GIWA — the usual SimpleAccount factory
addresses hold no code — and a bundler serving chain 91342. Neither exists today.
Readers submit their own claim and pay ~0.00000018 ETH; the paymaster is standing
infrastructure for when GIWA's Stable PayMaster lands.

### SyndixStableTreasury — the KRW migration path

Not deployed, because GIWA's KRW stablecoin does not exist yet. Written and
tested against a mock so the path is concrete rather than asserted.

The reason it matters: Syndix promises a **100 KRW** micro-reward but pays
0.00003 ETH, which was worth about ₩132 when the figure was chosen and about ₩83
a few weeks later. Denominated in a KRW stablecoin, ₩100 is ₩100.

All three invariants survive the change — the solvency test is the same fuzz,
with `token.balanceOf(this) >= reservedRewards` replacing the ETH balance check.
The `ReadProof` typehash is byte-identical, so one attester serves both
treasuries with no per-treasury branch. Mechanically `publishArticle` stops being
`payable` and pulls with `safeTransferFrom`, payouts use `safeTransfer`, and
there is no `receive()` — ETH sent to a token treasury would be stuck, so it
cannot arrive.

**The economics, measured rather than asserted:** deploying all three contracts
cost **0.0000066 ETH**. A claim costs 180,313 gas — about **0.00000018 ETH** at
GIWA's ~0.001 gwei. The reward itself is 0.00003 ETH. So the reward is roughly
**166× the gas needed to deliver it**. On Ethereum L1 that ratio inverts and the
product cannot exist; that inversion is the entire reason Syndix is built here.

## Architecture

```
On-chain + ecosystem signals
          │
          ▼
   Ingestion agent  ──────────►  gpt-4.1 synthesis + scoring
   (reads GIWA head state,        (app/api/agent/run/route.ts,
    GitHub, governance)            streams NDJSON to the studio)
          │
          ▼
   Agent Studio (/studio)  ──────►  mint + fund reward pool
          │                          (SyndixTreasury.publishArticle)
          ▼
   Reader feed (/) ──► Issue reader (/issue/[id])
          │                 │
          │                 └──► proof-of-read attestation (EIP-712)
          │                        └──► claimReaderReward → 200ms preconf
          ▼
   x402 feed (/api/x402/feed) ──► machine buyers pay per request
```

---

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

Nothing is required to run the demo. With no configuration the app serves the local
editorial dataset and a recorded agent pipeline — and **says so in the UI**, everywhere.

To go further, copy `.env.example` to `.env.local`:

```bash
OPENAI_API_KEY=...              # Agent Studio writes real issues
PINATA_JWT=...                  # pins them to IPFS, so contentURI resolves
NEXT_PUBLIC_SYNDIX_TREASURY=... # after deploying, the app reads live chain state
```

Without the first two the studio replays a recorded pipeline and badges itself
"Simulated"; without the third the app has no issue index to read.

### Contracts

```bash
npm run contracts:test     # 57 tests
npm run contracts:deploy   # to GIWA Sepolia
npm run abi                # regenerate lib/abi.ts from the artifacts
```

Deployment needs `PRIVATE_KEY` in the environment and testnet ETH from
[faucet.giwa.io](https://faucet.giwa.io). The script prints the two `NEXT_PUBLIC_*` values
to paste into `.env.local`.

---

## The contracts

`contracts/SyndixTreasury.sol` holds sponsor deposits, funds per-issue reward pools, and
settles reader claims. It is built around three guarantees, each pinned by a regression
test in `test/contracts/SyndixTreasury.t.sol`:

**1. Solvency.** Every wei promised to a reader is accounted in `reservedRewards` and is
unreachable by the owner. `withdrawTreasury` can move only `unreservedBalance()`.

```solidity
function unreservedBalance() public view returns (uint256) {
    uint256 balance = address(this).balance;
    uint256 reserved = reservedRewards;
    return balance > reserved ? balance - reserved : 0;
}
```

The invariant `address(this).balance >= reservedRewards` is fuzzed over 256 runs. A
treasury that withdraws against the raw balance — as the first draft of this contract did
— silently bricks every outstanding reader claim the moment the owner takes a fee.

**2. Sybil resistance.** `claimReaderReward` requires a verified identity through
`IReaderRegistry`, satisfied in production by the `up.id` SBT resolver and on testnet by
`MockUpIdRegistry`. The interface is deliberately thin so the deployment can point at the
live resolver, a Dojang EAS attestation reader, or a mock, without touching the treasury.

**3. Proof of read.** A claim carries an EIP-712 `ReadProof` signed by the Syndix
read-attester, certifying dwell time. The reader still submits the transaction — or a 4337
bundler does on their behalf — so the attester never custodies funds and cannot claim on a
reader's behalf.

`contracts/SyndixArticleNFT.sol` is a two-level open edition: the publisher registers an
edition once (the metadata-heavy write), and each reader's collect is a cheap sequential
mint pointing at it. That split is what makes "collect the issue" a consumer action rather
than a gas decision.

```
forge test
  57 tests passed, 0 failed
npm test
  25 tests passed, 0 failed
```

---

## What is real and what is simulated

Stated plainly, because a grant reviewer should not have to guess:

| Component | Status |
| --- | --- |
| Smart contracts | **Real.** Compile under Solidity 0.8.24, 57 passing Foundry tests including a fuzzed solvency invariant. Deployable to GIWA Sepolia with one command. |
| GIWA chain reads | **Real.** The ingestion agent queries live head state and gas price from the Flashblocks RPC on every run; those block numbers are verifiable on the explorer. |
| AI issue generation | **Real when `OPENAI_API_KEY` is set** — streamed, Structured Outputs with `strict: true`. Otherwise a recorded pipeline replays and the studio badges itself "Simulated". |
| x402 endpoint | **Real protocol, real verification when deployed.** With a treasury address set it verifies settlement on-chain; without one it accepts a well-formed hash and returns `verification: "accepted-unverified"`. |
| Editorial dataset | **Authored, not live.** Six issues written against verified GIWA facts, each published on chain with a real transaction. |
| Reward claim flow | **Real.** Attestation signed by `/api/attest`, transaction submitted by the reader, settled on GIWA Sepolia. Falls back to a clearly-labelled simulation when no treasury is configured. |
| up.id identity | **Real on testnet.** Any wallet can self-claim a name via `MockUpIdRegistry.claimName`, enforcing one-per-wallet. Production swaps in the real up.id resolver, where names are issued to Dojang Verified Addresses. |
| Analytics time series | **Authored.** No indexer exists to reconstruct daily history from chain events, so the 14-day chart is a projection and is labelled as one. The treasury split beside it is read from the contract. |
| ERC-4337 gasless | **Not built.** Readers pay their own gas (~0.00000018 ETH). The claim modal describes it as it actually behaves. |
| IPFS pinning | **Not built.** `contentURI` values are authored CIDs and do not resolve. |

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · wagmi v3 ·
viem v2 · motion · recharts · Foundry + OpenZeppelin v5 · `openai`
(`gpt-4.1`, configurable via `OPENAI_MODEL`).

Design system lives entirely in `app/globals.css` as Tailwind v4 `@theme` tokens —
Raycast/Linear-grade dark glassmorphism, no hard-coded hex values in components.

---

## Links

- GIWA docs — <https://docs.giwa.io>
- GIWA Sepolia explorer — <https://sepolia-explorer.giwa.io>
- Faucet — <https://faucet.giwa.io>
