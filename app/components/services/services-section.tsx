import Image from "next/image";
import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";
import { Button } from "@/components/ui/button";
import { StreamMeter } from "@/components/services/stream-meter";
import { cn } from "@/lib/utils";

function ServiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 2a10 10 0 1 0 10 10" strokeLinecap="round" />
      <path d="M22 2l-4 4M22 2h-5M22 2v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tile({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "group flex flex-col rounded-[22px] border border-border bg-surface p-6 transition duration-300",
        "hover:-translate-y-1 hover:border-brand/30 hover:shadow-[0_18px_40px_rgba(4,40,80,0.08)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function TileCopy({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="mt-5">
      <h3 className="text-[16px] font-semibold text-text-primary">{title}</h3>
      <p className="mt-1.5 text-[13px] leading-[1.6] text-text-secondary">{desc}</p>
    </div>
  );
}

const corridors = [
  { name: "Manila", apy: "live", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "Lagos", apy: "live", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "Karachi", apy: "live", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "Mumbai", apy: "live", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
  { name: "São Paulo", apy: "live", logo: "/protocols/lending/usd-coin-usdc-logo.png" },
];

const allocation: { label: string; pct: number; color: string; logo?: string }[] = [
  { label: "Claim to wallet", pct: 55, color: "#ff6a1a" },
  { label: "Bridge home (CCTP)", pct: 45, color: "#ffb43d" },
];

function TrendUp() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden>
      <path d="M4 16l5-5 4 4 7-7M16 8h4v4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ServicesSection() {
  return (
    <Section className="bg-white">
      <SectionHeading
        eyebrow="Core Service"
        eyebrowIcon={<ServiceIcon />}
        title={
          <>
            Pay the world that <span className="text-text-muted">streams in real time</span>
          </>
        }
        description="Fund a USDC pool once and stream salaries and payouts to recipients worldwide by the second on Arc — claimed anytime, bridged home via CCTP."
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* A — feature: real-time streaming (wide) */}
        <Reveal className="md:col-span-2">
          <Tile className="h-full rounded-[28px] bg-surface p-7">
            <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-brand">
              Core engine
            </span>
            <div className="mt-5">
              <StreamMeter />
            </div>
            <TileCopy
              title="Real-Time Streaming"
              desc="USDC accrues every second onchain — no payday, no batch runs, no 3-day wire. Fund the pool once and recipients get paid continuously."
            />
          </Tile>
        </Reveal>

        {/* B — pay anyone, anywhere */}
        <Reveal delay={0.06}>
          <Tile className="h-full justify-between">
            <div className="flex flex-col gap-2">
              {corridors.map((y) => (
                <div
                  key={y.name}
                  className="flex items-center justify-between rounded-xl border border-border bg-white px-3 py-2.5"
                >
                  <span className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
                    <Image
                      src={y.logo}
                      alt=""
                      width={20}
                      height={20}
                      className={cn("size-5 rounded-full bg-white object-cover")}
                    />
                    {y.name}
                  </span>
                  <span className="flex items-center gap-1 text-[13px] font-semibold text-brand">
                    <TrendUp />
                    streaming
                  </span>
                </div>
              ))}
            </div>
            <TileCopy
              title="Pay Anyone, Anywhere"
              desc="Stream USDC to recipients across the globe — every corridor settled per second, no FX desks, no wires."
            />
          </Tile>
        </Reveal>

        {/* C — claim anytime */}
        <Reveal delay={0.12}>
          <Tile className="h-full justify-between">
            <div className="rounded-2xl border border-border bg-white p-4">
              <p className="text-[11px] font-medium uppercase tracking-wider text-text-muted">Claimable</p>
              <p className="mt-1 text-[24px] font-semibold tabular-nums text-text-primary">$1,240.18</p>
              <Button className="mt-3 h-9 w-full rounded-full bg-brand text-white hover:bg-brand/90">
                Claim now
              </Button>
            </div>
            <TileCopy
              title="Claim Anytime"
              desc="Recipients withdraw earned USDC 24/7 — no invoices, no waiting, straight to their wallet in one second."
            />
          </Tile>
        </Reveal>

        {/* D — employee vaults (wide) */}
        <Reveal delay={0.06} className="md:col-span-2">
          <Tile className="h-full justify-between">
            <div className="rounded-2xl border border-border bg-white p-4">
              <div className="flex h-3 overflow-hidden rounded-full">
                {allocation.map((a) => (
                  <div key={a.label} style={{ width: `${a.pct}%`, background: a.color }} />
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
                {allocation.map((a) => (
                  <span key={a.label} className="flex items-center gap-1.5 text-[12px] text-text-secondary">
                    {a.logo ? (
                      <Image
                        src={a.logo}
                        alt=""
                        width={16}
                        height={16}
                        className="size-4 rounded-full object-contain"
                      />
                    ) : (
                      <span className="size-2 rounded-full" style={{ background: a.color }} />
                    )}
                    {a.label}
                    <span className="font-semibold text-text-primary">{a.pct}%</span>
                  </span>
                ))}
              </div>
            </div>
            <TileCopy
              title="Send Home via CCTP"
              desc="Keep claimed USDC in your wallet or bridge it home to your local chain via Circle CCTP — earned in Dubai, spendable at home in minutes."
            />
          </Tile>
        </Reveal>
      </div>
    </Section>
  );
}
