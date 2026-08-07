#!/usr/bin/env node
/**
 * Narration for the confidential-payroll demo.
 *
 * Each entry is one beat: an id, the copy, and the screen it belongs to. Durations come back from
 * the synthesiser and are written to `timing.json`, because the recording has to be paced to the
 * voice rather than the other way round — a walkthrough cut to guessed timings always drifts, and
 * by the third scene the narrator is describing something that left the screen.
 *
 *   node v2/narrate.mjs
 */

import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { synthesizeOne } from '/Users/jaibajrang/.claude/skills/media-use/audio/scripts/lib/tts.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const OUT = `${HERE}vo`
mkdirSync(OUT, { recursive: true })

/**
 * Written for the ear, not the page. Numbers are spelled the way a person says them, and the
 * hyphenated spellings ("U-S-D-C") stop the synthesiser reading them as a word.
 */
const SEGMENTS = [
  // ── intro: problem, then solution (HyperFrames) ──
  ['intro_problem',
    'Paying someone in stablecoins has a problem nobody likes to say out loud. Put payroll on a public chain, and everyone\'s salary is readable by anyone with a block explorer. Forever. Searchable by address.'],
  ['intro_problem2',
    'Your engineers can see what your designers make. Your competitors can see what you pay to hire. That single fact is why most companies look at stablecoin payroll once, and never again.'],
  ['intro_solution',
    'Magmos splits it the way payroll actually needs. Confidential to the public. Auditable to you. Real-time streaming pay on Circle\'s Arc network, settled per second — where the total is public, and nobody\'s salary is.'],

  // ── landing ──
  ['landing',
    'This is Magmos. Payroll that streams every second, and a confidentiality layer built directly on Arc — no external privacy service, no trusted setup.'],

  // ── employer: roster ──
  ['roster',
    'The employer\'s side. Here\'s the roster — three people, in Manila, Lagos and Karachi, each streaming U-S-D-C by the second. Each has published a private payout key, so payroll can reach them confidentially.'],
  ['roster_badge',
    'Anyone who hasn\'t set one up is flagged right here. Confidential payroll holds their line back rather than paying them in the clear — because a silent fallback would strip privacy from exactly the people who haven\'t set themselves up yet.'],

  // ── employer: run payroll ──
  ['agent',
    'Payroll runs in plain English. I type: run today\'s payroll. An agent drafts it — but the agent never decides. A deterministic policy gate does.'],
  ['verdict',
    'The gate returns a verdict. It can execute a run, hold one for a second signature, or refuse it outright — and a refusal is terminal, not a permission the interface is withholding. Amounts always come from live on-chain accrual, so the model picks recipients, never numbers.'],
  ['settle',
    'Now watch the settlement. Three recipients — and one transaction. Not three. Settling per employee would put every recipient and every salary into calldata, which is public no matter what the event emits.'],
  ['delivered',
    'Settled, and delivered. The batch is committed as a Merkle root and funded in a single transaction, so there is no cohort of payments sharing a block for anyone to correlate.'],

  // ── explorer proof ──
  ['explorer_intro',
    'Let\'s check that on the block explorer, because a privacy claim you can\'t verify isn\'t worth much.'],
  ['explorer_settle',
    'Here is the real settlement transaction on Arc. Sixty-four bytes of calldata: a pool identifier, and an opaque commitment. No recipient. No per-person amount. The logs carry a total and a headcount — deliberately, because aggregate spend is the part that should stay auditable.'],
  ['explorer_batch',
    'And here is the delivery batch. One-time stealth addresses, derived by elliptic-curve Diffie-Hellman. Only the employee can compute the matching private key. The link between a person and an address is a discrete log away.'],

  // ── employee ──
  ['employee_intro',
    'Now the other side. The worker opens their portal and derives their keys from a wallet signature — in the browser. Nothing is sent anywhere. There\'s no seed phrase to lose, because signing the same message on any device reproduces the same keys.'],
  ['employee_recover',
    'And here is the part that matters most. Recover from chain. This ignores our database completely — it reads Arc\'s logs, decrypts the amount with the viewing key, rebuilds the Merkle tree from the published leaves, and derives the proof locally.'],
  ['employee_claim',
    'If Magmos disappeared tomorrow, this worker could still find and claim their salary. They claim it to an address they choose — and the stealth address never needs gas, because it only signs. Anyone can relay the transaction, and the signature commits to the destination, so a relayer cannot redirect the money.'],

  // ── verification ──
  ['verify',
    'So does it actually hold? This takes the adversary\'s view — transaction hashes only, reading what any explorer reads — against an observer who already knows every employee address. Because if the strongest possible adversary can\'t attribute a payment, a stranger certainly can\'t.'],
  ['verify_result',
    'Employee identities recoverable: no. Per-recipient amounts recoverable: no. And a known-leaky transaction is kept under test as a control, so a pass actually means something.'],

  // ── employer reconciliation + close ──
  ['batches',
    'Back on the employer side, delivery batches reconcile against the contract — not against our database. Delivered versus actually claimed, because an employee who never claims has probably lost their keys, and you want to know before the window closes.'],
  ['close',
    'One hundred and forty-eight contract tests. Sixty-six TypeScript tests. Twelve live contracts on Arc. Zero mocks. Every transaction in this video is real, and you can verify all of it with one command. Magmos — payroll that arrives the moment work happens, and stays between you and the person you\'re paying.'],
]

const durationOf = (wav) =>
  Number(
    execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', wav,
    ]).toString().trim()
  )

const timing = []
let total = 0

for (const [id, text] of SEGMENTS) {
  const wavAbs = `${OUT}/${id}.wav`
  // am_michael reads level and unhurried, which suits copy that is making an argument rather than
  // selling. Slightly under 1.0 because the final cut is sped to 1.2x — narration recorded at pace
  // and then accelerated sounds rushed.
  await synthesizeOne({
    provider: 'kokoro',
    text,
    voiceId: 'am_michael',
    speed: 0.98,
    wavAbs,
    hyperframesDir: HERE,
  })
  const d = durationOf(wavAbs)
  total += d
  timing.push({ id, seconds: Number(d.toFixed(2)), words: text.split(/\s+/).length })
  console.log(`  ${id.padEnd(18)} ${d.toFixed(2)}s`)
}

writeFileSync(`${HERE}timing.json`, JSON.stringify({ segments: timing, totalSeconds: Number(total.toFixed(2)) }, null, 2))
console.log(`\n  total narration: ${(total / 60).toFixed(2)} min (${total.toFixed(1)}s)`)
console.log(`  at 1.2x         : ${(total / 60 / 1.2).toFixed(2)} min`)
