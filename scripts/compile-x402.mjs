// Compile the x402 settlement contracts (AgentToken + AgentPayments) with
// solc (npm package, JS API), writing {abi, bytecode} artifacts to
// scripts/artifacts/.
//
//   node scripts/compile-x402.mjs
//
// Artifacts are consumed by scripts/deploy-x402.mjs and the app's in-browser
// "deploy your own pool" flow (optional).

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "scripts", "artifacts");

const sources = {
  "AgentToken.sol": {
    content: readFileSync(join(root, "contracts", "AgentToken.sol"), "utf8"),
  },
  "AgentPayments.sol": {
    content: readFileSync(join(root, "contracts", "AgentPayments.sol"), "utf8"),
  },
};

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

console.log("Compiling contracts with solc (JS API)…");
const output = JSON.parse(solc.compile(JSON.stringify(input)));

if (output.errors) {
  const fatal = output.errors.filter((e) => e.severity === "error");
  if (fatal.length) {
    console.error(fatal.map((e) => e.formattedMessage).join("\n"));
    process.exit(1);
  }
}

mkdirSync(outDir, { recursive: true });
for (const [file, contracts] of Object.entries(output.contracts)) {
  for (const [name, artifact] of Object.entries(contracts)) {
    const filePath = join(outDir, `${name}.json`);
    writeFileSync(
      filePath,
      JSON.stringify(
        { contractName: name, abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` },
        null,
        2,
      ),
    );
    console.log(`✓ ${name} → ${filePath}`);
  }
}

console.log("\nDone. Next: DEPLOYER_PRIVATE_KEY=0x... node scripts/deploy-x402.mjs");
