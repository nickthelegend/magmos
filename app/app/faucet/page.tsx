"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useAccount, useReadContract, useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { erc20Abi, formatUnits } from "viem";
import { toast } from "sonner";
import { WalletButton } from "@/components/dashboard/wallet-button";
import { faucetMint } from "@/lib/writes";
import { USDC, USDC_DECIMALS, ARC_CHAIN_ID, EXPLORER_TX } from "@/lib/magmos";

// Standalone test-USDC faucet. Uses the global wagmi context (root layout), so it works
// with just a connected wallet — no onboarding required.
export default function FaucetPage() {
  const { address, isConnected, chainId } = useAccount();

  const { data: bal, refetch } = useReadContract({
    address: USDC,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 5000 },
  });

  const { writeContract, data: hash, isPending } = useWriteContract();
  const { isLoading: confirming, isSuccess } = useWaitForTransactionReceipt({ hash });

  useEffect(() => {
    if (isSuccess) {
      toast.success("10,000 test USDC minted");
      refetch();
    }
  }, [isSuccess, refetch]);

  const onFaucet = () => {
    if (!isConnected) return toast.error("Connect your wallet first");
    if (chainId !== ARC_CHAIN_ID) return toast.error("Switch to Arc testnet");
    writeContract(faucetMint(), { onError: (e) => toast.error(e.message.slice(0, 140)) });
  };

  const balance = bal !== undefined ? Number(formatUnits(bal as bigint, USDC_DECIMALS)) : 0;
  const busy = isPending || confirming;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#0a0a0b] px-5 text-[#f4f4f5]">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center justify-between">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            Magmos
          </Link>
          <WalletButton />
        </div>

        <div className="rounded-2xl border border-[#26262b] bg-[#151517] p-7 shadow-[0_8px_40px_rgba(0,0,0,0.5)]">
          <div className="mb-1 inline-flex items-center gap-2 rounded-full border border-[#2a2a2e] bg-[#1a1a1c] px-3 py-1 text-[11px] font-medium text-[#a1a1aa]">
            <span className="size-1.5 rounded-full bg-[#ff6a1a]" />
            Arc testnet · test USDC
          </div>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">Test USDC Faucet</h1>
          <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#a1a1aa]">
            Mint free test USDC to fund payroll and try Magmos end to end. This is a testnet
            token (6-dec, identical to Circle USDC) — for the official run the app can point at
            real USDC on Arc.
          </p>

          <div className="mt-5 rounded-xl border border-[#26262b] bg-[#0f0f11] px-4 py-3.5">
            <div className="text-[11px] uppercase tracking-wide text-[#71717a]">Your balance</div>
            <div className="mt-0.5 font-mono text-[26px] font-semibold tabular-nums">
              {balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}{" "}
              <span className="text-[15px] text-[#a1a1aa]">USDC</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onFaucet}
            disabled={busy || !isConnected}
            className="mt-4 w-full rounded-xl bg-[#ff6a1a] py-3 text-[14px] font-semibold text-black transition-colors hover:bg-[#ff8340] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {!isConnected
              ? "Connect wallet to mint"
              : busy
                ? "Minting…"
                : "Get 10,000 test USDC"}
          </button>

          {isSuccess && hash && (
            <a
              href={EXPLORER_TX(hash)}
              target="_blank"
              rel="noreferrer"
              className="mt-3 block text-center text-[12.5px] text-[#ff6a1a] hover:underline"
            >
              View mint transaction ↗
            </a>
          )}

          <div className="mt-5 rounded-xl border border-[#26262b] bg-[#0f0f11] px-4 py-3 text-[12.5px] leading-relaxed text-[#a1a1aa]">
            <span className="font-medium text-[#f4f4f5]">Need gas?</span> Arc pays gas in native
            USDC. Grab a little from{" "}
            <a
              href="https://faucet.circle.com"
              target="_blank"
              rel="noreferrer"
              className="text-[#ff6a1a] hover:underline"
            >
              Circle&apos;s faucet
            </a>{" "}
            (select Arc testnet) so you can send transactions.
          </div>

          <Link
            href="/dashboard"
            className="mt-4 block text-center text-[13px] font-medium text-[#a1a1aa] transition-colors hover:text-[#f4f4f5]"
          >
            Go to dashboard →
          </Link>
        </div>
      </div>
    </main>
  );
}
