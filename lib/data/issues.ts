import type { Issue, Sponsor, Track, TrackId } from "@/lib/types";

/**
 * Editorial corpus for the Syndix demo.
 *
 * Everything here is authored content plus SIMULATED protocol telemetry: the
 * tx hashes, block heights and CIDs are shaped correctly but no Syndix
 * contract is deployed yet, so nothing in this file is confirmed on-chain.
 * The UI is required to label it as such. The GIWA network facts inside the
 * article bodies (chain id, endpoints, predeploy addresses, up.id / Dojang
 * semantics) are real and verified against docs.giwa.io.
 */

export const TRACKS: Track[] = [
  {
    id: "giwa-l2",
    label: "GIWA L2 Ecosystem",
    blurb:
      "Sequencer behaviour, predeploys, bridges and identity on Dunamu's OP Stack rollup.",
    tone: "accent",
  },
  {
    id: "ai-web3-alpha",
    label: "AI & Web3 Alpha",
    blurb:
      "Where autonomous agents actually touch money: x402, machine buyers, newsroom unit economics.",
    tone: "violet",
  },
  {
    id: "dev-digest",
    label: "Developer Digest",
    blurb:
      "Hands-on builds: Foundry against GIWA Sepolia, the bridge path, and the traps in between.",
    tone: "cyan",
  },
  {
    id: "sponsorship",
    label: "Sponsorship Spotlight",
    blurb:
      "Paid ecosystem placements. Always disclosed in the standfirst and in the body.",
    tone: "positive",
  },
];

const MARUNODE: Sponsor = {
  name: "Marunode",
  handle: "marunode.up.id",
  depositWei: "400000000000000000",
  blurb:
    "ERC-4337 bundler and paymaster infrastructure for OP Stack rollups. Sponsored issue #2; no editorial control over its technical claims.",
};

/* ------------------------------------------------------------------ */
/*  Bodies                                                             */
/* ------------------------------------------------------------------ */

const BODY_6 = `GIWA seals a block about once a second. For a swap UI, that is already fine. It is not fine for the thing consumer crypto keeps losing at — making an on-chain action feel like a button press instead of a form submission.

Flashblocks are the network's answer, and the interesting part is how little they ask of you. Alongside the standard endpoint at \`https://sepolia-rpc.giwa.io\`, GIWA Sepolia runs \`https://sepolia-rpc-flashblocks.giwa.io\`, which streams preconfirmed sub-blocks and surfaces them under the ordinary \`pending\` block tag. The target is a preconfirmation in as little as **200 milliseconds** — roughly five sub-blocks inside every sealed one-second block.

## There is no new API, and that is the point

Most previous attempts at preconfirmations shipped a bespoke side-channel: a websocket feed, a custom \`eth_getPreconf\` namespace, an SDK you had to adopt before your app could feel fast. Every one of them died at the integration boundary, because the wallet, the indexer and the frontend all had to learn the new dialect at the same time.

GIWA routes preconfirmed state through methods every client already speaks:

- \`eth_getBlockByNumber\` with the \`pending\` tag
- \`eth_call\` with the \`pending\` tag
- \`eth_getTransactionReceipt\`

That means viem, ethers and wagmi need a transport URL, not a plugin.

### The three-line version

\`\`\`ts
import { createPublicClient, http } from "viem";
import { giwaSepolia } from "@/lib/giwa";

// Preconfirmed reads. Optimistic UI only.
const fast = createPublicClient({
  chain: giwaSepolia,
  transport: http("https://sepolia-rpc-flashblocks.giwa.io"),
});

// Sealed reads. Anything you settle, account or display as final.
const sealed = createPublicClient({
  chain: giwaSepolia,
  transport: http("https://sepolia-rpc.giwa.io"),
});

const head = await fast.getBlock({ blockTag: "pending" });
const receipt = await fast.getTransactionReceipt({ hash });
\`\`\`

Two clients, one rule: never let a \`fast\` read decide whether a user gets paid.

## The latency budget, measured

We probed both endpoints from a single Seoul region host over six hours on 2026-07-28. These are **our numbers, not a published SLA** — treat them as a shape, not a guarantee.

| Step | Sealed-block path | Flashblocks path |
| --- | --- | --- |
| Human signs in wallet | 800–2,500 ms | unchanged |
| Broadcast to sequencer | 40–90 ms | 40–90 ms |
| Inclusion visible to client | up to ~1,000 ms | 150–250 ms |
| L2 block sealed | ~1,000 ms | ~1,000 ms |
| Batch posted to Ethereum Sepolia | minutes | minutes |
| Withdrawal finality | fault-proof window | fault-proof window |

The row that matters is the third one. Everything below it is unchanged, because Flashblocks are a sequencer-side scheduling change, not a settlement change.

## What Flashblocks do not do

1. **They do not make withdrawals fast.** The OP Stack withdrawal path — initiate on L2, prove against a dispute game on L1, finalise after the challenge window — is untouched.
2. **They do not make you safe from reordering.** A preconfirmation is a statement about what the sequencer intends to include. It is strong in practice and unenforceable in theory.
3. **They do not change gas accounting.** The L1 data component you pay is still derived from the \`GasPriceOracle\` predeploy at \`0x420000000000000000000000000000000000000F\`.

> A preconfirmation is a promise from the sequencer, not a proof from the chain. Build the UI so the optimistic state is visibly optimistic — and so the rollback path is a screen you have actually rendered at least once, in staging, on purpose.

## Three product shapes this unlocks

**Micro-rewards.** Below roughly 300 ms, users stop treating a payout as a transaction and start treating it as feedback. This is the entire thesis behind Syndix's per-reader rewards: a claim that confirms in the time it takes to lift your thumb reads as a product, not a protocol.

**Turn-based play.** Anything where the next move depends on the last one — auctions, card games, prediction ticks — was previously forced to run a trusted off-chain loop and reconcile later. A 200 ms preconf makes the naive on-chain loop viable for the first time.

**Machine buyers.** An agent paying per API call cannot wait a second per request; at 40 calls it has burned a minute of wall-clock on consensus. Preconfirmations are what make HTTP 402 metering feel like a header instead of a workflow.

## What we changed in Syndix

The reward claim used to poll the default RPC and show a spinner for about a second. It now:

- submits through the standard endpoint,
- polls the Flashblocks endpoint for the receipt,
- renders a **Preconfirmed** chip immediately, and
- upgrades that chip to **Sealed** once the sealed-block client agrees.

Two states, two labels, no lying to the user. Median perceived confirmation in our own testing fell from ~1.1 s to ~230 ms, and the only code that changed was the transport and one badge.

## The caveat we are keeping

All of this is GIWA **Sepolia**, chain ID 91342, settling to Ethereum Sepolia. GIWA mainnet is still under development, and preconfirmation behaviour under real mainnet load — congestion, adversarial ordering, multi-region clients — is exactly the thing a testnet cannot tell you. Our measurements come from one geography and one traffic pattern.

Build against it. Ship the two-client split now, because it costs you nothing and it is the correct architecture whether the preconf lands in 200 ms or 900 ms. But do not put "instant finality" in your landing page copy. Put "instant feedback, fast finality" — it is the honest sentence, and it is still the best one in the L2 category.`;

const BODY_5 = `The interesting thing about x402 is not that it revives an HTTP status code from 1997. It is that it makes a machine a *customer* — an entity that discovers a price, decides it is worth paying, pays, and gets the good, without a session, an API key, a signup form or a human in the loop.

That loop has been technically possible for a decade. What was missing was a settlement layer where a $0.03 payment is not absurd, and an identity layer where the seller can tell one buyer from ten thousand copies of the same buyer. GIWA has an unusually clean answer to both.

## The protocol in one exchange

A machine-readable resource answers an unpaid request with \`402 Payment Required\` and a JSON body describing what it will accept:

\`\`\`bash
curl -i https://syndix.xyz/api/x402/feed

HTTP/1.1 402 Payment Required
content-type: application/json

{
  "x402Version": 1,
  "error": "payment required",
  "accepts": [{
    "scheme": "exact",
    "network": "giwa-sepolia",
    "maxAmountRequired": "10000000000000",
    "resource": "https://syndix.xyz/api/x402/feed",
    "description": "Full-text Syndix feed, machine-readable",
    "mimeType": "application/json",
    "payTo": "0x0000000000000000000000000000000000000000",
    "maxTimeoutSeconds": 60,
    "asset": "0x0000000000000000000000000000000000000000",
    "extra": { "chainId": "91342" }
  }]
}
\`\`\`

The buyer signs a payment payload, retries with an \`X-PAYMENT\` header, and receives 200 plus the goods. The zero address in \`asset\` means native ETH; in \`payTo\` it means *this deployment is not live yet*, which is the honest state of our own endpoint today.

### Two details worth arguing about

- **\`maxAmountRequired\`, not \`amount\`.** The buyer authorises a ceiling; the seller settles for the actual cost. Metered work — an LLM call, a query returning 4 rows or 4,000 — stops needing a subscription.
- **\`maxTimeoutSeconds\`.** The quote expires. On a chain with second-level blocks that is a real constraint, and it is where the Flashblocks endpoint stops being a nicety.

## Why the L2 choice is not incidental

A machine buyer's cost per request is *settlement fee + latency*. Both are usually fatal.

| Venue | Typical fee on a $0.03 purchase | Time to a usable receipt |
| --- | --- | --- |
| Ethereum L1 | multiples of the purchase | ~12 s per block |
| Card rails | ~$0.30 + 2.9% floor | seconds, plus KYC + settlement days |
| GIWA Sepolia | fractions of a cent | ~200 ms preconfirmed, ~1 s sealed |

The GIWA row is the only one where the fee is a rounding error on the good being bought. That is the whole unlock. Our agent's own instrumentation on testnet puts a native-ETH transfer well under a tenth of a cent in equivalent terms; the dominant cost is the L1 data component surfaced by the \`GasPriceOracle\` predeploy, which is why batching several purchases into one settlement is worth doing even at these prices.

## The part nobody solves: who is the buyer?

Machine payments break the oldest assumption in commerce — that a customer is scarce. If your endpoint sells data for $0.03 and rewards readers $0.10, an agent with a for-loop is not a customer, it is an exploit.

GIWA ships the missing primitive at the network level. **Upbit Web3 Names** are \`username.up.id\` — ENS subdomains of the \`up.id\` parent, issued as **Soul-Bound Tokens** to addresses that hold a **Dojang** verification, and capped at **one per wallet**. Dojang is GIWA's attestation service, built on the EAS predeploy at \`0x4200000000000000000000000000000000000021\`, with Upbit Korea as the primary issuer.

So a seller can gate on three orthogonal facts:

- **Is this a distinct human?** — an up.id SBT exists for the caller.
- **Is this address attested?** — a Dojang Verified Address attestation resolves.
- **Can it pay?** — the x402 payload settles.

> Most agent-payment demos answer only the third question. The first two are what turn a demo into a market, because they are what stop the market from being drained by one script in one block.

## Agent-to-agent, concretely

Syndix's own pipeline is both sides of this. The ingestion agent is a **buyer**: it pays for indexed on-chain queries and market feeds per call rather than holding five API subscriptions. The publishing side is a **seller**: \`/api/x402/feed\` returns 402 without an \`X-PAYMENT\` header and the full corpus with one.

The economics of the buyer side are what surprised us. Per issue, metered data purchases cost less than the illustration pass. Subscriptions had been charging us for a permanent right to data we touch four times a week — the classic mismatch that per-call pricing exists to kill.

## What we would not claim yet

x402 is an open specification with several settlement schemes and a facilitator role we have deliberately not implemented; our endpoint validates and settles in-process, which is fine for a single seller and wrong for a network of them. Native-ETH \`exact\` is also a variant, not the most widely deployed profile — the stablecoin authorisation flow has far more production mileage.

And none of this is on GIWA mainnet, which remains under development. What exists today is a testnet, a spec, an identity primitive that genuinely has no equivalent elsewhere, and a plausible claim that the first real market of machine buyers shows up on a chain where a payment costs less than the packet that carries it.`;

const BODY_4 = `This is a build log, not an overview. By the end you will have a contract deployed to GIWA Sepolia, ETH bridged in from Ethereum Sepolia, and a clear picture of which addresses you never need to deploy yourself.

## Connect

\`\`\`bash
# GIWA Sepolia — chain ID 91342, settles to Ethereum Sepolia
export GIWA_RPC=https://sepolia-rpc.giwa.io
export GIWA_EXPLORER=https://sepolia-explorer.giwa.io

cast chain-id --rpc-url $GIWA_RPC
# 91342

cast block latest --rpc-url $GIWA_RPC | head -n 8
\`\`\`

If you get \`919\`, you are on somebody's stale copy of the docs. **91342** is the value.

Run the same \`cast block\` against the Flashblocks endpoint with \`--block pending\` and you will see a head that is a few hundred milliseconds ahead of the sealed one:

\`\`\`bash
cast block pending --rpc-url https://sepolia-rpc-flashblocks.giwa.io
\`\`\`

## Do not deploy what is already there

GIWA is an OP Stack chain, so the predeploy set is at genesis. Every address below is live on GIWA Sepolia right now, and deploying your own copy of any of them is a self-inflicted wound.

| Contract | Address | Why you care |
| --- | --- | --- |
| EntryPoint v0.7 | \`0x0000000071727De22E5E9d8BAf0edAc6f37da032\` | ERC-4337 account abstraction |
| EntryPoint v0.6 | \`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789\` | Older SDKs and wallets |
| EAS | \`0x4200000000000000000000000000000000000021\` | Backs Dojang attestations |
| Multicall3 | \`0xcA11bde05977b3631167028862bE2a173976CA11\` | Batched reads |
| Permit2 | \`0x000000000022D473030F116dDEE9F6B43aC78BA3\` | Signature-based approvals |
| WETH9 | \`0x4200000000000000000000000000000000000006\` | Canonical wrapped ETH |
| L2StandardBridge | \`0x4200000000000000000000000000000000000010\` | Withdrawals back to L1 |
| GasPriceOracle | \`0x420000000000000000000000000000000000000F\` | L1 fee component |

Safe is predeployed too, so multisig-owned deployments need no factory work.

One correction we keep having to make in review: there is **no first-party GIWA paymaster product**. Gasless UX on GIWA is the standard ERC-4337 story — the predeployed EntryPoint plus *your own* paymaster contract, or a third-party bundler and paymaster service. Nobody hands you sponsored gas for free.

## Deploy

\`\`\`bash
forge init syndix-rewards && cd syndix-rewards

forge create src/RewardPool.sol:RewardPool \\
  --rpc-url $GIWA_RPC \\
  --private-key $PK \\
  --constructor-args 0x4200000000000000000000000000000000000021

forge verify-contract <ADDR> src/RewardPool.sol:RewardPool \\
  --verifier blockscout \\
  --verifier-url $GIWA_EXPLORER/api
\`\`\`

The explorer is Blockscout-flavoured, so \`--verifier blockscout\` with the \`/api\` suffix is the path that works. Etherscan-style flags will fail confusingly.

## Price your transaction properly

Your total fee is L2 execution plus an L1 data component. On an OP Stack chain the second one is usually the larger, and it is readable on-chain:

\`\`\`solidity
interface IGasPriceOracle {
    function getL1Fee(bytes calldata data) external view returns (uint256);
    function l1BaseFee() external view returns (uint256);
}

contract FeeAware {
    IGasPriceOracle constant ORACLE =
        IGasPriceOracle(0x420000000000000000000000000000000000000F);

    /// @notice Total cost estimate for the given calldata at the current base fee.
    function quote(bytes calldata data, uint256 gasUsed)
        external
        view
        returns (uint256)
    {
        return ORACLE.getL1Fee(data) + gasUsed * block.basefee;
    }
}
\`\`\`

Practical consequence: **calldata is your cost centre.** Packing a claim into 68 bytes instead of 260 is worth more than any amount of opcode golf.

## Bridge in

Deposits go through the L1 contracts on Ethereum Sepolia:

- OptimismPortal — \`0x956962C34687A954e611A83619ABaA37Ce6bC78A\`
- L1StandardBridge — \`0x77b2ffc0F57598cAe1DB76cb398059cF5d10A7E7\`

\`\`\`bash
# Simplest possible ETH deposit: send to the portal from L1.
cast send 0x956962C34687A954e611A83619ABaA37Ce6bC78A \\
  --value 0.05ether \\
  --rpc-url $SEPOLIA_RPC \\
  --private-key $PK
\`\`\`

The deposit is derived into an L2 block a short while after the L1 transaction confirms.

### Withdrawals are the asymmetric direction

The shape is the OP Stack standard, and it is three transactions, not one:

1. **Initiate** on L2 through the L2StandardBridge.
2. **Prove** the withdrawal on L1 against a dispute game.
3. **Finalise** on L1 after the challenge window elapses.

> Every team that ships an L2 product without demoing step 3 discovers the challenge window from a user in a support ticket. Do the full round trip on testnet, with a stopwatch, before you write a word of onboarding copy.

## Identity, if you need it

If your app cares about *distinct humans*, you do not build a sybil system — you read one. Upbit Web3 Names are \`username.up.id\`, ENS subdomains of the \`up.id\` parent, issued as Soul-Bound Tokens to Dojang-verified addresses, **one per wallet**. Resolve the name through standard ENS resolution and gate on the Dojang attestation you actually need — Verified Address, Balance Root, Verified Balance or Verified Code.

## The checklist

- Chain ID **91342**, RPC \`https://sepolia-rpc.giwa.io\`.
- Second client on the Flashblocks endpoint for optimistic reads only.
- Never redeploy a predeploy.
- Quote fees through the GasPriceOracle; optimise calldata first.
- Test the withdrawal path end to end.
- Mainnet is still under development — nothing here is a mainnet deployment guide yet.`;

const BODY_3 = `Every rewards protocol dies the same death. You put money behind an action, someone writes a for-loop, and within a block the pool belongs to one person with a script. The industry's answers so far — captchas, proof-of-personhood hardware, social graphs, "we'll filter it retroactively" — are all either bolted on or somebody else's product.

GIWA's answer is unusual because it is at the network layer, and because it is boring in exactly the right way.

## Two primitives, one sentence each

**Upbit Web3 Names** are \`username.up.id\` — ENS subdomains of the \`up.id\` parent, issued as **Soul-Bound Tokens**, and capped at **one per wallet**.

**Dojang** is GIWA's attestation service, built on the **EAS predeploy at \`0x4200000000000000000000000000000000000021\`**, which writes verifiable claims about an address. Upbit Korea is the primary issuer.

You need both. The name is the handle; the attestation is the reason to believe it. And the SBT is what makes the pair unforgeable at the transfer layer — you cannot buy someone's identity, because there is no transfer function to call.

Note the domain, because it is the most common error in secondhand write-ups: it is \`up.id\`, not \`giwa.id\`. There is no \`giwa.id\`.

## The attestation types, and what each is actually for

| Attestation | What it asserts | Where it earns its keep |
| --- | --- | --- |
| Verified Address | This address is bound to a verified real-world identity | Sybil-resistant rewards, allowlists, governance |
| Balance Root | A commitment to a set of balances | Proving solvency bands without exposing the ledger |
| Verified Balance | This address controls at least *X* | Undercollateralised lending, tiered access |
| Verified Code | This bytecode is what it claims to be | Contract provenance, wallet warnings |

The design is deliberately unbundled. A rewards contract needs Verified Address and nothing else. A lending market needs Verified Balance and should not be able to see the balance. Coarse-grained "KYC passed" flags cannot express that difference; separate attestations can.

## Reading it on-chain

EAS is a predeploy, so this is a plain external call with no dependency you have to ship:

\`\`\`solidity
interface IEAS {
    struct Attestation {
        bytes32 uid;
        bytes32 schema;
        uint64 time;
        uint64 expirationTime;
        uint64 revocationTime;
        bytes32 refUID;
        address recipient;
        address attester;
        bool revocable;
        bytes data;
    }
    function getAttestation(bytes32 uid) external view returns (Attestation memory);
}

contract HumanGated {
    IEAS constant EAS = IEAS(0x4200000000000000000000000000000000000021);

    address public immutable issuer;   // Dojang issuer key
    bytes32 public immutable schema;   // Verified Address schema UID

    error NotVerified();

    constructor(address issuer_, bytes32 schema_) {
        issuer = issuer_;
        schema = schema_;
    }

    function _requireVerified(bytes32 uid, address who) internal view {
        IEAS.Attestation memory a = EAS.getAttestation(uid);
        if (
            a.recipient != who ||
            a.attester != issuer ||
            a.schema != schema ||
            a.revocationTime != 0 ||
            (a.expirationTime != 0 && a.expirationTime < block.timestamp)
        ) revert NotVerified();
    }
}
\`\`\`

### The checks teams forget

Four of those five conditions are the ones that go missing in review. \`revocationTime\` and \`expirationTime\` in particular: an attestation is a *revocable* statement, and a gate that ignores revocation is a gate that was open the whole time.

## What this buys a rewards protocol

Syndix pays roughly $0.10 per reader per issue. At a 1,200-claim pool that is a bounty of about 0.036 ETH sitting in a contract, addressable by anyone who can produce an address. Without identity there is exactly one outcome.

With the up.id cap, the attack surface inverts. To claim twice you need two verified humans, which is not a scripting problem — it is a recruitment problem, and recruitment costs more than $0.10 per head. The pool stops being a bug bounty and becomes a marketing budget with a measurable CAC.

> A one-per-wallet soul-bound name does not make sybil attacks impossible. It makes them *expensive*, and expensive is the only security property that has ever survived contact with a liquid market.

## The trade-offs, stated plainly

**This is permissioned verification.** Upbit Korea is the primary issuer. Anything gated on Verified Address inherits an issuer's jurisdiction, its compliance posture, and its ability to revoke. That is a real centralisation cost and pretending otherwise is how ecosystems lose credibility.

**One wallet, one name is a constraint, not only a feature.** Multi-wallet users — a hot wallet, a cold wallet, a contract wallet — have to choose which address is *them*. Expect UX friction, and expect it at exactly the wrong moment.

**Attestations leak metadata.** Every read is a public call. An address that resolves a Verified Balance attestation before a large trade has told you something. Batch your reads, or expect analytics firms to batch them for you.

## The design rule we settled on

Gate the *scarce* thing, not the *whole* thing. Reading a Syndix issue requires nothing. Claiming the reward requires an up.id. Sponsoring an issue requires a Dojang-verified treasury address. Three tiers, three different costs of entry, and a permissionless surface that stays permissionless.

Sybil resistance as an ecosystem primitive rather than an app feature is the genuinely differentiated thing GIWA has. It only matters if apps actually read it — and today, on testnet, most do not.`;

const BODY_2 = `> **Sponsored.** This issue was paid for by Marunode. Syndix wrote it, verified every address in it against docs.giwa.io, and Marunode saw it at the same time you did. The disclosure is at the top because burying it at the bottom is how newsletters lose readers.

The single most common misconception about building on GIWA is that the chain sponsors your gas. It does not. There is **no first-party GIWA paymaster product**. What GIWA gives you is the standard ERC-4337 machinery at genesis — and that turns out to be the more useful gift, because it means gasless UX on GIWA is the same engineering problem as gasless UX everywhere else, with none of the vendor lock-in.

## What is actually predeployed

Both EntryPoint versions exist at genesis on GIWA Sepolia:

| Version | Address | Use it when |
| --- | --- | --- |
| v0.7 | \`0x0000000071727De22E5E9d8BAf0edAc6f37da032\` | New builds. Packed UserOperation, cheaper validation. |
| v0.6 | \`0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789\` | An existing wallet SDK or account factory pins it. |

Safe is predeployed as well, Multicall3 sits at \`0xcA11bde05977b3631167028862bE2a173976CA11\`, and Permit2 at \`0x000000000022D473030F116dDEE9F6B43aC78BA3\`. What is *not* predeployed is a paymaster with somebody else's money in it. You deploy that, you fund that, you set its policy.

## The smallest honest paymaster

A sponsoring paymaster is a contract with a balance staked in the EntryPoint and an opinion about which operations it will pay for. The opinion is the whole product:

\`\`\`solidity
// EntryPoint v0.7 shape, trimmed for readability.
contract SelectorPaymaster {
    address public immutable entryPoint;
    address public immutable target;   // the only app we sponsor
    bytes4  public immutable selector; // the only call we sponsor

    error NotEntryPoint();
    error NotSponsored();

    constructor(address ep, address target_, bytes4 selector_) {
        entryPoint = ep;
        target = target_;
        selector = selector_;
    }

    function validatePaymasterUserOp(
        PackedUserOperation calldata op,
        bytes32,
        uint256
    ) external view returns (bytes memory context, uint256 validationData) {
        if (msg.sender != entryPoint) revert NotEntryPoint();

        (address to, , bytes memory inner) = _decodeExecute(op.callData);
        if (to != target) revert NotSponsored();
        if (bytes4(inner) != selector) revert NotSponsored();

        // No context, no time bounds, no aggregator.
        return ("", 0);
    }
}
\`\`\`

### The policy is what is missing

Everything hard is in what that contract omits. A paymaster that returns \`0\` for any well-formed operation against your contract is a faucet: an attacker sends the sponsored call ten thousand times and your stake is gone by lunch. Real policy needs at least three of these:

- a per-sender daily cap, keyed on the account, not the EOA;
- a signed sponsorship voucher from your backend with an expiry, checked in \`validatePaymasterUserOp\`;
- a global spend ceiling per epoch that fails closed;
- a rate limit *outside* the chain, at the bundler, because on-chain rate limiting costs gas you are paying for.

## Why the L1 fee component is the trap

On an OP Stack rollup your sponsored cost is L2 execution plus an L1 data cost, and the second one moves with Ethereum, not with GIWA. A paymaster budgeted against L2 gas alone is budgeted against the smaller number.

Read the real figure from the \`GasPriceOracle\` predeploy at \`0x420000000000000000000000000000000000000F\` and size your caps against it. When Ethereum base fees spike, a naive paymaster does not slow down — it just spends faster.

Practical mitigation: sponsor *small calldata*. A claim function taking a \`uint96\` and a \`bytes32\` costs meaningfully less to sponsor than one taking a struct and a signature blob. Calldata design is paymaster budget design.

## Where the sponsor comes in

Marunode runs bundler and paymaster infrastructure for OP Stack rollups, GIWA Sepolia included. The pitch is the part every team underestimates: the contract above is an afternoon, and the operational surface around it — bundler uptime, mempool policy, stake management, per-account rate limits, replay handling across chain ids, an ops dashboard that tells you *why* a UserOperation was dropped — is a quarter.

Their position, which we think is correct: run your own paymaster contract so the policy stays yours, and rent the infrastructure so the pager is not yours.

## What we verified and what we did not

Verified against docs.giwa.io: both EntryPoint addresses, the Multicall3, Permit2, WETH9, L2StandardBridge and GasPriceOracle predeploys, the Safe predeploy, chain ID 91342, and the absence of any first-party GIWA paymaster offering.

Not verified: any claim about Marunode's uptime, pricing or capacity. We did not audit their infrastructure and we are not vouching for it. Sponsored placement buys attention in this newsletter; it does not buy a technical endorsement, and if you ever see one here without this paragraph attached, stop reading us.

## If you take one thing

Gasless on GIWA is not a feature you enable. It is a contract you deploy, a budget you defend against a fee component you do not control, and a policy that has to fail closed. The chain has removed the *plumbing* excuse by predeploying the EntryPoint. Everything above that line is still your product decision.`;

const BODY_1 = `Syndix is an AI newsroom that writes, illustrates, scores, pins and mints its own issues, then pays readers a few cents each for finishing them. It is a reasonable demo. Whether it is a reasonable *business* is an arithmetic question, and we would rather publish the arithmetic than the vibe.

Here is the full cost of one issue, measured on our own runs, in the currency we actually pay.

## Cost of goods, per issue

| Line item | Cost | Notes |
| --- | --- | --- |
| Signal ingestion (x402, metered) | $0.18 | ~60 paid calls at ~$0.003 |
| Synthesis — \`claude-opus-5\` | $1.31 | ~52k input, ~6.5k output tokens |
| Scoring pass (subject lines, sentiment) | $0.09 | Short context, many candidates |
| Illustration — \`syndix-diffusion-v2\` | $0.22 | One cover, three rejected |
| IPFS pinning | $0.01 | ~40 KB markdown + metadata |
| Mint transaction (GIWA Sepolia) | <$0.01 | Dominated by the L1 data component |
| **Total COGS** | **~$1.82** | Excluding reward pool |

That number is small enough to be uninteresting, which is the point. The interesting number is the one below it.

## Cost of readers

We pay **0.00003 ETH** per reader who finishes an issue — about $0.10 at $3,200/ETH, or roughly ₩130. A pool sized for 1,200 claims commits **0.036 ETH**, about $115.

### The arithmetic

\`\`\`ts
const ETH_USD = 3200;
const perReaderWei = 30_000_000_000_000n;     // 0.00003 ETH
const poolCapacity = 1200n;

const poolWei = perReaderWei * poolCapacity;
const poolUsd = Number(poolWei) / 1e18 * ETH_USD;   // ≈ 115.20

const cogsUsd = 1.82;
const costPerReaderUsd = cogsUsd / Number(poolCapacity) + 0.096;
// ≈ $0.0975 — the editorial cost is noise; the reward is the business.
\`\`\`

So the model is not "AI makes content cheap." Generation is 1.6% of the cost of a fully-claimed issue. **Syndix is a customer-acquisition instrument that happens to produce journalism.** Every strategic question follows from that sentence.

## Where the money comes from

Three revenue lines, in ascending order of how much we trust them:

1. **Machine-readable feed access via x402.** Real, tiny, and growing. Metered per call. This is revenue with no salesperson attached, which makes it the most interesting line on the page even though it is currently the smallest.
2. **Sponsored issues.** A sponsor funds an issue's reward pool plus a premium. At $115 of rewards and ~$1.82 of production, a sponsor buying ~1,200 verified, attested humans who read to the end is paying well under typical crypto CAC — and *knows*, on-chain, exactly how many finished.
3. **Protocol fee on the reward flow.** Defensible only if the reader experience is good enough that people would claim anyway. Charge it too early and you have taxed your own distribution.

> The honest framing is that we sell attention that can be proven. Not impressions, not clicks — a distinct up.id holder who reached the end and signed for it. That receipt is the product; the article is the reason the receipt exists.

## What makes the receipt worth anything

Sybil resistance, and nothing else. GIWA's Upbit Web3 Names are one-per-wallet Soul-Bound Tokens issued to Dojang-verified addresses, so "1,200 claims" means something close to 1,200 humans. Take that away and the reward pool is a faucet, the sponsor is buying a script's attention, and the whole model collapses into the ad-tech fraud problem that has never been solved on the open web.

This is why we think the model is chain-specific rather than chain-agnostic. On most L2s the identity layer is an app you integrate. On GIWA it is a network primitive, and the difference shows up directly in what a sponsor will pay.

## The costs we are not counting

Being explicit, because unit-economics posts are usually a genre of lying:

- **Human editorial time.** Real, currently unpaid, and the reason the corpus is any good. A version of this with zero human review would be measurably worse and we would know it within four issues.
- **Failed runs.** Roughly one in seven pipeline runs is discarded on the scoring pass. Our COGS figure is per *shipped* issue; per *attempted* issue it is about 15% higher.
- **Contract deployment, audit and operations.** Not yet incurred, because Syndix is not deployed to a live network. When it is, an audit alone exceeds a year of generation costs at current volume.
- **Rewards that go unclaimed.** They return to the treasury, which flatters the numbers. Claim rate has run between 82% and 91% on testnet with no real money at stake — expect that to move in both directions once it is real.

## The number to watch

Not cost per issue. **Cost per verified finished read**, against what a sponsor pays for the same. Today that is roughly $0.0975 against a sponsor price we have not tested at scale, on a testnet, in an economy denominated in worthless ETH.

That is a demo, and we will keep calling it one. But the arithmetic works at a scale where the generation cost genuinely disappears, and that is a different — and more defensible — claim than "AI writes cheap articles."`;

/* ------------------------------------------------------------------ */
/*  Issues                                                             */
/* ------------------------------------------------------------------ */

export const ISSUES: Issue[] = [
  {
    id: 6,
    slug: "flashblocks-200ms-preconfirmations-consumer-apps",
    title: "Flashblocks: What 200ms Preconfirmations Change for Consumer Apps",
    standfirst:
      "GIWA streams preconfirmed sub-blocks under the standard `pending` tag. The upgrade is a transport URL — the hard part is admitting to your users which state they are looking at.",
    track: "giwa-l2",
    status: "published",
    publishedAt: "2026-07-29T08:00:00.000Z",
    readingMinutes: 5,
    contentURI:
      "ipfs://bafybeii2kf3efzdj2mgj4cf6i4dkmvjblvogjbf3co7usceutfloha3gk7",
    coverSeed: "giwa-flashblocks-preconf-0729",
    coverPrompt:
      "A one-second block dissolving into five stacked translucent slices, each offset by a hairline, over a deep indigo field crossed by a faint transaction graph.",
    body: BODY_6,
    executiveSummary: [
      "Flashblocks ride the standard `pending` block tag — no new RPC namespace, no SDK, just a second transport.",
      "Our own Seoul-region probe put preconfirmed inclusion at 150–250ms against ~1s for sealed blocks.",
      "Settlement, withdrawals and the L1 fee component are completely unchanged — this is a scheduling win, not a finality win.",
      "Run two clients: preconfirmed reads for the UI, sealed reads for anything that moves money.",
    ],
    score: {
      index: 94,
      subjectLine: "200ms is the number that decides if crypto feels like software",
      rejected: [
        { text: "GIWA Flashblocks explained: preconfirmations on an OP Stack L2", score: 71 },
        { text: "Your L2 is fast. Your UI is not.", score: 88 },
        { text: "Inside GIWA's 200ms preconfirmation endpoint", score: 79 },
      ],
      predictedOpenRate: 0.487,
      sentiment: "bullish",
    },
    signals: [
      {
        id: "s6-1",
        kind: "onchain",
        label: "Preconfirmation latency probe",
        detail:
          "1,842 samples of eth_getBlockByNumber('pending') against sepolia-rpc-flashblocks.giwa.io from a single Seoul host: p50 187ms, p95 244ms.",
        ref: "28943118",
        confidence: 93,
      },
      {
        id: "s6-2",
        kind: "onchain",
        label: "Sealed-block baseline",
        detail:
          "Matched control run against sepolia-rpc.giwa.io over the same window: p50 1,012ms to first receipt, p95 1,486ms.",
        ref: "28943106",
        confidence: 91,
      },
      {
        id: "s6-3",
        kind: "github",
        label: "Endpoint documented under the pending tag",
        detail:
          "Network docs list eth_getBlockByNumber, eth_call and eth_getTransactionReceipt as Flashblocks-aware via `pending`.",
        ref: "giwa-network/docs — network-information/rpc-endpoints.mdx",
        confidence: 88,
      },
      {
        id: "s6-4",
        kind: "social",
        label: "Builder confusion on preconf semantics",
        detail:
          "Repeated questions conflating preconfirmation with finality across GIWA developer channels — the misconception this issue targets.",
        ref: "https://docs.giwa.io/get-started/connect-to-giwa",
        confidence: 64,
      },
    ],
    rewardPoolWei: "36000000000000000",
    rewardPerReaderWei: "30000000000000",
    claimedCount: 704,
    readerCount: 862,
    mintTxHash:
      "0x18e738d79918dab34d85ed13794b602a9a087e11f34eb4a498710fe1d5df4067",
    mintBlock: 28944712,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 46820,
      inputTokens: 52140,
      outputTokens: 6480,
      costUsd: 1.8163,
      stages: [
        "ingest",
        "dedupe",
        "synthesize",
        "score",
        "illustrate",
        "pin",
        "mint",
      ],
    },
  },
  {
    id: 5,
    slug: "x402-agent-to-agent-payments-on-an-l2",
    title: "Machine Buyers: x402 and the Agent-to-Agent Payment Loop",
    standfirst:
      "HTTP 402 turns an agent into a customer. The settlement layer decides whether that customer is viable — and the identity layer decides whether it is one customer or ten thousand copies of one script.",
    track: "ai-web3-alpha",
    status: "minting",
    publishedAt: "2026-07-28T22:10:00.000Z",
    readingMinutes: 5,
    contentURI:
      "ipfs://bafybeiqajfanp7r2yxxohdqixrrbbttbstknq7rvzdfutqt3awqrqvthgm",
    coverSeed: "x402-machine-buyers-0728",
    coverPrompt:
      "Two agent nodes exchanging a payment token across a violet gradient, the handshake drawn as a closed loop of thin arcs over a sparse ledger grid.",
    body: BODY_5,
    executiveSummary: [
      "x402 makes an agent a customer: discover price, pay, receive — no API key, no session, no human.",
      "A $0.03 purchase only works where the fee is a rounding error; that is the entire argument for settling on an L2.",
      "`maxAmountRequired` authorises a ceiling and settles the actual cost, which is what metered machine work needs.",
      "Sybil resistance, not payments, is the unsolved half — and up.id's one-per-wallet SBT is the closest thing to an answer.",
    ],
    score: {
      index: 89,
      subjectLine: "Your next customer does not have a credit card, or a face",
      rejected: [
        { text: "x402 on GIWA: agent-to-agent payments explained", score: 68 },
        { text: "A machine bought this article for three cents", score: 84 },
      ],
      predictedOpenRate: 0.441,
      sentiment: "bullish",
    },
    signals: [
      {
        id: "s5-1",
        kind: "onchain",
        label: "Native-ETH settlement cost sample",
        detail:
          "312 simulated x402 settlements on GIWA Sepolia; L1 data component dominated total fee in every sample, execution gas was near-constant at 21k.",
        ref: "28937440",
        confidence: 86,
      },
      {
        id: "s5-2",
        kind: "github",
        label: "x402 scheme surface",
        detail:
          "Spec exposes `scheme`, `maxAmountRequired`, `maxTimeoutSeconds` and an opaque `extra` map — enough to express metered pricing without a session.",
        ref: "coinbase/x402 — specs/schemes/exact/README.md",
        confidence: 82,
      },
      {
        id: "s5-3",
        kind: "market",
        label: "Metered vs subscription spend",
        detail:
          "Our own ingestion spend fell from five fixed data subscriptions to ~60 paid calls per issue; per-issue data cost landed under the illustration pass.",
        ref: "https://syndix.xyz/api/x402/feed",
        confidence: 90,
      },
      {
        id: "s5-4",
        kind: "onchain",
        label: "up.id issuance is capped per wallet",
        detail:
          "Upbit Web3 Names are soul-bound ENS subdomains of up.id, one per wallet — the constraint a machine-buyer market needs on the seller side.",
        ref: "0x4200000000000000000000000000000000000021",
        confidence: 94,
      },
    ],
    rewardPoolWei: "24000000000000000",
    rewardPerReaderWei: "30000000000000",
    claimedCount: 0,
    readerCount: 168,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 61340,
      inputTokens: 47880,
      outputTokens: 6120,
      costUsd: 1.7016,
      stages: ["ingest", "dedupe", "synthesize", "score", "illustrate", "pin"],
    },
  },
  {
    id: 4,
    slug: "shipping-on-giwa-sepolia-foundry-predeploys-bridge",
    title: "Shipping on GIWA Sepolia: Foundry, Predeploys, and the Bridge Path",
    standfirst:
      "A build log: chain ID 91342, the eight predeploys you must never redeploy, Blockscout verification flags that actually work, and the withdrawal round trip nobody tests until a user does.",
    track: "dev-digest",
    status: "published",
    publishedAt: "2026-07-24T09:00:00.000Z",
    readingMinutes: 6,
    contentURI:
      "ipfs://bafybeiwcqz5mvpa6oqrwfaadnc6manprufudqnk5gl2tgmzlzwspjj3gef",
    coverSeed: "dev-digest-foundry-bridge-0724",
    coverPrompt:
      "An isometric wireframe bridge span rendered in cyan hairlines, contract addresses drifting as faint monospace glyphs beneath the deck.",
    body: BODY_4,
    executiveSummary: [
      "Chain ID is 91342 — the widely-copied 919 is wrong and will cost you an afternoon.",
      "Eight contracts are live at genesis, including both ERC-4337 EntryPoints and the EAS that backs Dojang.",
      "Verify with `--verifier blockscout` against the explorer's /api path; Etherscan-style flags fail confusingly.",
      "Calldata size, not opcode count, is your real fee lever — read it from the GasPriceOracle predeploy.",
    ],
    score: {
      index: 86,
      subjectLine: "Chain ID 91342, and seven other things the tutorials get wrong",
      rejected: [
        { text: "How to deploy a contract on GIWA Sepolia with Foundry", score: 62 },
        { text: "The GIWA predeploy list, annotated", score: 74 },
        { text: "Stop redeploying Multicall3", score: 81 },
      ],
      predictedOpenRate: 0.412,
      sentiment: "neutral",
    },
    signals: [
      {
        id: "s4-1",
        kind: "onchain",
        label: "Predeploy bytecode confirmed at genesis",
        detail:
          "eth_getCode returned non-empty for all eight predeploys at block 0 on GIWA Sepolia, including EntryPoint v0.6 and v0.7.",
        ref: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
        confidence: 97,
      },
      {
        id: "s4-2",
        kind: "github",
        label: "Duplicate Multicall3 deployments",
        detail:
          "Three separate testnet deployments of a Multicall3 clone observed in the trailing week — the predeploy is unused by those teams.",
        ref: "giwa-network/examples — foundry/README.md",
        confidence: 71,
      },
      {
        id: "s4-3",
        kind: "onchain",
        label: "L1 fee component share",
        detail:
          "GasPriceOracle.getL1Fee sampled across 400 blocks: L1 data cost accounted for 71–88% of total fee on a 68-byte call.",
        ref: "0x420000000000000000000000000000000000000F",
        confidence: 89,
      },
      {
        id: "s4-4",
        kind: "onchain",
        label: "Bridge deposit derivation time",
        detail:
          "Seven ETH deposits through the L1 OptimismPortal on Ethereum Sepolia appeared on L2 within a consistent, low-minutes window.",
        ref: "0x956962C34687A954e611A83619ABaA37Ce6bC78A",
        confidence: 84,
      },
      {
        id: "s4-5",
        kind: "social",
        label: "Verification flag confusion",
        detail:
          "Recurring reports of forge verify-contract failures caused by Etherscan-style verifier flags against a Blockscout explorer.",
        ref: "https://sepolia-explorer.giwa.io",
        confidence: 66,
      },
    ],
    rewardPoolWei: "30000000000000000",
    rewardPerReaderWei: "25000000000000",
    claimedCount: 1141,
    readerCount: 1287,
    mintTxHash:
      "0xf27318adffeed09a975391068f27dca69a2ffb19ce5e7fa0e209dc75e3f18311",
    mintBlock: 28513004,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 71260,
      inputTokens: 58920,
      outputTokens: 7340,
      costUsd: 2.1024,
      stages: [
        "ingest",
        "dedupe",
        "synthesize",
        "score",
        "illustrate",
        "pin",
        "mint",
      ],
    },
  },
  {
    id: 3,
    slug: "up-id-dojang-sybil-resistance-primitive",
    title: "One Wallet, One Name: up.id and Dojang as Sybil Resistance",
    standfirst:
      "Soul-bound ENS subdomains issued against EAS attestations, capped at one per wallet. It is the most underrated thing GIWA ships — and it is permissioned, which is the part nobody wants to say out loud.",
    track: "giwa-l2",
    status: "published",
    publishedAt: "2026-07-20T08:30:00.000Z",
    readingMinutes: 6,
    contentURI:
      "ipfs://bafybeiexyjezwiaa7qivieevmywjtfiydjpex6t4y5rdmwvp3qp3hosiiq",
    coverSeed: "upid-dojang-sybil-0720",
    coverPrompt:
      "A single illuminated node in a dense lattice of identical dim nodes, a soul-bound seal ring drawn around it in accent blue.",
    body: BODY_3,
    executiveSummary: [
      "`username.up.id` are ENS subdomains issued as Soul-Bound Tokens — one per wallet, non-transferable by construction.",
      "Dojang writes four unbundled attestation types through the EAS predeploy at 0x42…0021.",
      "Gate the scarce action, not the whole app: reading is open, claiming needs an up.id, sponsoring needs an attestation.",
      "The cost is real centralisation — Upbit Korea is the primary issuer, and anything gated on it inherits that.",
    ],
    score: {
      index: 91,
      subjectLine: "The for-loop that eats every rewards protocol, and GIWA's answer",
      rejected: [
        { text: "up.id and Dojang: GIWA's identity stack explained", score: 66 },
        { text: "Sybil resistance is a network primitive now", score: 83 },
      ],
      predictedOpenRate: 0.463,
      sentiment: "cautious",
    },
    signals: [
      {
        id: "s3-1",
        kind: "onchain",
        label: "EAS predeploy live at genesis",
        detail:
          "Ethereum Attestation Service confirmed at the OP Stack canonical predeploy address; Dojang attestations resolve through it.",
        ref: "0x4200000000000000000000000000000000000021",
        confidence: 96,
      },
      {
        id: "s3-2",
        kind: "governance",
        label: "Four attestation types, deliberately unbundled",
        detail:
          "Verified Address, Balance Root, Verified Balance and Verified Code are separate schemas rather than one KYC flag — a real design decision.",
        ref: "https://docs.giwa.io/giwa-ecosystem/dojang",
        confidence: 92,
      },
      {
        id: "s3-3",
        kind: "onchain",
        label: "Soul-bound: no transfer path",
        detail:
          "up.id name tokens expose no transfer entrypoint, so a name cannot be bought, rented or bundled into a wallet sale.",
        ref: "28168004",
        confidence: 90,
      },
      {
        id: "s3-4",
        kind: "social",
        label: "Persistent giwa.id misnaming",
        detail:
          "Secondhand write-ups repeatedly call the namespace giwa.id. It is up.id; there is no giwa.id. Worth correcting in print.",
        ref: "https://docs.giwa.io/giwa-ecosystem/upbit-web3-names",
        confidence: 74,
      },
    ],
    rewardPoolWei: "36000000000000000",
    rewardPerReaderWei: "30000000000000",
    claimedCount: 1176,
    readerCount: 1342,
    mintTxHash:
      "0xbd020f5fc7ae40340741d71f0c82e1ac5a1279f014864f81d3006f296933ee58",
    mintBlock: 28167486,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 68410,
      inputTokens: 55340,
      outputTokens: 7020,
      costUsd: 1.9800,
      stages: [
        "ingest",
        "dedupe",
        "synthesize",
        "score",
        "illustrate",
        "pin",
        "mint",
      ],
    },
  },
  {
    id: 2,
    slug: "sponsored-gasless-by-default-4337-paymasters-giwa",
    title: "Sponsored: Gasless by Default — Building 4337 Paymasters on GIWA",
    standfirst:
      "Paid placement by Marunode, disclosed at the top of the body. There is no first-party GIWA paymaster: the chain predeploys both EntryPoints and hands you the policy problem.",
    track: "sponsorship",
    status: "published",
    publishedAt: "2026-07-15T07:45:00.000Z",
    readingMinutes: 5,
    contentURI:
      "ipfs://bafybeikwyktlfer4lqmndnhyxn2x23ijfiuaddbv7aigyfyzafc7wtvt4r",
    coverSeed: "sponsored-paymaster-4337-0715",
    coverPrompt:
      "A green-lit meter dial fused with a contract seal, gas glyphs draining upward into a policy gate rendered as a hairline aperture.",
    body: BODY_2,
    executiveSummary: [
      "GIWA has no first-party paymaster product — it predeploys EntryPoint v0.6 and v0.7 and stops there.",
      "A paymaster that approves any well-formed call against your contract is a faucet; policy is the entire product.",
      "Budget against the L1 data component from the GasPriceOracle, not L2 gas — it moves with Ethereum, not with GIWA.",
      "Disclosure: Marunode paid for placement and had no editorial control. No endorsement of their infrastructure is implied.",
    ],
    score: {
      index: 82,
      subjectLine: "GIWA does not pay your gas. Here is who does.",
      rejected: [
        { text: "Sponsored: build an ERC-4337 paymaster on GIWA", score: 58 },
        { text: "Your paymaster is a faucet and you have not noticed", score: 79 },
      ],
      predictedOpenRate: 0.376,
      sentiment: "neutral",
    },
    signals: [
      {
        id: "s2-1",
        kind: "onchain",
        label: "Both EntryPoints predeployed",
        detail:
          "v0.7 and v0.6 both return code on GIWA Sepolia at the canonical cross-chain addresses — no factory deployment needed.",
        ref: "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789",
        confidence: 97,
      },
      {
        id: "s2-2",
        kind: "governance",
        label: "No first-party paymaster in network docs",
        detail:
          "Contract listings cover predeploys and the L1 bridge set; no sponsored-gas service appears anywhere in them.",
        ref: "https://docs.giwa.io/network-information/contracts",
        confidence: 93,
      },
      {
        id: "s2-3",
        kind: "market",
        label: "Sponsorship deposit received",
        detail:
          "Marunode funded this issue's reward pool plus a placement premium. Terms disclosed in the body; simulated in this build.",
        ref: "0x2f2992ca25cac36095530044c3cafe607eb37f024fb13015147ee82c028a5842",
        confidence: 100,
      },
      {
        id: "s2-4",
        kind: "onchain",
        label: "L1 fee volatility window",
        detail:
          "Across 1,000 sampled blocks the L1 data component varied by a factor of 4.2 — the range a paymaster cap has to survive.",
        ref: "27734880",
        confidence: 87,
      },
    ],
    rewardPoolWei: "54000000000000000",
    rewardPerReaderWei: "45000000000000",
    claimedCount: 1188,
    readerCount: 1394,
    mintTxHash:
      "0x2718f34d077ef67bcebc0e90e3c57fe7c3b8c30eaa4b64a95ff848680ac2f450",
    mintBlock: 27735390,
    sponsor: MARUNODE,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 39750,
      inputTokens: 44210,
      outputTokens: 6640,
      costUsd: 1.6432,
      stages: [
        "ingest",
        "dedupe",
        "synthesize",
        "score",
        "illustrate",
        "pin",
        "mint",
      ],
    },
  },
  {
    id: 1,
    slug: "autonomous-newsroom-unit-economics",
    title: "What an Autonomous Newsroom Actually Costs",
    standfirst:
      "Generation is 1.6% of the cost of a fully-claimed issue. Everything else is the reward pool — which makes this a customer-acquisition instrument that happens to produce journalism.",
    track: "ai-web3-alpha",
    status: "published",
    publishedAt: "2026-07-10T08:00:00.000Z",
    readingMinutes: 5,
    contentURI:
      "ipfs://bafybei5owzevfmu2uaxbrpbetd7hnrygv3fuondzbwrq3w5stqonnbrr2c",
    coverSeed: "newsroom-unit-economics-0710",
    coverPrompt:
      "A ledger of thin horizontal rules where one line is dramatically thicker than the rest, violet light pooling beneath the outlier.",
    body: BODY_1,
    executiveSummary: [
      "Full production cost per shipped issue: ~$1.82, against ~$115 of reader rewards at a 1,200-claim pool.",
      "The product is a provable receipt — a distinct up.id holder who finished and signed — not the article.",
      "Three revenue lines: metered x402 feed access, sponsored issues, and a protocol fee we think is premature.",
      "Uncounted: human editorial time, ~1 in 7 discarded runs, audits, and the flattering effect of unclaimed rewards.",
    ],
    score: {
      index: 78,
      subjectLine: "We published our own P&L. Generation was 1.6% of it.",
      rejected: [
        { text: "The unit economics of an AI newsroom", score: 55 },
        { text: "It costs $1.82 to write this newsletter", score: 73 },
      ],
      predictedOpenRate: 0.354,
      sentiment: "cautious",
    },
    signals: [
      {
        id: "s1-1",
        kind: "market",
        label: "Per-run generation accounting",
        detail:
          "Token counts and image costs aggregated across 34 pipeline runs, of which 29 shipped — the 15% failure premium comes from here.",
        ref: "https://syndix.xyz/api/stats",
        confidence: 95,
      },
      {
        id: "s1-2",
        kind: "onchain",
        label: "Claim rate on testnet",
        detail:
          "Claim-to-finished-read ratio ranged 82–91% across the archive. No real value at stake, so treat it as an upper bound on nothing.",
        ref: "27303488",
        confidence: 79,
      },
      {
        id: "s1-3",
        kind: "onchain",
        label: "Mint cost is negligible",
        detail:
          "Issue mints on GIWA Sepolia stayed under a cent equivalent, dominated by the L1 data component rather than execution gas.",
        ref: "0xcc3e1cda743e22574b70d92d76d2d125f07b9f1f7f35ce68d898034348326635",
        confidence: 92,
      },
      {
        id: "s1-4",
        kind: "governance",
        label: "Protocol fee deferred",
        detail:
          "Treasury policy currently takes zero fee on the reward flow; taxing distribution before the reader experience is proven was rejected.",
        ref: "https://docs.giwa.io/giwa-ecosystem",
        confidence: 70,
      },
    ],
    rewardPoolWei: "28750000000000000",
    rewardPerReaderWei: "25000000000000",
    claimedCount: 1102,
    readerCount: 1268,
    mintTxHash:
      "0xcc3e1cda743e22574b70d92d76d2d125f07b9f1f7f35ce68d898034348326635",
    mintBlock: 27303492,
    generation: {
      model: "claude-opus-5",
      imageModel: "syndix-diffusion-v2",
      latencyMs: 33180,
      inputTokens: 41060,
      outputTokens: 5880,
      costUsd: 1.5099,
      stages: [
        "ingest",
        "dedupe",
        "synthesize",
        "score",
        "illustrate",
        "pin",
        "mint",
      ],
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export function getIssue(idOrSlug: string | number): Issue | undefined {
  if (typeof idOrSlug === "number") {
    return ISSUES.find((issue) => issue.id === idOrSlug);
  }
  const key = idOrSlug.trim().toLowerCase();
  const numeric = Number(key);
  if (key !== "" && Number.isInteger(numeric)) {
    const byId = ISSUES.find((issue) => issue.id === numeric);
    if (byId) return byId;
  }
  return ISSUES.find((issue) => issue.slug === key);
}

export function listIssues(track?: TrackId): Issue[] {
  if (!track) return ISSUES;
  return ISSUES.filter((issue) => issue.track === track);
}
