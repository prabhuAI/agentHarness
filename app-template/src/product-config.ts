import rawConfig from "../product.config.json";

export type FieldType =
  | "text" | "longText" | "number" | "currency" | "date" | "datetime"
  | "boolean" | "category" | "status" | "email" | "url";
export type PredicateOperator = "equals" | "nonEmpty" | "empty" | "truthy" | "falsy";

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: string[];
  allowCustom?: boolean;
  min?: number;
  max?: number;
  visibleWhen?: {
    field: string;
    equals: string;
  };
}

export interface FilterPreset {
  id: string;
  label: string;
  field: string;
  operator: PredicateOperator;
  value?: string;
}

export interface SummaryConfig {
  id: string;
  label: string;
  operation: "count" | "countWhere" | "sum";
  field?: string;
  operator?: PredicateOperator;
  value?: string;
}

export interface DesignConfig {
  id: string;
  tone: "calm" | "playful" | "professional" | "bold" | "warm" | "technical";
  density: "compact" | "comfortable" | "spacious";
  contrast: "soft" | "balanced" | "high";
  motion: "none" | "subtle" | "expressive";
  layout: string;
  layoutLabel: string;
  colors: {
    canvas: string; surface: string; surfaceAlt: string; ink: string; muted: string;
    border: string; accent: string; accentText: string; topbar: string; topbarText: string; danger: string;
  };
  typography: { body: string; display: string };
  shape: { cardRadius: number; panelRadius: number };
  spacing: { page: number; panel: number; gap: number };
}

export interface ProductConfig {
  name: string;
  tagline: string;
  entityName: string;
  entityNamePlural: string;
  genome: "tracker" | "workflow" | "catalog" | "planner" | "dashboard";
  eyebrow: string;
  collectionLabel: string;
  accent: string;
  design: DesignConfig;
  fields: FieldConfig[];
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  filters: FilterPreset[];
  summaries: SummaryConfig[];
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean };
}

const parsedConfig = rawConfig as Omit<ProductConfig, "design"> & { design?: DesignConfig };
const fallbackDesign: DesignConfig = {
  id: "progress-workbench-professional",
  tone: "professional",
  density: "comfortable",
  contrast: "balanced",
  motion: "subtle",
  layout: "progress-workbench",
  layoutLabel: "Progress workbench",
  colors: {
    canvas: "#f4f6fa", surface: "#ffffff", surfaceAlt: "#e9eef8", ink: "#172033",
    muted: "#667085", border: "#d5dae4", accent: parsedConfig.accent, accentText: "#ffffff",
    topbar: "#111827", topbarText: "#f8fafc", danger: "#b42318",
  },
  typography: { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Arial, ui-sans-serif, system-ui, sans-serif" },
  shape: { cardRadius: 14, panelRadius: 18 },
  spacing: { page: 52, panel: 22, gap: 14 },
};

export const productConfig: ProductConfig = { ...parsedConfig, design: parsedConfig.design ?? fallbackDesign };
