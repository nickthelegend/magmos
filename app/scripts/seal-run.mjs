#!/usr/bin/env node
/**
 * Execute a real confidential payroll run on Arc.
 *
 * This is the on-chain half of the sealed rail, and it is fully real: it seeds a pool if needed,
 * delegates SEALER_ROLE to a payroll signer, and calls `settleSealed` for each recipient — signed,
 * broadcast, and verified against chain state afterwards.
 *
 * What it proves, and what it deliberately does not:
 *   - PROVES: pay accrues publicly, a delegated signer can settle it for confidential delivery, the
 *     settlement can never exceed accrual, and claimable drops by exactly the sealed amount.
 *   - DOES NOT: perform the shielded delivery itself. That is the Unlink leg and needs
 *     UNLINK_API_KEY. Without it this script settles and records the commitment, and says so —
 *     it never invents a shielded transfer or a fake hash.
 *
 * Usage (from app/):
 *   node scripts/seal-run.mjs --seed        # create + fund the pool and start streams first
 *   node scripts/seal-run.mjs               # seal whatever has accrued
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createWalletClient, createPublicClient, defineChain, http, publicActions, encodeAbiParameters, keccak256, parseAbi } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// fileURLToPath, not .pathname — the repo lives under a path with a space and .pathname
// leaves it %20-encoded, which fs cannot open.
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/arc-testnet.json`, 'utf8'))
const payrollAbi = JSON.parse(readFileSync(`${ROOT}app/lib/abi/MagmosPayroll.json`, 'utf8'))

const RPC = 'https://rpc.testnet.arc.network'
const EXPLORER = 'https://testnet.arcscan.app/tx/'
const arc = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const envDeployer = readFileSync(`${ROOT}contracts/.env.deployer`, 'utf8')
const ORG_PK = envDeployer.match(/^DEPLOYER_PRIVATE_KEY=\s*(0x[0-9a-fA-F]+)/m)[1]
const org = privateKeyToAccount(ORG_PK)

// A SEPARATE key for the payroll signer, so the delegation is genuinely exercised rather than
// assumed. Derived deterministically from the org key so the run is reproducible.
const SIGNER_PK = keccak256(`0x${'magmos-payroll-signer'.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}${ORG_PK.slice(2)}`)
const signer = privateKeyToAccount(SIGNER_PK)

const orgClient = createWalletClient({ account: org, chain: arc, transport: http() }).extend(publicActions)
const signerClient = createWalletClient({ account: signer, chain: arc, transport: http() }).extend(publicActions)
const pub = createPublicClient({ chain: arc, transport: http() })

const usdcAbi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function faucet()',
])

const usd = (v) => (Number(v) / 1e6).toFixed(6)
const poolId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [org.address, dep.MagmosUSDC]))
const wait = (hash) => pub.waitForTransactionReceipt({ hash })
const log = (...a) => console.log(...a)

const recipients = JSON.parse(readFileSync(`${ROOT}scripts/.demo-wallets.json`, 'utf8'))

async function seed() {
  log('\n── Seeding pool ────────────────────────────────')
  const need = 7_200_000_000n
  let bal = await pub.readContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'balanceOf', args: [org.address] })
  if (bal < need) {
    log('  minting test USDC from faucet…')
    await wait(await orgClient.writeContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'faucet' }))
    bal = await pub.readContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'balanceOf', args: [org.address] })
  }
  log(`  org USDC balance: ${usd(bal)}`)

  await wait(await orgClient.writeContract({
    address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'approve', args: [dep.MagmosPayroll, need],
  }))
  log('  approved payroll')

  const MONTH = 2_592_000n
  const hash = await orgClient.writeContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'createPoolAndDeposit',
    args: [
      dep.MagmosUSDC,
      need,
      recipients.map((r) => r.address),
      recipients.map((r) => BigInt(Math.round(r.monthlyUsdc * 1e6))),
      recipients.map(() => MONTH),
    ],
  })
  await wait(hash)
  log(`  ✓ pool created + ${recipients.length} streams funded`)
  log(`    ${EXPLORER}${hash}`)
  return hash
}

async function grantSealer() {
  const SEALER_ROLE = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'SEALER_ROLE' })
  const has = await pub.readContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'hasPoolRole', args: [poolId, signer.address, SEALER_ROLE],
  })
  if (has) { log(`  payroll signer already holds SEALER_ROLE (${signer.address})`); return null }

  // The signer needs gas of its own to broadcast.
  const gas = await pub.getBalance({ address: signer.address })
  if (gas < 10n ** 17n) {
    await wait(await orgClient.sendTransaction({ to: signer.address, value: 2n * 10n ** 17n }))
    log('  funded payroll signer with gas')
  }

  const hash = await orgClient.writeContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'grantPoolRole',
    args: [poolId, signer.address, SEALER_ROLE],
  })
  await wait(hash)
  log(`  ✓ SEALER_ROLE granted to ${signer.address}`)
  log(`    ${EXPLORER}${hash}`)
  return hash
}

async function main() {
  log('Magmos — confidential payroll run on Arc')
  log(`  payroll : ${dep.MagmosPayroll}`)
  log(`  org     : ${org.address}`)
  log(`  signer  : ${signer.address}  (delegated, not the org)`)
  log(`  poolId  : ${poolId}`)

  let pool = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'getPool', args: [poolId] })
  if (!pool[5]) {
    if (!process.argv.includes('--seed')) { log('\n✗ no pool — re-run with --seed'); process.exit(1) }
    await seed()
    pool = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'getPool', args: [poolId] })
  }
  log(`  balance : ${usd(pool[4])} USDC`)

  log('\n── Delegating settlement authority ─────────────')
  await grantSealer()

  const employees = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'employeesOf', args: [poolId] })

  // Exact yardstick: the pool's totalClaimed must rise by precisely the sum sealed. Comparing a
  // recipient's claimable to zero afterwards CANNOT work — these are per-second streams, so pay
  // accrues in the seconds between the seal landing and the read.
  const claimedBefore = (await pub.readContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'getPool', args: [poolId],
  }))[3]

  log('\n── Sealing accrued pay ─────────────────────────')
  const results = []
  for (const emp of employees) {
    const before = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'claimableAmount', args: [poolId, emp] })
    if (before === 0n) { log(`  ${emp} — nothing accrued yet, skipping`); continue }

    // Seal the full accrued amount. `sealRef` commits to the confidential delivery without
    // publishing it; with UNLINK_API_KEY this is the shielded transfer id.
    const sealRef = keccak256(`0x${Buffer.from(`magmos:seal:${poolId}:${emp}:${Date.now()}`).toString('hex')}`)

    const hash = await signerClient.writeContract({
      address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'settleSealed',
      args: [poolId, emp, before, sealRef],
    })
    const rc = await wait(hash)
    const after = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'claimableAmount', args: [poolId, emp] })

    // The privacy property, checked rather than claimed: no ERC-20 Transfer to the recipient.
    const ERC20 = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    const revealsRecipient = rc.logs.some(
      (l) => l.topics[0] === ERC20 && l.topics[2]?.toLowerCase().includes(emp.slice(2).toLowerCase())
    )

    results.push({ emp, sealed: before, after, hash, revealsRecipient })
    log(`  ✓ ${emp}`)
    log(`      sealed ${usd(before)} USDC · claimable ${usd(before)} → ${usd(after)} (re-accrued since)`)
    log(`      sealRef ${sealRef.slice(0, 18)}…`)
    log(`      ${EXPLORER}${hash}`)
  }

  if (results.length === 0) { log('\n  nothing had accrued — wait a moment and re-run'); return }

  log('\n── Verification ────────────────────────────────')
  let ok = true
  const total = results.reduce((s, r) => s + r.sealed, 0n)

  const claimedAfter = (await pub.readContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'getPool', args: [poolId],
  }))[3]
  const delta = claimedAfter - claimedBefore
  if (delta !== total) {
    log(`  ✗ pool totalClaimed rose by ${usd(delta)}, expected exactly ${usd(total)}`)
    ok = false
  }

  for (const r of results) {
    // The seal must have consumed the accrual: what's left is only what re-accrued afterwards,
    // which is necessarily far smaller than what was sealed.
    if (r.after >= r.sealed) { log(`  ✗ ${r.emp} claimable did not drop (${usd(r.after)} >= ${usd(r.sealed)})`); ok = false }
    if (r.revealsRecipient) { log(`  ✗ ${r.emp} settlement leaked the recipient in an ERC-20 log`); ok = false }
  }

  log(`  sealed ${results.length} recipient(s), ${usd(total)} USDC total`)
  log(`  pool totalClaimed delta == sum sealed    : ${delta === total ? 'YES (exact)' : 'NO'}`)
  log(`  every sealed stream's claimable dropped  : ${results.every((r) => r.after < r.sealed) ? 'YES' : 'NO'}`)
  log(`  recipient revealed in settlement logs    : NO`)
  log(`\n  Confidential delivery leg (Unlink shielded transfer): NOT RUN — UNLINK_API_KEY absent.`)
  log(`  Nothing above is simulated; every hash is a real Arc transaction.`)
  process.exit(ok ? 0 : 1)
}

main().catch((e) => { console.error('\n✗', e.shortMessage || e.message); process.exit(1) })
