// ── Palette ───────────────────────────────────────────────────────────────────

export type ColorSwatch = readonly [label: string, hex: string];

// Magmos is molten orange. This scale is generated around the product accent --sw-mint (#ff6a1a)
// and the secondary --sw-lavender (#ffb43d); the previous BLUE_SCALE was Sweem-era and wrong.
export const ORANGE_SCALE: readonly ColorSwatch[] = [
  ["Orange 900", "#1a0a02"],
  ["Orange 800", "#3d1806"],
  ["Orange 700", "#7a2f08"],
  ["Orange 600", "#c24d0f"],
  ["Orange 500*", "#ff6a1a"],
  ["Orange 400", "#ff8340"],
  ["Orange 300", "#ffb43d"],
  ["Orange 200", "#ffd08a"],
  ["Orange 100", "#ffe7c7"],
  ["Orange 50", "#fff6ec"],
] as const;

export const GRAY_SCALE: readonly ColorSwatch[] = [
  ["Gray 900", "#15181c"],
  ["Gray 800", "#24282e"],
  ["Gray 700", "#373d45"],
  ["Gray 600", "#525a64"],
  ["Gray 500*", "#76808e"],
  ["Gray 400", "#909aa8"],
  ["Gray 300", "#aab3bf"],
  ["Gray 200", "#c2c8d0"],
  ["Gray 100", "#dde1e6"],
  ["Gray 50", "#f1f3f6"],
] as const;

// ── Navigation ────────────────────────────────────────────────────────────────

export type NavGroup = {
  readonly title: string;
  readonly items: readonly string[];
  readonly open?: boolean;
  /** When set, the group heading renders as an anchor instead of a button. */
  readonly href?: string;
};

export const NAV_GROUPS: readonly NavGroup[] = [
  { title: "Logo", items: [] },
  { title: "Typography", items: [] },
  {
    title: "Color",
    items: ["Core Color Palette", "Extended Palette", "Accessibility", "Incorrect Usage"],
    open: true,
  },
  { title: "Iconography", items: [] },
  { title: "Layout", items: [] },
  {
    title: "Gradients",
    items: ["Primary Gradient", "Secondary Gradient"],
    open: true,
  },
  {
    title: "Technical Visuals",
    items: ["Illustrations", "Diagrams"],
    open: true,
  },
  { title: "Contact Us", items: [], href: "#contact-us" },
] as const;

// ── Contrast cards ────────────────────────────────────────────────────────────

type WcagResult = "AA" | "AAA" | "FAIL";
type WcagTone = "pass" | "fail";

export type WcagRow = {
  readonly label: "Normal Text" | "Large Text" | "Graphics";
  readonly second: WcagResult;
  readonly secondTone: WcagTone;
};

export type ContrastCardData = {
  readonly left: string;
  readonly right: string;
  readonly leftColor: string;
  readonly rightColor: string;
  /** Text color rendered on top of leftColor swatch. */
  readonly leftTextColor: string;
  readonly ratio: string;
  readonly rows: readonly WcagRow[];
};

// Pre-computed row sets avoid deriving WCAG levels from a boolean flag at render time.
const WCAG_ROWS_PASSES_AA: readonly WcagRow[] = [
  { label: "Normal Text", second: "FAIL", secondTone: "pass" },
  { label: "Large Text",  second: "AAA",  secondTone: "pass" },
  { label: "Graphics",    second: "AAA",  secondTone: "pass" },
] as const;

const WCAG_ROWS_FAILS_AA: readonly WcagRow[] = [
  { label: "Normal Text", second: "FAIL", secondTone: "fail" },
  { label: "Large Text",  second: "AA",   secondTone: "pass" },
  { label: "Graphics",    second: "FAIL", secondTone: "pass" },
] as const;

export const CONTRAST_CARDS: readonly ContrastCardData[] = [
  {
    left: "BLUE 500",
    right: "BLACK",
    leftColor: "#298dff",
    rightColor: "#000",
    leftTextColor: "#000",
    ratio: "6.35:1",
    rows: WCAG_ROWS_PASSES_AA,
  },
  {
    left: "BLUE 500",
    right: "WHITE",
    leftColor: "#298dff",
    rightColor: "#fff",
    leftTextColor: "#fff",
    ratio: "3.31:1",
    rows: WCAG_ROWS_FAILS_AA,
  },
  {
    left: "GRAY 500",
    right: "BLACK",
    leftColor: "#76808e",
    rightColor: "#000",
    leftTextColor: "#000",
    ratio: "4.52:1",
    rows: WCAG_ROWS_PASSES_AA,
  },
  {
    left: "GRAY 600",
    right: "GRAY 50",
    leftColor: "#525a64",
    rightColor: "#f1f3f6",
    leftTextColor: "#000",
    ratio: "7.33:1",
    rows: WCAG_ROWS_PASSES_AA,
  },
] as const;

// ── Misuse cards ──────────────────────────────────────────────────────────────

export type MisuseCardData = {
  readonly label: string;
  readonly type: string;
};

export const MISUSE_CARDS: readonly MisuseCardData[] = [
  { label: "Do not use unapproved colors", type: "cyan" },
  { label: "Do not use unapproved gradients", type: "gradient" },
  { label: "Do not use low contrast combinations", type: "low" },
  { label: "Do not use poor combinations", type: "badcombo" },
] as const;
