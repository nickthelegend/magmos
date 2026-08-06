"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import { Icon, type IconName } from "./icons";
import { cn } from "@/lib/utils";

type SubNavItem = {
  readonly label: string;
  readonly href: string;
};

type NavItem = {
  readonly icon: IconName;
  readonly label: string;
  readonly href: string;
  readonly badge?: string;
  readonly matchPrefix?: string;
  readonly subitems?: readonly SubNavItem[];
  readonly submenuVariant?: "billing" | "developer";
};

const navItems: readonly NavItem[] = [
  { icon: "home", label: "Overview", href: "/dashboard" },
  { icon: "sparkle", label: "Magmos AI", href: "/dashboard/ai" },
  { icon: "payment", label: "Payroll", href: "/dashboard/payments" },
  { icon: "sparkle", label: "Confidential", href: "/dashboard/private", badge: "New" },
  { icon: "customer", label: "Employees", href: "/dashboard/customers" },
  { icon: "link", label: "Payment links", href: "/dashboard/payment-links" },
  {
    icon: "billing",
    label: "Billing",
    href: "/dashboard/billing/subscriptions",
    matchPrefix: "/dashboard/billing",
    submenuVariant: "billing",
    subitems: [{ label: "Subscriptions", href: "/dashboard/billing/subscriptions" }],
  },
  { icon: "invoice", label: "Invoices", href: "/dashboard/invoices" },
  { icon: "box", label: "Products", href: "/dashboard/products" },
  { icon: "bank", label: "Offramp to Bank", href: "/dashboard/offramp", badge: "Coming soon" },
  {
    icon: "developer",
    label: "Developer",
    href: "/dashboard/developer/api-keys",
    matchPrefix: "/dashboard/developer",
    submenuVariant: "developer",
    subitems: [
      { label: "API keys", href: "/dashboard/developer/api-keys" },
      { label: "Webhooks", href: "/dashboard/developer/webhooks" },
      { label: "Documentation", href: "/dashboard/developer/documentation" },
      { label: "API reference", href: "/dashboard/developer/api-reference" },
      { label: "Components", href: "/dashboard/developer/component" },
    ],
  },
  { icon: "settings", label: "Settings", href: "/dashboard/settings" },
] satisfies readonly NavItem[];

function getNavItemState(item: NavItem, pathname: string) {
  const matchesSub = item.subitems?.some((s) => pathname === s.href) ?? false;
  const isExpanded = matchesSub || (item.matchPrefix ? pathname.startsWith(item.matchPrefix) : false);
  const isActive =
    item.href === "/dashboard"
      ? pathname === item.href
      : pathname === item.href || pathname.startsWith(`${item.href}/`) || isExpanded;
  return { isExpanded, isActive };
}

function SubMenu({
  items,
  pathname,
  onNavigate,
}: {
  items: readonly SubNavItem[];
  pathname: string;
  onNavigate: () => void;
}) {
  return (
    <div className="ml-[26px] mt-1 flex flex-col border-l border-[var(--sw-border)] pl-3">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-md py-1.5 text-[12.5px] transition-colors",
              active
                ? "font-medium text-[var(--sw-mint)]"
                : "text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                active ? "bg-[var(--sw-mint)]" : "bg-[var(--sw-text-dim)]"
              )}
            />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </div>
  );
}

export function Sidebar({
  open,
  collapsed,
  onToggle,
  onClose,
}: {
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-full flex-col border-r border-[var(--sw-border)] bg-[var(--sw-bg)] transition-[width,transform] duration-200 lg:static lg:translate-x-0",
        collapsed ? "w-[74px]" : "w-[244px]",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      {/* Brand */}
      <div
        className={cn(
          "flex h-[60px] items-center gap-2.5",
          collapsed ? "justify-center px-0" : "px-5"
        )}
      >
        <Image src="/magmos.png" alt="Magmos" width={26} height={26} priority className="h-[26px] w-[26px] shrink-0" />
        {!collapsed && (
          <>
            <span className="text-[17px] font-semibold tracking-[-0.02em]">Magmos</span>
            <span className="rounded-md bg-[var(--sw-card-inset)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--sw-text-muted)]">
              Beta
            </span>
          </>
        )}
      </div>

      {/* Nav */}
      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 py-2">
        {navItems.map((item) => {
          const { isExpanded, isActive } = getNavItemState(item, pathname);
          return (
            <div key={item.label} className="mb-0.5">
              <Link
                href={item.href}
                title={item.label}
                onClick={onClose}
                aria-expanded={item.subitems ? isExpanded : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-[13.5px] font-medium transition-colors",
                  collapsed && "justify-center px-0",
                  isActive
                    ? "text-[var(--sw-text)]"
                    : "text-[var(--sw-text-muted)] hover:text-[var(--sw-text)]"
                )}
              >
                {isActive && (
                  <motion.span
                    layoutId="sw-sidebar-active"
                    transition={{ type: "spring", stiffness: 320, damping: 30 }}
                    className="absolute inset-0 rounded-xl border border-[var(--sw-border)] bg-[var(--sw-card-inset)]"
                  />
                )}
                <span
                  className={cn(
                    "relative z-10 flex items-center gap-3",
                    isActive && "text-[var(--sw-mint)]"
                  )}
                >
                  <Icon name={item.icon} size={18} />
                </span>
                {!collapsed && (
                  <span className="relative z-10 flex flex-1 items-center justify-between gap-1.5">
                    <span className="whitespace-nowrap">{item.label}</span>
                    {item.badge && (
                      <span className="shrink-0 whitespace-nowrap rounded bg-[rgba(255, 106, 26, 0.16)] px-1 py-0.5 text-[8.5px] font-semibold text-[var(--sw-mint)]">
                        {item.badge}
                      </span>
                    )}
                  </span>
                )}
              </Link>

              {!collapsed && item.subitems && isExpanded && (
                <SubMenu items={item.subitems} pathname={pathname} onNavigate={onClose} />
              )}
            </div>
          );
        })}
      </nav>

      {/* Collapse */}
      <div
        className={cn(
          "hidden border-t border-[var(--sw-border)] p-3 lg:flex",
          collapsed && "justify-center"
        )}
      >
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="flex size-9 items-center justify-center rounded-lg border border-[var(--sw-border)] text-[var(--sw-text-muted)] transition-colors hover:bg-[var(--sw-card-inset)] hover:text-[var(--sw-text)]"
        >
          <svg
            className={cn("transition-transform", collapsed && "rotate-180")}
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M15 6l-6 6 6 6" />
          </svg>
        </button>
      </div>
    </aside>
  );
}
