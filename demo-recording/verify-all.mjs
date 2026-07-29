// Full-stack verification: every route in both apps, every API endpoint, the RPC proxy, and the
// on-chain reads behind them. Drives a real connected wallet via an injected EIP-1193 provider
// (keys stay in Node). Prints a pass/fail table and exits non-zero if anything is broken.
//
//   node demo-recording/verify-all.mjs            # both apps must be running (3100 / 3001)
//   ONLY=org node demo-recording/verify-all.mjs   # or ONLY=emp / ONLY=api

import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createWalletClient, defineChain, http, publicActions, hexToBigInt } from "viem";
import { privateKeyToAccount } from "viem/accounts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const RPC = "https://rpc.testnet.arc.network";
const ORG = "http://localhost:3100";
const EMP = "http://localhost:3001";
const SHOTS = `${HERE}shots-verify`;
mkdirSync(SHOTS, { recursive: true });
const ONLY = process.env.ONLY || "";

const arc = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
});

const deployerPk = readFileSync(`${HERE}../contracts/.env.deployer`, "utf8").match(
  /^DEPLOYER_PRIVATE_KEY=\s*(0x[0-9a-fA-F]+)/m
)[1];
const deployer = privateKeyToAccount(deployerPk);
const maya = JSON.parse(readFileSync(`${HERE}../scripts/.demo-wallets.json`, "utf8"))[0];

const results = [];
const pass = (area, name, note = "") => results.push({ area, name, ok: true, note });
const fail = (area, name, note) => results.push({ area, name, ok: false, note });

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

async function session(pk, addr) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain: arc, transport: http() }).extend(publicActions);
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
  await ctx.exposeBinding("__sendTx", async (_s, tx) =>
    wallet.sendTransaction({
      to: tx.to,
      data: tx.data,
      value: tx.value ? hexToBigInt(tx.value) : undefined,
      gas: tx.gas ? hexToBigInt(tx.gas) : undefined,
    })
  );
  await ctx.exposeBinding("__signMessage", async (_s, m) =>
    wallet.signMessage({ message: typeof m === "string" && m.startsWith("0x") ? { raw: m } : m })
  );
  await ctx.addInitScript(inject(addr));
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // 429s are upstream rate limiting, surfaced separately; ignore favicon noise.
    if (/favicon|429|Failed to load resource/i.test(t)) return;
    errors.push(t.slice(0, 160));
  });
  return { browser, page, errors };
}

/** Visit a route and assert it rendered real content (not an error boundary / blank shell). */
async function checkRoute(page, errors, area, base, path, mustInclude = []) {
  errors.length = 0;
  try {
    const res = await page.goto(base + path, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2600);
    const status = res?.status() ?? 0;

    // Deep-linking a gated route now resolves in place with a Connect prompt (no bounce to `/`).
    // Honour it the way a visitor would, then continue asserting the real page.
    let body = await page.innerText("body").catch(() => "");
    if (/Connect to continue/i.test(body)) {
      await page.getByRole("button", { name: /connect wallet/i }).first().click().catch(() => {});
      await page.waitForTimeout(4000);
      body = await page.innerText("body").catch(() => "");
    }
    const crashed = /Application error|Unhandled Runtime Error|This page could not be found/i.test(body);
    const missing = mustInclude.filter((s) => !new RegExp(s, "i").test(body));
    const slug = path === "/" ? "root" : path.replace(/\//g, "_").replace(/^_/, "");

    if (status >= 400) return fail(area, path, `HTTP ${status}`);
    if (crashed) return fail(area, path, "runtime error on page");
    if (body.trim().length < 40) return fail(area, path, "blank render");
    if (missing.length) return fail(area, path, `missing: ${missing.join(", ")}`);
    if (errors.length) return fail(area, path, `console: ${errors[0]}`);
    await page.screenshot({ path: `${SHOTS}/${area}-${slug}.png` }).catch(() => {});
    pass(area, path, `HTTP ${status}`);
  } catch (e) {
    fail(area, path, (e.message || String(e)).split("\n")[0].slice(0, 120));
  }
}

// ─────────────────────────────── API + RPC proxy ───────────────────────────────
if (!ONLY || ONLY === "api") {
  const apiPaths = [
    `/api/orgs/${deployer.address}`,
    `/api/orgs/${deployer.address}/employees`,
    `/api/orgs/${deployer.address}/groups`,
    `/api/orgs/${deployer.address}/invoices`,
    `/api/orgs/${deployer.address}/keys`,
    `/api/orgs/${deployer.address}/pools`,
    `/api/orgs/${deployer.address}/webhooks`,
  ];
  for (const p of apiPaths) {
    try {
      const r = await fetch(ORG + p);
      const txt = await r.text();
      let parsed = true;
      try { JSON.parse(txt); } catch { parsed = false; }
      if (!r.ok) fail("api", p, `HTTP ${r.status}`);
      else if (!parsed) fail("api", p, "non-JSON body");
      else pass("api", p, `HTTP ${r.status}`);
    } catch (e) {
      fail("api", p, e.message.slice(0, 100));
    }
  }

  // RPC proxy health + the properties it exists to provide.
  for (const [label, base] of [["org", ORG], ["emp", EMP]]) {
    try {
      const r = await fetch(`${base}/api/rpc`);
      const j = await r.json();
      if (j.ok && j.blockNumber) pass("rpc", `${label} /api/rpc health`, `block ${parseInt(j.blockNumber, 16)} in ${j.upstreamMs}ms`);
      else fail("rpc", `${label} /api/rpc health`, JSON.stringify(j.error || j).slice(0, 110));
    } catch (e) {
      fail("rpc", `${label} /api/rpc health`, e.message.slice(0, 100));
    }
  }

  // The real test: a burst that would 429 upstream must all succeed through the proxy.
  try {
    const one = { jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] };
    const burst = await Promise.all(
      Array.from({ length: 24 }, () =>
        fetch(`${ORG}/api/rpc`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(one),
        }).then((r) => r.json())
      )
    );
    const ok = burst.filter((b) => b.result).length;
    if (ok === burst.length) pass("rpc", "24-request burst (coalesced)", `${ok}/${burst.length} ok`);
    else fail("rpc", "24-request burst (coalesced)", `only ${ok}/${burst.length} ok`);
  } catch (e) {
    fail("rpc", "24-request burst (coalesced)", e.message.slice(0, 100));
  }

  // Disallowed methods must be refused, not forwarded.
  try {
    const r = await fetch(`${ORG}/api/rpc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "personal_sign", params: [] }),
    });
    const j = await r.json();
    if (j.error?.code === -32601) pass("rpc", "method allowlist", "personal_sign refused");
    else fail("rpc", "method allowlist", "signing method was NOT refused");
  } catch (e) {
    fail("rpc", "method allowlist", e.message.slice(0, 100));
  }
}

// ─────────────────────────────── Org app ───────────────────────────────
if (!ONLY || ONLY === "org") {
  const { browser, page, errors } = await session(deployerPk, deployer.address);
  // public routes
  await checkRoute(page, errors, "org", ORG, "/", ["Payroll that arrives"]);
  await checkRoute(page, errors, "org", ORG, "/faucet");
  await checkRoute(page, errors, "org", ORG, "/yield");
  await checkRoute(page, errors, "org", ORG, "/brand-assets");
  await checkRoute(page, errors, "org", ORG, "/onboarding");

  // connect once, then walk the dashboard
  await page.goto(`${ORG}/`, { waitUntil: "networkidle", timeout: 45000 });
  await page.getByText("Launch Dashboard", { exact: false }).first().click({ timeout: 15000 }).catch(() => {});
  const connected = await page
    .waitForSelector('aside a[href="/dashboard/payments"]', { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  if (!connected) fail("org", "wallet connect", "sidebar never appeared");
  else {
    pass("org", "wallet connect");
    const dash = [
      ["/dashboard", ["Overview|Total|Payroll"]],
      ["/dashboard/payments", ["Payroll", "Early wage access", "Drawn early"]],
      ["/dashboard/customers", ["Employees|Recipients"]],
      ["/dashboard/ai", ["Magmos AI|Ask"]],
      ["/dashboard/payment-links", ["Payment links|links"]],
      ["/dashboard/billing/subscriptions", ["Subscription|Billing"]],
      ["/dashboard/invoices", ["Invoice"]],
      ["/dashboard/products", ["Product"]],
      ["/dashboard/offramp", ["Offramp|bank"]],
      ["/dashboard/settings", ["Settings"]],
      ["/dashboard/developer/api-keys", ["API key|Keys"]],
      ["/dashboard/developer/webhooks", ["Webhook"]],
      ["/dashboard/developer/documentation", ["Documentation|SDK|install"]],
      ["/dashboard/developer/api-reference", ["API reference|Reference|endpoint"]],
      ["/dashboard/developer/component", ["Component|Pay"]],
    ];
    for (const [p, must] of dash) await checkRoute(page, errors, "org", ORG, p, must);
  }
  await browser.close();
}

// ─────────────────────────────── Employee app ───────────────────────────────
if (!ONLY || ONLY === "emp") {
  const { browser, page, errors } = await session(maya.privateKey, maya.address);
  await page.goto(`${EMP}/`, { waitUntil: "networkidle", timeout: 45000 });
  for (const rx of [/connect wallet/i, /^connect$/i, /launch/i, /connect/i]) {
    const b = page.getByRole("button", { name: rx }).first();
    if (await b.count().catch(() => 0)) { await b.click().catch(() => {}); break; }
  }
  await page.waitForTimeout(9000);
  const body = await page.innerText("body");
  if (/get paid early/i.test(body)) pass("emp", "/ (portal + EWA band)");
  else fail("emp", "/ (portal + EWA band)", "draw band not rendered");
  if (/send home/i.test(body)) pass("emp", "CCTP send-home card");
  else fail("emp", "CCTP send-home card", "not rendered");
  if (/claim to wallet|claimable in/i.test(body)) pass("emp", "claim control");
  else fail("emp", "claim control", "not rendered");
  await page.screenshot({ path: `${SHOTS}/emp-portal.png`, fullPage: true }).catch(() => {});
  await checkRoute(page, errors, "emp", EMP, "/passkey", ["passkey|Passkey"]);
  await browser.close();
}

// ─────────────────────────────── report ───────────────────────────────
const width = Math.max(...results.map((r) => r.name.length), 10);
let lastArea = "";
console.log("");
for (const r of results) {
  if (r.area !== lastArea) {
    console.log(`\n── ${r.area.toUpperCase()} ──`);
    lastArea = r.area;
  }
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(width)}  ${r.note}`);
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("FAILED:");
  for (const f of failed) console.log(`  ✗ [${f.area}] ${f.name} — ${f.note}`);
  process.exit(1);
}
console.log("ALL GREEN · screenshots in demo-recording/shots-verify/");
