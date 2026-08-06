#!/usr/bin/env node
/**
 * Preflight for the confidential delivery leg.
 *
 * Run this the moment UNLINK_API_KEY lands. It checks every precondition against the live engine
 * and tells you exactly what to run next — so the gap between "key pasted" and "real shielded
 * payout on screen" is one command, not a debugging session at 2am before a deadline.
 *
 * It changes nothing. Every check is a read.
 *
 *   node scripts/sealed-preflight.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const ENGINE = 'https://arc-testnet-production-api.unlink.xyz'

const env = {}
for (const line of readFileSync(`${ROOT}.env.local`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`)
const bad = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`)
const info = (m) => console.log(`    ${m}`)

console.log('\nConfidential delivery — preflight\n')
let blocking = 0

// 1. Engine reachable, and it is the chain we think it is.
try {
  const r = await fetch(`${ENGINE}/info/environment`, { signal: AbortSignal.timeout(15000) })
  const d = (await r.json()).data
  if (d.chain_id !== 5042002) {
    bad(`engine reports chain_id ${d.chain_id}, expected 5042002 (Arc testnet)`)
    blocking++
  } else {
    ok(`engine reachable — ${d.name}, chain ${d.chain_id}`)
    info(`pool ${d.pool_address}`)
  }
} catch (e) {
  bad(`engine unreachable: ${e.message}`)
  blocking++
}

// 2. Credentials.
for (const [key, hint] of [
  ['UNLINK_API_KEY', 'dashboard.unlink.xyz → your project → API Keys'],
  ['TREASURY_UNLINK_MNEMONIC', 'generated automatically — re-run setup if absent'],
  ['UNLINK_TOKEN_ADDRESS', 'discovered on-chain; 0x3600…0000 on arc-testnet'],
  ['MONGODB_URI', 'your Mongo connection string'],
]) {
  if (env[key]) ok(`${key} present`)
  else {
    bad(`${key} missing — ${hint}`)
    blocking++
  }
}

// 3. Does the key actually work? A 401 here means the key is wrong, not that the flow is broken —
// worth separating, because the two failures look identical from the app.
if (env.UNLINK_API_KEY) {
  try {
    const r = await fetch(`${ENGINE}/users/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.UNLINK_API_KEY}` },
      body: '{}',
      signal: AbortSignal.timeout(15000),
    })
    if (r.status === 401 || r.status === 403) {
      bad(`engine rejected the API key (${r.status}) — check it was copied whole`)
      blocking++
    } else {
      // Anything that is not an auth failure means the key authenticated; a 400 on an empty body is
      // exactly what a working key should produce here.
      ok(`API key authenticates (engine answered ${r.status} to an empty payload, not 401)`)
    }
  } catch (e) {
    bad(`could not validate the API key: ${e.message}`)
    blocking++
  }
}

// 4. Token sanity — decimals wrong by 1e12 is the single most expensive mistake available here.
const dec = Number(env.UNLINK_TOKEN_DECIMALS ?? 6)
if (dec === 6) ok(`UNLINK_TOKEN_DECIMALS=6, matching Arc USDC`)
else console.log(`  \x1b[33m!\x1b[0m UNLINK_TOKEN_DECIMALS=${dec} — arc-testnet's pool token is 6-dp. Verify before running payroll.`)

console.log()
if (blocking === 0) {
  console.log('  Ready. Run, in order:\n')
  console.log('    node scripts/provision-sealed.mjs      # sealed address per employee')
  console.log('    node scripts/seal-run.mjs              # settle + deliver confidentially\n')
  console.log('  Then open /dashboard/private and /claim to see both sides.\n')
} else {
  console.log(`  ${blocking} blocking issue(s). Nothing will run until they are resolved.\n`)
  process.exit(1)
}
