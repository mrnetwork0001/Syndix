// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IReaderRegistry} from "./interfaces/IReaderRegistry.sol";

interface IUpnameRegistry {
    function balanceOf(address owner) external view returns (uint256);
}

/**
 * @title UpIdReaderRegistry
 * @notice Adapter that lets SyndixTreasury gate claims on the REAL Upbit Web3
 *         Names registry instead of a mock.
 *
 * @dev This is the point of `IReaderRegistry` being a thin interface: the
 *      treasury never needed to know what backs it.
 *
 *      The live registry on GIWA Sepolia is
 *      `0x091D00004f21eb2Fc30964A8a4995692d9b49628` — an ERC-1967 proxy over
 *      `UpnameRegistry`, ERC-721 "Upbit Web3 Names" (UPNAME), with over half a
 *      million transactions. Names are issued through the GIWA playground flow:
 *      Dojang attestation, then VerifiedToken, then registration.
 *
 *      WHY `nameOf` RETURNS EMPTY
 *
 *      The registry is an ERC-721 whose tokenId is keccak256 of the label
 *      alone - the ENS labelhash, not the namehash. It is not
 *      ERC-721Enumerable — `tokenOfOwnerByIndex` reverts and
 *      `supportsInterface(0x780e9d63)` is false — so there is no on-chain path
 *      from an address to the tokenId it holds. The human-readable label lives
 *      off-chain, behind `tokenURI` at `sepolia-id.giwa.io/metadata/<tokenId>`.
 *
 *      So this adapter answers the question the treasury actually needs —
 *      "does this address hold a verified GIWA identity?" — and returns an empty
 *      string for the label rather than inventing one or guessing a keccak
 *      preimage. The UI resolves the display name from token metadata, where it
 *      genuinely lives. `SyndixTreasury` already tolerates an empty identity: it
 *      only writes `readerIdentity` when the string is non-empty.
 *
 *      Verification is what carries the security property, not the label. One
 *      name per verified wallet is what makes the reward pool sybil-resistant,
 *      and `balanceOf(reader) > 0` tests exactly that.
 */
contract UpIdReaderRegistry is IReaderRegistry {
    /// @notice The live Upbit Web3 Names ERC-721.
    IUpnameRegistry public immutable upname;

    error ZeroAddress();

    constructor(IUpnameRegistry upname_) {
        if (address(upname_) == address(0)) revert ZeroAddress();
        upname = upname_;
    }

    /// @inheritdoc IReaderRegistry
    function isVerified(address account) external view returns (bool) {
        // A holder of a soul-bound up.id has balance 1. Non-holders have 0.
        return upname.balanceOf(account) > 0;
    }

    /**
     * @inheritdoc IReaderRegistry
     * @dev Always empty — see the contract-level note. The registry exposes no
     *      on-chain address-to-label lookup, and fabricating one here would put
     *      a wrong name on a reward event permanently.
     */
    function nameOf(address) external pure returns (string memory) {
        return "";
    }
}
