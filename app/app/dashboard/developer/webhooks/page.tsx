"use client";

import {useState} from "react";
import { useMounted } from "@/components/sweem-ui/use-mounted";
import { createPortal } from "react-dom";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Eye, EyeOff, Plus, Trash2, Webhook, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSweemApi, type Webhook as WebhookRecord } from "@/lib/api";

// Events Magmos can deliver to a merchant endpoint.
const EVENTS = [
  { id: "payment.succeeded", label: "Payment succeeded" },
  { id: "payment.failed", label: "Payment failed" },
  { id: "payment.pending", label: "Payment pending" },
  { id: "payout.completed", label: "Payout completed" },
] as const;

type EventId = (typeof EVENTS)[number]["id"];

interface Endpoint {
  id: string;
  url: string;
  events: EventId[];
  secret: string; // whsec_…
  createdAt: number;
}

const mask = (k: string) => `${k.slice(0, 7)}${"•".repeat(12)}${k.slice(-4)}`;

export default function WebhooksPage() {
  const { address } = useAccount();
  const api = useSweemApi();
  const webhooksQuery = useQuery<WebhookRecord[]>({
    queryKey: ["webhooks", address],
    enabled: !!address,
    queryFn: () => api.listWebhooks(address!),
  });
  // Full signing secrets are returned once at creation; keep them for this
  // session so reveal/copy works. Endpoints loaded from the API show the prefix.
  const [sessionSecrets, setSessionSecrets] = useState<Record<string, string>>({});
  const endpoints: Endpoint[] = (webhooksQuery.data ?? []).map((w) => ({
    id: w.id,
    url: w.url,
    events: (w.events ?? []) as EventId[],
    secret: sessionSecrets[w.id] ?? `${w.secretPrefix ?? "whsec_"}${"•".repeat(24)}`,
    createdAt: Date.parse(w.createdAt) || 0,
  }));

  const [addOpen, setAddOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Endpoint | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [snippetCopied, setSnippetCopied] = useState(false);

  const add = async (url: string, events: EventId[]) => {
    if (!address) return toast.error("Connect a wallet first");
    try {
      const wh = await api.createWebhook(address, {
        url: url.trim(),
        events: events.length ? events : EVENTS.map((x) => x.id),
      });
      if (wh.secret) setSessionSecrets((s) => ({ ...s, [wh.id]: wh.secret! }));
      await webhooksQuery.refetch();
      setAddOpen(false);
      toast.success("Endpoint added");
    } catch {
      toast.error("Could not add endpoint");
    }
  };

  const remove = async (id: string) => {
    if (!address) return;
    try {
      await api.deleteWebhook(address, id);
      await webhooksQuery.refetch();
      toast("Endpoint deleted");
    } catch {
      toast.error("Could not delete endpoint");
    }
    setDeleteTarget(null);
  };

  const copy = async (id: string, value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedId(id);
      toast.success(`${label} copied`);
      setTimeout(() => setCopiedId(null), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  const snippet = `import { verifyWebhook } from "@magmos/sdk/server";

export async function POST(req) {
  const event = verifyWebhook({
    payload: await req.text(),
    signature: req.headers.get("sweem-signature"),
    secret: process.env.SWEEM_WEBHOOK_SECRET,
  });

  if (event.type === "payment.succeeded") {
    // fulfil the order, event.data has { digest, amount, token, payer }
  }
  return Response.json({ received: true });
}`;

  const copySnippet = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setSnippetCopied(true);
      toast.success("Snippet copied");
      setTimeout(() => setSnippetCopied(false), 1400);
    } catch {
      toast.error("Couldn't copy");
    }
  };

  return (
    <div className="dashboard-content mx-auto w-full max-w-3xl pt-7">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Webhooks</h1>
          <p className="mt-1 text-[13.5px] text-[var(--sw-text-muted)]">
            Get notified at your own endpoint when payments succeed, fail, or settle on Arc.
          </p>
        </div>
        {endpoints.length > 0 && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--sw-mint)] px-4 text-[13.5px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
          >
            <Plus className="size-4" strokeWidth={2.6} />
            Add endpoint
          </button>
        )}
      </div>

      {/* List */}
      <div className="mt-6">
        {endpoints.length === 0 ? (
          <div className="rounded-[22px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-mint)]">
                <Webhook className="size-[18px]" strokeWidth={2} />
              </span>
              <p className="text-[15px] font-semibold text-[var(--sw-text)]">Add your first webhook endpoint</p>
            </div>
            <p className="mt-3 text-[13px] leading-relaxed text-[var(--sw-text-muted)]">
              Magmos will POST a signed event to your URL whenever a payment changes state, so your
              backend can fulfil orders automatically.
            </p>
            <button
              type="button"
              onClick={() => setAddOpen(true)}
              className="mt-5 flex w-full items-center justify-center gap-1.5 rounded-2xl bg-[var(--sw-mint)] py-3 text-[14px] font-semibold text-black transition-colors hover:bg-[#cef77f]"
            >
              <Plus className="size-4" strokeWidth={2.6} />
              Add endpoint
            </button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2.5">
            {endpoints.map((e) => {
              const show = revealed[e.id];
              return (
                <li key={e.id} className="rounded-[16px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--sw-card-inset)] text-[var(--sw-mint)]">
                      <Webhook className="size-[18px]" strokeWidth={2} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-[13.5px] text-[var(--sw-text)]">{e.url}</p>
                      <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-[var(--sw-text-dim)]">
                        <span className="inline-flex items-center gap-1 text-[var(--sw-mint)]">
                          <span className="size-1.5 rounded-full bg-[var(--sw-mint)]" />
                          Active
                        </span>
                        · {e.events.length} event{e.events.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <IconBtn title="Delete" danger onClick={() => setDeleteTarget(e)}>
                      <Trash2 className="size-4" />
                    </IconBtn>
                  </div>

                  {/* Events */}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {e.events.map((ev) => (
                      <span
                        key={ev}
                        className="rounded-md bg-[var(--sw-card-inset)] px-2 py-0.5 font-mono text-[11px] text-[var(--sw-text-muted)]"
                      >
                        {ev}
                      </span>
                    ))}
                  </div>

                  {/* Signing secret */}
                  <div className="mt-3 flex items-center gap-2 rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3 py-2">
                    <span className="text-[11px] font-medium text-[var(--sw-text-dim)]">Signing secret</span>
                    <code className="flex-1 truncate font-mono text-[12.5px] text-[var(--sw-text-muted)]">
                      {show ? e.secret : mask(e.secret)}
                    </code>
                    <IconBtn title={show ? "Hide" : "Reveal"} onClick={() => setRevealed((r) => ({ ...r, [e.id]: !r[e.id] }))}>
                      {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </IconBtn>
                    <IconBtn title="Copy" onClick={() => copy(e.id, e.secret, "Signing secret")}>
                      {copiedId === e.id ? <Check className="size-4" /> : <Copy className="size-4" />}
                    </IconBtn>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Usage hint */}
      <div className="mt-8 rounded-[20px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-5">
        <p className="text-[13px] font-semibold text-[var(--sw-text)]">Verify &amp; handle events</p>
        <div className="relative mt-3">
          <button
            type="button"
            onClick={copySnippet}
            title="Copy snippet"
            className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
          >
            {snippetCopied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
          <pre
            onClick={copySnippet}
            className="cursor-pointer overflow-x-auto rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] p-4 pr-12 text-[12.5px] leading-relaxed text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)]"
          >
            <code>{snippet}</code>
          </pre>
        </div>
      </div>

      <AddEndpointModal open={addOpen} onClose={() => setAddOpen(false)} onAdd={add} />
      <ConfirmDeleteModal target={deleteTarget} onClose={() => setDeleteTarget(null)} onConfirm={() => deleteTarget && remove(deleteTarget.id)} />
    </div>
  );
}

function AddEndpointModal({
  open,
  onClose,
  onAdd,
}: {
  open: boolean;
  onClose: () => void;
  onAdd: (url: string, events: EventId[]) => void;
}) {
  const mounted = useMounted();
  const [url, setUrl] = useState("");
  const [selected, setSelected] = useState<EventId[]>(EVENTS.map((e) => e.id));

  // Clear the form each time the modal is (re)opened — adjusted during render rather than in an
  // effect, which cascaded a second render pass on every open.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUrl("");
      setSelected(EVENTS.map((e) => e.id));
    }
  }

  if (!mounted || !open) return null;
  const valid = /^https?:\/\/.+/.test(url.trim());
  const toggle = (id: EventId) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  return createPortal(
    <div className="sw-dash fixed inset-0 z-50 flex items-center justify-center p-4 text-[var(--sw-text)]">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-[460px] rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Add endpoint</h2>
            <p className="mt-1 text-[13px] text-[var(--sw-text-muted)]">Where Magmos should POST event payloads.</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]">
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <label className="mt-5 block text-[12.5px] font-medium text-[var(--sw-text-muted)]">Endpoint URL</label>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://api.yoursite.com/webhooks/magmos"
          className="mt-2 h-11 w-full rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 font-mono text-[13.5px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]"
        />

        <p className="mt-5 text-[12.5px] font-medium text-[var(--sw-text-muted)]">Events to send</p>
        <div className="mt-2 flex flex-col gap-1.5">
          {EVENTS.map((ev) => {
            const on = selected.includes(ev.id);
            return (
              <button
                key={ev.id}
                type="button"
                onClick={() => toggle(ev.id)}
                className="flex items-center gap-3 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)] px-3 py-2.5 text-left transition-colors hover:border-[var(--sw-border-strong)]"
              >
                <span className={cn("flex size-5 shrink-0 items-center justify-center rounded-md border", on ? "border-[var(--sw-mint)] bg-[var(--sw-mint)] text-black" : "border-[var(--sw-border-strong)]")}>
                  {on && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium text-[var(--sw-text)]">{ev.label}</p>
                  <p className="font-mono text-[11.5px] text-[var(--sw-text-dim)]">{ev.id}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[var(--sw-border)] text-[14px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onAdd(url, selected)}
            disabled={!valid || selected.length === 0}
            className="h-11 flex-1 rounded-xl bg-[var(--sw-mint)] text-[14px] font-semibold text-black transition-colors hover:bg-[#cef77f] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Add endpoint
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function ConfirmDeleteModal({
  target,
  onClose,
  onConfirm,
}: {
  target: Endpoint | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const mounted = useMounted();
  // Re-arm the type-to-confirm box whenever a different endpoint is targeted.
  const [text, setText] = useState("");
  const [prevTarget, setPrevTarget] = useState(target);
  if (prevTarget !== target) {
    setPrevTarget(target);
    setText("");
  }

  if (!mounted || !target) return null;
  const confirmed = text.trim().toLowerCase() === "delete";

  return createPortal(
    <div className="sw-dash fixed inset-0 z-50 flex items-center justify-center p-4 text-[var(--sw-text)]">
      <button aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div role="dialog" aria-modal="true" className="relative z-10 w-full max-w-[420px] rounded-[24px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-6 shadow-[0_40px_100px_-30px_rgba(0,0,0,0.85)]">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-[18px] font-semibold tracking-[-0.02em] text-[var(--sw-text)]">Delete endpoint</h2>
            <p className="mt-1 break-all text-[13px] text-[var(--sw-text-muted)]">
              Magmos will stop sending events to{" "}
              <span className="font-mono text-[var(--sw-text)]">{target.url}</span>.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="flex size-8 shrink-0 items-center justify-center rounded-full text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]">
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>

        <label className="mt-5 block text-[12.5px] text-[var(--sw-text-muted)]">
          Type <span className="font-mono font-semibold text-[var(--sw-text)]">delete</span> to confirm
        </label>
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && confirmed && onConfirm()}
          placeholder="delete"
          className="mt-2 h-11 w-full rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] px-3.5 text-[14px] text-[var(--sw-text)] outline-none transition-colors placeholder:text-[var(--sw-text-dim)] focus:border-[var(--sw-border-strong)]"
        />

        <div className="mt-6 flex gap-3">
          <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl border border-[var(--sw-border)] text-[14px] font-medium text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!confirmed}
            className="h-11 flex-1 rounded-xl bg-[#ef4444] text-[14px] font-semibold text-white transition-colors hover:bg-[#dc2626] disabled:cursor-not-allowed disabled:opacity-40"
          >
            Delete endpoint
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-lg text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)]",
        danger ? "hover:text-[#ef4444]" : "hover:text-[var(--sw-text)]",
      )}
    >
      {children}
    </button>
  );
}
