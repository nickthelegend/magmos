#!/usr/bin/env node
/**
 * The complete confidential payroll run, on Arc, with no external privacy service.
 *
 *   1. settleAllSealed  — crystallise every stream into the treasury. Names nobody.
 *   2. fundBatch        — commit a Merkle root of (stealthAddress, amount) and deposit the total.
 *                         Publishes one ECDH announcement per recipient. Still names nobody.
 *   3. scan             — each employee finds their own payment using only their viewing key and
 *                         public chain data. No message from the employer.
 *   4. claim            — a relayer submits the transaction; the stealth key only signs. Funds go
 *                         wherever the employee chose.
 *
 * Then it re-reads everything from chain and checks that no employee address appears anywhere.
 *
 *   node scripts/stealth-run.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  defineChain,
  encodeAbiParameters,
  http,
  keccak256,
  parseAbi,
  publicActions,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildMerkleTree,
  checkAnnouncement,
  claimTypedData,
  createStealthPayment,
  deriveStealthKeys,
  merkleProof,
  payoutLeaf,
  verifyProof,
} from '../lib/stealth.ts'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const dep = JSON.parse(readFileSync(`${ROOT}contracts/deployments/arc-testnet.json`, 'utf8'))
const payrollAbi = JSON.parse(readFileSync(`${ROOT}app/lib/abi/MagmosPayroll.json`, 'utf8'))
const payoutAbi = JSON.parse(readFileSync(`${ROOT}app/lib/abi/MagmosStealthPayout.json`, 'utf8'))
const recipients = JSON.parse(readFileSync(`${ROOT}scripts/.demo-wallets.json`, 'utf8'))

const RPC = 'https://rpc.testnet.arc.network'
const EXPLORER = 'https://testnet.arcscan.app/tx/'
const arc = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

const ORG_PK = readFileSync(`${ROOT}contracts/.env.deployer`, 'utf8').match(
  /^DEPLOYER_PRIVATE_KEY=\s*(0x[0-9a-fA-F]+)/m
)[1]
const org = privateKeyToAccount(ORG_PK)
const signerPk = keccak256(
  `0x${'magmos-payroll-signer'.split('').map((c) => c.charCodeAt(0).toString(16).padStart(2, '0')).join('')}${ORG_PK.slice(2)}`
)
const signer = privateKeyToAccount(signerPk)

const pub = createPublicClient({ chain: arc, transport: http(RPC) })
const orgC = createWalletClient({ account: org, chain: arc, transport: http(RPC) }).extend(publicActions)
const signerC = createWalletClient({ account: signer, chain: arc, transport: http(RPC) }).extend(publicActions)

const usdcAbi = parseAbi([
  'function approve(address,uint256) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function faucet()',
])
const wait = (h) => pub.waitForTransactionReceipt({ hash: h })
const usd = (v) => (Number(v) / 1e6).toFixed(6)
const poolId = keccak256(
  encodeAbiParameters([{ type: 'address' }, { type: 'address' }], [org.address, dep.MagmosUSDC])
)

console.log('\nConfidential payroll on Arc — no external privacy service')
console.log(`  payroll : ${dep.MagmosPayroll}`)
console.log(`  payout  : ${dep.MagmosStealthPayout}`)

// Employees derive their stealth identities from a wallet signature. In the product this happens in
// their browser; here we do it from their demo keys so the run is reproducible.
const employees = await Promise.all(
  recipients.map(async (r) => {
    const acct = privateKeyToAccount(r.privateKey)
    const sig = await acct.signMessage({ message: `magmos-stealth:${acct.address.toLowerCase()}` })
    return { ...r, acct, keys: deriveStealthKeys(sig) }
  })
)

// ── 1. settle ───────────────────────────────────────────────────────────────
let pool = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'getPool', args: [poolId] })
if (!pool[5]) {
  const need = 7_200_000_000n
  const bal = await pub.readContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'balanceOf', args: [org.address] })
  if (bal < need) await wait(await orgC.writeContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'faucet' }))
  await wait(await orgC.writeContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'approve', args: [dep.MagmosPayroll, need] }))
  await wait(await orgC.writeContract({
    address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'createPoolAndDeposit',
    args: [dep.MagmosUSDC, need, recipients.map((r) => r.address), recipients.map((r) => BigInt(Math.round(r.monthlyUsdc * 1e6))), recipients.map(() => 2_592_000n)],
  }))
  console.log('  seeded a fresh pool')
}
const SEALER = await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'SEALER_ROLE' })
if (!(await pub.readContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'hasPoolRole', args: [poolId, signer.address, SEALER] }))) {
  if ((await pub.getBalance({ address: signer.address })) < 10n ** 17n) {
    await wait(await orgC.sendTransaction({ to: signer.address, value: 2n * 10n ** 17n }))
  }
  await wait(await orgC.writeContract({ address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'grantPoolRole', args: [poolId, signer.address, SEALER] }))
}

const runId = `run-${(await pub.getBlockNumber()).toString()}`
const runSealRef = keccak256(toHex(`magmos:run:${org.address.toLowerCase()}:${runId}`))

console.log('\n── 1. settleAllSealed ──────────────────────────────────────')
const settleTx = await signerC.writeContract({
  address: dep.MagmosPayroll, abi: payrollAbi, functionName: 'settleAllSealed', args: [poolId, runSealRef],
})
const settleRc = await wait(settleTx)
let total = 0n
let count = 0
for (const log of settleRc.logs) {
  try {
    const d = decodeEventLog({ abi: payrollAbi, data: log.data, topics: log.topics })
    if (d.eventName === 'PayrollSealed') { total = d.args.total; count = Number(d.args.count) }
  } catch { /* not ours */ }
}
console.log(`  ${usd(total)} USDC across ${count} streams`)
console.log(`  ${EXPLORER}${settleTx}`)
if (total === 0n) { console.log('\n  nothing accrued yet — wait a moment and re-run'); process.exit(0) }

// ── 2. build the confidential batch ─────────────────────────────────────────
console.log('\n── 2. fundBatch (stealth addresses + Merkle root) ──────────')
// Split the settled total proportionally to each stream's rate.
const rates = employees.map((e) => BigInt(Math.round(e.monthlyUsdc * 1e6)))
const rateSum = rates.reduce((a, b) => a + b, 0n)
const amounts = rates.map((r) => (total * r) / rateSum)
// Dust from integer division goes to the first recipient so the leaves sum to the deposit exactly.
amounts[0] += total - amounts.reduce((a, b) => a + b, 0n)

const payments = employees.map((e, i) => ({ ...createStealthPayment(e.keys), amount: amounts[i], who: e.name }))
const leaves = payments.map((p) => payoutLeaf(p.stealthAddress, p.amount))
const { root, layers } = buildMerkleTree(leaves)
for (const [i, p] of payments.entries()) {
  if (!verifyProof(leaves[i], merkleProof(layers, i), root)) throw new Error(`proof failed locally for ${p.who}`)
}

const batchId = keccak256(toHex(`magmos:batch:${runId}`))
await wait(await orgC.writeContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'approve', args: [dep.MagmosStealthPayout, total] }))
const fundTx = await orgC.writeContract({
  address: dep.MagmosStealthPayout, abi: payoutAbi, functionName: 'fundBatch',
  args: [batchId, root, total, payments.length, 2_592_000n, payments.map((p) => p.ephemeralPubKey), payments.map((p) => p.viewTag)],
})
await wait(fundTx)
console.log(`  committed ${payments.length} payments totalling ${usd(total)} USDC`)
console.log(`  ${EXPLORER}${fundTx}`)

// ── 3. employees scan ───────────────────────────────────────────────────────
console.log('\n── 3. employees scan announcements (viewing key only) ──────')
const annLogs = await pub.getLogs({
  address: dep.MagmosStealthPayout,
  event: payoutAbi.find((x) => x.type === 'event' && x.name === 'Announcement'),
  fromBlock: settleRc.blockNumber, toBlock: 'latest',
})
const announcements = annLogs.map((l) => ({ eph: l.args.ephemeralPubKey, tag: Number(l.args.viewTag) }))
console.log(`  ${announcements.length} announcement(s) on-chain, none of which names anyone`)

const found = []
for (const e of employees) {
  const hits = announcements
    .map((a) => checkAnnouncement(e.keys, a.eph, a.tag))
    .filter(Boolean)
  if (hits.length !== 1) { console.log(`  ✗ ${e.name}: found ${hits.length} payments, expected 1`); continue }
  const p = payments.find((x) => x.stealthAddress.toLowerCase() === hits[0].stealthAddress.toLowerCase())
  console.log(`  ✓ ${e.name} located their payment unaided — ${usd(p.amount)} USDC`)
  found.push({ e, hit: hits[0], amount: p.amount, index: payments.indexOf(p) })
}

// ── 4. claim via relayer ────────────────────────────────────────────────────
console.log('\n── 4. claim (relayer pays gas, stealth key only signs) ─────')
const claimTxs = []
for (const f of found) {
  // Deliberately NOT the employee's payroll wallet — that would re-link them. A fresh destination.
  const dest = privateKeyToAccount(keccak256(toHex(`magmos:cashout:${f.e.address}:${runId}`))).address
  const stealthAcct = privateKeyToAccount(f.hit.stealthPrivKey)
  const td = claimTypedData(dep.MagmosStealthPayout, 5042002, batchId, f.amount, dest)
  const sig = await stealthAcct.signTypedData(td)

  // The ORG relays. It never learns which employee this is — it only sees a valid signature.
  const tx = await orgC.writeContract({
    address: dep.MagmosStealthPayout, abi: payoutAbi, functionName: 'claim',
    args: [batchId, f.amount, dest, merkleProof(layers, f.index), sig],
  })
  await wait(tx)
  const bal = await pub.readContract({ address: dep.MagmosUSDC, abi: usdcAbi, functionName: 'balanceOf', args: [dest] })
  console.log(`  ✓ ${usd(f.amount)} USDC → ${dest}  (balance now ${usd(bal)})`)
  console.log(`      ${EXPLORER}${tx}`)
  claimTxs.push(tx)
}

// ── verification ────────────────────────────────────────────────────────────
console.log('\n── verification: does anything on-chain name an employee? ──')
const empHexes = employees.map((e) => e.address.toLowerCase().slice(2))
let leaked = false
for (const [label, hash] of [['settle', settleTx], ['fundBatch', fundTx], ...claimTxs.map((h, i) => [`claim ${i + 1}`, h])]) {
  const tx = await pub.getTransaction({ hash })
  const rc = await pub.getTransactionReceipt({ hash })
  const blob = (tx.input + rc.logs.map((l) => l.topics.join('') + l.data).join('')).toLowerCase()
  const hits = empHexes.filter((h) => blob.includes(h))
  if (hits.length) leaked = true
  console.log(`  ${label.padEnd(10)} employee addresses present: ${hits.length ? hits.join(', ') : 'NONE'}`)
}

console.log('\n  batch total and headcount are public (auditable, by design).')
console.log(`  employee identity recoverable from chain data : ${leaked ? 'YES — BROKEN' : 'NO'}`)
console.log(`\n  settle    ${settleTx}`)
console.log(`  fundBatch ${fundTx}`)
claimTxs.forEach((t, i) => console.log(`  claim ${i + 1}   ${t}`))
process.exit(leaked ? 1 : 0)
