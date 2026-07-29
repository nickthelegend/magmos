#!/usr/bin/env node
// Propagate a deployment to every consumer, so addresses and ABIs can never drift.
//
// Before this existed, shipping a contract change meant hand-copying an ABI array out of
// contracts/out into TWO apps and editing address fallbacks in two more files — the exact kind of
// chore that silently rots. Now:
//
//   node scripts/sync-chain.mjs                  # ABIs + addresses from deployments/*.json
//   node scripts/sync-chain.mjs --check          # verify only, non-zero exit on drift (CI)
//
// Reads contracts/deployments/arc-testnet.json as the source of truth.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const CHECK = process.argv.includes("--check");
const DEPLOYMENTS = join(ROOT, "contracts/deployments/arc-testnet.json");
const OUT = join(ROOT, "contracts/out");

const CONTRACTS = [
  "MagmosPayroll",
  "MagmosAdvance",
  "MagmosRegistry",
  "MagmosVault",
  "MagmosYieldVault",
];

// Which ABIs each app actually imports (keeps bundles honest).
const ABI_TARGETS = [
  { dir: join(ROOT, "app/lib/abi"), names: CONTRACTS },
  {
    dir: join(ROOT, "employee/src/lib/abi"),
    names: ["MagmosPayroll", "MagmosAdvance", "MagmosRegistry", "MagmosVault"],
  },
];

// address fallback constants → deployment key
const ADDRESS_FILES = [
  join(ROOT, "app/lib/magmos.ts"),
  join(ROOT, "employee/src/lib/magmos.ts"),
];
const ADDRESS_MAP = {
  MAGMOS_PAYROLL: "MagmosPayroll",
  MAGMOS_ADVANCE: "MagmosAdvance",
  MAGMOS_REGISTRY: "MagmosRegistry",
  MAGMOS_VAULT: "MagmosVault",
  MAGMOS_YIELD_VAULT: "MagmosYieldVault",
};

const ENV_FILES = [
  join(ROOT, "app/.env.local"),
  join(ROOT, "app/.env.example"),
  join(ROOT, "employee/.env.local"),
  join(ROOT, "employee/.env.example"),
];
const ENV_MAP = {
  NEXT_PUBLIC_MAGMOS_PAYROLL: "MagmosPayroll",
  NEXT_PUBLIC_MAGMOS_ADVANCE: "MagmosAdvance",
  NEXT_PUBLIC_MAGMOS_REGISTRY: "MagmosRegistry",
  NEXT_PUBLIC_MAGMOS_VAULT: "MagmosVault",
  NEXT_PUBLIC_MAGMOS_YIELD: "MagmosYieldVault",
  NEXT_PUBLIC_USDC: "USDC",
};

if (!existsSync(DEPLOYMENTS)) {
  console.error(`✗ missing ${DEPLOYMENTS}`);
  process.exit(1);
}
const deployed = JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));

const drift = [];
const changed = [];

function writeOrCheck(path, next, label) {
  const prev = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (prev === next) return;
  if (CHECK) drift.push(label);
  else {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, next);
    changed.push(label);
  }
}

// ---- 1. ABIs -------------------------------------------------------------
for (const name of CONTRACTS) {
  const artifact = join(OUT, `${name}.sol`, `${name}.json`);
  if (!existsSync(artifact)) {
    console.warn(`  ! no artifact for ${name} (run: cd contracts && forge build)`);
    continue;
  }
  const abi = JSON.parse(readFileSync(artifact, "utf8")).abi;
  const body = JSON.stringify(abi, null, 2) + "\n";
  for (const t of ABI_TARGETS) {
    if (!t.names.includes(name)) continue;
    writeOrCheck(join(t.dir, `${name}.json`), body, `abi ${name} → ${t.dir.replace(ROOT + "/", "")}`);
  }
}

// ---- 2. address fallbacks in magmos.ts ----------------------------------
for (const file of ADDRESS_FILES) {
  if (!existsSync(file)) continue;
  let src = readFileSync(file, "utf8");
  for (const [constName, key] of Object.entries(ADDRESS_MAP)) {
    const addr = deployed[key];
    if (!addr) continue;
    // `export const X = (process.env.Y || '0x…') as `0x${string}``
    const re = new RegExp(
      `(export const ${constName} = \\(process\\.env\\.[A-Z_0-9]+ \\|\\|\\s*\\n?\\s*')0x[0-9a-fA-F]{40}(')`,
      "m"
    );
    src = src.replace(re, `$1${addr}$2`);
  }
  writeOrCheck(file, src, `addresses → ${file.replace(ROOT + "/", "")}`);
}

// ---- 3. env files -------------------------------------------------------
for (const file of ENV_FILES) {
  if (!existsSync(file)) continue;
  let src = readFileSync(file, "utf8");
  for (const [envName, key] of Object.entries(ENV_MAP)) {
    const addr = deployed[key];
    if (!addr) continue;
    if (new RegExp(`^${envName}=`, "m").test(src)) {
      src = src.replace(new RegExp(`^${envName}=.*$`, "m"), `${envName}=${addr}`);
    } else {
      src = src.trimEnd() + `\n${envName}=${addr}\n`;
    }
  }
  writeOrCheck(file, src, `env → ${file.replace(ROOT + "/", "")}`);
}

// ---- report -------------------------------------------------------------
if (CHECK) {
  if (drift.length) {
    console.error(`✗ ${drift.length} file(s) out of sync with the deployment:`);
    for (const d of drift) console.error(`   ${d}`);
    console.error("\n  fix: node scripts/sync-chain.mjs");
    process.exit(1);
  }
  console.log("✓ ABIs and addresses match contracts/deployments/arc-testnet.json");
} else {
  if (!changed.length) console.log("✓ already in sync — nothing to write");
  else {
    console.log(`✓ synced ${changed.length} file(s):`);
    for (const c of changed) console.log(`   ${c}`);
  }
  console.log(`\n  payroll  ${deployed.MagmosPayroll}`);
  console.log(`  advance  ${deployed.MagmosAdvance}`);
}
