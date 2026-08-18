import type { DesignDensity, DesignIntent, DesignTone, Genome } from "../ir/types.js";

// Curated from UI/UX Pro Max's MIT-licensed design-system workflow. The scored
// runtime uses only these reviewed tokens; it never loads the skill or runs Python.
// Source: https://github.com/nextlevelbuilder/ui-ux-pro-max-skill

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

export interface CompiledDesign {
  id: string;
  tone: DesignTone;
  density: DesignDensity;
  contrast: DesignIntent["contrast"];
  motion: DesignIntent["motion"];
  layout: string;
  layoutLabel: string;
  colors: Palette;
  typography: { body: string; display: string };
  shape: { cardRadius: number; panelRadius: number };
  spacing: { page: number; panel: number; gap: number };
}

const PALETTES: Record<DesignTone, Palette> = {
  calm: { canvas: "#f2f7f5", surface: "#ffffff", surfaceAlt: "#e7f1ed", ink: "#17332d", muted: "#5e746f", border: "#cdded8", accent: "#0f766e", accentText: "#ffffff", topbar: "#102b27", topbarText: "#f4fbf8", danger: "#a52a2a" },
  playful: { canvas: "#f8f5ff", surface: "#ffffff", surfaceAlt: "#eee8ff", ink: "#2d1b4e", muted: "#6d6082", border: "#dcd2f3", accent: "#6d28d9", accentText: "#ffffff", topbar: "#281443", topbarText: "#fbf9ff", danger: "#b42345" },
  professional: { canvas: "#f4f6fa", surface: "#ffffff", surfaceAlt: "#e9eef8", ink: "#172033", muted: "#667085", border: "#d5dae4", accent: "#1d4ed8", accentText: "#ffffff", topbar: "#111827", topbarText: "#f8fafc", danger: "#b42318" },
  bold: { canvas: "#fff6ed", surface: "#ffffff", surfaceAlt: "#ffead5", ink: "#3b1d0c", muted: "#7a5844", border: "#efcfb5", accent: "#c2410c", accentText: "#ffffff", topbar: "#351306", topbarText: "#fffaf5", danger: "#a11616" },
  warm: { canvas: "#f8f4ec", surface: "#fffdf8", surfaceAlt: "#f1e8d8", ink: "#32271d", muted: "#746658", border: "#ded2c1", accent: "#9a3412", accentText: "#ffffff", topbar: "#2e2118", topbarText: "#fffaf3", danger: "#a52a2a" },
  technical: { canvas: "#f1f6f9", surface: "#ffffff", surfaceAlt: "#e3eef4", ink: "#112c3c", muted: "#587080", border: "#ccdae2", accent: "#0369a1", accentText: "#ffffff", topbar: "#071f2c", topbarText: "#f0f9ff", danger: "#b42318" },
};

const LAYOUTS: Record<Genome, LayoutProfile> = {
  tracker: { id: "progress-workbench", label: "Progress workbench", cardRadius: 14, panelRadius: 18 },
  workflow: { id: "stage-board", label: "Stage board", cardRadius: 10, panelRadius: 14 },
  catalog: { id: "editorial-gallery", label: "Editorial gallery", cardRadius: 20, panelRadius: 24 },
  planner: { id: "agenda-canvas", label: "Agenda canvas", cardRadius: 12, panelRadius: 18 },
  dashboard: { id: "command-center", label: "Command center", cardRadius: 8, panelRadius: 12 },
};

const SPACING: Record<DesignDensity, CompiledDesign["spacing"]> = {
  compact: { page: 36, panel: 16, gap: 10 },
  comfortable: { page: 52, panel: 22, gap: 14 },
  spacious: { page: 68, panel: 28, gap: 20 },
};

const TYPOGRAPHY: Record<DesignTone, CompiledDesign["typography"]> = {
  calm: { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Inter, ui-sans-serif, system-ui, sans-serif" },
  playful: { body: "Avenir Next, ui-rounded, system-ui, sans-serif", display: "Avenir Next, ui-rounded, system-ui, sans-serif" },
  professional: { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Arial, ui-sans-serif, system-ui, sans-serif" },
  bold: { body: "Arial, ui-sans-serif, system-ui, sans-serif", display: "Arial Black, Arial, sans-serif" },
  warm: { body: "Avenir Next, ui-sans-serif, system-ui, sans-serif", display: "Georgia, ui-serif, serif" },
  technical: { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "SFMono-Regular, Consolas, monospace" },
};

export function resolveDesign(genome: Genome, intent: DesignIntent): CompiledDesign {
  const layout = LAYOUTS[genome];
  const palette = PALETTES[intent.tone];
  return {
    id: `${layout.id}-${intent.tone}`,
    tone: intent.tone,
    density: intent.density,
    contrast: intent.contrast,
    motion: intent.motion,
    layout: layout.id,
    layoutLabel: layout.label,
    colors: intent.contrast === "high" ? { ...palette, muted: palette.ink, border: palette.muted } : palette,
    typography: TYPOGRAPHY[intent.tone],
    shape: { cardRadius: layout.cardRadius, panelRadius: layout.panelRadius },
    spacing: SPACING[intent.density],
  };
}
