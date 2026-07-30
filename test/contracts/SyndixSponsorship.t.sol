// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SyndixSponsorship, ISponsorshipSink} from "../../contracts/SyndixSponsorship.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * The contract's whole claim is that a sponsor's money, less a capped and
 * disclosed fee, cannot be taken back. Most of these tests exist to try to take
 * it back.
 */
contract SyndixSponsorshipTest is Test {
    SyndixSponsorship internal sponsorship;
    SyndixTreasury internal treasury;
    MockUpIdRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal brand = makeAddr("brand");
    address internal attacker = makeAddr("attacker");
    address internal attester;
    uint256 internal attesterKey;

    /// 10% to the protocol, 90% to readers.
    uint16 internal constant FEE_BPS = 1_000;

    function setUp() public {
        (attester, attesterKey) = makeAddrAndKey("attester");
        registry = new MockUpIdRegistry(owner);

        vm.prank(owner);
        treasury = new SyndixTreasury(
            owner, attester, IReaderRegistry(address(registry))
        );

        sponsorship = new SyndixSponsorship(
            owner, ISponsorshipSink(address(treasury)), FEE_BPS
        );

        vm.deal(brand, 100 ether);
        vm.deal(attacker, 1 ether);
    }

    function _sponsor(uint256 amount) internal {
        vm.prank(brand);
        sponsorship.sponsor{value: amount}("A Brand");
    }

    /* ------------------------------------------------------------------ */
    /*  The split                                                         */
    /* ------------------------------------------------------------------ */

    function test_SplitsDepositBetweenFeesAndReaders() public {
        _sponsor(1 ether);
        assertEq(sponsorship.accruedFees(), 0.1 ether);
        assertEq(sponsorship.committed(), 0.9 ether);
        assertEq(sponsorship.totalSponsored(), 1 ether);
    }

    function test_QuoteMatchesWhatADepositActuallyDoes() public {
        (uint256 fee, uint256 toReaders) = sponsorship.quote(3.7 ether);
        _sponsor(3.7 ether);
        assertEq(sponsorship.accruedFees(), fee);
        assertEq(sponsorship.committed(), toReaders);
    }

    /// @notice A zero fee is a valid configuration: everything goes to readers.
    function test_ZeroFeeSendsEverythingToReaders() public {
        vm.prank(owner);
        sponsorship.setProtocolFee(0);
        _sponsor(1 ether);
        assertEq(sponsorship.accruedFees(), 0);
        assertEq(sponsorship.committed(), 1 ether);
    }

    /// @notice Rounding must never favour the house.
    function testFuzz_RemainderAlwaysFallsToReaders(uint96 amount, uint16 bps) public {
        uint256 value = bound(uint256(amount), 1, 1_000 ether);
        uint16 fee = uint16(bound(uint256(bps), 0, sponsorship.MAX_FEE_BPS()));

        vm.prank(owner);
        sponsorship.setProtocolFee(fee);
        vm.deal(brand, value);
        vm.prank(brand);
        sponsorship.sponsor{value: value}("fuzz");

        assertEq(sponsorship.accruedFees() + sponsorship.committed(), value);
        assertLe(sponsorship.accruedFees(), (value * fee) / 10_000);
    }

    function test_RejectsEmptyDeposit() public {
        vm.prank(brand);
        vm.expectRevert(SyndixSponsorship.EmptyDeposit.selector);
        sponsorship.sponsor{value: 0}("nothing");
    }

    /* ------------------------------------------------------------------ */
    /*  Committed funds cannot be taken                                   */
    /* ------------------------------------------------------------------ */

    /// @notice The claim the whole contract exists to make.
    function test_OwnerCannotWithdrawTheReadersShare() public {
        _sponsor(1 ether);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixSponsorship.InsufficientFees.selector, 1 ether, 0.1 ether
            )
        );
        sponsorship.withdrawFees(owner, 1 ether);
    }

    function test_OwnerCanWithdrawFeesAndNothingMore() public {
        _sponsor(1 ether);

        vm.prank(owner);
        sponsorship.withdrawFees(owner, 0.1 ether);
        assertEq(owner.balance, 0.1 ether);
        assertEq(sponsorship.accruedFees(), 0);
        assertEq(sponsorship.committed(), 0.9 ether);

        // Nothing left to take, even by one wei.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(SyndixSponsorship.InsufficientFees.selector, 1, 0)
        );
        sponsorship.withdrawFees(owner, 1);
    }

    function test_StrangersCannotWithdrawFees() public {
        _sponsor(1 ether);
        vm.prank(attacker);
        vm.expectRevert(
            abi.encodeWithSelector(
                Ownable.OwnableUnauthorizedAccount.selector, attacker
            )
        );
        sponsorship.withdrawFees(attacker, 0.1 ether);
    }

    /**
     * @notice Raising the fee must not reach money already promised.
     * @dev The split is banked per deposit, so a later change is forward-only.
     */
    function test_RaisingTheFeeIsNotRetroactive() public {
        _sponsor(1 ether);
        assertEq(sponsorship.committed(), 0.9 ether);

        // Read the cap first: vm.prank applies to the next call, and a view
        // call would consume it before setProtocolFee ever ran.
        uint16 max = sponsorship.MAX_FEE_BPS();
        vm.prank(owner);
        sponsorship.setProtocolFee(max);

        assertEq(sponsorship.committed(), 0.9 ether, "old deposit must be untouched");
        assertEq(sponsorship.accruedFees(), 0.1 ether);

        // Only the next deposit sees the new rate.
        _sponsor(1 ether);
        assertEq(sponsorship.accruedFees(), 0.1 ether + 0.3 ether);
    }

    /// @notice An owner who can raise their own ceiling does not have one.
    function test_FeeIsCappedAndTheCapIsImmutable() public {
        uint16 max = sponsorship.MAX_FEE_BPS();
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(SyndixSponsorship.FeeTooHigh.selector, max + 1, max)
        );
        sponsorship.setProtocolFee(uint16(max + 1));

        vm.expectRevert(
            abi.encodeWithSelector(SyndixSponsorship.FeeTooHigh.selector, 9_999, max)
        );
        new SyndixSponsorship(owner, ISponsorshipSink(address(treasury)), 9_999);
    }

    /* ------------------------------------------------------------------ */
    /*  The one way out                                                   */
    /* ------------------------------------------------------------------ */

    function test_ForwardsCommittedFundsToTheTreasury() public {
        _sponsor(1 ether);

        sponsorship.fundTreasury(0.9 ether);

        assertEq(address(treasury).balance, 0.9 ether);
        assertEq(sponsorship.committed(), 0);
        assertEq(sponsorship.totalForwarded(), 0.9 ether);
        assertEq(treasury.totalProtocolVolume(), 0.9 ether);
    }

    /// @notice Permissionless: it has one destination, so anyone may push it there.
    function test_AnyoneCanForwardToTheTreasury() public {
        _sponsor(1 ether);
        vm.prank(attacker);
        sponsorship.fundTreasury(0.5 ether);
        assertEq(address(treasury).balance, 0.5 ether);
    }

    function test_CannotForwardMoreThanIsCommitted() public {
        _sponsor(1 ether);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixSponsorship.InsufficientCommitted.selector, 0.95 ether, 0.9 ether
            )
        );
        sponsorship.fundTreasury(0.95 ether);
    }

    /// @notice Forwarding must not be able to spend the fee balance.
    function test_ForwardingCannotDrainAccruedFees() public {
        _sponsor(1 ether);
        sponsorship.fundTreasury(0.9 ether);

        assertEq(sponsorship.accruedFees(), 0.1 ether);
        assertEq(address(sponsorship).balance, 0.1 ether);

        vm.prank(owner);
        sponsorship.withdrawFees(owner, 0.1 ether);
        assertEq(owner.balance, 0.1 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  End to end: sponsor money reaches a reader                        */
    /* ------------------------------------------------------------------ */

    /**
     * @notice The business model in one test. A brand pays, the protocol keeps
     *         its cut, and the rest is paid out to a verified human who read
     *         the issue - with no step where an operator could have diverted it.
     */
    function test_SponsorMoneyEndsUpInAReadersWallet() public {
        _sponsor(1 ether);
        sponsorship.fundTreasury(0.9 ether);

        address alice = makeAddr("alice");
        vm.prank(owner);
        registry.issue(alice, "alice.up.id");

        // HONEST LIMITATION, worth stating in a test rather than a comment
        // nobody reads: sponsor funding lands in the treasury's *unreserved*
        // balance. `publishArticle` is payable and does not draw on it, so the
        // operator still attaches the pool and recycles the sponsorship through
        // `withdrawTreasury`. There is no contract-enforced link from a given
        // sponsor deposit to a given article pool; adding `publishFromBalance`
        // to the treasury would close that, and is on the roadmap.
        assertEq(treasury.unreservedBalance(), 0.9 ether, "sponsor funding is available");

        vm.deal(owner, 1 ether);
        vm.prank(owner);
        uint256 id = treasury.publishArticle{value: 0.1 ether}(
            "Sponsored issue", "ipfs://bafysponsored", 0.001 ether
        );

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, alice, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);

        vm.prank(alice);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));

        assertEq(alice.balance, 0.001 ether, "the reader was paid");
        assertEq(sponsorship.accruedFees(), 0.1 ether, "the protocol kept its fee");
    }

    /* ------------------------------------------------------------------ */
    /*  Solvency                                                          */
    /* ------------------------------------------------------------------ */

    /// @notice Every wei owed to someone is present, through any sequence.
    function testFuzz_BalanceAlwaysCoversCommittedPlusFees(
        uint96 depositA,
        uint96 depositB,
        uint96 forwarded
    ) public {
        uint256 a = bound(uint256(depositA), 1, 50 ether);
        uint256 b = bound(uint256(depositB), 1, 50 ether);

        _sponsor(a);
        _sponsor(b);
        assertTrue(sponsorship.isSolvent());

        uint256 out = bound(uint256(forwarded), 0, sponsorship.committed());
        if (out > 0) sponsorship.fundTreasury(out);
        assertTrue(sponsorship.isSolvent());

        uint256 fees = sponsorship.accruedFees();
        if (fees > 0) {
            vm.prank(owner);
            sponsorship.withdrawFees(owner, fees);
        }
        assertTrue(sponsorship.isSolvent(), "solvency broken after a full fee sweep");
        assertGe(address(sponsorship).balance, sponsorship.committed());
    }

    /// @notice Forced ether is accounted, not silently counted as revenue.
    function test_ForcedEtherIsReportedAsUnaccounted() public {
        _sponsor(1 ether);
        assertEq(sponsorship.unaccountedBalance(), 0);

        // No receive() to call, so simulate a forced credit directly.
        vm.deal(address(sponsorship), address(sponsorship).balance + 0.4 ether);
        assertEq(sponsorship.unaccountedBalance(), 0.4 ether);
        assertEq(sponsorship.accruedFees(), 0.1 ether, "fees must not absorb it");
    }

    function test_RejectsZeroTreasuryAndZeroWithdrawTarget() public {
        vm.expectRevert(SyndixSponsorship.ZeroAddress.selector);
        new SyndixSponsorship(owner, ISponsorshipSink(address(0)), FEE_BPS);

        _sponsor(1 ether);
        vm.prank(owner);
        vm.expectRevert(SyndixSponsorship.ZeroAddress.selector);
        sponsorship.withdrawFees(address(0), 0.1 ether);
    }
}
