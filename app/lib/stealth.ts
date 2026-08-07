/**
 * Stealth addresses — the confidential delivery leg, built on Arc with no external service.
 *
 * WHY THIS EXISTS. `settleAllSealed` crystallises a payroll run without naming anyone, but the money
 * still has to reach people, and an ordinary ERC-20 transfer republishes exactly what was just
 * hidden: the recipient in an indexed topic, the salary in the clear, filterable by address forever.
 * Arc's own confidential transfers would solve it, but Arc's documentation says privacy is "on the
 * roadmap and not yet available", so it cannot be used today.
 *
 * THE CONSTRUCTION (ERC-5564). An employee publishes a meta-address once: a spending public key `S`
 * and a viewing public key `V`. For each payment the employer picks a fresh ephemeral scalar `r`:
 *
 *     R = r·G                      published in the Announcement
 *     s = keccak256(r·V)           ECDH shared secret — employer knows r, employee knows v
 *     P = S + s·G                  one-time stealth public key
 *     stealthAddress = addr(P)
 *
 * The employee recomputes `s = keccak256(v·R)` (same secret, other side of the exchange) and holds
 * the matching private key `p = (spend + s) mod n`. Nobody without `v` can connect a stealth address
 * to a person — the link is a discrete log away.
 *
 * VIEW TAGS. Scanning every announcement with a full point multiplication is slow. The first byte of
 * the shared secret is published, so a client discards ~255/256 of announcements after one cheap
 * check. It leaks nothing useful: one byte partitions the anonymity set by 1/256 at most, and only
 * among announcements the observer already cannot attribute.
 *
 * WHAT THIS DOES NOT HIDE, stated plainly: the batch total, the recipient count, and each claim's
 * amount and destination. Identity is the secret; aggregate spend stays auditable on purpose.
 */

import { secp256k1 } from '@noble/curves/secp256k1.js'
import { keccak256, toHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

const N = secp256k1.Point.Fn.ORDER
const G = secp256k1.Point.BASE

const hexToBytes = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
const bytesToHex = (b: Uint8Array): Hex =>
  `0x${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`

/** An employee's published identity. Both keys are compressed secp256k1 points (33 bytes). */
export interface StealthMetaAddress {
  spendingPubKey: Hex
  viewingPubKey: Hex
}

/** The private half. Never leaves the employee's device in a correct deployment. */
export interface StealthKeys extends StealthMetaAddress {
  spendingPrivKey: Hex
  viewingPrivKey: Hex
}

export interface StealthPayment {
  /** Where the employer commits funds. Unlinkable to the employee. */
  stealthAddress: Address
  /** `R`, compressed. Published so the employee can find this payment. */
  ephemeralPubKey: Hex
  /** First byte of the shared secret — a cheap scanning filter. */
  viewTag: number
}

/**
 * Derive an employee's stealth identity from a wallet signature.
 *
 * Deterministic on purpose: the employee can recover their keys on any device by signing the same
 * message again, with no seed phrase to lose. The two scalars are domain-separated so the viewing
 * key — which an employee may hand to an accountant to audit their own income — can never be used
 * to spend.
 */
export function deriveStealthKeys(signature: Hex): StealthKeys {
  const spendingPrivKey = keccak256(toHex(`magmos:stealth:spend:${signature}`))
  const viewingPrivKey = keccak256(toHex(`magmos:stealth:view:${signature}`))
  return {
    spendingPrivKey,
    viewingPrivKey,
    spendingPubKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(spendingPrivKey), true)),
    viewingPubKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(viewingPrivKey), true)),
  }
}

/** The message an employee signs to derive their keys. Bound to the wallet so it is not portable. */
export const stealthDerivationMessage = (wallet: string) =>
  `Magmos: derive my private payout keys\n\nWallet: ${wallet.toLowerCase()}\n\nThis signature never leaves your device and authorises no transaction.`

/** `keccak256(r·V)` — the ECDH secret, computed from whichever half you hold. */
function sharedSecret(scalarHex: Hex, pointHex: Hex): Hex {
  const point = secp256k1.Point.fromHex(pointHex.slice(2))
  const scalar = BigInt(scalarHex) % N
  // Compressed, so both sides derive byte-identical input to the hash.
  return keccak256(bytesToHex(point.multiply(scalar).toBytes(true)))
}

/**
 * Employer side: create a one-time address for one payment.
 *
 * A fresh ephemeral key per payment is what makes two salaries to the same person unlinkable. Reusing
 * `r` across a batch would collapse the whole scheme into a single pseudonym.
 */
export function createStealthPayment(meta: StealthMetaAddress): StealthPayment & { ephemeralPrivKey: Hex } {
  const ephemeralPrivKey = bytesToHex(secp256k1.utils.randomSecretKey())
  const ephemeralPubKey = bytesToHex(secp256k1.getPublicKey(hexToBytes(ephemeralPrivKey), true))

  const secret = sharedSecret(ephemeralPrivKey, meta.viewingPubKey)
  const stealthAddress = stealthAddressFrom(meta.spendingPubKey, secret)

  return {
    stealthAddress,
    ephemeralPubKey,
    viewTag: parseInt(secret.slice(2, 4), 16),
    ephemeralPrivKey,
  }
}

/** `P = S + s·G`, then the usual address derivation. Shared by both sides so they cannot disagree. */
function stealthAddressFrom(spendingPubKey: Hex, secret: Hex): Address {
  const S = secp256k1.Point.fromHex(spendingPubKey.slice(2))
  const P = S.add(G.multiply(BigInt(secret) % N))
  // Uncompressed minus the 0x04 prefix is what Ethereum hashes.
  const uncompressed = P.toBytes(false).slice(1)
  return `0x${keccak256(bytesToHex(uncompressed)).slice(-40)}` as Address
}

/**
 * Employee side: is this announcement mine, and if so what is the key?
 *
 * Returns null on a miss, which is the overwhelmingly common case — callers loop this over every
 * announcement in a batch.
 */
export function checkAnnouncement(
  keys: StealthKeys,
  ephemeralPubKey: Hex,
  viewTag: number
): { stealthAddress: Address; stealthPrivKey: Hex } | null {
  let secret: Hex
  try {
    secret = sharedSecret(keys.viewingPrivKey, ephemeralPubKey)
  } catch {
    // A malformed point in a log must not abort a scan — anyone can emit an announcement.
    return null
  }

  // Cheap rejection first. Only ~1 in 256 announcements survives to the expensive step.
  if (parseInt(secret.slice(2, 4), 16) !== viewTag) return null

  const stealthAddress = stealthAddressFrom(keys.spendingPubKey, secret)
  const stealthPrivKey = toHex((BigInt(keys.spendingPrivKey) + BigInt(secret)) % N, { size: 32 })

  // A view-tag collision is expected 1/256 of the time, so confirm by deriving the address from the
  // private key and checking it matches. Without this a client would try to claim strangers' leaves.
  if (privateKeyToAccount(stealthPrivKey).address.toLowerCase() !== stealthAddress.toLowerCase()) {
    return null
  }
  return { stealthAddress, stealthPrivKey }
}

// ─────────────────────────── Merkle commitment ───────────────────────────

/** Leaf must match `MagmosStealthPayout.leafFor` exactly: keccak256(abi.encode(address, uint256)). */
export function payoutLeaf(stealthAddress: Address, amount: bigint): Hex {
  const addr = stealthAddress.toLowerCase().slice(2).padStart(64, '0')
  const amt = amount.toString(16).padStart(64, '0')
  return keccak256(`0x${addr}${amt}`)
}

const hashPair = (a: Hex, b: Hex): Hex =>
  BigInt(a) < BigInt(b) ? keccak256(`0x${a.slice(2)}${b.slice(2)}`) : keccak256(`0x${b.slice(2)}${a.slice(2)}`)

/**
 * Sorted-pair Merkle tree, matching OpenZeppelin's `MerkleProof.verify`.
 *
 * Odd nodes are promoted rather than duplicated. Duplicating a node is the classic source of
 * second-preimage trouble in naive implementations, and promotion avoids it without extra machinery.
 */
export function buildMerkleTree(leaves: Hex[]): { root: Hex; layers: Hex[][] } {
  if (leaves.length === 0) throw new Error('cannot build a tree with no leaves')
  const layers: Hex[][] = [[...leaves]]
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1]
    const next: Hex[] = []
    for (let i = 0; i < prev.length; i += 2) {
      next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i])
    }
    layers.push(next)
  }
  return { root: layers[layers.length - 1][0], layers }
}

export function merkleProof(layers: Hex[][], index: number): Hex[] {
  const proof: Hex[] = []
  let i = index
  for (let level = 0; level < layers.length - 1; level++) {
    const sibling = i % 2 === 0 ? i + 1 : i - 1
    if (sibling < layers[level].length) proof.push(layers[level][sibling])
    i = Math.floor(i / 2)
  }
  return proof
}

/** Local mirror of the on-chain check — lets a client fail before spending gas on a bad proof. */
export function verifyProof(leaf: Hex, proof: Hex[], root: Hex): boolean {
  let computed = leaf
  for (const p of proof) computed = hashPair(computed, p)
  return computed.toLowerCase() === root.toLowerCase()
}

/** EIP-712 payload the stealth key signs to authorise a claim. Commits to `to` so a relayer cannot redirect. */
export function claimTypedData(
  verifyingContract: Address,
  chainId: number,
  batchId: Hex,
  amount: bigint,
  to: Address
) {
  return {
    domain: { name: 'MagmosStealthPayout', version: '1', chainId, verifyingContract },
    types: {
      Claim: [
        { name: 'batchId', type: 'bytes32' },
        { name: 'amount', type: 'uint256' },
        { name: 'to', type: 'address' },
      ],
    },
    primaryType: 'Claim' as const,
    message: { batchId, amount, to },
  }
}
