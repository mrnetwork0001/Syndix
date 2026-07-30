import { readFileSync, writeFileSync } from "node:fs";

/**
 * Regenerates lib/abi.ts from the Foundry build artifacts in out/.
 * Run via `npm run abi` (which builds first).
 */

const CONTRACTS = ["SyndixTreasury", "SyndixArticleNFT", "UpIdReaderRegistry"];

const header = `/**
 * Auto-generated from \\\`forge build\\\` artifacts - do not hand-edit.
 * Regenerate with: npm run abi
 *
 * Exported \\\`as const\\\` so viem/wagmi infer argument and return types
 * directly from the ABI at the call site.
 */

`;

let source = header;

for (const name of CONTRACTS) {
  const artifactPath = `out/${name}.sol/${name}.json`;
  let abi;
  try {
    abi = JSON.parse(readFileSync(artifactPath, "utf8")).abi;
  } catch {
    console.error(`Missing artifact ${artifactPath} - run \`forge build\` first.`);
    process.exit(1);
  }
  const varName = `${name.charAt(0).toLowerCase()}${name.slice(1)}Abi`;
  source += `export const ${varName} = ${JSON.stringify(abi, null, 2)} as const;\n\n`;
}

writeFileSync("lib/abi.ts", source);
console.log(`Wrote lib/abi.ts (${(source.length / 1024).toFixed(1)}KB) from ${CONTRACTS.length} artifacts.`);
