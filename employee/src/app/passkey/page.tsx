"use client";

import { useState } from "react";
import Link from "next/link";
import { encodeFunctionData, formatUnits } from "viem";
import { toast } from "sonner";
import {
  circleEnabled,
  registerPasskey,
  loginPasskey,
  smartAccountFrom,
  sendGaslessCall,
} from "@/lib/circle";
import { getEmployeePools, getClaimable, getDrawable } from "@/lib/reads";
import {
  MAGMOS_PAYROLL,
  MAGMOS_ADVANCE,
  PAYROLL_ABI,
  ADVANCE_ABI,
  USDC_DECIMALS,
  EXPLORER_TX,
} from "@/lib/magmos";

type Ctx = Awaited<ReturnType<typeof smartAccountFrom>>;
type Pool = { poolId: `0x${string}`; claimable: bigint; drawable: bigint };

// Passkey onboarding for non-crypto recipients: Face ID / fingerprint → Circle Smart Account
// on Arc → gasless claim. No seed phrase, no gas token needed.
export default function PasskeyPage() {
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<Ctx | null>(null);
  const [pools, setPools] = useState<Pool[]>([]);
  const [email, setEmail] = useState("");
  const [copied, setCopied] = useState(false);

  const address = ctx?.address;
  const total = pools.reduce((s, p) => s + p.claimable, 0n);

  async function loadStreams(addr: `0x${string}`) {
    try {
      const ids = await getEmployeePools(addr);
      const withClaim = await Promise.all(
        ids.map(async (poolId) => ({
          poolId,
          claimable: await getClaimable(poolId, addr).catch(() => 0n),
          drawable: await getDrawable(poolId, addr).catch(() => 0n),
        }))
      );
      setPools(withClaim);
    } catch {
      setPools([]);
    }
  }

  async function onRegister() {
    if (!email) return toast.error("Enter an email to name your passkey");
    setBusy(true);
    try {
      const cred = await registerPasskey(email);
      const c = await smartAccountFrom(cred);
      setCtx(c);
      toast.success("Wallet created with passkey");
      await loadStreams(c.address);
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 140) || "Passkey registration failed");
    } finally {
      setBusy(false);
    }
  }

  async function onLogin() {
    setBusy(true);
    try {
      const cred = await loginPasskey();
      const c = await smartAccountFrom(cred);
      setCtx(c);
      toast.success("Signed in");
      await loadStreams(c.address);
    } catch (e) {
      const err = e as Error;
      const noPasskey =
        err?.name === "NotAllowedError" ||
        /no (passkey|credential)|not allowed|abort/i.test(err?.message ?? "");
      toast.error(
        noPasskey
          ? 'No passkey found — tap "Create wallet with passkey" first.'
          : err.message?.slice(0, 140) || "Passkey sign-in failed"
      );
    } finally {
      setBusy(false);
    }
  }

  // Earned Wage Access over the same gasless rail. Note this goes through the generic
  // `sendGaslessCall` helper rather than re-inlining the bundler call: the wrapper takes an
  // arbitrary {to, data}, so shipping a new contract method needs no new wallet plumbing.
  async function onDraw(poolId: `0x${string}`, amount: bigint) {
    if (!ctx || amount === 0n) return;
    setBusy(true);
    try {
      const data = encodeFunctionData({
        abi: ADVANCE_ABI,
        functionName: "drawAdvance",
        args: [poolId, amount],
      });
      const hash = await sendGaslessCall(ctx, { to: MAGMOS_ADVANCE, data });
      toast.success("Advance submitted (gasless)");
      await ctx.bundler.waitForUserOperationReceipt({ hash });
      toast.success("Your earned pay is in your wallet");
      await loadStreams(ctx.address);
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 140) || "Draw failed");
    } finally {
      setBusy(false);
    }
  }

  async function onClaim(poolId: `0x${string}`) {
    if (!ctx) return;
    setBusy(true);
    try {
      const data = encodeFunctionData({
        abi: PAYROLL_ABI,
        functionName: "claim",
        args: [poolId],
      });
      const hash = await ctx.bundler.sendUserOperation({
        account: ctx.account,
        calls: [{ to: MAGMOS_PAYROLL, data }],
      });
      toast.success("Claim submitted (gasless)");
      await ctx.bundler.waitForUserOperationReceipt({ hash });
      toast.success("Claimed!");
      await loadStreams(ctx.address);
    } catch (e) {
      toast.error((e as Error).message?.slice(0, 140) || "Claim failed");
    } finally {
      setBusy(false);
    }
  }

  const copy = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0b] px-5 py-10 text-[#f4f4f5]">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-between">
          <Link href="/" style={{ fontFamily: "var(--font-display)" }} className="text-lg font-bold tracking-tight">
            Magmos
          </Link>
        </div>

        <div className="rounded-2xl border border-[#26262b] bg-[#151517] p-7 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-[#3a2410] bg-[#1c1408] px-3 py-1 text-[11px] font-medium text-[#ffb43d]">
            <span className="size-1.5 rounded-full bg-[#ff6a1a]" />
            Circle Wallets · passkey · Arc
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Get paid — no seed phrase</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#a1a1aa]">
            Create a wallet with your fingerprint or Face ID. You get an address to receive
            streamed pay, and claims are gasless — powered by Circle Smart Accounts on Arc.
          </p>

          {!circleEnabled && (
            <div className="mt-4 rounded-xl border border-[#3a2410] bg-[#1c1408] px-4 py-3 text-[12.5px] text-[#ffb43d]">
              Circle Wallets not configured — set NEXT_PUBLIC_CIRCLE_CLIENT_KEY and _URL.
            </div>
          )}

          {!address ? (
            <div className="mt-5 space-y-3">
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@email.com"
                className="w-full rounded-xl border border-[#26262b] bg-[#0f0f11] px-4 py-3 text-[14px] outline-none focus:border-[#ff6a1a]"
              />
              <button
                onClick={onRegister}
                disabled={busy || !circleEnabled}
                className="w-full rounded-xl bg-[#ff6a1a] py-3 text-[14px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:opacity-50"
              >
                {busy ? "Working…" : "Create wallet with passkey"}
              </button>
              <button
                onClick={onLogin}
                disabled={busy || !circleEnabled}
                className="w-full rounded-xl border border-[#2a2a2e] py-2.5 text-[13.5px] font-medium text-[#f4f4f5] transition-colors hover:bg-[#1f1f24] disabled:opacity-50"
              >
                I already have a passkey — sign in
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-4">
              <div className="rounded-xl border border-[#26262b] bg-[#0f0f11] px-4 py-3">
                <div className="text-[11px] uppercase tracking-wide text-[#71717a]">
                  Your Magmos address (share to receive pay)
                </div>
                <button onClick={copy} className="mt-1 font-mono text-[13px] text-[#ffb43d] hover:underline break-all">
                  {address} {copied ? "✓" : "⧉"}
                </button>
              </div>

              <div className="rounded-xl border border-[#3a2410] bg-gradient-to-b from-[#1c1408] to-[#0f0f11] px-4 py-3.5">
                <div className="text-[11px] uppercase tracking-wide text-[#b8813e]">Total claimable</div>
                <div className="mt-0.5 font-mono text-[26px] font-semibold tabular-nums text-[#ffb43d]">
                  {Number(formatUnits(total, USDC_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 })}
                  <span className="ml-1.5 text-[14px] text-[#a1a1aa]">USDC</span>
                </div>
              </div>

              {pools.length === 0 ? (
                <p className="text-center text-[12.5px] text-[#71717a]">
                  No streams yet — share your address with the sender to start receiving pay.
                </p>
              ) : (
                pools.map((p) => (
                  <div key={p.poolId} className="space-y-2">
                    <button
                      onClick={() => onClaim(p.poolId)}
                      disabled={busy || p.claimable === 0n}
                      className="w-full rounded-xl bg-[#ff6a1a] py-2.5 text-[13.5px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:opacity-50"
                    >
                      Claim {Number(formatUnits(p.claimable, USDC_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC (gasless)
                    </button>
                    <button
                      onClick={() => onDraw(p.poolId, p.drawable)}
                      disabled={busy || p.drawable === 0n}
                      className="w-full rounded-xl border border-[#2c2c31] bg-[#151517] py-2.5 text-[13.5px] font-semibold text-[#f4f4f5] transition-colors hover:border-[#ff6a1a] disabled:opacity-50"
                    >
                      Get {Number(formatUnits(p.drawable, USDC_DECIMALS)).toLocaleString(undefined, { maximumFractionDigits: 4 })} USDC early (gasless)
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          <Link href="/" className="mt-5 block text-center text-[13px] font-medium text-[#a1a1aa] hover:text-[#f4f4f5]">
            Use a browser wallet instead →
          </Link>
        </div>
      </div>
    </main>
  );
}
