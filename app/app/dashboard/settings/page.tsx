"use client";

import {useState} from "react";
import { useSeededState } from "@/components/sweem-ui/use-seeded-state";
import { toast } from "sonner";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { DashboardPageShell } from "@/components/dashboard/dashboard-screen";
import { useSweemApi } from "@/lib/api";
import { cn } from "@/lib/utils";

type SectionKey =
  | "account"
  | "business"
  | "branding"
  | "payment-methods"
  | "invoices"
  | "promocodes"
  | "taxes"
  | "team";

const groups: { title: string; items: { key: SectionKey; title: string; description: string; icon: string }[] }[] = [
  {
    title: "General",
    items: [
      { key: "account", title: "Account", description: "Basic info like user details and login details", icon: "user" },
      { key: "business", title: "Business", description: "Update your business details", icon: "store" },
      { key: "branding", title: "Branding", description: "Customise branding like logos & colours", icon: "brush" },
    ],
  },
  {
    title: "Payments",
    items: [
      { key: "payment-methods", title: "Payment methods", description: "Manage payment receiving address", icon: "card" },
      { key: "invoices", title: "Invoices", description: "Manage due dates, memos, footers, etc", icon: "invoice" },
      { key: "promocodes", title: "Promocodes", description: "Manage promocodes based on your requirements", icon: "dollar" },
      { key: "taxes", title: "Taxes", description: "Manage taxes based on your requirements", icon: "dollar" },
    ],
  },
  {
    title: "Team",
    items: [{ key: "team", title: "Team", description: "Manage your team members", icon: "team" }],
  },
];

function SettingsIcon({ icon }: { icon: string }) {
  if (icon === "brush") return <path d="M16.5 4.5 19.5 7.5 9 18H6v-3L16.5 4.5Z" />;
  if (icon === "store") return <path d="M5 10h14l-1-5H6l-1 5Zm2 0v8h10v-8M9 18v-4h6v4" />;
  if (icon === "card") return <path d="M4 7h16v10H4V7Zm0 4h16M8 14h3" />;
  if (icon === "invoice") return <path d="M7 5h10v14l-2-1-2 1-2-1-2 1-2-1V5Zm3 4h4m-4 4h4" />;
  if (icon === "dollar") return <path d="M12 5v14m4-10c-1.5-2-8-2-8 1 0 4 8 1 8 5 0 3-6.5 3-8 1" />;
  if (icon === "team") return <path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm6-1a2.5 2.5 0 1 0 0-5M4 18c.4-3 2.2-4.5 5-4.5s4.6 1.5 5 4.5m1.5-4c2 .3 3.2 1.7 3.5 4" />;
  return <path d="M12 12a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-5 7c.4-3.2 2.1-4.8 5-4.8s4.6 1.6 5 4.8" />;
}

export default function SettingsPage() {
  const [active, setActive] = useState<SectionKey | null>(null);
  const meta = groups.flatMap((g) => g.items).find((i) => i.key === active);

  if (active && meta) {
    return (
      <div className="dashboard-content mx-auto w-full max-w-3xl pt-7">
        <button
          type="button"
          onClick={() => setActive(null)}
          className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
        >
          <ArrowLeft className="size-4" /> Settings
        </button>
        <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">{meta.title}</h1>
        <p className="mt-1 text-[13.5px] text-[var(--sw-text-muted)]">{meta.description}</p>
        <div className="mt-6">
          <SectionDetail section={active} />
        </div>
      </div>
    );
  }

  return (
    <DashboardPageShell
      title="Settings"
      subtitle="Manage your account, payments, and team, all in one place."
    >
      <div className="dashboard-settings">
        {groups.map((group) => (
          <section className="dashboard-settings-group" key={group.title}>
            <h2>{group.title}</h2>
            <div className="dashboard-settings-grid">
              {group.items.map((item) => (
                <button
                  className="dashboard-settings-card"
                  key={item.key}
                  type="button"
                  onClick={() => setActive(item.key)}
                >
                  <span className="dashboard-settings-icon">
                    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <SettingsIcon icon={item.icon} />
                    </svg>
                  </span>
                  <span className="dashboard-settings-copy">
                    <strong>{item.title}</strong>
                    <small>{item.description}</small>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </DashboardPageShell>
  );
}

// ── Detail panels ──────────────────────────────────────────────────────────────

function SectionDetail({ section }: { section: SectionKey }) {
  switch (section) {
    case "account":
      return <AccountSettings />;
    case "business":
      return <BusinessSettings />;
    case "branding":
      return <BrandingSettings />;
    case "payment-methods":
      return <PaymentMethodsSettings />;
    default:
      return <ComingSoon />;
  }
}

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="rounded-2xl border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">{children}</div>;
}

const inputCls =
  "h-11 w-full rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1.5 block text-[12.5px] font-medium text-[var(--sw-text-muted)]">{children}</label>;
}

function SaveButton({ onClick, loading, disabled }: { onClick: () => void; loading?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading || disabled}
      className="rounded-xl bg-[var(--sw-mint)] px-5 py-2.5 text-[13.5px] font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {loading ? "Saving…" : "Save changes"}
    </button>
  );
}

function AddressRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      toast.success("Copied");
      setTimeout(() => setCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 py-2.5">
        <code className="flex-1 truncate font-mono text-[13px] text-[var(--sw-text)]">{value || "Not connected"}</code>
        {value && (
          <button onClick={copy} className="flex size-8 items-center justify-center rounded-lg text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        )}
      </div>
    </div>
  );
}

// Magmos org metadata (see lib/api.ts `Org`) has no logo field yet, so the
// branding logo URL is persisted client-side per wallet. Swap for a backend
// `logoUrl` on the org document when the API grows one.
const logoKey = (wallet?: string) => `magmos:org-logo:${wallet ?? "anon"}`;

function readLogo(wallet?: string): string {
  if (typeof window === "undefined" || !wallet) return "";
  try {
    return window.localStorage.getItem(logoKey(wallet)) ?? "";
  } catch {
    return "";
  }
}

function writeLogo(wallet: string | undefined, url: string) {
  if (typeof window === "undefined" || !wallet) return;
  try {
    if (url) window.localStorage.setItem(logoKey(wallet), url);
    else window.localStorage.removeItem(logoKey(wallet));
  } catch {
    // best-effort; ignore storage failures
  }
}

function AccountSettings() {
  const api = useSweemApi();
  const org = api.orgQuery.data;
  const [name, setName] = useSeededState(org?.name ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    try {
      // Magmos upsert: POST /api/orgs/[wallet] updates name on an existing org.
      await api.ensureOrg(name.trim());
      await api.orgQuery.refetch();
      toast.success("Account updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div>
          <Label>Organization name</Label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" />
        </div>
        <AddressRow label="Wallet address" value={api.address ?? ""} />
        <div>
          <Label>Email</Label>
          <div className="flex items-center gap-2">
            <input className={cn(inputCls, "flex-1")} value={org?.email ?? "Not set"} disabled />
            <span className="rounded-md bg-[var(--sw-card-inset)] px-2 py-1 text-[11px] font-medium text-[var(--sw-text-muted)]">
              Unverified
            </span>
          </div>
        </div>
        <div className="pt-1">
          <SaveButton onClick={save} loading={saving} disabled={!name.trim() || name.trim() === org?.name} />
        </div>
      </div>
    </Panel>
  );
}

function BusinessSettings() {
  const api = useSweemApi();
  const org = api.orgQuery.data;
  const [name, setName] = useSeededState(org?.name ?? "");
  const [logo, setLogo] = useSeededState(readLogo(api.address));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    // Magmos requires a non-empty org name; fall back to the current name.
    const nextName = name.trim() || org?.name;
    if (!nextName) {
      toast.error("Business name is required");
      return;
    }
    setSaving(true);
    try {
      await api.ensureOrg(nextName);
      writeLogo(api.address, logo.trim());
      await api.orgQuery.refetch();
      toast.success("Business details updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div>
          <Label>Business name</Label>
          <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Inc" />
        </div>
        <div>
          <Label>Logo URL</Label>
          <input className={inputCls} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
        </div>
        <div className="pt-1">
          <SaveButton onClick={save} loading={saving} />
        </div>
      </div>
    </Panel>
  );
}

function BrandingSettings() {
  const api = useSweemApi();
  const [logo, setLogo] = useSeededState(readLogo(api.address));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      writeLogo(api.address, logo.trim());
      toast.success("Branding updated");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={logo || "/magmos.png"}
            alt="Logo preview"
            className="size-14 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] object-contain"
            onError={(e) => ((e.target as HTMLImageElement).src = "/magmos.png")}
          />
          <div className="flex-1">
            <Label>Logo URL</Label>
            <input className={inputCls} value={logo} onChange={(e) => setLogo(e.target.value)} placeholder="https://…/logo.png" />
          </div>
        </div>
        <div className="pt-1">
          <SaveButton onClick={save} loading={saving} />
        </div>
      </div>
    </Panel>
  );
}

function PaymentMethodsSettings() {
  const api = useSweemApi();
  return (
    <Panel>
      <div className="flex flex-col gap-4">
        <AddressRow label="Receiving address" value={api.address ?? ""} />
        <p className="text-[12.5px] leading-relaxed text-[var(--sw-text-muted)]">
          Payments from the checkout SDK settle to this wallet by default. To route a specific key to a
          different address, set a custom receiving address when creating an API key under Developer.
        </p>
      </div>
    </Panel>
  );
}

function ComingSoon() {
  return (
    <Panel>
      <p className="text-[14px] font-medium text-[var(--sw-text)]">Coming soon</p>
      <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">
        This section is under construction and will be available soon.
      </p>
    </Panel>
  );
}
