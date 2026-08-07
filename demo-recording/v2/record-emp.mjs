#!/usr/bin/env node
/**
 * Worker side: derive keys → recover from chain → claim.
 *
 * Runs as a real employee wallet, and the claim it makes is a real transaction. The beat that
 * matters is "Recover from chain" — the page ignores the Magmos database and rebuilds the payment
 * from Arc's logs, which is the difference between a privacy claim and a privacy property.
 *
 *   node v2/record-emp.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openStage } from './lib.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const timing = JSON.parse(readFileSync(`${HERE}timing.json`, 'utf8'))
const BASE = process.env.BASE || 'http://localhost:3100'

// Maya — the first seeded recipient. A real key with real accrued pay behind it.
const emp = JSON.parse(readFileSync(`${ROOT}scripts/.demo-wallets.json`, 'utf8'))[0]

const stage = await openStage({ privateKey: emp.privateKey, videoDir: `${HERE}raw-emp` })
const { page, click, point, beat, scroll, hashes } = stage
const B = (id) => beat(id, undefined, timing)

const marks = []
const t0 = Date.now()
const mark = (id) => {
  marks.push({ id, at: (Date.now() - t0) / 1000 })
  console.log(`\n── ${id} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

try {
  await page.goto(`${BASE}/claim`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1500)
  const connect = page.getByRole('button', { name: /Connect wallet/i }).first()
  if (await connect.count()) await click('button:has-text("Connect wallet")', 2500)
  await page.waitForTimeout(2500)

  // ── derive keys ──────────────────────────────────────────────────────────
  mark('employee_intro')
  const setup = page
    .getByRole('button', { name: /Set up private payouts|Re-publish key/i })
    .first()
  if (await setup.count()) {
    await click(
      'button:has-text("Set up private payouts"), button:has-text("Re-publish key")',
      2500
    )
  }
  await B('employee_intro')

  // ── recover from chain ───────────────────────────────────────────────────
  mark('employee_recover')
  const recover = page.getByRole('button', { name: /Recover from chain/i }).first()
  if (await recover.count()) {
    await click('button:has-text("Recover from chain")', 1500)
    // Scanning walks back through log windows; give it room before the narration lands on it.
    await page.waitForTimeout(6000)
  } else {
    console.log('  (no recover button — keys may not be unlocked)')
  }
  await B('employee_recover')

  // ── claim ────────────────────────────────────────────────────────────────
  mark('employee_claim')
  const claim = page.getByRole('button', { name: /^Claim$/i }).first()
  if (await claim.count()) {
    await point('button:has-text("Claim")', 700)
    await click('button:has-text("Claim")', 2500)
    await page.waitForTimeout(5000)
  } else {
    console.log('  (nothing claimable — payments may already be taken)')
  }
  await scroll(200, 900)
  await B('employee_claim')
} catch (e) {
  console.error('\n✗ recording failed:', e.message.slice(0, 300))
} finally {
  writeFileSync(`${HERE}marks-emp.json`, JSON.stringify({ marks, hashes }, null, 2))
  console.log(`\n  transactions broadcast: ${hashes.length}`)
  hashes.forEach((h) => console.log(`    ${h}`))
  await stage.ctx.close()
  await stage.browser.close()
  console.log('  video written to raw-emp/')
}
