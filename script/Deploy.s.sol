// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SyndixTreasury} from "../contracts/SyndixTreasury.sol";
import {SyndixArticleNFT} from "../contracts/SyndixArticleNFT.sol";
import {MockUpIdRegistry} from "../contracts/mocks/MockUpIdRegistry.sol";
import {IReaderRegistry} from "../contracts/interfaces/IReaderRegistry.sol";

/**
 * @title Deploy
 * @notice Deploys the Syndix protocol to GIWA Sepolia (chain 91342).
 *
 * Usage:
 *   forge script script/Deploy.s.sol:Deploy \
 *     --rpc-url giwa_sepolia --broadcast -vvv
 *
 * Environment:
 *   PRIVATE_KEY          deployer key (also the initial owner unless OWNER is set)
 *   OWNER                optional; protocol owner, ideally a Safe
 *   READ_ATTESTER        optional; the key that signs EIP-712 ReadProofs.
 *                        Defaults to the deployer, which is fine for a testnet
 *                        demo but should be a separate hot key in production —
 *                        it is the one component that must live in the API.
 *   READER_REGISTRY      optional; the live up.id / Dojang resolver. When unset,
 *                        a MockUpIdRegistry is deployed so the sybil gate still
 *                        has something to enforce against on testnet.
 */
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address owner = vm.envOr("OWNER", deployer);
        address attester = vm.envOr("READ_ATTESTER", deployer);
        address registryAddr = vm.envOr("READER_REGISTRY", address(0));

        vm.startBroadcast(deployerKey);

        if (registryAddr == address(0)) {
            MockUpIdRegistry mock = new MockUpIdRegistry(owner);
            registryAddr = address(mock);
            console.log("MockUpIdRegistry  ", registryAddr);
            console.log("  -> testnet stand-in for the up.id resolver");
        } else {
            console.log("ReaderRegistry    ", registryAddr);
        }

        SyndixTreasury treasury =
            new SyndixTreasury(owner, attester, IReaderRegistry(registryAddr));
        console.log("SyndixTreasury    ", address(treasury));

        SyndixArticleNFT nft = new SyndixArticleNFT(owner, payable(address(treasury)));
        console.log("SyndixArticleNFT  ", address(nft));

        vm.stopBroadcast();

        console.log("");
        console.log("Add to .env.local:");
        console.log("NEXT_PUBLIC_SYNDIX_TREASURY=%s", address(treasury));
        console.log("NEXT_PUBLIC_SYNDIX_ARTICLE_NFT=%s", address(nft));
        console.log("");
        console.log("Owner    %s", owner);
        console.log("Attester %s", attester);
    }
}
