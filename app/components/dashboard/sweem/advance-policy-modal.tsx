"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { toast } from "sonner";

import { getAdvancePolicy, getUsdcAllowance } from "@/lib/reads";
import { setPoolPolicy, fundSubsidy, approveUsdc } from "@/lib/writes";
import { MAGMOS_ADVANCE, USDC, USDC_DECIMALS, EXPLORER_TX } from "@/lib/magmos";
import { wagmiConfig } from "@/lib/wagmi";
import { ActionButton, Modal, AmountInput } from "./ui";

const toRawUsdc = (n: number) => BigInt(Math.round(n * 10 ** USDC_DECIMALS));

/**
 * Employer controls for early wage access.
 *
 * Deliberately an *envelope*, not an approval queue: an employer sets how much of earned pay their
 * team may reach and walks away. Per-draw approval would put a human back in the path and recreate
 * the guarantor model that EWA exists to remove.
 */
export function AdvancePolicyModal({
  open,
  onClose,
  poolId,
  wallet,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  poolId: `0x${string}`;
  wallet: `0x${string}`;
  onSaved: () => void;
}) {
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [maxPct, setMaxPct] = useState(100);
  const [minDraw, setMinDraw] = useState("0.01");
  const [enabled, setEnabled] = useState(true);
  const [subsidy, setSubsidy] = useState("");

  const policyQuery = useQuery({
    queryKey: ["advancePolicy", poolId],
    enabled: open,
    queryFn: () => getAdvancePolicy(poolId),
  });

  // Seed the form from chain state whenever the modal opens.
  useEffect(() => {
    const p = policyQuery.data;
    if (!open || !p) return;
    setMaxPct(Math.round(Number(p.maxDrawBps) / 100));
    setMinDraw((Number(p.minDraw) / 10 ** USDC_DECIMALS).toString());
    setEnabled(!p.disabled);
  }, [open, policyQuery.data]);

  async function send(
    label: string,
    request: Parameters<typeof writeContractAsync>[0]
  ): Promise<boolean> {
    const hash = await writeContractAsync(request);
    toast.success(`${label} submitted`, {
      description: `Tx ${hash.slice(0, 12)}…${hash.slice(-10)}`,
      action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(hash), "_blank") },
    });
    await waitForTransactionReceipt(wagmiConfig, { hash });
    return true;
  }

  async function handleSave() {
    setBusy(true);
    try {
      await send(
        "Policy update",
        setPoolPolicy(poolId, Math.round(maxPct * 100), toRawUsdc(Number(minDraw) || 0), !enabled)
      );
      await policyQuery.refetch();
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as { shortMessage?: string }).shortMessage ?? "Could not update policy");
    } finally {
      setBusy(false);
    }
  }

  async function handleFundSubsidy() {
    const amount = Number(subsidy);
    if (!Number.isFinite(amount) || amount <= 0) return;
    const raw = toRawUsdc(amount);
    setBusy(true);
    try {
      const allowance = await getUsdcAllowance(wallet, MAGMOS_ADVANCE).catch(() => 0n);
      if (allowance < raw) {
        toast.message("Approving USDC", { description: "Confirm in your wallet" });
        const ah = await writeContractAsync(approveUsdc(MAGMOS_ADVANCE, raw));
        await waitForTransactionReceipt(wagmiConfig, { hash: ah });
      }
      await send("Subsidy funding", fundSubsidy(USDC, raw));
      setSubsidy("");
      onSaved();
      toast.success("Yield parked — your team's access fees are covered");
    } catch (e) {
      toast.error((e as { shortMessage?: string }).shortMessage ?? "Could not fund subsidy");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Early access settings"
      subtitle={
        <>
          Set how much of already-earned pay your team can reach before payday. You never approve
          individual draws — the stream is the collateral.
        </>
      }
      footer={
        <>
          <ActionButton onClick={onClose} disabled={busy}>
            Cancel
          </ActionButton>
          <ActionButton variant="primary" onClick={handleSave} disabled={busy}>
            {busy ? "Saving…" : "Save policy"}
          </ActionButton>
        </>
      }
    >
      {/* on / off */}
      <label className="flex items-center justify-between gap-4 rounded-[12px] bg-[var(--sw-card-inset)] px-3.5 py-3">
        <span>
          <span className="block text-[13.5px] font-medium text-[var(--sw-text)]">
            Allow early access
          </span>
          <span className="mt-0.5 block text-[12px] text-[var(--sw-text-muted)]">
            Turning this off leaves normal claiming untouched.
          </span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="size-[18px] accent-[var(--sw-mint)]"
        />
      </label>

      {/* cap */}
      <div className="mt-4">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-medium text-[var(--sw-text)]">
            Maximum share of earned pay
          </span>
          <span className="sweem-mono text-[14px] font-semibold text-[var(--sw-mint)]">
            {maxPct}%
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={maxPct}
          disabled={!enabled}
          onChange={(e) => setMaxPct(Number(e.target.value))}
          className="mt-2.5 w-full accent-[var(--sw-mint)] disabled:opacity-40"
          aria-label="Maximum share of earned pay a worker may draw"
        />
        <p className="mt-1.5 text-[12px] text-[var(--sw-text-dim)]">
          {maxPct === 100
            ? "Your team can reach everything they have earned."
            : `A worker who has earned 1,000 USDC could draw up to ${(maxPct * 10).toFixed(0)} USDC.`}
        </p>
      </div>

      {/* minimum */}
      <div className="mt-4">
        <AmountInput
          label="Minimum draw"
          value={minDraw}
          onChange={setMinDraw}
          hint="Stops dust-sized draws. 0.01 matches the claim floor."
        />
      </div>

      {/* subsidy */}
      <div className="mt-5 border-t border-[var(--sw-border)] pt-4">
        <p className="text-[13px] font-medium text-[var(--sw-text)]">Cover your team&apos;s fees</p>
        <p className="mt-1 text-[12px] leading-[1.5] text-[var(--sw-text-muted)]">
          Park yield from your idle payroll float here and it pays the 0.5% access fee, so early pay
          costs your team nothing. Every contribution is recorded on-chain.
        </p>
        <div className="mt-3">
          <AmountInput label="Amount to park" value={subsidy} onChange={setSubsidy} />
        </div>
        <ActionButton
          onClick={handleFundSubsidy}
          disabled={busy || !subsidy || Number(subsidy) <= 0}
        >
          {busy ? "Working…" : "Park yield to cover fees"}
        </ActionButton>
      </div>
    </Modal>
  );
}
