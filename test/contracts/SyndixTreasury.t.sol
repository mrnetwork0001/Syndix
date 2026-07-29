// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";

/**
 * @title SyndixTreasuryTest
 * @notice Pins the three properties the treasury exists to guarantee:
 *         solvency, sybil resistance, and proof of read.
 *
 * @dev Two of these tests are regressions against the original blueprint
 *      contract, which would fail them:
 *        - test_Withdraw_CannotDrainReaderRewards
 *        - test_Claim_RevertsWithoutVerifiedIdentity
 */
contract SyndixTreasuryTest is Test {
    SyndixTreasury internal treasury;
    MockUpIdRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal sponsor = makeAddr("sponsor");
    address internal alice;
    uint256 internal aliceKey;
    address internal bob;
    uint256 internal bobKey;

    address internal attester;
    uint256 internal attesterKey;

    uint128 internal constant REWARD_PER_READER = 0.00003 ether;
    uint256 internal constant POOL = 0.003 ether; // funds 100 claims

    bytes32 private constant READ_PROOF_TYPEHASH = keccak256(
        "ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)"
    );

    function setUp() public {
        (alice, aliceKey) = makeAddrAndKey("alice");
        (bob, bobKey) = makeAddrAndKey("bob");
        (attester, attesterKey) = makeAddrAndKey("attester");

        registry = new MockUpIdRegistry(owner);
        treasury = new SyndixTreasury(owner, attester, IReaderRegistry(address(registry)));

        vm.startPrank(owner);
        registry.issue(alice, "alice.up.id");
        registry.issue(bob, "bob.up.id");
        vm.stopPrank();

        vm.deal(owner, 100 ether);
        vm.deal(sponsor, 100 ether);
    }

    /* ------------------------------------------------------------------ */
    /*  Helpers                                                           */
    /* ------------------------------------------------------------------ */

    function _publish() internal returns (uint256 id) {
        vm.prank(owner);
        id = treasury.publishArticle{value: POOL}(
            "Flashblocks change consumer UX", "ipfs://bafytest", REWARD_PER_READER
        );
    }

    function _sign(uint256 key, uint256 articleId, address reader, uint32 dwell, uint256 deadline)
        internal
        view
        returns (bytes memory)
    {
        bytes32 digest = treasury.readProofDigest(articleId, reader, dwell, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }

    function _claim(uint256 articleId, address reader, uint256 readerKeyUnused) internal {
        readerKeyUnused; // silence unused warning; the attester signs, not the reader
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attesterKey, articleId, reader, 45, deadline);
        vm.prank(reader);
        treasury.claimReaderReward(articleId, 45, deadline, sig);
    }

    /* ------------------------------------------------------------------ */
    /*  Solvency — the headline fix                                       */
    /* ------------------------------------------------------------------ */

    /// @notice The invariant: reader-owed ETH is never withdrawable by the owner.
    function test_Withdraw_CannotDrainReaderRewards() public {
        uint256 id = _publish();
        assertEq(treasury.reservedRewards(), POOL, "pool must be reserved on publish");
        assertEq(treasury.unreservedBalance(), 0, "nothing is withdrawable yet");

        // The blueprint contract withdrew against address(this).balance and would
        // succeed here, stranding every outstanding reader claim.
        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixTreasury.InsufficientUnreservedBalance.selector, POOL, 0
            )
        );
        treasury.withdrawTreasury(owner, POOL);

        // A reader who arrives afterwards is still paid.
        uint256 before = alice.balance;
        _claim(id, alice, aliceKey);
        assertEq(alice.balance, before + REWARD_PER_READER);
    }

    function test_Withdraw_OnlyTakesUnreservedSurplus() public {
        _publish();

        vm.prank(sponsor);
        treasury.depositSponsorship{value: 1 ether}("giwa ecosystem fund");

        assertEq(treasury.unreservedBalance(), 1 ether);

        address payable sink = payable(makeAddr("sink"));
        vm.prank(owner);
        treasury.withdrawTreasury(sink, 1 ether);

        assertEq(sink.balance, 1 ether);
        // Reserves survived the withdrawal untouched.
        assertEq(treasury.reservedRewards(), POOL);
        assertGe(address(treasury).balance, treasury.reservedRewards());
    }

    /// @notice The core invariant, asserted across a random sequence of claims.
    function testFuzz_BalanceAlwaysCoversReserves(uint8 claimCount) public {
        uint256 id = _publish();
        uint256 claims = bound(uint256(claimCount), 0, 40);

        for (uint256 i = 0; i < claims; ++i) {
            address reader = address(uint160(0x1000 + i));
            vm.prank(owner);
            registry.issue(reader, string(abi.encodePacked("reader", vm.toString(i), ".up.id")));
            _claim(id, reader, 0);

            assertGe(
                address(treasury).balance,
                treasury.reservedRewards(),
                "solvency invariant broken"
            );
        }

        assertEq(
            treasury.totalRewardDistributed(),
            claims * REWARD_PER_READER,
            "distribution accounting drifted"
        );
    }

    function test_CloseArticle_ReleasesUnspentBudget() public {
        uint256 id = _publish();
        _claim(id, alice, aliceKey);

        vm.prank(owner);
        treasury.closeArticle(id);

        assertEq(treasury.reservedRewards(), 0);
        assertEq(treasury.unreservedBalance(), POOL - REWARD_PER_READER);
    }

    /* ------------------------------------------------------------------ */
    /*  Sybil resistance                                                  */
    /* ------------------------------------------------------------------ */

    function test_Claim_RevertsWithoutVerifiedIdentity() public {
        uint256 id = _publish();
        address drifter = makeAddr("drifter"); // no up.id SBT

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attesterKey, id, drifter, 45, deadline);

        vm.prank(drifter);
        vm.expectRevert(SyndixTreasury.ReaderNotVerified.selector);
        treasury.claimReaderReward(id, 45, deadline, sig);
    }

    function test_Claim_RecordsUpIdOnFirstClaim() public {
        uint256 id = _publish();
        _claim(id, alice, aliceKey);

        assertEq(treasury.readerIdentity(alice), "alice.up.id");
        assertEq(treasury.uniqueReaders(), 1);

        // A second article by the same reader must not double-count them.
        uint256 second = _publish();
        _claim(second, alice, aliceKey);
        assertEq(treasury.uniqueReaders(), 1);
    }

    function test_Claim_RevertsOnDoubleClaim() public {
        uint256 id = _publish();
        _claim(id, alice, aliceKey);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attesterKey, id, alice, 45, deadline);
        vm.prank(alice);
        vm.expectRevert(SyndixTreasury.AlreadyClaimed.selector);
        treasury.claimReaderReward(id, 45, deadline, sig);
    }

    /* ------------------------------------------------------------------ */
    /*  Proof of read                                                     */
    /* ------------------------------------------------------------------ */

    function test_Claim_RevertsOnForgedAttestation() public {
        uint256 id = _publish();
        uint256 deadline = block.timestamp + 1 hours;

        // Alice signs her own proof rather than obtaining one from the attester.
        bytes memory forged = _sign(aliceKey, id, alice, 45, deadline);

        vm.prank(alice);
        vm.expectRevert(SyndixTreasury.InvalidAttestation.selector);
        treasury.claimReaderReward(id, 45, deadline, forged);
    }

    function test_Claim_RevertsWhenAttestationIsForAnotherReader() public {
        uint256 id = _publish();
        uint256 deadline = block.timestamp + 1 hours;

        // A valid proof issued to Bob cannot be replayed by Alice.
        bytes memory bobsProof = _sign(attesterKey, id, bob, 45, deadline);

        vm.prank(alice);
        vm.expectRevert(SyndixTreasury.InvalidAttestation.selector);
        treasury.claimReaderReward(id, 45, deadline, bobsProof);
    }

    function test_Claim_RevertsOnExpiredAttestation() public {
        uint256 id = _publish();
        uint256 deadline = block.timestamp + 10;
        bytes memory sig = _sign(attesterKey, id, alice, 45, deadline);

        vm.warp(deadline + 1);

        vm.prank(alice);
        vm.expectRevert(SyndixTreasury.AttestationExpired.selector);
        treasury.claimReaderReward(id, 45, deadline, sig);
    }

    function test_Claim_RevertsOnShortDwell() public {
        uint256 id = _publish();
        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attesterKey, id, alice, 3, deadline);

        vm.prank(alice);
        vm.expectRevert(SyndixTreasury.DwellTooShort.selector);
        treasury.claimReaderReward(id, 3, deadline, sig);
    }

    /* ------------------------------------------------------------------ */
    /*  Publishing guards                                                 */
    /* ------------------------------------------------------------------ */

    function test_Publish_RevertsOnZeroRewardPerReader() public {
        vm.prank(owner);
        vm.expectRevert(SyndixTreasury.InvalidRewardPerReader.selector);
        treasury.publishArticle{value: POOL}("t", "ipfs://x", 0);
    }

    function test_Publish_RevertsWhenRewardExceedsPool() public {
        vm.prank(owner);
        vm.expectRevert(SyndixTreasury.InvalidRewardPerReader.selector);
        treasury.publishArticle{value: 1 wei}("t", "ipfs://x", 2 wei);
    }

    function test_Publish_OnlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        treasury.publishArticle{value: POOL}("t", "ipfs://x", REWARD_PER_READER);
    }

    function test_PoolExhaustion() public {
        vm.prank(owner);
        // Funds exactly one claim.
        uint256 id = treasury.publishArticle{value: REWARD_PER_READER}(
            "tiny", "ipfs://x", REWARD_PER_READER
        );
        assertEq(treasury.remainingClaims(id), 1);

        _claim(id, alice, aliceKey);
        assertEq(treasury.remainingClaims(id), 0);

        uint256 deadline = block.timestamp + 1 hours;
        bytes memory sig = _sign(attesterKey, id, bob, 45, deadline);
        vm.prank(bob);
        vm.expectRevert(SyndixTreasury.PoolExhausted.selector);
        treasury.claimReaderReward(id, 45, deadline, sig);
    }

    /* ------------------------------------------------------------------ */
    /*  Views                                                             */
    /* ------------------------------------------------------------------ */

    function test_Claimability_ExplainsRefusals() public {
        uint256 id = _publish();

        (bool ok, string memory reason) = treasury.claimability(id, alice);
        assertTrue(ok);
        assertEq(bytes(reason).length, 0);

        (ok, reason) = treasury.claimability(id, makeAddr("nobody"));
        assertFalse(ok);
        assertEq(reason, "no verified up.id");

        _claim(id, alice, aliceKey);
        (ok, reason) = treasury.claimability(id, alice);
        assertFalse(ok);
        assertEq(reason, "already claimed");
    }

    function test_ListArticles_Paginates() public {
        _publish();
        _publish();
        _publish();

        SyndixTreasury.Article[] memory page = treasury.listArticles(1, 2);
        assertEq(page.length, 2);
        assertEq(page[0].id, 2);
        assertEq(page[1].id, 3);

        assertEq(treasury.listArticles(9, 5).length, 0);
    }

    function test_ReadProofDigest_MatchesLocalEip712() public view {
        uint256 deadline = 1_800_000_000;
        bytes32 structHash =
            keccak256(abi.encode(READ_PROOF_TYPEHASH, uint256(1), alice, uint32(45), deadline));
        bytes32 domainSeparator = keccak256(
            abi.encode(
                keccak256(
                    "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
                ),
                keccak256(bytes("Syndix")),
                keccak256(bytes("1")),
                block.chainid,
                address(treasury)
            )
        );
        bytes32 expected =
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));

        assertEq(treasury.readProofDigest(1, alice, 45, deadline), expected);
    }
}
