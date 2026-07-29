"use client";

import { useEffect } from "react";
import Link from "next/link";

/**
 * Dashboard error boundary.
 *
 * Without this, an unexpected throw anywhere under /dashboard renders Next's bare error screen —
 * which, on a page that shows someone's payroll, reads like the money is gone. Reassure, offer a
 * retry (the usual cause is a transient RPC failure), and keep the digest for support.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[dashboard]", error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-5 py-16">
      <div className="w-full max-w-[460px] rounded-[22px] border border-[rgba(255,121,75,0.28)] bg-[rgba(255,121,75,0.06)] p-7">
        <h1 className="text-[19px] font-semibold tracking-[-0.02em] text-[#f4f4f5]">
          Something broke while loading this page
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#8c8c92]">
          Your streams, balances and pool are stored on Arc and are untouched by this. The usual
          cause is a temporary problem reaching the chain — retrying normally clears it.
        </p>
        <div className="mt-5 flex items-center gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-[#ff6a1a] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#ff8340]"
          >
            Try again
          </button>
          <Link
            href="/dashboard"
            className="rounded-full border border-[rgba(255,255,255,0.13)] px-4 py-2 text-[13px] font-medium text-[#f4f4f5] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
          >
            Back to overview
          </Link>
        </div>
        {error.digest && (
          <p className="mt-4 font-mono text-[11.5px] text-[#5d5d64]">ref {error.digest}</p>
        )}
      </div>
    </main>
  );
}
