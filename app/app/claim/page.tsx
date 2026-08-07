import { ClaimScreen } from "@/components/dashboard/sweem/claim-screen";

export const metadata = {
  title: "Private payouts · Magmos",
  description:
    "Claim salary delivered to one-time addresses only you can derive. Keys stay in your browser.",
  // Wallet-gated and excluded in robots.ts, but a shared link should still not be a blank card.
  robots: { index: false, follow: false },
};

export default function Page() {
  return <ClaimScreen />;
}
