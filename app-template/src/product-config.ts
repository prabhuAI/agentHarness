import rawConfig from "../product.config.json";

export type FieldType =
  | "text" | "longText" | "number" | "currency" | "date" | "datetime"
  | "boolean" | "category" | "status" | "email" | "url";
export type PredicateOperator = "equals" | "nonEmpty" | "empty" | "truthy" | "falsy" | "today" | "thisWeek" | "thisMonth";

// A value computed at read time from other fields, never entered by the user.
// `dateThreshold` buckets a record by how its elapsed days since `dateField`
// compare to a threshold (`thresholdField`'s value, or a fixed `thresholdDays`),
// mapping to the field's own options via `buckets`. `formula` computes a number
// by evaluating `expression` (arithmetic over other number/currency field ids).
export interface DateThresholdDerive {
  kind: "dateThreshold";
  dateField: string;
  thresholdField?: string;
  thresholdDays?: number;
  soonWithinDays?: number;
  buckets: { overdue: string; soon: string; ok: string };
}
export interface FormulaDerive {
  kind: "formula";
  expression: string;
}
export type DerivedFieldSpec = DateThresholdDerive | FormulaDerive;

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
  derive?: DerivedFieldSpec;
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
  operation: "count" | "countWhere" | "sum" | "sumWhere";
  field?: string;
  operator?: PredicateOperator;
  value?: string;
  // For sumWhere: the numeric field summed over records matching the predicate.
  sumField?: string;
}

// A deterministic trend chart: the numeric `yField` plotted against the date
// `xField`, one point per record, ordered chronologically.
export interface ChartConfig {
  id: string;
  label: string;
  type: "line";
  xField: string;
  yField: string;
}

// A single option in the list's sort control. `updated`/`created` are the two
// built-in time orderings; a `field` option sorts by that field's value in
// `direction`, comparing numerically for number/currency and textually otherwise.
export interface SortOption {
  id: string;
  label: string;
  field?: string;
  direction?: "asc" | "desc";
  type?: FieldType;
}

export interface DesignConfig {
  id: string;
  tone: "calm" | "playful" | "professional" | "bold" | "warm" | "technical";
  density: "compact" | "comfortable" | "spacious";
  contrast: "soft" | "balanced" | "high";
  motion: "none" | "subtle" | "expressive";
  layout: string;
  layoutLabel: string;
  variant: "a" | "b" | "c";
  colors: {
    canvas: string; surface: string; surfaceAlt: string; ink: string; muted: string;
    border: string; accent: string; accentText: string; topbar: string; topbarText: string; danger: string;
  };
  typography: { body: string; display: string };
  shape: { cardRadius: number; panelRadius: number };
  spacing: { page: number; panel: number; gap: number };
}

// A one-tap per-record button that mutates one field to a computed value:
// "today" stamps a date field to the current date; "clear" empties the field.
export interface QuickActionConfig {
  id: string;
  label: string;
  field: string;
  set: "today" | "clear";
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
  charts: ChartConfig[];
  quickActions: QuickActionConfig[];
  sorts: SortOption[];
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean };
}

const DEFAULT_SORTS: SortOption[] = [
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Oldest first" },
];

const parsedConfig = rawConfig as Omit<ProductConfig, "design"> & { design?: DesignConfig };
const fallbackDesign: DesignConfig = {
  id: "progress-workbench-professional",
  tone: "professional",
  density: "comfortable",
  contrast: "balanced",
  motion: "subtle",
  layout: "progress-workbench",
  layoutLabel: "Progress workbench",
  variant: "a",
  colors: {
    canvas: "#f4f6fa", surface: "#ffffff", surfaceAlt: "#e9eef8", ink: "#172033",
    muted: "#667085", border: "#d5dae4", accent: parsedConfig.accent, accentText: "#ffffff",
    topbar: "#111827", topbarText: "#f8fafc", danger: "#b42318",
  },
  typography: { body: "Inter, ui-sans-serif, system-ui, sans-serif", display: "Arial, ui-sans-serif, system-ui, sans-serif" },
  shape: { cardRadius: 14, panelRadius: 18 },
  spacing: { page: 52, panel: 22, gap: 14 },
};

export const productConfig: ProductConfig = {
  ...parsedConfig,
  design: parsedConfig.design ?? fallbackDesign,
  charts: parsedConfig.charts ?? [],
  quickActions: parsedConfig.quickActions ?? [],
  sorts: parsedConfig.sorts && parsedConfig.sorts.length > 0 ? parsedConfig.sorts : DEFAULT_SORTS,
};
