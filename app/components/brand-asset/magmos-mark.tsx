/**
 * Magmos wordmark glyph — a molten flame, matching the product's orange identity.
 *
 * Replaces the Sweem-era `SuiMark` (a Sui droplet in #298DFF) that this page still rendered long
 * after the migration to Arc. A brand-guidelines page showing another chain's logo is worse than
 * having no brand page at all.
 */
export function MagmosMark({ light = false }: { light?: boolean }) {
  const color = light ? "#fff" : "#FF6A1A";
  return (
    <svg className="brand-magmos-mark" viewBox="0 0 48 62" aria-hidden="true">
      {/* outer flame */}
      <path
        d="M24 4c8 11 18 20 18 32 0 11-8 20-18 20S6 47 6 36C6 24 16 15 24 4Z"
        fill="none"
        stroke={color}
        strokeWidth="5"
        strokeLinejoin="round"
      />
      {/* inner core — the per-second stream */}
      <path
        d="M24 27c4 5 7 9 7 13a7 7 0 0 1-14 0c0-4 3-8 7-13Z"
        fill={color}
      />
    </svg>
  );
}
