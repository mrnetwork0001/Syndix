// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IReaderRegistry} from "./interfaces/IReaderRegistry.sol";

/**
 * @title SyndixStableTreasury
 * @notice SyndixTreasury denominated in an ERC-20 rather than ETH, for GIWA's
 *         forthcoming KRW stablecoin.
 *
 * @dev WHY THIS EXISTS
 *
 *      Syndix promises readers a "100 KRW micro-reward". Paid in ETH that is a
 *      lie by omission: 0.00003 ETH was worth about ₩132 when the figure was
 *      chosen and about ₩83 a few weeks later. The reader cannot predict what
 *      they will receive, and the headline number drifts with a market they did
 *      not opt into.
 *
 *      Denominating in a KRW stablecoin makes the promise exact. ₩100 is ₩100.
 *
 *      WHAT CHANGED FROM SyndixTreasury
 *
 *      The three invariants are unchanged in shape, which is the point — this is
 *      the same contract with a different value primitive:
 *        - Solvency:  token.balanceOf(this) >= reservedRewards
 *                     (was address(this).balance >= reservedRewards)
 *        - Sybil:     identical, via IReaderRegistry
 *        - Read proof: identical EIP-712 ReadProof
 *
 *      Mechanically:
 *        - `publishArticle` is no longer `payable`; the publisher approves and
 *          the contract pulls with `safeTransferFrom`.
 *        - Payouts use `safeTransfer` instead of a value call, so the 4337 /
 *          Safe recipient concern that forced `.call` in the ETH version does
 *          not apply — ERC-20 transfers do not invoke recipient code.
 *        - There is no `receive()`. A stray ETH transfer here would be stuck, so
 *          the contract simply cannot accept one.
 *
 *      NOT DEPLOYED. GIWA's KRW stablecoin does not exist yet, so there is no
 *      token to point this at. It is written and tested against a mock so the
 *      migration path is concrete rather than asserted.
 */
contract SyndixStableTreasury is Ownable, ReentrancyGuard, EIP712 {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    struct Article {
        uint256 id;
        string title;
        string contentURI;
        uint128 rewardPool;
        uint128 rewardPerReader;
        uint128 totalClaimed;
        uint64 publishedAt;
        bool isActive;
    }

    /**
     * @dev Identical to SyndixTreasury's typehash. Deliberate: an attester can
     *      sign one ReadProof shape regardless of which treasury settles it, so
     *      the API needs no per-treasury branch.
     */
    bytes32 private constant READ_PROOF_TYPEHASH = keccak256(
        "ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)"
    );

    /// @notice The reward token. Immutable — changing it mid-flight would
    ///         orphan every reserved balance already accounted in it.
    IERC20 public immutable rewardToken;

    uint256 public articleCount;
    uint256 public totalProtocolVolume;
    uint256 public totalRewardDistributed;
    uint256 public reservedRewards;
    uint256 public uniqueReaders;

    uint32 public minDwellSeconds = 20;
    address public readAttester;
    IReaderRegistry public readerRegistry;
    bool public requireVerifiedReader = true;

    mapping(uint256 articleId => Article) public articles;
    mapping(uint256 articleId => mapping(address reader => bool)) public hasClaimedReward;
    mapping(address reader => bool) public hasEverClaimed;
    mapping(address reader => string) public readerIdentity;

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
    event SponsorshipDeposited(address indexed sponsor, uint256 amount, string memo);
    event TreasuryWithdrawn(address indexed to, uint256 amount);

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
    error ZeroAddress();

    constructor(
        address initialOwner,
        IERC20 rewardToken_,
        address attester,
        IReaderRegistry registry
    ) Ownable(initialOwner) EIP712("Syndix", "1") {
        if (attester == address(0)) revert ZeroAddress();
        if (address(rewardToken_) == address(0)) revert ZeroAddress();
        rewardToken = rewardToken_;
        readAttester = attester;
        readerRegistry = registry;
        if (address(registry) == address(0)) requireVerifiedReader = false;
    }

    /* ------------------------------------------------------------------ */
    /*  Publishing                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Publish an issue and fund its pool.
     * @dev Caller must `approve` at least `rewardPool` first. Pulling rather
     *      than receiving is what replaces `payable`.
     */
    function publishArticle(
        string calldata title,
        string calldata contentURI,
        uint128 rewardPool,
        uint128 rewardPerReader
    ) external onlyOwner returns (uint256 id) {
        if (rewardPool == 0) revert EmptyRewardPool();
        if (rewardPerReader == 0 || rewardPerReader > rewardPool) {
            revert InvalidRewardPerReader();
        }

        id = ++articleCount;
        articles[id] = Article({
            id: id,
            title: title,
            contentURI: contentURI,
            rewardPool: rewardPool,
            rewardPerReader: rewardPerReader,
            totalClaimed: 0,
            publishedAt: uint64(block.timestamp),
            isActive: true
        });

        totalProtocolVolume += rewardPool;
        reservedRewards += rewardPool;

        // Pull last: reserves are only credited against tokens actually held.
        rewardToken.safeTransferFrom(msg.sender, address(this), rewardPool);

        emit ArticlePublished(id, title, contentURI, rewardPool, rewardPerReader);
    }

    function closeArticle(uint256 articleId) external onlyOwner {
        Article storage article = _get(articleId);
        if (!article.isActive) revert ArticleInactive();

        article.isActive = false;
        uint256 unspent = article.rewardPool - article.totalClaimed;
        reservedRewards -= unspent;

        emit ArticleClosed(articleId, unspent);
    }

    /* ------------------------------------------------------------------ */
    /*  Reader rewards                                                    */
    /* ------------------------------------------------------------------ */

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

        rewardToken.safeTransfer(msg.sender, amount);

        emit RewardClaimed(articleId, msg.sender, identity, amount);
    }

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
    /*  Treasury                                                          */
    /* ------------------------------------------------------------------ */

    function depositSponsorship(uint256 amount, string calldata memo) external {
        if (amount == 0) revert EmptyRewardPool();
        totalProtocolVolume += amount;
        rewardToken.safeTransferFrom(msg.sender, address(this), amount);
        emit SponsorshipDeposited(msg.sender, amount, memo);
    }

    /// @notice Token balance the owner may withdraw without breaking a promise.
    function unreservedBalance() public view returns (uint256) {
        uint256 balance = rewardToken.balanceOf(address(this));
        uint256 reserved = reservedRewards;
        return balance > reserved ? balance - reserved : 0;
    }

    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        uint256 available = unreservedBalance();
        if (amount > available) revert InsufficientUnreservedBalance(amount, available);
        rewardToken.safeTransfer(to, amount);
        emit TreasuryWithdrawn(to, amount);
    }

    /* ------------------------------------------------------------------ */
    /*  Admin                                                             */
    /* ------------------------------------------------------------------ */

    function setReadAttester(address attester) external onlyOwner {
        if (attester == address(0)) revert ZeroAddress();
        readAttester = attester;
    }

    function setReaderRegistry(IReaderRegistry registry) external onlyOwner {
        readerRegistry = registry;
    }

    function setRequireVerifiedReader(bool required) external onlyOwner {
        if (required && address(readerRegistry) == address(0)) revert ZeroAddress();
        requireVerifiedReader = required;
    }

    function setMinDwellSeconds(uint32 seconds_) external onlyOwner {
        minDwellSeconds = seconds_;
    }

    /* ------------------------------------------------------------------ */
    /*  Views                                                             */
    /* ------------------------------------------------------------------ */

    function getArticle(uint256 articleId) external view returns (Article memory) {
        return _get(articleId);
    }

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
            page[i - offset] = articles[i + 1];
        }
    }

    function remainingClaims(uint256 articleId) external view returns (uint256) {
        Article storage article = articles[articleId];
        if (article.id == 0 || !article.isActive || article.rewardPerReader == 0) return 0;
        return (article.rewardPool - article.totalClaimed) / article.rewardPerReader;
    }

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

    function _assertVerified(address reader) private view returns (string memory) {
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
        return _hashTypedDataV4(
            keccak256(
                abi.encode(READ_PROOF_TYPEHASH, articleId, reader, dwellSeconds, deadline)
            )
        );
    }
}
