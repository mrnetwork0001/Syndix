// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SyndixStableTreasury} from "../../contracts/SyndixStableTreasury.sol";
import {MockKrwStable} from "../../contracts/mocks/MockKrwStable.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/**
 * @notice The ERC-20 treasury must hold the same three guarantees as the ETH
 *         one. These mirror SyndixTreasury.t.sol deliberately: if the stablecoin
 *         variant is a faithful port, the same tests pass with the value
 *         primitive swapped.
 */
contract SyndixStableTreasuryTest is Test {
    SyndixStableTreasury internal treasury;
    MockKrwStable internal krw;
    MockUpIdRegistry internal registry;

    address internal owner = makeAddr("owner");
    address internal alice;
    address internal bob;
    address internal attester;
    uint256 internal attesterKey;

    /** ₩100 at two decimals. The number a reader is actually promised. */
    uint128 internal constant REWARD = 100_00;
    uint128 internal constant POOL = REWARD * 20;

    function setUp() public {
        (alice, ) = makeAddrAndKey("alice");
        (bob, ) = makeAddrAndKey("bob");
        (attester, attesterKey) = makeAddrAndKey("attester");

        krw = new MockKrwStable();
        registry = new MockUpIdRegistry(owner);
        treasury = new SyndixStableTreasury(
            owner, IERC20(address(krw)), attester, IReaderRegistry(address(registry))
        );

        vm.startPrank(owner);
        registry.issue(alice, "alice.up.id");
        registry.issue(bob, "bob.up.id");
        vm.stopPrank();

        krw.mint(owner, 1_000_000_00);
        vm.prank(owner);
        krw.approve(address(treasury), type(uint256).max);
    }

    function _publish() internal returns (uint256 id) {
        vm.prank(owner);
        id = treasury.publishArticle("KRW rewards", "ipfs://bafytest", POOL, REWARD);
    }

    function _claim(uint256 articleId, address reader) internal {
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(articleId, reader, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);
        vm.prank(reader);
        treasury.claimReaderReward(articleId, 45, deadline, abi.encodePacked(r, s, v));
    }

    /* ------------------------------------------------------------------ */
    /*  The promise is exact                                              */
    /* ------------------------------------------------------------------ */

    /// @notice The whole reason this variant exists: ₩100 pays exactly ₩100.
    function test_ReaderReceivesExactlyOneHundredWon() public {
        uint256 id = _publish();
        assertEq(krw.balanceOf(alice), 0);

        _claim(id, alice);

        assertEq(krw.balanceOf(alice), REWARD, "reader must receive exactly the promised amount");
        // 100_00 at 2 decimals renders as 100.00 won — no price feed involved.
        assertEq(krw.decimals(), 2);
    }

    /* ------------------------------------------------------------------ */
    /*  Solvency — same invariant, token-denominated                       */
    /* ------------------------------------------------------------------ */

    function test_Withdraw_CannotDrainReaderRewards() public {
        _publish();
        assertEq(treasury.reservedRewards(), POOL);
        assertEq(treasury.unreservedBalance(), 0);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SyndixStableTreasury.InsufficientUnreservedBalance.selector, POOL, 0
            )
        );
        treasury.withdrawTreasury(owner, POOL);
    }

    function test_Withdraw_TakesOnlyUnreservedSurplus() public {
        _publish();
        vm.prank(owner);
        treasury.depositSponsorship(500_00, "sponsor");

        assertEq(treasury.unreservedBalance(), 500_00);

        vm.prank(owner);
        treasury.withdrawTreasury(bob, 500_00);
        assertEq(krw.balanceOf(bob), 500_00);
        assertEq(treasury.reservedRewards(), POOL);
    }

    /// @notice balanceOf(this) >= reservedRewards, the ERC-20 form of the invariant.
    function testFuzz_BalanceAlwaysCoversReserves(uint8 claimCount) public {
        uint256 id = _publish();
        uint256 claims = bound(uint256(claimCount), 0, 20);

        for (uint256 i = 0; i < claims; ++i) {
            address reader = address(uint160(0x5000 + i));
            vm.prank(owner);
            registry.issue(reader, string(abi.encodePacked("r", vm.toString(i), ".up.id")));
            _claim(id, reader);

            assertGe(
                krw.balanceOf(address(treasury)),
                treasury.reservedRewards(),
                "solvency invariant broken"
            );
        }
        assertEq(treasury.totalRewardDistributed(), claims * REWARD);
    }

    function test_CloseArticle_ReleasesUnspent() public {
        uint256 id = _publish();
        _claim(id, alice);

        vm.prank(owner);
        treasury.closeArticle(id);

        assertEq(treasury.reservedRewards(), 0);
        assertEq(treasury.unreservedBalance(), POOL - REWARD);
    }

    /* ------------------------------------------------------------------ */
    /*  Sybil + proof of read, unchanged                                  */
    /* ------------------------------------------------------------------ */

    function test_Claim_RevertsWithoutVerifiedIdentity() public {
        uint256 id = _publish();
        address drifter = makeAddr("drifter");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, drifter, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);

        vm.prank(drifter);
        vm.expectRevert(SyndixStableTreasury.ReaderNotVerified.selector);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));
    }

    function test_Claim_RevertsOnForgedAttestation() public {
        uint256 id = _publish();
        (, uint256 aliceKey) = makeAddrAndKey("alice");
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, alice, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, digest);

        vm.prank(alice);
        vm.expectRevert(SyndixStableTreasury.InvalidAttestation.selector);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));
    }

    function test_Claim_RevertsOnDoubleClaim() public {
        uint256 id = _publish();
        _claim(id, alice);

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, alice, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);
        vm.prank(alice);
        vm.expectRevert(SyndixStableTreasury.AlreadyClaimed.selector);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));
    }

    /* ------------------------------------------------------------------ */
    /*  ERC-20 specifics                                                  */
    /* ------------------------------------------------------------------ */

    /// @notice Publishing pulls tokens, so it fails without an allowance.
    function test_Publish_RevertsWithoutAllowance() public {
        address other = makeAddr("other");
        krw.mint(other, POOL);
        // No approve() from `other`, and it is not the owner either.
        vm.prank(other);
        vm.expectRevert();
        treasury.publishArticle("t", "ipfs://x", POOL, REWARD);
    }

    function test_Publish_RevertsOnZeroRewardPerReader() public {
        vm.prank(owner);
        vm.expectRevert(SyndixStableTreasury.InvalidRewardPerReader.selector);
        treasury.publishArticle("t", "ipfs://x", POOL, 0);
    }

    /// @notice No receive(): ETH sent here would be unrecoverable, so it cannot arrive.
    function test_ContractRejectsEther() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        (bool ok, ) = address(treasury).call{value: 1 ether}("");
        assertFalse(ok, "treasury must not accept ETH");
    }

    /// @notice The ReadProof shape matches the ETH treasury, so one attester serves both.
    function test_ReadProofTypehashMatchesEthTreasury() public view {
        bytes32 expected = keccak256(
            "ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)"
        );
        // Recompute the digest by hand and compare against the contract's.
        uint256 deadline = 1_800_000_000;
        bytes32 structHash =
            keccak256(abi.encode(expected, uint256(1), alice, uint32(45), deadline));
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
        assertEq(
            treasury.readProofDigest(1, alice, 45, deadline),
            keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash))
        );
    }
}
