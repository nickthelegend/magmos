"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";

import { useSweemApi, type Employee } from "@/lib/api";
import { TOKENS } from "@/lib/tokens";
import { poolIdFor, USDC } from "@/lib/magmos";
import {
  getPool,
  getEmployees,
  getClaimable,
  getStream,
  getUsdcBalance,
  getEmployeeSnapshots,
  type PoolSummary,
} from "@/lib/reads";
import { monthlyRate } from "./helpers";

// One live recipient row: on-chain stream + claimable joined with Mongo metadata.
export interface RecipientRow {
  address: string;
  name: string;
  monthlyUsdc: number; // metadata target (may differ from on-chain rate)
  claimableRaw: bigint; // raw 6dp USDC accrued, anchored on-chain
  rateRaw: bigint; // raw 6dp USDC per ratePeriod
  ratePeriod: bigint; // seconds
  paused: boolean;
  stopped: boolean;
  onChain: boolean; // has an on-chain stream in this pool
  advancedRaw: bigint; // lifetime earned-wage advances taken by this recipient
  drawableRaw: bigint; // what they could draw right now (live employer exposure)
}

export interface OrgPoolState {
  poolId: `0x${string}`;
  summary: PoolSummary | null;
  funded: boolean;
  totalDepositedRaw: bigint;
  totalClaimedRaw: bigint;
  balanceRaw: bigint;
  // stream aggregates (raw 6dp)
  monthlyRateRaw: bigint; // Σ rate normalized to MONTH_S
  claimableRaw: bigint; // Σ per-recipient claimable (anchor)
  streamedRaw: bigint; // totalClaimed + claimable
  recipients: RecipientRow[];
  // Earned Wage Access
  advancedRaw: bigint; // Σ advances drawn against this pool, lifetime
  drawableNowRaw: bigint; // Σ workers could draw right now — the live exposure number
}

const EMPTY: Omit<OrgPoolState, "poolId"> = {
  summary: null,
  funded: false,
  totalDepositedRaw: 0n,
  totalClaimedRaw: 0n,
  balanceRaw: 0n,
  monthlyRateRaw: 0n,
  claimableRaw: 0n,
  streamedRaw: 0n,
  recipients: [],
  advancedRaw: 0n,
  drawableNowRaw: 0n,
};

const MONTH_S = 2_592_000n;

// normalize any (rate over period) to a per-MONTH_S raw amount.
function toMonthlyRaw(rateRaw: bigint, periodSecs: bigint): bigint {
  if (periodSecs === 0n) return 0n;
  return (rateRaw * MONTH_S) / periodSecs;
}

// Chain-first org pool state. Reads the org's single USDC StreamPool, its
// on-chain roster (employeesOf), and per-recipient claimable/stream, then joins
// with Mongo employee metadata (names, target salary). USDC-only.
export function useOrgPool() {
  const { address } = useAccount();
  const wallet = address?.toLowerCase();
  const api = useSweemApi();

  const org = api.orgQuery.data;
  const employees = useMemo<Employee[]>(
    () => api.employeesQuery.data ?? [],
    [api.employeesQuery.data]
  );
  const groups = api.groupsQuery.data ?? [];

  const metaByAddr = useMemo(() => {
    const m: Record<string, Employee> = {};
    for (const e of employees) m[e.walletAddress.toLowerCase()] = e;
    return m;
  }, [employees]);

  const totalMonthlyMeta = useMemo(
    () => employees.reduce((s, e) => s + monthlyRate(e), 0),
    [employees]
  );

  const poolId = wallet
    ? poolIdFor(wallet as `0x${string}`, USDC)
    : poolIdFor(
        "0x0000000000000000000000000000000000000000",
        USDC
      );

  // Wallet USDC balance (for the fund flow max).
  const balanceQuery = useQuery({
    queryKey: ["usdcBalance", wallet],
    enabled: !!wallet,
    refetchInterval: 8000,
    queryFn: () => getUsdcBalance(wallet as `0x${string}`),
  });

  const stateQuery = useQuery<OrgPoolState>({
    queryKey: ["orgPoolState", poolId, wallet],
    enabled: !!wallet,
    refetchInterval: 5000,
    retry: 3,
    placeholderData: (prev) => prev, // hold the last good snapshot through a transient RPC blip
    queryFn: async () => {
      const summary = await getPool(poolId);
      if (!summary.exists) {
        return { poolId, ...EMPTY, summary };
      }

      // One multicall for the whole recipient fan-out — Arc's RPC rejects concurrent requests.
      // Not individually caught: a rate-limited RPC must not render as real "0.00 streaming",
      // so a failure rejects the query and react-query keeps the last good snapshot instead.
      const onChainEmps = await getEmployees(poolId);
      const details = await getEmployeeSnapshots(poolId, onChainEmps);

      let monthlyRateRaw = 0n;
      let claimableRaw = 0n;
      let advancedRaw = 0n;
      let drawableNowRaw = 0n;
      const recipients: RecipientRow[] = details.map(({ addr, claimable, stream, advance, drawable }) => {
        const meta = metaByAddr[addr.toLowerCase()];
        const rateRaw = stream?.rateAmount ?? 0n;
        const ratePeriod = stream?.ratePeriod ?? MONTH_S;
        const stopped = !!stream && stream.stoppedAt > 0n;
        const paused = !!stream && stream.pausedAt > 0n && !stopped;
        if (!stopped) monthlyRateRaw += toMonthlyRaw(rateRaw, ratePeriod);
        claimableRaw += claimable;
        const advancedForRow = advance?.totalDrawn ?? 0n;
        advancedRaw += advancedForRow;
        drawableNowRaw += drawable;
        return {
          address: addr,
          name: meta?.name ?? "",
          monthlyUsdc: meta ? Number(meta.monthlyUsdc) || 0 : 0,
          claimableRaw: claimable,
          rateRaw,
          ratePeriod,
          paused,
          stopped,
          onChain: !!stream && stream.exists,
          advancedRaw: advancedForRow,
          drawableRaw: drawable,
        };
      });

      return {
        poolId,
        summary,
        funded: summary.totalDeposited > 0n,
        totalDepositedRaw: summary.totalDeposited,
        totalClaimedRaw: summary.totalClaimed,
        balanceRaw: summary.balance,
        monthlyRateRaw,
        claimableRaw,
        streamedRaw: summary.totalClaimed + claimableRaw,
        recipients,
        advancedRaw,
        drawableNowRaw,
      };
    },
  });

  const state = stateQuery.data ?? { poolId, ...EMPTY };

  return {
    wallet,
    api,
    org,
    employees,
    groups,
    metaByAddr,
    poolId,
    state,
    stateQuery,
    usdcBalanceRaw: balanceQuery.data ?? 0n,
    totalMonthlyMeta,
    token: TOKENS.USDC,
    anchorAt: stateQuery.dataUpdatedAt,
  };
}
