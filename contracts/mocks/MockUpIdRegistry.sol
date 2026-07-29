// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReaderRegistry} from "../interfaces/IReaderRegistry.sol";

/**
 * @title MockUpIdRegistry
 * @notice Stand-in for the live Upbit Web3 Names (`*.up.id`) resolver on GIWA.
 *
 * @dev Mirrors the two properties Syndix actually depends on:
 *        - one name per wallet,
 *        - names are non-transferable (there is no transfer function at all).
 *      Swap the deployment for the production up.id resolver — or a Dojang
 *      EAS attestation reader — with `SyndixTreasury.setReaderRegistry`.
 *      Test / demo use only.
 */
contract MockUpIdRegistry is IReaderRegistry, Ownable {
    mapping(address account => string name) private _names;
    mapping(bytes32 nameHash => address account) private _owners;

    uint256 public totalVerified;

    event NameIssued(address indexed account, string name);
    event NameRevoked(address indexed account, string name);

    error AlreadyNamed();
    error NameTaken();
    error EmptyName();
    error NotNamed();

    constructor(address initialOwner) Ownable(initialOwner) {}

    function issue(address account, string calldata name) external onlyOwner {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(_names[account]).length != 0) revert AlreadyNamed();

        bytes32 key = keccak256(bytes(name));
        if (_owners[key] != address(0)) revert NameTaken();

        _names[account] = name;
        _owners[key] = account;
        unchecked {
            ++totalVerified;
        }

        emit NameIssued(account, name);
    }

    /// @notice Self-service claim, for testnet faucet-style demos.
    function claimName(string calldata name) external {
        if (bytes(name).length == 0) revert EmptyName();
        if (bytes(_names[msg.sender]).length != 0) revert AlreadyNamed();

        bytes32 key = keccak256(bytes(name));
        if (_owners[key] != address(0)) revert NameTaken();

        _names[msg.sender] = name;
        _owners[key] = msg.sender;
        unchecked {
            ++totalVerified;
        }

        emit NameIssued(msg.sender, name);
    }

    function revoke(address account) external onlyOwner {
        string memory name = _names[account];
        if (bytes(name).length == 0) revert NotNamed();

        delete _owners[keccak256(bytes(name))];
        delete _names[account];
        unchecked {
            --totalVerified;
        }

        emit NameRevoked(account, name);
    }

    function isVerified(address account) external view returns (bool) {
        return bytes(_names[account]).length != 0;
    }

    function nameOf(address account) external view returns (string memory) {
        return _names[account];
    }

    function resolve(string calldata name) external view returns (address) {
        return _owners[keccak256(bytes(name))];
    }
}
