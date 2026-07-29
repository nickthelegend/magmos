"use client";

import { useState } from "react";
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { createPortal } from "react-dom";
import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Loader2, Lock, X } from "lucide-react";
import { TokenIcon } from "@/components/sweem-ui/token-icon";
import { SUPPORTED_TOKENS, TOKENS, type TokenSymbol } from "@/lib/tokens";
import { cn } from "@/lib/utils";

// Display name per token, shown in the payment-method rows.
const TOKEN_NAME: Record<TokenSymbol, string> = {
  USDC: "USD Coin",
};

// Flat per-token network fee estimate (human units) for the summary line.
const NETWORK_FEE: Record<TokenSymbol, number> = {
  USDC: 0.01,
};

export function PayModal({
  open,
  onClose,
  merchant = "Magmos",
  amount = 480,
  onPay,
  align = "center",
  backdrop = true,
  inline = false,
}: {
  open: boolean;
  onClose: () => void;
  merchant?: string;
  amount?: number;
  onPay?: (data: { amount: number; token: TokenSymbol; total: number }) => void;
  align?: "center" | "right";
  backdrop?: boolean;
  // Render in normal flow (no fixed full-viewport overlay / portal). Used for the
  // dashboard preview so the card centers within the content area.
  inline?: boolean;
}) {
  const [token, setToken] = useState<TokenSymbol>("USDC");
  const mounted = useMounted();
  const [status, setStatus] = useState<"form" | "processing" | "success">("form");

  // Reset to the form each time the modal is (re)opened. Adjusting state during render on a prop
  // change is the sanctioned pattern for this; an effect here caused a cascading render.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setStatus("form");
  }

  const fee = NETWORK_FEE[token];
  const total = amount + fee;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 4 });

  const pay = () => {
    setStatus("processing");
    // Simulate the on-chain payment, then flip to the success screen.
    setTimeout(() => {
      setStatus("success");
      onPay?.({ amount, token, total });
    }, 1700);
  };

  if (!mounted) return null;

  const tree = (
    <AnimatePresence>
      {open && (
        <motion.div
          className={cn(
            "sw-dash flex text-[var(--sw-text)]",
            inline
              ? "min-h-[calc(100vh-60px)] w-full items-center justify-center p-4"
              : cn(
                  "fixed inset-0 z-50 p-4",
                  align === "right" ? "items-center justify-center md:pl-[50%]" : "items-center justify-center",
                  !backdrop && "pointer-events-none"
                )
          )}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {!inline && backdrop && (
            <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          )}

          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 240, damping: 26 }}
            className="pointer-events-auto relative z-10 w-full max-w-[420px] overflow-hidden rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]"
          >
            {status === "success" ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: "spring", stiffness: 240, damping: 18 }}
                  className="relative flex size-24 items-center justify-center"
                >
                  <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255, 106, 26, 0.28),transparent_70%)] blur-lg" />
                  <Image src="/magmos.png" alt={merchant} width={72} height={72} className="relative size-[72px]" />
                  <span className="absolute -bottom-1 -right-1 flex size-7 items-center justify-center rounded-full border-2 border-[var(--sw-card)] bg-[var(--sw-mint)] text-black">
                    <Check className="size-4" strokeWidth={3} />
                  </span>
                </motion.div>
                <h2 className="mt-6 text-[20px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
                  Payment successful
                </h2>
                <p className="mt-1.5 text-[13.5px] text-[var(--sw-text-muted)]">
                  You paid{" "}
                  <span className="font-semibold text-[var(--sw-text)]">{fmt(total)} {token}</span> to {merchant}
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-7 w-full rounded-2xl bg-[var(--sw-mint)] py-3.5 text-[15px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
                >
                  Done
                </button>
              </div>
            ) : (
            <>
            {/* Header */}
            <div className="flex items-center justify-between px-6 pt-5">
              <div className="flex items-center gap-2.5">
                <Image src="/magmos.png" alt={merchant} width={28} height={28} className="size-7" />
                <span className="text-[15px] font-semibold text-[var(--sw-text)]">{merchant}</span>
                <span className="rounded-md bg-[var(--sw-card-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--sw-text-muted)]">
                  Test mode
                </span>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="flex size-8 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
              >
                <X className="size-5" strokeWidth={2} />
              </button>
            </div>

            {/* Amount */}
            <div className="px-6 pt-6 text-center">
              <p className="text-[13px] text-[var(--sw-text-muted)]">Pay {merchant}</p>
              <div className="mt-1 flex items-end justify-center gap-2">
                <span className="text-[40px] font-semibold leading-none tabular-nums text-[var(--sw-text)]">
                  {fmt(amount)}
                </span>
                <span className="mb-1 inline-flex items-center gap-1 text-[15px] font-semibold text-[var(--sw-text-muted)]">
                  <TokenIcon token={TOKENS[token]} size={18} />
                  {token}
                </span>
              </div>
            </div>

            {/* Payment method */}
            <div className="px-6 pt-6">
              <p className="mb-2 text-center text-[12px] font-medium uppercase tracking-wide text-[var(--sw-text-muted)]">
                Pay with
              </p>
              <div className="flex flex-col gap-2">
                {SUPPORTED_TOKENS.map((t) => {
                  const active = t.symbol === token;
                  return (
                    <button
                      key={t.symbol}
                      type="button"
                      onClick={() => setToken(t.symbol)}
                      className={cn(
                        "flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors",
                        active
                          ? "border-[var(--sw-border-strong)] bg-[var(--sw-card-inset)]"
                          : "border-[var(--sw-border)] hover:border-[var(--sw-border-strong)]"
                      )}
                    >
                      <TokenIcon token={t} size={32} />
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-[var(--sw-text)]">{TOKEN_NAME[t.symbol]}</p>
                        <p className="text-[12px] text-[var(--sw-text-dim)]">Pay with {t.symbol} on Arc</p>
                      </div>
                      <span
                        className={cn(
                          "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                          active ? "border-[var(--sw-mint)] bg-[var(--sw-mint)] text-black" : "border-[var(--sw-border-strong)]"
                        )}
                      >
                        {active && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="mx-6 mt-6 flex flex-col gap-2 border-t border-[var(--sw-border)] pt-4 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-[var(--sw-text-muted)]">Amount</span>
                <span className="tabular-nums text-[var(--sw-text)]">{fmt(amount)} {token}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--sw-text-muted)]">Network fee</span>
                <span className="tabular-nums text-[var(--sw-text)]">{fmt(fee)} {token}</span>
              </div>
              <div className="flex items-center justify-between border-t border-[var(--sw-border)] pt-2">
                <span className="font-semibold text-[var(--sw-text)]">Total</span>
                <span className="font-semibold tabular-nums text-[var(--sw-text)]">{fmt(total)} {token}</span>
              </div>
            </div>

            {/* Pay */}
            <div className="px-6 pb-6 pt-5">
              <button
                type="button"
                onClick={pay}
                disabled={status === "processing"}
                className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[var(--sw-mint)] py-3.5 text-[15px] font-semibold text-black transition-colors hover:bg-[#cef77f] disabled:opacity-80"
              >
                {status === "processing" ? (
                  <>
                    <Loader2 className="size-[18px] animate-spin" strokeWidth={2.4} />
                    Processing…
                  </>
                ) : (
                  <>Pay {fmt(total)} {token}</>
                )}
              </button>
              <p className="mt-3 flex items-center justify-center gap-1.5 text-[11.5px] text-[var(--sw-text-dim)]">
                <Lock className="size-3.5" strokeWidth={2} />
                Payments secured on the Arc network
              </p>
            </div>
            </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return inline ? tree : createPortal(tree, document.body);
}
