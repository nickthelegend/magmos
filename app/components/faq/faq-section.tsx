import { Reveal } from "@/components/motion/reveal";
import { Section } from "@/components/layout/section";
import { SectionHeading } from "@/components/layout/section-heading";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const faqs = [
  {
    q: "How does streaming payroll work?",
    a: "You fund a USDC pool once and set each recipient's rate. Their pay then accrues every second onchain, and they can claim the earned USDC whenever they want — no invoices, no payday.",
  },
  {
    q: "How do recipients get paid across borders?",
    a: "Recipients claim their streamed USDC anytime, then bridge it home to their local chain via Circle CCTP — earned in Dubai, spendable at home in minutes, with no FX desks or wires.",
  },
  {
    q: "Which blockchain does Magmos use?",
    a: "Magmos runs on Arc, Circle's stablecoin L1. USDC is the native gas token, so fees are dollar-denominated and settlement is deterministic and instant.",
  },
  {
    q: "Can recipients claim their pay anytime?",
    a: "Yes — earned USDC is claimable 24/7, there's no payday. Recipients withdraw to their wallet in one second, then keep it or bridge it home via CCTP.",
  },
  {
    q: "How do I pause or stop a stream?",
    a: "From the dashboard you can pause, resume, or stop any individual stream. Paused time is excluded from accrual; stopping returns the remaining USDC to your pool.",
  },
  {
    q: "Why is streaming cheaper than a wire?",
    a: "Fees are transparent and USDC-denominated end to end — no 6% remittance haircut, no correspondent-bank spread. Settlement is per second on Arc instead of 1–3 days.",
  },
  {
    q: "Is Magmos custodial?",
    a: "No. Funds live in onchain USDC pools you control via wallet signatures. Magmos never takes custody of your payroll.",
  },
];

function QuestionIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2.5-2.5 3.5" strokeLinecap="round" />
      <circle cx="12" cy="17.5" r="0.6" fill="currentColor" />
    </svg>
  );
}

export function FaqSection() {
  return (
    <Section id="faq" className="bg-white">
      <SectionHeading
        align="center"
        eyebrow="FAQ"
        eyebrowIcon={<QuestionIcon />}
        title="Frequently Asked Questions"
        description="Everything you need to know about streaming cross-border payroll on Magmos."
      />

      <div className="grid items-start gap-8 lg:grid-cols-[320px_1fr]">
        {/* left */}
        <Reveal>
          <div className="flex flex-col gap-4">
            <div className="grid h-[300px] w-full place-items-center overflow-hidden">
              <div className="relative flex h-full w-full items-center justify-center">
                <div className="pointer-events-none absolute inset-0 rounded-full bg-[radial-gradient(circle,rgba(255, 106, 26, 0.22),transparent_70%)] blur-2xl" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/faq.png" alt="Frequently asked questions" className="relative h-full w-full rounded-[20px] object-contain" />
              </div>
            </div>
            <div className="rounded-[16px] border border-border bg-surface p-5">
              <h3 className="text-[15px] font-semibold text-text-primary">Do you have more questions?</h3>
              <p className="mt-1.5 text-[12px] leading-[1.7] text-text-secondary">
                Our team will answer all your questions. We ensure a quick response.
              </p>
              <Button
                asChild
                size="sm"
                className="mt-4 gap-1.5 rounded-full bg-brand-dark text-white hover:bg-brand-dark/90"
              >
                <a href="mailto:support.sweem@gmail.com">
                  Contact Us
                  <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
                    <path d="M7 17L17 7M17 7H7M17 7v10" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>
              </Button>
            </div>
          </div>
        </Reveal>

        {/* right: accordion */}
        <Reveal delay={0.08}>
          <Accordion type="single" collapsible defaultValue="faq-0" className="space-y-2.5">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={faq.q}
                value={`faq-${index}`}
                className="rounded-[14px] border border-border bg-surface px-6 last:border-b"
              >
                <AccordionTrigger className="gap-4 py-4 text-[16px] font-medium text-text-primary hover:no-underline">
                  <span className="flex items-center gap-5">
                    <span className="shrink-0 text-[14px] font-medium text-text-muted">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {faq.q}
                  </span>
                </AccordionTrigger>
                <AccordionContent className="pl-[42px] text-[13px] leading-[1.7] text-text-secondary">
                  {faq.a}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </Reveal>
      </div>
    </Section>
  );
}
