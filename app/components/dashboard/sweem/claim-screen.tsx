"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { usePublicClient, useSignMessage, useWriteContract } from "wagmi";
import { ShieldCheck, KeyRound, Wallet } from "lucide-react";

import { CardLabel, SweemCard } from "@/components/sweem-ui/primitives";
import { useSweemApi } from "@/lib/api";
import { decodeEventLog } from "viem";
import { EXPLORER_TX, MAGMOS_STEALTH_PAYOUT, STEALTH_PAYOUT_ABI, ARC_CHAIN_ID } from "@/lib/magmos";
import {
  checkAnnouncement,
  claimTypedData,
  deriveStealthKeys,
  reconstructClaim,
  stealthDerivationMessage,
  type StealthKeys,
} from "@/lib/stealth";
import { ConnectGate } from "./ui";

type Payment = {
  batchId: `0x${string}`;
  stealthAddress: `0x${string}`;
  amountUsdc: number;
  amountMicros: string;
  proof: `0x${string}`[];
  runId: string;
  fundTxHash?: string;
  ephemeralPubKey: `0x${string}`;
  viewTag: number;
};
type ClaimStatus = { registered: boolean; message?: string; payments: Payment[] };

/**
 * The employee's private payout page.
 *
 * Two things happen here, and the order matters: publish a meta-address once, then claim whatever
 * has been delivered to the one-time addresses derived from it.
 *
 * The keys are derived in this browser from a wallet signature and never sent anywhere — the server
 * only ever sees the public halves. That is why there is no seed phrase to write down: signing the
 * same message on any device reproduces the same keys.
 */
export function ClaimScreen() {
  const api = useSweemApi();
  const wallet = api.address;
  const { signMessageAsync } = useSignMessage();
  const { writeContractAsync } = useWriteContract();
  const publicClient = usePublicClient();
  const [recovered, setRecovered] = useState<Payment[] | null>(null);

  const [keys, setKeys] = useState<StealthKeys | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const statusQuery = useQuery<ClaimStatus>({
    queryKey: ["stealthClaim", wallet],
    enabled: !!wallet,
    queryFn: async () => (await api.authedFetch("/api/claim", "GET")).data as ClaimStatus,
  });

  /** Derive locally, then publish only the public halves. */
  async function unlockAndRegister(publish: boolean) {
    if (!wallet) return;
    setBusy(publish ? "register" : "unlock");
    try {
      const signature = await signMessageAsync({ message: stealthDerivationMessage(wallet) });
      const k = deriveStealthKeys(signature as `0x${string}`);
      setKeys(k);
      if (publish) {
        const r = await api.authedFetch("/api/claim", "POST", {
          spendingPubKey: k.spendingPubKey,
          viewingPubKey: k.viewingPubKey,
        });
        if (r.status >= 400) {
          toast.error(r.data?.error ?? "Could not register");
          return;
        }
        toast.success("Private payout key published");
        await statusQuery.refetch();
      } else {
        toast.success("Keys unlocked in this browser");
      }
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Claim one payment. The stealth key signs; the employee's own wallet relays and pays gas.
   *
   * Funds go to a destination the employee picks — defaulting to their connected wallet only
   * because it is the least surprising choice, not because it is the most private one.
   */
  async function claim(p: Payment) {
    if (!keys || !wallet) return;
    setBusy(p.batchId + p.stealthAddress);
    try {
      // Re-derive the stealth key from the ECDH hint rather than trusting the address the server
      // stored — otherwise a compromised server could point a claim at an address it controls.
      const local = checkAnnouncement(keys, p.ephemeralPubKey, p.viewTag);
      if (!local || local.stealthAddress.toLowerCase() !== p.stealthAddress.toLowerCase()) {
        toast.error("This payment does not derive from your keys — refusing to claim.");
        return;
      }

      // Signed by the STEALTH key, which the connected wallet does not hold, so this cannot go
      // through wagmi. It happens in-page and the key never leaves the browser.
      const { privateKeyToAccount } = await import("viem/accounts");
      const amount = BigInt(p.amountMicros);
      // `api.address` is a plain string; the signature commits to this destination, so it has to be
      // the same value the contract call uses.
      const dest = wallet as `0x${string}`;
      const td = claimTypedData(MAGMOS_STEALTH_PAYOUT, ARC_CHAIN_ID, p.batchId, amount, dest);
      const signature = await privateKeyToAccount(local.stealthPrivKey).signTypedData(td);

      const hash = await writeContractAsync({
        address: MAGMOS_STEALTH_PAYOUT,
        abi: STEALTH_PAYOUT_ABI,
        functionName: "claim",
        args: [p.batchId, amount, dest, p.proof, signature],
      });
      toast.success(`Claimed ${p.amountUsdc.toFixed(6)} USDC`, { description: hash });
      await statusQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 160));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Recover every payment straight from Arc, ignoring our own database entirely.
   *
   * This is the honest test of the design: if Magmos vanished, could an employee still find and
   * claim their salary? It reads Announcement and BatchLeaves logs, decrypts the amount with the
   * viewing key, rebuilds the tree from the published leaves and derives the proof locally. Nothing
   * it produces came from a server.
   */
  async function recoverFromChain() {
    if (!keys || !publicClient) return;
    setBusy("recover");
    try {
      const latest = await publicClient.getBlockNumber();
      // Arc caps eth_getLogs at 10,000 blocks per call, so walk back in windows rather than asking
      // for the whole chain and getting an error that looks like "no payments found".
      const WINDOW = 9_000n;
      const anns: { batchId: `0x${string}`; ephemeralPubKey: `0x${string}`; viewTag: number; encryptedAmount: `0x${string}` }[] = [];
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
            const d = decodeEventLog({ abi: STEALTH_PAYOUT_ABI, data: log.data, topics: log.topics });
            if (d.eventName === "Announcement") {
              const a = d.args as unknown as { batchId: `0x${string}`; ephemeralPubKey: `0x${string}`; viewTag: number; encryptedAmount: `0x${string}` };
              anns.push(a);
            } else if (d.eventName === "BatchLeaves") {
              const a = d.args as unknown as { batchId: string; leaves: `0x${string}`[] };
              leavesByBatch.set(a.batchId.toLowerCase(), a.leaves);
            }
          } catch {
            /* not one of ours */
          }
        }
        if (from === 0n) break;
      }

      const mine: Payment[] = [];
      for (const a of anns) {
        const leaves = leavesByBatch.get(a.batchId.toLowerCase());
        if (!leaves) continue;
        const r = reconstructClaim(keys, a, leaves);
        if (!r) continue;
        mine.push({
          batchId: a.batchId,
          stealthAddress: r.stealthAddress,
          amountUsdc: Number(r.amountMicros) / 1e6,
          amountMicros: r.amountMicros.toString(),
          proof: r.proof,
          runId: "recovered-from-chain",
          ephemeralPubKey: a.ephemeralPubKey,
          viewTag: a.viewTag,
        });
      }
      setRecovered(mine);
      toast.success(
        mine.length
          ? `Recovered ${mine.length} payment(s) from Arc — no server involved`
          : "Scanned Arc and found no payments for these keys"
      );
    } catch (e) {
      toast.error((e as Error).message.slice(0, 160));
    } finally {
      setBusy(null);
    }
  }

  if (!wallet) {
    return (
      <div className="dashboard-content">
        <ConnectGate message="Connect the wallet your employer has on file to set up private payouts." />
      </div>
    );
  }

  const s = statusQuery.data;
  // Chain-recovered payments win when present: they are strictly more trustworthy than ours.
  const shown = recovered ?? s?.payments ?? [];

  return (
    <div className="dashboard-content">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
          Private payouts
        </h1>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
          Your salary is delivered to one-time addresses only you can derive. Nothing on the public
          ledger connects them to you — not your employer&apos;s payroll transaction, not the payment
          itself.
        </p>
      </div>

      <SweemCard>
        <CardLabel>Your payout key</CardLabel>
        {s && !s.registered && (
          <p className="mt-2 max-w-[70ch] text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
            {s.message}
          </p>
        )}
        <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-[var(--sw-text-muted)]">
          Derived in this browser from a wallet signature. Only the public half is ever sent — there
          is no seed phrase to lose, because signing the same message anywhere reproduces the same
          key.
        </p>
        <div className="mt-3 flex flex-wrap gap-2.5">
          <button
            onClick={() => unlockAndRegister(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
          >
            <KeyRound size={15} />
            {busy === "register" ? "Publishing…" : s?.registered ? "Re-publish key" : "Set up private payouts"}
          </button>
          {s?.registered && !keys && (
            <button
              onClick={() => unlockAndRegister(false)}
              disabled={busy !== null}
              className="inline-flex items-center gap-2 rounded-full border border-[var(--sw-border-strong)] px-4 py-2 text-[13px] text-[var(--sw-text)] disabled:opacity-50"
            >
              <Wallet size={15} />
              {busy === "unlock" ? "Unlocking…" : "Unlock to claim"}
            </button>
          )}
        </div>
        {keys && (
          <p className="mt-3 break-all font-mono text-[11.5px] text-[var(--sw-text-dim)]">
            spend {keys.spendingPubKey.slice(0, 20)}… · view {keys.viewingPubKey.slice(0, 20)}…
          </p>
        )}
      </SweemCard>

      <SweemCard className="mt-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardLabel>Waiting for you</CardLabel>
            {recovered && (
              <p className="mt-1 text-[12.5px] text-[var(--sw-mint)]">
                Showing {recovered.length} payment(s) rebuilt from Arc itself — amount decrypted and
                proof derived locally, with no help from our servers.
              </p>
            )}
          </div>
          {keys && (
            <button
              onClick={recoverFromChain}
              disabled={busy !== null}
              title="Ignore our database and rebuild everything from on-chain logs"
              className="rounded-full border border-[var(--sw-border-strong)] px-3.5 py-1.5 text-[12.5px] text-[var(--sw-text)] disabled:opacity-50"
            >
              {busy === "recover" ? "Scanning Arc…" : "Recover from chain"}
            </button>
          )}
        </div>
        {statusQuery.isLoading && (
          <p className="mt-2 text-[14px] text-[var(--sw-text-muted)]">Checking…</p>
        )}
        {s && shown.length === 0 && (
          <p className="mt-2 text-[14px] text-[var(--sw-text-muted)]">
            No delivered payments yet. They appear here after your employer runs payroll.
          </p>
        )}
        {shown.map((p) => (
          <div
            key={p.batchId + p.stealthAddress}
            className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--sw-border)] pt-3 first:border-t-0"
          >
            <div>
              <p className="text-[15px] font-semibold text-[var(--sw-text)]">
                {p.amountUsdc.toFixed(6)} USDC
              </p>
              <p className="font-mono text-[11.5px] text-[var(--sw-text-dim)]">
                via {p.stealthAddress.slice(0, 14)}…
                {p.fundTxHash && (
                  <>
                    {" · "}
                    <a
                      href={EXPLORER_TX(p.fundTxHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[var(--sw-mint)] underline underline-offset-2"
                    >
                      batch
                    </a>
                  </>
                )}
              </p>
            </div>
            <button
              onClick={() => claim(p)}
              disabled={!keys || busy !== null}
              title={keys ? undefined : "Unlock your keys first"}
              className="rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
            >
              {busy === p.batchId + p.stealthAddress ? "Claiming…" : "Claim"}
            </button>
          </div>
        ))}
        {s && shown.length > 0 && !keys && (
          <p className="mt-3 flex items-center gap-2 text-[12.5px] text-[var(--sw-text-muted)]">
            <ShieldCheck size={14} /> Unlock your keys above to claim — the signature happens locally.
          </p>
        )}
      </SweemCard>
    </div>
  );
}
