"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { toast } from "sonner";
import { ShieldCheck, ShieldAlert } from "lucide-react";

import { CardLabel, IconChip, SweemCard } from "@/components/sweem-ui/primitives";
import { getPoolLiability, getUsdcAllowance } from "@/lib/reads";
import { approveUsdc, topup } from "@/lib/writes";
import { MAGMOS_PAYROLL, USDC, EXPLORER_TX } from "@/lib/magmos";
import { wagmiConfig } from "@/lib/wagmi";
import { usdcFixed } from "./helpers";

/**
 * Payroll coverage.
 *
 * The contract deliberately does not enforce that a pool holds enough to cover every stream's
 * accrued pay — `claim()` simply reverts when the pool runs dry, first-come-first-served. That
 * makes underfunding a *silent* condition until someone fails to get paid. This card makes it
 * loud, and gives the employer the one action that fixes it.
 */
export function CoverageCard({
  poolId,
  wallet,
  walletBalanceRaw,
  onFunded,
}: {
  poolId: `0x${string}`;
  wallet: `0x${string}`;
  walletBalanceRaw: bigint;
  onFunded: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const q = useQuery({
    queryKey: ["poolLiability", poolId],
    refetchInterval: 8000,
    retry: 3,
    placeholderData: (prev) => prev,
    queryFn: () => getPoolLiability(poolId),
  });

  const accrued = q.data?.accrued ?? 0n;
  const balance = q.data?.balance ?? 0n;
  const shortfall = q.data?.shortfall ?? 0n;
  const covered = accrued === 0n ? 100 : Number((balance * 1000n) / accrued) / 10;
  const pct = Math.min(100, Math.max(0, covered));
  const short = shortfall > 0n;
  const canFund = short && walletBalanceRaw >= shortfall;

  async function handleTopUp() {
    if (!short) return;
    setBusy(true);
    try {
      // Skip a redundant approval when the org has already granted enough allowance.
      const allowance = await getUsdcAllowance(wallet, MAGMOS_PAYROLL).catch(() => 0n);

      if (allowance < shortfall) {
        toast.message("Approving USDC", { description: "Confirm in your wallet" });
        const ah = await writeContractAsync(approveUsdc(MAGMOS_PAYROLL, shortfall));
        await waitForTransactionReceipt(wagmiConfig, { hash: ah });
      }

      const hash = await writeContractAsync(topup(poolId, shortfall));
      toast.success("Coverage top-up submitted", {
        description: `Tx ${hash.slice(0, 12)}…${hash.slice(-10)}`,
        action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(hash), "_blank") },
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      await q.refetch();
      onFunded();
      toast.success("Payroll fully covered");
    } catch (e) {
      toast.error((e as { shortMessage?: string }).shortMessage ?? "Top-up failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SweemCard className="mt-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <CardLabel>Payroll coverage</CardLabel>
          <p className="mt-1 max-w-[62ch] text-[13px] text-[var(--sw-text-muted)]">
            Whether your pool holds enough to pay everything your team has already earned. Streams
            keep accruing whether or not the pool is funded, so this is the number that decides if
            a claim goes through.
          </p>
        </div>
        <IconChip>
          {short ? <ShieldAlert size={16} className="text-[#ff794b]" /> : <ShieldCheck size={16} />}
        </IconChip>
      </div>

      <div className="mt-5 flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Earned and unclaimed</p>
          <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--sw-text)]">
            {usdcFixed(accrued)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </p>
        </div>
        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Held in pool</p>
          <p className="mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] text-[var(--sw-text)]">
            {usdcFixed(balance)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </p>
        </div>
        <div>
          <p className="text-[12px] text-[var(--sw-text-dim)]">Covered</p>
          <p
            className={`mt-1.5 text-[24px] font-semibold tabular-nums tracking-[-0.02em] ${
              short ? "text-[#ff794b]" : "text-[var(--sw-mint)]"
            }`}
          >
            {pct.toFixed(0)}%
          </p>
        </div>
      </div>

      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--sw-card-inset)]">
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            short ? "bg-[#ff794b]" : "bg-[var(--sw-mint)]"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {short ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-[rgba(255,121,75,0.28)] bg-[rgba(255,121,75,0.08)] px-4 py-3">
          <p className="text-[12.5px] leading-[1.5] text-[var(--sw-text-muted)]">
            <span className="font-semibold text-[#ff794b]">
              Short by {usdcFixed(shortfall)} USDC.
            </span>{" "}
            Someone claiming now could be turned away. Top up to cover everyone.
          </p>
          <button
            type="button"
            onClick={handleTopUp}
            disabled={busy || !canFund}
            title={canFund ? undefined : "Not enough USDC in your wallet"}
            className="shrink-0 rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[12.5px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:opacity-50"
          >
            {busy ? "Funding…" : `Top up ${usdcFixed(shortfall)} USDC`}
          </button>
        </div>
      ) : (
        <p className="mt-4 text-[12.5px] text-[var(--sw-text-dim)]">
          Every stream is fully funded. Nobody can be turned away at claim time.
        </p>
      )}
    </SweemCard>
  );
}
