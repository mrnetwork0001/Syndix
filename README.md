# Syndix

**An autonomous AI news syndicate that pays its readers, on GIWA L2.**

Syndix runs an AI journalist over GIWA chain state, publishes the result as an onchain
newsletter issue with a funded reward pool, and settles a micro-reward to every verified
reader who actually reads it. Machine buyers can pay per request for the raw feed over
HTTP 402.

Built for the **GIWA GASOK** accelerator, **Track 03 (GIWA-Native Ideas)**. GIWA is the
OP Stack Ethereum L2 built by Dunamu, Upbit's parent company.

---

## Why GIWA specifically

This is not a generic dApp with a chain swapped in. Four GIWA properties are load-bearing:

| GIWA property | What Syndix does with it |
| --- | --- |
| **Flashblocks, up to 200ms preconfirmations** | A reward claim confirms while the reader is still looking at the button. `lib/wagmi.ts` keeps a separate transport pointed at the Flashblocks RPC and reads receipts under the `pending` tag. |
| **~1s blocks, sub-cent fees** | A six-cent reward is economically viable. A claim costs 180,313 gas, about 0.00000018 ETH, against a 0.00003 ETH reward. **The reward is roughly 166x the gas needed to deliver it.** On L1 that ratio inverts and the product cannot exist. |
| **`username.up.id`, soul-bound, one per wallet** | This is the sybil gate. A reward pool keyed on raw addresses is a faucet that a script drains in one block. One human, one name is what makes reader rewards a business rather than an exploit. |
| **ERC-4337 EntryPoint predeployed at genesis** | The path to removing gas from the reader's experience. `SyndixPaymaster` is deployed and funded; see [SyndixPaymaster](#syndixpaymaster) for why it is not yet reachable. |

Correcting four things that circulate widely about GIWA, and that this project's own first
draft had wrong: the chain ID is **91342**, identity is **`up.id`** and not `giwa.id`,
there is **no first-party "GIWA Paymaster" product** (you run your own against the
predeployed EntryPoint), and **mainnet is not live yet**. `docs/ENGINEERING.md` holds the full
verified table.

---

## How it works

Syndix is a newsroom, not a publishing platform. Nobody submits an article, so nothing is
moderated. There are three roles:

| Role | Does | Permission |
| --- | --- | --- |
| **AI agent** | writes issues from live chain state | automated, server-side |
| **Syndicate** (treasury owner) | publishes and funds reward pools | `onlyOwner`, enforced onchain |
| **Readers** | read an issue, claim a reward | permissionless |
| **Machine buyers** | pay per API call | permissionless, HTTP 402 |

### For a reader

1. **Get a `up.id`.** One soul-bound name per wallet, issued by GIWA at
   [sepolia-playground.giwa.io](https://sepolia-playground.giwa.io). Syndix cannot mint
   you one; it only checks that you hold it.
2. **Read the issue.** The server measures the time and the scroll depth. See
   [Proof of read](#proof-of-read).
3. **Claim.** You submit the transaction yourself and the treasury pays you 0.00003 ETH,
   settled in about a second.

No approval step exists anywhere in that path.

### For the syndicate

Open `/studio` with the owner wallet and press two buttons: *Generate draft issue*, then
*Mint & publish*. The signature on the second is **the only manual step in the entire
system**, and it is funding a reward pool rather than approving content.

**When does it publish? Only when that button is pressed.** There is no scheduler. The
writing is autonomous; the publishing is not. [SyndixPublisher](#syndixpublisher) is the
contract that closes that gap safely, written and tested but not yet deployed.

---

## Live on GIWA Sepolia

| Contract | Address |
| --- | --- |
| `SyndixTreasury` | [`0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee`](https://sepolia-explorer.giwa.io/address/0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee) |
| `SyndixArticleNFT` | [`0xA0D49A6C4Ac081a2de9af2f422EdfffB8f41190e`](https://sepolia-explorer.giwa.io/address/0xA0D49A6C4Ac081a2de9af2f422EdfffB8f41190e) |
| `UpIdReaderRegistry` | [`0xa316Bb7762c5689ec905b2dec2899Ded93557941`](https://sepolia-explorer.giwa.io/address/0xa316Bb7762c5689ec905b2dec2899Ded93557941) |
| `SyndixPaymaster` | [`0x3B13186a1E4b1108eA5CB2f8853D84A2aeD71Cc5`](https://sepolia-explorer.giwa.io/address/0x3B13186a1E4b1108eA5CB2f8853D84A2aeD71Cc5) |
| `SyndixSponsorship` | [`0xC853Eaef43Fa30FBB990F13cb3fCaea2A00A256a`](https://sepolia-explorer.giwa.io/address/0xC853Eaef43Fa30FBB990F13cb3fCaea2A00A256a) |
| `SyndixPublisher` | [`0xb542E132e43149E99bef100654Dbe9e079470824`](https://sepolia-explorer.giwa.io/address/0xb542E132e43149E99bef100654Dbe9e079470824) |
| `MockUpIdRegistry` (superseded, test fixture) | [`0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d`](https://sepolia-explorer.giwa.io/address/0xA82EDb5e111c31C63E06EF0007f2fa1a9e7EB30d) |

All seven are verified on the GIWA explorer, each publishing full source, ABI and
decoded constructor arguments.

They show as *partial* rather than *full* match, and that is a build setting rather than
an incomplete verification: `foundry.toml` sets `bytecode_hash = "none"`, so the deployed
bytecode carries no source-metadata hash - its trailing bytes decode to `solc 0.8.24` and
nothing more. A full match is Blockscout comparing that hash, so with none embedded,
partial is the ceiling for these deployments. Re-verifying cannot change it; only
redeploying with `bytecode_hash = "ipfs"` could, at the cost of every published article
and reader claim. Nothing a reviewer reads differs between the two tiers.

`SyndixTreasury.readerRegistry` points at `UpIdReaderRegistry`, so **claims are gated on
the real, ecosystem-wide Upbit Web3 Names registry**
([`0x091D...9628`](https://sepolia-explorer.giwa.io/address/0x091D00004f21eb2Fc30964A8a4995692d9b49628)),
not on anything Syndix can mint.

**Current state:** 10 articles published all-time, 6 retired, **4 live** with 20 funded
claims each. Three wallets have claimed. The first real claim, attested by `/api/attest`
and submitted by the reader, is
[`0x49eb506b...78502a`](https://sepolia-explorer.giwa.io/tx/0x49eb506b106fb83433a68324551139d68227767016671ae7fce89b704978502a).

**The app bundles no article content.** `lib/onchain-issues.ts` reads `articleCount` and
`listArticles()` from the treasury and fetches each body from IPFS. Delete the contracts
and the feed is empty.

### The publishing loop, end to end

Every live issue went through this path with no hand-authored step:

1. **Scan.** Read GIWA head state and gas price from the Flashblocks RPC.
2. **Generate.** `deepseek-v4-pro`, running TEE-attested on the 0G Compute Router, writes the issue
   against a strict JSON schema, seeded with the
   measured onchain signals.
3. **Pin.** Body and metadata go to IPFS via Pinata, yielding a real CID. Publishing is
   *blocked* if pinning fails: an onchain pointer to nothing is worse than no pointer.
4. **Publish.** `publishArticle(title, contentURI, rewardPerReader)` is payable, and the
   ETH attached becomes the reward pool. The contract assigns the id from `++articleCount`
   and emits `ArticlePublished`.
5. **Read.** The feed projects the treasury index.

The publish transaction hash is not stored onchain, because a contract cannot record the
hash of the transaction currently executing. `lib/publish-tx.ts` recovers it from the
`ArticlePublished` log, so every issue links to the real transaction that published it and
never to a fabricated one.

---

## Proof of read

The hard problem in paying for attention is proving the attention happened.

**What this used to do, and why it was not enough:** the browser counted seconds and
posted the number to `/api/attest`, which believed it. A claim cost one HTTP request with
`dwellSeconds: 9999` and no page load at all, and a reader could scroll to the bottom and
claim immediately.

**What it does now.** `lib/read-session.ts` issues an HMAC-signed session when a reader
opens an issue, stamped with the server's clock. The page checks in every 15 seconds with
its current scroll depth; the server verifies the signature, refuses beats that arrive
faster than real time allows, accumulates the count and the deepest scroll reached, and
re-signs. At claim time elapsed time is computed as `now - issuedAt` from the server's
clock, never from anything the client asserts.

The token chain carries its own state, so this needs no database: each token is a signed
snapshot, and only the server can mint one.

| Attack | Result |
| --- | --- |
| No session | refused |
| Edited token (backdated, beats inflated, depth forced) | refused, HMAC fails |
| Spammed heartbeats | `Heartbeat too soon.` |
| Full scroll depth, no elapsed time | refused |
| Full elapsed time, no scrolling | `Scroll through the whole issue` |
| Session earned on one article, used on another | refused |

The server threshold is **300 seconds and 85% scroll depth**, set with `READ_MIN_SECONDS`
and `READ_MIN_DEPTH` - and the deployed value is what counts, not the default, so check
the environment rather than this line. `SyndixTreasury.minDwellSeconds` is a separate,
much lower floor (currently **20 seconds**); it is a backstop against a compromised
attester, not the real gate.

**What this does not prove, demonstrated:** comprehension. On 2026-08-18, eighteen wallets
claimed issue 11 - sixteen of them inside eighteen blocks, about eighteen seconds. Every
one held a genuine `up.id`, every one carried a server-measured session, and dwell decoded
from their calldata ran 49 to 179 seconds against a threshold then set to 45. Nothing was
bypassed. They opened the article together, waited out the timer, and claimed the moment
it unlocked.

So the gates held and the reading did not happen. An earlier version of this section argued
that farming "costs more time than the reward pays"; that was wrong, because on a testnet
the reward is not the point and the time is cheap. What proof-of-read actually buys is that
a claim cannot be instant, cannot be bulk-submitted from one wallet, and is capped at one
per `up.id` per article. It buys a floor on effort, not evidence of attention.
Content-derived challenges would raise that floor and are on the roadmap.

### Why the attester is not a middleman

`/api/attest` signs one claim: *this address spent the required time on article N*. It
cannot move money, cannot claim on anyone's behalf, and never holds funds, because
`reader` is bound into the EIP-712 signature and the reader submits their own transaction.
A fully compromised attester key could forge dwell proofs and still could not steal a wei.

---

## Identity is not ours to issue

`up.id` is one namespace for the whole GIWA ecosystem, not a per-app directory. A name is
minted through GIWA's own flow (a Dojang attestation, then a VerifiedToken, then
registration) and lands in the shared ERC-721 named "Upbit Web3 Names" (UPNAME).
`gsucoin.up.id` is the same object to every app on the chain.

So Syndix reads it and cannot write it. `UpIdReaderRegistry` is an adapter whose whole
content is `balanceOf(reader) > 0`. The consequence is deliberate and worth stating
plainly: **Syndix cannot issue the credential it checks.** Our own operator wallet holds
`syndix.up.id`, and it obtained that name the same way any reader does - through GIWA's
Dojang flow, from a registry we do not control and cannot write to. A protocol that could
mint itself the credential it gates on has not implemented a sybil gate.

The label is a separate problem with a separate answer. tokenId is `keccak256(label)` - the ENS
labelhash, not the namehash - which cannot be inverted, and the registry is not `ERC721Enumerable` (`tokenOfOwnerByIndex`
reverts, `supportsInterface(0x780e9d63)` is false), so no view function maps an address to
the name it holds. `nameOf` returns an empty string rather than a guess, and the UI
resolves the display name from token metadata via `/api/up-id/:address`, matching on the
registry's **contract address** rather than its symbol, since anyone can deploy a token
calling itself UPNAME. Only the onchain half authorises anything: if the label lookup
fails, a verified reader still gets paid.

The claim UI offers no way to obtain an identity. It previously had a self-service "claim
any name" form against `MockUpIdRegistry`; that is gone, because a form implying Syndix
can issue identities misrepresents the security model. If the treasury is ever pointed at
a non-production registry, the UI says so.

---

## SyndixPaymaster

An ERC-4337 v0.7 paymaster that sponsors reader claims, so a first-time reader needs no
ETH at all. Deployed, staked (0.0005 ETH) and funded (0.001 ETH) against the EntryPoint
predeploy, with 11 tests.

Scope is deliberately narrow: it sponsors **one target and one selector**,
`SyndixTreasury.claimReaderReward`. An open paymaster is a faucet for anyone who can craft
a UserOperation. There is also a per-sender cap.

**It is not in the claim path, and cannot be yet.** Relaying a UserOperation also requires
a smart-account factory on GIWA (the usual SimpleAccount factory addresses hold no code)
and a bundler serving chain 91342. Neither exists today. Readers submit their own claim
and pay about 0.00000018 ETH; the paymaster is standing infrastructure.

---

## Sustainability: how this pays for itself

**Written and tested, not deployed.**

Today the treasury is a subsidy. Every wei in it came from us, and at the
current reward it funds a few dozen more claims. That is fine for a testnet MVP
and cannot be the story.

The model is not "find money to pay readers". It is **redirecting the
advertising budget one step further down the chain**. Today an advertiser pays a
publisher to harvest a reader's attention and the reader receives nothing. Here
the sponsor's money lands in the reader's wallet and the protocol takes a fee
for running the newsroom. The reward is not a cost centre; it is the product
sold to sponsors.

It is also a better ad product, for reasons specific to what is built here:
proof of read is onchain and checkable, so there are no phantom impressions, and
one `up.id` is one human, so there is no bot traffic. Ad fraud is a roughly
$80B/year problem, and the sybil gate plus server-measured attention is an
anti-fraud primitive that happens to pay the audience.

### SyndixSponsorship

`SyndixTreasury.depositSponsorship` already accepts funding, but every wei of it
lands in the unreserved balance, which the owner may withdraw. Nothing is
earmarked: a sponsor has to trust that we will not take it back, and nothing is
set aside to run the newsroom either. This contract fixes both ends.

Each deposit is split once, at deposit time:

| Bucket | Who can reach it |
| --- | --- |
| `accruedFees` | the owner, via `withdrawFees`. Operating revenue. |
| `committed` | **nobody except readers.** The only path out is `fundTreasury`. |

The fee is capped at **30% by an immutable constant**, not an owner-settable
bound, because an owner who can raise their own ceiling does not have one. It is
never retroactive: the split is banked per deposit, so raising the fee cannot
claw back money already promised. Integer rounding falls to the readers.

`fundTreasury` is permissionless. It has exactly one destination, fixed at
construction, so letting anyone push sponsor money toward readers costs nothing
and removes the operator as a point of failure. **There is no counterpart with a
caller-supplied address, and that absence is the guarantee** - a sponsor can
verify before paying that the non-fee portion cannot be pocketed.

18 tests, most of them attempts to take the readers' share back, including a
fuzzed check that the balance always covers `committed + accruedFees` through any
sequence of deposits, forwards and fee sweeps. Deployed separately rather than
folded into the treasury, which is live and verified on the explorer: editing it
would mean the repo no longer reproduces the deployed bytecode.

**Honest limitation, pinned by a test rather than a comment.** Forwarded funds
land in the treasury's *unreserved* balance, and `publishArticle` is payable
rather than drawing on it, so the operator still attaches the pool and recycles
the sponsorship through `withdrawTreasury`. There is no contract-enforced link
from a given deposit to a given article pool. Adding `publishFromBalance` to the
next treasury version closes that, and is on the roadmap.

### The other two rails

Both already route money to the treasury:

- **x402 agent feed** - `payTo` is the treasury and settlement is verified
  onchain. Currently underpriced: a call costs about $0.012 against a $0.057
  reward, so five agent requests fund one reader. Pricing per value rather than
  per call inverts that.
- **`SyndixArticleNFT.collect`** - priced editions forward `msg.value` to the
  treasury.

### Unit economics

Per issue today: 20 readers at $0.057 is **$1.14 in rewards**, plus about $0.03
of generation. At this size the numbers are a rounding error either way.

At 1,000 verified readers per issue it is **$57 in rewards**. Newsletter
sponsorships run $25-50 CPM against unverified audiences; proven attention
justifies the top of that band, so roughly $150-300 against about $60 of cost.
That works, but it needs an audience, and the honest answer is that the grant is
the runway to build one.

---

## SyndixPublisher

**Written and tested, not deployed.** The path to an unattended newsroom.

Scanning, generation and pinning already run server-side with no human in them. The one
manual step is the owner signing `publishArticle`, and scheduling that means putting a key
on a server. But `publishArticle` is `onlyOwner`, and so is `withdrawTreasury`,
`setReadAttester`, `setReaderRegistry` and `setMinDwellSeconds`. **Autonomy bought that
way costs every security property the protocol advertises.**

`SyndixPublisher` takes ownership of the treasury and re-exposes it as two roles:

| | `owner` (cold wallet) | `publisher` (server key) |
| --- | --- | --- |
| Publish / top up | via passthrough | **only these** |
| Withdraw | yes | no |
| Change attester or registry | yes | no |
| Change its own limits | yes | no |
| Recover treasury ownership | yes | no |

Bounded by a per-article pool cap and a rolling daily publish count. The guard holds the
pool ETH, so the server key needs gas and nothing else, and its balance is not worth
stealing. A compromised server publishes junk until the daily cap trips: bounded, visible
onchain, and fixed by rotating one address.

The treasury is `Ownable`, so this needs no redeploy and loses no history. It is one
`transferOwnership` call, and one more to walk it back. **21 tests cover it, most of them
negative**, asserting what the publisher role cannot reach, including a fuzzed check that
reserved rewards stay untouchable with a contract as owner.

---

## SyndixStableTreasury

**Written and tested, not deployed**, because GIWA's KRW stablecoin does not exist yet.

The reason it matters: Syndix promises a **100 KRW** micro-reward but pays 0.00003 ETH,
which was worth about 132 KRW when the figure was chosen and about 83 KRW a few weeks
later. Denominated in a KRW stablecoin, 100 KRW is 100 KRW.

All three invariants survive the change. The solvency test is the same fuzz with
`token.balanceOf(this) >= reservedRewards` replacing the ETH balance check. The
`ReadProof` typehash is byte-identical, so one attester serves both treasuries with no
per-treasury branch. Mechanically `publishArticle` stops being `payable` and pulls with
`safeTransferFrom`, payouts use `safeTransfer`, and there is no `receive()`: ETH sent to a
token treasury would be stuck, so it cannot arrive.

---

## Architecture

```
GIWA head state + ecosystem signals
          │
          ▼
   Ingestion agent  ──────────►  deepseek-v4-pro on 0G Compute, JSON schema
   (Flashblocks RPC)              (app/api/agent/run/route.ts, NDJSON stream)
          │
          ▼
   IPFS pin (Pinata) ──► publish blocked if pinning fails
          │
          ▼
   Agent Studio (/studio) ──────►  publishArticle + fund reward pool
          │                         (owner signature, the one manual step)
          ▼
   Reader feed (/) ──► Issue reader (/issue/[id])
          │                 │
          │                 ├──► server-measured read session (HMAC, heartbeats)
          │                 └──► EIP-712 ReadProof ──► claimReaderReward ──► ~200ms preconf
          ▼
   x402 feed (/api/x402/feed) ──► machine buyers pay per request
```

---

## Getting started

```bash
npm install
npm run dev            # http://localhost:3000
```

The app reads its issues from the treasury, so a deployed `NEXT_PUBLIC_SYNDIX_TREASURY` is
what makes the feed non-empty. Copy `.env.example` to `.env.local`:

```bash
NEXT_PUBLIC_SYNDIX_TREASURY=...  # the issue index and all reward figures
OPENAI_API_KEY=...               # the studio writes real issues
PINATA_JWT=...                   # pins them to IPFS, so contentURI resolves
ATTESTER_PRIVATE_KEY=...         # signs ReadProofs and derives the read-session key
READ_MIN_SECONDS=300             # optional, dwell required before a proof is signed
READ_MIN_DEPTH=0.85              # optional, scroll fraction required
```

Without `OPENAI_API_KEY` the studio replays a recorded pipeline and badges itself
"Simulated". Every surface that shows something other than live chain data says so.

### Contracts

```bash
npm run contracts:test     # 101 tests
npm run contracts:deploy   # to GIWA Sepolia
npm run abi                # regenerate lib/abi.ts from the artifacts
npm run check              # typecheck + lint + build + contracts:test
```

Deployment needs `PRIVATE_KEY` and testnet ETH from
[faucet.giwa.io](https://faucet.giwa.io). With `READER_REGISTRY` unset the script deploys
a `UpIdReaderRegistry` over the live Upbit Web3 Names registry, so a fresh deploy gates on
the real thing by default.

---

## The contracts

`SyndixTreasury` holds sponsor deposits, funds per-issue reward pools, and settles reader
claims. It is built around three guarantees, each pinned by a regression test:

**1. Solvency.** Every wei promised to a reader is accounted in `reservedRewards` and is
unreachable by the owner. `withdrawTreasury` can move only `unreservedBalance()`.

```solidity
function unreservedBalance() public view returns (uint256) {
    uint256 balance = address(this).balance;
    uint256 reserved = reservedRewards;
    return balance > reserved ? balance - reserved : 0;
}
```

`address(this).balance >= reservedRewards` is fuzzed over 256 runs. A treasury that
withdraws against the raw balance, as the first draft of this contract did, silently
bricks every outstanding reader claim the moment the owner takes a fee.

**2. Sybil resistance.** `claimReaderReward` requires a verified identity through
`IReaderRegistry`, satisfied by `UpIdReaderRegistry` over the live Upbit Web3 Names
ERC-721. The interface is deliberately thin, which is what let the deployment move from a
mock to the real registry with a single `setReaderRegistry` call and no redeploy.

**3. Proof of read.** A claim carries an EIP-712 `ReadProof` signed by the read-attester.
The reader submits the transaction, so the attester never custodies funds.

The claim path orders itself carefully: every state change lands before the ETH transfer,
the function is `nonReentrant`, and payouts use `.call{value:}` rather than `.transfer`,
whose 2300-gas stipend would break payouts to Safes and 4337 accounts.

`SyndixArticleNFT` is a two-level open edition: the publisher registers an edition once
(the metadata-heavy write), and each reader's collect is a cheap sequential mint pointing
at it. That split is what makes "collect the issue" a consumer action rather than a gas
decision.

```
forge test    101 passed, 0 failed
npm test      48 passed, 0 failed
```

Mock contracts under `contracts/mocks/` are **test fixtures only**. Neither is used by
application code; `MockKrwStable` is never deployed at all.

---

## What is real and what is simulated

Stated plainly, because a grant reviewer should not have to guess:

| Component | Status |
| --- | --- |
| Smart contracts | **Real.** Solidity 0.8.24, 101 passing Foundry tests including three fuzzed solvency invariants. |
| GIWA chain reads | **Real.** Live head state and gas price from the Flashblocks RPC on every run, verifiable on the explorer. |
| Issue content | **Real.** Written by `deepseek-v4-pro` on the 0G Compute Router against live chain state, pinned to IPFS, read back from the treasury index. The app bundles no article bodies. |
| AI issue generation | **Real.** Issues are written by `deepseek-v4-pro` on the 0G Compute Router against a strict JSON schema, with Structured Outputs. Each issue records both its model and the network that ran it in the IPFS metadata the treasury points at. The default model is TEE-attested, so the provenance claim is checkable rather than trusted. Issues 1-11 predate the switch and were written by `gpt-4.1`; their metadata says so. A clone with no inference key replays a recorded pipeline and the studio badges itself "Simulated". |
| Reward claim flow | **Real.** Attested by `/api/attest`, submitted by the reader, settled on GIWA Sepolia. |
| Proof of read | **Real, and server-measured.** Elapsed time comes from the server's clock via a signed session; scroll depth and heartbeat cadence are enforced. It proves time and scrolling, not comprehension. |
| up.id identity | **Real, and not ours.** Gated on the live ecosystem registry: a wallet with no genuine `up.id` cannot claim, and Syndix has no power to issue one to anybody, itself included. |
| IPFS pinning | **Real.** Pinned through Pinata on publish; publishing aborts if pinning fails, so no article is indexed with an unresolvable CID. |
| Analytics time series | **Real.** Daily buckets reconstructed from `RewardClaimed` and `ArticlePublished` logs. Empty days render empty rather than interpolated. |
| x402 endpoint | **Real 402 flow and real onchain verification, custom scheme.** The challenge follows x402's shape and settlement is checked against the receipt, but the scheme is `giwa-native-transfer`, not x402's `exact` - `exact` requires an EIP-3009 authorisation, which native ETH cannot carry, and ERC-20 rails do not meaningfully exist on GIWA Sepolia yet. Without a treasury set it accepts a well-formed hash and returns `verification: "accepted-unverified"`. |
| Sponsorship revenue | **Contract written and tested, not deployed.** `SyndixSponsorship` splits each deposit into a capped protocol fee and a reader-committed remainder that no owner function can reach. To date the treasury is 100% self-funded and external revenue is zero. |
| Autonomous publishing | **Not built.** Writing is autonomous; publishing needs an owner signature. `SyndixPublisher` is written and tested but not deployed. |
| ERC-4337 gasless | **Paymaster real, sponsorship not reachable.** Deployed, staked and funded, sponsoring only `claimReaderReward`, but GIWA Sepolia has no bundler serving 91342 and no smart-account factory, so readers pay their own gas. |
| KRW denomination | **Not deployed.** `SyndixStableTreasury` is written and tested against a mock; GIWA's KRW stablecoin does not exist yet. |

---

## The attention ledger

Every claim emits `RewardClaimed(articleId, reader, identity, amount)`, so the record of
who read what already existed on chain and had simply never been read back. Two views
fall out of it, and they are the same data from opposite sides. Neither required a
contract change.

**A reader's record** - `GET /api/reader/:address`. Which issues a wallet has finished,
what it earned, and the transaction for each. Because claims are gated on a soul-bound
`up.id` and capped at one per article, this is a history that **cannot be inflated by
generating addresses** - which is what separates it from any self-reported profile. It is
public and unauthenticated on purpose: the record belongs to the reader, and another
application should be able to read it without asking us.

**A sponsor's receipt** - `GET /api/article/:id/receipt`. How many distinct verified
humans finished an issue, what they were paid, and the dwell time certified for each.
Advertisers normally accept an impression count on trust, which is why ad fraud is a
multi-billion-dollar industry; here the count comes from settled transactions and anyone
can recompute it from the contract.

Dwell deserves its own caveat, and the endpoint carries it. The contract verifies dwell
but does not store it, so it is not in the event - it is however an argument to
`claimReaderReward`, and therefore decodable from the claim's calldata. That makes it
publicly checkable, but it is the figure the attester signed rather than an independent
measurement: evidence that the server judged a reader to have spent that long, not proof
that they did.

---

## Roadmap

**The reward is the hook. The proof is the product.**

Syndix is not trying to be a better newsletter. It is trying to be the layer that makes
attention verifiable - a thing advertising has never had, and the reason roughly $80B a
year is lost to fraud. Everything below either sharpens that proof or gets it in front of
more people.

Items are grouped by what actually gates them, not by preference. Where something waits
on infrastructure outside this project, it says so rather than being listed as work.

### Now - ready to ship

1. **Deploy `SyndixPublisher`.** Written, 21 tests. Splits publishing from treasury
   control so the pipeline can run unattended without an owner key on a server.
2. **Deploy `SyndixSponsorship`.** Written, 18 tests. Turns the treasury from a subsidy
   into revenue: a capped protocol fee, and a reader share no owner function can reach.
3. **Multi-agent newsroom.** Specialist agents - onchain activity, protocol updates,
   Korean market context - that cite their sources, rather than one generalist prompt.
4. **Korean issues.** GIWA is built by Dunamu and demo day is Korea Blockchain Week.
   Generated bilingually and pinned as a pair, not a translated interface: article bodies
   are content-addressed, so a translation is a different document, not an edit.

### Next - builds on what exists

5. **Comprehension challenges.** Proof of read currently proves time and scrolling. The
   next version asks something only the issue can answer, closing the gap the honesty
   table already admits.
6. **Correction chains.** Issues are immutable, so a correction must be a new issue. A
   `supersedes` field in the pinned metadata makes that chain auditable. No contract
   change - the link lives in the article JSON.
7. **Reader-commissioned coverage.** Readers pool ETH to fund an issue on a topic,
   inverting the sponsor model. A new contract alongside the treasury; the deployed
   treasury stays untouched.
8. **Attention marketplace.** The honest endpoint of the sponsor receipt: advertisers buy
   verified human reads with settlement anyone can recompute from the contract. This is
   the business the proof makes possible.

### Blocked - waiting on GIWA, not on us

9. **Gasless claims.** `SyndixPaymaster` is deployed, staked and funded, and sponsors only
   `claimReaderReward`. It needs a bundler serving chain 91342 and a smart-account
   factory. Neither exists yet.
10. **KRW denomination.** `SyndixStableTreasury` is written and tested against a mock, so
    a 100 KRW promise pays exactly 100 KRW. It needs GIWA's stablecoin.
11. **Mainnet deployment.** Contracts are clean and tested; a third-party audit is a real
    cost to budget for rather than a checkbox, and private mainnet access is GIWA's to
    grant.

### Deliberately not doing

**Selling reader behaviour.** An obvious revenue line, and the wrong one. The attention
ledger's whole claim is that a reader's record belongs to the reader - monetising it
would make us the thing we are positioned against.

**Reader moderation of issues.** The feed's promise is that nobody submits an article and
nothing is moderated. A quality-flagging layer would quietly retract that.

---

## Stack

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · wagmi v3 ·
viem v2 · motion · recharts · Foundry + OpenZeppelin v5 · `openai` v7 pointed at the
0G Compute Router (`deepseek-v4-pro`, configurable via `SYNDIX_MODEL`).

The design system lives entirely in `app/globals.css` as Tailwind v4 `@theme` tokens, with
no hard-coded hex values in components.

---

## Links

- GIWA docs, <https://docs.giwa.io>
- GIWA Sepolia explorer, <https://sepolia-explorer.giwa.io>
- Faucet, <https://faucet.giwa.io>
- up.id playground, <https://sepolia-playground.giwa.io>
