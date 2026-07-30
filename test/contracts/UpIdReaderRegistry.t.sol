// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {UpIdReaderRegistry, IUpnameRegistry} from "../../contracts/UpIdReaderRegistry.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";

/** Mimics the live UpnameRegistry surface the adapter depends on: balanceOf only. */
contract FakeUpname is IUpnameRegistry {
    mapping(address => uint256) private held;

    function setHolder(address account, uint256 count) external {
        held[account] = count;
    }

    function balanceOf(address owner) external view returns (uint256) {
        return held[owner];
    }
}

contract UpIdReaderRegistryTest is Test {
    UpIdReaderRegistry internal registry;
    FakeUpname internal upname;

    address internal holder = makeAddr("holder");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        upname = new FakeUpname();
        registry = new UpIdReaderRegistry(IUpnameRegistry(address(upname)));
    }

    function test_HolderOfAnUpIdIsVerified() public {
        upname.setHolder(holder, 1);
        assertTrue(registry.isVerified(holder));
    }

    function test_NonHolderIsNotVerified() public view {
        assertFalse(registry.isVerified(stranger));
    }

    /**
     * @notice The label is deliberately empty.
     * @dev The live registry is not ERC-721Enumerable, so there is no on-chain
     *      address-to-label lookup. Returning a guess would write a wrong name
     *      into a RewardClaimed event permanently.
     */
    function test_NameIsEmptyBecauseItLivesOffChain() public view {
        assertEq(registry.nameOf(holder), "");
        assertEq(registry.nameOf(stranger), "");
    }

    function test_RejectsZeroRegistry() public {
        vm.expectRevert(UpIdReaderRegistry.ZeroAddress.selector);
        new UpIdReaderRegistry(IUpnameRegistry(address(0)));
    }

    /* ------------------------------------------------------------------ */
    /*  The treasury accepts it in place of the mock                      */
    /* ------------------------------------------------------------------ */

    /**
     * @notice The whole reason IReaderRegistry is a thin interface: the treasury
     *         can be pointed at the real ecosystem registry with a setter call,
     *         no redeploy, and an empty label does not break the claim path.
     */
    function test_TreasuryAcceptsTheAdapterAndClaimsSucceed() public {
        address owner = makeAddr("owner");
        (address reader, ) = makeAddrAndKey("reader");
        (address attester, uint256 attesterKey) = makeAddrAndKey("attester");

        SyndixTreasury treasury =
            new SyndixTreasury(owner, attester, IReaderRegistry(address(registry)));
        vm.deal(owner, 1 ether);

        vm.prank(owner);
        uint256 id = treasury.publishArticle{value: 0.001 ether}(
            "Real up.id gating", "ipfs://bafytest", 0.00003 ether
        );

        // Without an up.id the claim is refused, adapter and all.
        (bool ok, string memory why) = treasury.claimability(id, reader);
        assertFalse(ok);
        assertEq(why, "no verified up.id");

        upname.setHolder(reader, 1);
        (ok, ) = treasury.claimability(id, reader);
        assertTrue(ok, "holding a real up.id must satisfy the gate");

        uint256 deadline = block.timestamp + 1 hours;
        bytes32 digest = treasury.readProofDigest(id, reader, 45, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(attesterKey, digest);

        uint256 before = reader.balance;
        vm.prank(reader);
        treasury.claimReaderReward(id, 45, deadline, abi.encodePacked(r, s, v));

        assertEq(reader.balance, before + 0.00003 ether);
        // Empty label is tolerated: the treasury only records a non-empty one.
        assertEq(treasury.readerIdentity(reader), "");
        assertEq(treasury.uniqueReaders(), 1);
    }
}
