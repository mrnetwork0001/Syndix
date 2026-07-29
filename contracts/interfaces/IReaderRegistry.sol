// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IReaderRegistry
 * @notice Sybil gate for the Syndix reward pool.
 *
 * GIWA's native identity primitive is Upbit Web3 Names — `username.up.id`,
 * ENS subdomains issued as Soul-Bound Tokens to Dojang Verified Addresses,
 * hard-capped at one name per wallet.
 *
 * That one-per-wallet cap is the entire security model for reader rewards.
 * Without it, `claimReaderReward` is a faucet: a script generates 10,000 EOAs
 * and drains every pool in a single GIWA block (1s block time, negligible gas).
 *
 * This interface is deliberately thin so the deployment can point at:
 *   - the live up.id resolver on GIWA,
 *   - a Dojang EAS attestation reader, or
 *   - a mock registry for local testing.
 */
interface IReaderRegistry {
    /// @notice True if `account` holds a verified, non-transferable GIWA identity.
    function isVerified(address account) external view returns (bool);

    /// @notice The account's canonical name, e.g. "alice.up.id". Empty if none.
    function nameOf(address account) external view returns (string memory);
}
