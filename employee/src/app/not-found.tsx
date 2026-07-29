import Link from "next/link";

export const metadata = { title: "Not found · Magmos" };

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0a0a0b] px-5 py-16">
      <div className="w-full max-w-[400px] text-center">
        <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[#ff6a1a]">404</p>
        <h1 className="mt-3 text-[24px] font-semibold tracking-[-0.02em] text-[#f4f4f5]">
          That page isn&apos;t here
        </h1>
        <p className="mt-2 text-[13.5px] leading-relaxed text-[#8c8c92]">
          Your streamed pay is on-chain and unaffected.
        </p>
        <Link
          href="/"
          className="mt-6 inline-block rounded-full bg-[#ff6a1a] px-4 py-2 text-[13px] font-semibold text-black transition-colors hover:bg-[#ff8340]"
        >
          Back to your portal
        </Link>
      </div>
    </main>
  );
}
