"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { formatUsdc } from "./helpers";

// Live-ticking USDC figure (6dp). Anchored to the last on-chain read and
// interpolated each animation frame at the stream rate. `rateRaw` is raw USDC
// (6dp) accrued per `periodSecs` SECONDS (matches the Arc contract's
// block.timestamp streams). The fast-churning fractional tail is rendered
// smaller + dimmed with a soft pulse so it reads as "live motion".
export function LiveTicker({
  baseRaw,
  rateRaw,
  periodSecs,
  anchorAt,
  active,
  decimals = 6,
  fracDigits = 6,
}: {
  baseRaw: bigint;
  rateRaw: bigint;
  periodSecs: bigint;
  anchorAt?: number;
  active: boolean;
  decimals?: number;
  fracDigits?: number;
}) {
  const [display, setDisplay] = useState(() => formatUsdc(baseRaw, decimals));

  // Respect prefers-reduced-motion: the number still updates from the on-chain poll, it just
  // stops animating every frame. A continuously-churning balance is precisely the kind of motion
  // that triggers vestibular discomfort.
  const reduceMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    const anchor = anchorAt ?? Date.now();
    const periodMs = periodSecs * 1000n;
    let raf = 0;
    const tick = () => {
      const elapsedMs = BigInt(Math.max(0, Date.now() - anchor));
      const accrued =
        active && periodMs > 0n ? (rateRaw * elapsedMs) / periodMs : 0n;
      setDisplay(formatUsdc(baseRaw + accrued, decimals));
      if (active && !reduceMotion) raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [baseRaw, rateRaw, periodSecs, anchorAt, active, decimals, reduceMotion]);

  const [intPart, fracFull] = display.split(".");
  const fracPart = (fracFull ?? "").slice(0, fracDigits);

  return (
    <span className="sweem-mono inline-flex items-baseline">
      <span>{Number(intPart).toLocaleString("en-US")}</span>
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
