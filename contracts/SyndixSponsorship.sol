// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISponsorshipSink {
    function depositSponsorship(string calldata memo) external payable;
}

/**
 * @title SyndixSponsorship
 * @notice Takes sponsor money, keeps the protocol's cut, and makes the rest
 *         unreachable by anyone but readers.
 *
 * @dev THE BUSINESS MODEL, AS CODE
 *
 *      Syndix does not invent money to pay readers. It redirects the
 *      advertising budget one step further down the chain: today an advertiser
 *      pays a publisher to harvest a reader's attention and the reader gets
 *      nothing, and here the sponsor's money lands in the reader's wallet while
 *      the protocol takes a fee for running the newsroom.
 *
 *      `SyndixTreasury.depositSponsorship` already accepts funding, but every
 *      wei of it lands in the unreserved balance, which the owner may withdraw.
 *      Nothing is earmarked. A sponsor funding reader rewards has to trust that
 *      we will not simply take it back, and nothing is set aside to run the
 *      newsroom either. This contract fixes both ends of that.
 *
 *      THE SPLIT
 *
 *      Each deposit is divided once, at deposit time:
 *
 *        accruedFees - `protocolFeeBps` of the deposit. Operating revenue, and
 *                      the only money the owner can withdraw from here.
 *        committed   - the remainder. Earmarked for reader rewards, and there
 *                      is deliberately no function that sends it anywhere
 *                      except into the treasury.
 *
 *      WHY THAT MATTERS MORE THAN THE FEE
 *
 *      A sponsor can verify, before paying, that the non-fee portion of their
 *      money cannot be pocketed: `fundTreasury` is the only path out of
 *      `committed`, it is permissionless, and its destination is immutable. The
 *      guarantee is checkable rather than promised, which is the same argument
 *      the treasury's solvency invariant makes to readers.
 *
 *      Deployed separately rather than folded into SyndixTreasury, because the
 *      treasury is live and verified on the GIWA explorer. Editing it would
 *      mean the repository no longer reproduces the deployed bytecode. This
 *      composes with the treasury exactly as deployed.
 */
contract SyndixSponsorship is Ownable, ReentrancyGuard {
    /// @notice Where committed funds may go. The only destination, fixed at deploy.
    ISponsorshipSink public immutable treasury;

    /**
     * @notice Protocol cut of each new deposit, in basis points.
     * @dev Applied at deposit time, so a later change can never reach money
     *      already committed to readers.
     */
    uint16 public protocolFeeBps;

    /// @notice Operating revenue. The only balance the owner may withdraw.
    uint256 public accruedFees;

    /// @notice Earmarked for reader rewards. No path out except the treasury.
    uint256 public committed;

    /// @notice Lifetime totals, for the public record.
    uint256 public totalSponsored;
    uint256 public totalForwarded;

    /**
     * @notice Hard ceiling on the fee, 30%.
     * @dev A constant rather than an owner-settable bound. An owner who can
     *      raise their own ceiling does not have one, and the whole point of
     *      this contract is that a sponsor can check the rules before paying.
     */
    uint16 public constant MAX_FEE_BPS = 3_000;

    uint16 private constant BPS_DENOMINATOR = 10_000;

    event Sponsored(
        address indexed sponsor,
        uint256 total,
        uint256 fee,
        uint256 toReaders,
        string memo
    );
    event ForwardedToTreasury(uint256 amount, address indexed by);
    event FeesWithdrawn(address indexed to, uint256 amount);
    event ProtocolFeeChanged(uint16 previousBps, uint16 nextBps);

    error ZeroAddress();
    error EmptyDeposit();
    error FeeTooHigh(uint16 requested, uint16 maximum);
    error InsufficientCommitted(uint256 requested, uint256 available);
    error InsufficientFees(uint256 requested, uint256 available);
    error TransferFailed();

    constructor(
        address initialOwner,
        ISponsorshipSink treasury_,
        uint16 protocolFeeBps_
    ) Ownable(initialOwner) {
        if (address(treasury_) == address(0)) revert ZeroAddress();
        if (protocolFeeBps_ > MAX_FEE_BPS) {
            revert FeeTooHigh(protocolFeeBps_, MAX_FEE_BPS);
        }
        treasury = treasury_;
        protocolFeeBps = protocolFeeBps_;
    }

    /* ------------------------------------------------------------------ */
    /*  Sponsors                                                          */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Fund reader rewards, net of the protocol fee.
     * @param memo Free text recorded on the event, e.g. the sponsor's name.
     */
    function sponsor(string calldata memo) external payable nonReentrant {
        if (msg.value == 0) revert EmptyDeposit();

        // Integer division favours the readers: any remainder from the fee
        // calculation falls into `toReaders`, never into `accruedFees`.
        uint256 fee = (msg.value * protocolFeeBps) / BPS_DENOMINATOR;
        uint256 toReaders = msg.value - fee;

        accruedFees += fee;
        committed += toReaders;
        totalSponsored += msg.value;

        emit Sponsored(msg.sender, msg.value, fee, toReaders, memo);
    }

    /// @notice Fee and reader split a deposit of `amount` would produce, quoted before paying.
    function quote(uint256 amount) external view returns (uint256 fee, uint256 toReaders) {
        fee = (amount * protocolFeeBps) / BPS_DENOMINATOR;
        toReaders = amount - fee;
    }

    /* ------------------------------------------------------------------ */
    /*  The only way out for committed funds                              */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Moves committed funds into the treasury, where they can only be
     *         paid to readers.
     * @dev Permissionless on purpose. It has exactly one destination, fixed at
     *      construction, so letting anyone push sponsor money toward readers
     *      costs nothing and removes the operator as a point of failure. There
     *      is no counterpart to this function with a caller-supplied address:
     *      that absence is the guarantee.
     */
    function fundTreasury(uint256 amount) external nonReentrant {
        if (amount == 0) revert EmptyDeposit();
        if (amount > committed) revert InsufficientCommitted(amount, committed);

        committed -= amount;
        totalForwarded += amount;

        treasury.depositSponsorship{value: amount}("SyndixSponsorship");
        emit ForwardedToTreasury(amount, msg.sender);
    }

    /* ------------------------------------------------------------------ */
    /*  Owner                                                             */
    /* ------------------------------------------------------------------ */

    /// @notice Withdraws operating revenue. Cannot reach `committed`.
    function withdrawFees(address to, uint256 amount) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount > accruedFees) revert InsufficientFees(amount, accruedFees);

        accruedFees -= amount;
        (bool ok, ) = payable(to).call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit FeesWithdrawn(to, amount);
    }

    /**
     * @notice Sets the cut taken from future deposits.
     * @dev Deliberately not retroactive - the split is computed and banked when
     *      each deposit arrives, so raising the fee cannot claw back money
     *      already promised to readers.
     */
    function setProtocolFee(uint16 bps) external onlyOwner {
        if (bps > MAX_FEE_BPS) revert FeeTooHigh(bps, MAX_FEE_BPS);
        emit ProtocolFeeChanged(protocolFeeBps, bps);
        protocolFeeBps = bps;
    }

    /* ------------------------------------------------------------------ */
    /*  Accounting                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @notice Balance backing neither the readers' share nor accrued fees.
     * @dev Should be zero in normal operation. Anything here arrived by force
     *      (selfdestruct or a coinbase payout) and is accounted rather than
     *      ignored, so it can never be mistaken for fee revenue.
     */
    function unaccountedBalance() external view returns (uint256) {
        uint256 tracked = committed + accruedFees;
        uint256 balance = address(this).balance;
        return balance > tracked ? balance - tracked : 0;
    }

    /// @notice The invariant a sponsor should check: every promise is funded.
    function isSolvent() external view returns (bool) {
        return address(this).balance >= committed + accruedFees;
    }
}
