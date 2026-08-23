export const GENOMES = ["tracker", "workflow", "catalog", "planner", "dashboard"] as const;
export type Genome = (typeof GENOMES)[number];

export const DESIGN_TONES = ["calm", "playful", "professional", "bold", "warm", "technical"] as const;
export type DesignTone = (typeof DESIGN_TONES)[number];

export const DESIGN_DENSITIES = ["compact", "comfortable", "spacious"] as const;
export type DesignDensity = (typeof DESIGN_DENSITIES)[number];

export const DESIGN_CONTRASTS = ["soft", "balanced", "high"] as const;
export type DesignContrast = (typeof DESIGN_CONTRASTS)[number];

export const DESIGN_MOTIONS = ["none", "subtle", "expressive"] as const;
export type DesignMotion = (typeof DESIGN_MOTIONS)[number];

export interface DesignIntent {
  tone: DesignTone;
  density: DesignDensity;
  contrast: DesignContrast;
  motion: DesignMotion;
}

export const FIELD_TYPES = [
  "text", "longText", "number", "currency", "date", "datetime", "boolean",
  "category", "status", "email", "url",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FILTER_OPERATORS = ["equals", "nonEmpty", "empty", "truthy", "falsy", "today", "thisWeek", "thisMonth"] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

// Operators that test a date field against the current date rather than a stored
// value; they carry no comparison value and only apply to date/datetime fields.
export const DATE_WINDOW_OPERATORS = ["today", "thisWeek", "thisMonth"] as const;
export type DateWindowOperator = (typeof DATE_WINDOW_OPERATORS)[number];

export const CALCULATION_OPERATIONS = ["count", "countWhere", "sum", "sumWhere"] as const;
export type CalculationOperation = (typeof CALCULATION_OPERATIONS)[number];

export const DERIVED_FIELD_KINDS = ["dateThreshold", "formula"] as const;
export type DerivedFieldKind = (typeof DERIVED_FIELD_KINDS)[number];

export const CHART_TYPES = ["line"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// A deterministic trend chart of one numeric field plotted against one date
// field, sorted chronologically. This covers the ubiquitous "see my <number>
// over time" request (weight over date, spend over month) without a custom LLM
// patch. Points come straight from the persisted records at read time.
export interface ProductChart {
  id: string;
  label: string;
  type: ChartType;
  // Field id of the date/datetime axis (x).
  xField: string;
  // Field id of the number/currency value plotted (y).
  yField: string;
}

// A field whose value is computed at read time from other fields, rather than
// entered by the user. Two kinds:
//
// `dateThreshold` buckets a record by how its elapsed days since `dateField`
// compare to a threshold (a `thresholdField` value, or a fixed `thresholdDays`) —
// the ubiquitous "overdue / due soon / fine" pattern. Buckets map to options.
//
// `formula` computes a number per record by evaluating an arithmetic expression
// (+ - * /, parentheses, unary minus) over sibling number/currency field ids and
// numeric literals — "price / 12", "target - current", "weight * (1 + reps/30)".
//
// Both compile deterministically, so a computed value never needs a custom patch.
export interface DateThresholdDerive {
  kind: "dateThreshold";
  // Field id of the reference date the elapsed span is measured from.
  dateField: string;
  // Field id supplying the threshold span in days; takes precedence over thresholdDays.
  thresholdField?: string;
  // Fixed threshold span in days, used when thresholdField is absent.
  thresholdDays?: number;
  // Days before the threshold that still count as the "soon" band (default 0).
  soonWithinDays?: number;
  // Option labels for each computed band. Must be members of the field's options.
  buckets: {
    overdue: string; // elapsed days exceed the threshold
    soon: string; // within soonWithinDays of the threshold
    ok: string; // otherwise
  };
}

export interface FormulaDerive {
  kind: "formula";
  // Arithmetic over sibling number/currency field ids and numeric literals.
  expression: string;
}

export type DerivedFieldSpec = DateThresholdDerive | FormulaDerive;

export interface ProductField {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
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

export interface ProductEntity {
  name: string;
  plural: string;
  primaryField: string;
  fields: ProductField[];
}

export interface ProductFilter {
  id: string;
  label: string;
  field: string;
  operator: FilterOperator;
  value?: string;
}

export interface ProductCalculation {
  id: string;
  label: string;
  operation: CalculationOperation;
  // For countWhere/sumWhere: the field the predicate tests. For sum: the numeric
  // field to total.
  field?: string;
  operator?: FilterOperator;
  value?: string;
  // For sumWhere: the numeric field whose values are summed over the matching
  // records (e.g. sum `amount` where `category` = Food).
  sumField?: string;
}

// A one-tap action on each record that mutates one field to a computed value —
// the deterministic form of the recurring "Done!"/"Mark paid"/"Returned" button
// that would otherwise force the hybrid (LLM) route. `set` is the mutation:
// "today" stamps a date field to the current date; "clear" empties the field.
export interface ProductQuickAction {
  id: string;
  label: string;
  field: string;
  set: "today" | "clear";
}

export interface ProductCapabilities {
  create: boolean;
  edit: boolean;
  delete: boolean;
  search: boolean;
  filter: boolean;
  sort: boolean;
  group: boolean;
  transition: boolean;
  calculate: boolean;
}

export interface ProductIR {
  version: "1";
  product: {
    name: string;
    description: string;
    tagline?: string;
    targetUser: string;
    genome: Genome;
    accent?: string;
    design?: DesignIntent;
  };
  entities: ProductEntity[];
  capabilities: ProductCapabilities;
  filters: ProductFilter[];
  calculations: ProductCalculation[];
  charts: ProductChart[];
  quickActions: ProductQuickAction[];
  persistence: { strategy: "localStorage" };
  assumptions: string[];
  excluded: string[];
  customRequirements: string[];
}

export interface NormalizedProductIR extends ProductIR {
  product: ProductIR["product"] & { design: DesignIntent; tagline: string };
  entities: [ProductEntity, ...ProductEntity[]];
}

export type BuildRoute = "compile" | "hybrid" | "custom";

export interface RouteDecision {
  route: BuildRoute;
  genome: Genome;
  supported: string[];
  unsupported: string[];
  reason: string;
}
