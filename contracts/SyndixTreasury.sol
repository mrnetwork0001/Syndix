// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IReaderRegistry} from "./interfaces/IReaderRegistry.sol";

/**
 * @title SyndixTreasury
 * @notice Autonomous AI news syndicate treasury on GIWA (OP Stack L2).
 *         Holds sponsor deposits, funds per-issue reader reward pools, and
 *         settles gasless micro-rewards to verified GIWA readers.
 *
 * @dev Three properties this contract is built to guarantee:
 *
 *      1. SOLVENCY. Every wei promised to a reader is accounted in
 *         `reservedRewards` and is unreachable by the owner. `withdrawTreasury`
 *         can only move *unreserved* surplus. Without this, an owner withdrawal
 *         silently bricks every outstanding reader claim.
 *
 *      2. SYBIL RESISTANCE. Claims require a verified GIWA identity
 *         (`username.up.id` SBT, one per wallet) via `IReaderRegistry`. An
 *         address-only gate is not a gate — 1s blocks and sub-cent gas make
 *         mass wallet generation trivially profitable against a reward pool.
 *
 *      3. PROOF OF READ. The reward is for *reading*, so a claim must carry an
 *         EIP-712 attestation signed by the Syndix read-attester, issued only
 *         after the client reports genuine dwell time. The reader still submits
 *         the transaction (or a 4337 bundler does on their behalf), so the
 *         attester never custodies funds and cannot claim on a reader's behalf.
 */
contract SyndixTreasury is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;

    /* ------------------------------------------------------------------ */
    /*  Types                                                             */
    /* ------------------------------------------------------------------ */

    struct Article {
        uint256 id;
        string title;
        string contentURI; // ipfs:// or ar:// pointer to the markdown body
        uint128 rewardPool; // total wei earmarked for readers
        uint128 rewardPerReader; // wei paid per verified claim
        uint128 totalClaimed; // wei already paid out
        uint64 publishedAt;
        bool isActive;
    }

    /// @dev EIP-712 payload the read-attester signs once a reader completes an issue.
    bytes32 private constant READ_PROOF_TYPEHASH =
        keccak256(
            "ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)"
        );

    /* ------------------------------------------------------------------ */
    /*  Storage                                                           */
    /* ------------------------------------------------------------------ */

    uint256 public articleCount;

    /// @notice Lifetime wei that has entered the protocol (deposits + pools).
    uint256 public totalProtocolVolume;

    /// @notice Lifetime wei paid out to readers.
    uint256 public totalRewardDistributed;

    /**
     * @notice Wei currently owed to readers across all active articles.
     * @dev The solvency invariant this contract maintains at all times:
     *      `address(this).balance >= reservedRewards`.
     */
    uint256 public reservedRewards;

    /// @notice Distinct verified identities that have ever claimed.
    uint256 public uniqueReaders;

    /// @notice Minimum dwell time an attestation must certify. Guards lazy clients.
    uint32 public minDwellSeconds = 20;

    /// @notice Address whose signature validates a ReadProof.
    address public readAttester;

    /// @notice Identity gate. If unset, `requireVerifiedReader` must be false.
    IReaderRegistry public readerRegistry;

    /**
     * @notice Whether claims demand a verified GIWA identity.
     * @dev Deployed as `true`. The setter exists only so a fresh testnet can
     *      run demos before the up.id registry is wired — never disable on a
     *      pool holding real value.
     */
    bool public requireVerifiedReader = true;

    mapping(uint256 articleId => Article) public articles;
    mapping(uint256 articleId => mapping(address reader => bool)) public hasClaimedReward;
    mapping(address reader => bool) public hasEverClaimed;

    /// @notice Cached identity string at time of first claim, for display only.
    mapping(address reader => string) public readerIdentity;

    /* ------------------------------------------------------------------ */
    /*  Events                                                            */
    /* ------------------------------------------------------------------ */

    event ArticlePublished(
        uint256 indexed id,
        string title,
        string contentURI,
        uint256 rewardPool,
        uint256 rewardPerReader
    );
    event RewardClaimed(
        uint256 indexed articleId,
        address indexed reader,
        string identity,
        uint256 amount
    );
    event ArticleClosed(uint256 indexed articleId, uint256 unspentReturned);
    event ArticleToppedUp(uint256 indexed articleId, uint256 amount);
    event SponsorshipDeposited(address indexed sponsor, uint256 amount, string memo);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event ReadAttesterUpdated(address indexed previous, address indexed next);
    event ReaderRegistryUpdated(address indexed previous, address indexed next);
    event VerificationRequirementUpdated(bool required);
    event MinDwellUpdated(uint32 seconds_);

    /* ------------------------------------------------------------------ */
    /*  Errors                                                            */
    /* ------------------------------------------------------------------ */

    error EmptyRewardPool();
    error InvalidRewardPerReader();
    error ArticleNotFound();
    error ArticleInactive();
    error AlreadyClaimed();
    error PoolExhausted();
    error ReaderNotVerified();
    error AttesterNotSet();
    error InvalidAttestation();
    error AttestationExpired();
    error DwellTooShort();
    error InsufficientUnreservedBalance(uint256 requested, uint256 available);
    error TransferFailed();
    error ZeroAddress();

    /* ------------------------------------------------------------------ */
    /*  Construction                                                      */
    /* ------------------------------------------------------------------ */

    constructor(address initialOwner, address attester, IReaderRegistry registry)
        Ownable(initialOwner)
        EIP712("Syndix", "1")
    {
        if (attester == address(0)) revert ZeroAddress();
        readAttester = attester;
        readerRegistry = registry;
        if (address(registry) == address(0)) requireVerifiedReader = false;
    }

    /* ------------------------------------------------------------------ */
    /*  Publishing                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Publish an AI-generated issue and earmark its reader reward pool.
     * @dev The attached value is moved straight into `reservedRewards`, putting
     *      it beyond the owner's reach for as long as the article is active.
     */
    function publishArticle(
        string calldata title,
        string calldata contentURI,
        uint128 rewardPerReader
    ) external payable onlyOwner returns (uint256 id) {
        if (msg.value == 0) revert EmptyRewardPool();
        // Must fund at least one claim, and each claim must be non-zero —
        // otherwise the pool is either unusable or an infinite no-op claim.
        if (rewardPerReader == 0 || rewardPerReader > msg.value) {
            revert InvalidRewardPerReader();
        }

        id = ++articleCount;
        articles[id] = Article({
            id: id,
            title: title,
            contentURI: contentURI,
            rewardPool: uint128(msg.value),
            rewardPerReader: rewardPerReader,
            totalClaimed: 0,
            publishedAt: uint64(block.timestamp),
            isActive: true
        });

        totalProtocolVolume += msg.value;
        reservedRewards += msg.value;

        emit ArticlePublished(id, title, contentURI, msg.value, rewardPerReader);
    }

    /// @notice Add more reward budget to a live issue.
    function topUpArticle(uint256 articleId) external payable onlyOwner {
        Article storage article = _get(articleId);
        if (!article.isActive) revert ArticleInactive();
        if (msg.value == 0) revert EmptyRewardPool();

        article.rewardPool += uint128(msg.value);
        totalProtocolVolume += msg.value;
        reservedRewards += msg.value;

        emit ArticleToppedUp(articleId, msg.value);
    }

    /**
     * @notice Close an issue and release its unspent budget back to the
     *         withdrawable treasury.
     */
    function closeArticle(uint256 articleId) external onlyOwner {
        Article storage article = _get(articleId);
        if (!article.isActive) revert ArticleInactive();

        article.isActive = false;
        uint256 unspent = article.rewardPool - article.totalClaimed;
        // Un-reserve rather than transfer: the ETH is already in this contract.
        reservedRewards -= unspent;

        emit ArticleClosed(articleId, unspent);
    }

    /* ------------------------------------------------------------------ */
    /*  Reader rewards                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Claim the micro-reward for an issue you have actually read.
     * @param articleId    Issue being claimed.
     * @param dwellSeconds Reading time certified by the attester.
     * @param deadline     Attestation expiry (unix seconds).
     * @param signature    EIP-712 ReadProof signed by `readAttester`.
     *
     * @dev Ordering is deliberate: identity check, then proof check, then the
     *      claim flag, then state, and only then the external call. Combined
     *      with `nonReentrant` this is checks-effects-interactions with a
     *      belt-and-braces guard, because the recipient may be a smart
     *      account (ERC-4337 is predeployed on GIWA) whose `receive` runs
     *      arbitrary code.
     */
    function claimReaderReward(
        uint256 articleId,
        uint32 dwellSeconds,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant {
        Article storage article = _get(articleId);
        if (!article.isActive) revert ArticleInactive();
        if (hasClaimedReward[articleId][msg.sender]) revert AlreadyClaimed();

        string memory identity = _assertVerified(msg.sender);
        _assertReadProof(articleId, msg.sender, dwellSeconds, deadline, signature);

        uint128 amount = article.rewardPerReader;
        if (article.totalClaimed + amount > article.rewardPool) revert PoolExhausted();

        // --- effects ---
        hasClaimedReward[articleId][msg.sender] = true;
        article.totalClaimed += amount;
        totalRewardDistributed += amount;
        reservedRewards -= amount;

        if (!hasEverClaimed[msg.sender]) {
            hasEverClaimed[msg.sender] = true;
            unchecked {
                ++uniqueReaders;
            }
        }
        if (bytes(identity).length != 0) {
            readerIdentity[msg.sender] = identity;
        }

        // --- interaction ---
        (bool ok, ) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit RewardClaimed(articleId, msg.sender, identity, amount);
    }

    /// @notice Preview whether `reader` can currently claim `articleId`.
    function claimability(uint256 articleId, address reader)
        external
        view
        returns (bool claimable, string memory reason)
    {
        Article storage article = articles[articleId];
        if (article.id == 0) return (false, "unknown article");
        if (!article.isActive) return (false, "article closed");
        if (hasClaimedReward[articleId][reader]) return (false, "already claimed");
        if (article.totalClaimed + article.rewardPerReader > article.rewardPool) {
            return (false, "pool exhausted");
        }
        if (requireVerifiedReader) {
            IReaderRegistry registry = readerRegistry;
            if (address(registry) == address(0)) return (false, "registry unset");
            if (!registry.isVerified(reader)) return (false, "no verified up.id");
        }
        return (true, "");
    }

    /* ------------------------------------------------------------------ */
    /*  Sponsorship                                                       */
    /* ------------------------------------------------------------------ */

    /// @notice Fund the protocol treasury. Unreserved, so it can seed future issues.
    function depositSponsorship(string calldata memo) external payable {
        if (msg.value == 0) revert EmptyRewardPool();
        totalProtocolVolume += msg.value;
        emit SponsorshipDeposited(msg.sender, msg.value, memo);
    }

    /* ------------------------------------------------------------------ */
    /*  Treasury management                                               */
    /* ------------------------------------------------------------------ */

    /// @notice Wei the owner may withdraw without breaking any reader promise.
    function unreservedBalance() public view returns (uint256) {
        uint256 balance = address(this).balance;
        uint256 reserved = reservedRewards;
        // Defensive: never underflow if a selfdestruct-style edge case ever
        // leaves balance below reserves.
        return balance > reserved ? balance - reserved : 0;
    }

    /**
     * @notice Withdraw surplus treasury funds.
     * @dev The blueprint's version withdrew against the raw balance and used
     *      `.transfer`. Both are corrected here: reserves are excluded, and
     *      `.call` is used so a Safe or 4337 smart account can receive.
     */
    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = unreservedBalance();
        if (amount > available) revert InsufficientUnreservedBalance(amount, available);

        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit TreasuryWithdrawn(to, amount);
    }

    /* ------------------------------------------------------------------ */
    /*  Admin                                                             */
    /* ------------------------------------------------------------------ */

    function setReadAttester(address attester) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        emit ReadAttesterUpdated(readAttester, attester);
        readAttester = attester;
    }

    function setReaderRegistry(IReaderRegistry registry) external onlyOwner {
        emit ReaderRegistryUpdated(address(readerRegistry), address(registry));
        readerRegistry = registry;
    }

    function setRequireVerifiedReader(bool required) external onlyOwner {
        if (required && address(readerRegistry) == address(0)) revert ZeroAddress();
        requireVerifiedReader = required;
        emit VerificationRequirementUpdated(required);
    }

    function setMinDwellSeconds(uint32 seconds_) external onlyOwner {
        minDwellSeconds = seconds_;
        emit MinDwellUpdated(seconds_);
    }

    /* ------------------------------------------------------------------ */
    /*  Views                                                             */
    /* ------------------------------------------------------------------ */

    function getArticle(uint256 articleId) external view returns (Article memory) {
        return _get(articleId);
    }

    /// @notice Paginated read so the frontend can hydrate the feed in one call.
    function listArticles(uint256 offset, uint256 limit)
        external
        view
        returns (Article[] memory page)
    {
        uint256 total = articleCount;
        if (offset >= total) return new Article[](0);
        uint256 end = offset + limit;
        if (end > total) end = total;

        page = new Article[](end - offset);
        for (uint256 i = offset; i < end; ++i) {
            // Article ids are 1-indexed.
            page[i - offset] = articles[i + 1];
        }
    }

    function remainingClaims(uint256 articleId) external view returns (uint256) {
        Article storage article = articles[articleId];
        if (article.id == 0 || !article.isActive || article.rewardPerReader == 0) return 0;
        return (article.rewardPool - article.totalClaimed) / article.rewardPerReader;
    }

    /// @notice EIP-712 digest a client can pre-compute to request an attestation.
    function readProofDigest(
        uint256 articleId,
        address reader,
        uint32 dwellSeconds,
        uint256 deadline
    ) external view returns (bytes32) {
        return _readProofDigest(articleId, reader, dwellSeconds, deadline);
    }

    /* ------------------------------------------------------------------ */
    /*  Internals                                                         */
    /* ------------------------------------------------------------------ */

    function _get(uint256 articleId) private view returns (Article storage article) {
        article = articles[articleId];
        if (article.id == 0) revert ArticleNotFound();
    }

    function _assertVerified(address reader) private view returns (string memory identity) {
        if (!requireVerifiedReader) return "";

        IReaderRegistry registry = readerRegistry;
        if (address(registry) == address(0)) revert ReaderNotVerified();
        if (!registry.isVerified(reader)) revert ReaderNotVerified();
        return registry.nameOf(reader);
    }

    function _assertReadProof(
        uint256 articleId,
        address reader,
        uint32 dwellSeconds,
        uint256 deadline,
        bytes calldata signature
    ) private view {
        address attester = readAttester;
        if (attester == address(0)) revert AttesterNotSet();
        if (block.timestamp > deadline) revert AttestationExpired();
        if (dwellSeconds < minDwellSeconds) revert DwellTooShort();

        bytes32 digest = _readProofDigest(articleId, reader, dwellSeconds, deadline);
        (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
        if (err != ECDSA.RecoverError.NoError || recovered != attester) {
            revert InvalidAttestation();
        }
    }

    function _readProofDigest(
        uint256 articleId,
        address reader,
        uint32 dwellSeconds,
        uint256 deadline
    ) private view returns (bytes32) {
        return
            _hashTypedDataV4(
                keccak256(
                    abi.encode(READ_PROOF_TYPEHASH, articleId, reader, dwellSeconds, deadline)
                )
            );
    }

    /* ------------------------------------------------------------------ */
    /*  Receive                                                           */
    /* ------------------------------------------------------------------ */

    /// @notice Bare transfers count as unreserved sponsorship.
    receive() external payable {
        totalProtocolVolume += msg.value;
        emit SponsorshipDeposited(msg.sender, msg.value, "");
    }
}
