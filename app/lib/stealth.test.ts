import { describe, expect, test } from 'bun:test'
import { keccak256, toHex, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  buildMerkleTree,
  checkAnnouncement,
  createStealthPayment,
  deriveStealthKeys,
  merkleProof,
  payoutLeaf,
  verifyProof,
} from './stealth'

const keysFor = (who: string) => deriveStealthKeys(keccak256(toHex(`sig:${who}`)))

describe('stealth key derivation', () => {
  test('is deterministic — an employee can recover on any device', () => {
    const a = keysFor('alice')
    const b = keysFor('alice')
    expect(a.spendingPubKey).toBe(b.spendingPubKey)
    expect(a.viewingPubKey).toBe(b.viewingPubKey)
  })

  test('different signatures give unrelated identities', () => {
    expect(keysFor('alice').spendingPubKey).not.toBe(keysFor('bob').spendingPubKey)
  })

  test('viewing key cannot spend — the two scalars are independent', () => {
    // An employee may hand the viewing key to an accountant. If it doubled as the spending key that
    // would be handing over the salary.
    const k = keysFor('alice')
    expect(k.viewingPrivKey).not.toBe(k.spendingPrivKey)
    expect(k.viewingPubKey).not.toBe(k.spendingPubKey)
  })

  test('keys are well-formed compressed points', () => {
    const k = keysFor('alice')
    for (const p of [k.spendingPubKey, k.viewingPubKey]) {
      expect(p).toMatch(/^0x0[23][0-9a-f]{64}$/)
    }
  })
})

describe('ECDH stealth payments', () => {
  test('the recipient can recover the private key for their payment', () => {
    const alice = keysFor('alice')
    const p = createStealthPayment(alice)

    const found = checkAnnouncement(alice, p.ephemeralPubKey, p.viewTag)
    expect(found).not.toBeNull()
    expect(found!.stealthAddress.toLowerCase()).toBe(p.stealthAddress.toLowerCase())

    // The derived key must actually control that address, or the money is unspendable.
    expect(privateKeyToAccount(found!.stealthPrivKey).address.toLowerCase()).toBe(
      p.stealthAddress.toLowerCase()
    )
  })

  test('a different employee cannot recognise or open the payment', () => {
    const alice = keysFor('alice')
    const bob = keysFor('bob')
    const p = createStealthPayment(alice)
    expect(checkAnnouncement(bob, p.ephemeralPubKey, p.viewTag)).toBeNull()
  })

  test('two payments to the same person are unlinkable', () => {
    // This is the property that makes the scheme worth anything: a fresh ephemeral key per payment.
    // Reusing one would collapse every salary into a single traceable pseudonym.
    const alice = keysFor('alice')
    const a = createStealthPayment(alice)
    const b = createStealthPayment(alice)
    expect(a.stealthAddress).not.toBe(b.stealthAddress)
    expect(a.ephemeralPubKey).not.toBe(b.ephemeralPubKey)
    // Both still recoverable by her.
    expect(checkAnnouncement(alice, a.ephemeralPubKey, a.viewTag)).not.toBeNull()
    expect(checkAnnouncement(alice, b.ephemeralPubKey, b.viewTag)).not.toBeNull()
  })

  test('a wrong view tag is rejected without doing the expensive work', () => {
    const alice = keysFor('alice')
    const p = createStealthPayment(alice)
    expect(checkAnnouncement(alice, p.ephemeralPubKey, (p.viewTag + 1) % 256)).toBeNull()
  })

  test('a malformed announcement does not abort a scan', () => {
    // Anyone can emit an Announcement; a garbage point must not throw and kill the loop.
    const alice = keysFor('alice')
    expect(checkAnnouncement(alice, '0xdeadbeef' as Hex, 0)).toBeNull()
  })

  test('scanning a realistic batch finds exactly one payment', () => {
    const alice = keysFor('alice')
    const others = ['b', 'c', 'd', 'e', 'f', 'g'].map(keysFor)
    const announcements = [
      ...others.map((k) => createStealthPayment(k)),
      createStealthPayment(alice),
      ...others.map((k) => createStealthPayment(k)),
    ]
    const mine = announcements.filter((a) => checkAnnouncement(alice, a.ephemeralPubKey, a.viewTag))
    expect(mine.length).toBe(1)
  })
})

describe('merkle commitment', () => {
  const leaves = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      payoutLeaf(`0x${(i + 1).toString(16).padStart(40, '0')}`, BigInt((i + 1) * 1_000_000))
    )

  test('every leaf verifies against the root', () => {
    for (const n of [1, 2, 3, 5, 8, 13]) {
      const ls = leaves(n)
      const { root, layers } = buildMerkleTree(ls)
      ls.forEach((leaf, i) => {
        expect(verifyProof(leaf, merkleProof(layers, i), root)).toBe(true)
      })
    }
  })

  test('a forged leaf does not verify', () => {
    const ls = leaves(5)
    const { root, layers } = buildMerkleTree(ls)
    const forged = payoutLeaf('0x000000000000000000000000000000000000dead', 99_000_000n)
    expect(verifyProof(forged, merkleProof(layers, 2), root)).toBe(false)
  })

  test('an inflated amount does not verify — the leaf binds the amount', () => {
    const addr = '0x0000000000000000000000000000000000000001' as const
    const ls = [payoutLeaf(addr, 1_000_000n), payoutLeaf(addr, 2_000_000n)]
    const { root, layers } = buildMerkleTree(ls)
    expect(verifyProof(payoutLeaf(addr, 9_000_000n), merkleProof(layers, 0), root)).toBe(false)
  })

  test('odd layers promote rather than duplicate', () => {
    // Duplicating the last node is the classic second-preimage footgun; promotion avoids it.
    const ls = leaves(3)
    const { layers } = buildMerkleTree(ls)
    expect(layers[1].length).toBe(2)
    expect(layers[1][1]).toBe(ls[2])
  })

  test('empty input is an error, not a silent empty root', () => {
    expect(() => buildMerkleTree([])).toThrow()
  })
})
