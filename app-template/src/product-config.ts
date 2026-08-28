import rawConfig from "../product.config.json";

export type FieldType =
  | "text" | "longText" | "number" | "currency" | "date" | "datetime"
  | "boolean" | "category" | "status" | "email" | "url" | "reference";
export type PredicateOperator =
  | "equals" | "notEquals" | "contains" | "nonEmpty" | "empty" | "truthy" | "falsy"
  | "greaterThan" | "lessThan" | "atLeast" | "atMost" | "between"
  | "before" | "after" | "today" | "thisWeek" | "thisMonth";

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
// `presence` computes a two-state status from whether `sourceField` is filled in
// (`whenPresent`) or empty (`whenEmpty`), so the status can never drift from it.
export interface PresenceDerive {
  kind: "presence";
  sourceField: string;
  whenPresent: string;
  whenEmpty: string;
}
export type DerivedFieldSpec = DateThresholdDerive | FormulaDerive | PresenceDerive;

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
  // For a `reference` field: the entity this field links to. The stored value is a
  // linked record's id; the UI shows and picks by that entity's primary field.
  refEntity?: string;
}

export interface FilterPreset {
  id: string;
  label: string;
  field: string;
  operator: PredicateOperator;
  value?: string;
  // Inclusive upper bound for the `between` operator; ignored by others.
  valueEnd?: string;
}

export interface SummaryConfig {
  id: string;
  label: string;
  operation:
    | "count" | "countWhere"
    | "sum" | "sumWhere"
    | "average" | "avgWhere"
    | "min" | "minWhere"
    | "max" | "maxWhere";
  field?: string;
  operator?: PredicateOperator;
  value?: string;
  valueEnd?: string;
  // For the *Where conditional aggregates: the numeric field reduced over the
  // records matching the predicate.
  sumField?: string;
}

// A deterministic chart. `line` plots the numeric `yField` against the date
// `xField` chronologically. `bar`/`pie` group records by the category/status
// `xField`; each group is a record count, or the sum of the numeric `yField`
// when one is given.
export interface ChartConfig {
  id: string;
  label: string;
  type: "line" | "bar" | "pie";
  xField: string;
  yField?: string;
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

export interface PriorityConfig {
  label: string;
  sortField: string;
  direction: "asc" | "desc";
  filter?: { field: string; operator: PredicateOperator; value?: string; valueEnd?: string };
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

export type PrimaryView = "tracker" | "table" | "board" | "gallery" | "agenda" | "dashboard" | "standings";
export interface PresentationConfig {
  primary: PrimaryView;
  navigation: "single" | "sections";
  variant: string;
  reason: string;
  groupField?: string;
  dateField?: string;
}

// A one-tap per-record button that mutates one field to a computed value.
// today/now stamp a date/datetime; clear empties; increment adds `amount` to a
// number/currency; toggle flips a boolean; setValue sets a choice field to `value`.
export interface QuickActionConfig {
  id: string;
  label: string;
  field: string;
  set: "today" | "now" | "clear" | "increment" | "toggle" | "setValue";
  amount?: number;
  value?: string;
}

export interface EntityConfig {
  name: string;
  plural: string;
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  fields: FieldConfig[];
}

export interface StandingsConfig {
  id: string;
  label: string;
  rowEntity: string;
  sourceEntity: string;
  participants: [
    { entityField: string; scoreForField: string; scoreAgainstField: string },
    { entityField: string; scoreForField: string; scoreAgainstField: string },
  ];
  points: { win: number; draw: number; loss: number };
}

export interface ProductConfig {
  name: string;
  tagline: string;
  entityName: string;
  entityNamePlural: string;
  genome: "tracker" | "workflow" | "catalog" | "planner" | "dashboard" | "ledger" | "directory" | "log" | "inventory";
  eyebrow: string;
  collectionLabel: string;
  accent: string;
  design: DesignConfig;
  presentation: PresentationConfig;
  fields: FieldConfig[];
  primaryField: string;
  secondaryFields: string[];
  searchableFields: string[];
  filters: FilterPreset[];
  summaries: SummaryConfig[];
  charts: ChartConfig[];
  quickActions: QuickActionConfig[];
  sorts: SortOption[];
  capabilities: { create: boolean; edit: boolean; delete: boolean; search: boolean; sort: boolean; group: boolean; export: boolean };
  entities?: EntityConfig[];
  standings?: StandingsConfig[];
  priority?: PriorityConfig;
}

const DEFAULT_SORTS: SortOption[] = [
  { id: "updated", label: "Recently updated" },
  { id: "created", label: "Oldest first" },
];

// JSON imports infer ordinary arrays rather than fixed tuples. The compiler and
// IR validator enforce the runtime shape before writing this file.
const parsedConfig = rawConfig as unknown as Omit<ProductConfig, "design" | "presentation"> & { design?: DesignConfig; presentation?: PresentationConfig };
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
  presentation: parsedConfig.presentation ?? {
    primary: parsedConfig.genome === "workflow" ? "board"
      : parsedConfig.genome === "catalog" ? "gallery"
        : parsedConfig.genome === "planner" ? "agenda"
          : parsedConfig.genome === "dashboard" ? "dashboard" : "tracker",
    navigation: (parsedConfig.entities?.length ?? 0) > 1 ? "sections" : "single",
    variant: "default",
    reason: "legacy genome fallback",
  },
  charts: parsedConfig.charts ?? [],
  quickActions: parsedConfig.quickActions ?? [],
  sorts: parsedConfig.sorts && parsedConfig.sorts.length > 0 ? parsedConfig.sorts : DEFAULT_SORTS,
  entities: parsedConfig.entities ?? [],
  standings: parsedConfig.standings ?? [],
};
