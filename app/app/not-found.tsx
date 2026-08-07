import Link from "next/link";

export const metadata = { title: "Not found · Magmos" };

/**
 * A 404 that points somewhere useful.
 *
 * The default Next.js page is a bare "404 | This page could not be found" on white, which on a
 * wallet-connected dashboard reads as "the app broke" rather than "that URL is wrong". The links
 * matter more than the styling: someone who mistyped a dashboard route should not have to go back
 * to the landing page and start over.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-[70vh] flex-col items-center justify-center px-6 text-center">
      <p className="text-[13px] font-semibold uppercase tracking-[0.14em] text-[var(--sw-mint)]">
        404
      </p>
      <h1 className="mt-3 text-[28px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
        That page doesn&apos;t exist
      </h1>
      <p className="mt-2 max-w-[46ch] text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
        Nothing is wrong with your payroll — the URL just doesn&apos;t match a page here.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2.5">
        <Link
          href="/dashboard"
          className="rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black"
        >
          Dashboard
        </Link>
        <Link
          href="/claim"
          className="rounded-full border border-[var(--sw-border-strong)] px-4 py-2 text-[13px] text-[var(--sw-text)]"
        >
          My private pay
        </Link>
        <Link
          href="/"
          className="rounded-full border border-[var(--sw-border-strong)] px-4 py-2 text-[13px] text-[var(--sw-text)]"
        >
          Home
        </Link>
      </div>
    </main>
  );
}
