"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatNano } from "./helpers";

// Live-ticking token value at 9 dp (nano). Anchored to the last on-chain poll and
// interpolated each frame at the stream rate. The fast-churning fractional tail is
// rendered smaller + dimmed with a soft pulse so it reads as "live motion" instead
// of visual noise. Raw amounts scale to nano by the token's decimals (10^(9-dp)):
// USDC (6dp) ×1000, SUI (9dp) ×1.
export function LiveTicker({
  baseRaw,
  rateRaw,
  periodMs,
  anchorAt,
  active,
  decimals = 6,
}: {
  baseRaw: bigint;
  rateRaw: bigint;
  periodMs: bigint;
  anchorAt?: number;
  active: boolean;
  decimals?: number;
}) {
  const scale = 10n ** BigInt(Math.max(0, 9 - decimals));
  const [display, setDisplay] = useState(() => formatNano(baseRaw * scale));

  // Respect prefers-reduced-motion: the number still updates from the on-chain poll, it just
  // stops animating every frame. A continuously-churning balance is precisely the kind of motion
  // that triggers vestibular discomfort.
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const anchor = anchorAt ?? Date.now();
    let raf = 0;
    const tick = () => {
      const elapsed = BigInt(Math.max(0, Date.now() - anchor));
      const accruedNano =
        active && periodMs > 0n ? (rateRaw * scale * elapsed) / periodMs : 0n;
      setDisplay(formatNano(baseRaw * scale + accruedNano));
      if (active && !reduceMotion) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [baseRaw, rateRaw, periodMs, anchorAt, active, scale, reduceMotion]);

  const [intPart, fracPart] = display.split(".");

  return (
    <span className="sweem-mono inline-flex items-baseline">
      <span>{intPart}</span>
      <motion.span
        className="text-[0.62em] text-[var(--sw-text-dim)]"
        animate={active ? { opacity: [0.55, 0.85, 0.55] } : { opacity: 0.7 }}
        transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
      >
        .{fracPart}
      </motion.span>
    </span>
  );
}
