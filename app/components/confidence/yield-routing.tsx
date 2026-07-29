"use client";

import Image from "next/image";
import {createRef, forwardRef, useRef, useMemo } from "react";
import { AnimatedBeam } from "@/components/ui/animated-beam";
import { cn } from "@/lib/utils";

const ORANGE = "#ff6a1a";
const AMBER = "#ffb43d";

// Distributed workforce — each gets streamed USDC from the pool.
const EMPLOYEES = [
  { name: "Manila", color: ORANGE },
  { name: "Lagos", color: AMBER },
  { name: "Karachi", color: ORANGE },
];

// Local chains recipients bridge their USDC home to via CCTP.
const PROTOCOLS = [
  { name: "Bridge home · CCTP", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "Claim to wallet", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "Save in USDC", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
];

const Node = forwardRef<
  HTMLDivElement,
  { className?: string; children: React.ReactNode; size?: "md" | "lg" }
>(({ className, children, size = "md" }, ref) => (
  <div
    ref={ref}
    className={cn(
      "z-10 flex items-center justify-center rounded-full border border-white/10 bg-white/[0.06] backdrop-blur-md",
      "shadow-[0_4px_20px_rgba(0,0,0,0.35)]",
      size === "lg" ? "size-16" : "size-11",
      className,
    )}
  >
    {children}
  </div>
));
Node.displayName = "Node";

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {children}
      <span className="text-[11px] font-medium text-white/55">{label}</span>
    </div>
  );
}

function UserIcon({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke={color} strokeWidth="1.9" aria-hidden>
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 19.5a6.5 6.5 0 0 1 13 0" strokeLinecap="round" />
    </svg>
  );
}

export function YieldRouting() {
  const containerRef = useRef<HTMLDivElement>(null);
  const poolRef = useRef<HTMLDivElement>(null);
  // Held in a memo, not a ref: `AnimatedBeam` needs these during render, and reading
  // `someRef.current` in the render phase is exactly what React forbids. The createRef objects
  // themselves are still stable across renders, which is all the beams require.
  const empRefs = useMemo(() => EMPLOYEES.map(() => createRef<HTMLDivElement>()), []);
  const protoRefs = useMemo(() => PROTOCOLS.map(() => createRef<HTMLDivElement>()), []);

  const mid = (EMPLOYEES.length - 1) / 2;
  const protoMid = (PROTOCOLS.length - 1) / 2;

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 flex items-stretch justify-between overflow-hidden bg-[#131316] px-6 md:px-12"
    >
      {/* left — recipients (USDC streamed to each) */}
      <div className="z-10 flex flex-col justify-center gap-6">
        {EMPLOYEES.map((e, i) => (
          <Labeled key={i} label={e.name}>
            <Node ref={empRefs[i]}>
              <UserIcon color={e.color} />
            </Node>
          </Labeled>
        ))}
      </div>

      {/* center — payroll pool */}
      <div className="z-10 flex flex-col justify-center">
        <Labeled label="Payroll pool">
          <Node ref={poolRef} size="lg">
            <Image
              src="/protocols/lending/usd-coin-usdc-logo.png"
              alt="USDC"
              width={36}
              height={36}
              className="size-9"
            />
          </Node>
        </Labeled>
      </div>

      {/* right — cash-out options (claimed USDC routed out) */}
      <div className="z-10 flex flex-col justify-center gap-4">
        {PROTOCOLS.map((p, i) => (
          <Labeled key={p.name} label={p.name}>
            <Node ref={protoRefs[i]} className="size-10">
              <Image
                src={p.logo}
                alt=""
                width={32}
                height={32}
                className={cn("size-8 rounded-full bg-white object-cover")}
              />
            </Node>
          </Labeled>
        ))}
      </div>

      {/* USDC streams: recipients → pool (unidirectional, left → right) */}
      {EMPLOYEES.map((_, i) => (
        <AnimatedBeam
          key={i}
          containerRef={containerRef}
          fromRef={empRefs[i]}
          toRef={poolRef}
          curvature={(mid - i) * 12}
          duration={4}
          delay={i * 0.25}
          pathColor="#ffffff"
          pathOpacity={0.08}
          gradientStartColor={ORANGE}
          gradientStopColor={AMBER}
        />
      ))}

      {/* claimed USDC routed: pool → cash-out options (left → right) */}
      {PROTOCOLS.map((_, i) => (
        <AnimatedBeam
          key={i}
          containerRef={containerRef}
          fromRef={poolRef}
          toRef={protoRefs[i]}
          curvature={(protoMid - i) * 14}
          duration={4}
          delay={0.4 + i * 0.2}
          pathColor="#ffffff"
          pathOpacity={0.08}
          gradientStartColor={ORANGE}
          gradientStopColor={AMBER}
        />
      ))}
    </div>
  );
}
