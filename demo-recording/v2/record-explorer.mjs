#!/usr/bin/env node
/**
 * Block-explorer proof: the settlement and the delivery batch, on ArcScan.
 *
 * This is the segment that makes the privacy claim checkable rather than asserted — a viewer can
 * pause the video, type the hash in themselves, and see the same thing. So it shows the real
 * explorer rather than a rendered card of the same data.
 *
 *   node v2/record-explorer.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const timing = JSON.parse(readFileSync(`${HERE}timing.json`, 'utf8'))
const hashes = JSON.parse(readFileSync(`${HERE}hashes.json`, 'utf8'))
const EXPLORER = 'https://testnet.arcscan.app/tx/'
const secs = (id) => timing.segments.find((s) => s.id === id)?.seconds ?? 8

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: `${HERE}raw-explorer`, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const marks = []
const t0 = Date.now()
const mark = (id) => {
  marks.push({ id, at: (Date.now() - t0) / 1000 })
  console.log(`\n── ${id} @ ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}
const hold = async (id) => {
  const s = secs(id)
  console.log(`  [beat] ${id} — ${s.toFixed(1)}s`)
  await page.waitForTimeout(Math.round(s * 1000))
}

/** Explorers are slow and occasionally down; a blank frame is worse than a short one. */
async function open(url, settle = 6000) {
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    await page.waitForTimeout(settle)
    return true
  } catch (e) {
    console.log(`  ! could not load ${url}: ${e.message.slice(0, 90)}`)
    return false
  }
}

try {
  mark('explorer_intro')
  await open(`${EXPLORER}${hashes.settleTx}`, 4000)
  await hold('explorer_intro')

  mark('explorer_settle')
  // Scroll through the transaction so the input data — the 64 bytes that name nobody — is on screen
  // while the narration is describing exactly that.
  await page.mouse.wheel(0, 420)
  await page.waitForTimeout(3500)
  await page.mouse.wheel(0, 420)
  await page.waitForTimeout(3500)
  await page.mouse.wheel(0, 380)
  await hold('explorer_settle')

  mark('explorer_batch')
  await open(`${EXPLORER}${hashes.batchTx}`, 5000)
  await page.mouse.wheel(0, 450)
  await page.waitForTimeout(3500)
  await page.mouse.wheel(0, 450)
  await hold('explorer_batch')
} catch (e) {
  console.error('\n✗ explorer capture failed:', e.message.slice(0, 200))
} finally {
  writeFileSync(`${HERE}marks-explorer.json`, JSON.stringify({ marks, hashes }, null, 2))
  await ctx.close()
  await browser.close()
  console.log('\n  video written to raw-explorer/')
}
