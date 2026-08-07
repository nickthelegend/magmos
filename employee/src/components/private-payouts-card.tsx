"use client";

import { useState } from "react";
import { useAccount, usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { decodeEventLog } from "viem";

import {
  ARC_CHAIN_ID,
  MAGMOS_STEALTH_PAYOUT,
  STEALTH_PAYOUT_ABI,
} from "@/lib/magmos";
import {
  claimTypedData,
  deriveStealthKeys,
  reconstructClaim,
  stealthDerivationMessage,
  type StealthKeys,
} from "@/lib/stealth";

type Found = {
  batchId: `0x${string}`;
  stealthAddress: `0x${string}`;
  amountMicros: bigint;
  proof: `0x${string}`[];
  /**
   * The spending key for this one payment, derived during the scan.
   *
   * In memory only, for this tab, and never sent anywhere — it has to be here because the claim is
   * signed by this key rather than by the connected wallet, and re-deriving it would mean asking
   * the user to sign again for every claim.
   */
  stealthPrivKey: `0x${string}`;
};

/**
 * Private payouts, worker side — entirely from the chain.
 *
 * The portal has no backend of its own and this card deliberately keeps it that way. Everything it
 * needs is in Arc's logs: the announcements that hint at a payment, and the published leaves that
 * let a recipient rebuild the Merkle tree. Nothing here asks Magmos for permission or for data, so
 * a worker can be paid confidentially even if the employer's dashboard is offline.
 *
 * Keys are derived in this browser from a wallet signature and are never sent anywhere. There is no
 * seed phrase to write down — signing the same message on another device reproduces them.
 */
export function PrivatePayoutsCard() {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();

  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [found, setFound] = useState<Found[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function unlockAndScan() {
    if (!address || !publicClient) return;
    setBusy("scan");
    setError(null);
    try {
      const sig = await signMessageAsync({ message: stealthDerivationMessage(address) });
      const k = deriveStealthKeys(sig as `0x${string}`);
      setKeys(k);

      const latest = await publicClient.getBlockNumber();
      // Arc caps eth_getLogs at 10,000 blocks. Asking for the whole chain returns an error that
      // would surface to a worker as "you have no payments" — the worst way to be wrong here.
      const WINDOW = 9_000n;
      const anns: {
        batchId: `0x${string}`;
        ephemeralPubKey: `0x${string}`;
        viewTag: number;
        encryptedAmount: `0x${string}`;
      }[] = [];
      const leavesByBatch = new Map<string, `0x${string}`[]>();

      for (let i = 0n; i < 12n; i++) {
        const to = latest - i * WINDOW;
        const from = to > WINDOW ? to - WINDOW : 0n;
        const logs = await publicClient.getLogs({
          address: MAGMOS_STEALTH_PAYOUT,
          fromBlock: from,
          toBlock: to,
        });
        for (const log of logs) {
          try {
            const d = decodeEventLog({
              abi: STEALTH_PAYOUT_ABI,
              data: log.data,
              topics: log.topics,
            });
            if (d.eventName === "Announcement") {
              anns.push(d.args as never);
            } else if (d.eventName === "BatchLeaves") {
              const a = d.args as unknown as { batchId: string; leaves: `0x${string}`[] };
              leavesByBatch.set(a.batchId.toLowerCase(), a.leaves);
            }
          } catch {
            /* someone else's event */
          }
        }
        if (from === 0n) break;
      }

      const mine: Found[] = [];
      for (const a of anns) {
        const leaves = leavesByBatch.get(a.batchId.toLowerCase());
        if (!leaves) continue;
        const r = reconstructClaim(k, a, leaves);
        if (!r) continue;
        // Skip anything already taken — the contract would revert, and showing it as claimable is a
        // worse experience than not showing it at all.
        const already = await publicClient.readContract({
          address: MAGMOS_STEALTH_PAYOUT,
          abi: STEALTH_PAYOUT_ABI,
          functionName: "isClaimed",
          args: [a.batchId, r.stealthAddress, r.amountMicros],
        });
        if (already) continue;
        mine.push({
          batchId: a.batchId,
          stealthAddress: r.stealthAddress,
          amountMicros: r.amountMicros,
          proof: r.proof,
          stealthPrivKey: r.stealthPrivKey,
        });
      }
      setFound(mine);
    } catch (e) {
      setError((e as Error).message.slice(0, 180));
    } finally {
      setBusy(null);
    }
  }

  async function claim(f: Found) {
    if (!keys || !address) return;
    setBusy(f.batchId + f.stealthAddress);
    setError(null);
    try {
      // Signed by the STEALTH key, not the connected wallet — so this cannot go through wagmi. The
      // signature commits to `address`, so nobody relaying it can redirect the money.
      const { privateKeyToAccount } = await import("viem/accounts");
      const td = claimTypedData(
        MAGMOS_STEALTH_PAYOUT,
        ARC_CHAIN_ID,
        f.batchId,
        f.amountMicros,
        address
      );
      const signature = await privateKeyToAccount(f.stealthPrivKey).signTypedData(td);

      await writeContractAsync({
        address: MAGMOS_STEALTH_PAYOUT,
        abi: STEALTH_PAYOUT_ABI,
        functionName: "claim",
        args: [f.batchId, f.amountMicros, address, f.proof, signature],
      });
      setFound((prev) => (prev ?? []).filter((x) => x.stealthAddress !== f.stealthAddress));
    } catch (e) {
      setError((e as Error).message.slice(0, 180));
    } finally {
      setBusy(null);
    }
  }

  if (!address) return null;

  return (
    <section className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-white">Private payouts</h2>
          <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-white/60">
            Salary sent to one-time addresses only you can derive. Found by reading Arc directly —
            your employer&apos;s server is not involved, and your keys never leave this browser.
          </p>
        </div>
        <button
          onClick={unlockAndScan}
          disabled={busy !== null}
          className="rounded-full bg-[#FF6A1A] px-4 py-2 text-[13px] font-semibold text-black disabled:opacity-50"
        >
          {busy === "scan" ? "Scanning Arc…" : keys ? "Rescan" : "Find my payouts"}
        </button>
      </div>

      {error && <p className="mt-3 text-[12.5px] text-[#f87171]">{error}</p>}

      {found && found.length === 0 && (
        <p className="mt-3 text-[13px] text-white/60">
          Nothing unclaimed right now. If you expect a payment, your employer may not have run
          payroll yet — or you may not have registered a payout key with them.
        </p>
      )}

      {found?.map((f) => (
        <div
          key={f.batchId + f.stealthAddress}
          className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-3"
        >
          <div>
            <p className="text-[15px] font-semibold text-white">
              {(Number(f.amountMicros) / 1e6).toFixed(6)} USDC
            </p>
            <p className="font-mono text-[11.5px] text-white/40">
              via {f.stealthAddress.slice(0, 16)}…
            </p>
          </div>
          <button
            onClick={() => claim(f)}
            disabled={busy !== null}
            className="rounded-full bg-[#FF6A1A] px-4 py-2 text-[13px] font-semibold text-black disabled:opacity-50"
          >
            {busy === f.batchId + f.stealthAddress ? "Claiming…" : "Claim"}
          </button>
        </div>
      ))}
    </section>
  );
}
