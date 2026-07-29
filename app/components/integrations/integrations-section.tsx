import Image from "next/image";
import { Reveal } from "@/components/motion/reveal";
import { InfiniteMovingCards, type MarqueeItem } from "@/components/ui/aceternity/infinite-moving-cards";
import { cn } from "@/lib/utils";

const BASE = "/protocols/lending";
const USDC = `${BASE}/usd-coin-usdc-logo.png`;

// Circular icon mark + wordmark text.
function Mark({ src, label }: { src: string; label: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <Image
        src={src}
        alt=""
        width={24}
        height={24}
        className={cn("size-6 shrink-0 rounded-full bg-white object-cover")}
      />
      <span className="whitespace-nowrap text-[15px] font-medium text-[#344054]">{label}</span>
    </div>
  );
}

// Text-only lockup for parts of the Circle stack without a bundled mark.
function Wordmark({ label }: { label: string }) {
  return (
    <span className="whitespace-nowrap text-[15px] font-medium text-[#344054] opacity-80">{label}</span>
  );
}

const ecosystem: MarqueeItem[] = [
  { name: "Arc", node: <Wordmark label="Arc" /> },
  { name: "USDC", node: <Mark src={USDC} label="USDC" /> },
  { name: "Circle CCTP", node: <Wordmark label="Circle CCTP" /> },
  { name: "Circle", node: <Wordmark label="Circle" /> },
  { name: "Stablecoin Settlement", node: <Wordmark label="Stablecoin Settlement" /> },
  { name: "Cross-Border Payouts", node: <Wordmark label="Cross-Border Payouts" /> },
];

export function IntegrationsSection() {
  return (
    <section className="bg-white py-12">
      <Reveal className="mx-auto w-full max-w-7xl px-6 md:px-12 lg:px-24">
        <p className="mb-8 text-center text-[13px] font-medium text-text-muted">
          Built on Circle&apos;s stablecoin stack
        </p>
        <InfiniteMovingCards items={ecosystem} speed="slow" />
      </Reveal>
    </section>
  );
}
