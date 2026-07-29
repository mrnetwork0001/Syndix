// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {SyndixArticleNFT} from "../../contracts/SyndixArticleNFT.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";

contract SyndixArticleNFTTest is Test {
    SyndixArticleNFT internal nft;
    SyndixTreasury internal treasury;

    address internal owner = makeAddr("owner");
    address internal reader = makeAddr("reader");
    address internal other = makeAddr("other");

    uint256 internal constant ISSUE_ID = 6;
    string internal constant URI = "ipfs://bafyissue6";

    function setUp() public {
        MockUpIdRegistry registry = new MockUpIdRegistry(owner);
        treasury = new SyndixTreasury(owner, makeAddr("attester"), IReaderRegistry(address(registry)));
        nft = new SyndixArticleNFT(owner, payable(address(treasury)));

        vm.deal(reader, 10 ether);
        vm.deal(other, 10 ether);
    }

    function _register(uint96 price, uint32 maxSupply) internal {
        vm.prank(owner);
        nft.registerEdition(ISSUE_ID, URI, price, maxSupply, 0);
    }

    function test_CollectFreeEdition() public {
        _register(0, 0);

        vm.prank(reader);
        uint256 tokenId = nft.collect(ISSUE_ID);

        assertEq(nft.ownerOf(tokenId), reader);
        assertEq(nft.tokenURI(tokenId), URI);
        assertEq(nft.tokenIssue(tokenId), ISSUE_ID);
        assertTrue(nft.hasCollected(ISSUE_ID, reader));
    }

    /// @notice Paid collects must land in the treasury, not sit in the NFT contract.
    function test_CollectForwardsProceedsToTreasury() public {
        _register(0.001 ether, 0);

        uint256 before = address(treasury).balance;
        vm.prank(reader);
        nft.collect{value: 0.001 ether}(ISSUE_ID);

        assertEq(address(treasury).balance, before + 0.001 ether);
        assertEq(address(nft).balance, 0, "NFT contract must not retain funds");
        // Bare transfers are counted as unreserved sponsorship.
        assertEq(treasury.totalProtocolVolume(), 0.001 ether);
    }

    function test_CollectRevertsOnWrongPayment() public {
        _register(0.001 ether, 0);

        vm.prank(reader);
        vm.expectRevert(
            abi.encodeWithSelector(SyndixArticleNFT.WrongPayment.selector, 0.0005 ether, 0.001 ether)
        );
        nft.collect{value: 0.0005 ether}(ISSUE_ID);
    }

    function test_OnePerWallet() public {
        _register(0, 0);

        vm.startPrank(reader);
        nft.collect(ISSUE_ID);
        vm.expectRevert(SyndixArticleNFT.AlreadyCollected.selector);
        nft.collect(ISSUE_ID);
        vm.stopPrank();
    }

    function test_MaxSupplyIsEnforced() public {
        _register(0, 1);

        vm.prank(reader);
        nft.collect(ISSUE_ID);

        vm.prank(other);
        vm.expectRevert(SyndixArticleNFT.EditionSoldOut.selector);
        nft.collect(ISSUE_ID);

        (uint32 minted, uint32 max) = nft.editionSupply(ISSUE_ID);
        assertEq(minted, 1);
        assertEq(max, 1);
    }

    function test_OpenEditionHasNoCap() public {
        _register(0, 0);

        for (uint256 i = 0; i < 25; ++i) {
            vm.prank(address(uint160(0x2000 + i)));
            nft.collect(ISSUE_ID);
        }
        (uint32 minted,) = nft.editionSupply(ISSUE_ID);
        assertEq(minted, 25);
        assertEq(nft.totalMinted(), 25);
    }

    function test_CollectRevertsBeforeOpen() public {
        vm.prank(owner);
        nft.registerEdition(ISSUE_ID, URI, 0, 0, uint64(block.timestamp + 1 days));

        vm.prank(reader);
        vm.expectRevert(SyndixArticleNFT.EditionNotOpenYet.selector);
        nft.collect(ISSUE_ID);

        vm.warp(block.timestamp + 1 days);
        vm.prank(reader);
        nft.collect(ISSUE_ID);
    }

    function test_ClosedEditionRejectsCollect() public {
        _register(0, 0);

        vm.prank(owner);
        nft.setEditionState(ISSUE_ID, false, 0);

        vm.prank(reader);
        vm.expectRevert(SyndixArticleNFT.EditionClosed.selector);
        nft.collect(ISSUE_ID);
    }

    function test_UnknownEditionReverts() public {
        vm.prank(reader);
        vm.expectRevert(SyndixArticleNFT.EditionMissing.selector);
        nft.collect(999);
    }

    function test_DuplicateEditionReverts() public {
        _register(0, 0);
        vm.prank(owner);
        vm.expectRevert(SyndixArticleNFT.EditionExists.selector);
        nft.registerEdition(ISSUE_ID, URI, 0, 0, 0);
    }

    function test_RegisterEditionOnlyOwner() public {
        vm.prank(reader);
        vm.expectRevert();
        nft.registerEdition(ISSUE_ID, URI, 0, 0, 0);
    }
}

contract MockUpIdRegistryTest is Test {
    MockUpIdRegistry internal registry;
    address internal owner = makeAddr("owner");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");

    function setUp() public {
        registry = new MockUpIdRegistry(owner);
    }

    /// @notice One name per wallet is the property the reward pool depends on.
    function test_OneNamePerWallet() public {
        vm.prank(alice);
        registry.claimName("alice.up.id");

        vm.prank(alice);
        vm.expectRevert(MockUpIdRegistry.AlreadyNamed.selector);
        registry.claimName("alice2.up.id");
    }

    function test_NamesAreUnique() public {
        vm.prank(alice);
        registry.claimName("shared.up.id");

        vm.prank(bob);
        vm.expectRevert(MockUpIdRegistry.NameTaken.selector);
        registry.claimName("shared.up.id");
    }

    function test_RevokeFreesTheName() public {
        vm.prank(alice);
        registry.claimName("alice.up.id");
        assertTrue(registry.isVerified(alice));
        assertEq(registry.totalVerified(), 1);

        vm.prank(owner);
        registry.revoke(alice);

        assertFalse(registry.isVerified(alice));
        assertEq(registry.totalVerified(), 0);
        assertEq(registry.resolve("alice.up.id"), address(0));

        vm.prank(bob);
        registry.claimName("alice.up.id");
        assertEq(registry.resolve("alice.up.id"), bob);
    }

    function test_ResolveRoundTrips() public {
        vm.prank(alice);
        registry.claimName("alice.up.id");
        assertEq(registry.nameOf(alice), "alice.up.id");
        assertEq(registry.resolve("alice.up.id"), alice);
    }
}
