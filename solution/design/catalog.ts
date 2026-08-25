import type { DesignDensity, DesignIntent, DesignTone, Genome } from "../ir/types.js";
import type { PrimaryView } from "./presentation.js";

// Curated from UI/UX Pro Max's MIT-licensed design-system workflow. The scored
// runtime uses only these reviewed tokens; it never loads the skill or runs Python.
// Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill
//
// Each tone offers several reviewed palettes and font pairings, each genome its
// base layout, plus shape and structural "variant" axes. A deterministic hash of
// the product name selects one option per axis, so two products of the same
// genome/tone still look distinct — without any randomness (runs stay reproducible).

interface Palette {
  canvas: string;
  surface: string;
  surfaceAlt: string;
  ink: string;
  muted: string;
  border: string;
  accent: string;
  accentText: string;
  topbar: string;
  topbarText: string;
  danger: string;
}

interface LayoutProfile {
  id: string;
  label: string;
  cardRadius: number;
  panelRadius: number;
}

type Typography = { body: string; display: string };
type Shape = { cardRadius: number; panelRadius: number };
export type DesignVariant = "a" | "b" | "c";

export interface CompiledDesign {
  id: string;
  tone: DesignTone;
  density: DesignDensity;
  contrast: DesignIntent["contrast"];
  motion: DesignIntent["motion"];
  layout: string;
  layoutLabel: string;
  variant: DesignVariant;
  colors: Palette;
  typography: Typography;
  shape: Shape;
  spacing: { page: number; panel: number; gap: number };
}

// Every palette keeps a dark, saturated accent on white text and very dark ink on
// a near-white surface, so all variants clear WCAG AA (verified in the test suite).
const PALETTES: Record<DesignTone, Palette[]> = {
  calm: [
    { canvas: "#f2f7f5", surface: "#ffffff", surfaceAlt: "#e7f1ed", ink: "#17332d", muted: "#5e746f", border: "#cdded8", accent: "#0f766e", accentText: "#ffffff", topbar: "#102b27", topbarText: "#f4fbf8", danger: "#a52a2a" },
    { canvas: "#f1f7f2", surface: "#ffffff", surfaceAlt: "#e4f0e6", ink: "#14311f", muted: "#5b7263", border: "#cde0d2", accent: "#166534", accentText: "#ffffff", topbar: "#0f2a1a", topbarText: "#f3faf4", danger: "#a52a2a" },
    { canvas: "#f0f6f8", surface: "#ffffff", surfaceAlt: "#e2eef2", ink: "#142a33", muted: "#567079", border: "#cbdde3", accent: "#0e7490", accentText: "#ffffff", topbar: "#0a232b", topbarText: "#f0fafc", danger: "#a52a2a" },
  ],
  playful: [
    { canvas: "#f8f5ff", surface: "#ffffff", surfaceAlt: "#eee8ff", ink: "#2d1b4e", muted: "#6d6082", border: "#dcd2f3", accent: "#6d28d9", accentText: "#ffffff", topbar: "#281443", topbarText: "#fbf9ff", danger: "#b42345" },
    { canvas: "#fdf4fb", surface: "#ffffff", surfaceAlt: "#f6e6f5", ink: "#3a1533", muted: "#7a5f74", border: "#ecd3e9", accent: "#a21caf", accentText: "#ffffff", topbar: "#33112e", topbarText: "#fdf6fc", danger: "#b42345" },
    { canvas: "#f4f5ff", surface: "#ffffff", surfaceAlt: "#e6e8ff", ink: "#1e1b4b", muted: "#625f8a", border: "#d3d5f5", accent: "#4338ca", accentText: "#ffffff", topbar: "#191640", topbarText: "#f6f7ff", danger: "#b42345" },
  ],
  professional: [
    { canvas: "#f4f6fa", surface: "#ffffff", surfaceAlt: "#e9eef8", ink: "#172033", muted: "#667085", border: "#d5dae4", accent: "#1d4ed8", accentText: "#ffffff", topbar: "#111827", topbarText: "#f8fafc", danger: "#b42318" },
    { canvas: "#f3f5f9", surface: "#ffffff", surfaceAlt: "#e6ebf3", ink: "#14203a", muted: "#5f6b83", border: "#d2d9e6", accent: "#1e3a8a", accentText: "#ffffff", topbar: "#0d1730", topbarText: "#f6f8fc", danger: "#b42318" },
    { canvas: "#f5f6f8", surface: "#ffffff", surfaceAlt: "#eaecf0", ink: "#1b2430", muted: "#64707f", border: "#d7dbe1", accent: "#334155", accentText: "#ffffff", topbar: "#0f1720", topbarText: "#f7f9fb", danger: "#b42318" },
  ],
  bold: [
    { canvas: "#fff6ed", surface: "#ffffff", surfaceAlt: "#ffead5", ink: "#3b1d0c", muted: "#7a5844", border: "#efcfb5", accent: "#c2410c", accentText: "#ffffff", topbar: "#351306", topbarText: "#fffaf5", danger: "#a11616" },
    { canvas: "#fff5f4", surface: "#ffffff", surfaceAlt: "#ffe4e2", ink: "#3f1414", muted: "#7d5350", border: "#f0c8c4", accent: "#b91c1c", accentText: "#ffffff", topbar: "#350f0f", topbarText: "#fff6f5", danger: "#a11616" },
    { canvas: "#fff4f6", surface: "#ffffff", surfaceAlt: "#ffe1e8", ink: "#40111f", muted: "#7d5460", border: "#f0c4cf", accent: "#be123c", accentText: "#ffffff", topbar: "#330b17", topbarText: "#fff5f7", danger: "#a11616" },
  ],
  warm: [
    { canvas: "#f8f4ec", surface: "#fffdf8", surfaceAlt: "#f1e8d8", ink: "#32271d", muted: "#746658", border: "#ded2c1", accent: "#9a3412", accentText: "#ffffff", topbar: "#2e2118", topbarText: "#fffaf3", danger: "#a52a2a" },
    { canvas: "#f7f3ee", surface: "#fffdf9", surfaceAlt: "#efe5d8", ink: "#2f231a", muted: "#6f6153", border: "#ddd0bf", accent: "#7c2d12", accentText: "#ffffff", topbar: "#2a1d13", topbarText: "#fdf8f2", danger: "#a52a2a" },
    { canvas: "#f8f5ec", surface: "#fffdf6", surfaceAlt: "#f1e7d2", ink: "#33291a", muted: "#746850", border: "#ded2b8", accent: "#92400e", accentText: "#ffffff", topbar: "#2c2113", topbarText: "#fdf9ef", danger: "#a52a2a" },
  ],
  technical: [
    { canvas: "#f1f6f9", surface: "#ffffff", surfaceAlt: "#e3eef4", ink: "#112c3c", muted: "#587080", border: "#ccdae2", accent: "#0369a1", accentText: "#ffffff", topbar: "#071f2c", topbarText: "#f0f9ff", danger: "#b42318" },
    { canvas: "#eff6f9", surface: "#ffffff", surfaceAlt: "#ddeef3", ink: "#0e2b34", muted: "#52717b", border: "#c7dde4", accent: "#155e75", accentText: "#ffffff", topbar: "#06222b", topbarText: "#eefaff", danger: "#b42318" },
    { canvas: "#f1f5fa", surface: "#ffffff", surfaceAlt: "#e2e9f4", ink: "#14233a", muted: "#566880", border: "#ccd8e6", accent: "#1e40af", accentText: "#ffffff", topbar: "#0a1530", topbarText: "#f2f6ff", danger: "#b42318" },
  ],
};

// System-safe font stacks only — the scored runtime never fetches web fonts.
const TYPOGRAPHY: Record<DesignTone, Typography[]> = {
  calm: [
    { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Inter, ui-sans-serif, system-ui, sans-serif" },
    { body: "Verdana, Geneva, ui-sans-serif, sans-serif", display: "'Trebuchet MS', Verdana, ui-sans-serif, sans-serif" },
  ],
  playful: [
    { body: "'Avenir Next', ui-rounded, system-ui, sans-serif", display: "'Avenir Next', ui-rounded, system-ui, sans-serif" },
    { body: "'Trebuchet MS', ui-rounded, system-ui, sans-serif", display: "'Trebuchet MS', ui-rounded, system-ui, sans-serif" },
  ],
  professional: [
    { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Arial, ui-sans-serif, system-ui, sans-serif" },
    { body: "'Helvetica Neue', Helvetica, Arial, sans-serif", display: "'Helvetica Neue', Helvetica, Arial, sans-serif" },
  ],
  bold: [
    { body: "Arial, ui-sans-serif, system-ui, sans-serif", display: "Arial, ui-sans-serif, system-ui, sans-serif" },
    { body: "'Helvetica Neue', Arial, sans-serif", display: "'Helvetica Neue', Arial, sans-serif" },
  ],
  warm: [
    { body: "'Avenir Next', ui-sans-serif, system-ui, sans-serif", display: "Georgia, ui-serif, serif" },
    { body: "'Palatino Linotype', 'Book Antiqua', Palatino, ui-serif, serif", display: "'Palatino Linotype', 'Book Antiqua', Palatino, ui-serif, serif" },
  ],
  technical: [
    { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "SFMono-Regular, Consolas, ui-monospace, monospace" },
    { body: "Menlo, Consolas, ui-monospace, monospace", display: "Menlo, Consolas, ui-monospace, monospace" },
  ],
};

const LAYOUTS: Record<PrimaryView, LayoutProfile> = {
  tracker: { id: "progress-workbench", label: "Progress workbench", cardRadius: 14, panelRadius: 18 },
  table: { id: "data-ledger", label: "Data ledger", cardRadius: 6, panelRadius: 10 },
  board: { id: "stage-board", label: "Stage board", cardRadius: 10, panelRadius: 14 },
  gallery: { id: "editorial-gallery", label: "Editorial gallery", cardRadius: 20, panelRadius: 24 },
  agenda: { id: "agenda-canvas", label: "Agenda canvas", cardRadius: 12, panelRadius: 18 },
  dashboard: { id: "command-center", label: "Command center", cardRadius: 8, panelRadius: 12 },
  standings: { id: "league-center", label: "League center", cardRadius: 8, panelRadius: 12 },
};

// Shape treatments applied on top of the genome's base radii: soft (base), sharp, pill.
const SHAPE_MODES: Array<(layout: LayoutProfile) => Shape> = [
  (layout) => ({ cardRadius: layout.cardRadius, panelRadius: layout.panelRadius }),
  () => ({ cardRadius: 4, panelRadius: 6 }),
  (layout) => ({ cardRadius: layout.cardRadius + 8, panelRadius: layout.panelRadius + 10 }),
];

const VARIANTS: DesignVariant[] = ["a", "b", "c"];

const SPACING: Record<DesignDensity, CompiledDesign["spacing"]> = {
  compact: { page: 36, panel: 16, gap: 10 },
  comfortable: { page: 52, panel: 22, gap: 14 },
  spacious: { page: 68, panel: 28, gap: 20 },
};

// FNV-1a — a stable, dependency-free hash so the same product name always resolves
// to the same design (no Date.now/Math.random, keeping runs reproducible).
function seedFrom(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function choose<T>(items: T[], seed: number, salt: number): T {
  return items[((seed ^ salt) >>> 0) % items.length]!;
}

export function resolveDesign(view: PrimaryView | Genome, intent: DesignIntent, seed = ""): CompiledDesign {
  const primary: PrimaryView = view === "workflow" ? "board" : view === "catalog" ? "gallery" : view === "planner" ? "agenda" : view;
  const layout = LAYOUTS[primary];
  const hash = seedFrom(seed);
  const basePalette = choose(PALETTES[intent.tone], hash, 0x9e3779b1);
  const palette = intent.contrast === "high" ? { ...basePalette, muted: basePalette.ink, border: basePalette.muted } : basePalette;
  const variant = choose(VARIANTS, hash, 0x27d4eb2f);
  return {
    id: `${layout.id}-${intent.tone}-${variant}`,
    tone: intent.tone,
    density: intent.density,
    contrast: intent.contrast,
    motion: intent.motion,
    layout: layout.id,
    layoutLabel: layout.label,
    variant,
    colors: palette,
    typography: choose(TYPOGRAPHY[intent.tone], hash, 0x85ebca77),
    shape: choose(SHAPE_MODES, hash, 0xc2b2ae3d)(layout),
    spacing: SPACING[intent.density],
  };
}
