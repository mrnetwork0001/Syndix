// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {
    SyndixPaymaster,
    IEntryPoint,
    PackedUserOperation
} from "../../contracts/SyndixPaymaster.sol";
import {SyndixTreasury} from "../../contracts/SyndixTreasury.sol";
import {MockUpIdRegistry} from "../../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../../contracts/interfaces/IReaderRegistry.sol";

/** Minimal EntryPoint stand-in — only the funding surface the paymaster calls. */
contract MockEntryPoint {
    mapping(address => uint256) public balanceOf;
    mapping(address => uint256) public stakeOf;

    function depositTo(address account) external payable {
        balanceOf[account] += msg.value;
    }

    function addStake(uint32) external payable {
        stakeOf[msg.sender] += msg.value;
    }

    function unlockStake() external {}

    function withdrawStake(address payable to) external {
        uint256 amount = stakeOf[msg.sender];
        stakeOf[msg.sender] = 0;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "stake transfer failed");
    }

    function withdrawTo(address payable to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "withdraw failed");
    }
}

contract SyndixPaymasterTest is Test {
    SyndixPaymaster internal paymaster;
    SyndixTreasury internal treasury;
    MockEntryPoint internal entryPoint;

    address internal owner = makeAddr("owner");
    address internal reader = makeAddr("reader");
    address internal outsider = makeAddr("outsider");

    function setUp() public {
        MockUpIdRegistry registry = new MockUpIdRegistry(owner);
        treasury = new SyndixTreasury(
            owner, makeAddr("attester"), IReaderRegistry(address(registry))
        );
        entryPoint = new MockEntryPoint();
        paymaster = new SyndixPaymaster(
            owner, IEntryPoint(address(entryPoint)), address(treasury)
        );
        vm.deal(owner, 10 ether);
        vm.deal(address(entryPoint), 0);
    }

    /* ------------------------------------------------------------------ */
    /*  The selector must match the real function                         */
    /* ------------------------------------------------------------------ */

    /// @notice A wrong constant here rejects every legitimate claim silently.
    function test_ClaimSelectorMatchesTreasury() public view {
        assertEq(
            paymaster.CLAIM_SELECTOR(),
            SyndixTreasury.claimReaderReward.selector,
            "CLAIM_SELECTOR drifted from claimReaderReward"
        );
    }

    /* ------------------------------------------------------------------ */
    /*  Validation gating                                                 */
    /* ------------------------------------------------------------------ */

    /// @dev A real PackedUserOperation, so the compiler does the encoding.
    function _userOp(address sender, bytes memory callData)
        internal
        pure
        returns (PackedUserOperation memory op)
    {
        op.sender = sender;
        op.callData = callData;
    }

    function _executeCall(address target, bytes4 innerSelector)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encodeWithSignature(
            "execute(address,uint256,bytes)",
            target,
            uint256(0),
            abi.encodePacked(innerSelector, new bytes(128))
        );
    }

    function test_OnlyEntryPointMayValidate() public {
        PackedUserOperation memory op = _userOp(reader, _executeCall(address(treasury), paymaster.CLAIM_SELECTOR()));
        vm.prank(outsider);
        vm.expectRevert(SyndixPaymaster.OnlyEntryPoint.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
    }

    function test_SponsorsAClaimCall() public {
        PackedUserOperation memory op = _userOp(reader, _executeCall(address(treasury), paymaster.CLAIM_SELECTOR()));
        vm.prank(address(entryPoint));
        (bytes memory context, uint256 validationData) =
            paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
        assertEq(context.length, 0);
        assertEq(validationData, 0, "must validate with no time range");
        assertEq(paymaster.opsSponsored(reader), 1);
    }

    /// @notice An open paymaster is a faucet — only the treasury may be targeted.
    function test_RejectsForeignTarget() public {
        PackedUserOperation memory op = _userOp(reader, _executeCall(outsider, paymaster.CLAIM_SELECTOR()));
        vm.prank(address(entryPoint));
        vm.expectRevert(SyndixPaymaster.UnsupportedTarget.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
    }

    function test_RejectsForeignSelector() public {
        PackedUserOperation memory op = _userOp(
            reader, _executeCall(address(treasury), SyndixTreasury.withdrawTreasury.selector)
        );
        vm.prank(address(entryPoint));
        vm.expectRevert(SyndixPaymaster.UnsupportedSelector.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
    }

    function test_EnforcesPerSenderQuota() public {
        vm.prank(owner);
        paymaster.setMaxOpsPerSender(2);

        PackedUserOperation memory op = _userOp(reader, _executeCall(address(treasury), paymaster.CLAIM_SELECTOR()));
        vm.startPrank(address(entryPoint));
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
        vm.expectRevert(SyndixPaymaster.SenderQuotaExceeded.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
        vm.stopPrank();
    }

    function test_PauseStopsSponsorship() public {
        vm.prank(owner);
        paymaster.setSponsorshipEnabled(false);

        PackedUserOperation memory op = _userOp(reader, _executeCall(address(treasury), paymaster.CLAIM_SELECTOR()));
        vm.prank(address(entryPoint));
        vm.expectRevert(SyndixPaymaster.SponsorshipDisabled.selector);
        paymaster.validatePaymasterUserOp(op, bytes32(0), 1e15);
    }

    /* ------------------------------------------------------------------ */
    /*  Funding                                                           */
    /* ------------------------------------------------------------------ */

    function test_DepositReachesEntryPoint() public {
        vm.prank(owner);
        paymaster.deposit{value: 1 ether}();
        assertEq(paymaster.depositBalance(), 1 ether);
    }

    function test_BareTransferBecomesDeposit() public {
        vm.prank(owner);
        (bool ok, ) = address(paymaster).call{value: 0.5 ether}("");
        assertTrue(ok);
        assertEq(paymaster.depositBalance(), 0.5 ether);
    }

    function test_StakeAndWithdrawOnlyOwner() public {
        vm.prank(owner);
        paymaster.addStake{value: 1 ether}(86_400);
        assertEq(entryPoint.stakeOf(address(paymaster)), 1 ether);

        vm.prank(outsider);
        vm.expectRevert();
        paymaster.addStake{value: 1 ether}(86_400);
    }

    function test_WithdrawDepositOnlyOwner() public {
        vm.prank(owner);
        paymaster.deposit{value: 1 ether}();

        vm.prank(outsider);
        vm.expectRevert();
        paymaster.withdrawDeposit(payable(outsider), 1 ether);

        address payable sink = payable(makeAddr("sink"));
        vm.prank(owner);
        paymaster.withdrawDeposit(sink, 1 ether);
        assertEq(sink.balance, 1 ether);
    }
}
