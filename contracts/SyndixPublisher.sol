// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISyndixTreasuryOwner {
    function publishArticle(
        string calldata title,
        string calldata contentURI,
        uint128 rewardPerReader
    ) external payable returns (uint256 id);

    function topUpArticle(uint256 articleId) external payable;

    function transferOwnership(address newOwner) external;

    function owner() external view returns (address);
}

/**
 * @title SyndixPublisher
 * @notice Lets an unattended agent publish issues without holding a key that
 *         can loot the treasury.
 *
 * @dev THE PROBLEM
 *
 *      `SyndixTreasury.publishArticle` is `onlyOwner`, and so is
 *      `withdrawTreasury`, `setReadAttester`, `setReaderRegistry` and
 *      `setMinDwellSeconds`. Running the newsroom on a schedule therefore means
 *      putting a key on a server, and with one role that key can drain the
 *      unreserved balance, forge read proofs by swapping the attester, or
 *      disable the sybil gate entirely. Autonomy bought that way costs every
 *      security property the protocol advertises.
 *
 *      THE SPLIT
 *
 *      This contract takes ownership of the treasury and re-exposes it as two
 *      roles:
 *
 *        owner     - a cold wallet. Full passthrough via `execute`, plus
 *                    `recoverTreasuryOwnership` to walk away from this contract
 *                    entirely.
 *        publisher - the server key. `publish` and `topUp` only, bounded by a
 *                    per-article pool cap and a rolling daily publish count.
 *
 *      The publisher can move ETH *into* reward pools and nowhere else. There
 *      is deliberately no path from `onlyPublisher` to a withdrawal, a config
 *      change, or an article closure. Worst case on a compromised server is
 *      junk articles funded from this contract's balance until the daily cap
 *      trips - bounded, visible on chain, and reversible by rotating the
 *      publisher.
 *
 *      Reader funds are never at risk regardless: the treasury's own solvency
 *      invariant keeps `reservedRewards` unreachable by its owner, which
 *      includes this contract.
 *
 *      FUNDING
 *
 *      Hold the pool ETH here, not on the server. The publisher key then needs
 *      only gas, so its balance is not worth stealing.
 */
contract SyndixPublisher is Ownable, ReentrancyGuard {
    ISyndixTreasuryOwner public immutable treasury;

    /// @notice The automation key. Publishing only.
    address public publisher;

    /// @notice Largest reward pool the publisher may fund in one article.
    uint128 public maxPoolPerArticle;

    /// @notice Publishes allowed per rolling 24h window.
    uint32 public maxPublishesPerDay;

    /// @notice Start of the current window, unix seconds.
    uint64 public windowStart;

    /// @notice Publishes recorded in the current window.
    uint32 public publishedInWindow;

    event PublisherChanged(address indexed previous, address indexed next);
    event LimitsChanged(uint128 maxPoolPerArticle, uint32 maxPublishesPerDay);
    event AutoPublished(uint256 indexed articleId, uint256 pool, address indexed by);
    event TreasuryOwnershipRecovered(address indexed to);
    event Funded(address indexed from, uint256 amount);

    error NotPublisher();
    error ZeroAddress();
    error PoolTooLarge(uint256 requested, uint128 cap);
    error DailyLimitReached(uint32 cap);
    error InsufficientBalance(uint256 requested, uint256 available);
    error EmptyPool();
    error CallFailed();

    modifier onlyPublisher() {
        if (msg.sender != publisher) revert NotPublisher();
        _;
    }

    constructor(
        address initialOwner,
        ISyndixTreasuryOwner treasury_,
        address publisher_,
        uint128 maxPoolPerArticle_,
        uint32 maxPublishesPerDay_
    ) Ownable(initialOwner) {
        if (address(treasury_) == address(0)) revert ZeroAddress();
        treasury = treasury_;
        publisher = publisher_;
        maxPoolPerArticle = maxPoolPerArticle_;
        maxPublishesPerDay = maxPublishesPerDay_;
        windowStart = uint64(block.timestamp);
    }

    /* ------------------------------------------------------------------ */
    /*  Publisher - the only automated surface                            */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Publishes an issue, funding its pool from this contract.
     * @dev Every bound is checked here rather than trusted from the caller,
     *      because the caller is a script on a server.
     */
    function publish(
        string calldata title,
        string calldata contentURI,
        uint128 rewardPerReader,
        uint256 pool
    ) external onlyPublisher nonReentrant returns (uint256 articleId) {
        if (pool == 0) revert EmptyPool();
        if (pool > maxPoolPerArticle) revert PoolTooLarge(pool, maxPoolPerArticle);
        if (pool > address(this).balance) {
            revert InsufficientBalance(pool, address(this).balance);
        }

        _consumeDailyAllowance();

        articleId = treasury.publishArticle{value: pool}(
            title, contentURI, rewardPerReader
        );
        emit AutoPublished(articleId, pool, msg.sender);
    }

    /**
     * @notice Adds to an existing article's pool.
     * @dev Also counts against the daily allowance. A top-up spends from the
     *      same balance as a publish, so exempting it would leave a hole the
     *      size of the cap.
     */
    function topUp(uint256 articleId, uint256 amount) external onlyPublisher nonReentrant {
        if (amount == 0) revert EmptyPool();
        if (amount > maxPoolPerArticle) revert PoolTooLarge(amount, maxPoolPerArticle);
        if (amount > address(this).balance) {
            revert InsufficientBalance(amount, address(this).balance);
        }

        _consumeDailyAllowance();
        treasury.topUpArticle{value: amount}(articleId);
    }

    /// @dev Rolling window: the first publish after 24h idle starts a new one.
    function _consumeDailyAllowance() private {
        if (block.timestamp >= windowStart + 1 days) {
            windowStart = uint64(block.timestamp);
            publishedInWindow = 0;
        }
        if (publishedInWindow >= maxPublishesPerDay) {
            revert DailyLimitReached(maxPublishesPerDay);
        }
        unchecked {
            ++publishedInWindow;
        }
    }

    /// @notice Publishes left in the current window.
    function remainingToday() external view returns (uint32) {
        if (block.timestamp >= windowStart + 1 days) return maxPublishesPerDay;
        uint32 used = publishedInWindow;
        return used >= maxPublishesPerDay ? 0 : maxPublishesPerDay - used;
    }

    /* ------------------------------------------------------------------ */
    /*  Owner                                                             */
    /* ------------------------------------------------------------------ */

    function setPublisher(address next) external onlyOwner {
        emit PublisherChanged(publisher, next);
        publisher = next;
    }

    function setLimits(uint128 poolCap, uint32 dailyCap) external onlyOwner {
        maxPoolPerArticle = poolCap;
        maxPublishesPerDay = dailyCap;
        emit LimitsChanged(poolCap, dailyCap);
    }

    /**
     * @notice Arbitrary owner-authority call against the treasury.
     * @dev This is what keeps the guard from narrowing what the owner can do.
     *      Every `onlyOwner` function on the treasury - withdrawals, attester
     *      and registry changes, closing an article - stays reachable through
     *      here, from the cold wallet only.
     */
    function execute(bytes calldata data)
        external
        payable
        onlyOwner
        nonReentrant
        returns (bytes memory)
    {
        (bool ok, bytes memory out) = address(treasury).call{value: msg.value}(data);
        if (!ok) {
            // Surface the treasury's own revert rather than a generic failure.
            if (out.length > 0) {
                assembly {
                    revert(add(out, 32), mload(out))
                }
            }
            revert CallFailed();
        }
        return out;
    }

    /**
     * @notice Hands treasury ownership back to an address the owner names.
     * @dev The escape hatch. If this contract turns out to be wrong, ownership
     *      leaves it in one transaction and the treasury is under direct EOA or
     *      multisig control again. Nothing here is a one-way door.
     */
    function recoverTreasuryOwnership(address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        treasury.transferOwnership(to);
        emit TreasuryOwnershipRecovered(to);
    }

    /// @notice Withdraws unspent pool funding held here. Owner only.
    function withdraw(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > address(this).balance) {
            revert InsufficientBalance(amount, address(this).balance);
        }
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert CallFailed();
    }

    /// @notice Funding for future reward pools.
    receive() external payable {
        emit Funded(msg.sender, msg.value);
    }
}
