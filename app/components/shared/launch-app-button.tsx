"use client";

import { type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { toast } from "sonner";

// Wallet-aware "Launch app" CTA for the landing page. If a wallet is connected it goes
// straight to /dashboard (which routes unregistered orgs on to /onboarding). Otherwise it
// connects (wagmi injected) and routes once connected.
export function LaunchAppButton({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const router = useRouter();

  const onClick = () => {
    if (isConnected) {
      router.push("/dashboard");
      return;
    }
    const connector = connectors[0];
    if (!connector) {
      toast.error("No wallet found — install MetaMask to continue");
      return;
    }
    // Navigate from the mutation callback rather than from an effect watching `isConnected`. The
    // effect version needed a `pending` flag and called setState inside itself, which cascades
    // renders — and it would also fire if a wallet connected in another tab.
    connect(
      { connector },
      {
        onSuccess: () => router.push("/dashboard"),
        onError: (e) =>
          toast.error((e as { shortMessage?: string }).shortMessage ?? "Could not connect"),
      }
    );
  };

  return (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={isPending}
      aria-busy={isPending}
    >
      {children}
    </button>
  );
}
