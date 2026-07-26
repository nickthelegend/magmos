"use client";

import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";

import { CardLabel, IconChip, SweemCard } from "@/components/sweem-ui/primitives";
import { getAdvanceStats, getSubsidyBalance } from "@/lib/reads";
import { USDC, USDC_DECIMALS } from "@/lib/magmos";
import { usdcFixed } from "./helpers";

// Fees on small draws are genuinely sub-cent; rounding them to "0.00" would misreport who paid.
const usdSmart = (raw: bigint) => {
  const n = Number(raw) / 10 ** USDC_DECIMALS;
  const digits = n > 0 && n < 0.01 ? USDC_DECIMALS : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits });
};

/**
 * Employer view of Earned Wage Access.
 *
 * Deliberately does NOT show an "outstanding balance": a draw is settled out of pay the worker
 * had already accrued, so the employer is never owed anything afterwards. The two numbers that
 * genuinely matter to them are what has been taken and what could be taken right now (liquidity
 * planning) — plus who actually pays for the feature.
 */
export function AdvanceExposureCard({
  advancedRaw,
  drawableNowRaw,
  workers,
}: {
  advancedRaw: bigint;
  drawableNowRaw: bigint;
  workers: number;
}) {
  const statsQuery = useQuery({
    queryKey: ["advanceStats"],
    refetchInterval: 15000,
    queryFn: async () => {
      const [stats, subsidy] = await Promise.all([
        getAdvanceStats().catch(() => null),
        getSubsidyBalance(USDC).catch(() => 0n),
      ]);
      return { stats, subsidy };
    },
  });

  const stats = statsQuery.data?.stats;
  const subsidy = statsQuery.data?.subsidy ?? 0n;
  const feesCharged = stats?.feesCharged ?? 0n;
  const feesCovered = stats?.feesSubsidized ?? 0n;
  const feesOnWorkers = stats?.feesPaidByWorkers ?? 0n;
  const coveredPct =
    feesCharged > 0n ? Number((feesCovered * 1000n) / feesCharged) / 10 : 100;

  return (
    <SweemCard className="mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardLabel>Early wage access</CardLabel>
          <p className="mt-1 max-w-[62ch] text-[13px] text-[var(--sw-text-muted)]">
            Your team can take pay they have already earned, before payday. Each draw is settled
            from their accrued balance and netted off their next claim — nothing is lent, so there
            is no repayment to chase.
          </p>
        </div>
        <IconChip>
          <Zap size={16} />
        </IconChip>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-x-8 gap-y-5 sm:grid-cols-3">
        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Advanced to date</p>
          <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--sw-text)]">
            {usdcFixed(advancedRaw)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </p>
          <p className="mt-1 text-[12px] text-[var(--sw-text-dim)]">
            Already deducted from future claims
          </p>
        </div>

        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Available to draw now</p>
          <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--sw-mint)]">
            {usdcFixed(drawableNowRaw)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </p>
          <p className="mt-1 text-[12px] text-[var(--sw-text-dim)]">
            Across {workers} recipient{workers === 1 ? "" : "s"} · already funded in your pool
          </p>
        </div>

        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Access fees covered by yield</p>
          <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--sw-text)]">
            {feesCharged > 0n ? `${coveredPct.toFixed(0)}%` : "100%"}
          </p>
          <p className="mt-1 text-[12px] text-[var(--sw-text-dim)]">
            {usdSmart(feesCovered)} of {usdSmart(feesCharged)} USDC paid by float yield
          </p>
        </div>
      </div>

      {/* Who actually pays — the claim is auditable, so show the ledger behind it. */}
      <div className="mt-5 rounded-[14px] bg-[var(--sw-card-inset)] px-4 py-3.5">
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-[12.5px]">
          <span className="text-[var(--sw-text-muted)]">
            Yield parked to cover fees
            <span className="sweem-mono ml-2 font-semibold text-[var(--sw-text)]">
              {usdSmart(subsidy)} USDC
            </span>
          </span>
          <span className="text-[var(--sw-text-muted)]">
            Borne by workers
            <span className="sweem-mono ml-2 font-semibold text-[var(--sw-text)]">
              {usdSmart(feesOnWorkers)} USDC
            </span>
          </span>
        </div>
        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-[var(--sw-track)]">
          <div
            className="h-full rounded-full bg-[var(--sw-mint)] transition-[width] duration-500 ease-out"
            style={{ width: `${Math.min(100, Math.max(0, coveredPct))}%` }}
          />
        </div>
        <p className="mt-2.5 text-[12px] leading-[1.5] text-[var(--sw-text-dim)]">
          Idle payroll float earns yield while it waits to be claimed. That yield pays the access
          fee, so early pay costs your team nothing.
        </p>
      </div>
    </SweemCard>
  );
}
