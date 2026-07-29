"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { wagmiConfig } from "@/lib/wagmi";
import { isAddress, type Address } from "viem";
import { motion } from "framer-motion";
import { toast } from "sonner";
import {
  Coins,
  Pause,
  Play,
  Plus,
  Square,
  Trash2,
  Users,
  Wallet,
  Zap,
} from "lucide-react";

import { fromRaw, toRaw, TOKENS } from "@/lib/tokens";
import { USDC, MONTH_S, EXPLORER_TX, MAGMOS_PAYROLL } from "@/lib/magmos";
import { getUsdcAllowance } from "@/lib/reads";
import {
  approveUsdc,
  createPoolAndDeposit,
  deposit,
  pauseStream,
  resumeStream,
  stopStream,
} from "@/lib/writes";
import {
  CardLabel,
  IconChip,
  MoneyValue,
  Skeleton,
  SweemCard,
} from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { Column, DashboardGrid } from "@/components/sweem-ui/dashboard-grid";
import { Modal } from "./ui";
import { LiveTicker } from "./live-ticker";
import { ActivityFeed } from "./activity-feed";
import { useOrgPool, type RecipientRow } from "./use-org-pool";
import { shortAddr, usdcFixed } from "./helpers";

const token = TOKENS.USDC;

export function OrgHome() {
  const {
    wallet,
    api,
    org,
    state,
    poolId,
    usdcBalanceRaw,
    totalMonthlyMeta,
    stateQuery,
    anchorAt,
    employees,
  } = useOrgPool();

  const router = useRouter();
  const queryClient = useQueryClient();
  const [fundOpen, setFundOpen] = useState(false);

  // Display names for the activity feed (lowercased wallet -> saved name).
  const names = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of employees) if (e.name) m[e.walletAddress.toLowerCase()] = e.name;
    return m;
  }, [employees]);

  // Wallet connected but no org → onboarding.
  const needsOnboarding = !!wallet && !api.orgQuery.isLoading && !org;
  useEffect(() => {
    if (needsOnboarding) router.push("/onboarding");
  }, [needsOnboarding, router]);

  const usdcBalance = fromRaw(token, usdcBalanceRaw);
  const deposited = fromRaw(token, state.totalDepositedRaw);
  const balance = fromRaw(token, state.balanceRaw);
  const monthlyRate = fromRaw(token, state.monthlyRateRaw);
  const activeStreams = state.recipients.filter((r) => !r.stopped).length;

  // Runway: how long the pool balance covers the current monthly burn.
  const runwayMonths =
    state.monthlyRateRaw > 0n
      ? Number(state.balanceRaw) / Number(state.monthlyRateRaw)
      : 0;

  // First chain read still in flight → shimmer instead of zeros.
  const firstLoading = stateQuery.isLoading;

  const refresh = () => {
    stateQuery.refetch();
    // New receipts land in the same txs — refresh the activity feed too.
    queryClient.invalidateQueries({ queryKey: ["poolActivity", poolId] });
  };

  return (
    <div className="dashboard-content">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
            {org ? org.name : "Overview"}
          </h1>
          <p className="mt-0.5 text-[13px] text-[var(--sw-text-muted)]">
            Real-time USDC payroll streaming on Arc
          </p>
        </div>
        <button
          type="button"
          onClick={() => setFundOpen(true)}
          className="inline-flex items-center gap-2 rounded-full bg-[var(--sw-mint)] px-4 py-2.5 text-[13px] font-semibold text-black transition-colors hover:bg-[#ff8340]"
        >
          <Plus className="size-4" strokeWidth={2.4} />
          {state.funded ? "Fund payroll" : "Create payroll"}
        </button>
      </div>

      {needsOnboarding && (
        <div className="mb-4 rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 text-[13px] text-[var(--sw-text-muted)]">
          Taking you to setup…
        </div>
      )}

      <DashboardGrid>
        {/* Left column — stats */}
        <Column className="lg:col-span-3">
          <StatCard
            icon={<Wallet className="size-[18px]" strokeWidth={2} />}
            label="Wallet balance"
            value={usdcBalance}
            caption="Available USDC to fund payroll"
          />
          <StatCard
            icon={<Coins className="size-[18px]" strokeWidth={2} />}
            label="Pool balance"
            value={balance}
            caption={`${deposited.toFixed(2)} USDC deposited total`}
          />
          <NumberStatCard
            icon={<Users className="size-[18px]" strokeWidth={2} />}
            label="Active streams"
            value={activeStreams}
            caption={
              <span className="inline-flex items-center gap-1">
                {monthlyRate.toFixed(2)}
                <TokenIcon token={token} size={13} />
                USDC / month streaming
              </span>
            }
          />
        </Column>

        {/* Center — streamed hero */}
        <Column className="lg:col-span-5">
          <StreamedHeroCard
            funded={state.funded}
            streamedRaw={state.streamedRaw}
            monthlyRateRaw={state.monthlyRateRaw}
            anchorAt={anchorAt}
            monthly={monthlyRate}
            loading={firstLoading}
          />
          <RunwayCard
            balance={balance}
            monthly={monthlyRate}
            runwayMonths={runwayMonths}
          />
        </Column>

        {/* Right — CTA + meta target */}
        <Column className="lg:col-span-4">
          <FundCTA onClick={() => setFundOpen(true)} funded={state.funded} />
          <TargetPayrollCard
            recipientsMeta={api.employeesQuery.data?.length ?? 0}
            totalMonthlyMeta={totalMonthlyMeta}
          />
        </Column>
      </DashboardGrid>

      {/* Live recipients table */}
      <RecipientsTable
        recipients={state.recipients}
        poolId={poolId}
        anchorAt={anchorAt}
        loading={firstLoading}
        onDone={refresh}
        onAdd={() => setFundOpen(true)}
      />

      {/* On-chain activity + receipts (arcscan-linked) */}
      <ActivityFeed poolId={poolId} enabled={!!wallet} names={names} />

      <FundPayrollModal
        open={fundOpen}
        onClose={() => setFundOpen(false)}
        wallet={wallet}
        poolExists={state.funded}
        poolId={poolId}
        usdcBalanceRaw={usdcBalanceRaw}
        onFunded={() => {
          setFundOpen(false);
          refresh();
          api.employeesQuery.refetch();
        }}
      />
    </div>
  );
}

/* ── Stat cards ───────────────────────────────────────────────────────── */

function StatCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  caption: string;
}) {
  return (
    <SweemCard className="flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="mt-7">
        <MoneyValue value={value} token={token} className="text-[30px] leading-none" />
        <p className="mt-2 text-[12.5px] text-[var(--sw-text-dim)]">{caption}</p>
      </div>
    </SweemCard>
  );
}

function NumberStatCard({
  icon,
  label,
  value,
  caption,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  caption: React.ReactNode;
}) {
  return (
    <SweemCard className="flex flex-col justify-between">
      <div className="flex items-center gap-3">
        <IconChip>{icon}</IconChip>
        <CardLabel>{label}</CardLabel>
      </div>
      <div className="mt-7">
        <span className="text-[30px] font-semibold leading-none tracking-[-0.02em] tabular-nums">
          {value}
        </span>
        <p className="mt-2 text-[12.5px] text-[var(--sw-text-dim)]">{caption}</p>
      </div>
    </SweemCard>
  );
}

function StreamedHeroCard({
  funded,
  streamedRaw,
  monthlyRateRaw,
  anchorAt,
  monthly,
  loading = false,
}: {
  funded: boolean;
  streamedRaw: bigint;
  monthlyRateRaw: bigint;
  anchorAt: number;
  monthly: number;
  loading?: boolean;
}) {
  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-start justify-between">
        <CardLabel className="text-[15px] text-[var(--sw-text)]">Total Streamed</CardLabel>
        <span className="inline-flex items-center gap-1 rounded-full bg-[rgba(255, 106, 26, 0.14)] px-2 py-1 text-[12px] font-semibold text-[var(--sw-mint)]">
          <span
            className={
              funded
                ? "size-1.5 rounded-full bg-[var(--sw-mint)]"
                : "size-1.5 rounded-full bg-[var(--sw-text-dim)]"
            }
          />
          {funded ? "Streaming live" : "Idle"}
        </span>
      </div>

      <div className="mt-7 flex items-center font-semibold tracking-[-0.02em] tabular-nums">
        <TokenIcon token={token} size={32} className="mr-2" />
        {loading ? (
          <Skeleton className="h-10 w-52 rounded-xl" />
        ) : (
          <span className="text-[40px] leading-none">
            {funded ? (
              <LiveTicker
                baseRaw={streamedRaw}
                rateRaw={monthlyRateRaw}
                periodSecs={BigInt(MONTH_S)}
                anchorAt={anchorAt}
                active={funded}
                decimals={token.decimals}
              />
            ) : (
              "0.00"
            )}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-3 h-3 w-64 max-w-full" />
      ) : (
        <p className="mt-2.5 text-[13px] text-[var(--sw-text-muted)]">
          {monthly.toFixed(2)} USDC / month committed across all streams
        </p>
      )}

      {/* Decorative equalizer */}
      <div className="mt-6 flex h-12 items-end justify-between">
        {Array.from({ length: 46 }).map((_, i) => {
          const h =
            0.4 +
            0.4 * Math.abs(Math.sin(i * 0.9 + 0.5)) +
            0.18 * Math.abs(Math.cos(i * 0.37));
          return (
            <motion.span
              key={i}
              initial={{ height: "10%", opacity: 0 }}
              animate={{ height: `${Math.min(1, h) * 100}%`, opacity: 1 }}
              transition={{
                delay: 0.35 + i * 0.01,
                type: "spring",
                stiffness: 220,
                damping: 18,
              }}
              className={`w-[4px] rounded-full ${
                i < 25 ? "bg-[var(--sw-mint)]" : "bg-[var(--sw-lavender)]"
              }`}
            />
          );
        })}
      </div>
    </SweemCard>
  );
}

function RunwayCard({
  balance,
  monthly,
  runwayMonths,
}: {
  balance: number;
  monthly: number;
  runwayMonths: number;
}) {
  const days = Math.floor(runwayMonths * 30);
  const label =
    monthly <= 0
      ? "No active streams"
      : runwayMonths >= 1
        ? `${runwayMonths.toFixed(1)} months`
        : `${days} days`;
  const low = monthly > 0 && runwayMonths < 1;

  return (
    <SweemCard className="flex flex-col">
      <CardLabel className="text-[15px] text-[var(--sw-text)]">Runway</CardLabel>
      <div className="mt-3 flex items-baseline gap-2">
        <span className="text-[28px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-[var(--sw-text)]">
          {label}
        </span>
        {low && (
          <span className="rounded-full bg-[rgba(255,121,75,0.16)] px-2 py-0.5 text-[11px] font-semibold text-[#ff794b]">
            Low balance
          </span>
        )}
      </div>
      <p className="mt-2 text-[12.5px] text-[var(--sw-text-dim)]">
        {balance.toFixed(2)} USDC pool balance at {monthly.toFixed(2)} USDC / month burn
      </p>
      <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-[var(--sw-card-inset)]">
        <motion.div
          className={`h-full rounded-full ${low ? "bg-[#ff794b]" : "bg-[var(--sw-mint)]"}`}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min(100, (runwayMonths / 6) * 100)}%` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </SweemCard>
  );
}

function FundCTA({ onClick, funded }: { onClick: () => void; funded: boolean }) {
  return (
    <button type="button" onClick={onClick} className="block w-full text-left">
      <SweemCard accent hover className="flex items-center gap-4 py-4">
        <IconChip tone="dark" className="size-10 bg-black/85 text-[var(--sw-mint)]">
          <Zap className="size-[18px]" strokeWidth={2} />
        </IconChip>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold text-black">
            {funded ? "Top up & add recipients" : "Fund payroll"}
          </p>
          <p className="truncate text-[12.5px] font-medium text-black/65">
            Deposit USDC and stream salaries per second
          </p>
        </div>
        <Plus className="size-5 text-black/80" strokeWidth={2.4} />
      </SweemCard>
    </button>
  );
}

function TargetPayrollCard({
  recipientsMeta,
  totalMonthlyMeta,
}: {
  recipientsMeta: number;
  totalMonthlyMeta: number;
}) {
  return (
    <SweemCard className="flex grow flex-col">
      <CardLabel className="text-[15px] text-[var(--sw-text)]">Target Payroll</CardLabel>
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Saved recipients and their monthly USDC target
      </p>
      <div className="mt-6 flex items-end justify-between">
        <div>
          <MoneyValue
            value={totalMonthlyMeta}
            token={token}
            className="text-[26px] leading-none"
          />
          <p className="mt-1.5 text-[12px] text-[var(--sw-text-muted)]">per month</p>
        </div>
        <div className="text-right">
          <span className="text-[26px] font-semibold leading-none tabular-nums text-[var(--sw-text)]">
            {recipientsMeta}
          </span>
          <p className="mt-1.5 text-[12px] text-[var(--sw-text-muted)]">recipients</p>
        </div>
      </div>
    </SweemCard>
  );
}

/* ── Live recipients table ────────────────────────────────────────────── */

function RecipientsTable({
  recipients,
  poolId,
  anchorAt,
  loading = false,
  onDone,
  onAdd,
}: {
  recipients: RecipientRow[];
  poolId: `0x${string}`;
  anchorAt: number;
  loading?: boolean;
  onDone: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="mt-4 rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <CardLabel className="text-[15px] text-[var(--sw-text)]">Recipients</CardLabel>
          <p className="mt-0.5 text-[12.5px] text-[var(--sw-text-dim)]">
            Live streamed / claimable balance per recipient
          </p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
        >
          <Plus className="size-3.5" strokeWidth={2.4} /> Add
        </button>
      </div>

      {loading ? (
        <div className="flex flex-col">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="flex items-center gap-2.5 border-b border-[var(--sw-border)] py-3.5 last:border-b-0 last:pb-0"
            >
              <Skeleton className="size-8 rounded-full" />
              <div className="min-w-0 flex-1">
                <Skeleton className="h-3.5 w-32 max-w-full" />
                <Skeleton className="mt-1.5 h-2.5 w-24" />
              </div>
              <Skeleton className="hidden h-3 w-20 sm:block" />
              <Skeleton className="hidden h-3 w-24 sm:block" />
              <Skeleton className="h-6 w-[86px] rounded-full" />
            </div>
          ))}
        </div>
      ) : recipients.length === 0 ? (
        <div className="flex h-[120px] items-center justify-center text-[13px] text-[var(--sw-text-dim)]">
          No streams yet. Fund payroll to start streaming salaries.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[var(--sw-border)] text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="pb-2.5 font-medium">Recipient</th>
                <th className="pb-2.5 font-medium">Rate / mo</th>
                <th className="pb-2.5 font-medium">Claimable (live)</th>
                <th className="pb-2.5 font-medium">Status</th>
                <th className="pb-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {recipients.map((r) => (
                <RecipientRowItem
                  key={r.address}
                  row={r}
                  poolId={poolId}
                  anchorAt={anchorAt}
                  onDone={onDone}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RecipientRowItem({
  row,
  poolId,
  anchorAt,
  onDone,
}: {
  row: RecipientRow;
  poolId: `0x${string}`;
  anchorAt: number;
  onDone: () => void;
}) {
  const { writeContractAsync, isPending } = useWriteContract();

  type StreamAction =
    | ReturnType<typeof pauseStream>
    | ReturnType<typeof resumeStream>
    | ReturnType<typeof stopStream>;

  const act = async (kind: "pause" | "resume" | "stop", build: () => StreamAction) => {
    try {
      const hash = await writeContractAsync(build());
      toast.success(`${kind} submitted`, {
        description: shortAddr(row.address),
        action: {
          label: "View",
          onClick: () => window.open(EXPLORER_TX(hash), "_blank"),
        },
      });
      onDone();
    } catch (e) {
      toast.error(`Could not ${kind} stream`, {
        description: (e as Error).message?.slice(0, 120),
      });
    }
  };

  const monthlyRateRaw = row.ratePeriod > 0n ? (row.rateRaw * BigInt(MONTH_S)) / row.ratePeriod : 0n;
  const live = !row.paused && !row.stopped && row.onChain;

  return (
    <tr className="border-b border-[var(--sw-border)] last:border-b-0">
      <td className="py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-full bg-[var(--sw-card-inset)] text-[12px] font-semibold text-[var(--sw-text-muted)]">
            {(row.name || "?").slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13.5px] font-medium text-[var(--sw-text)]">
              {row.name || "Unnamed"}
            </p>
            <p className="truncate font-mono text-[11px] text-[var(--sw-text-dim)]">
              {shortAddr(row.address)}
            </p>
          </div>
        </div>
      </td>
      <td className="py-3.5 text-[13px] tabular-nums text-[var(--sw-text-muted)]">
        {usdcFixed(monthlyRateRaw)} USDC
      </td>
      <td className="py-3.5 text-[13.5px] font-semibold tabular-nums text-[var(--sw-text)]">
        <LiveTicker
          baseRaw={row.claimableRaw}
          rateRaw={monthlyRateRaw}
          periodSecs={BigInt(MONTH_S)}
          anchorAt={anchorAt}
          active={live}
          decimals={token.decimals}
          fracDigits={4}
        />
      </td>
      <td className="py-3.5">
        <StatusPill paused={row.paused} stopped={row.stopped} />
      </td>
      <td className="py-3.5">
        <div className="flex items-center justify-end gap-1.5">
          {row.stopped ? (
            <span className="text-[11px] text-[var(--sw-text-dim)]">—</span>
          ) : (
            <>
              {row.paused ? (
                <IconBtn
                  title="Resume"
                  disabled={isPending}
                  onClick={() => act("resume", () => resumeStream(poolId, row.address as Address))}
                >
                  <Play className="size-3.5" strokeWidth={2.2} />
                </IconBtn>
              ) : (
                <IconBtn
                  title="Pause"
                  disabled={isPending}
                  onClick={() => act("pause", () => pauseStream(poolId, row.address as Address))}
                >
                  <Pause className="size-3.5" strokeWidth={2.2} />
                </IconBtn>
              )}
              <IconBtn
                title="Stop"
                danger
                disabled={isPending}
                onClick={() => act("stop", () => stopStream(poolId, row.address as Address))}
              >
                <Square className="size-3.5" strokeWidth={2.2} />
              </IconBtn>
            </>
          )}
        </div>
      </td>
    </tr>
  );
}

function StatusPill({ paused, stopped }: { paused: boolean; stopped: boolean }) {
  if (stopped)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--sw-card-inset)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--sw-text-dim)]">
        <span className="size-1.5 rounded-full bg-[var(--sw-text-dim)]" /> Stopped
      </span>
    );
  if (paused)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255,121,75,0.16)] px-2.5 py-1 text-[11.5px] font-semibold text-[#ff794b]">
        <span className="size-1.5 rounded-full bg-[#ff794b]" /> Paused
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[rgba(255, 106, 26, 0.14)] px-2.5 py-1 text-[11.5px] font-semibold text-[var(--sw-mint)]">
      <span className="size-1.5 rounded-full bg-[var(--sw-mint)]" /> Streaming
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`flex size-8 items-center justify-center rounded-lg border border-[var(--sw-border)] text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] disabled:opacity-40 ${
        danger ? "hover:text-[#ef4444]" : "hover:text-[var(--sw-text)]"
      }`}
    >
      {children}
    </button>
  );
}

/* ── Fund payroll modal (add recipients → approve → deposit) ──────────── */

interface DraftRecipient {
  address: string;
  name: string;
  monthly: string; // monthly USDC as string input
}

const emptyDraft = (): DraftRecipient => ({ address: "", name: "", monthly: "" });

function FundPayrollModal({
  open,
  onClose,
  wallet,
  poolExists,
  poolId,
  usdcBalanceRaw,
  onFunded,
}: {
  open: boolean;
  onClose: () => void;
  wallet?: string;
  poolExists: boolean;
  poolId: `0x${string}`;
  usdcBalanceRaw: bigint;
  onFunded: () => void;
}) {
  const { api } = useOrgPool();
  const [rows, setRows] = useState<DraftRecipient[]>([emptyDraft()]);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<string>("");

  const { writeContractAsync } = useWriteContract();
  const [txHash, setTxHash] = useState<`0x${string}`>();
  useWaitForTransactionReceipt({ hash: txHash });

  const totalMonthly = useMemo(
    () => rows.reduce((s, r) => s + (Number(r.monthly) || 0), 0),
    [rows]
  );
  const usdcBalance = fromRaw(token, usdcBalanceRaw);

  const setRow = (i: number, patch: Partial<DraftRecipient>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, emptyDraft()]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length === 1 ? rs : rs.filter((_, j) => j !== i)));

  const valid = rows.filter(
    (r) => isAddress(r.address.trim()) && r.name.trim() && Number(r.monthly) > 0
  );

  async function handleFund() {
    if (!wallet) {
      toast.error("Connect a wallet first");
      return;
    }
    if (valid.length === 0) {
      toast.error("Add at least one recipient with a valid address and amount");
      return;
    }
    // Fund amount = 1 month of total payroll (so streams have runway to start).
    const employees = valid.map((r) => r.address.trim() as Address);
    const rateAmounts = valid.map((r) => toRaw(token, Number(r.monthly)));
    const ratePeriods = valid.map(() => BigInt(MONTH_S));
    const amount = rateAmounts.reduce((s, a) => s + a, 0n);

    if (amount > usdcBalanceRaw) {
      toast.error("Insufficient USDC", {
        description: `Need ${fromRaw(token, amount).toFixed(2)} USDC, have ${usdcBalance.toFixed(2)}`,
      });
      return;
    }

    setBusy(true);
    try {
      // 1) Save recipient metadata (single signature).
      setPhase("Saving recipients…");
      await api.bulkAddEmployees(
        wallet,
        valid.map((r) => ({
          walletAddress: r.address.trim(),
          name: r.name.trim(),
          monthlyUsdc: Number(r.monthly),
        }))
      );

      // 2) Approve USDC if needed.
      const allowance = await getUsdcAllowance(
        wallet as Address,
        MAGMOS_PAYROLL
      ).catch(() => 0n);
      if (allowance < amount) {
        setPhase("Approve USDC…");
        const approveHash = await writeContractAsync(approveUsdc(MAGMOS_PAYROLL, amount));
        setTxHash(approveHash);
        toast.message("Approving USDC", { description: "Confirm in your wallet" });
        // Wait for the approval to be MINED before depositing. writeContractAsync resolves on
        // broadcast, not on mining — without this the deposit's transferFrom runs before the
        // allowance is set and reverts.
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });
      }

      // 3) Deposit + create/extend streams.
      setPhase(poolExists ? "Depositing…" : "Creating payroll…");
      const fundHash = poolExists
        ? await writeContractAsync(
            deposit(poolId, amount, employees, rateAmounts, ratePeriods)
          )
        : await writeContractAsync(
            createPoolAndDeposit(USDC, amount, employees, rateAmounts, ratePeriods)
          );
      setTxHash(fundHash);
      await waitForTransactionReceipt(wagmiConfig, { hash: fundHash });
      toast.success("Payroll funded — streaming live", {
        action: {
          label: "View",
          onClick: () => window.open(EXPLORER_TX(fundHash), "_blank"),
        },
      });
      setRows([emptyDraft()]);
      onFunded();
    } catch (e) {
      toast.error("Funding failed", {
        description: (e as Error).message?.slice(0, 140),
      });
    } finally {
      setBusy(false);
      setPhase("");
    }
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => {} : onClose}
      title={poolExists ? "Fund payroll" : "Create payroll"}
      subtitle="Add recipients and their monthly USDC. We deposit one month of runway and start streaming per second."
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="rounded-xl px-4 py-2.5 text-[13.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)] disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFund}
            disabled={busy || valid.length === 0}
            className="inline-flex items-center gap-2 rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? phase || "Working…" : `Fund ${totalMonthly.toFixed(2)} USDC`}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        {rows.map((r, i) => {
          const badAddr = r.address.trim() !== "" && !isAddress(r.address.trim());
          return (
            <div
              key={i}
              className="grid grid-cols-[1fr_1fr_110px_auto] items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-2.5"
            >
              <input
                value={r.name}
                onChange={(e) => setRow(i, { name: e.target.value })}
                placeholder="Name"
                className="min-w-0 rounded-lg border border-[var(--sw-border)] bg-[#1b1b1f] px-2.5 py-2 text-[13px] text-[var(--sw-text)] outline-none focus:border-[var(--sw-border-strong)]"
              />
              <input
                value={r.address}
                onChange={(e) => setRow(i, { address: e.target.value })}
                placeholder="0x… recipient"
                className={`min-w-0 rounded-lg border bg-[#1b1b1f] px-2.5 py-2 font-mono text-[12px] text-[var(--sw-text)] outline-none ${
                  badAddr
                    ? "border-[#ff794b]"
                    : "border-[var(--sw-border)] focus:border-[var(--sw-border-strong)]"
                }`}
              />
              <input
                value={r.monthly}
                onChange={(e) =>
                  setRow(i, { monthly: e.target.value.replace(/[^0-9.]/g, "") })
                }
                inputMode="decimal"
                placeholder="USDC/mo"
                className="min-w-0 rounded-lg border border-[var(--sw-border)] bg-[#1b1b1f] px-2.5 py-2 text-right text-[13px] tabular-nums text-[var(--sw-text)] outline-none focus:border-[var(--sw-border-strong)]"
              />
              <button
                type="button"
                onClick={() => removeRow(i)}
                disabled={rows.length === 1}
                className="flex size-8 items-center justify-center rounded-lg text-[var(--sw-text-dim)] transition-colors hover:text-[#ef4444] disabled:opacity-30"
              >
                <Trash2 className="size-4" strokeWidth={2} />
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={addRow}
          className="mt-1 inline-flex items-center gap-1.5 self-start rounded-lg border border-dashed border-[var(--sw-border-strong)] px-3 py-2 text-[12.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
        >
          <Plus className="size-3.5" strokeWidth={2.4} /> Add recipient
        </button>

        <div className="mt-2 flex items-center justify-between rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3.5 py-2.5 text-[13px]">
          <span className="text-[var(--sw-text-muted)]">
            Deposit (1 month runway)
          </span>
          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-[var(--sw-text)]">
            <TokenIcon token={token} size={15} />
            {totalMonthly.toFixed(2)} USDC
          </span>
        </div>
        <p className="text-[11.5px] text-[var(--sw-text-dim)]">
          Wallet balance: {usdcBalance.toFixed(2)} USDC
        </p>
      </div>
    </Modal>
  );
}
