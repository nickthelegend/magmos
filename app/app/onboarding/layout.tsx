import { RequireWallet } from "@/components/dashboard/require-wallet";
import { OnboardingChrome } from "@/components/onboarding/onboarding-chrome";

// Wallet/react-query providers live in the root layout (global). Onboarding has
// its own minimal chrome (no org sidebar); disconnected visitors are bounced to
// `/` (landing) by RequireWallet.
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <RequireWallet>
        <OnboardingChrome>{children}</OnboardingChrome>
      </RequireWallet>
    </>
  );
}
