/**
 * Confidential delivery, server side.
 *
 * Settlement crystallises a payroll run into the org treasury without naming anyone. This is the
 * other half: getting the money to people without undoing that. One `fundBatch` commits a Merkle
 * root of (stealthAddress, amount) and deposits the total; employees claim independently, later,
 * from addresses only they can derive.
 *
 * The whole batch is one transaction on purpose. Sending to each stealth address at payout time
 * would publish N amounts together, and the shared timing would bind every recipient into a single
 * correlatable cohort — the count alone leaks headcount. Claims scattered across days do not.
 */

import { createWalletClient, defineChain, erc20Abi, http, keccak256, toHex, type Address, type Hex } from 'viem'
import {
  ARC_CHAIN_ID,
  ARC_RPC_URL,
  MAGMOS_STEALTH_PAYOUT,
  STEALTH_PAYOUT_ABI,
  USDC,
} from './magmos'
import { signerAccount, settlementPublicClient } from './payroll-signer'
import {
  buildMerkleTree,
  createStealthPayment,
  merkleProof,
  payoutLeaf,
  verifyProof,
  type StealthMetaAddress,
} from './stealth'

const arc = defineChain({
  id: ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [ARC_RPC_URL] } },
})

/** How long employees have to claim before the employer may recover the remainder. */
const CLAIM_WINDOW_SECONDS = 30n * 24n * 60n * 60n

export interface DeliveryLine {
  employee: string
  name?: string
  amountMicros: bigint
  meta: StealthMetaAddress
}

export interface DeliveredLine {
  employee: string
  name?: string
  amountMicros: bigint
  stealthAddress: Address
  /** Stored so the employee's claim does not depend on re-deriving the tree from logs. */
  proof: Hex[]
  ephemeralPubKey: Hex
  viewTag: number
  encryptedAmount: Hex
}

export interface DeliveryResult {
  batchId: Hex
  fundTxHash: Hex
  root: Hex
  totalMicros: bigint
  lines: DeliveredLine[]
}

/**
 * Commit and fund one confidential batch.
 *
 * @param runId Used to derive a deterministic batch id, so a retried run cannot create two batches
 *              for the same payroll and double-pay.
 */
export async function deliverBatch(
  orgWallet: string,
  runId: string,
  lines: DeliveryLine[]
): Promise<DeliveryResult> {
  const acct = signerAccount()
  if (!acct) throw new Error('PAYROLL_SIGNER_KEY is not configured')
  if (lines.length === 0) throw new Error('nothing to deliver')

  const totalMicros = lines.reduce((sum, l) => sum + l.amountMicros, 0n)
  if (totalMicros <= 0n) throw new Error('delivery total must be positive')

  // A fresh ephemeral key per line — reusing one would collapse every payment into one pseudonym.
  // The amount goes in encrypted so the recipient can rebuild their own leaf from chain data alone.
  const payments = lines.map((l) => ({
    line: l,
    stealth: createStealthPayment(l.meta, l.amountMicros),
  }))
  const leaves = payments.map((p) => payoutLeaf(p.stealth.stealthAddress, p.line.amountMicros))
  const { root, layers } = buildMerkleTree(leaves)

  // Verify every proof locally before spending gas. A batch funded against a root whose proofs do
  // not verify is salary locked up until the reclaim window — worth one loop to avoid.
  const proofs = payments.map((_, i) => merkleProof(layers, i))
  leaves.forEach((leaf, i) => {
    if (!verifyProof(leaf, proofs[i], root)) {
      throw new Error(`merkle proof failed locally for line ${i} — refusing to fund`)
    }
  })

  const batchId = keccak256(toHex(`magmos:batch:${orgWallet.toLowerCase()}:${runId}`))
  const wallet = createWalletClient({ account: acct, chain: arc, transport: http(ARC_RPC_URL) })
  const org = orgWallet as Address

  // Custody stays with the org. `settleAllSealed` pays the org — deliberately, so a SEALER can never
  // route settled funds to itself — which means the signer holds nothing and must pull what it needs
  // through an allowance the org grants and can revoke at any time. Getting this wrong is how the
  // first version failed: it funded the batch as the signer and reverted with
  // ERC20InsufficientBalance, because the money was never there.
  //
  // Sequential throughout: Arc's RPC rejects concurrent requests outright (-32011).
  const orgAllowance = (await settlementPublicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [org, acct.address],
  })) as bigint
  if (orgAllowance < totalMicros) {
    throw new Error(
      `The payroll signer may only spend what the org has approved. Allowance is ` +
        `${Number(orgAllowance) / 1e6} USDC but this batch needs ${Number(totalMicros) / 1e6}. ` +
        `Approve ${acct.address} on the USDC contract to raise it.`
    )
  }

  const pullTx = await wallet.writeContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'transferFrom',
    args: [org, acct.address, totalMicros],
  })
  await settlementPublicClient.waitForTransactionReceipt({ hash: pullTx })

  const payoutAllowance = (await settlementPublicClient.readContract({
    address: USDC,
    abi: erc20Abi,
    functionName: 'allowance',
    args: [acct.address, MAGMOS_STEALTH_PAYOUT],
  })) as bigint
  if (payoutAllowance < totalMicros) {
    const approveTx = await wallet.writeContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MAGMOS_STEALTH_PAYOUT, totalMicros],
    })
    await settlementPublicClient.waitForTransactionReceipt({ hash: approveTx })
  }

  const fundTxHash = await wallet.writeContract({
    address: MAGMOS_STEALTH_PAYOUT,
    abi: STEALTH_PAYOUT_ABI,
    functionName: 'fundBatch',
    args: [
      {
        batchId,
        root,
        total: totalMicros,
        recipientCount: payments.length,
        ttl: CLAIM_WINDOW_SECONDS,
      },
      payments.map((p) => p.stealth.ephemeralPubKey),
      payments.map((p) => p.stealth.viewTag),
      payments.map((p) => p.stealth.encryptedAmount),
      // Published so any recipient can rebuild the tree and derive their own proof without us.
      leaves,
    ],
  })
  const rc = await settlementPublicClient.waitForTransactionReceipt({ hash: fundTxHash })
  if (rc.status !== 'success') throw new Error(`fundBatch reverted (${fundTxHash})`)

  return {
    batchId,
    fundTxHash,
    root,
    totalMicros,
    lines: payments.map((p, i) => ({
      employee: p.line.employee,
      name: p.line.name,
      amountMicros: p.line.amountMicros,
      stealthAddress: p.stealth.stealthAddress,
      proof: proofs[i],
      ephemeralPubKey: p.stealth.ephemeralPubKey,
      viewTag: p.stealth.viewTag,
      encryptedAmount: p.stealth.encryptedAmount,
    })),
  }
}

/**
 * Is a meta-address usable? Both halves must be compressed secp256k1 points.
 *
 * Checked before a run rather than at claim time: a malformed key here means a stealth address
 * nobody can derive a private key for, and the salary sits unclaimable until the window expires.
 */
export function isValidMeta(meta: unknown): meta is StealthMetaAddress {
  const m = meta as StealthMetaAddress | null
  const ok = (k?: string) => typeof k === 'string' && /^0x0[23][0-9a-fA-F]{64}$/.test(k)
  return Boolean(m) && ok(m?.spendingPubKey) && ok(m?.viewingPubKey)
}
