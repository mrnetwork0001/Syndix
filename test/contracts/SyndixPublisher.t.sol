// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SyndixPublisher, ISyndixTreasuryOwner} from "../../contracts/SyndixPublisher.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * The guard exists so an unattended server key cannot loot the treasury. Most
 * of these tests are therefore negative: they assert the publisher role
 * *cannot* do things, which is the only property that makes autonomy safe.
 */
contract SyndixPublisherTest is Test {
    SyndixTreasury internal treasury;
    SyndixPublisher internal guard;
    MockUpIdRegistry internal registry;

    address internal coldOwner = makeAddr("coldOwner");
    address internal serverKey = makeAddr("serverKey");
    address internal attacker = makeAddr("attacker");
    address internal attester;
    uint256 internal attesterKey;

    uint128 internal constant POOL_CAP = 0.01 ether;
    uint32 internal constant DAILY_CAP = 3;
    uint128 internal constant PER_READER = 0.00003 ether;

    function setUp() public {
        (attester, attesterKey) = makeAddrAndKey("attester");
        registry = new MockUpIdRegistry(coldOwner);

        // Deployed by the owner, then ownership moves to the guard - exactly
        // the migration path a live treasury would take.
        vm.prank(coldOwner);
        treasury = new SyndixTreasury(
            coldOwner, attester, IReaderRegistry(address(registry))
        );

        guard = new SyndixPublisher(
            coldOwner,
            ISyndixTreasuryOwner(address(treasury)),
            serverKey,
            POOL_CAP,
            DAILY_CAP
        );

        vm.prank(coldOwner);
        treasury.transferOwnership(address(guard));

        vm.deal(address(guard), 1 ether);
    }

    function _publish() internal returns (uint256) {
        vm.prank(serverKey);
        return guard.publish("Autonomous issue", "ipfs://bafyauto", PER_READER, 0.0006 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  The migration works                                               */
    /* ------------------------------------------------------------------ */

    function test_GuardOwnsTheTreasury() public view {
        assertEq(treasury.owner(), address(guard));
        assertEq(guard.owner(), coldOwner);
        assertEq(guard.publisher(), serverKey);
    }

    function test_PublisherCanPublishWithinLimits() public {
        uint256 id = _publish();

        (, string memory title, , uint256 pool, uint128 perReader, , , bool active) =
            treasury.articles(id);
        assertEq(title, "Autonomous issue");
        assertEq(pool, 0.0006 ether);
        assertEq(perReader, PER_READER);
        assertTrue(active);
        assertEq(treasury.reservedRewards(), 0.0006 ether);
    }

    /// @notice A reader claim still settles normally through the guarded treasury.
    function test_ReadersStillClaimAfterMigration() public {
        uint256 id = _publish();
        address alice = makeAddr("alice");
        vm.prank(coldOwner);
        registry.issue(alice, "alice.up.id");

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, alice, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);

        vm.prank(alice);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));
        assertEq(alice.balance, PER_READER);
    }

    /* ------------------------------------------------------------------ */
    /*  What the server key must NOT be able to do                        */
    /* ------------------------------------------------------------------ */

    /// @notice The entire point. A compromised server cannot take the money.
    function test_PublisherCannotWithdrawFromTheGuard() public {
        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.withdraw(serverKey, 1 ether);
    }

    /// @notice No passthrough for the publisher, so no reachable owner powers.
    function test_PublisherCannotExecuteArbitraryTreasuryCalls() public {
        bytes memory drain = abi.encodeWithSignature(
            "withdrawTreasury(address,uint256)", serverKey, 0.5 ether
        );
        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.execute(drain);
    }

    /**
     * @notice Swapping the attester would let a compromised server forge read
     *         proofs and pay itself from every pool. It must be unreachable.
     */
    function test_PublisherCannotReplaceTheAttesterOrRegistry() public {
        vm.startPrank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.execute(abi.encodeWithSignature("setReadAttester(address)", attacker));

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.execute(abi.encodeWithSignature("setReaderRegistry(address)", attacker));
        vm.stopPrank();
    }

    function test_PublisherCannotChangeItsOwnLimits() public {
        vm.startPrank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.setLimits(type(uint128).max, type(uint32).max);

        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.setPublisher(attacker);
        vm.stopPrank();
    }

    function test_PublisherCannotStealTreasuryOwnership() public {
        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, serverKey)
        );
        guard.recoverTreasuryOwnership(attacker);
    }

    function test_RandomAddressCannotPublish() public {
        vm.prank(attacker);
        vm.expectRevert(SyndixPublisher.NotPublisher.selector);
        guard.publish("spam", "ipfs://x", PER_READER, 0.0001 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  Spend is bounded                                                  */
    /* ------------------------------------------------------------------ */

    function test_PoolCapIsEnforced() public {
        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixPublisher.PoolTooLarge.selector, uint256(POOL_CAP) + 1, POOL_CAP
            )
        );
        guard.publish("too rich", "ipfs://x", PER_READER, uint256(POOL_CAP) + 1);
    }

    function test_DailyCapIsEnforced() public {
        for (uint256 i = 0; i < DAILY_CAP; ++i) {
            _publish();
        }
        assertEq(guard.remainingToday(), 0);

        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(SyndixPublisher.DailyLimitReached.selector, DAILY_CAP)
        );
        guard.publish("one too many", "ipfs://x", PER_READER, 0.0006 ether);
    }

    function test_DailyWindowRollsOver() public {
        for (uint256 i = 0; i < DAILY_CAP; ++i) {
            _publish();
        }
        vm.warp(block.timestamp + 1 days + 1);
        assertEq(guard.remainingToday(), DAILY_CAP);
        _publish();
        assertEq(guard.remainingToday(), DAILY_CAP - 1);
    }

    /// @notice Top-ups spend from the same balance, so they consume the same allowance.
    function test_TopUpCountsAgainstTheDailyAllowance() public {
        _publish();
        assertEq(guard.remainingToday(), DAILY_CAP - 1);

        vm.prank(serverKey);
        guard.topUp(1, 0.0001 ether);
        assertEq(guard.remainingToday(), DAILY_CAP - 2);
    }

    function test_CannotSpendMoreThanTheGuardHolds() public {
        vm.prank(coldOwner);
        guard.withdraw(coldOwner, address(guard).balance);

        vm.prank(serverKey);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixPublisher.InsufficientBalance.selector, 0.0006 ether, 0
            )
        );
        guard.publish("broke", "ipfs://x", PER_READER, 0.0006 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  The owner keeps every power, and a way out                        */
    /* ------------------------------------------------------------------ */

    function test_OwnerRetainsFullTreasuryAuthority() public {
        _publish();

        vm.startPrank(coldOwner);
        guard.execute(abi.encodeWithSignature("setMinDwellSeconds(uint32)", uint32(120)));
        assertEq(treasury.minDwellSeconds(), 120);

        guard.execute(abi.encodeWithSignature("setReadAttester(address)", attacker));
        assertEq(treasury.readAttester(), attacker);
        vm.stopPrank();
    }

    /// @notice Nothing here is a one-way door.
    function test_OwnerCanWalkAwayFromTheGuard() public {
        vm.prank(coldOwner);
        guard.recoverTreasuryOwnership(coldOwner);

        assertEq(treasury.owner(), coldOwner);

        // And the treasury is directly controllable again.
        vm.prank(coldOwner);
        treasury.setMinDwellSeconds(90);
        assertEq(treasury.minDwellSeconds(), 90);
    }

    function test_OwnerCanRotateACompromisedPublisher() public {
        address newKey = makeAddr("newServerKey");
        vm.prank(coldOwner);
        guard.setPublisher(newKey);

        vm.prank(serverKey);
        vm.expectRevert(SyndixPublisher.NotPublisher.selector);
        guard.publish("stale key", "ipfs://x", PER_READER, 0.0006 ether);

        vm.prank(newKey);
        guard.publish("rotated", "ipfs://x", PER_READER, 0.0006 ether);
    }

    function test_ExecuteSurfacesTheTreasuryRevertReason() public {
        // withdrawTreasury beyond the unreserved balance must still revert with
        // the treasury's own error, not a generic CallFailed.
        _publish();
        vm.prank(coldOwner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixTreasury.InsufficientUnreservedBalance.selector, 1 ether, 0
            )
        );
        guard.execute(
            abi.encodeWithSignature(
                "withdrawTreasury(address,uint256)", coldOwner, uint256(1 ether)
            )
        );
    }

    function test_RejectsZeroTreasuryAndZeroRecovery() public {
        vm.expectRevert(SyndixPublisher.ZeroAddress.selector);
        new SyndixPublisher(
            coldOwner, ISyndixTreasuryOwner(address(0)), serverKey, POOL_CAP, DAILY_CAP
        );

        vm.prank(coldOwner);
        vm.expectRevert(SyndixPublisher.ZeroAddress.selector);
        guard.recoverTreasuryOwnership(address(0));
    }

    function test_AcceptsFunding() public {
        uint256 before = address(guard).balance;
        vm.deal(attacker, 1 ether);
        vm.prank(attacker);
        (bool ok, ) = address(guard).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(address(guard).balance, before + 0.5 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  Solvency survives the migration                                   */
    /* ------------------------------------------------------------------ */

    /**
     * @notice The treasury's core invariant must hold with a contract owner
     *         exactly as it does with an EOA - the guard is just another owner
     *         and gets no special reach into reserved rewards.
     */
    function testFuzz_GuardCannotTouchReservedRewards(uint96 attempt) public {
        _publish();
        uint256 want = bound(uint256(attempt), 1, 10 ether);

        vm.prank(coldOwner);
        try guard.execute(
            abi.encodeWithSignature(
                "withdrawTreasury(address,uint256)", coldOwner, want
            )
        ) {
            // A withdrawal that succeeds may only ever have taken surplus.
        } catch {
            // Reverting is the expected path once it exceeds the surplus.
        }
        assertGe(address(treasury).balance, treasury.reservedRewards());
    }
}
