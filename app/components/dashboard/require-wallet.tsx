"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { Loader2, Wallet } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

/**
 * Gate for app routes (dashboard / onboarding).
 *
 * This used to `router.replace("/")` on a disconnected status, which had two bad consequences:
 * wagmi reports `disconnected` for a tick before auto-reconnect settles, so a plain page refresh
 * bounced you out to the marketing site — and dashboard URLs could never be bookmarked, shared,
 * or opened in a new tab.
 *
 * Instead we resolve in place: hold while the silent reconnect runs, then offer Connect on the
 * route the visitor actually asked for. Nothing is lost on refresh and deep links work.
 */
export function RequireWallet({ children }: { children: React.ReactNode }) {
  const { address, status } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  // wagmi's first client render can report `disconnected` before reconnection is attempted.
  // Give that a beat before showing the connect prompt, so returning users see no flash.
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (status === "connected") return;
    const t = setTimeout(() => setSettled(true), 900);
    return () => clearTimeout(t);
  }, [status]);

  if (address) return <>{children}</>;

  const reconnecting = status === "connecting" || status === "reconnecting" || !settled;
  if (reconnecting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0a0a0b]">
        <Loader2 className="size-5 animate-spin text-white/50" />
        <span className="sr-only">Restoring your session…</span>
      </div>
    );
  }

  const onConnect = () => {
    const connector = connectors[0];
    if (!connector) {
      toast.error("No wallet found — install MetaMask to continue");
      return;
    }
    connect({ connector });
  };

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0b] px-5 py-12">
      <div className="w-full max-w-[420px]">
        <div className="rounded-[22px] border border-[rgba(255,255,255,0.07)] bg-[#1a1a1c] p-7 shadow-[0_24px_48px_-32px_rgba(0,0,0,0.8)]">
          <span className="inline-flex size-10 items-center justify-center rounded-full bg-[rgba(255,106,26,0.14)] text-[#ff6a1a]">
            <Wallet className="size-5" strokeWidth={2} />
          </span>
          <h1 className="mt-4 text-[21px] font-semibold tracking-[-0.02em] text-[#f4f4f5]">
            Connect to continue
          </h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-[#8c8c92]">
            Your payroll lives on Arc, so the dashboard reads it straight from the chain with your
            wallet. Nothing is stored server-side except the names you choose.
          </p>
          <button
            type="button"
            onClick={onConnect}
            disabled={isPending}
            className="mt-5 w-full rounded-full bg-[#ff6a1a] py-2.5 text-[13.5px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:opacity-60"
          >
            {isPending ? "Connecting…" : "Connect wallet"}
          </button>
          <p className="mt-3 text-center text-[12px] text-[#5d5d64]">
            New here?{" "}
            <Link href="/" className="text-[#8c8c92] underline decoration-dotted underline-offset-2 hover:text-[#ff6a1a]">
              See what Magmos does
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
