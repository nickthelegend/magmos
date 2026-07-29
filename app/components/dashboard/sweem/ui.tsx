"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ProtocolLogo } from "@/components/sweem-ui/protocol-logo";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { TOKENS, type TokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

// Small shared primitives for the Magmos dashboard screens. Styled with the
// `.sweem-*` / `--sw-*` tokens so everything matches the existing dashboard look.

export function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="sweem-stat">
      <p className="sweem-stat-label">{label}</p>
      <div className={`sweem-stat-value ${mono ? "sweem-stat-value-mono" : ""}`}>
        {value}
      </div>
    </div>
  );
}

export function ActionButton({
  children,
  onClick,
  disabled,
  variant = "secondary",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  type?: "button" | "submit";
}) {
  return (
    <button
      className={`dashboard-screen-action dashboard-screen-action-${variant}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="sweem-modal-overlay" onClick={onClose} role="presentation">
      <div
        className="sweem-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="sweem-modal-title">{title}</h2>
        {subtitle ? <p className="sweem-modal-sub">{subtitle}</p> : null}
        <div className="mt-4 flex flex-col gap-3">{children}</div>
        {footer ? <div className="sweem-actions mt-5 justify-end">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ConnectGate({ message }: { message: string }) {
  return <div className="sweem-gate">{message}</div>;
}

// Quick-fill chips (25/50/75/Max) that pick a fraction of `max` for an amount field.
export function PercentChips({
  max,
  onPick,
  disabled,
}: {
  max: number;
  onPick: (value: number) => void;
  disabled?: boolean;
}) {
  const opts = [25, 50, 75, 100];
  const pick = (pct: number) =>
    onPick(pct === 100 ? max : Math.round(((max * pct) / 100) * 1e6) / 1e6);
  return (
    <div className="flex gap-1.5">
      {opts.map((pct) => (
        <button
          key={pct}
          type="button"
          disabled={disabled || max <= 0}
          onClick={() => pick(pct)}
          className="rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1 text-[11.5px] font-medium text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)] hover:text-[var(--sw-text)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pct === 100 ? "Max" : `${pct}%`}
        </button>
      ))}
    </div>
  );
}

// One yield leg inside an invest dialog: checkbox + live APR + amount input.
// Pass `max` to show 25/50/75/Max quick-fill chips beneath the input.
export function ProtocolRow({
  name,
  label,
  apy,
  checked,
  onChecked,
  amount,
  onAmount,
  symbol = "USDC",
  max,
}: {
  name: string; // logo key (protocol key, lowercase) — resolves the ProtocolLogo
  label?: string; // display text; defaults to `name`
  apy: number | undefined;
  checked: boolean;
  onChecked: (v: boolean) => void;
  amount: string;
  onAmount: (v: string) => void;
  symbol?: string;
  max?: number;
}) {
  return (
    <div
      className={cn(
        "rounded-2xl border p-4 transition-colors",
        checked
          ? "border-[var(--sw-border-strong)] bg-[var(--sw-card-inset)]"
          : "border-[var(--sw-border)] bg-[var(--sw-card-inset)] hover:border-[var(--sw-border-strong)]"
      )}
    >
      <label className="flex cursor-pointer items-center gap-3">
        <ProtocolLogo name={name} size={36} className="rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-semibold leading-tight text-[color:var(--dash-text)]">{label ?? name}</p>
          <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-[rgba(255,106,26,0.14)] px-2 py-0.5 text-[11px] font-semibold text-[var(--sw-mint)]">
            <span className="size-1.5 rounded-full bg-[var(--sw-mint)]" />
            {apy == null ? "Live APR …" : `Live APR ${apy.toFixed(2)}%`}
          </span>
        </div>
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChecked(e.target.checked)}
          className="h-[18px] w-[18px] shrink-0 accent-[var(--sw-mint)]"
        />
      </label>

      <AnimatePresence initial={false}>
        {checked && (
          <motion.div
            key="amount"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30, opacity: { duration: 0.15 } }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 transition-colors focus-within:border-[var(--sw-mint)]/60 focus-within:ring-2 focus-within:ring-[rgba(255,106,26,0.15)]">
                <input
                  type="number"
                  inputMode="decimal"
                  className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold tabular-nums text-[var(--sw-text)] outline-none placeholder:font-normal placeholder:text-[var(--sw-text-muted)]"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => onAmount(e.target.value)}
                />
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--sw-card-inset)] px-2.5 py-1 text-[12px] font-semibold text-[var(--sw-text)]">
                  {TOKENS[symbol as TokenSymbol] && (
                    <TokenIcon token={TOKENS[symbol as TokenSymbol]} size={15} />
                  )}
                  {symbol}
                </span>
              </div>
              {max != null && <PercentChips max={max} onPick={(v) => onAmount(String(v))} />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// One destination leg in the Claim & Allocate sheet: a colored dot, label/hint,
// a percentage slider, and the live token amount. Pass no `onPct` to render a
// read-only row (used for the wallet leg, which is the implicit remainder).
export function AllocRow({
  label,
  hint,
  pct,
  amount,
  symbol = "USDC",
  accent,
  onPct,
  max = 100,
}: {
  label: string;
  hint?: ReactNode;
  pct: number;
  amount: number;
  symbol?: string;
  accent?: string;
  onPct?: (v: number) => void;
  max?: number;
}) {
  return (
    <div className="sweem-protocol-row items-center">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ background: accent ?? "var(--sw-text)" }}
      />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-[color:var(--dash-text)]">{label}</p>
        {hint ? <p className="sweem-hint">{hint}</p> : null}
        {onPct ? (
          <input
            type="range"
            min={0}
            max={max}
            value={pct}
            onChange={(e) => onPct(Number(e.target.value))}
            className="mt-2 w-full accent-[var(--sw-mint)]"
          />
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        <p className="text-[13px] font-semibold tabular-nums text-[color:var(--dash-text)]">
          {pct}%
        </p>
        <p className="sweem-hint tabular-nums">{amount.toFixed(2)} {symbol}</p>
      </div>
    </div>
  );
}

// Slippage selector for on-chain swaps. Value is in basis points (100 = 1%).
// Preset chips + a custom field; defaults to 1%.
export function SlippageInput({
  bps,
  onBps,
  disabled,
}: {
  bps: number;
  onBps: (v: number) => void;
  disabled?: boolean;
}) {
  const presets = [50, 100, 200]; // 0.5%, 1%, 2%
  return (
    <div className="rounded-2xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] p-3.5">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-semibold text-[color:var(--dash-text)]">Max slippage</p>
        <span className="text-[12px] font-semibold tabular-nums text-[var(--sw-text-muted)]">
          {(bps / 100).toFixed(2)}%
        </span>
      </div>
      <p className="sweem-hint mt-0.5">Sets the max slippage tolerance for on-chain swaps.</p>
      <div className="mt-2.5 flex items-center gap-1.5">
        {presets.map((p) => (
          <button
            key={p}
            type="button"
            disabled={disabled}
            onClick={() => onBps(p)}
            className={cn(
              "rounded-lg border px-2.5 py-1 text-[11.5px] font-medium transition-colors disabled:opacity-40",
              bps === p
                ? "border-[var(--sw-border-strong)] bg-[var(--sw-card)] text-[var(--sw-text)]"
                : "border-[var(--sw-border)] text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
            )}
          >
            {p / 100}%
          </button>
        ))}
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-[var(--sw-border)] bg-[#1b1b1f] px-2 py-1 focus-within:border-[var(--sw-mint)]/60">
          <input
            type="number"
            inputMode="decimal"
            disabled={disabled}
            className="w-14 bg-transparent text-right text-[12.5px] font-semibold tabular-nums text-[var(--sw-text)] outline-none"
            placeholder="1.0"
            value={bps ? bps / 100 : ""}
            onChange={(e) => {
              const pct = Number(e.target.value);
              if (Number.isFinite(pct) && pct >= 0) onBps(Math.round(pct * 100));
            }}
          />
          <span className="text-[12px] text-[var(--sw-text-muted)]">%</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Money input, matching the top-up modal's treatment.
 *
 * Extracted because three flows (top-up, EWA policy minimum, subsidy funding) had grown the same
 * 15 lines of markup, and a currency field is exactly the thing that must not drift between them.
 * Guards input to a decimal shape so a stray character can't reach `Number()` as NaN.
 */
export function AmountInput({
  label,
  value,
  onChange,
  symbol = "USDC",
  autoFocus,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  symbol?: string;
  autoFocus?: boolean;
  hint?: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-[var(--sw-text-muted)]">
        {label}
      </span>
      <span className="flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2.5 focus-within:border-[var(--sw-mint)]/60">
        <input
          type="text"
          inputMode="decimal"
          autoFocus={autoFocus}
          className="min-w-0 flex-1 bg-transparent text-[18px] font-semibold tabular-nums text-[var(--sw-text)] outline-none placeholder:font-normal placeholder:text-[var(--sw-text-muted)]"
          placeholder="0.00"
          value={value}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || /^\d*\.?\d*$/.test(v)) onChange(v);
          }}
        />
        <span className="inline-flex shrink-0 items-center rounded-full bg-[var(--sw-card-inset)] px-2.5 py-1 text-[12px] font-semibold text-[var(--sw-text)]">
          {symbol}
        </span>
      </span>
      {hint ? <span className="mt-1.5 block text-[12px] text-[var(--sw-text-dim)]">{hint}</span> : null}
    </label>
  );
}
