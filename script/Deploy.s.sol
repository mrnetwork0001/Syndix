// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {SyndixTreasury} from "../contracts/SyndixTreasury.sol";
import {SyndixArticleNFT} from "../contracts/SyndixArticleNFT.sol";
import {UpIdReaderRegistry, IUpnameRegistry} from "../contracts/UpIdReaderRegistry.sol";
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
 *   READER_REGISTRY      optional; an existing IReaderRegistry to reuse. When
 *                        unset, a UpIdReaderRegistry is deployed over the live
 *                        Upbit Web3 Names registry, so the sybil gate is the
 *                        real ecosystem one by default rather than a mock.
 *   UPNAME_REGISTRY      optional; the Upbit Web3 Names ERC-721 the adapter
 *                        reads. Defaults to the GIWA Sepolia deployment.
 */
contract Deploy is Script {
    /// @dev Upbit Web3 Names (UPNAME) on GIWA Sepolia - the ecosystem registry.
    address internal constant UPNAME_SEPOLIA =
        0x091D00004f21eb2Fc30964A8a4995692d9b49628;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        address owner = vm.envOr("OWNER", deployer);
        address attester = vm.envOr("READ_ATTESTER", deployer);
        address registryAddr = vm.envOr("READER_REGISTRY", address(0));

        vm.startBroadcast(deployerKey);

        if (registryAddr == address(0)) {
            address upname = vm.envOr("UPNAME_REGISTRY", UPNAME_SEPOLIA);
            UpIdReaderRegistry adapter =
                new UpIdReaderRegistry(IUpnameRegistry(upname));
            registryAddr = address(adapter);
            console.log("UpIdReaderRegistry", registryAddr);
            console.log("  -> gates on the real Upbit Web3 Names registry");
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
