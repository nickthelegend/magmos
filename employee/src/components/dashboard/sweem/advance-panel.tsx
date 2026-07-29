"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap } from "lucide-react";
import { isAddress, type Address } from "viem";

import { TOKENS, toRaw, fromRaw, type TokenConfig } from "@/lib/tokens";
import { EXPLORER_TX } from "@/lib/magmos";
import { getAdvanceSnapshot, quoteAdvance, getAdvanceHistory } from "@/lib/reads";
import { drawAdvance, drawAdvanceTo } from "@/lib/writes";
import { ActionButton, Modal, AmountField } from "./ui";
import { useTxRunner } from "./use-tx-runner";

const TOKEN: TokenConfig = TOKENS.USDC;

// Money formatting that never rounds a real amount away to "0.00". A 0.5% fee on a small draw
// is genuinely sub-cent; showing it as zero would understate what the worker is being charged.
const usd = (raw: bigint) => {
  const n = fromRaw(TOKEN, raw);
  const digits = n > 0 && n < 0.01 ? TOKEN.decimals : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: digits });
};

/**
 * Earned Wage Access, worker side.
 *
 * Rendered as a band inside the stream card rather than a card of its own: the money is the same
 * money as the ticker above it, so a second framed surface would imply a second balance. What the
 * band adds is the *option* — take part of it now instead of waiting for payday.
 */
export function AdvancePanel({
  poolId,
  wallet,
  claimableRaw,
  rateRaw,
  ratePeriod,
  streaming,
  disabled,
  onDrawn,
}: {
  poolId: `0x${string}`;
  wallet: Address;
  claimableRaw: bigint;
  rateRaw: bigint;
  ratePeriod: bigint;
  streaming: boolean;
  disabled?: boolean;
  onDrawn: () => void;
}) {
  const { run, confirming } = useTxRunner();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [elsewhere, setElsewhere] = useState(false);
  const [dest, setDest] = useState("");

  // Drawable is re-anchored on-chain every 5s. It is intentionally NOT interpolated like the
  // hero ticker: a spendable limit that drifts between the number you read and the number you
  // tap would be a lie in the one place precision actually matters.
  const drawQuery = useQuery({
    queryKey: ["drawable", poolId, wallet],
    enabled: !!wallet,
    refetchInterval: 5000,
    // One multicall, and deliberately NOT catching per-read: a failed RPC must not render as a
    // factual "0.00 available", which would tell a worker their pay is gone. Letting the query
    // fail keeps the last good value on screen and shows an honest "checking" state instead.
    queryFn: async () => {
      const { drawable, account, policy } = await getAdvanceSnapshot(poolId, wallet);
      const quote = drawable > 0n ? await quoteAdvance(poolId, drawable).catch(() => null) : null;
      return { drawable, account, policy, quote };
    },
    retry: 3,
    placeholderData: (prev) => prev,
  });

  const historyQuery = useQuery({
    queryKey: ["advanceHistory", poolId, wallet],
    enabled: !!wallet,
    refetchInterval: 30000,
    queryFn: () => getAdvanceHistory(poolId, wallet, 4),
  });

  const drawable = drawQuery.data?.drawable ?? 0n;
  const drawnSoFar = drawQuery.data?.account?.totalDrawn ?? 0n;
  const feeCovered = drawQuery.data?.quote?.[1] ?? 0n;
  const feeTotal = drawQuery.data?.quote?.[0] ?? 0n;
  const fullySubsidized = feeTotal > 0n && feeCovered >= feeTotal;
  const history = historyQuery.data ?? [];

  const working = busy || confirming;
  const off = disabled || drawQuery.data?.policy?.disabled === true;
  // No successful read yet — we know nothing, so claim nothing.
  const unknown = !drawQuery.data;
  const canDraw = drawable > 0n && !off && !unknown;

  // When there is nothing to draw yet, an ETA is far more useful than a flat zero.
  const minDraw = drawQuery.data?.policy?.minDraw ?? 10_000n;
  const secsToMin =
    streaming && rateRaw > 0n && ratePeriod > 0n && drawable < minDraw
      ? Number(((minDraw - drawable) * ratePeriod) / rateRaw) + 1
      : 0;
  const eta =
    secsToMin <= 0
      ? null
      : secsToMin < 90
        ? `about ${secsToMin}s`
        : secsToMin < 5400
          ? `about ${Math.round(secsToMin / 60)} min`
          : `about ${Math.round(secsToMin / 3600)}h`;

  // Why the number is what it is — the caption changes meaning, not just wording.
  const caption = unknown
    ? "Checking what you have earned so far…"
    : off
      ? "Early access is turned off for this payroll."
      : drawable < minDraw
        ? claimableRaw > 0n && drawable === 0n
          ? "Your employer's pool is short right now — try again once it's topped up."
          : eta
            ? `Your first draw unlocks in ${eta} — this grows every second your stream runs.`
            : "Nothing earned yet. This grows every second your stream runs."
        : drawable < claimableRaw
          ? `Capped below your full balance by your employer's early-access limit.`
          : fullySubsidized
            ? "Pay you have already earned. The access fee is covered by yield on the payroll float."
            : "Pay you have already earned, available before payday.";

  const raw = amount ? toRaw(TOKEN, Number(amount)) : 0n;
  const overDraw = raw > drawable;
  const destOk = !elsewhere || (dest.trim() !== "" && isAddress(dest.trim()));

  const quoteQuery = useQuery({
    queryKey: ["drawQuote", poolId, raw.toString()],
    enabled: open && raw > 0n && !overDraw,
    queryFn: () => quoteAdvance(poolId, raw),
  });
  const q = quoteQuery.data;

  async function handleDraw() {
    if (!raw || overDraw || !destOk) return;
    const to = elsewhere ? (dest.trim() as Address) : null;
    setBusy(true);
    const ok = await run(to ? drawAdvanceTo(poolId, raw, to) : drawAdvance(poolId, raw), {
      pending: "Sending your advance…",
      success: to
        ? `Sent ${usd(raw)} ${TOKEN.symbol} to ${to.slice(0, 6)}…${to.slice(-4)}`
        : `Drew ${usd(raw)} ${TOKEN.symbol} to your wallet`,
    });
    setBusy(false);
    if (ok) {
      setOpen(false);
      setAmount("");
      setElsewhere(false);
      setDest("");
      await Promise.all([drawQuery.refetch(), historyQuery.refetch()]);
      onDrawn();
    }
  }

  return (
    <div className="mt-5 border-t border-[var(--sw-border)] pt-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-mint)]">
            <Zap className="size-[13px]" strokeWidth={2.4} />
            Get paid early
          </p>
          <p className="sweem-mono mt-1.5 text-[22px] font-semibold leading-none tracking-[-0.02em] text-[var(--sw-text)]">
            {unknown ? "—" : usd(drawable)}
            <span className="ml-1.5 text-[13px] font-medium text-[var(--sw-text-dim)]">
              {TOKEN.symbol} available now
            </span>
          </p>
          <p className="mt-2 max-w-[46ch] text-[12.5px] leading-[1.5] text-[var(--sw-text-muted)]">
            {caption}
          </p>
        </div>

        <ActionButton
          variant="primary"
          onClick={() => setOpen(true)}
          disabled={working || !canDraw}
        >
          <Zap className="size-[15px]" strokeWidth={2.2} /> Draw now
        </ActionButton>
      </div>

      {drawnSoFar > 0n && (
        <p className="mt-3 rounded-[10px] bg-[var(--sw-card-inset)] px-3 py-2 text-[12px] text-[var(--sw-text-muted)]">
          You have drawn{" "}
          <span className="sweem-mono font-semibold text-[var(--sw-text)]">
            {usd(drawnSoFar)} {TOKEN.symbol}
          </span>{" "}
          early. It is already netted off your next claim — there is nothing to repay.
        </p>
      )}

      {history.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {history.map((h) => (
            <li
              key={h.txHash}
              className="flex items-center justify-between gap-3 text-[12px] text-[var(--sw-text-dim)]"
            >
              <span className="truncate">
                {new Date(h.timestamp * 1000).toLocaleDateString(undefined, {
                  month: "short",
                  day: "numeric",
                })}
                {" · "}
                <span className="sweem-mono text-[var(--sw-text-muted)]">
                  {usd(h.amount)} {TOKEN.symbol}
                </span>
                {h.subsidized > 0n && h.subsidized >= h.fee ? " · fee covered by yield" : ""}
              </span>
              <a
                href={EXPLORER_TX(h.txHash)}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 text-[var(--sw-text-dim)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--sw-mint)]"
              >
                Receipt
              </a>
            </li>
          ))}
        </ul>
      )}

      <Modal
        open={open}
        onClose={() => (working ? undefined : setOpen(false))}
        title="Draw your earned pay"
        subtitle={
          <>
            Take any part of what you have already earned, right now. It is deducted from your next
            claim — this is not a loan, and there is nothing to pay back.
          </>
        }
        footer={
          <>
            <ActionButton onClick={() => setOpen(false)} disabled={working}>
              Cancel
            </ActionButton>
            <ActionButton
              variant="primary"
              onClick={handleDraw}
              disabled={working || !raw || overDraw || !destOk}
            >
              {working ? "Drawing…" : raw ? `Draw ${usd(raw)} ${TOKEN.symbol}` : "Draw"}
            </ActionButton>
          </>
        }
      >
        <AmountField
          label={`Amount (${TOKEN.symbol})`}
          value={amount}
          onChange={setAmount}
          symbol={TOKEN.symbol}
          max={fromRaw(TOKEN, drawable)}
        />

        {overDraw ? (
          <p className="mt-2 text-[12.5px] font-medium text-[#ff794b]">
            That is more than you have earned so far. The most you can draw right now is{" "}
            {usd(drawable)} {TOKEN.symbol}.
          </p>
        ) : q ? (
          <dl className="mt-4 space-y-1.5 rounded-[12px] bg-[var(--sw-card-inset)] px-3.5 py-3 text-[12.5px]">
            <div className="flex items-center justify-between">
              <dt className="text-[var(--sw-text-muted)]">Access fee</dt>
              <dd className="sweem-mono text-[var(--sw-text)]">
                {usd(q[0])} {TOKEN.symbol}
              </dd>
            </div>
            {q[1] > 0n && (
              <div className="flex items-center justify-between">
                <dt className="text-[var(--sw-text-muted)]">Covered by payroll-float yield</dt>
                <dd className="sweem-mono text-[var(--sw-mint)]">
                  −{usd(q[1])} {TOKEN.symbol}
                </dd>
              </div>
            )}
            <div className="flex items-center justify-between border-t border-[var(--sw-border)] pt-1.5">
              <dt className="font-semibold text-[var(--sw-text)]">You receive</dt>
              <dd className="sweem-mono font-semibold text-[var(--sw-text)]">
                {usd(q[3])} {TOKEN.symbol}
              </dd>
            </div>
          </dl>
        ) : null}

        <label className="mt-4 flex items-start gap-2.5 text-[12.5px] text-[var(--sw-text-muted)]">
          <input
            type="checkbox"
            checked={elsewhere}
            onChange={(e) => setElsewhere(e.target.checked)}
            className="mt-0.5 size-[15px] accent-[var(--sw-mint)]"
          />
          <span>
            Send it straight somewhere else
            <span className="mt-0.5 block text-[11.5px] text-[var(--sw-text-dim)]">
              Skips a second transaction if the money is going onward anyway.
            </span>
          </span>
        </label>

        {elsewhere && (
          <div className="mt-2">
            <input
              value={dest}
              onChange={(e) => setDest(e.target.value)}
              placeholder="0x… destination address"
              aria-label="Destination address"
              className="w-full rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 font-mono text-[12.5px] text-[var(--sw-text)] outline-none focus:border-[var(--sw-mint)]/60"
            />
            {dest.trim() !== "" && !isAddress(dest.trim()) && (
              <p className="mt-1.5 text-[12px] font-medium text-[#ff794b]">
                That is not a valid address — check it before sending.
              </p>
            )}
          </div>
        )}

        <p className="sweem-hint">
          Drawn {TOKEN.symbol} lands in your wallet, so you can send it home or save it just like
          claimed pay.
        </p>
      </Modal>
    </div>
  );
}
