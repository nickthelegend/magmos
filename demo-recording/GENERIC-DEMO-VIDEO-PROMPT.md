# Generic "Real On-Chain Demo Video" Mega-Prompt

Hand this to any capable coding agent (Claude Code, etc.) with access to a terminal, pointed at **any** dApp. Fill in the `{{...}}` block at the top, paste the rest verbatim. It produces a narrated MP4 demo with **real, verifiable on-chain transactions** — no mocks, no fake toasts, no stock footage.

---

## FILL THIS IN
```
APP_URL / DEV CMD   : {{https://your-dapp.app  OR  `bun dev` on port 3000}}
CHAIN               : {{name}} · chainId {{id}} · RPC {{https://rpc...}} · explorer {{https://explorer...}}
GAS/NATIVE TOKEN    : {{e.g. ETH / USDC}}
SIGNER KEY          : {{testnet private key of a FUNDED demo wallet — for Node only, never the browser}}
SECOND PARTY (opt)  : {{2nd wallet key, if the flow has a recipient/counterparty step}}
THE FLOW TO DEMO    : {{ordered happy-path, e.g. 1) connect 2) fund pool 3) start stream 4) recipient claims 5) bridge}}
TARGET DURATION     : {{e.g. 5:00}}
BRAND (opt)         : primary {{#hex}} · logo {{path/url}} · font {{name}}
VOICE (opt)         : {{TTS voice, e.g. warm male / Kokoro am_michael}}
```

---

## ROLE
You are an autonomous build + media agent. Produce a narrated, end-to-end product-demo video of the dApp above, showing its whole real flow with **real on-chain transactions**, delivered as a single MP4 at the target duration. Do it all yourself, headless — no human clicking, no wallet extension.

## ABSOLUTE RULES (non-negotiable)
1. **Every transaction shown is REAL and verifiable on-chain.** No mock hashes, no faked toasts, no simulated confirmations. If a step genuinely can't fire a real tx, say so out loud — never fake it.
2. **Show proof on screen.** For each write: surface the app's own success **toast (top-right) containing the real tx hash**, then cut to the **block explorer** (or a receipt card built from real RPC data) for that hash.
3. **Duration must land within ±3s of the target.** Verify with ffprobe before declaring done.
4. **No secrets leak.** Private keys live in Node only; the browser only ever sees an injected provider shim. Nothing sensitive in the video or logs.

## THE PIPELINE — BUILD THIS

### 1) Drive the REAL app headlessly (Playwright + injected wallet)
- Launch the app in Playwright (chromium), `recordVideo` on (e.g. 1440×900).
- **Inject an EIP-1193 provider** as `window.ethereum` via `addInitScript` (runs before app JS). It implements `request({method, params})`:
  - `eth_requestAccounts` / `eth_accounts` → the demo address; `eth_chainId` → the chain; emit `connect` / `accountsChanged`.
  - `personal_sign`, `eth_signTypedData_v4`, `eth_sendTransaction` → forward over a bridge (`page.exposeFunction`) to **viem in Node**, which signs with the private key and broadcasts to the real RPC, then returns the **real** tx hash / signature to the page.
  - Result: the dApp believes a wallet is connected; every write is a real transaction. **No MetaMask, no popups, no Synpress.**
- Walk the exact flow with Playwright clicks/fills. At each meaningful moment record a **beat** `{ id, at_ms }` to `marks.json` (used to sync narration).
- After each action, wait for the app's success toast (real hash) and also capture the hash from the bridge.
- Multi-party flows (recipient claims, counterparty accepts): run a **second Playwright pass** with the second wallet. Fund it with gas first if needed (send native token from the primary wallet in Node).

### 2) Capture real on-chain PROOF
- For each tx, fetch `eth_getTransactionReceipt` + `eth_getTransactionByHash` from the RPC.
- If the explorer renders cleanly headless → screenshot it. If it doesn't (indexer lag / JS-heavy SPA shows skeletons) → **render your own receipt card** (HTML → screenshot) from the real RPC data: hash, ✓ status, block, from/to, gas, method — labeled "verified on-chain". **Never invent field values.**

### 3) Narration (TTS), timed to the beats
- Write a tight segment script: one short, benefit-led paragraph per beat (intro → each feature → close). No filler.
- Synthesize each segment to WAV (Kokoro or any TTS); record each segment's duration.
- Each narration segment will be placed at its beat's timestamp so the voice matches what's on screen.

### 4) Composite with ffmpeg — TWO passes
- **Pass 1 (video):** normalize every piece to identical codec/res/fps (`h264, {{W}}x{{H}}, 30fps, yuv420p`). Pieces = title card + app walkthrough(s) + explorer/receipt cutaways (overlay during the beat window with `overlay=enable='between(t,a,b)'`) + optional "verified on-chain" recap montage + close card. **Join with the concat _demuxer_ (`-f concat -safe 0 -c copy`), NOT the concat _filter_.**
- **Pass 2 (audio):** build the narration track by delaying each segment to its absolute start (`[i:a]adelay=<ms>:all=1`) then `amix=inputs=N:normalize=0`; mix a soft BGM bed under it (`volume≈0.09`, `-stream_loop -1`, `amix=duration=first`). Then mux: `-c:v copy -c:a aac -b:a 192k -movflags +faststart`.
- Title/close cards: branded HTML → screenshot (primary color, logo, font).

### 5) VERIFY before declaring done
- ffprobe the output: assert duration ≈ target (decode-count frames, don't trust container metadata alone), resolution correct, audio stream present.
- Spot-check frames at start / mid / end to confirm segment order.
- Print the list of **real tx hashes + explorer links** so the user can verify each on-chain.

## GOTCHAS (learned the hard way — heed them)
- The concat **filter** can silently drop/rescale the first input and collapse total duration. Use the concat **demuxer** on pre-normalized inputs.
- `adelay` needs `:all=1` (or `D|D`) or mono inputs throw "Invalid argument".
- Shell-quote any `-vf` / `-filter_complex` value containing `()`.
- Decode filesystem paths with `%20` spaces via `fileURLToPath(new URL('.', import.meta.url))`, not `URL.pathname`.
- Don't wait forever on a headless explorer — if it shows skeletons, render the receipt card from RPC instead.
- Keep the signer key in Node; only inject the provider shim into the browser.
- Extend, don't rush: if the cut is short of target, add a real-receipt recap montage rather than padding with dead air.

## DELIVERABLE
`renders/<app>-demo.mp4` at the target duration, **plus a printed list of every real tx hash shown** (with explorer links). If anything shown wasn't a real on-chain tx, state it explicitly.
