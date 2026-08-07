#!/usr/bin/env node
/**
 * The verification beat: a terminal running the real privacy check.
 *
 * Rendered as a page rather than screen-captured from a real shell so the type is legible at video
 * bitrates — but the text is not typed out by hand. It is the actual stdout of
 * `node scripts/verify-privacy.mjs`, captured at record time, ANSI colours mapped to spans. If the
 * check ever started failing, this segment would show it failing.
 *
 *   node v2/record-verify.mjs
 */

import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const APP = fileURLToPath(new URL('../../app/', import.meta.url))
const timing = JSON.parse(readFileSync(`${HERE}timing.json`, 'utf8'))
const secs = (id) => timing.segments.find((s) => s.id === id)?.seconds ?? 10

console.log('  running the real privacy check…')
let output
try {
  output = execSync('node scripts/verify-privacy.mjs', { cwd: APP, encoding: 'utf8' })
} catch (e) {
  // A non-zero exit means the property does NOT hold. Record that rather than hiding it — a demo
  // that silently swaps in a passing transcript is the exact dishonesty this project is about.
  output = (e.stdout || '') + (e.stderr || '')
  console.log('  ! verify-privacy exited non-zero — recording the real failure')
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** Map the few ANSI codes the script emits onto spans; strip the rest. */
const ansiToHtml = (s) =>
  esc(s)
    .replace(/\[32m/g, '<span class="g">')
    .replace(/\[31m/g, '<span class="r">')
    .replace(/\[33m/g, '<span class="y">')
    .replace(/\[0m/g, '</span>')
    // eslint-disable-next-line no-control-regex
    .replace(/\[[0-9;]*m/g, '')

const lines = output.split('\n')

const html = `<!doctype html><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:#0d0d10;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .win{height:100%;display:flex;flex-direction:column}
  .bar{display:flex;align-items:center;gap:8px;padding:12px 16px;background:#17171c;border-bottom:1px solid #26262e}
  .dot{width:12px;height:12px;border-radius:99px}
  .t{margin-left:10px;color:#8b8b95;font-size:12.5px}
  pre{flex:1;margin:0;padding:26px 30px;color:#d6d6dd;font-size:16px;line-height:1.72;white-space:pre-wrap;overflow:hidden}
  .g{color:#4ade80}.r{color:#f87171}.y{color:#fbbf24}
  .ln{opacity:0;animation:in .01s forwards}
  @keyframes in{to{opacity:1}}
</style>
<div class="win">
  <div class="bar">
    <span class="dot" style="background:#ff5f57"></span>
    <span class="dot" style="background:#febc2e"></span>
    <span class="dot" style="background:#28c840"></span>
    <span class="t">magmos — node scripts/verify-privacy.mjs</span>
  </div>
  <pre id="out"></pre>
</div>
<script>
  const LINES = ${JSON.stringify(lines.map(ansiToHtml))};
  const out = document.getElementById('out');
  let i = 0;
  // Paced so the whole transcript lands inside the two narration beats that describe it.
  const step = () => {
    if (i >= LINES.length) return;
    const d = document.createElement('div');
    d.className = 'ln';
    d.innerHTML = LINES[i] || '&nbsp;';
    out.appendChild(d);
    // Keep the verdict block in frame rather than scrolling it away.
    while (out.scrollHeight > out.clientHeight && out.firstChild) out.removeChild(out.firstChild);
    i++;
    setTimeout(step, ${Math.max(60, Math.round(((secs('verify') + secs('verify_result')) * 900) / Math.max(1, lines.length)))});
  };
  setTimeout(step, 400);
</script>`

writeFileSync(`${HERE}verify.html`, html)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: `${HERE}raw-verify`, size: { width: 1440, height: 900 } },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
await page.goto(`file://${HERE}verify.html`)
const total = secs('verify') + secs('verify_result')
console.log(`  holding ${total.toFixed(1)}s while the transcript prints`)
await page.waitForTimeout(Math.round(total * 1000) + 600)
await ctx.close()
await browser.close()
console.log('  video written to raw-verify/')
