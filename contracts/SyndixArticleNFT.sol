// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";

/**
 * @title SyndixArticleNFT
 * @notice Collectible open editions for each Syndix issue on GIWA.
 *
 * @dev Two-level model, which is what makes this cheap enough to be worth
 *      minting on every issue:
 *        - an *edition* is registered once per issue and stores the metadata
 *          URI (one SSTORE-heavy write, paid by the publisher);
 *        - a *collect* mints a sequential tokenId that merely points at its
 *          edition (one cheap write, paid by the reader).
 *
 *      On a 1s-block L2 with sub-cent fees this makes "collect the issue" a
 *      genuine consumer action rather than a $4 gas decision.
 */
contract SyndixArticleNFT is ERC721, Ownable, ReentrancyGuard {
    using Strings for uint256;

    struct Edition {
        string metadataURI; // ipfs://… JSON for the issue
        uint96 price; // wei per collect; 0 = free
        uint32 maxSupply; // 0 = open edition
        uint32 minted;
        uint64 opensAt;
        bool active;
    }

    /// @notice Issue id => edition config.
    mapping(uint256 issueId => Edition) public editions;

    /// @notice tokenId => the issue it represents.
    mapping(uint256 tokenId => uint256 issueId) public tokenIssue;

    /// @notice Issue id => whether an address has already collected it.
    mapping(uint256 issueId => mapping(address collector => bool)) public hasCollected;

    uint256 public totalMinted;
    uint256 public editionCount;

    /// @notice Where collect proceeds are forwarded — normally SyndixTreasury.
    address payable public treasury;

    event EditionRegistered(
        uint256 indexed issueId,
        string metadataURI,
        uint96 price,
        uint32 maxSupply
    );
    event EditionUpdated(uint256 indexed issueId, bool active, uint96 price);
    event Collected(
        uint256 indexed issueId,
        uint256 indexed tokenId,
        address indexed collector,
        uint256 pricePaid
    );
    event TreasuryUpdated(address indexed previous, address indexed next);

    error EditionExists();
    error EditionMissing();
    error EmptyMetadataURI();
    error EditionClosed();
    error EditionNotOpenYet();
    error EditionSoldOut();
    error AlreadyCollected();
    error WrongPayment(uint256 sent, uint256 required);
    error TransferFailed();
    error ZeroAddress();

    constructor(address initialOwner, address payable treasury_)
        ERC721("Syndix Issue", "SYNDIX")
        Ownable(initialOwner)
    {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
    }

    /* ------------------------------------------------------------------ */
    /*  Publisher                                                         */
    /* ------------------------------------------------------------------ */

    function registerEdition(
        uint256 issueId,
        string calldata metadataURI,
        uint96 price,
        uint32 maxSupply,
        uint64 opensAt
    ) external onlyOwner {
        // An empty URI is silently corrupting: `metadataURI.length == 0` is also
        // how this contract represents "no edition", so an empty write both
        // mints unusable tokens and leaves the slot re-registerable. There is no
        // setter for metadataURI by design, so it must be right on first write.
        if (bytes(metadataURI).length == 0) revert EmptyMetadataURI();
        if (bytes(editions[issueId].metadataURI).length != 0) revert EditionExists();

        editions[issueId] = Edition({
            metadataURI: metadataURI,
            price: price,
            maxSupply: maxSupply,
            minted: 0,
            opensAt: opensAt == 0 ? uint64(block.timestamp) : opensAt,
            active: true
        });
        unchecked {
            ++editionCount;
        }

        emit EditionRegistered(issueId, metadataURI, price, maxSupply);
    }

    function setEditionState(uint256 issueId, bool active, uint96 price) external onlyOwner {
        Edition storage edition = editions[issueId];
        if (bytes(edition.metadataURI).length == 0) revert EditionMissing();
        edition.active = active;
        edition.price = price;
        emit EditionUpdated(issueId, active, price);
    }

    function setTreasury(address payable next) external onlyOwner {
        if (next == address(0)) revert ZeroAddress();
        emit TreasuryUpdated(treasury, next);
        treasury = next;
    }

    /* ------------------------------------------------------------------ */
    /*  Reader                                                            */
    /* ------------------------------------------------------------------ */

    /// @notice Mint the collectible edition of an issue. One per wallet.
    function collect(uint256 issueId) external payable nonReentrant returns (uint256 tokenId) {
        Edition storage edition = editions[issueId];
        if (bytes(edition.metadataURI).length == 0) revert EditionMissing();
        if (!edition.active) revert EditionClosed();
        if (block.timestamp < edition.opensAt) revert EditionNotOpenYet();
        if (hasCollected[issueId][msg.sender]) revert AlreadyCollected();
        if (edition.maxSupply != 0 && edition.minted >= edition.maxSupply) {
            revert EditionSoldOut();
        }
        if (msg.value != edition.price) revert WrongPayment(msg.value, edition.price);

        hasCollected[issueId][msg.sender] = true;
        unchecked {
            ++edition.minted;
            tokenId = ++totalMinted;
        }
        tokenIssue[tokenId] = issueId;

        _safeMint(msg.sender, tokenId);

        if (msg.value != 0) {
            (bool ok, ) = treasury.call{value: msg.value}("");
            if (!ok) revert TransferFailed();
        }

        emit Collected(issueId, tokenId, msg.sender, msg.value);
    }

    /* ------------------------------------------------------------------ */
    /*  Metadata                                                          */
    /* ------------------------------------------------------------------ */

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        return editions[tokenIssue[tokenId]].metadataURI;
    }

    function editionSupply(uint256 issueId) external view returns (uint32 minted, uint32 max) {
        Edition storage edition = editions[issueId];
        return (edition.minted, edition.maxSupply);
    }
}
