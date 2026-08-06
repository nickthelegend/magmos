#!/usr/bin/env node
/**
 * Provision a sealed payout address for every employee on an org's roster.
 *
 * The employer runs this once at hire time. For each employee it mints a fresh Unlink account,
 * registers it with the engine, stores the `unlink1…` address on the employee record, and stashes
 * the recovery phrase in a claim envelope that the employee opens exactly once from their portal.
 *
 * Why the phrase is kept at all: a recipient who cannot spend a sealed balance has no way to send it
 * home, which removes the entire point. Why it is kept *separately* and deleted on claim: the
 * employer holding it indefinitely would make "confidential payroll" a claim the employer could
 * quietly break. The window between provisioning and claiming is the honest caveat, and the schema
 * makes it visible rather than hiding it.
 *
 * Usage (from app/):
 *   node scripts/provision-sealed.mjs                # provision anyone missing an address
 *   node scripts/provision-sealed.mjs --dry-run      # show what would happen, touch nothing
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { MongoClient } from 'mongodb'

// fileURLToPath, not .pathname — this repo lives under a path containing a space, and .pathname
// leaves it %20-encoded, which fs cannot open.
const ROOT = fileURLToPath(new URL('../', import.meta.url))

// Load .env.local by hand: this is a plain node script, not a Next runtime.
const env = {}
for (const line of readFileSync(`${ROOT}.env.local`, 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const DRY = process.argv.includes('--dry-run')
const ORG = (process.env.ORG_WALLET || '0xF1a800BA07Bd0b55Dce43be2e837933AF3e53226').toLowerCase()

const missing = ['UNLINK_API_KEY', 'MONGODB_URI'].filter((k) => !env[k])
if (missing.length) {
  console.error(`\n✗ Missing ${missing.join(', ')} in app/.env.local`)
  console.error('  UNLINK_API_KEY comes from dashboard.unlink.xyz → your project → API Keys.')
  console.error('  Nothing was written. This script does not invent addresses.\n')
  process.exit(1)
}

const { createUnlinkAdmin } = await import('@unlink-xyz/sdk/admin')
const { account } = await import('@unlink-xyz/sdk/client')
const { generateMnemonic, english } = await import('viem/accounts')

const admin = createUnlinkAdmin({ environment: 'arc-testnet', apiKey: env.UNLINK_API_KEY })

const mongo = new MongoClient(env.MONGODB_URI)
await mongo.connect()
const db = mongo.db(env.MONGODB_DB || 'magmos')

const roster = await db.collection('employees').find({ orgWallet: ORG }).toArray()
if (roster.length === 0) {
  console.log(`\n  No employees on the roster for ${ORG}. Nothing to do.\n`)
  await mongo.close()
  process.exit(0)
}

console.log(`\nProvisioning sealed payout addresses — org ${ORG}`)
console.log(`  engine  : arc-testnet (https://arc-testnet-production-api.unlink.xyz)`)
console.log(`  roster  : ${roster.length} employee(s)${DRY ? '   [DRY RUN]' : ''}\n`)

let created = 0
let skipped = 0

for (const emp of roster) {
  const label = emp.name || emp.walletAddress
  if (emp.sealedTo) {
    console.log(`  – ${label}\n      already has ${emp.sealedTo}`)
    skipped++
    continue
  }
  if (DRY) {
    console.log(`  + ${label}\n      would mint and register a fresh sealed address`)
    created++
    continue
  }

  const mnemonic = generateMnemonic(english)
  const acct = account.fromMnemonic({ mnemonic })
  const address = await acct.getAddress()

  // Idempotent for the same key material, so a re-run after a crash is safe.
  await admin.users.register(await account.toRegistrationPayload(acct))

  await db
    .collection('employees')
    .updateOne(
      { orgWallet: ORG, walletAddress: emp.walletAddress },
      { $set: { sealedTo: address, sealedProvisionedAt: new Date().toISOString() } }
    )

  // The envelope is a separate document so the employee record itself never carries spend
  // authority, and so deleting the phrase on claim is a single targeted delete.
  await db.collection('sealedClaims').updateOne(
    { orgWallet: ORG, employee: String(emp.walletAddress).toLowerCase() },
    {
      $set: {
        orgWallet: ORG,
        employee: String(emp.walletAddress).toLowerCase(),
        sealedTo: address,
        mnemonic,
        claimed: false,
        createdAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  )

  console.log(`  ✓ ${label}\n      ${address}\n      recovery phrase stored for one-time claim (not printed)`)
  created++
}

console.log(
  `\n  ${created} provisioned, ${skipped} already had an address.` +
    (DRY ? '  Nothing was written.\n' : '\n')
)
await mongo.close()
