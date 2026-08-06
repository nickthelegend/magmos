"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ShieldCheck, Copy, KeyRound } from "lucide-react";

import { CardLabel, SweemCard } from "@/components/sweem-ui/primitives";
import { useSweemApi } from "@/lib/api";
import { ConnectGate } from "./ui";

type ClaimStatus = {
  hasAddress: boolean;
  sealedTo?: string;
  claimed?: boolean;
  phraseAvailable?: boolean;
  message?: string;
};

/**
 * Claim your private payout address.
 *
 * The screen is built around one irreversible moment, so it is honest about it before and after:
 * the phrase is shown exactly once and is already gone from the server when it appears.
 */
export function ClaimScreen() {
  const api = useSweemApi();
  const wallet = api.address;
  const [revealed, setRevealed] = useState<{ sealedTo: string; mnemonic: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const statusQuery = useQuery<ClaimStatus>({
    queryKey: ["sealedClaim", wallet],
    enabled: !!wallet,
    queryFn: async () => (await api.authedFetch("/api/claim", "GET")).data as ClaimStatus,
  });

  async function claim() {
    setBusy(true);
    try {
      const r = await api.authedFetch("/api/claim", "POST", {});
      if (r.status >= 400) {
        toast.error(r.data?.error ?? "Could not claim");
        void statusQuery.refetch();
        return;
      }
      setRevealed({ sealedTo: r.data.sealedTo, mnemonic: r.data.mnemonic });
      void statusQuery.refetch();
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    } finally {
      setBusy(false);
    }
  }

  if (!wallet) {
    return (
      <div className="dashboard-content">
        <ConnectGate message="Connect the wallet your employer has on file to claim your private payout address." />
      </div>
    );
  }

  const s = statusQuery.data;

  return (
    <div className="dashboard-content">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
          Your private payout address
        </h1>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
          Salary arrives here sealed — the amount and your identity never touch the public ledger.
          Claiming takes the recovery phrase out of your employer&apos;s hands and puts it in yours.
        </p>
      </div>

      {statusQuery.isLoading && (
        <SweemCard>
          <p className="text-[14px] text-[var(--sw-text-muted)]">Checking…</p>
        </SweemCard>
      )}

      {s && !s.hasAddress && (
        <SweemCard>
          <CardLabel>Nothing provisioned yet</CardLabel>
          <p className="mt-2 text-[14px] leading-relaxed text-[var(--sw-text-muted)]">{s.message}</p>
        </SweemCard>
      )}

      {s?.hasAddress && (
        <SweemCard>
          <CardLabel>Sealed payout address</CardLabel>
          <p className="mt-2 break-all font-mono text-[13px] text-[var(--sw-text)]">{s.sealedTo}</p>

          {/* Already claimed: say plainly that it cannot be shown again, rather than hiding the button
              and leaving the employee wondering where it went. */}
          {s.claimed && !revealed && (
            <p className="mt-4 rounded-[10px] border border-[rgba(255,180,61,0.3)] bg-[rgba(255,180,61,0.08)] px-3.5 py-3 text-[13px] text-[var(--sw-text-muted)]">
              You already claimed this phrase. It was shown once and deleted from our database — we
              cannot show it again. If you lost it, ask your employer to provision a new address.
            </p>
          )}

          {s.phraseAvailable && !revealed && (
            <div className="mt-4 border-t border-[var(--sw-border)] pt-4">
              <p className="text-[13px] leading-relaxed text-[var(--sw-text-muted)]">
                Your recovery phrase is still held server-side, which means your employer could in
                principle spend this balance. Claiming shows it to you once and deletes it — after
                that, only you can spend it. Be somewhere you can write it down.
              </p>
              <button
                onClick={claim}
                disabled={busy}
                className="mt-3 inline-flex items-center gap-2 rounded-full bg-[var(--sw-mint)] px-4 py-2 text-[13px] font-semibold text-black transition hover:opacity-90 disabled:opacity-50"
              >
                <KeyRound size={15} />
                {busy ? "Claiming…" : "Show my phrase once"}
              </button>
            </div>
          )}

          {revealed && (
            <div className="mt-4 rounded-[14px] border border-[rgba(255,106,26,0.3)] bg-[rgba(255,106,26,0.07)] p-4">
              <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--sw-mint)]">
                <ShieldCheck size={15} /> Write this down now
              </p>
              <p className="mt-2 select-all break-words font-mono text-[14px] leading-relaxed text-[var(--sw-text)]">
                {revealed.mnemonic}
              </p>
              <button
                onClick={() => {
                  void navigator.clipboard.writeText(revealed.mnemonic);
                  toast.success("Copied — store it somewhere safe");
                }}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-[var(--sw-border-strong)] px-3.5 py-1.5 text-[12.5px] text-[var(--sw-text)]"
              >
                <Copy size={13} /> Copy
              </button>
              <p className="mt-3 text-[12px] text-[var(--sw-text-muted)]">
                This phrase is already deleted from our database. Reloading this page will not bring
                it back.
              </p>
            </div>
          )}
        </SweemCard>
      )}
    </div>
  );
}
