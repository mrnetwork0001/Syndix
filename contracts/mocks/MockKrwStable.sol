// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockKrwStable
 * @notice Stand-in for GIWA's forthcoming KRW stablecoin.
 *
 * @dev Two decimals, not eighteen. A won is not meaningfully divisible below a
 *      jeon, and the whole point of denominating rewards in KRW is that ₩100
 *      reads as ₩100 — so the mock uses the decimal precision the real thing is
 *      likely to have, rather than defaulting to 18 and letting the treasury
 *      accidentally depend on ETH-shaped magnitudes.
 *
 *      Test and design use only.
 */
contract MockKrwStable is ERC20 {
    constructor() ERC20("Mock Korean Won", "KRWm") {}

    function decimals() public pure override returns (uint8) {
        return 2;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
