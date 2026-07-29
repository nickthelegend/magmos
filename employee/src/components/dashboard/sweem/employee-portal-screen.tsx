"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { motion } from "framer-motion";
import { erc20Abi, type Address } from "viem";
import { Coins, PiggyBank, Wallet } from "lucide-react";

import { CardLabel, IconChip, MoneyValue, SweemCard } from "@/components/sweem-ui/primitives";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { getOrgName } from "@/lib/api";
import { TOKENS, toRaw, fromRaw, type TokenConfig } from "@/lib/tokens";
import { MAGMOS_VAULT, USDC } from "@/lib/magmos";
import {
  publicClient,
  getEmployeePools,
  getPool,
  getStream,
  getClaimable,
  getDrawable,
  getOwnerVaults,
  getVaultBalance,
  type StreamView,
} from "@/lib/reads";
import { claim, createVault, vaultDeposit, vaultWithdraw, approveUsdc, claimMany } from "@/lib/writes";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { Icon } from "@/components/dashboard/icons";
import { LiveTicker } from "./live-ticker";
import { ActionButton, Modal, AmountField, ConnectGate } from "./ui";
import { SendHomeCard } from "./send-home-card";
import { AdvancePanel } from "./advance-panel";
import { useTxRunner } from "./use-tx-runner";
import { shortAddr } from "./helpers";

const TOKEN: TokenConfig = TOKENS.USDC;

// One discovered stream: the pool it lives in, the recipient's stream state, and the
// resolved org (address + best-effort name).
interface PoolView {
  poolId: `0x${string}`;
  stream: StreamView;
  org: string;
  orgName: string | null;
}

/* ── Stream card ─────────────────────────────────────────────────────── */

function StreamCard({
  view,
  vaultId,
  onClaimed,
  onSaved,
}: {
  view: PoolView;
  vaultId: bigint | null;
  onClaimed: () => void;
  onSaved: () => void;
}) {
  const { address } = useAccount();
  const wallet = address as Address;
  const { poolId, stream, org, orgName } = view;
  const { run, confirming } = useTxRunner();

  const [busy, setBusy] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveAmount, setSaveAmount] = useState("");
  const live = stream.pausedAt === 0n && stream.stoppedAt === 0n;

  // Anchor the ticker to the on-chain claimableAmount every ~5s; interpolate between
  // polls in the browser (see LiveTicker).
  const claimQuery = useQuery({
    queryKey: ["claimable", poolId, wallet],
    enabled: !!wallet,
    refetchInterval: 5000,
    queryFn: async () => {
      const raw = await getClaimable(poolId, wallet).catch(() => 0n);
      return { raw, at: Date.now() };
    },
  });

  const baseRaw = claimQuery.data?.raw ?? 0n;
  const polledAt = claimQuery.data?.at;
  const claimable = fromRaw(TOKEN, baseRaw);
  const hasClaimable = baseRaw > 0n;

  // The contract rejects claims below a tiny anti-dust floor (MagmosPayroll.MIN_CLAIM_AMOUNT =
  // 0.01 USDC) unless crystallized pendingBalance exists. Gate the button so a too-early tap
  // never reverts with an opaque error, and show how long until it's claimable.
  const MIN_CLAIM_RAW = 10_000n;
  const belowMin = baseRaw < MIN_CLAIM_RAW && stream.pendingBalance === 0n;
  const canClaim = hasClaimable && !belowMin;
  const secsToFloor =
    belowMin && stream.rateAmount > 0n
      ? Number(((MIN_CLAIM_RAW - baseRaw) * stream.ratePeriod) / stream.rateAmount) + 1
      : 0;

  // ratePeriod is in SECONDS on Arc; the ticker interpolates in ms.
  const periodMs = stream.ratePeriod * 1000n;

  async function handleClaim() {
    setBusy(true);
    const ok = await run(claim(poolId), {
      pending: "Claiming your pay…",
      success: "Claimed to wallet",
    });
    setBusy(false);
    if (ok) {
      await claimQuery.refetch();
      onClaimed();
    }
  }

  // Save a slice of already-claimed USDC into the recipient's personal vault. Needs a
  // prior ERC-20 approve(vault, amount) then vault.deposit — two txs.
  async function handleSave() {
    const amount = Number(saveAmount);
    if (!vaultId || !Number.isFinite(amount) || amount <= 0) return;
    const raw = toRaw(TOKEN, amount);
    setBusy(true);
    try {
      const allowance = (await publicClient.readContract({
        address: USDC,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, MAGMOS_VAULT],
      })) as bigint;
      if (allowance < raw) {
        const approved = await run(approveUsdc(MAGMOS_VAULT, raw), {
          pending: "Approving USDC…",
          success: "USDC approved",
        });
        if (!approved) return;
      }
      const ok = await run(vaultDeposit(vaultId, USDC, raw), {
        pending: "Saving to vault…",
        success: "Saved to vault",
      });
      if (ok) {
        setSaveOpen(false);
        setSaveAmount("");
        onSaved();
      }
    } finally {
      setBusy(false);
    }
  }

  const status = stream.stoppedAt !== 0n ? "Stopped" : stream.pausedAt !== 0n ? "Paused" : "Streaming";
  const badgeClass = stream.stoppedAt !== 0n
    ? "sweem-badge-stopped"
    : stream.pausedAt !== 0n
      ? "sweem-badge-paused"
      : "sweem-badge-live";

  const working = busy || confirming;

  return (
    <div className="sweem-card sweem-flow-card">
      <div className="sweem-card-head">
        <div>
          <p className="sweem-card-title">{orgName ?? `Unnamed org · ${shortAddr(org)}`}</p>
          <p className="sweem-card-sub">Pool {shortAddr(poolId)}</p>
        </div>
        <span className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2 py-0.5 text-[12px] font-semibold text-[var(--sw-text-muted)]">
            <TokenIcon token={TOKEN} size={14} />
            {TOKEN.symbol}
          </span>
          <span className={`sweem-badge ${badgeClass}`}>{status}</span>
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="sweem-stat-label">Claimable now</p>
          <p className="sweem-mono text-3xl font-semibold mt-1 flex items-center gap-2">
            <LiveTicker
              baseRaw={baseRaw}
              rateRaw={stream.rateAmount}
              periodMs={periodMs}
              anchorAt={polledAt}
              active={live}
              decimals={TOKEN.decimals}
            />
            <span className="text-base text-[color:var(--dash-faint)]">{TOKEN.symbol}</span>
          </p>
        </div>

        <div className="sweem-actions">
          <ActionButton variant="primary" onClick={handleClaim} disabled={working || !canClaim}>
            <Icon name="user" size={15} strokeWidth={2.1} />{" "}
            {belowMin ? `Claimable in ~${secsToFloor}s` : "Claim to wallet"}
          </ActionButton>
          <ActionButton onClick={() => setSaveOpen(true)} disabled={working || !vaultId}>
            <PiggyBank className="size-[15px]" strokeWidth={2} /> Save to vault
          </ActionButton>
        </div>
      </div>

      {/* Earned Wage Access: the same accrued pay, available before payday. */}
      <AdvancePanel
        poolId={poolId}
        wallet={wallet}
        claimableRaw={baseRaw}
        rateRaw={stream.rateAmount}
        ratePeriod={stream.ratePeriod}
        streaming={live}
        onDrawn={async () => {
          await claimQuery.refetch();
          onClaimed();
        }}
      />

      <Modal
        open={saveOpen}
        onClose={() => (working ? undefined : setSaveOpen(false))}
        title="Save to vault"
        subtitle={
          <>Move claimed {TOKEN.symbol} from your wallet into your personal savings vault.</>
        }
        footer={
          <>
            <ActionButton onClick={() => setSaveOpen(false)} disabled={working}>
              Cancel
            </ActionButton>
            <ActionButton variant="primary" onClick={handleSave} disabled={working || !saveAmount}>
              Save
            </ActionButton>
          </>
        }
      >
        <AmountField
          label={`Amount (${TOKEN.symbol})`}
          value={saveAmount}
          onChange={setSaveAmount}
          symbol={TOKEN.symbol}
        />
        <p className="sweem-hint">
          Tip: claim to your wallet first, then save any amount you want to set aside.
        </p>
      </Modal>
    </div>
  );
}

/* ── Vault card ──────────────────────────────────────────────────────── */

function VaultCard({
  vaultId,
  onChanged,
}: {
  vaultId: bigint;
  onChanged: () => void;
}) {
  const { address } = useAccount();
  const wallet = address as Address;
  const mounted = useMounted();
  const { run, confirming } = useTxRunner();
  const [busy, setBusy] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [amount, setAmount] = useState("");

  const balQuery = useQuery({
    queryKey: ["vaultBalance", vaultId.toString()],
    refetchInterval: 8000,
    queryFn: () => getVaultBalance(vaultId, USDC),
  });
  const balRaw = balQuery.data ?? 0n;
  const balance = fromRaw(TOKEN, balRaw);
  const working = busy || confirming;

  async function handleWithdraw() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    const raw = toRaw(TOKEN, n);
    if (raw > balRaw) {
      toast.error("Amount exceeds vault balance");
      return;
    }
    setBusy(true);
    const ok = await run(vaultWithdraw(vaultId, USDC, raw), {
      pending: "Withdrawing from vault…",
      success: "Withdrawn to wallet",
    });
    setBusy(false);
    if (ok) {
      setWithdrawOpen(false);
      setAmount("");
      await balQuery.refetch();
      onChanged();
    }
  }

  return (
    <SweemCard className="flex flex-col">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <IconChip>
            <Wallet className="size-[18px]" strokeWidth={2} />
          </IconChip>
          <div>
            <CardLabel className="text-[15px] text-[var(--sw-text)]">Savings Vault</CardLabel>
            <p className="font-mono text-[12px] text-[var(--sw-text-dim)]">#{vaultId.toString()}</p>
          </div>
        </div>
        <ActionButton onClick={() => setWithdrawOpen(true)} disabled={working || balRaw === 0n}>
          Withdraw
        </ActionButton>
      </div>

      <div className="mt-5 flex items-end gap-2">
        {mounted && <MoneyValue value={balance} token={TOKEN} className="text-[30px] leading-none" iconSize={20} />}
        <span className="mb-1 text-[13px] text-[var(--sw-text-dim)]">saved</span>
      </div>
      <p className="mt-1 text-[12.5px] text-[var(--sw-text-dim)]">
        Held in your personal Magmos vault — withdraw to your wallet anytime.
      </p>

      <Modal
        open={withdrawOpen}
        onClose={() => (working ? undefined : setWithdrawOpen(false))}
        title="Withdraw from vault"
        subtitle={<>Available: {balance.toFixed(2)} {TOKEN.symbol}</>}
        footer={
          <>
            <ActionButton onClick={() => setWithdrawOpen(false)} disabled={working}>
              Cancel
            </ActionButton>
            <ActionButton variant="primary" onClick={handleWithdraw} disabled={working || !amount}>
              Withdraw
            </ActionButton>
          </>
        }
      >
        <AmountField
          label={`Amount (${TOKEN.symbol})`}
          value={amount}
          onChange={setAmount}
          symbol={TOKEN.symbol}
          max={balance}
        />
      </Modal>
    </SweemCard>
  );
}

/* ── Screen ──────────────────────────────────────────────────────────── */

export function EmployeePortalScreen() {
  const { address, isConnected } = useAccount();
  const wallet = address as Address | undefined;
  const { run } = useTxRunner();
  const [claimingAll, setClaimingAll] = useState(false);
  const [creatingVault, setCreatingVault] = useState(false);

  // Discover every pool the recipient has a stream in, then hydrate each with its
  // stream state + org (best-effort name). Pure chain reads — no backend required.
  const poolsQuery = useQuery<PoolView[]>({
    queryKey: ["myStreams", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const poolIds = await getEmployeePools(wallet!);
      const views = await Promise.all(
        poolIds.map(async (poolId): Promise<PoolView | null> => {
          const stream = await getStream(poolId, wallet!).catch(() => null);
          if (!stream || !stream.exists) return null;
          const pool = await getPool(poolId).catch(() => null);
          const org = pool?.org ?? "";
          const orgName = org ? await getOrgName(org) : null;
          return { poolId, stream, org, orgName };
        }),
      );
      return views.filter((v): v is PoolView => v !== null);
    },
  });

  const vaultQuery = useQuery<bigint | null>({
    queryKey: ["myVault", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const vaults = await getOwnerVaults(wallet!).catch(() => [] as bigint[]);
      return vaults.length > 0 ? vaults[0] : null;
    },
  });
  const vaultId = vaultQuery.data ?? null;

  async function handleCreateVault() {
    setCreatingVault(true);
    const ok = await run(createVault("Savings"), {
      pending: "Creating your vault…",
      success: "Vault created",
    });
    setCreatingVault(false);
    if (ok) await vaultQuery.refetch();
  }

  // Totals across every employer, so a worker with more than one stream sees one number.
  const poolIds = (poolsQuery.data ?? []).map((v) => v.poolId);
  const totalsQuery = useQuery({
    queryKey: ["earningTotals", wallet, poolIds.join(",")],
    enabled: !!wallet && poolIds.length > 0,
    refetchInterval: 10000,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const pairs = await Promise.all(
        poolIds.map(async (id) => ({
          claimable: await getClaimable(id, wallet!).catch(() => 0n),
          drawable: await getDrawable(id, wallet!).catch(() => 0n),
        })),
      );
      return pairs.reduce(
        (acc, p) => ({
          claimable: acc.claimable + p.claimable,
          drawable: acc.drawable + p.drawable,
        }),
        { claimable: 0n, drawable: 0n },
      );
    },
  });

  async function handleClaimAll() {
    if (poolIds.length === 0) return;
    setClaimingAll(true);
    const ok = await run(claimMany(poolIds), {
      pending: `Claiming from ${poolIds.length} employer${poolIds.length === 1 ? "" : "s"}…`,
      success: "All available pay claimed",
    });
    setClaimingAll(false);
    if (ok) {
      await Promise.all([poolsQuery.refetch(), totalsQuery.refetch()]);
    }
  }

  if (!isConnected || !wallet) {
    return (
      <DashboardPageShell title="Recipient portal">
        <div className="sweem-card mt-5">
          <ConnectGate message="Connect your wallet to view and claim your salary streams." />
        </div>
      </DashboardPageShell>
    );
  }

  const pools = poolsQuery.data ?? [];

  return (
    <DashboardPageShell
      title="Recipient portal"
      subtitle="Claim your streamed salary per second and stash it in a personal savings vault."
    >
      {/* Totals across employers — one number, plus one signature to take it all. */}
      {pools.length > 0 && (
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-4 rounded-[18px] border border-[var(--sw-border)] bg-[var(--sw-card)] px-5 py-4">
          <div className="flex flex-wrap items-end gap-x-8 gap-y-4">
            <div>
              <p className="text-[11.5px] uppercase tracking-[0.08em] text-[var(--sw-text-dim)]">
                Claimable across {pools.length} employer{pools.length === 1 ? "" : "s"}
              </p>
              <p className="sweem-mono mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--sw-text)]">
                {fromRaw(TOKEN, totalsQuery.data?.claimable ?? 0n).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="ml-1.5 text-[12.5px] font-medium text-[var(--sw-text-dim)]">
                  {TOKEN.symbol}
                </span>
              </p>
            </div>
            <div>
              <p className="text-[11.5px] uppercase tracking-[0.08em] text-[var(--sw-text-dim)]">
                Available early
              </p>
              <p className="sweem-mono mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.02em] text-[var(--sw-mint)]">
                {fromRaw(TOKEN, totalsQuery.data?.drawable ?? 0n).toLocaleString(undefined, {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
                <span className="ml-1.5 text-[12.5px] font-medium text-[var(--sw-text-dim)]">
                  {TOKEN.symbol}
                </span>
              </p>
            </div>
          </div>
          {pools.length > 1 && (
            <ActionButton
              variant="primary"
              onClick={handleClaimAll}
              disabled={claimingAll || (totalsQuery.data?.claimable ?? 0n) === 0n}
            >
              {claimingAll ? "Claiming…" : "Claim from all"}
            </ActionButton>
          )}
        </div>
      )}

      {/* streams */}
      {poolsQuery.isLoading ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="Scanning chain for your streams…" />
        </div>
      ) : pools.length === 0 ? (
        <div className="sweem-card mt-5">
          <ConnectGate message="No streams found for your wallet yet." />
        </div>
      ) : (
        <div className="grid gap-5 mt-5">
          {pools.map((v) => (
            <StreamCard
              key={v.poolId}
              view={v}
              vaultId={vaultId}
              onClaimed={() => vaultQuery.refetch()}
              onSaved={() => vaultQuery.refetch()}
            />
          ))}
        </div>
      )}

      {/* send home — CCTP cross-chain bridge */}
      <section className="mt-6">
        <div className="mb-4">
          <p className="text-[17px] font-semibold text-[var(--sw-text)]">Send home</p>
          <p className="text-[13px] text-[var(--sw-text-muted)]">
            Bridge your Circle USDC to your local chain with Circle CCTP — earned in Dubai,
            spendable at home.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SendHomeCard />
        </div>
      </section>

      {/* vault */}
      <section className="mt-6">
        <div className="mb-4">
          <p className="text-[17px] font-semibold text-[var(--sw-text)]">Savings</p>
          <p className="text-[13px] text-[var(--sw-text-muted)]">
            Set aside part of your pay in an on-chain vault only you control.
          </p>
        </div>
        {vaultId !== null ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <VaultCard vaultId={vaultId} onChanged={() => vaultQuery.refetch()} />
          </div>
        ) : (
          <SweemCard className="flex flex-col items-start gap-3">
            <div className="flex items-center gap-3">
              <IconChip>
                <Coins className="size-[18px]" strokeWidth={2} />
              </IconChip>
              <div>
                <CardLabel className="text-[15px] text-[var(--sw-text)]">No vault yet</CardLabel>
                <p className="text-[12.5px] text-[var(--sw-text-dim)]">
                  Create a personal vault to start saving your claimed pay.
                </p>
              </div>
            </div>
            <button
              onClick={handleCreateVault}
              disabled={creatingVault}
              className="rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[12.5px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:opacity-60"
            >
              {creatingVault ? "Creating…" : "Create vault"}
            </button>
          </SweemCard>
        )}
      </section>
    </DashboardPageShell>
  );
}
