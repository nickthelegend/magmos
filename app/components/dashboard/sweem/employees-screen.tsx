"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, XAxis } from "recharts";
import {
  Coins,
  Layers,
  Search,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import { type AddEmployeeInput, type Employee, type Group } from "@/lib/api";
import {
  fromRaw,
  TOKENS,
  TOKEN_SYMBOLS,
  type TokenSymbol,
} from "@/lib/tokens";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import {
  CardLabel,
  IconChip,
  MoneyValue,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ActionButton, ConnectGate, Modal } from "./ui";
import { useOrgPool } from "./use-org-pool";
import { monthlyRate, shortAddr } from "./helpers";

const NO_GROUP = "__none__";
const PAGE_SIZE = 10;

const inputCls =
  "w-full rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]";

// Subtle tinted avatar chips — Arc brand accents (mint = orange, lavender =
// amber), matching the rgba(brand,α) tint convention used across the dashboard.
const AVATAR_TONES = [
  { bg: "rgba(255,106,26,0.14)", fg: "var(--sw-mint)" },
  { bg: "rgba(255,180,61,0.16)", fg: "var(--sw-lavender)" },
] as const;

// Distinct slices for the group distribution donut/bar.
const SLICE_COLORS = [
  "var(--sw-mint)",
  "var(--sw-lavender)",
  "#7dd3fc",
  "#fca5a5",
  "#fcd34d",
  "#a7f3d0",
  "#c4b5fd",
  "#f9a8d4",
];

type StatusKey = "Streaming" | "Paused" | "Stopped" | "Pending" | "—";

// Magmos on Arc is USDC-only, so an employee's rate table is a single USDC leg.
// Kept in this shape so the per-token render loops read like the multi-token UI.
function ratesByToken(e: Employee): Partial<Record<TokenSymbol, number>> {
  return { USDC: monthlyRate(e) };
}

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function StatCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SweemCard className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="text-[24px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
        {children}
      </div>
    </SweemCard>
  );
}

export function EmployeesScreen() {
  const { wallet, api, org, employees, groups, state, totalMonthlyMeta } = useOrgPool();
  const qc = useQueryClient();

  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [groupFilter, setGroupFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<string>("name");
  const [page, setPage] = useState(0);

  // add / edit employee modal (editingId null ⇒ add mode; id = wallet address)
  const [addOpen, setAddOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [groupId, setGroupId] = useState<string>(NO_GROUP);
  const [rates, setRates] = useState<Record<TokenSymbol, string>>({ USDC: "" });

  // bulk-edit modal
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRates, setBulkRates] = useState<Record<string, Record<TokenSymbol, string>>>({});
  const [applyToken, setApplyToken] = useState<TokenSymbol>("USDC");
  const [applyValue, setApplyValue] = useState("");

  // create-group modal
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupName, setGroupName] = useState("");

  const groupLabel = useMemo(() => {
    const m = new Map<string, string>();
    groups.forEach((g) => m.set(g.id, g.name));
    return m;
  }, [groups]);

  // On-chain stream status per recipient address, joined from the org pool.
  const statusByAddr = useMemo(() => {
    const m: Record<string, { paused: boolean; stopped: boolean; onChain: boolean }> = {};
    for (const r of state.recipients) {
      m[r.address.toLowerCase()] = { paused: r.paused, stopped: r.stopped, onChain: r.onChain };
    }
    return m;
  }, [state.recipients]);

  // On-chain stream status for an employee (USDC-only).
  const statusOf = (e: Employee): StatusKey => {
    if (monthlyRate(e) <= 0) return "—";
    const st = statusByAddr[e.walletAddress.toLowerCase()];
    if (!st || !st.onChain) return "Pending";
    if (st.stopped) return "Stopped";
    if (st.paused) return "Paused";
    return "Streaming";
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = employees.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q) && !e.walletAddress.toLowerCase().includes(q))
        return false;
      if (groupFilter !== "all") {
        const key = e.group ?? NO_GROUP;
        if (key !== groupFilter) return false;
      }
      if (statusFilter !== "all" && statusOf(e) !== statusFilter) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      if (sortBy === "name") return a.name.localeCompare(b.name);
      return monthlyRate(b) - monthlyRate(a);
    });
    return list;
    // statusOf reads statusByAddr; recompute when statuses change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [employees, search, groupFilter, statusFilter, sortBy, statusByAddr]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const distribution = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of employees) {
      const key = e.group ?? NO_GROUP;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const total = employees.length || 1;
    return Array.from(counts.entries()).map(([key, count], i) => ({
      key,
      label: key === NO_GROUP ? "Ungrouped" : groupLabel.get(key) ?? key,
      count,
      pct: (count / total) * 100,
      color: SLICE_COLORS[i % SLICE_COLORS.length],
    }));
  }, [employees, groupLabel]);

  function resetEmployeeForm() {
    setEditingId(null);
    setName("");
    setAddr("");
    setGroupId(NO_GROUP);
    setRates({ USDC: "" });
  }

  function openAdd() {
    resetEmployeeForm();
    setAddOpen(true);
  }

  function openEdit(e: Employee) {
    setEditingId(e.walletAddress);
    setName(e.name);
    setAddr(e.walletAddress);
    setGroupId(e.group ?? NO_GROUP);
    setRates({ USDC: e.monthlyUsdc ? String(e.monthlyUsdc) : "" });
    setAddOpen(true);
  }

  async function handleSubmitEmployee() {
    if (!wallet) return;
    const monthly = Number(rates.USDC) || 0;
    if (monthly <= 0 || (!editingId && (!name.trim() || !addr.trim()))) {
      toast.error(
        editingId
          ? "Set a positive monthly rate"
          : "Name, wallet address and a positive monthly rate are required",
      );
      return;
    }
    setBusy(true);
    try {
      // POST /employees upserts by (org, walletAddress), so the same call
      // covers both add and edit — the wallet address is the stable key.
      await api.addEmployee(wallet, {
        walletAddress: editingId ?? addr.trim(),
        name: name.trim(),
        monthlyUsdc: monthly,
        group: groupId === NO_GROUP ? null : groupId,
      });
      toast.success(editingId ? `Updated ${name.trim()}` : `Added ${name.trim()}`);
      setAddOpen(false);
      resetEmployeeForm();
      await qc.invalidateQueries({ queryKey: ["employees", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openBulk() {
    const init: Record<string, Record<TokenSymbol, string>> = {};
    for (const e of employees) {
      init[e.walletAddress] = { USDC: e.monthlyUsdc ? String(e.monthlyUsdc) : "" };
    }
    setBulkRates(init);
    setApplyValue("");
    setBulkOpen(true);
  }

  function setBulkRate(id: string, token: TokenSymbol, value: string) {
    setBulkRates((prev) => ({ ...prev, [id]: { ...prev[id], [token]: value } }));
  }

  function applyToAll() {
    setBulkRates((prev) => {
      const next = { ...prev };
      for (const e of employees) next[e.walletAddress] = { ...next[e.walletAddress], [applyToken]: applyValue };
      return next;
    });
  }

  async function handleSaveBulk() {
    if (!wallet) return;
    // No dedicated bulk-rate endpoint; the bulk upsert route doubles as it, so
    // each changed row carries its existing name/group alongside the new rate.
    const updates: AddEmployeeInput[] = [];
    for (const e of employees) {
      const cur = monthlyRate(e);
      const b = bulkRates[e.walletAddress] ?? { USDC: "" };
      const next = Number(b.USDC) || 0;
      if (next === cur) continue;
      updates.push({
        walletAddress: e.walletAddress,
        name: e.name,
        monthlyUsdc: next,
        group: e.group ?? null,
      });
    }
    if (updates.length === 0) {
      toast.error("No changes to save");
      return;
    }
    setBusy(true);
    try {
      await api.bulkAddEmployees(wallet, updates);
      toast.success(`Updated ${updates.length} employee${updates.length === 1 ? "" : "s"}`);
      setBulkOpen(false);
      await qc.invalidateQueries({ queryKey: ["employees", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateGroup() {
    if (!wallet || !groupName.trim()) return;
    setBusy(true);
    try {
      await api.createGroup(wallet, groupName.trim());
      toast.success(`Group "${groupName.trim()}" created`);
      setGroupName("");
      setGroupOpen(false);
      await qc.invalidateQueries({ queryKey: ["groups", wallet] });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <DashboardPageShell title="Employees">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to manage employees." />
        </div>
      </DashboardPageShell>
    );
  }
  if (!org) {
    return (
      <DashboardPageShell title="Employees">
        <div className="sweem-card mt-5">
          <ConnectGate message="Create your organization on the Overview page first." />
        </div>
      </DashboardPageShell>
    );
  }

  return (
    <DashboardPageShell
      title="Employees"
      subtitle="Add team members and set each one's monthly USDC rate."
    >
      {/* stat band + distribution */}
      <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="grid grid-cols-2 gap-4 lg:col-span-7">
          <StatCard icon={<Users className="size-[18px]" strokeWidth={2} />} label="Employees">
            {employees.length}
          </StatCard>
          <StatCard icon={<Layers className="size-[18px]" strokeWidth={2} />} label="Groups">
            {groups.length}
          </StatCard>
          <StatCard
            icon={<Wallet className="size-[18px]" strokeWidth={2} />}
            label={
              <span className="inline-flex items-center gap-1">
                Monthly · <TokenIcon token={TOKENS.USDC} size={14} /> USDC
              </span>
            }
          >
            <MoneyValue value={totalMonthlyMeta} />
          </StatCard>
          <StatCard
            icon={<Coins className="size-[18px]" strokeWidth={2} />}
            label={
              <span className="inline-flex items-center gap-1">
                Streaming · <TokenIcon token={TOKENS.USDC} size={14} /> USDC
              </span>
            }
          >
            <MoneyValue value={fromRaw(TOKENS.USDC, state.monthlyRateRaw)} />
          </StatCard>
        </div>
        <div className="lg:col-span-5">
          <GroupDistributionCard data={distribution} />
        </div>
      </div>

      {/* employee list */}
      <SweemCard className="mt-4 flex flex-col">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardLabel className="text-[15px] text-[var(--sw-text)]">Employee List</CardLabel>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--sw-text-dim)]" />
              <input
                className={`${inputCls} w-[200px] pl-9`}
                placeholder="Search employee"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(0);
                }}
              />
            </div>
            <FilterSelect
              value={groupFilter}
              onChange={(v) => {
                setGroupFilter(v);
                setPage(0);
              }}
              placeholder="All groups"
              options={[
                { value: "all", label: "All groups" },
                { value: NO_GROUP, label: "Ungrouped" },
                ...groups.map((g) => ({ value: g.id, label: g.name })),
              ]}
            />
            <FilterSelect
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                setPage(0);
              }}
              placeholder="All status"
              options={[
                { value: "all", label: "All status" },
                { value: "Streaming", label: "Streaming" },
                { value: "Paused", label: "Paused" },
                { value: "Pending", label: "Pending" },
                { value: "Stopped", label: "Stopped" },
              ]}
            />
            <FilterSelect
              value={sortBy}
              onChange={setSortBy}
              placeholder="Sort by"
              options={[
                { value: "name", label: "Name" },
                { value: "USDC", label: "USDC rate" },
              ]}
            />
            <ActionButton onClick={() => setGroupOpen(true)}>＋ Group</ActionButton>
            {employees.length > 0 && <ActionButton onClick={openBulk}>Bulk edit</ActionButton>}
            <ActionButton variant="primary" onClick={openAdd}>
              <UserPlus className="size-[15px]" strokeWidth={2.2} /> Add employee
            </ActionButton>
          </div>
        </div>

        <div className="dashboard-data-table-wrap sweem-tablecard mt-4">
          {rows.length === 0 ? (
            <div className="sweem-gate">
              {employees.length === 0 ? "No employees yet, add your first team member." : "No employees match these filters."}
            </div>
          ) : (
            <table className="sweem-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Wallet</th>
                  <th>Group</th>
                  <th>USDC / mo</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((e, i) => {
                  const tone = AVATAR_TONES[(e.name.charCodeAt(0) + e.name.length) % AVATAR_TONES.length];
                  const r = ratesByToken(e);
                  const status = statusOf(e);
                  const group = e.group ? groupLabel.get(e.group) ?? "—" : "Ungrouped";
                  return (
                    <motion.tr
                      key={e.walletAddress}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.03 * i, type: "spring", stiffness: 260, damping: 26 }}
                    >
                      <td>
                        <span className="flex items-center gap-3">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[12px] font-semibold"
                            style={{ background: tone.bg, color: tone.fg }}
                          >
                            {initials(e.name)}
                          </span>
                          <span className="font-medium text-[var(--sw-text)]">{e.name}</span>
                          {/* Confidential payroll holds this person's line back rather than paying
                              them in the clear, so the employer has to be able to see it before a
                              run — not discover it in a failed line afterwards. */}
                          {e.privatePayoutReady === false && (
                            <span
                              title="No private payout key. Confidential payroll will skip them until they set one up at /claim."
                              className="rounded-full border border-[rgba(255,180,61,0.35)] bg-[rgba(255,180,61,0.1)] px-2 py-[2px] text-[10.5px] font-medium uppercase tracking-[0.05em] text-[var(--sw-lavender)]"
                            >
                              no payout key
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="sweem-mono text-xs">{shortAddr(e.walletAddress)}</td>
                      <td>{group}</td>
                      <td>
                        <RateCell amount={r.USDC} symbol="USDC" />
                      </td>
                      <td>
                        <span className={`sweem-badge ${STATUS_BADGE[status]}`}>{status}</span>
                      </td>
                      <td>
                        <ActionButton onClick={() => openEdit(e)}>Edit</ActionButton>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {rows.length > 0 && (
          <div className="mt-3 flex items-center justify-between text-[12.5px] text-[var(--sw-text-muted)]">
            <span>
              Showing {safePage * PAGE_SIZE + 1}–{Math.min(rows.length, (safePage + 1) * PAGE_SIZE)} of {rows.length}
            </span>
            <div className="flex items-center gap-2">
              <ActionButton onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
                Prev
              </ActionButton>
              <span className="tabular-nums">
                {safePage + 1} / {pageCount}
              </span>
              <ActionButton onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))} disabled={safePage >= pageCount - 1}>
                Next
              </ActionButton>
            </div>
          </div>
        )}
      </SweemCard>

      {/* add / edit employee modal */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title={editingId ? "Edit employee" : "Add employee"}
        subtitle="Set the monthly USDC rate streamed to this employee. Leave blank to exclude them from payroll."
        footer={
          <>
            <ActionButton onClick={() => setAddOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" onClick={handleSubmitEmployee} disabled={busy}>
              {editingId ? "Save changes" : "Add employee"}
            </ActionButton>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
          <Field label="Name">
            <input
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane"
              disabled={!!editingId}
            />
          </Field>
          <Field label="Group">
            <Select value={groupId} onValueChange={setGroupId}>
              <SelectTrigger>
                <SelectValue placeholder="No group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_GROUP}>No group</SelectItem>
                {groups.map((g: Group) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Wallet address" className="sm:col-span-2">
            <input
              className={`${inputCls} font-mono`}
              value={addr}
              onChange={(e) => setAddr(e.target.value)}
              placeholder="0x…"
              disabled={!!editingId}
            />
          </Field>
          {TOKEN_SYMBOLS.map((token) => (
            <Field key={token} label={`Monthly ${token}`}>
              <div className="relative">
                <TokenIcon
                  token={TOKENS[token]}
                  size={16}
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"
                />
                <input
                  className={`${inputCls} pl-9`}
                  type="number"
                  inputMode="decimal"
                  value={rates[token]}
                  onChange={(e) => setRates((prev) => ({ ...prev, [token]: e.target.value }))}
                  placeholder="0"
                />
              </div>
            </Field>
          ))}
        </div>
      </Modal>

      {/* bulk-edit rates modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Bulk edit rates"
        subtitle="Set monthly USDC rates for everyone at once, then fund & start to stream them all. Blank = excluded from payroll."
        footer={
          <>
            <ActionButton onClick={() => setBulkOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" onClick={handleSaveBulk} disabled={busy}>
              Save all
            </ActionButton>
          </>
        }
      >
        <div className="flex items-end gap-2 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3">
          <div className="flex-1">
            <label className="mb-1.5 block text-[12px] font-medium text-[var(--sw-text-muted)]">
              Apply to all
            </label>
            <input
              className={inputCls}
              type="number"
              inputMode="decimal"
              value={applyValue}
              onChange={(e) => setApplyValue(e.target.value)}
              placeholder="Amount"
            />
          </div>
          <div className="w-[120px]">
            <Select value={applyToken} onValueChange={(v) => setApplyToken(v as TokenSymbol)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TOKEN_SYMBOLS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <ActionButton onClick={applyToAll}>Apply</ActionButton>
        </div>

        <div className="mt-2 max-h-[44vh] overflow-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="px-1 pb-2 font-medium">Employee</th>
                <th className="px-1 pb-2 font-medium">USDC / mo</th>
              </tr>
            </thead>
            <tbody>
              {employees.map((e) => (
                <tr key={e.walletAddress}>
                  <td className="px-1 py-1 font-medium text-[var(--sw-text)]">{e.name}</td>
                  {TOKEN_SYMBOLS.map((tk) => (
                    <td key={tk} className="px-1 py-1">
                      <input
                        className={`${inputCls} py-1.5`}
                        type="number"
                        inputMode="decimal"
                        value={bulkRates[e.walletAddress]?.[tk] ?? ""}
                        onChange={(ev) => setBulkRate(e.walletAddress, tk, ev.target.value)}
                        placeholder="0"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Modal>

      {/* create group modal */}
      <Modal
        open={groupOpen}
        onClose={() => setGroupOpen(false)}
        title="New group"
        footer={
          <>
            <ActionButton onClick={() => setGroupOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" onClick={handleCreateGroup} disabled={busy || !groupName.trim()}>
              Create group
            </ActionButton>
          </>
        }
      >
        <Field label="Group name">
          <input
            className={inputCls}
            value={groupName}
            onChange={(e) => setGroupName(e.target.value)}
            placeholder="Engineering"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateGroup();
            }}
          />
        </Field>
      </Modal>
    </DashboardPageShell>
  );
}

const STATUS_BADGE: Record<StatusKey, string> = {
  Streaming: "sweem-badge-live",
  Paused: "sweem-badge-paused",
  Stopped: "sweem-badge-stopped",
  Pending: "sweem-badge-idle",
  "—": "sweem-badge-idle",
};

function RateCell({ amount, symbol }: { amount?: number; symbol: TokenSymbol }) {
  if (!amount) return <span className="text-[var(--sw-text-dim)]">—</span>;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums">
      <TokenIcon token={TOKENS[symbol]} size={14} />
      {amount.toFixed(2)} {symbol}
    </span>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="mb-1.5 block text-[12px] font-medium text-[var(--sw-text-muted)]">{label}</label>
      {children}
    </div>
  );
}

function FilterSelect({
  value,
  onChange,
  placeholder,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-[42px] w-[150px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function GroupDistributionCard({
  data,
}: {
  data: { key: string; label: string; count: number; pct: number; color: string }[];
}) {
  const [view, setView] = useState<"donut" | "bar">("donut");
  const total = data.reduce((s, d) => s + d.count, 0);
  const chartData = data.length ? data : [{ key: "empty", label: "No employees", count: 1, pct: 100, color: "var(--sw-border)" }];

  return (
    <SweemCard className="flex h-full flex-col">
      <div className="flex items-center justify-between">
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Groups</CardLabel>
        <div className="inline-flex rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-0.5 text-[12px]">
          {(["donut", "bar"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded-full px-3 py-1 font-medium capitalize transition-colors ${
                view === v ? "bg-[var(--sw-mint)] text-black" : "text-[var(--sw-text-muted)]"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "donut" ? (
        <div className="relative mt-2 h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                dataKey="count"
                nameKey="label"
                cx="50%"
                cy="50%"
                innerRadius={48}
                outerRadius={68}
                paddingAngle={data.length > 1 ? 2 : 0}
                stroke="none"
              >
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-[22px] font-semibold leading-none tabular-nums">{total}</span>
            <span className="mt-1 text-[11px] text-[var(--sw-text-dim)]">total</span>
          </div>
        </div>
      ) : (
        <div className="mt-2 h-[150px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 22, right: 4, bottom: 0, left: 4 }} barCategoryGap="28%">
              <XAxis
                dataKey="label"
                axisLine={false}
                tickLine={false}
                interval={0}
                tick={{ fill: "var(--sw-text-dim)", fontSize: 11 }}
                tickMargin={10}
              />
              <Bar dataKey="count" radius={[8, 8, 8, 8]} maxBarSize={42} animationDuration={800}>
                <LabelList
                  dataKey="count"
                  position="top"
                  offset={8}
                  fill="var(--sw-text-muted)"
                  fontSize={11}
                  fontWeight={600}
                />
                {chartData.map((d, i) => (
                  <Cell key={i} fill={d.color} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      <ul className="mt-4 flex flex-1 flex-col gap-2 overflow-auto">
        {data.map((d) => (
          <li key={d.key} className="flex items-center justify-between">
            <span className="flex items-center gap-2.5">
              <span className="size-2.5 rounded-full" style={{ background: d.color }} />
              <span className="text-[13px] text-[var(--sw-text-muted)]">{d.label}</span>
            </span>
            <span className="text-[13px] font-semibold tabular-nums text-[var(--sw-text)]">
              {d.count}
              <span className="ml-1.5 text-[11.5px] font-medium text-[var(--sw-text-dim)]">{d.pct.toFixed(0)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </SweemCard>
  );
}
