"use client";

import { useMemo, useState } from "react";
import { useWriteContract } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { waitForTransactionReceipt } from "@wagmi/core";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { Plus, Receipt, Send } from "lucide-react";
import { erc20Abi, isAddress } from "viem";

import { CardLabel, IconChip, MoneyValue, SweemCard } from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { cn } from "@/lib/utils";
import { toRaw, TOKENS } from "@/lib/tokens";
import { wagmiConfig } from "@/lib/wagmi";
import { EXPLORER_TX, USDC } from "@/lib/magmos";
import { ActionButton, ConnectGate, Modal } from "./ui";
import { shortAddr } from "./helpers";
import { useSweemApi, type Invoice } from "@/lib/api";

// Invoices are real: created via the Magmos API (persisted to MongoDB), listed
// from the DB, and "Pay" fires a live ERC-20 USDC transfer on Arc, then marks
// the invoice paid (with its tx hash) in the DB. No mock data.

type InvoiceStatus = "paid" | "pending" | "overdue";

const token = TOKENS.USDC;

const STATUS: Record<InvoiceStatus, { label: string; color: string; bg: string }> = {
  pending: { label: "Pending", color: "var(--sw-lavender)", bg: "rgba(255,180,61,0.14)" },
  paid: { label: "Paid", color: "var(--sw-mint)", bg: "rgba(255,106,26,0.14)" },
  overdue: { label: "Overdue", color: "#ff794b", bg: "rgba(255,121,75,0.14)" },
};

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatusPill({ status }: { status: InvoiceStatus }) {
  const s = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold"
      style={{ background: s.bg, color: s.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: s.color }} />
      {s.label}
    </span>
  );
}

export function InvoicesScreen() {
  const api = useSweemApi();
  const wallet = api.address;
  const { writeContractAsync } = useWriteContract();

  const invoicesQuery = useQuery<Invoice[]>({
    queryKey: ["invoices", wallet],
    enabled: !!wallet,
    queryFn: () => api.listInvoices(wallet!),
  });
  // Stable identity: `data ?? []` produces a new array on every render, which made the metrics
  // memo below recompute each time and defeated its own purpose.
  const invoices = useMemo(() => invoicesQuery.data ?? [], [invoicesQuery.data]);

  const [payingId, setPayingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", amount: "", dueDate: "" });

  const metrics = useMemo(() => {
    let outstanding = 0, outstandingCount = 0, paid = 0, paidCount = 0, overdue = 0, overdueCount = 0;
    for (const inv of invoices) {
      if (inv.status === "paid") { paid += inv.amount; paidCount++; }
      else { outstanding += inv.amount; outstandingCount++; }
      if (inv.status === "overdue") { overdue += inv.amount; overdueCount++; }
    }
    return { outstanding, outstandingCount, paid, paidCount, overdue, overdueCount };
  }, [invoices]);

  // Real payment: an ERC-20 USDC transfer to the recipient on Arc, then persist
  // the paid status + tx hash to the DB.
  async function handlePay(inv: Invoice) {
    if (!wallet) return toast.error("Connect a wallet first");
    if (payingId) return;
    setPayingId(inv.id);
    try {
      const hash = await writeContractAsync({
        address: USDC,
        abi: erc20Abi,
        functionName: "transfer",
        args: [inv.recipient.address as `0x${string}`, toRaw(token, inv.amount)],
      });
      toast.success(`Paid ${inv.amount.toLocaleString()} USDC to ${inv.recipient.name}`, {
        description: `Tx ${hash.slice(0, 12)}…${hash.slice(-10)}`,
        action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(hash), "_blank") },
      });
      await waitForTransactionReceipt(wagmiConfig, { hash });
      await api.updateInvoice(wallet, inv.id, { status: "paid", txHash: hash });
      invoicesQuery.refetch();
    } catch {
      toast.error("Payment failed");
    } finally {
      setPayingId(null);
    }
  }

  async function handleCreate() {
    const amt = Number(form.amount) || 0;
    const addr = form.address.trim();
    if (!wallet) return toast.error("Connect a wallet first");
    if (!form.name.trim()) return toast.error("Enter a recipient name");
    if (!isAddress(addr)) return toast.error("Enter a valid wallet address");
    if (amt <= 0) return toast.error("Enter an invoice amount");
    setCreating(true);
    try {
      const inv = await api.createInvoice(wallet, {
        name: form.name.trim(),
        address: addr,
        amount: amt,
        dueDate: form.dueDate || undefined,
      });
      await invoicesQuery.refetch();
      setCreateOpen(false);
      setForm({ name: "", address: "", amount: "", dueDate: "" });
      toast.success(`Invoice ${inv.id} created`, {
        description: `${amt.toLocaleString()} USDC to ${inv.recipient.name}`,
      });
    } catch {
      toast.error("Could not create invoice");
    } finally {
      setCreating(false);
    }
  }

  if (!wallet) {
    return (
      <div className="dashboard-content">
        <ConnectGate message="Connect your wallet to view and pay invoices." />
      </div>
    );
  }

  return (
    <div className="dashboard-content">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Invoices</h1>
          <p className="mt-1 text-[14px] text-[var(--sw-text-muted)]">
            Bill clients and settle in USDC on Arc — one signature per invoice.
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[12.5px] font-semibold text-[var(--sw-text)]">
            <TokenIcon token={token} size={15} /> USDC
          </span>
          <ActionButton variant="primary" onClick={() => setCreateOpen(true)}>
            <span className="inline-flex items-center gap-1.5">
              <Plus size={15} /> Create invoice
            </span>
          </ActionButton>
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SweemCard>
          <CardLabel>Outstanding</CardLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <MoneyValue value={metrics.outstanding} className="text-[30px] text-[var(--sw-text)]" />
            <span className="text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            {metrics.outstandingCount} open invoice{metrics.outstandingCount === 1 ? "" : "s"}
          </p>
        </SweemCard>
        <SweemCard>
          <CardLabel>Paid this month</CardLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <MoneyValue value={metrics.paid} className="text-[30px] text-[var(--sw-mint)]" />
            <span className="text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            {metrics.paidCount} settled on Arc
          </p>
        </SweemCard>
        <SweemCard>
          <CardLabel>Overdue</CardLabel>
          <div className="mt-2 flex items-baseline gap-1.5">
            <MoneyValue value={metrics.overdue} className="text-[30px] text-[#ff794b]" />
            <span className="text-[13px] font-medium text-[var(--sw-text-muted)]">USDC</span>
          </div>
          <p className="mt-1 text-[12.5px] text-[var(--sw-text-muted)]">
            {metrics.overdueCount} past due date
          </p>
        </SweemCard>
      </div>

      {/* Invoices table */}
      <SweemCard className="mt-4">
        <div className="flex items-center justify-between">
          <div>
            <CardLabel>All invoices</CardLabel>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">
              Pay open invoices with a USDC transfer on Arc
            </p>
          </div>
          <IconChip>
            <Receipt size={16} />
          </IconChip>
        </div>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--sw-border)] text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="pb-2.5 font-medium">Invoice</th>
                <th className="pb-2.5 font-medium">Recipient</th>
                <th className="pb-2.5 font-medium">Amount</th>
                <th className="pb-2.5 font-medium">Due</th>
                <th className="pb-2.5 font-medium">Status</th>
                <th className="pb-2.5 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-[13px] text-[var(--sw-text-muted)]">
                    {invoicesQuery.isLoading ? "Loading…" : "No invoices yet — create your first one."}
                  </td>
                </tr>
              )}
              {invoices.map((inv) => {
                const paying = payingId === inv.id;
                return (
                  <motion.tr
                    key={inv.id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    className="border-b border-[var(--sw-border)] last:border-0"
                  >
                    <td className="py-3.5">
                      <div className="font-mono text-[13px] font-medium text-[var(--sw-text)]">{inv.id}</div>
                      <div className="text-[12px] text-[var(--sw-text-muted)]">Issued {fmtDate(inv.issuedDate)}</div>
                    </td>
                    <td className="py-3.5">
                      <div className="font-medium text-[var(--sw-text)]">{inv.recipient.name}</div>
                      <div className="text-[12px] text-[var(--sw-text-muted)]">{shortAddr(inv.recipient.address)}</div>
                    </td>
                    <td className="py-3.5 tabular-nums text-[var(--sw-text)]">
                      {inv.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{" "}
                      <span className="text-[12px] text-[var(--sw-text-muted)]">USDC</span>
                    </td>
                    <td className="py-3.5 tabular-nums">
                      <span className={cn("text-[13px]", inv.status === "overdue" ? "text-[#ff794b]" : "text-[var(--sw-text-muted)]")}>
                        {fmtDate(inv.dueDate)}
                      </span>
                    </td>
                    <td className="py-3.5">
                      <StatusPill status={inv.status} />
                    </td>
                    <td className="py-3.5">
                      <div className="flex items-center justify-end">
                        {inv.status === "paid" ? (
                          <span className="text-[12.5px] font-medium text-[var(--sw-text-dim)]">Settled</span>
                        ) : (
                          <button
                            type="button"
                            disabled={!!payingId}
                            onClick={() => handlePay(inv)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--sw-mint)] px-3 py-1.5 text-[12.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Send size={13} /> {paying ? "Paying…" : "Pay"}
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

      {/* Create invoice modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Create invoice"
        subtitle="Bill a client in USDC. Payable on Arc the moment it's created."
        footer={
          <>
            <ActionButton onClick={() => setCreateOpen(false)}>Cancel</ActionButton>
            <ActionButton variant="primary" disabled={creating} onClick={handleCreate}>
              {creating ? "Creating…" : "Create invoice"}
            </ActionButton>
          </>
        }
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--sw-text-muted)]">Recipient</span>
          <input
            type="text"
            autoFocus
            className="rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-muted)] focus:border-[var(--sw-mint)]/60"
            placeholder="Acme Studio or Jane Doe"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--sw-text-muted)]">Wallet address</span>
          <input
            type="text"
            spellCheck={false}
            className="rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 font-mono text-[13px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-muted)] focus:border-[var(--sw-mint)]/60"
            placeholder="0x…"
            value={form.address}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--sw-text-muted)]">Amount</span>
          <div className="flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 focus-within:border-[var(--sw-mint)]/60">
            <input
              type="number"
              inputMode="decimal"
              className="min-w-0 flex-1 bg-transparent text-[20px] font-semibold tabular-nums text-[var(--sw-text)] outline-none placeholder:font-normal placeholder:text-[var(--sw-text-muted)]"
              placeholder="0.00"
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--sw-card-inset)] px-2.5 py-1 text-[12px] font-semibold text-[var(--sw-text)]">
              <TokenIcon token={token} size={15} /> USDC
            </span>
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium text-[var(--sw-text-muted)]">Due date</span>
          <input
            type="date"
            className="rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors [color-scheme:dark] focus:border-[var(--sw-mint)]/60"
            value={form.dueDate}
            onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))}
          />
        </label>
      </Modal>
    </div>
  );
}
