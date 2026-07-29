"use client";

import { motion, useReducedMotion } from "framer-motion";

const LINE =
  "M0 96 C 25 92 45 80 70 78 C 95 76 110 62 135 60 C 160 58 175 44 200 40 C 225 36 245 26 270 20 C 285 16 295 14 300 12";
const AREA = `${LINE} L300 120 L0 120 Z`;

/**
 * "USDC streamed" growth visual for the Impacts section — an upward balance
 * curve that draws in once on scroll. Replaces the empty placeholder box.
 */
export function ImpactChart() {
  const reduce = useReducedMotion();

  return (
    <div className="rounded-[24px] border border-border bg-white p-6 shadow-[0_18px_50px_rgba(4,40,80,0.08)]">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[12px] font-medium text-text-secondary">
          <span className="relative flex size-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60" />
            <span className="relative inline-flex size-2 rounded-full bg-brand" />
          </span>
          USDC streamed
        </span>
        <span className="rounded-full bg-[rgba(255, 106, 26, 0.16)] px-2.5 py-1 text-[11px] font-medium text-[#ff6a1a]">
          Settled per second
        </span>
      </div>

      <div className="mt-4 flex items-end gap-2">
        <span className="text-[40px] font-semibold leading-none tracking-[-0.02em] text-text-primary">1s</span>
        <span className="mb-1 text-[13px] text-text-muted">settlement finality</span>
      </div>

      <svg viewBox="0 0 300 120" className="mt-5 w-full" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id="impactFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ff6a1a" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#ff6a1a" stopOpacity="0" />
          </linearGradient>
        </defs>

        <motion.path
          d={AREA}
          fill="url(#impactFill)"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.8, delay: 0.3 }}
        />
        <motion.path
          d={LINE}
          fill="none"
          stroke="#ff6a1a"
          strokeWidth="2.5"
          strokeLinecap="round"
          initial={reduce ? { pathLength: 1 } : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.circle
          cx="300"
          cy="12"
          r="4"
          fill="#ff6a1a"
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, amount: 0.4 }}
          transition={{ duration: 0.3, delay: 1.5 }}
        />
      </svg>

      <p className="mt-4 text-[12px] leading-[1.6] text-text-secondary">
        USDC accrues to recipients worldwide every second on Arc — claimable the moment it lands, bridged home via CCTP.
      </p>
    </div>
  );
}
