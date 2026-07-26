// End-to-end verification of Earned Wage Access against the REAL Arc testnet contracts.
// Injected EIP-1193 provider → viem signer in Node (keys never enter the browser).
// Screenshots the employer exposure panel, the worker's draw band, the quote modal, and
// then fires a genuine drawAdvance so the toast + on-chain receipt can be inspected.

import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWalletClient, defineChain, http, publicActions, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RPC = "https://rpc.testnet.arc.network";
const SHOTS = `${HERE}shots-ewa`;
mkdirSync(SHOTS, { recursive: true });

const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const deployerPk = readFileSync(`${HERE}../contracts/.env.deployer`, "utf8").match(
  /^DEPLOYER_PRIVATE_KEY=\s*(0x[0-9a-fA-F]+)/m
)[1];
const maya = JSON.parse(readFileSync(`${HERE}../scripts/.demo-wallets.json`, "utf8"))[0];

const inject = (addr) => `
(() => {
  const ADDR = ${JSON.stringify(addr)}, CHAIN = "0x4cef32", RPC = ${JSON.stringify(RPC)};
  const L = {};
  async function rpc(m,p){const r=await fetch(RPC,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:m,params:p||[]})});const j=await r.json();if(j.error)throw Object.assign(new Error(j.error.message),{code:j.error.code});return j.result;}
  window.ethereum = { isMetaMask:true, request: async ({method,params}) => {
    switch(method){
      case "eth_requestAccounts": case "eth_accounts": return [ADDR];
      case "eth_chainId": return CHAIN; case "net_version": return "5042002";
      case "wallet_switchEthereumChain": case "wallet_addEthereumChain": case "wallet_watchAsset": return null;
      case "personal_sign": return await window.__signMessage(params[0]);
      case "eth_sendTransaction": return await window.__sendTx(params[0]);
      default: return await rpc(method, params);
    }
  }, on:(e,c)=>{(L[e]||=[]).push(c);}, removeListener:()=>{} };
})();`;

async function session(pk, addr, viewport = { width: 1440, height: 980 }) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() }).extend(publicActions);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport });
  const sent = [];
  await ctx.exposeBinding("__sendTx", async (_s, tx) => {
    const hash = await wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? hexToBigInt(tx.value) : undefined,
      gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
    });
    console.log(`   [tx] ${hash}`);
    sent.push(hash);
    return hash;
  });
  await ctx.exposeBinding("__signMessage", async (_s, m) =>
    wallet.signMessage({ message: typeof m === "string" && m.startsWith("0x") ? { raw: m } : m })
  );
  await ctx.addInitScript(inject(addr));
  return { browser, ctx, page: await ctx.newPage(), sent };
}

// ── Employer: exposure panel + "Drawn early" column ────────────────────────
console.log("→ employer dashboard");
{
  const { browser, page } = await session(deployerPk, privateKeyToAccount(deployerPk).address);
  // The dashboard bounces to the landing page until a wallet is connected.
  await page.goto("http://localhost:3100/", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(1200);
  await page
    .getByText("Launch Dashboard", { exact: false })
    .first()
    .click({ timeout: 15000 })
    .catch(() => {});
  await page.waitForSelector('aside a[href="/dashboard/payments"]', { timeout: 30000 });
  await page.click('a[href="/dashboard/payments"]');
  await page.waitForTimeout(9000); // let the 5s chain poll land
  await page.screenshot({ path: `${SHOTS}/employer-payroll.png`, fullPage: true });
  const txt = await page.innerText("body");
  console.log("   early-access panel:", /early wage access/i.test(txt) ? "PRESENT" : "MISSING");
  console.log("   drawn-early column:", /drawn early/i.test(txt) ? "PRESENT" : "MISSING");
  await browser.close();
}

// ── Worker: draw band, quote modal, and a REAL draw ────────────────────────
console.log("→ worker portal");
{
  const { browser, page, sent } = await session(maya.privateKey, maya.address, { width: 1280, height: 1000 });
  await page.goto("http://localhost:3001", { waitUntil: "networkidle", timeout: 45000 });
  await page.waitForTimeout(2000);
  // connect (button text varies: Connect / Connect wallet / Launch)
  for (const rx of [/connect wallet/i, /^connect$/i, /launch/i, /connect/i]) {
    const b = page.getByRole("button", { name: rx }).first();
    if (await b.count().catch(() => 0)) {
      await b.click().catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(10000); // stream discovery + drawable poll

  const body = await page.innerText("body");
  console.log("   draw band:", /get paid early/i.test(body) ? "PRESENT" : "MISSING");
  await page.screenshot({ path: `${SHOTS}/worker-portal.png`, fullPage: true });

  const drawBtn = page.getByRole("button", { name: /draw now/i }).first();
  if (await drawBtn.isEnabled().catch(() => false)) {
    await drawBtn.click();
    await page.waitForTimeout(1200);
    // Use the Max chip so the amount is always valid against live accrual.
    const max = page.getByRole("button", { name: /^max$/i }).first();
    if (await max.isVisible().catch(() => false)) await max.click();
    await page.waitForTimeout(2500); // quote read
    await page.screenshot({ path: `${SHOTS}/worker-draw-modal.png` });

    const confirm = page.getByRole("button", { name: /^Draw [\d.,]+ USDC$/ }).first();
    if (await confirm.isEnabled().catch(() => false)) {
      console.log("   firing a REAL drawAdvance…");
      await confirm.click();
      await page.waitForTimeout(14000); // submit + receipt + toast
      await page.screenshot({ path: `${SHOTS}/worker-draw-toast.png`, fullPage: true });
      console.log("   tx sent:", sent.join(", ") || "(none)");
    } else {
      console.log("   confirm button not enabled (nothing drawable yet)");
    }
  } else {
    console.log("   Draw now disabled — nothing accrued/drawable");
  }
  await browser.close();
}
console.log("✓ shots in demo-recording/shots-ewa/");
