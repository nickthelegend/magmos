"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Click-to-copy code block used across the developer docs.
export function CodeBlock({ code, className }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard unavailable */
    }
  };
  return (
    <div className={cn("relative mt-3", className)}>
      <button
        type="button"
        onClick={copy}
        title="Copy"
        className="absolute right-3 top-3 z-10 flex size-8 items-center justify-center rounded-lg border border-[var(--sw-border)] bg-[var(--sw-card-inset)] text-[var(--sw-text-muted)] transition-colors hover:text-[var(--sw-text)]"
      >
        {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
      </button>
      <pre
        onClick={copy}
        className="cursor-pointer overflow-x-auto rounded-xl border border-[var(--sw-border)] bg-[#1b1b1f] p-4 pr-12 text-[12.5px] leading-relaxed text-[var(--sw-text-muted)] transition-colors hover:border-[var(--sw-border-strong)]"
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}

const METHOD_COLOR: Record<string, string> = {
  GET: "text-[#4ea1ff] bg-[rgba(78,161,255,0.12)]",
  POST: "text-[var(--sw-mint)] bg-[rgba(255, 106, 26, 0.14)]",
  DELETE: "text-[#ef4444] bg-[rgba(239,68,68,0.12)]",
  PUT: "text-[#e0a44a] bg-[rgba(224,164,74,0.14)]",
};

export function Method({ method }: { method: string }) {
  return (
    <span className={cn("rounded-md px-2 py-0.5 font-mono text-[11px] font-semibold", METHOD_COLOR[method] ?? "")}>
      {method}
    </span>
  );
}

// One REST endpoint entry: method + path header, description, then children.
export function Endpoint({
  method,
  path,
  auth,
  desc,
  children,
}: {
  method: string;
  path: string;
  auth?: boolean;
  desc: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[16px] border border-[var(--sw-border)] bg-[var(--sw-card)] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Method method={method} />
        <code className="font-mono text-[13px] text-[var(--sw-text)]">{path}</code>
        <span
          className={cn(
            "ml-auto rounded-md px-2 py-0.5 text-[11px] font-medium",
            auth
              ? "bg-[var(--sw-card-inset)] text-[var(--sw-text-muted)]"
              : "bg-[rgba(255, 106, 26, 0.14)] text-[var(--sw-mint)]",
          )}
        >
          {auth ? "Wallet-signed" : "Public"}
        </span>
      </div>
      <p className="mt-2 text-[13px] text-[var(--sw-text-muted)]">{desc}</p>
      {children}
    </div>
  );
}

export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="mt-10 text-[16px] font-semibold tracking-[-0.01em] text-[var(--sw-text)]">{children}</h2>;
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-[13.5px] leading-relaxed text-[var(--sw-text-muted)]">{children}</p>;
}
