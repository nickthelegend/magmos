#!/usr/bin/env node
/**
 * Employer side: landing → roster → confidential payroll → delivery batches.
 *
 * Every beat is held for exactly as long as its narration runs, read from timing.json. The
 * alternative — guessing durations and stretching in the edit — drifts, and by the third scene the
 * narrator is describing something that already left the screen.
 *
 * The transactions here are real. The wallet shim signs with a funded key and broadcasts to Arc, so
 * the hashes printed at the end resolve on the explorer.
 *
 *   node v2/record-org.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { openStage } from './lib.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const timing = JSON.parse(readFileSync(`${HERE}timing.json`, 'utf8'))
const BASE = process.env.BASE || 'http://localhost:3100'

const ORG_PK = readFileSync(`${ROOT}contracts/.env.deployer`, 'utf8').match(
  /^DEPLOYER_PRIVATE_KEY=\s*(0x[0-9a-fA-F]+)/m
)[1]

const stage = await openStage({ privateKey: ORG_PK, videoDir: `${HERE}raw-org` })
const { page, click, point, type, beat, scroll, hashes } = stage
const B = (id) => beat(id, undefined, timing)

const marks = []
const t0 = Date.now()
const mark = (id) => {
  marks.push({ id, at: (Date.now() - t0) / 1000 })
  console.log(`\n── ${id} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

try {
  // ── landing ──────────────────────────────────────────────────────────────
  mark('landing')
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1200)
  await scroll(420, 1500)
  await scroll(380, 1500)
  await scroll(-800, 1200)
  await B('landing')

  // ── connect ──────────────────────────────────────────────────────────────
  // Not narrated: the dashboard is wallet-gated, and a viewer seeing "Connect to continue" sit
  // there while the narrator talks about a roster would read as the app being broken.
  await page.goto(`${BASE}/dashboard/customers`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(1500)
  const connect = page.getByRole('button', { name: /Connect wallet/i }).first()
  if (await connect.count()) {
    await click('button:has-text("Connect wallet")', 2500)
  }
  await page.waitForTimeout(2500)

  // ── roster ───────────────────────────────────────────────────────────────
  mark('roster')
  await page.waitForTimeout(1500)
  await point('table tbody tr:first-child', 900)
  await point('table tbody tr:nth-child(2)', 900)
  await B('roster')

  // The "no payout key" badge is the point of this beat; dwell on the column that carries it.
  mark('roster_badge')
  await point('table tbody tr:nth-child(3)', 1200)
  await scroll(180, 900)
  await B('roster_badge')

  // ── confidential payroll ─────────────────────────────────────────────────
  mark('agent')
  await page.goto(`${BASE}/dashboard/private`, { waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(2200)
  await type('input[placeholder], textarea', "run today's payroll")
  await page.waitForTimeout(600)
  await B('agent')

  mark('verdict')
  // Submitting drafts the run; the gate's verdict renders underneath.
  await page.keyboard.press('Enter')
  await page.waitForTimeout(3500)
  await B('verdict')

  mark('settle')
  const settleBtn = page.getByRole('button', { name: /Settle on Arc|Approve and settle/i }).first()
  if (await settleBtn.count()) {
    await click('button:has-text("Settle on Arc"), button:has-text("Approve and settle")', 1200)
  } else {
    console.log('  (no settle button — run was refused or nothing accrued)')
  }
  await B('settle')

  mark('delivered')
  await page.waitForTimeout(2000)
  await scroll(320, 1000)
  await B('delivered')

  // ── delivery batches ─────────────────────────────────────────────────────
  mark('batches')
  await page.reload({ waitUntil: 'networkidle', timeout: 60000 })
  await page.waitForTimeout(3000)
  const batchTable = page.locator('text=Delivery batches').first()
  if (await batchTable.count()) await point('text=Delivery batches', 800)
  await scroll(500, 1200)
  await B('batches')
} catch (e) {
  console.error('\n✗ recording failed:', e.message.slice(0, 300))
} finally {
  writeFileSync(`${HERE}marks-org.json`, JSON.stringify({ marks, hashes }, null, 2))
  console.log(`\n  transactions broadcast: ${hashes.length}`)
  hashes.forEach((h) => console.log(`    ${h}`))
  await stage.ctx.close()
  await stage.browser.close()
  console.log('  video written to raw-org/')
}
