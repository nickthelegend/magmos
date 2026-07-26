"use client";

import { useMemo, useState } from "react";
import { useWriteContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { toast } from "sonner";
import { motion } from "framer-motion";
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
} from "recharts";
import { Coins, Pause, Play, Square, Plus } from "lucide-react";
import type { Address } from "viem";

import { CardLabel, IconChip, MoneyValue, SweemCard } from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { cn } from "@/lib/utils";
import { fromRaw, toRaw } from "@/lib/tokens";
import { wagmiConfig } from "@/lib/wagmi";
import { EXPLORER_TX, MAGMOS_PAYROLL } from "@/lib/magmos";
import {
  approveUsdc,
  topup,
  pauseStream,
  resumeStream,
  stopStream,
} from "@/lib/writes";
import { useOrgPool, type RecipientRow } from "./use-org-pool";
import { AdvanceExposureCard } from "./advance-exposure-card";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, ConnectGate } from "./ui";
import { shortAddr, usdcFixed } from "./helpers";

const MONTH_S = 2_592_000n;

// Monthly USDC for a recipient: prefer the live on-chain rate normalized to a
// month, fall back to the metadata target salary.
function rowMonthly(row: RecipientRow, decimals: number): number {
  if (row.rateRaw > 0n && row.ratePeriod > 0n) {
    return Number((row.rateRaw * MONTH_S) / row.ratePeriod) / 10 ** decimals;
  }
  return row.monthlyUsdc;
}

const BAR_COLORS = ["#ff6a1a", "#ffb43d", "#ff8340", "#f5a742", "#ff6a1a", "#ffc46b"];

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: { payload: { name: string; value: number } }[];
}) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-xl border border-[var(--sw-border-strong)] bg-[#1c1c20] px-3 py-2 shadow-xl">
      <p className="text-[10px] uppercase tracking-wide text-[var(--sw-text-dim)]">{p.name}</p>
      <p className="text-[13px] font-semibold text-white">{p.value.toFixed(2)} USDC / mo</p>
    </div>
  );
}

export function PayrollScreen() {
  const { wallet, state, poolId, usdcBalanceRaw, anchorAt, stateQuery, token } = useOrgPool();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);

  const [topupOpen, setTopupOpen] = useState(false);
  const [topupAmt, setTopupAmt] = useState("");

  const decimals = token.decimals;
  const balance = fromRaw(token, state.balanceRaw);
  const monthly = fromRaw(token, state.monthlyRateRaw);
  const walletUsdc = fromRaw(token, usdcBalanceRaw);
  const runwayMonths = state.monthlyRateRaw > 0n
    ? Number(state.balanceRaw) / Number(state.monthlyRateRaw)
    : 0;

  const activeRecipients = useMemo(
    () => state.recipients.filter((r) => !r.stopped),
    [state.recipients]
  );

  const chartData = useMemo(
    () =>
      activeRecipients
        .map((r) => ({ name: r.name || shortAddr(r.address), value: rowMonthly(r, decimals) }))
        .filter((d) => d.value > 0)
        .sort((a, b) => b.value - a.value)
        .slice(0, 8),
    [activeRecipients, decimals]
  );

  function refresh() {
    stateQuery.refetch();
  }

  // per-stream action (pause / resume / stop)
  async function act(
    kind: string,
    build: () => Parameters<typeof writeContractAsync>[0]
  ) {
    if (busy) return;
    setBusy(true);
    try {
      const hash = await writeContractAsync(build());
      toast.success(`${kind} submitted`, {
        description: `Tx ${hash.slice(0, 12)}…${hash.slice(-10)}`,
        action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(hash), "_blank") },
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      refresh();
    } catch {
      toast.error(`Could not ${kind} stream`);
    } finally {
      setBusy(false);
    }
  }

  async function handleTopup() {
    const amt = Number(topupAmt) || 0;
    if (!wallet) return toast.error("Connect a wallet first");
    if (amt <= 0) return toast.error("Enter an amount to top up");
    if (!state.funded) return toast.error("Fund payroll from the Overview first");
    const amount = toRaw(token, amt);
    if (amount > usdcBalanceRaw) return toast.error("Insufficient USDC balance");
    setBusy(true);
    try {
      const approveHash = await writeContractAsync(approveUsdc(MAGMOS_PAYROLL, amount));
      toast.message("Approving USDC", { description: "Confirm in your wallet" });
      await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      const hash = await writeContractAsync(topup(poolId, amount));
      toast.success(`Topped up ${amt.toLocaleString()} USDC`, {
        description: `Tx ${hash.slice(0, 12)}…${hash.slice(-10)}`,
        action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(hash), "_blank") },
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      setTopupOpen(false);
      setTopupAmt("");
      refresh();
    } catch {
      toast.error("Top-up failed");
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="dashboard-content">
        <ConnectGate message="Connect your wallet to manage payroll streams." />
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Payroll</h1>
          <p className="mt-1 text-[14px] text-[var(--sw-text-muted)]">
            Streaming USDC to your team every second on Arc.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--sw-text)]">
            <TokenIcon token={token} size={15} /> USDC
          </span>
          <ActionButton variant="primary" onClick={() => setTopupOpen(true)}>
            <span className="inline-flex items-center gap-1.5"><Plus size={15} /> Top up pool</span>
          </ActionButton>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SweemCard>
          <CardLabel>Total in pool</CardLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <MoneyValue value={balance} className="text-[30px] text-[var(--sw-text)]" />
            <span className="text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">Idle + streaming</p>
        </SweemCard>
        <SweemCard>
          <CardLabel>Monthly commitment</CardLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <MoneyValue value={monthly} className="text-[30px] text-[var(--sw-text)]" />
            <span className="text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">{activeRecipients.length} active stream{activeRecipients.length === 1 ? "" : "s"}</p>
        </SweemCard>
        <SweemCard>
          <CardLabel>Runway</CardLabel>
          <div className="mt-2 text-[30px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
            {runwayMonths > 0 ? `${runwayMonths.toFixed(1)}` : "—"}
            <span className="ml-1.5 text-[15px] font-medium text-[var(--sw-text-muted)]">months</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">At the current rate</p>
        </SweemCard>
        <SweemCard>
          <CardLabel>Streamed to date</CardLabel>
          <div className="mt-2 text-[30px] font-semibold tracking-[-0.02em] text-[var(--sw-mint)]">
            <LiveTicker
              baseRaw={state.streamedRaw}
              rateRaw={state.monthlyRateRaw}
              periodSecs={MONTH_S}
              anchorAt={anchorAt}
              active={state.funded}
              decimals={decimals}
            />
            <span className="ml-1.5 text-[15px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">Live, per second</p>
        </SweemCard>
      </div>

      {/* Monthly payroll chart */}
      <SweemCard className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <CardLabel>Monthly payroll</CardLabel>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">Committed USDC per recipient, per month</p>
          </div>
          <IconChip><Coins size={16} /></IconChip>
        </div>
        <div className="mt-4 h-[220px] w-full">
          {chartData.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 24, right: 8, bottom: 4, left: 8 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fill: "var(--sw-text-muted)", fontSize: 12 }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip cursor={{ fill: "rgba(255,255,255,0.03)" }} content={<ChartTooltip />} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                  {chartData.map((_, i) => (
                    <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                  ))}
                  <LabelList
                    dataKey="value"
                    position="top"
                    formatter={(v) => `${Math.round(Number(v))}`}
                    fill="var(--sw-text-muted)"
                    fontSize={11}
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-full items-center justify-center text-[13px] text-[var(--sw-text-muted)]">
              No active streams yet — fund payroll from the Overview to begin.
            </div>
          )}
        </div>
      </SweemCard>

      {/* Earned wage access — exposure + who pays for it */}
      <AdvanceExposureCard
        advancedRaw={state.advancedRaw}
        drawableNowRaw={state.drawableNowRaw}
        workers={activeRecipients.length}
      />

      {/* Streams table */}
      <SweemCard className="mt-4">
        <CardLabel>Active streams</CardLabel>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--sw-border)] text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="pb-2.5 font-medium">Recipient</th>
                <th className="pb-2.5 font-medium">Monthly</th>
                <th className="pb-2.5 font-medium">Streaming now</th>
                <th className="pb-2.5 font-medium">Drawn early</th>
                <th className="pb-2.5 font-medium">Status</th>
                <th className="pb-2.5 text-right font-medium">Manage</th>
              </tr>
            </thead>
            <tbody>
              {state.recipients.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[13px] text-[var(--sw-text-muted)]">
                    No recipients streaming yet.
                  </td>
                </tr>
              )}
              {state.recipients.map((r) => {
                const mo = rowMonthly(r, decimals);
                const status = r.stopped ? "Stopped" : r.paused ? "Paused" : "Streaming";
                return (
                  <motion.tr
                    key={r.address}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b border-[var(--sw-border)] last:border-0"
                  >
                    <td className="py-3.5">
                      <div className="font-medium text-[var(--sw-text)]">{r.name || "Recipient"}</div>
                      <div className="text-[12px] text-[var(--sw-text-muted)]">{shortAddr(r.address)}</div>
                    </td>
                    <td className="py-3.5 tabular-nums text-[var(--sw-text)]">{mo.toFixed(2)} <span className="text-[12px] text-[var(--sw-text-muted)]">USDC</span></td>
                    <td className="py-3.5 tabular-nums font-semibold text-[var(--sw-mint)]">
                      {r.stopped ? (
                        <span className="text-[var(--sw-text-dim)]">{usdcFixed(r.claimableRaw)}</span>
                      ) : (
                        <LiveTicker
                          baseRaw={r.claimableRaw}
                          rateRaw={r.paused ? 0n : r.rateRaw}
                          periodSecs={r.ratePeriod || MONTH_S}
                          anchorAt={anchorAt}
                          active={!r.paused && !r.stopped}
                          decimals={decimals}
                        />
                      )}
                    </td>
                    <td className="py-3.5 tabular-nums">
                      {r.advancedRaw > 0n ? (
                        <>
                          <span className="text-[var(--sw-text)]">{usdcFixed(r.advancedRaw)}</span>{" "}
                          <span className="text-[12px] text-[var(--sw-text-muted)]">USDC</span>
                        </>
                      ) : (
                        <span className="text-[var(--sw-text-dim)]">—</span>
                      )}
                      <div className="text-[11.5px] text-[var(--sw-text-dim)]">
                        {usdcFixed(r.drawableRaw)} available
                      </div>
                    </td>
                    <td className="py-3.5">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold",
                          status === "Streaming" && "bg-[rgba(255,106,26,0.14)] text-[var(--sw-mint)]",
                          status === "Paused" && "bg-[rgba(255,180,61,0.14)] text-[var(--sw-lavender)]",
                          status === "Stopped" && "bg-[var(--sw-card-inset)] text-[var(--sw-text-dim)]"
                        )}
                      >
                        <span className={cn(
                          "size-1.5 rounded-full",
                          status === "Streaming" && "bg-[var(--sw-mint)]",
                          status === "Paused" && "bg-[var(--sw-lavender)]",
                          status === "Stopped" && "bg-[var(--sw-text-dim)]"
                        )} />
                        {status}
                      </span>
                    </td>
                    <td className="py-3.5">
                      <div className="flex items-center justify-end gap-1.5">
                        {!r.stopped && r.paused && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("resume", () => resumeStream(poolId, r.address as Address))}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-mint)] disabled:opacity-40"
                          >
                            <Play size={13} /> Resume
                          </button>
                        )}
                        {!r.stopped && !r.paused && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("pause", () => pauseStream(poolId, r.address as Address))}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] disabled:opacity-40"
                          >
                            <Pause size={13} /> Pause
                          </button>
                        )}
                        {!r.stopped && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => act("stop", () => stopStream(poolId, r.address as Address))}
                            className="inline-flex items-center gap-1 rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1.5 text-[12px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[#ff794b] disabled:opacity-40"
                          >
                            <Square size={13} /> Stop
                          </button>
                        )}
                      </div>
                    </td>
                  </motion.tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SweemCard>

      {/* Top-up modal */}
      <Modal
        open={topupOpen}
        onClose={() => setTopupOpen(false)}
        title="Top up pool"
        subtitle={`Wallet balance: ${walletUsdc.toLocaleString(undefined, { maximumFractionDigits: 2 })} USDC`}
        footer={
          <>
            <ActionButton onClick={() => setTopupOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" disabled={busy} onClick={handleTopup}>
              {busy ? "Confirming…" : "Approve & top up"}
            </ActionButton>
          </>
        }
      >
        <div className="flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 focus-within:border-[var(--sw-mint)]/60">
          <input
            type="number"
            inputMode="decimal"
            autoFocus
            className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold tabular-nums text-[var(--sw-text)] outline-none placeholder:font-normal placeholder:text-[var(--sw-text-muted)]"
            placeholder="0.00"
            value={topupAmt}
            onChange={(e) => setTopupAmt(e.target.value)}
          />
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--sw-card-inset)] px-2.5 py-1 text-[12px] font-semibold text-[var(--sw-text)]">
            <TokenIcon token={token} size={15} /> USDC
          </span>
        </div>
        <p className="text-[12.5px] text-[var(--sw-text-muted)]">
          Adds liquidity to the streaming pool so payroll keeps flowing. Approve then top up — two quick signatures on Arc.
        </p>
      </Modal>
    </div>
  );
}
