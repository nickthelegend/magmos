import Link from "next/link";

export const metadata = { title: "Not found · Magmos" };

// A branded 404 rather than Next's default. Dashboard URLs are deep-linkable now, so a mistyped
// one is a plausible way to land here — offer the two places anyone actually wants.
export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0b] px-5 py-16">
      <div className="w-full max-w-[420px] text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#ff6a1a]">
          404
        </p>
        <h1 className="mt-3 text-[26px] font-semibold tracking-[-0.02em] text-[#f4f4f5]">
          That page isn&apos;t here
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#8c8c92]">
          The link may be out of date. Your payroll and balances live on-chain and are unaffected.
        </p>
        <div className="mt-6 flex items-center justify-center gap-2.5">
          <Link
            href="/dashboard"
            className="rounded-full bg-[#ff6a1a] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#ff8340]"
          >
            Go to dashboard
          </Link>
          <Link
            href="/"
            className="rounded-full border border-[rgba(255,255,255,0.13)] px-4 py-2 text-[13px] font-medium text-[#f4f4f5] transition-colors hover:bg-[rgba(255,255,255,0.05)]"
          >
            Home
          </Link>
        </div>
      </div>
    </main>
  );
}
