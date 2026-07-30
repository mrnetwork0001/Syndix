// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev ERC-4337 v0.7 user operation. Declared locally so this contract carries
 *      no account-abstraction package dependency, while still letting the
 *      compiler do the calldata decoding — hand-rolled offset arithmetic in a
 *      paymaster is precisely where deposits get drained.
 */
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

interface IEntryPoint {
    function depositTo(address account) external payable;
    function balanceOf(address account) external view returns (uint256);
    function withdrawTo(address payable withdrawAddress, uint256 amount) external;
    function addStake(uint32 unstakeDelaySec) external payable;
    function unlockStake() external;
    function withdrawStake(address payable withdrawAddress) external;
}

/**
 * @title SyndixPaymaster
 * @notice ERC-4337 v0.7 paymaster that sponsors reader reward claims on GIWA.
 *
 * @dev The point is to remove the last friction from the reader's path: a
 *      first-time reader has no ETH, so asking them to fund gas before they can
 *      collect a $0.10 reward is the whole funnel lost. GIWA predeploys the
 *      v0.7 EntryPoint at genesis, so this needs no infrastructure beyond a
 *      deposit and a stake.
 *
 *      Scope is deliberately narrow. This paymaster sponsors calls to ONE
 *      target contract and ONE selector — SyndixTreasury.claimReaderReward —
 *      because an open paymaster is a faucet for anyone who can craft a
 *      UserOperation, and the deposit would be drained by unrelated calls.
 *
 *      Validation is intentionally cheap: EntryPoint charges the paymaster for
 *      validation gas whether or not the op succeeds, so the checks are a
 *      selector match and a per-sender cap, not a simulation.
 */
contract SyndixPaymaster is Ownable {
    /// @notice EntryPoint v0.7, predeployed on GIWA at genesis.
    IEntryPoint public immutable entryPoint;

    /// @notice The only contract this paymaster will sponsor calls to.
    address public immutable treasury;

    /**
     * @notice `SyndixTreasury.claimReaderReward(uint256,uint32,uint256,bytes)`.
     * @dev Asserted against the live function in SyndixPaymaster.t.sol — a wrong
     *      selector here silently rejects every legitimate claim.
     */
    bytes4 public constant CLAIM_SELECTOR = 0x47a5f91b;

    /// @notice Max ops sponsored per sender. One reward claim needs one op.
    uint32 public maxOpsPerSender = 8;

    /// @notice Sponsorship can be paused without withdrawing the deposit.
    bool public sponsorshipEnabled = true;

    mapping(address sender => uint32 count) public opsSponsored;

    event Sponsored(address indexed sender, uint256 maxCost);
    event SponsorshipToggled(bool enabled);
    event MaxOpsUpdated(uint32 maxOps);

    error OnlyEntryPoint();
    error SponsorshipDisabled();
    error UnsupportedTarget();
    error UnsupportedSelector();
    error SenderQuotaExceeded();
    error TransferFailed();

    constructor(address initialOwner, IEntryPoint entryPoint_, address treasury_)
        Ownable(initialOwner)
    {
        entryPoint = entryPoint_;
        treasury = treasury_;
    }

    /* ------------------------------------------------------------------ */
    /*  Validation                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * @notice EntryPoint v0.7 validation hook.
     * @dev Returns empty context and validationData 0, meaning "valid, no time
     *      range". Reverting here rejects the op.
     *
     *      Only `sender` and `callData` are inspected. Everything else in the
     *      op is the EntryPoint's and the account's business.
     */
    function validatePaymasterUserOp(
        PackedUserOperation calldata userOp,
        bytes32,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
        if (!sponsorshipEnabled) revert SponsorshipDisabled();

        address sender = userOp.sender;

        // A v0.7 account executes through `execute(address,uint256,bytes)`, so
        // the sponsored call's real target and selector live inside callData.
        (address target, bytes4 innerSelector) = _decodeExecute(userOp.callData);
        if (target != treasury) revert UnsupportedTarget();
        if (innerSelector != CLAIM_SELECTOR) revert UnsupportedSelector();

        uint32 used = opsSponsored[sender];
        if (used >= maxOpsPerSender) revert SenderQuotaExceeded();
        opsSponsored[sender] = used + 1;

        emit Sponsored(sender, maxCost);
        return ("", 0);
    }

    /// @notice v0.7 post-op hook. Nothing to settle — sponsorship is unconditional.
    function postOp(uint8, bytes calldata, uint256, uint256) external view {
        if (msg.sender != address(entryPoint)) revert OnlyEntryPoint();
    }

    /* ------------------------------------------------------------------ */
    /*  Calldata decoding                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * @dev Extracts the target and selector from `execute(address,uint256,bytes)`.
     *      Reverts on anything shorter, which rejects batched or unknown shapes
     *      rather than sponsoring something unexamined.
     */
    function _decodeExecute(bytes calldata callData)
        private
        pure
        returns (address target, bytes4 innerSelector)
    {
        if (callData.length < 4 + 32 + 32 + 32) revert UnsupportedSelector();
        target = address(uint160(uint256(bytes32(callData[4:36]))));
        uint256 innerOffset = uint256(bytes32(callData[68:100]));
        uint256 innerStart = 4 + innerOffset + 32;
        if (callData.length < innerStart + 4) revert UnsupportedSelector();
        innerSelector = bytes4(callData[innerStart:innerStart + 4]);
    }

    /* ------------------------------------------------------------------ */
    /*  Funding                                                           */
    /* ------------------------------------------------------------------ */

    /// @notice Fund the EntryPoint deposit this paymaster spends from.
    function deposit() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }

    function depositBalance() external view returns (uint256) {
        return entryPoint.balanceOf(address(this));
    }

    /// @notice Bundlers require a staked paymaster before they will relay ops.
    function addStake(uint32 unstakeDelaySec) external payable onlyOwner {
        entryPoint.addStake{value: msg.value}(unstakeDelaySec);
    }

    function unlockStake() external onlyOwner {
        entryPoint.unlockStake();
    }

    function withdrawStake(address payable to) external onlyOwner {
        entryPoint.withdrawStake(to);
    }

    function withdrawDeposit(address payable to, uint256 amount) external onlyOwner {
        entryPoint.withdrawTo(to, amount);
    }

    /* ------------------------------------------------------------------ */
    /*  Admin                                                             */
    /* ------------------------------------------------------------------ */

    function setSponsorshipEnabled(bool enabled) external onlyOwner {
        sponsorshipEnabled = enabled;
        emit SponsorshipToggled(enabled);
    }

    function setMaxOpsPerSender(uint32 maxOps) external onlyOwner {
        maxOpsPerSender = maxOps;
        emit MaxOpsUpdated(maxOps);
    }

    /// @notice Rescue ETH sent directly here rather than through `deposit`.
    function sweep(address payable to) external onlyOwner {
        (bool ok, ) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {
        entryPoint.depositTo{value: msg.value}(address(this));
    }
}
