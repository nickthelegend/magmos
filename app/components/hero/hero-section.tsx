import Image from "next/image";
import { Navbar } from "@/components/layout/navbar";
import { LaunchAppButton } from "@/components/shared/launch-app-button";
import { SpotlightNew } from "@/components/ui/aceternity/spotlight-new";
import { BackgroundRippleEffect } from "@/components/ui/background-ripple-effect";

export function HeroSection() {
  return (
    <section
      id="home"
      className="hero-bg relative overflow-hidden px-6 pb-10 pt-28 text-white md:px-12 lg:px-24"
    >
      {/* spotlight beams — subtle orange + gold */}
      <SpotlightNew />
      {/* interactive ripple grid at the top — softened + radially masked so it
          blends into the dark hero */}
      <BackgroundRippleEffect
        rows={6}
        className="z-0 opacity-70 [mask-image:radial-gradient(125%_85%_at_50%_0%,black_0%,black_38%,transparent_78%)] [--cell-border-color:rgba(255,255,255,0.06)] [--cell-fill-color:rgba(255,106,26,0.05)] [--cell-shadow-color:rgba(255,106,26,0.4)]"
      />
      {/* ground the dashboard image + fade the hero base into the next section
          (#1a1a1c) so there's no hard seam below */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-transparent via-transparent to-[#1a1a1c]"
      />

      <Navbar />

      <div className="hero-copy relative z-10 mx-auto flex max-w-3xl flex-col items-center text-center">
        <h1 className="text-[62px] font-medium leading-[1.05] tracking-[-0.025em] md:text-[82px]">
          Payroll that arrives
          <br />
          every second.
        </h1>

        <p className="mt-5 max-w-[470px] text-[14px] leading-6 text-white/70 md:text-[15px]">
          Stream USDC to anyone, anywhere — settled per second on Arc,
          claimed anytime, bridged home via Circle CCTP.
        </p>

        <div className="mt-8 flex items-center gap-3">
          <LaunchAppButton className="rounded-full bg-[#ff6a1a] px-6 py-3 text-[14px] font-semibold text-[#0a0c10]">
            Launch Dashboard
          </LaunchAppButton>
        </div>
      </div>

      <div className="relative z-10 mx-auto mt-14 w-full max-w-5xl">
        {/* The hero screenshot is the LCP element, so it is served through next/image with
            `priority`: optimized formats, no lazy-load delay, and no layout shift. */}
        <Image
          src="/magmos-dashboard.png"
          alt="Magmos dashboard — live cross-border payroll streaming"
          width={1440}
          height={900}
          priority
          sizes="(max-width: 1024px) 100vw, 1024px"
          className="w-full rounded-[18px] [mask-image:linear-gradient(to_bottom,black_0%,black_34%,transparent_82%)]"
        />
      </div>
    </section>
  );
}
