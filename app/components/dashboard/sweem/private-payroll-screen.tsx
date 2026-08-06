"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Lock, ShieldAlert, ShieldCheck, Sparkles, Download, Terminal } from "lucide-react";

import { CardLabel, IconChip, SweemCard } from "@/components/sweem-ui/primitives";
import { useSweemApi } from "@/lib/api";
import { EXPLORER_TX } from "@/lib/magmos";
import { ActionButton, ConnectGate } from "./ui";

type Decision = "execute" | "approve" | "refuse";

interface Violation {
  code: string;
  severity: "soft" | "hard";
  message: string;
}
interface Verdict {
  decision: Decision;
  totalMicros: string;
  summary: string;
  violations: Violation[];
  isRepeatRun: boolean;
}
interface AgentResponse {
  runId?: string;
  via: "parser" | "groq";
  reply: string;
  verdict?: Verdict;
  lines?: { employee: string; name?: string; amountUsdc: number }[];
  rosterSize: number;
}
interface AuditRow {
  at: string;
  event: string;
  actor: string;
  employee?: string;
  amountUsdc?: number;
  detail: string;
  refs?: Record<string, string>;
}

const EXAMPLES = [
  "run today's payroll",
  "pay just Maya",
  "run payroll with the maximum acceptable bonus",
  "release vested equity",
];

/** The three outcomes are visually distinct because they mean genuinely different things. */
const DECISION_STYLE: Record<Decision, { label: string; cls: string; Icon: typeof ShieldCheck }> = {
  execute: {
    label: "Within every control",
    cls: "border-[rgba(255,106,26,0.28)] bg-[rgba(255,106,26,0.08)] text-[var(--sw-mint)]",
    Icon: ShieldCheck,
  },
  approve: {
    label: "Held for a second signature",
    cls: "border-[rgba(255,180,61,0.3)] bg-[rgba(255,180,61,0.08)] text-[var(--sw-lavender)]",
    Icon: ShieldAlert,
  },
  refuse: {
    label: "Refused outright",
    cls: "border-[rgba(239,68,68,0.32)] bg-[rgba(239,68,68,0.08)] text-[#ef4444]",
    Icon: ShieldAlert,
  },
};

/**
 * Confidential payroll, employer side.
 *
 * The screen is arranged around the one thing that makes this defensible: the agent drafts, but a
 * deterministic gate decides. So the verdict — not the agent's prose — is the loudest element, and
 * a refusal is styled as a different category from a hold rather than a stronger warning.
 */
export function PrivatePayrollScreen() {
  const api = useSweemApi();
  const wallet = api.address;
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AgentResponse | null>(null);

  const auditQuery = useQuery<AuditRow[]>({
    queryKey: ["payrollAudit", wallet],
    enabled: !!wallet,
    refetchInterval: 15000,
    queryFn: async () => {
      const r = await api.authedFetch(`/api/orgs/${wallet}/payroll/audit`, "GET");
      return (r.data ?? []) as AuditRow[];
    },
  });

  async function send(text: string) {
    const cmd = text.trim();
    if (!cmd || !wallet) return;
    setBusy(true);
    try {
      const r = await api.authedFetch(`/api/orgs/${wallet}/payroll`, "POST", { instruction: cmd });
      const data = r.data as AgentResponse;
      setResult(data);
      setInstruction("");
      await auditQuery.refetch();
      if (data.verdict?.decision === "refuse") toast.error(data.verdict.summary);
      else if (data.verdict?.decision === "approve") toast.message("Held for approval", { description: data.verdict.summary });
      else if (data.verdict) toast.success(data.verdict.summary);
    } catch (e) {
      toast.error((e as Error).message.slice(0, 160));
    } finally {
      setBusy(false);
    }
  }

  async function exportCsv() {
    if (!wallet) return;
    try {
      const creds = await api.signAuth();
      const res = await fetch(`/api/orgs/${wallet}/payroll/audit?format=csv`, {
        headers: {
          "x-magmos-address": creds.address,
          "x-magmos-message": creds.message,
          "x-magmos-signature": creds.signature,
        },
      });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `magmos-payroll-audit-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Audit exported");
    } catch (e) {
      toast.error((e as Error).message.slice(0, 140));
    }
  }

  if (!wallet) {
    return (
      <div className="dashboard-content">
        <ConnectGate message="Connect your wallet to run confidential payroll." />
      </div>
    );
  }

  const v = result?.verdict;
  const style = v ? DECISION_STYLE[v.decision] : null;
  const audit = auditQuery.data ?? [];

  return (
    <div className="dashboard-content">
      <div className="mb-6">
        <h1 className="text-[26px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">
          Confidential payroll
        </h1>
        <p className="mt-1 max-w-[70ch] text-[14px] leading-relaxed text-[var(--sw-text-muted)]">
          Pay accrues per second on Arc where anyone can audit it. Settlement goes out sealed — the
          amount and the recipient never touch the public ledger. You keep the complete record.
        </p>
      </div>

      {/* agent console */}
      <SweemCard>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardLabel>Run payroll in plain English</CardLabel>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">
              The agent drafts. A deterministic policy gate decides — it can hold a run for a second
              signature, or refuse one outright that no signature can release.
            </p>
          </div>
          <IconChip>
            <Sparkles size={16} />
          </IconChip>
        </div>

        <form
          className="mt-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void send(instruction);
          }}
        >
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="run today's payroll"
            aria-label="Payroll instruction"
            className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-mint)]/60"
          />
          <ActionButton variant="primary" onClick={() => void send(instruction)} disabled={busy || !instruction.trim()}>
            {busy ? "Drafting…" : "Run"}
          </ActionButton>
        </form>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => void send(ex)}
              disabled={busy}
              className="rounded-full border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-2.5 py-1 text-[12px] text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-mint)]/50 hover:text-[var(--sw-text)] disabled:opacity-50"
            >
              {ex}
            </button>
          ))}
        </div>

        {result && (
          <div className="mt-4">
            <p className="text-[13.5px] leading-relaxed text-[var(--sw-text)]">{result.reply}</p>
            <p className="mt-1 inline-flex items-center gap-1.5 text-[11.5px] text-[var(--sw-text-dim)]">
              <Terminal size={11} />
              routed by {result.via === "groq" ? "Groq (llama-3.3-70b)" : "deterministic parser"} ·{" "}
              {result.rosterSize} recipient{result.rosterSize === 1 ? "" : "s"} on the roster
            </p>
          </div>
        )}
      </SweemCard>

      {/* the verdict — louder than the agent's prose, on purpose */}
      {v && style && (
        <div className={`mt-4 rounded-[18px] border px-5 py-4 ${style.cls}`}>
          <p className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em]">
            <style.Icon size={15} /> {style.label}
          </p>
          <p className="mt-1.5 text-[14px] leading-relaxed text-[var(--sw-text)]">{v.summary}</p>

          {v.violations.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {v.violations.map((x, i) => (
                <li key={i} className="flex items-start gap-2 text-[12.5px] text-[var(--sw-text-muted)]">
                  <span
                    className={`mt-[3px] inline-block size-1.5 shrink-0 rounded-full ${
                      x.severity === "hard" ? "bg-[#ef4444]" : "bg-[var(--sw-lavender)]"
                    }`}
                  />
                  <span>
                    {x.message}
                    <span className="ml-1.5 text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                      {x.severity}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}

          {v.decision === "refuse" && (
            <p className="mt-3 rounded-[10px] bg-[rgba(0,0,0,0.25)] px-3 py-2 text-[12px] text-[var(--sw-text-muted)]">
              This run is terminal. Approving it is not a permission the interface is withholding —
              the run state machine has no path from refused to settled.
            </p>
          )}

          {result?.lines && result.lines.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[380px] border-collapse text-[13px]">
                <tbody>
                  {result.lines.map((l) => (
                    <tr key={l.employee} className="border-t border-[var(--sw-border)]">
                      <td className="py-2 text-[var(--sw-text)]">{l.name || l.employee}</td>
                      <td className="py-2 text-right tabular-nums text-[var(--sw-text)]">
                        {l.amountUsdc.toFixed(6)}{" "}
                        <span className="text-[11.5px] text-[var(--sw-text-muted)]">USDC</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* audit trail */}
      <SweemCard className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardLabel>Audit trail</CardLabel>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">
              Confidential to the public, complete to you — every run, decision and settlement
              reference. Append-only.
            </p>
          </div>
          <ActionButton onClick={exportCsv} disabled={audit.length === 0}>
            <span className="inline-flex items-center gap-1.5">
              <Download size={14} /> Open the envelope
            </span>
          </ActionButton>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[620px] border-collapse">
            <thead>
              <tr className="border-b border-[var(--sw-border)] text-left text-[11px] uppercase tracking-wide text-[var(--sw-text-dim)]">
                <th className="pb-2.5 font-medium">When</th>
                <th className="pb-2.5 font-medium">Event</th>
                <th className="pb-2.5 font-medium">Detail</th>
                <th className="pb-2.5 text-right font-medium">Amount</th>
                <th className="pb-2.5 text-right font-medium">Seal</th>
              </tr>
            </thead>
            <tbody>
              {audit.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-[13px] text-[var(--sw-text-muted)]">
                    No runs yet — try “run today&apos;s payroll” above.
                  </td>
                </tr>
              )}
              {audit.map((r, i) => {
                const hash = Object.values(r.refs ?? {}).find((x) => /^0x[0-9a-f]{64}$/i.test(x));
                return (
                  <tr key={i} className="border-b border-[var(--sw-border)] last:border-0">
                    <td className="py-3 text-[12.5px] text-[var(--sw-text-muted)]">
                      {new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className="py-3">
                      <span className="rounded-full bg-[var(--sw-card-inset)] px-2 py-0.5 font-mono text-[11.5px] text-[var(--sw-text-muted)]">
                        {r.event}
                      </span>
                    </td>
                    <td className="max-w-[380px] py-3 text-[12.5px] text-[var(--sw-text)]">{r.detail}</td>
                    <td className="py-3 text-right tabular-nums text-[12.5px] text-[var(--sw-text)]">
                      {r.amountUsdc !== undefined ? r.amountUsdc.toFixed(6) : "—"}
                    </td>
                    <td className="py-3 text-right">
                      {hash ? (
                        <a
                          href={EXPLORER_TX(hash as `0x${string}`)}
                          target="_blank"
                          rel="noreferrer"
                          title="Settlement is public; the payout it delivers is not."
                          className="inline-flex items-center gap-1 text-[12px] text-[var(--sw-text-muted)] underline decoration-dotted underline-offset-2 transition-colors hover:text-[var(--sw-mint)]"
                        >
                          <Lock size={11} /> receipt
                        </a>
                      ) : (
                        <span className="text-[12px] text-[var(--sw-text-dim)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </SweemCard>
    </div>
  );
}
