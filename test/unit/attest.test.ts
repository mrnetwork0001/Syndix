import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";
import {
  READ_PROOF_DOMAIN_NAME,
  READ_PROOF_DOMAIN_VERSION,
  READ_PROOF_TYPES,
  readProofDomain,
} from "@/lib/attest";
import { GIWA_SEPOLIA_ID } from "@/lib/giwa";

/**
 * The highest-value test in the repo.
 *
 * If the EIP-712 type string in lib/attest.ts ever drifts from the typehash in
 * SyndixTreasury.sol, every signature recovers to the wrong address and every
 * claim reverts with InvalidAttestation - at runtime, on chain, with nothing in
 * TypeScript to catch it. This reconstructs the type string from our own
 * definition and asserts it against the contract source.
 */

const SOLIDITY = readFileSync("contracts/SyndixTreasury.sol", "utf8");

function encodeType(primary: keyof typeof READ_PROOF_TYPES): string {
  const fields = READ_PROOF_TYPES[primary];
  return `${primary}(${fields.map((f) => `${f.type} ${f.name}`).join(",")})`;
}

describe("ReadProof EIP-712 definition", () => {
  it("reconstructs the exact type string the contract hashes", () => {
    const encoded = encodeType("ReadProof");
    expect(encoded).toBe(
      "ReadProof(uint256 articleId,address reader,uint32 dwellSeconds,uint256 deadline)",
    );
  });

  it("matches the READ_PROOF_TYPEHASH literal in SyndixTreasury.sol", () => {
    // Pull the string the contract actually keccak256's.
    const match = SOLIDITY.match(
      /READ_PROOF_TYPEHASH\s*=\s*keccak256\(\s*"([^"]+)"/s,
    );
    expect(match, "READ_PROOF_TYPEHASH literal not found in contract").toBeTruthy();

    const contractTypeString = match![1];
    expect(encodeType("ReadProof")).toBe(contractTypeString);
    // And the derived hashes agree, which is what actually matters on chain.
    expect(keccak256(toHex(encodeType("ReadProof")))).toBe(
      keccak256(toHex(contractTypeString)),
    );
  });

  it("uses the domain OpenZeppelin's EIP712 constructor was given", () => {
    const ctor = SOLIDITY.match(/EIP712\(\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\)/);
    expect(ctor, "EIP712 constructor args not found").toBeTruthy();
    expect(READ_PROOF_DOMAIN_NAME).toBe(ctor![1]);
    expect(READ_PROOF_DOMAIN_VERSION).toBe(ctor![2]);
  });

  it("pins the domain to GIWA Sepolia and the verifying contract", () => {
    const verifying = "0x5465f31a6155E3eCCcC35f4E5bDC0e287763B0ee" as const;
    const domain = readProofDomain(verifying);
    expect(domain.chainId).toBe(GIWA_SEPOLIA_ID);
    expect(domain.chainId).toBe(91342);
    expect(domain.verifyingContract).toBe(verifying);
  });
});
