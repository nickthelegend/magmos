"use client";

import { useCallback, useState } from "react";
import { useWriteContract, useWaitForTransactionReceipt } from "wagmi";
import { toast } from "sonner";

import { publicClient } from "@/lib/reads";
import { EXPLORER_TX } from "@/lib/magmos";

// Await a write-request config through wagmi and resolve when the receipt lands. Wraps the
// sonner pending→success→error UX in one place so every action reads the same, and surfaces the
// real transaction hash so a recipient can verify any movement of their pay on the explorer.
export function useTxRunner() {
  const { writeContractAsync } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const { isLoading: confirming } = useWaitForTransactionReceipt({ hash });

  const run = useCallback(
    async (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      request: any,
      messages: { pending: string; success: string },
    ): Promise<boolean> => {
      const id = toast.loading(messages.pending);
      try {
        const txHash = await writeContractAsync(request);
        setHash(txHash);
        toast.loading("Waiting for confirmation…", { id });
        await publicClient.waitForTransactionReceipt({ hash: txHash });
        toast.success(messages.success, {
          id,
          description: `Tx ${txHash.slice(0, 12)}…${txHash.slice(-10)}`,
          action: { label: "Receipt", onClick: () => window.open(EXPLORER_TX(txHash), "_blank") },
        });
        return true;
      } catch (e) {
        const msg =
          (e as { shortMessage?: string; message?: string }).shortMessage ??
          (e as Error).message ??
          "Transaction failed";
        toast.error(msg, { id });
        return false;
      } finally {
        setHash(undefined);
      }
    },
    [writeContractAsync],
  );

  return { run, confirming };
}
