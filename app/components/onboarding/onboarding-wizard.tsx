"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useSweemApi } from "@/lib/api";
import { Stepper, type StepKey } from "./stepper";
import { ConnectStep } from "./steps/connect-step";
import { DoneStep } from "./steps/done-step";

export type SweemApi = ReturnType<typeof useSweemApi>;

// Minimal 2-step onboarding: connect wallet + name your org → done. (The Sui-era
// CSV import + email-OTP steps were dropped; recipients are added from the
// dashboard's fund flow.)
export function OnboardingWizard() {
  const api = useSweemApi();
  const router = useRouter();
  const wallet = api.address;
  const org = api.orgQuery.data;
  // Resuming: an org that already exists means onboarding is finished. Derived rather than synced
  // from an effect, so there is no render where we show "connect" to an already-onboarded user.
  const [chosenStep, setChosenStep] = useState<StepKey | null>(null);
  const step: StepKey = chosenStep ?? (org ? "done" : "connect");
  const setStep = setChosenStep;

  const finish = () => router.push("/dashboard");

  return (
    <div>
      <div className="mx-auto max-w-2xl">
        <Stepper current={step} />
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
          className="mx-auto max-w-2xl"
        >
          {step === "connect" && (
            <ConnectStep api={api} wallet={wallet} onNext={() => setStep("done")} />
          )}
          {step === "done" && <DoneStep onFinish={finish} />}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
