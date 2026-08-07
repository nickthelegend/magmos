/**
 * Shared recording rig: a real wallet behind an injected provider, and a cursor you can see.
 *
 * Playwright records video without a pointer, which for a product demo is a real problem — the
 * viewer sees fields fill and buttons depress with nothing causing it, and the whole thing reads as
 * a screen capture of a bot rather than a person using software. So a cursor is drawn into the page
 * and moved deliberately, with a click ripple, and every interaction goes through it.
 *
 * The wallet is not a simulation. `window.ethereum` is backed by a viem client holding a real key,
 * so `eth_sendTransaction` broadcasts to Arc and the hashes in the video resolve on the explorer.
 */

import { chromium } from 'playwright'
import { createWalletClient, defineChain, http, hexToBigInt, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

export const RPC = 'https://rpc.testnet.arc.network'
export const arc = defineChain({
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
})

/** Drawn in the page so it survives into the recording; Playwright's own pointer does not. */
const CURSOR_CSS = `
#__demo_cursor {
  position: fixed; left: 0; top: 0; width: 26px; height: 26px;
  margin: -3px 0 0 -3px; pointer-events: none; z-index: 2147483647;
  transition: transform 90ms linear;
  filter: drop-shadow(0 2px 6px rgba(0,0,0,.55));
}
#__demo_ripple {
  position: fixed; width: 34px; height: 34px; margin: -17px 0 0 -17px;
  border-radius: 999px; border: 2px solid #FF6A1A; pointer-events: none;
  z-index: 2147483646; opacity: 0; transform: scale(.3);
}
@keyframes __demo_ping { 0% { opacity:.9; transform: scale(.3) } 100% { opacity:0; transform: scale(1.5) } }
`

const CURSOR_JS = `
(() => {
  const add = () => {
    if (document.getElementById('__demo_cursor')) return;
    const s = document.createElement('style'); s.textContent = ${JSON.stringify(CURSOR_CSS)};
    document.head.appendChild(s);
    const c = document.createElement('div'); c.id = '__demo_cursor';
    c.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 2l14 7.5-6.2 1.6L9.8 18z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(c);
    const r = document.createElement('div'); r.id = '__demo_ripple';
    document.body.appendChild(r);
    window.__cursorTo = (x, y) => { c.style.transform = 'translate(' + x + 'px,' + y + 'px)'; };
    window.__cursorClick = (x, y) => {
      r.style.left = x + 'px'; r.style.top = y + 'px';
      r.style.animation = 'none'; void r.offsetWidth; r.style.animation = '__demo_ping 480ms ease-out';
    };
    window.__cursorTo(120, 120);
  };
  if (document.body) add(); else document.addEventListener('DOMContentLoaded', add);
})();`

/**
 * Provider shim. Everything not handled locally is proxied straight to Arc, so reads behave exactly
 * as they would against a real wallet rather than against a stub that only answers what we expected.
 */
const providerSrc = (address) => `
(() => {
  const ADDR = ${JSON.stringify(address)}, CHAIN = "0x4cef32", RPC = ${JSON.stringify(RPC)};
  const L = {};
  async function rpc(m, p) {
    const r = await fetch(RPC, { method:"POST", headers:{"content-type":"application/json"},
      body: JSON.stringify({ jsonrpc:"2.0", id:1, method:m, params:p||[] }) });
    const j = await r.json();
    if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
    return j.result;
  }
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      switch (method) {
        case "eth_requestAccounts": case "eth_accounts": return [ADDR];
        case "eth_chainId": return CHAIN;
        case "net_version": return "5042002";
        case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_watchAsset": return null;
        case "personal_sign": return await window.__signMessage(params[0]);
        // The stealth claim is authorised by EIP-712, so the shim has to speak it too.
        case "eth_signTypedData_v4": return await window.__signTypedData(params[1]);
        case "eth_sendTransaction": return await window.__sendTx(params[0]);
        default: return await rpc(method, params);
      }
    },
    on: (e, c) => { (L[e] ||= []).push(c); },
    removeListener: () => {},
  };
})();`

export async function openStage({ privateKey, videoDir, width = 1440, height = 900 }) {
  const account = privateKeyToAccount(privateKey)
  const wallet = createWalletClient({ account, chain: arc, transport: http(RPC) }).extend(publicActions)

  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({
    viewport: { width, height },
    recordVideo: { dir: videoDir, size: { width, height } },
    deviceScaleFactor: 2,
  })

  const hashes = []
  await ctx.exposeBinding('__sendTx', async (_s, tx) => {
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? hexToBigInt(tx.value) : undefined,
      gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
    })
    console.log(`  [tx] ${hash}`)
    hashes.push(hash)
    return hash
  })
  await ctx.exposeBinding('__signMessage', async (_s, m) =>
    wallet.signMessage({ message: typeof m === 'string' && m.startsWith('0x') ? { raw: m } : m })
  )
  await ctx.exposeBinding('__signTypedData', async (_s, json) => {
    const td = typeof json === 'string' ? JSON.parse(json) : json
    return wallet.signTypedData({
      domain: td.domain,
      types: Object.fromEntries(Object.entries(td.types).filter(([k]) => k !== 'EIP712Domain')),
      primaryType: td.primaryType,
      message: td.message,
    })
  })

  await ctx.addInitScript(providerSrc(account.address))
  await ctx.addInitScript(CURSOR_JS)

  const page = await ctx.newPage()
  const stage = makeStage(page)
  return { browser, ctx, page, account, wallet, hashes, ...stage }
}

function makeStage(page) {
  let cx = 120
  let cy = 120

  /** Ease the pointer rather than teleporting it — a jump cut on the cursor reads as a glitch. */
  const glide = async (x, y, steps = 22) => {
    const sx = cx
    const sy = cy
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2 // easeInOutQuad
      const nx = sx + (x - sx) * e
      const ny = sy + (y - sy) * e
      await page.evaluate(([a, b]) => window.__cursorTo?.(a, b), [nx, ny])
      await page.mouse.move(nx, ny)
      await page.waitForTimeout(14)
    }
    cx = x
    cy = y
  }

  const centreOf = async (sel) => {
    const el = page.locator(sel).first()
    await el.scrollIntoViewIfNeeded().catch(() => {})
    const b = await el.boundingBox()
    if (!b) throw new Error(`no bounding box for ${sel}`)
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 }
  }

  return {
    glide,
    /** Move the visible cursor onto a target and pause, without clicking. */
    async point(sel, hold = 500) {
      const { x, y } = await centreOf(sel)
      await glide(x, y)
      await page.waitForTimeout(hold)
    },
    /** Move, ripple, then click — so the viewer sees the cause before the effect. */
    async click(sel, settle = 700) {
      const { x, y } = await centreOf(sel)
      await glide(x, y)
      await page.waitForTimeout(220)
      await page.evaluate(([a, b]) => window.__cursorClick?.(a, b), [x, y])
      await page.waitForTimeout(160)
      await page.locator(sel).first().click({ timeout: 15000 })
      await page.waitForTimeout(settle)
    },
    /** Type at human speed so the viewer can read it forming. */
    async type(sel, text, delay = 46) {
      const { x, y } = await centreOf(sel)
      await glide(x, y)
      await page.evaluate(([a, b]) => window.__cursorClick?.(a, b), [x, y])
      await page.locator(sel).first().click()
      await page.locator(sel).first().type(text, { delay })
    },
    /** Hold a beat for exactly as long as its narration runs. */
    async beat(id, seconds, timing) {
      const s = seconds ?? timing?.segments?.find((x) => x.id === id)?.seconds ?? 5
      console.log(`  [beat] ${id} — ${s.toFixed(1)}s`)
      await page.waitForTimeout(Math.round(s * 1000))
    },
    async scroll(dy, ms = 900) {
      await page.mouse.wheel(0, dy)
      await page.waitForTimeout(ms)
    },
  }
}
