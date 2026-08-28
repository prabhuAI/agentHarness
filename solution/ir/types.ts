export const GENOMES = ["tracker", "workflow", "catalog", "planner", "dashboard", "ledger", "directory", "log", "inventory"] as const;
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
  "category", "status", "email", "url", "reference",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FILTER_OPERATORS = [
  "equals", "notEquals", "contains", "nonEmpty", "empty", "truthy", "falsy",
  "greaterThan", "lessThan", "atLeast", "atMost", "between",
  "before", "after", "today", "thisWeek", "thisMonth",
] as const;
export type FilterOperator = (typeof FILTER_OPERATORS)[number];

// Operators that test a date field against the current date rather than a stored
// value; they carry no comparison value and only apply to date/datetime fields.
export const DATE_WINDOW_OPERATORS = ["today", "thisWeek", "thisMonth"] as const;
export type DateWindowOperator = (typeof DATE_WINDOW_OPERATORS)[number];

// Operators that compare a stored value against a threshold. `between` carries a
// second bound in `valueEnd`; the rest carry one comparison value. Numeric fields
// compare numerically; date/datetime and text compare lexicographically (ISO dates
// sort chronologically). `before`/`after` are date-only aliases of lessThan/greaterThan.
export const COMPARISON_OPERATORS = ["greaterThan", "lessThan", "atLeast", "atMost", "between", "before", "after"] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];
// Comparison operators restricted to date/datetime fields.
export const DATE_COMPARISON_OPERATORS = ["before", "after"] as const;

export const CALCULATION_OPERATIONS = [
  "count", "countWhere",
  "sum", "sumWhere",
  "average", "avgWhere",
  "min", "minWhere",
  "max", "maxWhere",
] as const;
export type CalculationOperation = (typeof CALCULATION_OPERATIONS)[number];

export const DERIVED_FIELD_KINDS = ["dateThreshold", "formula", "presence"] as const;
export type DerivedFieldKind = (typeof DERIVED_FIELD_KINDS)[number];

export const CHART_TYPES = ["line", "bar", "pie"] as const;
export type ChartType = (typeof CHART_TYPES)[number];

// A deterministic chart derived from persisted records at read time. Three kinds:
//   line — one numeric `yField` plotted against a date `xField`, chronologically
//          ("see my <number> over time": weight over date, spend over month).
//   bar  — records grouped by a category/status `xField`; each bar is either the
//          count of records in that group, or — when `yField` is numeric — the
//          sum of that measure per group (spend by category).
//   pie  — the same grouped breakdown shown as a share-of-total donut.
// bar/pie leave `yField` unset to count records; set it to sum a numeric measure.
export interface ProductChart {
  id: string;
  label: string;
  type: ChartType;
  // line: the date/datetime axis. bar/pie: the category/status field grouped on.
  xField: string;
  // line: the number/currency value plotted (required). bar/pie: an optional
  // numeric measure summed per group; omitted means count records.
  yField?: string;
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

// A two-state lifecycle that is fully determined by whether another field is
// filled in — e.g. a book is "Lent out" exactly when its borrower field is set,
// otherwise "On shelf". Because the status is computed at read time from the
// source field's presence, the two can never drift out of sync: clearing the
// source flips the status back, and no separate manual status is stored.
export interface PresenceDerive {
  kind: "presence";
  // Field id whose non-empty value drives this status.
  sourceField: string;
  // Option label when the source field is filled in.
  whenPresent: string;
  // Option label when the source field is empty.
  whenEmpty: string;
}

export type DerivedFieldSpec = DateThresholdDerive | FormulaDerive | PresenceDerive;

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
  // For a `reference` field: the name of the entity this field links to. The field
  // stores a linked record's id and displays that record's primary field. Kept only
  // when it resolves to a real, different entity; otherwise the field degrades to text.
  refEntity?: string;
}

export interface ProductEntity {
  name: string;
  plural: string;
  primaryField: string;
  fields: ProductField[];
}

// A deterministic table derived from scored records involving two participants.
// The vocabulary is deliberately domain-neutral: the same structure can power a
// sports league, classroom competition, sales contest, or tournament ladder.
export interface ProductStandings {
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

// A deterministic ordered subset with one prominently identified first record.
// Covers FIFO waitlists, triage queues, dispatch lists, and any "who is next?"
// workflow without model-authored UI code.
export interface ProductPriority {
  label: string;
  sortField: string;
  direction: "asc" | "desc";
  filter?: {
    field: string;
    operator: FilterOperator;
    value?: string;
    valueEnd?: string;
  };
}

export interface ProductFilter {
  id: string;
  label: string;
  field: string;
  operator: FilterOperator;
  value?: string;
  // Upper bound for the `between` operator (inclusive); ignored by other operators.
  valueEnd?: string;
}

export interface ProductCalculation {
  id: string;
  label: string;
  operation: CalculationOperation;
  // Entity whose records this metric summarizes. Optional for legacy
  // single-entity products; normalized/inferred for multi-entity products.
  entity?: string;
  // For countWhere/sumWhere: the field the predicate tests. For sum: the numeric
  // field to total.
  field?: string;
  operator?: FilterOperator;
  value?: string;
  // Upper bound for a `between` predicate (inclusive); ignored otherwise.
  valueEnd?: string;
  // For sumWhere: the numeric field whose values are summed over the matching
  // records (e.g. sum `amount` where `category` = Food).
  sumField?: string;
}

// A one-tap action on each record that mutates one field to a computed value —
// the deterministic form of the recurring "Done!"/"Mark paid"/"+1"/"Returned"
// button that would otherwise force the hybrid (LLM) route. `set` is the mutation:
//   today     — stamp a date/datetime field to the current date
//   now       — stamp a datetime field to the current date and time
//   clear     — empty the field
//   increment — add `amount` (default 1) to a number/currency field (streaks, tallies, stock)
//   toggle    — flip a boolean field
//   setValue  — set a category/status field to the fixed `value` (advance a lifecycle)
export const QUICK_ACTION_SETS = ["today", "now", "clear", "increment", "toggle", "setValue"] as const;
export type QuickActionSet = (typeof QUICK_ACTION_SETS)[number];
export interface ProductQuickAction {
  id: string;
  label: string;
  field: string;
  set: QuickActionSet;
  // Step for `increment` (may be negative to decrement); defaults to 1.
  amount?: number;
  // Target value for `setValue`; must be non-empty.
  value?: string;
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
  // Deterministic CSV/JSON export and JSON import of the primary entity's records.
  // A domain-neutral runtime feature; defaults on, set false to hide the controls.
  export: boolean;
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
  // Raw input capabilities may be partial; normalize fills every field with a
  // sensible default (export defaults on), so the normalized IR carries them all.
  capabilities: Partial<ProductCapabilities>;
  filters: ProductFilter[];
  calculations: ProductCalculation[];
  charts: ProductChart[];
  quickActions: ProductQuickAction[];
  standings?: ProductStandings[];
  priority?: ProductPriority;
  persistence: { strategy: "localStorage" };
  assumptions: string[];
  excluded: string[];
  customRequirements: string[];
}

export interface NormalizedProductIR extends ProductIR {
  product: ProductIR["product"] & { design: DesignIntent; tagline: string };
  entities: [ProductEntity, ...ProductEntity[]];
  capabilities: ProductCapabilities;
  standings: ProductStandings[];
}

export type BuildRoute = "compile" | "hybrid" | "custom";

export interface RouteDecision {
  route: BuildRoute;
  genome: Genome;
  supported: string[];
  unsupported: string[];
  reason: string;
}
