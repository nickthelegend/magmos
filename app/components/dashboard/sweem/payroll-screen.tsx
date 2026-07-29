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
import {Coins, Pause, Play, Square, Plus, Search, Download, ArrowUpDown, Sliders, Copy } from "lucide-react";
import type { Address } from "viem";

import { CardLabel, IconChip, MoneyValue, SweemCard } from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { cn } from "@/lib/utils";
import { fromRaw, toRaw } from "@/lib/tokens";
import { wagmiConfig } from "@/lib/wagmi";
import { EXPLORER_TX, MAGMOS_PAYROLL } from "@/lib/magmos";
import {approveUsdc,
  topup,
  pauseStream,
  resumeStream,
  stopStream, pauseMany, resumeMany } from "@/lib/writes";
import { useOrgPool, type RecipientRow } from "./use-org-pool";
import { AdvanceExposureCard } from "./advance-exposure-card";
import { CoverageCard } from "./coverage-card";
import { AdvancePolicyModal } from "./advance-policy-modal";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, ConnectGate } from "./ui";
import { shortAddr, usdcFixed } from "./helpers";

const MONTH_S = 2_592_000n;

type SortKey = "name" | "monthly" | "streaming" | "advanced";

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
  const [policyOpen, setPolicyOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("monthly");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());

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

  // Search + sort are client-side: the whole roster is already in memory from one multicall,
  // so filtering here costs nothing and avoids another round trip per keystroke.
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = q
      ? state.recipients.filter(
          (r) => r.name.toLowerCase().includes(q) || r.address.toLowerCase().includes(q)
        )
      : state.recipients.slice();
    const dir = sortDir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sortKey === "name") {
        return dir * (a.name || a.address).localeCompare(b.name || b.address);
      }
      if (sortKey === "monthly") return dir * (rowMonthly(a, decimals) - rowMonthly(b, decimals));
      if (sortKey === "advanced") return dir * (Number(a.advancedRaw) - Number(b.advancedRaw));
      return dir * (Number(a.claimableRaw) - Number(b.claimableRaw));
    });
    return rows;
  }, [state.recipients, query, sortKey, sortDir, decimals]);

  const selectedRows = visibleRows.filter((r) => selected.has(r.address));
  const allVisibleSelected = visibleRows.length > 0 && selectedRows.length === visibleRows.length;

  function toggleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  function toggleSelect(addr: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(addr)) next.delete(addr);
      else next.add(addr);
      return next;
    });
  }

  async function copyAddr(addr: string) {
    try {
      await navigator.clipboard.writeText(addr);
      toast.success("Address copied");
    } catch {
      toast.error("Couldn't copy address");
    }
  }

  // Export exactly what is on screen (respects the current search + sort), so a finance team can
  // reconcile the same view they are looking at.
  function exportCsv() {
    const head = [
      "name",
      "address",
      "monthly_usdc",
      "claimable_usdc",
      "advanced_usdc",
      "drawable_now_usdc",
      "status",
    ];
    const lines = visibleRows.map((r) =>
      [
        `"${(r.name || "Recipient").replace(/"/g, '""')}"`,
        r.address,
        rowMonthly(r, decimals).toFixed(2),
        usdcFixed(r.claimableRaw),
        usdcFixed(r.advancedRaw),
        usdcFixed(r.drawableRaw),
        r.stopped ? "stopped" : r.paused ? "paused" : "streaming",
      ].join(",")
    );
    const csv = [head.join(","), ...lines].join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `magmos-payroll-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${visibleRows.length} row${visibleRows.length === 1 ? "" : "s"}`);
  }

  async function batchControl(kind: "pause" | "resume") {
    const addrs = selectedRows
      .filter((r) => !r.stopped && (kind === "pause" ? !r.paused : r.paused))
      .map((r) => r.address as Address);
    if (addrs.length === 0) {
      toast.message(`Nothing to ${kind}`, { description: "No selected stream is in that state." });
      return;
    }
    await act(
      `${kind} ${addrs.length} stream${addrs.length === 1 ? "" : "s"}`,
      () => (kind === "pause" ? pauseMany(poolId, addrs) : resumeMany(poolId, addrs))
    );
    setSelected(new Set());
  }

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

      {/* Chain unreachable — never let an RPC failure read as "you have no payroll". */}
      {stateQuery.isError && !stateQuery.data && (
        <div className="mb-4 rounded-[14px] border border-[rgba(255,121,75,0.28)] bg-[rgba(255,121,75,0.08)] px-4 py-3">
          <p className="text-[13px] font-semibold text-[#ff794b]">Can’t reach Arc right now</p>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            The public RPC is rate-limiting requests, so the figures below are not live. Your
            streams and balances on-chain are unaffected — this view will recover on its own.
          </p>
        </div>
      )}

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

      {/* Coverage first: whether the pool can actually pay what has been earned. */}
      <CoverageCard
        poolId={poolId}
        wallet={wallet as `0x${string}`}
        walletBalanceRaw={usdcBalanceRaw}
        onFunded={refresh}
      />

      {/* Earned wage access — exposure + who pays for it */}
      <AdvanceExposureCard
        advancedRaw={state.advancedRaw}
        drawableNowRaw={state.drawableNowRaw}
        workers={activeRecipients.length}
      />

      {/* Streams table */}
      <SweemCard className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardLabel>Active streams</CardLabel>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 focus-within:border-[var(--sw-mint)]/60">
              <Search size={13} className="shrink-0 text-[var(--sw-text-dim)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or address"
                aria-label="Search recipients"
                className="w-[168px] bg-transparent text-[12.5px] text-[var(--sw-text)] outline-none placeholder:text-[var(--sw-text-dim)]"
              />
            </label>
            <ActionButton onClick={exportCsv} disabled={visibleRows.length === 0}>
              <span className="inline-flex items-center gap-1.5"><Download size={14} /> CSV</span>
            </ActionButton>
            <ActionButton onClick={() => setPolicyOpen(true)}>
              <span className="inline-flex items-center gap-1.5"><Sliders size={14} /> Early access</span>
            </ActionButton>
          </div>
        </div>

        {/* Batch bar — appears only when a selection exists, so it never occupies idle space. */}
        {selectedRows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-[12px] border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5">
            <span className="text-[12.5px] text-[var(--sw-text-muted)]">
              <span className="font-semibold text-[var(--sw-text)]">{selectedRows.length}</span>{" "}
              selected
            </span>
            <span className="flex items-center gap-2">
              <ActionButton onClick={() => batchControl("pause")} disabled={busy}>
                <span className="inline-flex items-center gap-1.5"><Pause size={13} /> Pause</span>
              </ActionButton>
              <ActionButton onClick={() => batchControl("resume")} disabled={busy}>
                <span className="inline-flex items-center gap-1.5"><Play size={13} /> Resume</span>
              </ActionButton>
              <ActionButton onClick={() => setSelected(new Set())} disabled={busy}>
                Clear
              </ActionButton>
            </span>
          </div>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--sw-border)] text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="w-8 pb-2.5 font-medium">
                  <input
                    type="checkbox"
                    aria-label="Select all visible recipients"
                    checked={allVisibleSelected}
                    onChange={() =>
                      setSelected(
                        allVisibleSelected ? new Set() : new Set(visibleRows.map((r) => r.address))
                      )
                    }
                    className="size-[14px] accent-[var(--sw-mint)]"
                  />
                </th>
                <th
                  className="pb-2.5 font-medium"
                  aria-sort={sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <SortHeader label="Recipient" col="name" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </th>
                <th
                  className="pb-2.5 font-medium"
                  aria-sort={sortKey === "monthly" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <SortHeader label="Monthly" col="monthly" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </th>
                <th
                  className="pb-2.5 font-medium"
                  aria-sort={sortKey === "streaming" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <SortHeader label="Streaming now" col="streaming" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </th>
                <th
                  className="pb-2.5 font-medium"
                  aria-sort={sortKey === "advanced" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
                >
                  <SortHeader label="Drawn early" col="advanced" active={sortKey} dir={sortDir} onSort={toggleSort} />
                </th>
                <th className="pb-2.5 font-medium">Status</th>
                <th className="pb-2.5 text-right font-medium">Manage</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-[13px] text-[var(--sw-text-muted)]">
                    {query
                      ? `No recipient matches “${query}”.`
                      : "No recipients streaming yet."}
                  </td>
                </tr>
              )}
              {visibleRows.map((r) => {
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
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.name || r.address}`}
                        checked={selected.has(r.address)}
                        onChange={() => toggleSelect(r.address)}
                        className="size-[14px] accent-[var(--sw-mint)]"
                      />
                    </td>
                    <td className="py-3.5">
                      <div className="font-medium text-[var(--sw-text)]">{r.name || "Recipient"}</div>
                      <button
                        type="button"
                        onClick={() => copyAddr(r.address)}
                        title="Copy full address"
                        className="group inline-flex items-center gap-1 text-[12px] text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-mint)]"
                      >
                        {shortAddr(r.address)}
                        <Copy size={11} className="opacity-0 transition-opacity group-hover:opacity-100" />
                      </button>
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

      <AdvancePolicyModal
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        poolId={poolId}
        wallet={wallet as `0x${string}`}
        onSaved={refresh}
      />
    </div>
  );
}

/** Column header that doubles as a sort toggle, with the active direction shown. */
function SortHeader({
  label,
  col,
  active,
  dir,
  onSort,
}: {
  label: string;
  col: SortKey;
  active: SortKey;
  dir: "asc" | "desc";
  onSort: (k: SortKey) => void;
}) {
  const on = active === col;
  return (
    <button
      type="button"
      onClick={() => onSort(col)}
      // aria-sort is a property of the column header cell, not of a button inside it — the <th>
      // carries it (see the callers). Announce the action here instead.
      aria-label={`Sort by ${label}${on ? (dir === "asc" ? ", currently ascending" : ", currently descending") : ""}`}
      className={cn(
        "inline-flex items-center gap-1 uppercase tracking-wide transition-colors",
        on ? "text-[var(--sw-mint)]" : "text-[var(--sw-text-dim)] hover:text-[var(--sw-text-muted)]"
      )}
    >
      {label}
      {on ? (
        <span aria-hidden="true" className="text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>
      ) : (
        <ArrowUpDown size={10} className="opacity-50" />
      )}
    </button>
  );
}
