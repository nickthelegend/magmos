import type { NavGroup } from "@/app/brand-asset/data";
import { NAV_GROUPS } from "@/app/brand-asset/data";
import { MagmosMark } from "./magmos-mark";

function ChevronIcon({ open = false }: { open?: boolean }) {
  return (
    <svg
      aria-hidden="true"
      className="brand-chevron-icon"
      viewBox="0 0 20 20"
      fill="none"
      data-open={open}
    >
      <path
        d="M5 8l5 5 5-5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function NavGroupSection({ group }: { group: NavGroup }) {
  return (
    <section className="brand-nav-group">
      {group.href ? (
        <a className="brand-nav-heading" href={group.href}>
          <span>{group.title}</span>
        </a>
      ) : (
        <button className="brand-nav-heading" type="button">
          <span>{group.title}</span>
          <ChevronIcon open={group.open} />
        </button>
      )}
      {group.open ? (
        <div className="brand-nav-subitems">
          {group.items.map((item) => (
            <a href={`#${item.toLowerCase().replaceAll(" ", "-")}`} key={item}>
              {item}
            </a>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export function BrandSidebar() {
  return (
    <aside className="brand-sidebar">
      <div className="brand-sidebar-logo">
        <MagmosMark />
        <span>Magmos</span>
      </div>
      <nav>
        {NAV_GROUPS.map((group) => (
          <NavGroupSection key={group.title} group={group} />
        ))}
      </nav>
      <button className="brand-download-button" type="button">
        Download Full Kit
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
          <path d="M8 3h8l4 4v12H8V3Z" stroke="currentColor" strokeWidth="1.8" />
          <path d="M16 3v5h4M4 7h11v14H4V7Z" stroke="currentColor" strokeWidth="1.8" />
        </svg>
      </button>
    </aside>
  );
}
